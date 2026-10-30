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
pub(crate) fn audit_signal(owner: &crate::mcp_host::Owner, pid: u32, signal: &str) {
    if let Some(file) = AUDIT.get() {
        if let Ok(mut file) = file.lock() {
            let _ = writeln!(
                file,
                "{}",
                json!({"at":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),"actor":"rust","group":owner.guardian,"proofPid":pid,"run":owner.run,"nonce":owner.nonce,"signal":signal,"matched":true})
            );
        }
    }
}
pub(crate) fn inherit_audit(command: &mut std::process::Command) {
    if let Some(file) = AUDIT
        .get()
        .and_then(|f| f.lock().ok())
        .and_then(|f| f.try_clone().ok())
    {
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
