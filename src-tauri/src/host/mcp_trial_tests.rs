use super::*;
use crate::local_store::{AppStore, McpRemoveInput, McpServerInput, ModelConfigInput};
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::process::Child;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) struct TrialFixture {
    pub(super) root: PathBuf,
    pub(super) directory: PathBuf,
    pub(super) local: Option<LocalState>,
    pub(super) runtime: RuntimeState,
    pub(super) model: Child,
    key: String,
    pub(super) phases: Arc<Mutex<Vec<String>>>,
}
impl TrialFixture {
    pub(super) fn new(mode: &str, tool_call: bool, enabled: bool) -> Self {
        let root = std::env::temp_dir().join(format!(
            "sidekick-mcp-trial-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        fs::write(root.join("forbidden-marker.read"), "controlled read").unwrap();
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../build/s0-runtime")
            .canonicalize()
            .unwrap();
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/mcp-trial.mjs")
            .canonicalize()
            .unwrap();
        let mut model = Command::new(directory.join("node"))
            .args([
                fixture.as_os_str(),
                "model".as_ref(),
                root.join("model.jsonl").as_os_str(),
                mode.as_ref(),
                root.join("forbidden-marker").as_os_str(),
            ])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut url = String::new();
        BufReader::new(model.stdout.take().unwrap())
            .read_line(&mut url)
            .unwrap();
        assert!(url.starts_with("http://127.0.0.1:"));
        let key = format!(
            "SIDEKICK_SYNTHETIC_MCP_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::set_var(&key, "p3-synthetic-token");
        std::env::set_var(format!("{key}_SERVICE"), "p3-synthetic-private");
        let local = LocalState::new(root.join("app"));
        local.access(|store| {
            store.initialize(Some(root.join("workspace")), "UTC")?;
            store.upgrade_mcp_storage()?;
            store.save_models(ModelConfigInput { expected_revision: None, providers: json!({"providers":[{"id":"controlled","apiFormat":"openai-compatible","baseUrl":url.trim(),"auth":{"type":"bearer","apiKeyEnv":key},"enabled":true,"network":{"timeoutMs":10000,"retry":{"maxRetries":0}}}]}), models: json!({"models":[{"id":"controlled","providerId":"controlled","apiModelId":"synthetic","capabilities":{"toolCall":tool_call,"input":["text"]}}]}), default_model_id:"controlled".into(), api_keys:Default::default() })?;
            for index in 0..2 {
                store.save_mcp_server(McpServerInput { id:None,expected_revision:store.mcp_configuration()?.revision,server:serde_json::from_value(json!({"name":format!("service-{index}"),"transport":"stdio","enabled":enabled,"command":directory.join("node"),"args":[fixture,"service",root.join(format!("service-{index}.jsonl")),if index==0 {mode}else{"normal"},root.join("forbidden-marker")],"cwd":null,"env":if mode=="private" {json!([{"name":"CONTROLLED_SECRET","source":"environment","value":format!("{key}_SERVICE")}])}else{json!([])},"connectTimeoutMs":3000,"toolTimeoutMs":1000})).unwrap() })?;
            }
            Ok(())
        }).unwrap();
        Self {
            root,
            directory,
            local: Some(local),
            runtime: RuntimeState::default(),
            model,
            key,
            phases: Default::default(),
        }
    }
    pub(super) fn start(&self) -> AgentRun {
        let phases = self.phases.clone();
        self.runtime
            .start_trial(
                self.local.as_ref().unwrap().clone(),
                self.directory.clone(),
                "organizer",
                TextInput {
                    text: "我整理合成清单。".into(),
                    source_at_ms: None,
                    time_zone: "UTC".into(),
                },
                Arc::new(move |_, phase| phases.lock().unwrap().push(phase.to_string())),
            )
            .unwrap()
    }
    pub(super) fn wait(&self, id: &str) -> AgentRun {
        let started = Instant::now();
        while self.runtime.active_run().is_some() {
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "controlled trial did not clean up; pid={:?}, terminal={:?}",
                self.runtime
                    .slot
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|job| job.pid.load(Ordering::SeqCst)),
                self.local
                    .as_ref()
                    .unwrap()
                    .access(|store| store.agent_run(id).map(|run| (run.status, run.error_code)))
            );
            std::thread::sleep(Duration::from_millis(25));
        }
        self.local
            .as_ref()
            .unwrap()
            .access(|store| store.agent_run(id))
            .unwrap()
    }
    pub(super) fn events(&self, name: &str) -> Vec<Value> {
        fs::read_to_string(self.root.join(name))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
    pub(super) fn database(&self) -> Connection {
        Connection::open_with_flags(
            self.root.join("workspace/data/sidekick.sqlite"),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .unwrap()
    }
    pub(super) fn calls(&self) -> Vec<(String, String)> {
        self.database().prepare("SELECT send_state,COALESCE(response_category,'') FROM tool_calls ORDER BY created_at_ms,id").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().map(|row|row.unwrap()).collect()
    }
    fn assert_isolated(&self) {
        let model = Command::new("/bin/ps")
            .args(["-p", &self.model.id().to_string(), "-o", "stat="])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&model.stdout);
        assert!(
            model.status.success() && !state.trim().is_empty() && !state.trim().starts_with('Z'),
            "unrelated controlled model process was terminated"
        );
        for table in ["sources", "candidates", "todos", "todo_events"] {
            let count: i64 = self
                .database()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
        for index in 0..2 {
            for event in self.events(&format!("service-{index}.jsonl")) {
                if event["type"] == "pid" {
                    assert_eq!(event["modelKeyPresent"], false);
                    let pid = event["pid"].as_u64().unwrap();
                    let output = Command::new("/bin/ps")
                        .args(["-p", &pid.to_string(), "-o", "stat="])
                        .output()
                        .unwrap();
                    assert!(
                        !output.status.success()
                            || String::from_utf8_lossy(&output.stdout)
                                .trim()
                                .starts_with('Z'),
                        "controlled process {pid} remained alive"
                    );
                }
            }
        }
    }
    pub(super) fn reopen(&mut self, id: &str) -> AgentRun {
        self.local.take();
        std::thread::sleep(Duration::from_millis(50));
        let store = AppStore::open(self.root.join("app")).unwrap();
        store.agent_run(id).unwrap()
    }
}
impl Drop for TrialFixture {
    fn drop(&mut self) {
        self.runtime.shutdown(&self.directory);
        let _ = self.model.kill();
        let _ = self.model.wait();
        std::env::remove_var(&self.key);
        std::env::remove_var(format!("{}_SERVICE", self.key));
        self.local.take();
        if std::thread::panicking() {
            eprintln!("retained controlled fixture: {}", self.root.display());
        } else {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

#[test]
fn two_same_name_tools_use_real_pi_and_durable_receipts() {
    let mut fixture = TrialFixture::new("normal", true, true);
    let run = fixture.start();
    let result = fixture.wait(&run.id);
    assert_eq!(result.status, "succeeded");
    assert_eq!(
        fixture.calls(),
        vec![("responded".into(), "success".into()); 2]
    );
    for index in 0..2 {
        assert_eq!(
            fixture
                .events(&format!("service-{index}.jsonl"))
                .iter()
                .filter(|e| e["type"] == "call")
                .count(),
            1
        );
    }
    let model = fixture.events("model.jsonl");
    assert_eq!(model.len(), 2);
    assert!(model[1]["results"].as_array().unwrap().iter().all(|v| v
        .as_str()
        .unwrap()
        .contains("controlled-text")
        && v.as_str().unwrap().contains("value")));
    fixture.assert_isolated();
    assert_eq!(fixture.reopen(&run.id).status, "succeeded");
}

#[test]
fn lost_response_stops_the_batch_and_survives_cold_reopen() {
    let mut fixture = TrialFixture::new("lost", true, true);
    let run = fixture.start();
    let result = fixture.wait(&run.id);
    assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
    assert_eq!(fixture.calls(), vec![("unknown".into(), String::new())]);
    assert_eq!(
        fixture
            .events("service-0.jsonl")
            .iter()
            .filter(|e| e["type"] == "call")
            .count(),
        1
    );
    assert_eq!(
        fixture
            .events("service-1.jsonl")
            .iter()
            .filter(|e| e["type"] == "call")
            .count(),
        0
    );
    assert_eq!(fixture.events("model.jsonl").len(), 1);
    assert!(!fixture.root.join("forbidden-marker").exists());
    fixture.assert_isolated();
    let proof: Value = serde_json::from_str(
        &fs::read_to_string(
            fixture
                .root
                .join("workspace/runs")
                .join(&run.id)
                .join("skills-proof.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(proof.as_array().unwrap().is_empty());
    assert_eq!(
        fixture.reopen(&run.id).error_code.as_deref(),
        Some("MCP_RESULT_UNKNOWN")
    );
}

#[test]
fn known_tool_error_is_responded_and_not_unknown() {
    let fixture = TrialFixture::new("error", true, true);
    let run = fixture.start();
    assert_eq!(fixture.wait(&run.id).status, "succeeded");
    let calls = fixture.calls();
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|call| call.0 == "responded"));
    assert!(calls.iter().any(|call| call.1 == "tool_error"));
    fixture.assert_isolated();
}

#[test]
fn disabled_tools_and_disabled_services_never_start_mcp() {
    for (tool_call, enabled) in [(false, true), (true, false)] {
        let fixture = TrialFixture::new("normal", tool_call, enabled);
        let run = fixture.start();
        assert_eq!(fixture.wait(&run.id).status, "succeeded");
        assert!(fixture.calls().is_empty());
        assert!(fixture.events("service-0.jsonl").is_empty());
        assert!(fixture.events("service-1.jsonl").is_empty());
        fixture.assert_isolated();
    }
}

#[test]
fn implicit_schema_coercion_is_rejected_before_dispatch() {
    let fixture = TrialFixture::new("coercion", true, true);
    let run = fixture.start();
    assert_eq!(fixture.wait(&run.id).status, "succeeded");
    assert!(fixture.calls().is_empty());
    assert!(!fixture.root.join("forbidden-marker").exists());
    assert_eq!(
        fixture.events("model.jsonl")[0]["names"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    fixture.assert_isolated();
}

#[test]
fn ack_boundaries_never_release_unconfirmed_work_or_replay_known_responses() {
    for (policy, count, state) in [
        ("reject-begin", 0, ""),
        ("drop-begin-ack", 0, "unknown"),
        ("before-response", 1, "unknown"),
        ("drop-response-ack", 1, "responded"),
    ] {
        let mut fixture = TrialFixture::new("normal", true, true);
        *fixture.runtime.trial_policy.lock().unwrap() = Some(policy);
        let run = fixture.start();
        let result = fixture.wait(&run.id);
        assert_eq!(result.status, "failed", "{policy}");
        assert_eq!(
            fixture
                .events("service-0.jsonl")
                .iter()
                .filter(|e| e["type"] == "call")
                .count(),
            count,
            "{policy}"
        );
        assert_eq!(
            fixture
                .events("service-1.jsonl")
                .iter()
                .filter(|e| e["type"] == "call")
                .count(),
            0,
            "{policy}"
        );
        let rows = fixture.calls();
        if state.is_empty() {
            assert!(rows.is_empty());
        } else {
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].0, state);
        }
        assert_eq!(
            result.error_code.as_deref() == Some("MCP_RESULT_UNKNOWN"),
            state == "unknown",
            "{policy}"
        );
        fixture.assert_isolated();
        let reopened = fixture.reopen(&run.id);
        assert_eq!(reopened.error_code, result.error_code);
    }
}

#[test]
fn malformed_private_and_large_results_become_unknown_without_a_second_tool() {
    for mode in ["invalid", "oversized", "private"] {
        let fixture = TrialFixture::new(mode, true, true);
        let run = fixture.start();
        let result = fixture.wait(&run.id);
        assert_eq!(
            result.error_code.as_deref(),
            Some("MCP_RESULT_UNKNOWN"),
            "{mode}"
        );
        assert_eq!(fixture.calls(), vec![("unknown".into(), String::new())]);
        assert_eq!(
            fixture
                .events("service-0.jsonl")
                .iter()
                .filter(|e| e["type"] == "call")
                .count(),
            1
        );
        assert_eq!(
            fixture
                .events("service-1.jsonl")
                .iter()
                .filter(|e| e["type"] == "call")
                .count(),
            0
        );
        assert!(!serde_json::to_string(&result.snapshot)
            .unwrap()
            .contains("p3-synthetic-private"));
        fixture.assert_isolated();
    }
}

#[test]
fn cancellation_and_runtime_kill_keep_unknown_and_reap_both_services() {
    for killed in [false, true] {
        let fixture = TrialFixture::new("lost", true, true);
        let run = fixture.start();
        let started = Instant::now();
        while !fixture
            .events("service-0.jsonl")
            .iter()
            .any(|e| e["type"] == "call")
        {
            assert!(started.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(5));
        }
        if killed {
            let pid = fixture
                .runtime
                .slot
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .pid
                .load(Ordering::SeqCst);
            assert!(pid > 1);
            assert!(Command::new("/bin/kill")
                .args(["-KILL", &pid.to_string()])
                .status()
                .unwrap()
                .success());
        } else {
            fixture.runtime.cancel(&run.id);
            fixture
                .local
                .as_ref()
                .unwrap()
                .access(|store| store.cancel_agent_trial(&run.id))
                .unwrap();
        }
        let result = fixture.wait(&run.id);
        assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
        assert_eq!(fixture.calls(), vec![("unknown".into(), String::new())]);
        fixture.assert_isolated();
    }
}

#[test]
fn active_configuration_edits_preserve_snapshot_and_prevent_deletion() {
    let fixture = TrialFixture::new("freeze", true, true);
    let run = fixture.start();
    let started = Instant::now();
    while fixture.events("model.jsonl").is_empty() {
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(5));
    }
    let configuration = fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.mcp_configuration())
        .unwrap();
    let revision = configuration.revision.clone();
    assert!(fixture
        .runtime
        .remove_mcp_server(
            fixture.local.as_ref().unwrap(),
            McpRemoveInput {
                id: configuration.servers[1].id.clone(),
                expected_revision: revision.clone()
            }
        )
        .is_err());
    let server = &configuration.servers[0];
    let mut draft = server.settings.clone();
    draft.command = "/never-executed".into();
    draft.enabled = false;
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| {
            store.save_mcp_server(McpServerInput {
                id: Some(server.id.clone()),
                expected_revision: revision.clone(),
                server: draft,
            })
        })
        .unwrap();
    fs::write(fixture.root.join("forbidden-marker.continue"), "continue").unwrap();
    let result = fixture.wait(&run.id);
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.snapshot["mcp"]["revision"], revision);
    assert_eq!(fixture.calls().len(), 2);
    fixture.assert_isolated();
}

#[test]
fn terminal_sqlite_write_failure_keeps_the_slot_until_reopen() {
    let mut fixture = TrialFixture::new("lost", true, true);
    let run = fixture.start();
    let started = Instant::now();
    while !fixture
        .events("service-0.jsonl")
        .iter()
        .any(|event| event["type"] == "call")
    {
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(5));
    }
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.test_mcp_query_only(true))
        .unwrap();
    assert_eq!(
        fixture.calls(),
        vec![("possibly_sent".into(), String::new())]
    );
    while !fixture
        .phases
        .lock()
        .unwrap()
        .iter()
        .any(|phase| phase == "storage_error")
    {
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        fixture.calls(),
        vec![("possibly_sent".into(), String::new())]
    );
    assert_eq!(
        fixture.runtime.active_trial().as_deref(),
        Some(run.id.as_str())
    );
    assert_eq!(
        fixture
            .runtime
            .slot
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .pid
            .load(Ordering::SeqCst),
        0
    );
    let second = fixture.runtime.start_trial(
        fixture.local.as_ref().unwrap().clone(),
        fixture.directory.clone(),
        "organizer",
        TextInput {
            text: "我整理合成清单。".into(),
            source_at_ms: None,
            time_zone: "UTC".into(),
        },
        Arc::new(|_, _| {}),
    );
    assert_eq!(second.unwrap_err().code, "RUNTIME_BUSY");
    fixture.assert_isolated();
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.test_mcp_query_only(false))
        .unwrap();
    assert_eq!(
        fixture.reopen(&run.id).error_code.as_deref(),
        Some("MCP_RESULT_UNKNOWN")
    );
    assert_eq!(
        fixture
            .events("service-0.jsonl")
            .iter()
            .filter(|event| event["type"] == "call")
            .count(),
        1
    );
    assert_eq!(
        fixture
            .events("service-1.jsonl")
            .iter()
            .filter(|event| event["type"] == "call")
            .count(),
        0
    );
}
