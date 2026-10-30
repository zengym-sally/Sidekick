use crate::local_store::{
    AppStore, McpConfigSave, McpDiscoveredCatalog, McpProbe, McpProbeFailure, McpRemoveInput,
    PreparedMcpProbe, StoreError,
};
use crate::runtime_host::{Job, JobKind, RuntimeState, Sink};
use crate::store_commands::LocalState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};
type Result<T> = std::result::Result<T, StoreError>;
fn error(code: &'static str) -> StoreError {
    StoreError {
        code,
        message: "MCP诊断未完成，请核对配置或重新读取诊断状态。",
    }
}
pub(crate) fn nonce() -> String {
    let mut bytes = [0_u8; 24];
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_err()
    {
        return String::new();
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Owner {
    pub(crate) guardian: u32,
    pub(crate) keeper: u32,
    pub(crate) run: String,
    pub(crate) nonce: String,
}
fn process(pid: u32) -> Option<(u32, u32, String)> {
    if pid <= 1 {
        return None;
    }
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "ppid=,pgid=,stat=,command="])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut fields = text.split_whitespace();
    let parent = fields.next()?.parse().ok()?;
    let group = fields.next()?.parse().ok()?;
    if fields.next()?.starts_with('Z') {
        return None;
    }
    Some((parent, group, fields.collect::<Vec<_>>().join(" ")))
}
fn proof(owner: &Owner, directory: &Path) -> Option<u32> {
    for pid in [owner.guardian, owner.keeper] {
        if let Some((_, group, command)) = process(pid) {
            if group == owner.guardian
                && command.contains(
                    directory
                        .join("mcp-guardian.mjs")
                        .to_string_lossy()
                        .as_ref(),
                )
                && command.contains(&format!("--run {} ", owner.run))
                && command.contains(&format!("--nonce {} ", owner.nonce))
                && (command.contains("--mode guardian ") || command.contains("--mode keeper "))
            {
                return Some(pid);
            }
        }
    }
    None
}
fn group_gone(group: u32) -> bool {
    let Ok(output) = Command::new("/bin/ps")
        .args(["-axo", "pgid=,stat="])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .output()
    else {
        return false;
    };
    output.status.success()
        && !String::from_utf8_lossy(&output.stdout).lines().any(|l| {
            let mut p = l.split_whitespace();
            p.next().and_then(|x| x.parse::<u32>().ok()) == Some(group)
                && p.next().is_some_and(|s| !s.starts_with('Z'))
        })
}
fn reap(owner: &Owner, directory: &Path) -> bool {
    for signal in ["-STOP", "-KILL"] {
        if group_gone(owner.guardian) {
            return true;
        }
        let Some(_pid) = proof(owner, directory) else {
            return false;
        };
        audit_signal(owner, _pid, signal);
        let _ = Command::new("/bin/kill")
            .args([signal, &format!("-{}", owner.guardian)])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let until = Instant::now() + Duration::from_secs(3);
    while Instant::now() < until {
        if group_gone(owner.guardian) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}
fn audit_signal(_owner: &Owner, _pid: u32, _signal: &str) {
    #[cfg(feature = "s33-mcp-verification")]
    crate::mcp_verification::audit_signal(_owner, _pid, _signal);
}
fn valid_nonce(n: &str) -> bool {
    n.len() == 36
        && n.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn discover_intent(run: &str, nonce: &str, directory: &Path) -> Result<Vec<Owner>> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,pgid=,stat=,command="])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .output()
        .map_err(|_| error("MCP_CLEANUP"))?;
    if !output.status.success() {
        return Err(error("MCP_CLEANUP"));
    }
    let mut found = BTreeMap::<u32, Owner>::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut p = line.split_whitespace();
        let pid = p.next().and_then(|x| x.parse::<u32>().ok());
        let group = p.next().and_then(|x| x.parse::<u32>().ok());
        let status = p.next().unwrap_or_default();
        let command = p.collect::<Vec<_>>().join(" ");
        let (Some(pid), Some(group)) = (pid, group) else {
            continue;
        };
        if status.starts_with('Z')
            || !command.contains(
                directory
                    .join("mcp-guardian.mjs")
                    .to_string_lossy()
                    .as_ref(),
            )
            || !command.contains(&format!("--run {run} "))
            || !command.contains(&format!("--nonce {nonce} "))
        {
            continue;
        }
        if command.contains("--mode guardian ") && pid == group {
            found.entry(group).or_insert(Owner {
                guardian: group,
                keeper: 0,
                run: run.into(),
                nonce: nonce.into(),
            });
        } else if command.contains("--mode keeper ")
            && command.contains(&format!("--group {group} "))
            && command.contains(&format!("--guardian {group} "))
        {
            found
                .entry(group)
                .or_insert(Owner {
                    guardian: group,
                    keeper: pid,
                    run: run.into(),
                    nonce: nonce.into(),
                })
                .keeper = pid;
        }
    }
    Ok(found.into_values().collect())
}
fn reap_intent(run: &str, nonce: &str, directory: &Path) -> bool {
    match discover_intent(run, nonce, directory) {
        Ok(owners) => owners.iter().all(|o| reap(o, directory)),
        Err(_) => false,
    }
}
pub(crate) fn shutdown(job: &Job, directory: &Path) {
    let pid = job.pid.load(Ordering::SeqCst);
    if process(pid).is_some_and(|(_, _, c)| {
        c.contains(directory.join("mcp-probe.mjs").to_string_lossy().as_ref())
            && c.contains(&format!("--run {} ", job.run_id))
            && c.ends_with(&format!("--nonce {}", job.nonce))
    }) {
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    let owner = job.mcp_owner.lock().ok().and_then(|o| o.clone());
    if let Some(owner) = owner {
        reap(&owner, directory);
    } else if let Some(nonce) = job.mcp_intent.lock().ok().and_then(|n| n.clone()) {
        reap_intent(&job.run_id, &nonce, directory);
    }
}

impl RuntimeState {
    pub(crate) fn remove_mcp_server(
        &self,
        local: &LocalState,
        input: McpRemoveInput,
    ) -> Result<McpConfigSave> {
        let slot = self.slot.lock().map_err(|_| error("RUNTIME_BUSY"))?;
        if slot
            .as_ref()
            .is_some_and(|j| j.server_id.as_deref() == Some(&input.id))
        {
            return Err(error("MCP_PROBE_ACTIVE"));
        }
        local.access(|s| s.remove_mcp_server(input))
    }
    pub(crate) fn active_probe(&self) -> Option<String> {
        self.slot.lock().ok().and_then(|s| {
            s.as_ref()
                .filter(|j| j.kind == JobKind::Probe)
                .map(|j| j.run_id.clone())
        })
    }
    pub(crate) fn start_probe(
        &self,
        local: LocalState,
        directory: PathBuf,
        server: String,
        revision: String,
        sink: Sink,
    ) -> Result<McpProbe> {
        let started = Instant::now();
        let mut slot = self.slot.lock().map_err(|_| error("RUNTIME_BUSY"))?;
        if slot.is_some() {
            return Err(error("RUNTIME_BUSY"));
        }
        let job_nonce = nonce();
        if job_nonce.is_empty() {
            return Err(error("MCP_PROCESS"));
        }
        let (run, prepared) = local.access(|store| {
            let run = store.begin_mcp_probe(&server, &revision)?;
            let preparation = store.prepare_mcp_probe(&run.id).and_then(|p| {
                if !directory.join("node").is_file()
                    || !directory.join("mcp-probe.mjs").is_file()
                    || !directory.join("mcp-guardian.mjs").is_file()
                {
                    return Err(error("MCP_DEPENDENCY_MISSING"));
                }
                resolve_command(p, &directory)
            });
            match preparation {
                Ok(p) => Ok((run, Some(p))),
                Err(e) => Ok((store.fail_mcp_probe(&run.id, failure(e.code))?, None)),
            }
        })?;
        let Some(prepared) = prepared else {
            return Ok(run);
        };
        let job = Job {
            run_id: run.id.clone(),
            kind: JobKind::Probe,
            nonce: job_nonce,
            server_id: Some(server),
            cancel: Arc::new(AtomicBool::new(false)),
            pid: Arc::new(AtomicU32::new(0)),
            workers: Arc::new(Mutex::new(BTreeMap::new())),
            mcp_owner: Arc::new(Mutex::new(None)),
            mcp_intent: Arc::new(Mutex::new(None)),
        };
        *slot = Some(job.clone());
        let state = self.clone();
        let id = run.id.clone();
        let timeout = run.snapshot.connect_timeout_ms;
        std::thread::spawn(move || {
            let sensitive = prepared
                .sensitive_names
                .iter()
                .filter_map(|name| prepared.env.get(name).cloned())
                .collect::<Vec<_>>();
            let (result, cleaned) = execute(&job, &state, &directory, prepared, timeout, started);
            let mut stored = Err(error("MCP_CLEANUP"));
            if let Ok(mut slot) = state.slot.lock() {
                if slot
                    .as_ref()
                    .is_some_and(|j| j.run_id == id && j.nonce == job.nonce)
                {
                    stored = local.access(|s| {
                        if !cleaned {
                            return s.fail_mcp_probe(&id, McpProbeFailure::Cleanup);
                        }
                        if job.cancel.load(Ordering::SeqCst) {
                            return s.cancel_mcp_probe(&id);
                        }
                        match result {
                            Ok(catalog) if cleaned => {
                                match s.publish_mcp_catalog(&id, catalog, &sensitive) {
                                    Ok(run) => Ok(run),
                                    Err(e) if e.code == "MCP_PROBE_SAVE_UNCERTAIN" => Err(e),
                                    Err(e) => s.fail_mcp_probe(
                                        &id,
                                        match e.code {
                                            "MCP_CATALOG_INVALID" => {
                                                McpProbeFailure::InvalidCatalog
                                            }
                                            "MCP_PRIVATE_OUTPUT" => McpProbeFailure::PrivateOutput,
                                            _ => McpProbeFailure::Save,
                                        },
                                    ),
                                }
                            }
                            Ok(_) => s.fail_mcp_probe(&id, McpProbeFailure::Cleanup),
                            Err(code) => s.fail_mcp_probe(&id, failure(code)),
                        }
                    });
                    if cleaned {
                        *slot = None;
                    }
                }
            }
            sink(
                &id,
                if stored.is_ok() {
                    "changed"
                } else {
                    "storage_error"
                },
            );
        });
        drop(slot);
        Ok(run)
    }
}
fn failure(code: &str) -> McpProbeFailure {
    match code {
        "MCP_COMMAND_MISSING" => McpProbeFailure::CommandMissing,
        "MCP_DIRECTORY_MISSING" => McpProbeFailure::DirectoryMissing,
        "MCP_ENV_MISSING" => McpProbeFailure::EnvironmentMissing,
        "MCP_CREDENTIAL_UNAVAILABLE" | "MCP_CREDENTIAL_MISSING" => {
            McpProbeFailure::CredentialUnavailable
        }
        "MCP_DEPENDENCY_MISSING" => McpProbeFailure::DependencyMissing,
        "MCP_TIMEOUT" => McpProbeFailure::Timeout,
        "MCP_CATALOG_INVALID" => McpProbeFailure::InvalidCatalog,
        "MCP_PRIVATE_OUTPUT" => McpProbeFailure::PrivateOutput,
        "MCP_CLEANUP" => McpProbeFailure::Cleanup,
        "MCP_PROTOCOL" => McpProbeFailure::Protocol,
        _ => McpProbeFailure::Process,
    }
}
fn resolve_command(mut p: PreparedMcpProbe, directory: &Path) -> Result<PreparedMcpProbe> {
    use std::os::unix::fs::PermissionsExt;
    let path = format!(
        "{}:{}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        directory.display(),
        p.env.get("PATH").map(String::as_str).unwrap_or_default()
    );
    let executable = |path: &Path| {
        path.is_file()
            && path
                .metadata()
                .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    };
    let command = PathBuf::from(&p.command);
    let found = if p.command.contains('/') {
        let c = if command.is_absolute() {
            command
        } else {
            p.cwd.join(command)
        };
        executable(&c).then_some(c)
    } else {
        std::env::split_paths(&path)
            .map(|d| {
                if d.is_absolute() {
                    d.join(&p.command)
                } else {
                    p.cwd.join(d).join(&p.command)
                }
            })
            .find(|c| executable(c))
    };
    p.command = found
        .ok_or_else(|| error("MCP_COMMAND_MISSING"))?
        .to_string_lossy()
        .into_owned();
    Ok(p)
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Frame {
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) run_id: String,
    pub(crate) host_nonce: String,
    #[serde(flatten)]
    pub(crate) body: Value,
}
fn execute(
    job: &Job,
    state: &RuntimeState,
    directory: &Path,
    p: PreparedMcpProbe,
    timeout: u32,
    started: Instant,
) -> (
    std::result::Result<McpDiscoveredCatalog, &'static str>,
    bool,
) {
    #[cfg(feature = "s33-mcp-verification")]
    let policy = crate::mcp_verification::take_policy();
    #[cfg(feature = "s33-mcp-verification")]
    let budget_ms = if policy == "blocked-writer" {
        1000_u64
    } else {
        120000_u64
    };
    #[cfg(not(feature = "s33-mcp-verification"))]
    let budget_ms = 120000_u64;
    let remaining = budget_ms.saturating_sub(started.elapsed().as_millis() as u64);
    if remaining < 1 {
        return (Err("MCP_TIMEOUT"), true);
    }
    let mut command = Command::new(directory.join("node"));
    command
        .arg(directory.join("mcp-probe.mjs"))
        .args(["--run", &job.run_id, "--nonce", &job.nonce])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("TMPDIR", "/tmp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    #[cfg(feature = "s33-mcp-verification")]
    crate::mcp_verification::inherit_audit(&mut command);
    let Ok(mut child) = command.spawn() else {
        return (Err("MCP_PROCESS"), true);
    };
    job.pid.store(child.id(), Ordering::SeqCst);
    let input = json!({"runId":job.run_id,"hostNonce":job.nonce,"command":p.command,"args":p.args,"cwd":p.cwd,"runDirectory":p.run_directory,"env":p.env,"sensitiveNames":p.sensitive_names,"directory":directory,"totalDeadline":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 + remaining,"connectTimeoutMs":timeout});
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(4);
    let mut stdin = child.stdin.take().expect("piped stdin");
    let writer = std::thread::spawn(move || {
        for bytes in rx {
            if stdin.write_all(&bytes).is_err() {
                return false;
            }
        }
        true
    });
    let mut initial = serde_json::to_vec(&input).unwrap_or_default();
    initial.push(b'\n');
    if initial.len() > 2000000 || tx.try_send(initial).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        drop(tx);
        let _ = writer.join();
        return (Err("MCP_PROTOCOL"), true);
    }
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let (events, frames) = mpsc::sync_channel(8);
    let errors = events.clone();
    #[cfg(feature = "s33-mcp-verification")]
    let reader_policy = policy.clone();
    let reader = std::thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        let mut total = 0;
        let mut count = 0;
        loop {
            let mut line = Vec::new();
            let read = (&mut r).take(1200001).read_until(b'\n', &mut line);
            match read {
                Ok(0) => break,
                Ok(_) => {
                    total += line.len();
                    count += 1;
                    if line.len() > 1200000
                        || total > 2000000
                        || count > 128
                        || !line.ends_with(b"\n")
                    {
                        let _ = events.send(Err("MCP_PROTOCOL"));
                        break;
                    }
                    #[cfg(feature = "s33-mcp-verification")]
                    if ["old-run", "old-nonce"].contains(&reader_policy.as_str()) {
                        if let Ok(frame) = serde_json::from_slice::<Frame>(&line) {
                            if frame.kind == "owner" {
                                let mut stale = frame.clone();
                                if reader_policy == "old-run" {
                                    stale.run_id.push_str("-old");
                                } else {
                                    stale.host_nonce.push_str("-old");
                                }
                                let _ = events.send(Ok(stale.clone()));
                                stale.kind = "result".into();
                                stale.body = json!({"catalog":{"tools":[]}});
                                let _ = events.send(Ok(stale));
                            }
                        }
                    }
                    #[cfg(feature = "s33-mcp-verification")]
                    if reader_policy == "duplicate-owner" {
                        if let Ok(frame) = serde_json::from_slice::<Frame>(&line) {
                            if frame.kind == "owner" {
                                let _ = events.send(Ok(frame));
                            }
                        }
                    }
                    if events
                        .send(serde_json::from_slice::<Frame>(&line).map_err(|_| "MCP_PROTOCOL"))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => {
                    let _ = events.send(Err("MCP_PROTOCOL"));
                    break;
                }
            }
        }
    });
    let err_reader = std::thread::spawn(move || {
        let mut reader = stderr.take(8193);
        let mut bytes = Vec::new();
        let _ = reader.read_to_end(&mut bytes);
        if !bytes.is_empty() {
            let _ = errors.send(Err("MCP_PROTOCOL"));
        }
    });
    let mut owner: Option<Owner> = None;
    let mut ended = false;
    let mut prepared = false;
    let mut result = None;
    let mut code = None;
    let mut terminating = None;
    let mut exit_status = None;
    let exit = loop {
        let mut disconnected = false;
        let next = match frames.recv_timeout(Duration::from_millis(20)) {
            Ok(frame) => Some(frame),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                disconnected = true;
                None
            }
            Err(_) => None,
        };
        if let Some(frame) = next {
            let frame = match frame {
                Ok(f) => f,
                Err(e) => {
                    code.get_or_insert(e);
                    continue;
                }
            };
            if frame.run_id != job.run_id || frame.host_nonce != job.nonce {
                continue;
            }
            match frame.kind.as_str() {
                "prepare" if !prepared && owner.is_none() && !ended && terminating.is_none() => {
                    let slot = state.slot.lock().expect("runtime slot");
                    if !slot
                        .as_ref()
                        .is_some_and(|j| j.run_id == job.run_id && j.nonce == job.nonce)
                        || job.cancel.load(Ordering::SeqCst)
                    {
                        code.get_or_insert("MCP_PROCESS");
                        continue;
                    }
                    if let Ok(intent) = serde_json::from_value::<Owner>(frame.body) {
                        if intent.guardian == 0
                            && intent.keeper == 0
                            && intent.run == job.run_id
                            && valid_nonce(&intent.nonce)
                        {
                            *job.mcp_intent.lock().expect("intent lock") =
                                Some(intent.nonce.clone());
                            prepared = true;
                            if ack(&tx, job, "prepare", &intent).is_err() {
                                code.get_or_insert("MCP_PROTOCOL");
                            }
                        } else {
                            code.get_or_insert("MCP_PROTOCOL");
                        }
                    } else {
                        code.get_or_insert("MCP_PROTOCOL");
                    }
                }
                "owner"
                    if prepared
                        && owner.is_none()
                        && !ended
                        && terminating.is_none()
                        && !job.cancel.load(Ordering::SeqCst) =>
                {
                    let slot = state.slot.lock().expect("runtime slot");
                    if !slot
                        .as_ref()
                        .is_some_and(|j| j.run_id == job.run_id && j.nonce == job.nonce)
                        || job.cancel.load(Ordering::SeqCst)
                    {
                        code.get_or_insert("MCP_PROCESS");
                        continue;
                    }
                    let parsed = serde_json::from_value::<Owner>(frame.body);
                    if let Ok(o) = parsed {
                        let guard = process(o.guardian);
                        let keep = process(o.keeper);
                        if o.run == job.run_id
                            && job
                                .mcp_intent
                                .lock()
                                .ok()
                                .is_some_and(|n| n.as_deref() == Some(o.nonce.as_str()))
                            && o.guardian != o.keeper
                            && guard.as_ref().is_some_and(|(parent, group, _)| {
                                *parent == child.id() && *group == o.guardian
                            })
                            && keep.as_ref().is_some_and(|(parent, group, _)| {
                                *parent == o.guardian && *group == o.guardian
                            })
                            && [o.guardian, o.keeper].iter().all(|pid| {
                                process(*pid).is_some_and(|(_, group, command)| {
                                    group == o.guardian
                                        && command.contains(
                                            directory
                                                .join("mcp-guardian.mjs")
                                                .to_string_lossy()
                                                .as_ref(),
                                        )
                                        && command.contains(&format!("--run {} ", o.run))
                                        && command.contains(&format!("--nonce {} ", o.nonce))
                                })
                            })
                        {
                            *job.mcp_owner.lock().expect("owner lock") = Some(o.clone());
                            owner = Some(o.clone());
                            #[cfg(feature = "s33-mcp-verification")]
                            if policy == "cancel-before-ack" {
                                job.cancel.store(true, Ordering::SeqCst);
                            }
                            #[cfg(feature = "s33-mcp-verification")]
                            let skip_ack = policy == "missing-ack" || policy == "cancel-before-ack";
                            #[cfg(not(feature = "s33-mcp-verification"))]
                            let skip_ack = false;
                            if !skip_ack {
                                #[allow(unused_mut)]
                                let mut response_owner = o.clone();
                                #[cfg(feature = "s33-mcp-verification")]
                                if policy == "wrong-ack" {
                                    response_owner.nonce = "wrong-test-nonce".into();
                                }
                                if ack(&tx, job, "owner", &response_owner).is_err() {
                                    code.get_or_insert("MCP_PROTOCOL");
                                }
                            }
                        } else {
                            code.get_or_insert("MCP_PROTOCOL");
                        }
                    } else {
                        code.get_or_insert("MCP_PROTOCOL");
                    }
                }
                "end" if owner.is_some() && !ended => {
                    let parsed = serde_json::from_value::<Owner>(frame.body);
                    if let Ok(o) = parsed {
                        let old = owner.as_ref().expect("owner present");
                        if o.guardian == old.guardian
                            && o.keeper == old.keeper
                            && o.nonce == old.nonce
                            && o.run == old.run
                            && group_gone(o.guardian)
                        {
                            ended = true;
                            *job.mcp_owner.lock().expect("owner lock") = None;
                            *job.mcp_intent.lock().expect("intent lock") = None;
                            if ack(&tx, job, "end", &o).is_err() {
                                code.get_or_insert("MCP_PROTOCOL");
                            }
                        } else {
                            code.get_or_insert("MCP_PROTOCOL");
                        }
                    } else {
                        code.get_or_insert("MCP_PROTOCOL");
                    }
                }
                "result" if ended && result.is_none() && code.is_none() => {
                    match serde_json::from_value::<McpDiscoveredCatalog>(
                        frame.body.get("catalog").cloned().unwrap_or(Value::Null),
                    ) {
                        Ok(c) => {
                            result = Some(c);
                        }
                        Err(_) => {
                            code.get_or_insert("MCP_CATALOG_INVALID");
                        }
                    }
                }
                "error" if result.is_none() => {
                    let c = match frame.body.get("code").and_then(Value::as_str) {
                        Some("MCP_TIMEOUT") => "MCP_TIMEOUT",
                        Some("MCP_CATALOG_INVALID") => "MCP_CATALOG_INVALID",
                        Some("MCP_PRIVATE_OUTPUT") => "MCP_PRIVATE_OUTPUT",
                        Some("MCP_CLEANUP") => "MCP_CLEANUP",
                        _ => "MCP_PROTOCOL",
                    };
                    code.get_or_insert(c);
                }
                _ => {
                    code.get_or_insert("MCP_PROTOCOL");
                }
            }
        }
        if started.elapsed() >= Duration::from_millis(budget_ms) {
            code.get_or_insert("MCP_TIMEOUT");
        }
        if job.cancel.load(Ordering::SeqCst) {
            code.get_or_insert("MCP_PROCESS");
        }
        if code.is_some() && terminating.is_none() {
            terminating = Some(Instant::now());
            shutdown(job, directory);
        }
        if terminating.is_some_and(|t| t.elapsed() > Duration::from_millis(500)) {
            let _ = child.kill();
        }
        if exit_status.is_none() {
            match child.try_wait() {
                Ok(Some(status)) => exit_status = Some(status),
                Ok(None) => {}
                Err(_) => {
                    code.get_or_insert("MCP_PROCESS");
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        if exit_status.is_some() && disconnected {
            break exit_status;
        }
    };
    drop(tx);
    // Drain bounded readers before deciding whether the single result is valid.
    let _ = writer.join();
    loop {
        match frames.recv_timeout(Duration::from_millis(20)) {
            Ok(_) => {
                code.get_or_insert("MCP_PROTOCOL");
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(_) => {
                if reader.is_finished() && err_reader.is_finished() {
                    break;
                }
            }
        }
    }
    if reader.join().is_err() || err_reader.join().is_err() {
        code.get_or_insert("MCP_PROTOCOL");
    }
    job.pid.store(0, Ordering::SeqCst);
    let cleaned = if let Some(owner) = owner.as_ref() {
        reap(owner, directory)
    } else {
        match job.mcp_intent.lock().ok().and_then(|n| n.clone()) {
            None => true,
            Some(nonce) => reap_intent(&job.run_id, &nonce, directory),
        }
    };
    if !cleaned {
        code = Some("MCP_CLEANUP");
    }
    if !ended || exit.is_none_or(|s| !s.success()) {
        code.get_or_insert("MCP_PROCESS");
    }
    if let Some(code) = code {
        (Err(code), cleaned)
    } else {
        (result.ok_or("MCP_PROTOCOL"), cleaned)
    }
}
use std::time::{SystemTime, UNIX_EPOCH};
fn ack(tx: &mpsc::SyncSender<Vec<u8>>, job: &Job, kind: &str, owner: &Owner) -> Result<()> {
    let mut value = serde_json::to_value(owner).map_err(|_| error("MCP_PROTOCOL"))?;
    value["type"] = kind.into();
    value["runId"] = job.run_id.clone().into();
    value["hostNonce"] = job.nonce.clone().into();
    let mut bytes = serde_json::to_vec(&value).map_err(|_| error("MCP_PROTOCOL"))?;
    bytes.push(b'\n');
    tx.try_send(bytes).map_err(|_| error("MCP_PROTOCOL"))
}
#[tauri::command]
pub async fn start_mcp_probe(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    server_id: String,
    expected_revision: String,
) -> Result<McpProbe> {
    let local = local.inner().clone();
    let runtime = runtime.inner().clone();
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| error("MCP_DEPENDENCY_MISSING"))?
        .join("s0-runtime");
    let sink: Sink = Arc::new(move |id, phase| {
        let _ = app.emit("mcp-probe-changed", json!({"id":id,"phase":phase}));
    });
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start_probe(local, directory, server_id, expected_revision, sink)
    })
    .await
    .map_err(|_| error("MCP_PROCESS"))?
}
async fn access<T: Send + 'static>(
    local: &LocalState,
    action: impl FnOnce(&mut AppStore) -> Result<T> + Send + 'static,
) -> Result<T> {
    let local = local.clone();
    tauri::async_runtime::spawn_blocking(move || local.access(action))
        .await
        .map_err(|_| error("MCP_PROCESS"))?
}
#[tauri::command]
pub async fn read_mcp_probe(local: State<'_, LocalState>, id: String) -> Result<McpProbe> {
    access(&local, move |s| s.mcp_probe(&id)).await
}
#[tauri::command]
pub async fn latest_mcp_probe(
    local: State<'_, LocalState>,
    server_id: String,
) -> Result<Option<McpProbe>> {
    access(&local, move |s| s.latest_mcp_probe(&server_id)).await
}
#[tauri::command]
pub async fn read_mcp_catalog(
    local: State<'_, LocalState>,
    id: String,
) -> Result<Option<McpDiscoveredCatalog>> {
    access(&local, move |s| s.read_mcp_catalog(&id)).await
}
#[tauri::command]
pub async fn active_mcp_probe(runtime: State<'_, RuntimeState>) -> Result<Option<String>> {
    Ok(runtime.active_probe())
}
#[tauri::command]
pub async fn cancel_mcp_probe(runtime: State<'_, RuntimeState>, id: String) -> Result<()> {
    let slot = runtime.slot.lock().map_err(|_| error("RUNTIME_BUSY"))?;
    if let Some(j) = slot
        .as_ref()
        .filter(|j| j.kind == JobKind::Probe && j.run_id == id)
    {
        j.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}
