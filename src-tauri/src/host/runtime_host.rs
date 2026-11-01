use crate::local_store::{AgentRun, ModelRun, StoreError, TextInput};
use crate::store_commands::LocalState;
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
pub(crate) type Sink = Arc<dyn Fn(&str, &str) + Send + Sync>;
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum JobKind {
    Business,
    Trial,
    Probe,
}
#[derive(Clone)]
pub(crate) struct Job {
    pub(crate) run_id: String,
    pub(crate) kind: JobKind,
    pub(crate) nonce: String,
    pub(crate) server_id: Option<String>,
    pub(crate) mcp_owner: Arc<Mutex<Option<crate::mcp_host::Owner>>>,
    pub(crate) mcp_intent: Arc<Mutex<Option<String>>>,
    pub(crate) mcp_trial: Arc<Mutex<crate::mcp_trial::TrialState>>,
    pub(crate) cancel: Arc<AtomicBool>,
    pub(crate) pid: Arc<AtomicU32>,
    pub(crate) workers: Arc<Mutex<BTreeMap<u32, String>>>,
}
#[derive(Clone, Default)]
pub struct RuntimeState {
    pub(crate) slot: Arc<Mutex<Option<Job>>>,
    #[cfg(test)]
    pub(crate) trial_policy: Arc<Mutex<Option<&'static str>>>,
    #[cfg(test)]
    pub(crate) trial_events: Arc<Mutex<Vec<Value>>>,
    #[cfg(test)]
    output_diagnostics: Arc<Mutex<Vec<OutputDiagnosticEvent>>>,
    #[cfg(test)]
    output_decode_fault: Arc<AtomicBool>,
    #[cfg(test)]
    output_diagnostic_conflict: Arc<AtomicBool>,
}
#[cfg(test)]
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputDiagnosticEvent {
    run_id: String,
    kind: &'static str,
    stage: &'static str,
    outcome: &'static str,
    code: Option<&'static str>,
}
pub enum StartTask {
    Extract {
        input: TextInput,
        retry: bool,
    },
    Revise {
        id: String,
        version: i64,
        instruction: String,
        time_zone: String,
    },
    Test(Option<String>),
}
fn error(code: &'static str, message: &'static str) -> StoreError {
    StoreError { code, message }
}
fn busy() -> StoreError {
    error("RUNTIME_BUSY", "上一任务仍在运行或退出，请稍后再试。")
}
fn signal_group(pid: u32, signal: &str) {
    if pid > 1 {
        let _ = Command::new("/bin/kill")
            .args([signal, &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
fn owned(pid: u32, script: &Path, run: &str, nonce: Option<&str>) -> bool {
    if pid <= 1 {
        return false;
    }
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output();
    let Ok(output) = output else {
        return false;
    };
    let command = String::from_utf8_lossy(&output.stdout);
    command.contains(script.to_string_lossy().as_ref())
        && command.contains(&format!("--run {run}"))
        && nonce.is_none_or(|n| command.contains(&format!("--nonce {n}")))
}
fn reap_workers(job: &Job, directory: &Path) {
    if let Ok(workers) = job.workers.lock() {
        for (pid, nonce) in workers.iter() {
            if owned(
                *pid,
                &directory.join("bash-worker.mjs"),
                &job.run_id,
                Some(nonce),
            ) {
                signal_group(*pid, "-STOP");
                signal_group(*pid, "-KILL");
            }
        }
    }
}
impl RuntimeState {
    #[cfg(test)]
    fn output_diagnostic_enabled(&self) -> bool {
        *self.trial_policy.lock().expect("controlled policy lock") == Some("mcp-only-diagnostic")
    }
    #[cfg(test)]
    fn record_output_diagnostic(
        &self,
        run_id: &str,
        kind: Option<&'static str>,
        stage: &'static str,
        code: Option<&'static str>,
    ) {
        if !self.output_diagnostic_enabled() {
            return;
        }
        let Some(kind) = kind else {
            return;
        };
        let mut events = self
            .output_diagnostics
            .lock()
            .expect("controlled output lock");
        if events.len() >= 64 {
            events.remove(0);
        }
        events.push(OutputDiagnosticEvent {
            run_id: run_id.into(),
            kind,
            stage,
            outcome: if code.is_some() { "error" } else { "ok" },
            code,
        });
    }
    #[cfg(test)]
    pub(crate) fn test_trial_checkpoint(&self, job: &Job, point: &'static str, detail: Value) {
        let mut events = self
            .trial_events
            .lock()
            .expect("controlled checkpoint lock");
        if events.len() >= 512 {
            events.remove(0);
        }
        events.push(json!({"point":point,"runId":job.run_id,"detail":detail}));
        drop(events);
        let policy = *self.trial_policy.lock().expect("controlled policy lock");
        let hold = match point {
            "before_begin" => Some("hold-before-begin"),
            "after_begin" => Some("hold-after-begin"),
            "before_response" => Some("hold-before-response"),
            "after_response" => Some("hold-after-response"),
            _ => None,
        };
        if hold.is_some() && policy == hold {
            std::thread::sleep(Duration::from_secs(30));
        }
    }
    pub fn active_run(&self) -> Option<String> {
        self.slot
            .lock()
            .ok()
            .and_then(|s| s.as_ref().map(|j| j.run_id.clone()))
    }
    pub fn cancel(&self, id: &str) {
        if let Ok(slot) = self.slot.lock() {
            if let Some(job) = slot.as_ref().filter(|j| j.run_id == id) {
                job.cancel.store(true, Ordering::SeqCst);
            }
        }
    }
    pub fn shutdown(&self, directory: &Path) {
        if let Ok(slot) = self.slot.lock() {
            if let Some(job) = slot.as_ref() {
                job.cancel.store(true, Ordering::SeqCst);
                let pid = job.pid.load(Ordering::SeqCst);
                if job.kind == JobKind::Probe {
                    crate::mcp_host::shutdown(job, directory);
                    return;
                }
                if owned(pid, &directory.join("organizer.mjs"), &job.run_id, None) {
                    signal_group(pid, "-TERM");
                }
                reap_workers(job, directory);
                crate::mcp_trial::cleanup(job, directory);
            }
        }
    }
    pub(crate) fn start(
        &self,
        local: LocalState,
        directory: PathBuf,
        task: StartTask,
        sink: Sink,
    ) -> Result<ModelRun> {
        let preparation_started = Instant::now();
        let mut slot = self.slot.lock().map_err(|_| busy())?;
        if slot.is_some() {
            return Err(busy());
        }
        let (run,payload)=local.access(|store|{
            store.interrupt_unowned_runs()?;
            store.interrupt_agent_trials(None)?;
            let (run,zone)=match task {
                StartTask::Extract{input,retry}=>{let zone=input.time_zone.clone();let batch=store.begin_import(input,Value::Null,retry)?;let run=batch.run.ok_or_else(||error("SOURCE_UNAVAILABLE","无法读取来源任务，请刷新。"))?;if !batch.started{return Ok((run,None));}(run,zone)},
                StartTask::Revise{id,version,instruction,time_zone}=>{if time_zone.is_empty()||time_zone.len()>128{return Err(error("INVALID_TIMEZONE","请填写有效时区。"));}let run=store.begin_revision(&id,version,instruction,Value::Null)?;(run,time_zone)},
                StartTask::Test(model_id)=>{let prepared=store.prepare_connection_model_by_id(model_id.as_deref())?;let run=store.begin_model_test(prepared.snapshot.clone())?;let cwd=store.run_directory(&run.id)?;let payload=json!({"runId":run.id,"kind":"test","snapshot":prepared.snapshot,"apiKey":prepared.api_key,"cwd":cwd,"timeZone":"UTC"});return Ok((run,Some(payload)));},
            };
            let prepared=match store.prepare_model(){Ok(p)=>p,Err(e)=>return Ok((store.finish_run_error(&run.id,e.code)?,None))};
            let mut snapshot=prepared.snapshot;let cwd=store.run_directory(&run.id)?;if snapshot["model"]["capabilities"]["toolCall"]!=false {match crate::skills_host::freeze(&directory,&store.root()?,&cwd){Ok(skills)=>snapshot["skills"]=skills,Err(e)=>return Ok((store.finish_run_error(&run.id,e.code)?,None))};}snapshot["context"]=json!({"timeZone":zone,"instructionAtMs":run.created_at_ms});
            let run=store.bind_run_snapshot(&run.id,snapshot.clone())?;
            let mcp=match crate::mcp_trial::prepare_business(store,&run.id,&directory){Ok(value)=>value,Err(error)=>return Ok((store.finish_run_error(&run.id,error.code)?,None))};
            let run=store.model_run(&run.id)?;
            let snapshot=run.snapshot.clone();
            let source=store.batch(run.source_id.as_deref().ok_or_else(||error("SOURCE_UNAVAILABLE","来源不存在。"))?)?.source;
            let candidate=run.candidate_id.as_ref().map(|id|store.candidate(id)).transpose()?;
            let anchor=if run.kind=="revise"{run.created_at_ms}else{source.anchor_at_ms};
            let cwd=store.run_directory(&run.id)?;
            let payload=json!({"runId":run.id,"kind":run.kind,"snapshot":snapshot,"mcp":mcp,"apiKey":prepared.api_key,"cwd":cwd,"runLimitMs":120000_u64.saturating_sub(preparation_started.elapsed().as_millis() as u64).max(1),"anchorAtMs":anchor,"source":{"rawText":source.raw_text,"timeZone":zone},"candidate":candidate,"instruction":run.input["instruction"]});
            Ok((run,Some(payload)))
        })?;
        let Some(payload) = payload else {
            sink(&run.id, "changed");
            return Ok(run);
        };
        let job = Job {
            run_id: run.id.clone(),
            kind: JobKind::Business,
            nonce: crate::mcp_host::nonce(),
            server_id: None,
            mcp_owner: Arc::new(Mutex::new(None)),
            mcp_intent: Arc::new(Mutex::new(None)),
            mcp_trial: Arc::new(Mutex::new(crate::mcp_trial::TrialState::from_payload(
                &payload,
            ))),
            cancel: Arc::new(AtomicBool::new(false)),
            pid: Arc::new(AtomicU32::new(0)),
            workers: Arc::new(Mutex::new(BTreeMap::new())),
        };
        *slot = Some(job.clone());
        self.launch(local, directory, job, payload, sink.clone());
        drop(slot);
        sink(&run.id, "started");
        Ok(run)
    }
    fn launch(&self, local: LocalState, directory: PathBuf, job: Job, payload: Value, sink: Sink) {
        let state = self.clone();
        let id = job.run_id.clone();
        let worker_sink = sink.clone();
        #[cfg(test)]
        let diagnostic_kind = match payload["kind"].as_str() {
            Some("extract") => Some("extract"),
            Some("revise") => Some("revise"),
            Some("trial") => Some("trial"),
            _ => None,
        };
        std::thread::spawn(move || {
            let mut result = execute(
                &job,
                &directory,
                payload,
                worker_sink.clone(),
                &local,
                &state,
            );
            let cleaned = crate::mcp_trial::cleanup(&job, &directory);
            if !cleaned {
                result = Err("MCP_CLEANUP".into());
            }
            #[cfg(test)]
            state.record_output_diagnostic(
                &id,
                diagnostic_kind,
                "runtime-result",
                result.as_ref().err().map(|code| {
                    if code == "MODEL_INVALID_OUTPUT" {
                        "MODEL_INVALID_OUTPUT"
                    } else {
                        "RUNTIME_REJECTED"
                    }
                }),
            );
            #[cfg(test)]
            if state.output_diagnostic_enabled()
                && result.is_ok()
                && state.output_decode_fault.swap(false, Ordering::SeqCst)
            {
                if let Ok(value) = result.as_mut() {
                    match diagnostic_kind {
                        Some("extract" | "trial") => value["candidates"] = Value::Null,
                        Some("revise") => value["preview"] = Value::Null,
                        _ => {}
                    }
                }
            }
            let stored = local.access(|store| {
                if job.kind == JobKind::Trial {
                    if job.cancel.load(Ordering::SeqCst) {
                        store.cancel_agent_trial(&id)?;
                    } else {
                        match result {
                            Ok(value) => {
                                let decoded = serde_json::from_value(
                                    value.get("candidates").cloned().unwrap_or(Value::Null),
                                )
                                .map_err(|_| error("MODEL_INVALID_OUTPUT", "试跑结果格式不正确。"));
                                #[cfg(test)]
                                state.record_output_diagnostic(
                                    &id,
                                    diagnostic_kind,
                                    "rust-decode",
                                    decoded.as_ref().err().map(|_| "MODEL_INVALID_OUTPUT"),
                                );
                                let applied = decoded.and_then(|drafts| {
                                    let published = store.complete_agent_trial(&id, drafts);
                                    #[cfg(test)]
                                    state.record_output_diagnostic(
                                        &id,
                                        diagnostic_kind,
                                        "rust-publish",
                                        published.as_ref().err().map(|_| "STORE_REJECTED"),
                                    );
                                    published
                                });
                                if let Err(e) = applied {
                                    store.finish_agent_trial_error(&id, e.code)?;
                                }
                            }
                            Err(code) => {
                                store.finish_agent_trial_error(&id, &code)?;
                            }
                        }
                    }
                    return Ok(());
                }
                if job.cancel.load(Ordering::SeqCst) {
                    store.cancel_run(&id)?;
                    return Ok(());
                }
                match result {
                    Ok(value) => {
                        let run = store.model_run(&id)?;
                        let applied = match run.kind.as_str() {
                            "extract" => {
                                let decoded = serde_json::from_value(
                                    value.get("candidates").cloned().unwrap_or(Value::Null),
                                )
                                .map_err(|_| error("MODEL_INVALID_OUTPUT", "整理结果格式不正确。"));
                                #[cfg(test)]
                                state.record_output_diagnostic(
                                    &id,
                                    diagnostic_kind,
                                    "rust-decode",
                                    decoded.as_ref().err().map(|_| "MODEL_INVALID_OUTPUT"),
                                );
                                decoded.and_then(|drafts| {
                                    let published =
                                        store.publish_candidates(&id, drafts).map(|_| ());
                                    #[cfg(test)]
                                    state.record_output_diagnostic(
                                        &id,
                                        diagnostic_kind,
                                        "rust-publish",
                                        published.as_ref().err().map(|_| "STORE_REJECTED"),
                                    );
                                    published
                                })
                            }
                            "revise" => {
                                let decoded = serde_json::from_value(
                                    value.get("preview").cloned().unwrap_or(Value::Null),
                                )
                                .map_err(|_| error("MODEL_INVALID_OUTPUT", "修改预览格式不正确。"));
                                #[cfg(test)]
                                state.record_output_diagnostic(
                                    &id,
                                    diagnostic_kind,
                                    "rust-decode",
                                    decoded.as_ref().err().map(|_| "MODEL_INVALID_OUTPUT"),
                                );
                                decoded.and_then(|draft| {
                                    let published = store.publish_revision(&id, draft).map(|_| ());
                                    #[cfg(test)]
                                    state.record_output_diagnostic(
                                        &id,
                                        diagnostic_kind,
                                        "rust-publish",
                                        published.as_ref().err().map(|_| "STORE_REJECTED"),
                                    );
                                    published
                                })
                            }
                            "test" if value.get("ok") == Some(&Value::Bool(true)) => {
                                store.finish_model_test(&id).map(|_| ())
                            }
                            _ => Err(error("RUNTIME_PROTOCOL", "整理进程返回了不匹配的结果。")),
                        };
                        if let Err(e) = applied {
                            store.finish_run_error(&id, e.code)?;
                        }
                    }
                    Err(code) => {
                        store.finish_run_error(&id, &code)?;
                    }
                }
                Ok(())
            });
            reap_workers(&job, &directory);
            job.pid.store(0, Ordering::SeqCst);
            if let Ok(mut slot) = state.slot.lock() {
                let settled = stored.is_ok()
                    || job
                        .mcp_trial
                        .lock()
                        .is_ok_and(|trial| trial.servers.is_empty());
                if cleaned && settled && slot.as_ref().is_some_and(|j| j.run_id == id) {
                    *slot = None;
                }
            }
            worker_sink(
                &id,
                if stored.is_ok() {
                    "changed"
                } else {
                    "storage_error"
                },
            );
        });
    }
    pub fn active_trial(&self) -> Option<String> {
        self.slot.lock().ok().and_then(|s| {
            s.as_ref()
                .filter(|j| j.kind == JobKind::Trial)
                .map(|j| j.run_id.clone())
        })
    }
    pub fn active_business(&self) -> Option<String> {
        self.slot.lock().ok().and_then(|s| {
            s.as_ref()
                .filter(|j| j.kind == JobKind::Business)
                .map(|j| j.run_id.clone())
        })
    }
    pub(crate) fn start_trial(
        &self,
        local: LocalState,
        directory: PathBuf,
        agent_id: &str,
        input: TextInput,
        sink: Sink,
    ) -> Result<AgentRun> {
        let preparation_started = Instant::now();
        let mut slot = self.slot.lock().map_err(|_| busy())?;
        if slot.is_some() {
            return Err(busy());
        }
        if agent_id != "organizer" {
            return Err(error(
                "AGENT_TRIAL_UNAVAILABLE",
                "当前仅事项整理支持试跑，另外两个角色可保存配置。",
            ));
        }
        let (run, payload) = local.access(|store| {
            store.interrupt_unowned_runs()?;
            store.interrupt_agent_trials(None)?;
            let prepared = store.prepare_agent_model(agent_id)?;
            let mut run = store.begin_prepared_agent_trial(agent_id, input, prepared.snapshot)?;
            let cwd = store.run_directory(&run.id)?;
            if run.snapshot["model"]["capabilities"]["toolCall"] != false {
                match crate::skills_host::freeze(&directory, &store.root()?, &cwd) {
                    Ok(skills) => run = store.bind_trial_skills(&run.id, skills)?,
                    Err(error) => return Ok((store.finish_agent_trial_error(&run.id, error.code)?, None)),
                }
            }
            let mcp = match crate::mcp_trial::prepare(store, &run.id, &directory) {
                Ok(value) => value,
                Err(error) => return Ok((store.finish_agent_trial_error(&run.id, error.code)?, None)),
            };
            run = store.agent_run(&run.id)?;
            let payload = json!({"runId":run.id,"kind":"trial","snapshot":run.snapshot,"mcp":mcp,"apiKey":prepared.api_key,"cwd":cwd,"runLimitMs":120000_u64.saturating_sub(preparation_started.elapsed().as_millis() as u64).max(1),"anchorAtMs":run.input.source_at_ms.unwrap_or(run.created_at_ms),"source":{"rawText":run.input.text,"timeZone":run.input.time_zone}});
            Ok((run, Some(payload)))
        })?;
        let Some(payload) = payload else {
            sink(&run.id, "changed");
            return Ok(run);
        };
        let job = Job {
            run_id: run.id.clone(),
            kind: JobKind::Trial,
            nonce: crate::mcp_host::nonce(),
            server_id: None,
            mcp_owner: Arc::new(Mutex::new(None)),
            mcp_intent: Arc::new(Mutex::new(None)),
            mcp_trial: Arc::new(Mutex::new(crate::mcp_trial::TrialState::from_payload(
                &payload,
            ))),
            cancel: Arc::new(AtomicBool::new(false)),
            pid: Arc::new(AtomicU32::new(0)),
            workers: Arc::new(Mutex::new(BTreeMap::new())),
        };
        *slot = Some(job.clone());
        self.launch(local, directory, job, payload, sink.clone());
        drop(slot);
        sink(&run.id, "started");
        Ok(run)
    }
}
fn execute(
    job: &Job,
    directory: &Path,
    mut payload: Value,
    sink: Sink,
    local: &LocalState,
    state: &RuntimeState,
) -> std::result::Result<Value, String> {
    #[cfg(test)]
    if *state.trial_policy.lock().map_err(|_| "RUNTIME_PROTOCOL")? == Some("short-io") {
        payload["runLimitMs"] = 1000.into();
    }
    #[cfg(test)]
    {
        let policy = *state.trial_policy.lock().map_err(|_| "RUNTIME_PROTOCOL")?;
        if matches!(policy, Some("mcp-only" | "mcp-only-diagnostic")) {
            payload["verificationMcpOnly"] = true.into();
        }
        if policy == Some("mcp-only-diagnostic") {
            payload["verificationOutputDiagnostics"] = true.into();
            if state
                .output_diagnostic_conflict
                .swap(false, Ordering::SeqCst)
            {
                use std::os::unix::fs::OpenOptionsExt;
                let path = Path::new(payload["cwd"].as_str().ok_or("RUNTIME_PROTOCOL")?)
                    .join("output-diagnostic.json");
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(path)
                    .map_err(|_| "RUNTIME_PROTOCOL")?;
                file.write_all(b"controlled-existing-diagnostic\n")
                    .map_err(|_| "RUNTIME_PROTOCOL")?;
                file.sync_all().map_err(|_| "RUNTIME_PROTOCOL")?;
            }
        }
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    if let Some(pin) = local.native_model_pin() {
        payload["verificationNativeModel"] = pin;
        if payload["kind"] != "test" {
            payload["verificationMcpOnly"] = true.into();
        }
    }
    payload["hostNonce"] = job.nonce.clone().into();
    let mut mcp = crate::mcp_trial::TrialControl::new(job, directory, local, &payload);
    let mut command = Command::new(directory.join("node"));
    command
        .arg(directory.join("organizer.mjs"))
        .args(["--run", &job.run_id])
        .current_dir(payload["cwd"].as_str().ok_or("RUNTIME_PROTOCOL")?)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("TMPDIR", payload["cwd"].as_str().ok_or("RUNTIME_PROTOCOL")?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    let mut child = command.spawn().map_err(|_| "RUNTIME_START".to_string())?;
    job.pid.store(child.id(), Ordering::SeqCst);
    #[cfg(test)]
    state.test_trial_checkpoint(job, "runtime_started", json!({"pid":child.id()}));
    let run_limit = Duration::from_millis(
        payload["runLimitMs"]
            .as_u64()
            .unwrap_or(120000)
            .clamp(1, 120000),
    );
    let mut bytes = serde_json::to_vec(&payload).map_err(|_| "RUNTIME_PROTOCOL")?;
    drop(payload);
    bytes.push(b'\n');
    let (writer_tx, writer_rx) = mpsc::sync_channel::<Vec<u8>>(4);
    let mut stdin = child.stdin.take().ok_or("RUNTIME_START")?;
    let writer = std::thread::spawn(move || {
        for bytes in writer_rx {
            if stdin.write_all(&bytes).is_err() {
                return false;
            }
        }
        true
    });
    if bytes.len() > 1600000 || writer_tx.try_send(bytes).is_err() {
        let _ = child.kill();
        let _ = child.wait();
        drop(writer_tx);
        let _ = writer.join();
        return Err("RUNTIME_PROTOCOL".into());
    }
    let stdout = child.stdout.take().ok_or("RUNTIME_START")?;
    let stderr = child.stderr.take().ok_or("RUNTIME_START")?;
    let (send, receive) = mpsc::sync_channel(8);
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut total = 0;
        let mut frames = 0;
        loop {
            let mut line = Vec::new();
            let n = reader.by_ref().take(1_200_001).read_until(b'\n', &mut line);
            match n {
                Ok(0) => break,
                Ok(n) => {
                    total += n;
                    frames += 1;
                    if n > 1_200_000 || total > 2_000_000 || frames > 512 || !line.ends_with(b"\n")
                    {
                        let _ = send.send(Err(()));
                        break;
                    }
                    let frame = serde_json::from_slice::<Value>(&line).map_err(|_| ());
                    if send.send(frame).is_err() {
                        break;
                    }
                }
                Err(_) => {
                    let _ = send.send(Err(()));
                    break;
                }
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let _ = std::io::copy(&mut stderr.take(262144), &mut std::io::sink());
    });
    let started = Instant::now();
    let mut cancelled_at = None;
    let mut result = None;
    let mut failure = None;
    let mut finished = false;
    loop {
        if started.elapsed() > run_limit && failure.is_none() {
            failure = Some("MODEL_TIMEOUT".to_string());
        }
        if job.cancel.load(Ordering::SeqCst) || failure.is_some() {
            if cancelled_at.is_none() {
                let mut cancel = serde_json::to_vec(
                    &json!({"type":"cancel","runId":job.run_id,"hostNonce":job.nonce}),
                )
                .unwrap_or_default();
                cancel.push(b'\n');
                let _ = writer_tx.try_send(cancel);
                cancelled_at = Some(Instant::now());
            }
            if cancelled_at.is_some_and(|at| at.elapsed() > Duration::from_millis(500)) {
                signal_group(child.id(), "-STOP");
                signal_group(child.id(), "-KILL");
                reap_workers(job, directory);
                crate::mcp_trial::cleanup(job, directory);
            }
        }
        match receive.recv_timeout(Duration::from_millis(40)) {
            Ok(Ok(frame)) => {
                if frame["runId"].as_str() != Some(&job.run_id) {
                    failure = Some("RUNTIME_PROTOCOL".into());
                    continue;
                }
                match frame["type"].as_str() {
                    Some("mcp") if failure.is_none() || frame["action"] == "end" => {
                        if let Err(code) = mcp.handle(&frame, child.id(), state, &writer_tx) {
                            failure.get_or_insert(code);
                        }
                    }
                    Some("progress") => {
                        if let Some(phase) = frame["phase"]
                            .as_str()
                            .filter(|p| ["model", "tool"].contains(p))
                        {
                            sink(&job.run_id, phase);
                        } else {
                            failure = Some("RUNTIME_PROTOCOL".into());
                        }
                    }
                    Some("worker") => {
                        if let (Some(pid), Some(nonce), Some(action)) = (
                            frame["pid"]
                                .as_u64()
                                .filter(|p| *p > 1 && *p <= u32::MAX as u64),
                            frame["nonce"].as_str().filter(|n| {
                                n.len() <= 128
                                    && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                            }),
                            frame["action"].as_str(),
                        ) {
                            if let Ok(mut workers) = job.workers.lock() {
                                if action == "start" {
                                    workers.insert(pid as u32, nonce.into());
                                } else if action == "end" {
                                    workers.remove(&(pid as u32));
                                } else {
                                    failure = Some("RUNTIME_PROTOCOL".into());
                                }
                            }
                        } else {
                            failure = Some("RUNTIME_PROTOCOL".into());
                        }
                    }
                    Some("result") if result.is_none() && failure.is_none() => {
                        if crate::mcp_trial::ended(job) {
                            result = frame.get("data").cloned();
                        } else {
                            failure = Some("MCP_CLEANUP".into());
                        }
                    }
                    Some("error") if result.is_none() => {
                        failure.get_or_insert(
                            frame["code"]
                                .as_str()
                                .filter(|c| {
                                    c.len() <= 64
                                        && c.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
                                })
                                .unwrap_or("RUNTIME_PROTOCOL")
                                .to_string(),
                        );
                    }
                    _ => failure = Some("RUNTIME_PROTOCOL".into()),
                }
            }
            Ok(Err(())) => failure = Some("RUNTIME_PROTOCOL".into()),
            Err(mpsc::RecvTimeoutError::Disconnected) => finished = true,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if let Some(status) = child.try_wait().map_err(|_| "RUNTIME_EXIT".to_string())? {
            if !status.success() && failure.is_none() {
                failure = Some("RUNTIME_EXIT".into());
            }
            if finished {
                break;
            }
        }
    }
    let _ = child.wait();
    drop(writer_tx);
    if !matches!(writer.join(), Ok(true)) {
        failure.get_or_insert("RUNTIME_PROTOCOL".into());
    }
    let _ = reader.join();
    let _ = errors.join();
    if job.cancel.load(Ordering::SeqCst) {
        return Err("CANCELLED".into());
    }
    if let Some(error) = failure {
        return Err(error);
    }
    result.ok_or_else(|| "RUNTIME_PROTOCOL".into())
}
fn sink(app: tauri::AppHandle) -> Sink {
    Arc::new(move |id, phase| {
        let _ = app.emit("organizer-changed", json!({"runId":id,"phase":phase}));
    })
}
async fn start(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    task: StartTask,
) -> Result<ModelRun> {
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| error("RUNTIME_START", "无法定位随包Runtime。"))?
        .join("s0-runtime");
    let local = local.inner().clone();
    let runtime = runtime.inner().clone();
    let sink = sink(app);
    tauri::async_runtime::spawn_blocking(move || runtime.start(local, directory, task, sink))
        .await
        .map_err(|_| error("RUNTIME_START", "整理任务未能启动，请重试。"))?
}
#[tauri::command]
pub async fn organize_text(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    input: TextInput,
    retry: bool,
) -> Result<ModelRun> {
    start(app, local, runtime, StartTask::Extract { input, retry }).await
}
#[tauri::command]
pub async fn revise_candidate(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    candidate_id: String,
    expected_version: i64,
    instruction: String,
    time_zone: String,
) -> Result<ModelRun> {
    start(
        app,
        local,
        runtime,
        StartTask::Revise {
            id: candidate_id,
            version: expected_version,
            instruction,
            time_zone,
        },
    )
    .await
}
#[tauri::command]
pub async fn test_model(
    model_id: Option<String>,
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
) -> Result<ModelRun> {
    start(app, local, runtime, StartTask::Test(model_id)).await
}
#[tauri::command]
pub async fn active_model_run(runtime: State<'_, RuntimeState>) -> Result<Option<String>> {
    Ok(runtime.active_business())
}

#[tauri::command]
pub async fn start_agent_trial(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    agent_id: String,
    input: TextInput,
) -> Result<AgentRun> {
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| error("RUNTIME_START", "无法定位随包Runtime。"))?
        .join("s0-runtime");
    let state = runtime.inner().clone();
    let local = local.inner().clone();
    let sink: Sink = Arc::new(move |id, phase| {
        let _ = app.emit("agent-trial-changed", json!({"runId":id,"phase":phase}));
    });
    tauri::async_runtime::spawn_blocking(move || {
        state.start_trial(local, directory, &agent_id, input, sink)
    })
    .await
    .map_err(|_| error("RUNTIME_START", "试跑启动中断，请重试。"))?
}
#[tauri::command]
pub async fn active_agent_trial(runtime: State<'_, RuntimeState>) -> Result<Option<String>> {
    Ok(runtime.active_trial())
}

#[cfg(test)]
#[path = "mcp_recovery_tests.rs"]
mod mcp_recovery_tests;

#[cfg(test)]
#[path = "mcp_formal_tests.rs"]
mod mcp_formal_tests;

#[cfg(test)]
#[path = "mcp_trial_tests.rs"]
mod mcp_trial_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::{LinkTarget, ModelConfigInput, SignChoice};
    use apple_native_keyring_store::keychain::Store;
    use keyring_core::api::CredentialStoreApi;
    use sha2::{Digest, Sha256};
    struct Cleanup {
        root: PathBuf,
        service: String,
        references: Vec<String>,
    }
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Ok(store) = Store::new() {
                for reference in &self.references {
                    if let Ok(entry) = store.build(&self.service, reference, None) {
                        let _ = entry.delete_credential();
                    }
                }
            }
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    fn wait(state: &RuntimeState) {
        let started = Instant::now();
        while state.active_run().is_some() {
            assert!(
                started.elapsed() < Duration::from_secs(130),
                "controlled runtime did not finish"
            );
            std::thread::sleep(Duration::from_millis(30));
        }
    }
    #[test]
    #[ignore = "explicit real model integration using the owner-selected private file"]
    fn s2_live_text_preview_sign_and_restart() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let directory = manifest.join("../build/s0-runtime").canonicalize().unwrap();
        let env_file = std::env::var("SIDEKICK_MODEL_ENV")
            .expect("set the selected private environment file path");
        let output=Command::new(directory.join("node")).args(["-e","process.loadEnvFile(process.argv[1]);process.stdout.write(JSON.stringify({key:process.env.DEEPSEEK_API_KEY,url:process.env.DEEPSEEK_BASE_URL,model:process.env.DEEPSEEK_MODEL_ID}))",&env_file]).env_clear().env("PATH","/usr/bin:/bin").output().unwrap();
        assert!(output.status.success());
        let private: Value = serde_json::from_slice(&output.stdout).unwrap();
        let root = std::env::temp_dir().join(format!(
            "sidekick-s2-live-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let local = LocalState::new(root.join("app"));
        let workspace = local
            .access(|store| store.initialize(Some(root.join("workspace")), "Asia/Shanghai"))
            .unwrap();
        let app_dir = root.join("app").canonicalize().unwrap();
        let canonical_root = PathBuf::from(workspace.root.unwrap());
        let service = format!(
            "com.sidekick.credentials.{:x}",
            Sha256::digest(
                format!("{}\0{}", app_dir.display(), canonical_root.display()).as_bytes()
            )
        );
        let mut cleanup = Cleanup {
            root: root.clone(),
            service,
            references: vec![],
        };
        let saved=local.access(|store|store.save_models(ModelConfigInput{expected_revision:None,
            providers:json!({"providers":[{"id":"live","name":"Real model integration","apiFormat":"openai-compatible","baseUrl":private["url"],"auth":{"type":"bearer","apiKeyEnv":"UNUSED_FIXTURE_ENV"},"extraHeaders":{},"network":{"timeoutMs":120000,"retry":{"maxRetries":0,"backoff":"exponential"}},"enabled":true}]}),
            models:json!({"models":[{"id":"s2-logical-model","name":"Real integration","providerId":"live","apiModelId":private["model"],"capabilities":{"toolCall":true,"input":["text"]}}]}),default_model_id:"s2-logical-model".into(),api_keys:std::collections::BTreeMap::from([("live".into(),private["key"].as_str().unwrap().into())])
        })).unwrap();
        cleanup.references.push(
            saved.configuration.providers["providers"][0]["auth"]["apiKeyRef"]
                .as_str()
                .unwrap()
                .into(),
        );
        assert!(!serde_json::to_string(&saved)
            .unwrap()
            .contains(private["key"].as_str().unwrap()));
        let state = RuntimeState::default();
        let sink: Sink = Arc::new(|_, _| {});
        let input=TextInput{text:"接入评审纪要（合成验收材料）\n我负责整理接入清单，下周五17点前交付。\n林川负责修复SDK鉴权，本周五16点交付，我今天15点跟进。\n我确认试用名单，时间待定。".into(),source_at_ms:Some(1793239200000),time_zone:"Asia/Shanghai".into()};
        let run = state
            .start(
                local.clone(),
                directory.clone(),
                StartTask::Extract {
                    input: input.clone(),
                    retry: false,
                },
                sink.clone(),
            )
            .unwrap();
        wait(&state);
        let batch = local
            .access(|s| s.batch(run.source_id.as_ref().unwrap()))
            .unwrap();
        assert_eq!(
            batch.run.as_ref().unwrap().status,
            "succeeded",
            "safe error category: {:?}",
            batch.run.as_ref().unwrap().error_code
        );
        assert!(batch.candidates.len() >= 3);
        assert!(local.access(|s| s.list()).unwrap().is_empty());
        let action = batch
            .candidates
            .iter()
            .find(|c| c.draft.fields.kind == "action" && c.draft.fields.due.is_some())
            .unwrap();
        let follow = batch
            .candidates
            .iter()
            .find(|c| c.draft.fields.kind == "followup")
            .unwrap();
        assert_ne!(follow.draft.fields.due, follow.draft.fields.followup);
        let revised = state
            .start(
                local.clone(),
                directory.clone(),
                StartTask::Revise {
                    id: action.id.clone(),
                    version: action.version,
                    instruction: "只把标题改成“补充模型网关接入说明”，其他字段和时间都保持不变。"
                        .into(),
                    time_zone: "Asia/Shanghai".into(),
                },
                sink.clone(),
            )
            .unwrap();
        wait(&state);
        let preview = local.access(|s| s.model_run(&revised.id)).unwrap();
        assert_eq!(
            preview.status, "succeeded",
            "safe error category: {:?}",
            preview.error_code
        );
        assert_eq!(
            preview.preview.as_ref().unwrap().fields.title,
            "补充模型网关接入说明"
        );
        assert_eq!(
            preview.preview.as_ref().unwrap().fields.due,
            action.draft.fields.due
        );
        let action = local
            .access(|s| s.apply_preview(&revised.id, action.version, "live-preview"))
            .unwrap();
        let discarded = batch
            .candidates
            .iter()
            .find(|c| c.id != action.id && c.id != follow.id)
            .unwrap();
        local
            .access(|s| s.discard_candidate(&discarded.id, discarded.version, "live-discard"))
            .unwrap();
        let mut existing = follow.draft.fields.clone();
        existing.title = "已有SDK跟踪事项".into();
        let target = local
            .access(|s| {
                let todo = s.create(existing, "live-existing")?;
                s.set_completed(&todo.id, todo.version, true, "live-existing-complete")
            })
            .unwrap();
        let choices = vec![
            SignChoice {
                candidate_id: action.id.clone(),
                expected_version: action.version,
                fields: action.draft.fields.clone(),
                time_reviewed: true,
                target: None,
            },
            SignChoice {
                candidate_id: follow.id.clone(),
                expected_version: follow.version,
                fields: follow.draft.fields.clone(),
                time_reviewed: true,
                target: Some(LinkTarget {
                    id: target.id.clone(),
                    expected_version: target.version,
                }),
            },
        ];
        let signed = local
            .access(|s| s.sign_candidates(choices.clone(), "live-sign"))
            .unwrap();
        assert_eq!(signed.len(), 2);
        assert_eq!(
            local.access(|s| s.get(&target.id)).unwrap().fields,
            target.fields
        );
        assert_eq!(
            local.access(|s| s.get(&target.id)).unwrap().status,
            "completed"
        );
        let created = signed.iter().find(|t| t.id != target.id).unwrap();
        local
            .access(|s| s.set_completed(&created.id, created.version, true, "live-complete"))
            .unwrap();
        let before = local.access(|s| s.list()).unwrap();
        assert_eq!(before.len(), 2);
        assert_eq!(
            local
                .access(|s| s.sign_candidates(choices, "live-sign"))
                .unwrap()
                .iter()
                .find(|t| t.id == created.id)
                .unwrap()
                .status,
            "completed"
        );
        let duplicate = state
            .start(
                local.clone(),
                directory.clone(),
                StartTask::Extract {
                    input,
                    retry: false,
                },
                sink,
            )
            .unwrap();
        assert_eq!(duplicate.id, run.id);
        assert!(state.active_run().is_none());
        drop(local);
        std::thread::sleep(Duration::from_millis(30));
        let reopened = LocalState::new(root.join("app"));
        assert_eq!(reopened.access(|s| s.list()).unwrap(), before);
        assert_eq!(
            reopened
                .access(|s| s.batch(run.source_id.as_ref().unwrap()))
                .unwrap()
                .candidates
                .iter()
                .filter(|c| c.status == "discarded")
                .count(),
            1
        );
        println!(
            "S2_LIVE {}",
            json!({"status":"passed","modelId":private["model"],"candidateCount":batch.candidates.len(),"unsignedCandidateWrites":0,"beforeSignIncludingManualTarget":1,"afterSign":2,"revisionPreview":true,"linkedWithoutOverwrite":true,"duplicateIdempotent":true,"restartEqual":true,"isolatedWorkspace":true,"keychainCredential":true})
        );
        drop(reopened);
        drop(cleanup);
    }
    #[test]
    #[ignore = "explicit real model trial using the owner-selected private file"]
    fn s31_live_isolated_organizer_trial_and_configuration_reopen() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../build/s0-runtime")
            .canonicalize()
            .unwrap();
        let env_file =
            std::env::var("SIDEKICK_MODEL_ENV").expect("set selected private configuration path");
        let output=Command::new(directory.join("node")).args(["-e","process.loadEnvFile(process.argv[1]);process.stdout.write(JSON.stringify({key:process.env.DEEPSEEK_API_KEY,url:process.env.DEEPSEEK_BASE_URL,model:process.env.DEEPSEEK_MODEL_ID}))",&env_file]).env_clear().env("PATH","/usr/bin:/bin").output().unwrap();
        assert!(output.status.success());
        let private: Value = serde_json::from_slice(&output.stdout).unwrap();
        let root = std::env::temp_dir().join(format!(
            "sidekick-s31-live-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let local = LocalState::new(root.join("app"));
        let workspace = local
            .access(|s| s.initialize(Some(root.join("workspace")), "Asia/Shanghai"))
            .unwrap();
        let service = format!(
            "com.sidekick.credentials.{:x}",
            Sha256::digest(
                format!(
                    "{}\0{}",
                    root.join("app").canonicalize().unwrap().display(),
                    PathBuf::from(workspace.root.unwrap()).display()
                )
                .as_bytes()
            )
        );
        let mut cleanup = Cleanup {
            root: root.clone(),
            service,
            references: vec![],
        };
        let saved=local.access(|s|s.save_models(ModelConfigInput{expected_revision:None,providers:json!({"providers":[{"id":"live","apiFormat":"openai-compatible","baseUrl":private["url"],"auth":{"type":"bearer","apiKeyEnv":"UNUSED"},"enabled":true,"network":{"timeoutMs":120000,"retry":{"maxRetries":0}}}]}),models:json!({"models":[{"id":"global-decoy","providerId":"live","apiModelId":"deliberately-unused-default"},{"id":"trial-override","providerId":"live","apiModelId":private["model"],"capabilities":{"toolCall":true,"input":["text"]}}]}),default_model_id:"global-decoy".into(),api_keys:std::collections::BTreeMap::from([("live".into(),private["key"].as_str().unwrap().into())])})).unwrap();
        cleanup.references.push(
            saved.configuration.providers["providers"][0]["auth"]["apiKeyRef"]
                .as_str()
                .unwrap()
                .into(),
        );
        let mut configs = vec![];
        for id in crate::local_store::AGENT_IDS {
            let c = local.access(|s| s.agent_config(id)).unwrap();
            configs.push(
                local
                    .access(|s| {
                        s.save_agent_config(crate::local_store::AgentConfigInput {
                            agent_id: id.into(),
                            expected_revision: c.revision,
                            model_id: if id == "organizer" {
                                Some("trial-override".into())
                            } else {
                                None
                            },
                            preferences: crate::local_store::AgentPreferences {
                                detail: "concise".into(),
                                focus: c.preferences.focus,
                            },
                            supplemental_instructions: if id == "organizer" {
                                "为每条候选添加标签“S31试跑”。".into()
                            } else {
                                "合成角色偏好，仅测试配置恢复。".into()
                            },
                        })
                    })
                    .unwrap()
                    .configuration,
            );
        }
        let before = local
            .access(|s| {
                let todo = s.create(
                    crate::local_store::TodoInput {
                        title: "试跑前的正式事项".into(),
                        kind: "action".into(),
                        owner: "我".into(),
                        priority: "medium".into(),
                        due: None,
                        followup: None,
                        tags: vec![],
                    },
                    "s31-existing",
                )?;
                Ok((
                    s.list()?,
                    serde_json::to_value(s.history(&todo.id)?).unwrap(),
                ))
            })
            .unwrap();
        let state = RuntimeState::default();
        let run=state.start_trial(local.clone(),directory,"organizer",TextInput{text:"合成试跑材料：\n我负责整理接入清单，下周五17点前交付。\n林川负责修复SDK鉴权，本周五16点交付，我今天15点跟进。\n我确认试用名单，时间待定。".into(),source_at_ms:Some(1793239200000),time_zone:"Asia/Shanghai".into()},Arc::new(|_,_|{})).unwrap();
        assert!(state.active_business().is_none());
        assert_eq!(run.snapshot["modelId"], "trial-override");
        assert_eq!(run.snapshot["agent"]["revision"], configs[0].revision);
        assert_eq!(
            state
                .start_trial(
                    local.clone(),
                    PathBuf::new(),
                    "organizer",
                    run.input.clone(),
                    Arc::new(|_, _| {})
                )
                .unwrap_err()
                .code,
            "RUNTIME_BUSY"
        );
        wait(&state);
        let completed = local.access(|s| s.agent_run(&run.id)).unwrap();
        assert_eq!(
            completed.status, "succeeded",
            "safe category: {:?}",
            completed.error_code
        );
        let results = completed.result.as_ref().unwrap();
        assert!(results.len() >= 3);
        assert!(results
            .iter()
            .all(|c| c.fields.tags.iter().any(|t| t == "S31试跑")));
        assert_eq!(local.access(|s| s.list()).unwrap(), before.0);
        assert_eq!(
            local
                .access(|s| Ok(serde_json::to_value(s.history(&before.0[0].id)?).unwrap()))
                .unwrap(),
            before.1
        );
        assert!(local.access(|s| s.list_batches()).unwrap().is_empty());
        drop(local);
        let reopened = LocalState::new(root.join("app"));
        for c in &configs {
            assert_eq!(
                reopened.access(|s| s.agent_config(&c.agent_id)).unwrap(),
                *c
            )
        }
        assert_eq!(
            reopened.access(|s| s.agent_run(&run.id)).unwrap().status,
            "succeeded"
        );
        assert_eq!(reopened.access(|s| s.list()).unwrap(), before.0);
        println!(
            "S31_LIVE {}",
            json!({"status":"passed","candidatePreviews":results.len(),"formalTodosBefore":1,"formalTodosAfter":1,"formalSources":0,"roleConfigurationsRestored":3,"modelOverride":true,"personalizationTag":true,"trialResultRestored":true,"businessHistoryUnchanged":true,"keychainCredential":true})
        );
        drop(reopened);
        drop(cleanup);
    }
}
