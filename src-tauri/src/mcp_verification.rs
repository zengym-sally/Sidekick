use crate::local_store::{McpRemoveInput, McpServerInput, StoreError};
use crate::runtime_host::{Job, JobKind, RuntimeState, StartTask};
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
static POLICY: Mutex<Option<String>> = Mutex::new(None);
pub(crate) fn take_policy() -> String {
    POLICY
        .lock()
        .ok()
        .and_then(|mut p| p.take())
        .unwrap_or_default()
}
static AUDIT: OnceLock<Mutex<File>> = OnceLock::new();
fn audit_signal_to(
    target: Option<&Mutex<File>>,
    owner: &crate::mcp_host::Owner,
    pid: u32,
    signal: &str,
) -> bool {
    match target {
        None => true,
        Some(file) => match file.lock() {
            Ok(mut file) => writeln!(
                file,
                "{}",
                json!({"at":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),"actor":"rust","group":owner.guardian,"proofPid":pid,"run":owner.run,"nonce":owner.nonce,"signal":signal,"matched":true})
            ).is_ok(),
            Err(_) => false,
        },
    }
}
pub(crate) fn audit_signal(owner: &crate::mcp_host::Owner, pid: u32, signal: &str) -> bool {
    audit_signal_to(AUDIT.get(), owner, pid, signal)
}
fn inherit_audit_from(
    command: &mut std::process::Command,
    target: Option<&Mutex<File>>,
) -> std::io::Result<()> {
    if let Some(target) = target {
        let file = target
            .lock()
            .map_err(|_| std::io::Error::other("Audit lock unavailable"))?
            .try_clone()?;
        command.env("SIDEKICK_MCP_AUDIT_FD", "3");
        // The verification-only descriptor never reaches the untrusted service.
        unsafe {
            command.pre_exec(move || {
                unsafe extern "C" {
                    fn dup2(old: i32, new: i32) -> i32;
                }
                if dup2(file.as_raw_fd(), 3) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    Ok(())
}
pub(crate) fn inherit_audit(command: &mut std::process::Command) -> std::io::Result<()> {
    inherit_audit_from(command, AUDIT.get())
}

fn invalid() -> StoreError {
    StoreError {
        code: "VERIFY_INPUT",
        message: "隔离验证输入无效。",
    }
}
pub fn run() {
    if let Err(e) = serve() {
        eprintln!("{}", e.code);
        std::process::exit(2);
    }
}
fn serve() -> Result<(), StoreError> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.len() < 4 {
        return Err(invalid());
    }
    let app = PathBuf::from(&args[1]);
    let nonce = &args[2];
    let directory = PathBuf::from(&args[3]);
    if nonce.len() != 48 || !nonce.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid());
    }
    let reopening = args.get(4).is_some_and(|s| s == "--reopen");
    let local = crate::verification_root::open_local(
        &app,
        nonce,
        ".s33-discovery-verification",
        reopening,
        args.get(4).is_none_or(|s| s != "--v3"),
    )?;
    let audit_path = app.join("signal-audit.jsonl");
    let audit = OpenOptions::new()
        .append(true)
        .create_new(!reopening)
        .mode(0o600)
        .open(&audit_path)
        .map_err(|_| invalid())?;
    let m = std::fs::symlink_metadata(&audit_path).map_err(|_| invalid())?;
    if !m.is_file() || m.file_type().is_symlink() || m.nlink() != 1 || m.mode() & 0o7777 != 0o600 {
        return Err(invalid());
    }
    AUDIT.set(Mutex::new(audit)).map_err(|_| invalid())?;
    let runtime = RuntimeState::default();
    let sink = Arc::new(|_: &str, _: &str| {});
    println!(
        "{}",
        json!({"ready":true,"pid":std::process::id(),"root":app.join("workspace")})
    );
    for line in std::io::stdin().lock().lines() {
        let result = (|| -> Result<Value, StoreError> {
            let line = line.map_err(|_| invalid())?;
            if line.len() > 1000000 {
                return Err(invalid());
            }
            let v: Value = serde_json::from_str(&line).map_err(|_| invalid())?;
            let text = |k: &str| v[k].as_str().map(str::to_owned).ok_or_else(invalid);
            match v["op"].as_str() {
                Some("policy") => {
                    let policy = text("value")?;
                    if ![
                        "missing-ack",
                        "wrong-ack",
                        "cancel-before-ack",
                        "old-run",
                        "old-nonce",
                        "duplicate-owner",
                        "blocked-writer",
                    ]
                    .contains(&policy.as_str())
                    {
                        return Err(invalid());
                    }
                    *POLICY.lock().map_err(|_| invalid())? = Some(policy);
                    Ok(Value::Null)
                }
                Some("reserve") => {
                    let kind = match text("kind")?.as_str() {
                        "business" => JobKind::Business,
                        "trial" => JobKind::Trial,
                        _ => return Err(invalid()),
                    };
                    let mut slot = runtime.slot.lock().map_err(|_| invalid())?;
                    if slot.is_some() {
                        return Err(invalid());
                    }
                    *slot = Some(Job {
                        run_id: "verification-only-slot-reservation".into(),
                        kind,
                        nonce: crate::mcp_host::nonce(),
                        server_id: None,
                        cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                        pid: Arc::new(std::sync::atomic::AtomicU32::new(0)),
                        workers: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
                        mcp_owner: Arc::new(Mutex::new(None)),
                        mcp_intent: Arc::new(Mutex::new(None)),
                    });
                    Ok(Value::Null)
                }
                Some("release") => {
                    let mut slot = runtime.slot.lock().map_err(|_| invalid())?;
                    if slot
                        .as_ref()
                        .is_none_or(|j| j.run_id != "verification-only-slot-reservation")
                    {
                        return Err(invalid());
                    }
                    *slot = None;
                    Ok(Value::Null)
                }
                Some("config") => local.access(|s| {
                    serde_json::to_value(s.mcp_configuration()?).map_err(|_| invalid())
                }),
                Some("save") => {
                    let input: McpServerInput =
                        serde_json::from_value(v["input"].clone()).map_err(|_| invalid())?;
                    local.access(|s| {
                        serde_json::to_value(s.save_mcp_server(input)?).map_err(|_| invalid())
                    })
                }
                Some("start") => Ok(serde_json::to_value(runtime.start_probe(
                    local.clone(),
                    directory.clone(),
                    text("server")?,
                    text("revision")?,
                    sink.clone(),
                )?)
                .map_err(|_| invalid())?),
                Some("read") => local.access(|s| {
                    serde_json::to_value(s.mcp_probe(&text("id")?)?).map_err(|_| invalid())
                }),
                Some("catalog") => local.access(|s| {
                    serde_json::to_value(s.read_mcp_catalog(&text("id")?)?).map_err(|_| invalid())
                }),
                Some("status") => {
                    let slot = runtime.slot.lock().map_err(|_| invalid())?;
                    let process = slot.as_ref().map(|j| json!({"pid":j.pid.load(std::sync::atomic::Ordering::SeqCst),"owner":j.mcp_owner.lock().ok().and_then(|o| o.clone()),"intent":j.mcp_intent.lock().ok().and_then(|n| n.clone())}));
                    drop(slot);
                    Ok(
                        json!({"active":runtime.active_probe(),"business":runtime.active_business(),"trial":runtime.active_trial(),"process":process}),
                    )
                }
                Some("cancel") => {
                    runtime.cancel(&text("id")?);
                    Ok(Value::Null)
                }
                Some("remove") => {
                    let input: McpRemoveInput =
                        serde_json::from_value(v["input"].clone()).map_err(|_| invalid())?;
                    serde_json::to_value(runtime.remove_mcp_server(&local, input)?)
                        .map_err(|_| invalid())
                }
                Some("business") => serde_json::to_value(runtime.start(
                    local.clone(),
                    directory.clone(),
                    StartTask::Test(None),
                    sink.clone(),
                )?)
                .map_err(|_| invalid()),
                _ => Err(invalid()),
            }
        })();
        println!(
            "{}",
            match result {
                Ok(value) => json!({"ok":value}),
                Err(e) => json!({"error":e}),
            }
        );
    }
    runtime.shutdown(&directory);
    Ok(())
}

#[cfg(test)]
mod audit_capability_tests {
    use super::*;
    use std::os::unix::fs::DirBuilderExt;
    fn fixture() -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("sidekick-audit-cap-{}", crate::mcp_host::nonce()));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .unwrap();
        let path = root.join("audit.jsonl");
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        (root, path)
    }
    fn owner() -> crate::mcp_host::Owner {
        crate::mcp_host::Owner {
            guardian: 123,
            keeper: 124,
            run: "synthetic-run".into(),
            nonce: "synthetic-audit-nonce".into(),
        }
    }
    struct OwnedGroup {
        child: std::process::Child,
        root: PathBuf,
        owner: crate::mcp_host::Owner,
    }
    impl Drop for OwnedGroup {
        fn drop(&mut self) {
            let command = std::process::Command::new("/bin/ps")
                .args(["-p", &self.child.id().to_string(), "-o", "pgid=,command="])
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&command.stdout);
            if text
                .split_whitespace()
                .next()
                .and_then(|v| v.parse::<u32>().ok())
                == Some(self.owner.guardian)
                && text.contains(
                    self.root
                        .join("mcp-guardian.mjs")
                        .to_string_lossy()
                        .as_ref(),
                )
                && text.contains(&format!("--run {} ", self.owner.run))
                && text.contains(&format!("--nonce {} ", self.owner.nonce))
            {
                let _ = std::process::Command::new("/bin/kill")
                    .args(["-KILL", &format!("-{}", self.owner.guardian)])
                    .status();
            }
            let _ = self.child.wait();
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    fn owned_group() -> OwnedGroup {
        let (root, _) = fixture();
        let script = root.join("mcp-guardian.mjs");
        std::fs::write(&script, "while :; do /bin/sleep 1; done\n").unwrap();
        let token = crate::mcp_host::nonce();
        let child = std::process::Command::new("/bin/sh")
            .arg(script)
            .args([
                "--mode",
                "guardian",
                "--run",
                "synthetic-signal",
                "--nonce",
                &token,
                "--lifetime",
                "20000",
            ])
            .process_group(0)
            .spawn()
            .unwrap();
        let owner = crate::mcp_host::Owner {
            guardian: child.id(),
            keeper: 0,
            run: "synthetic-signal".into(),
            nonce: token,
        };
        OwnedGroup { child, root, owner }
    }
    #[test]
    fn audit_failure_is_consumed_by_actual_reap_gate() {
        for kind in ["readonly", "poisoned", "writable"] {
            let mut group = owned_group();
            let path = group.root.join("audit.jsonl");
            let file = if kind == "readonly" {
                File::open(&path).unwrap()
            } else {
                OpenOptions::new().append(true).open(&path).unwrap()
            };
            let target = Arc::new(Mutex::new(file));
            if kind == "poisoned" {
                let copy = target.clone();
                let _ = std::thread::spawn(move || {
                    let _held = copy.lock().unwrap();
                    panic!("intentional audit lock poison");
                })
                .join();
            }
            let calls = std::cell::Cell::new(0);
            let cleaned = crate::mcp_host::reap_with_audit(
                &group.owner,
                &group.root,
                |owner, pid, signal| {
                    calls.set(calls.get() + 1);
                    audit_signal_to(Some(&target), owner, pid, signal)
                },
            );
            assert!(
                calls.get() > 0,
                "real identity proof reaches the audit gate"
            );
            if kind == "writable" {
                assert!(cleaned);
                assert!(!group.child.wait().unwrap().success());
            } else {
                assert!(!cleaned);
                assert_eq!(calls.get(), 1);
                assert!(group.child.try_wait().unwrap().is_none());
                let state = std::process::Command::new("/bin/ps")
                    .args(["-p", &group.child.id().to_string(), "-o", "stat="])
                    .output()
                    .unwrap();
                assert!(
                    !String::from_utf8_lossy(&state.stdout)
                        .trim()
                        .starts_with('T'),
                    "failed audit cannot send STOP"
                );
                assert!(std::fs::read(path).unwrap().is_empty());
            }
        }
    }
    #[test]
    fn explicit_audit_writes_or_refuses_before_signal() {
        let (root, path) = fixture();
        assert!(audit_signal_to(None, &owner(), 123, "-STOP"));
        assert_eq!(std::fs::read(&path).unwrap(), b"");
        let writable = Mutex::new(OpenOptions::new().append(true).open(&path).unwrap());
        assert!(audit_signal_to(Some(&writable), &owner(), 123, "-STOP"));
        let before = std::fs::read(&path).unwrap();
        let readonly = Mutex::new(File::open(&path).unwrap());
        assert!(!audit_signal_to(Some(&readonly), &owner(), 123, "-KILL"));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn audit_lock_failure_cannot_downgrade_inheritance_or_signal() {
        let (root, path) = fixture();
        let target = Arc::new(Mutex::new(
            OpenOptions::new().append(true).open(&path).unwrap(),
        ));
        let copy = target.clone();
        let _ = std::thread::spawn(move || {
            let _held = copy.lock().unwrap();
            panic!("intentional audit lock poison");
        })
        .join();
        let mut command = std::process::Command::new("/usr/bin/true");
        assert!(inherit_audit_from(&mut command, Some(&target)).is_err());
        assert!(!command
            .get_envs()
            .any(|(key, _)| key == "SIDEKICK_MCP_AUDIT_FD"));
        assert!(!audit_signal_to(Some(&target), &owner(), 123, "-KILL"));
        assert_eq!(std::fs::read(&path).unwrap(), b"");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_registered_audit_adds_the_private_marker() {
        let (root, path) = fixture();
        let mut command = std::process::Command::new("/usr/bin/true");
        inherit_audit_from(&mut command, None).unwrap();
        assert!(!command
            .get_envs()
            .any(|(key, _)| key == "SIDEKICK_MCP_AUDIT_FD"));
        let target = Mutex::new(OpenOptions::new().append(true).open(&path).unwrap());
        inherit_audit_from(&mut command, Some(&target)).unwrap();
        assert!(command
            .get_envs()
            .any(|(key, value)| key == "SIDEKICK_MCP_AUDIT_FD"
                && value == Some(std::ffi::OsStr::new("3"))));
        std::fs::remove_dir_all(root).unwrap();
    }
}
