use super::mcp_trial_tests::TrialFixture;
use super::*;

fn extract(fixture: &TrialFixture) -> ModelRun {
    fixture
        .runtime
        .start(
            fixture.local.as_ref().unwrap().clone(),
            fixture.directory.clone(),
            StartTask::Extract {
                input: TextInput {
                    text: "我整理合成清单。".into(),
                    source_at_ms: None,
                    time_zone: "UTC".into(),
                },
                retry: false,
            },
            Arc::new(|_, _| {}),
        )
        .unwrap()
}
fn wait_business(fixture: &TrialFixture, id: &str) -> ModelRun {
    let started = Instant::now();
    while fixture.runtime.active_run().is_some() {
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "controlled formal task retained its slot"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.model_run(id))
        .unwrap()
}
#[test]
fn formal_business_mcp_prepares_catalog_and_durable_receipts() {
    let fixture = TrialFixture::new("normal", true, true);
    let run = extract(&fixture);
    let completed = wait_business(&fixture, &run.id);
    assert_eq!(completed.status, "succeeded", "{:?}", completed.error_code);
    assert_eq!(
        fixture.calls(),
        vec![("responded".into(), "success".into()); 2]
    );
    for index in 0..2 {
        assert_eq!(
            fixture
                .events(&format!("service-{index}.jsonl"))
                .iter()
                .filter(|event| event["type"] == "call")
                .count(),
            1
        );
    }
    assert_eq!(
        fixture
            .database()
            .query_row(
                "SELECT count(*) FROM tool_calls WHERE run_id=?1 AND agent_run_id IS NULL",
                [&run.id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
}

#[test]
fn formal_output_diagnostic_is_opt_in_and_private() {
    for policy in [None, Some("mcp-only"), Some("mcp-only-diagnostic")] {
        let fixture = TrialFixture::new("normal", true, true);
        *fixture.runtime.trial_policy.lock().unwrap() = policy;
        let run = extract(&fixture);
        assert_eq!(wait_business(&fixture, &run.id).status, "succeeded");
        let path = fixture
            .root
            .join("workspace/runs")
            .join(&run.id)
            .join("output-diagnostic.json");
        let events = fixture.runtime.output_diagnostics.lock().unwrap();
        if policy == Some("mcp-only-diagnostic") {
            assert!(
                path.is_file(),
                "explicit controlled output diagnostics were not retained"
            );
            let metadata = std::fs::symlink_metadata(&path).unwrap();
            assert_eq!(metadata.mode() & 0o7777, 0o600);
            assert_eq!(metadata.nlink(), 1);
            assert!(metadata.len() <= 16384);
            let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(value["runId"], run.id);
            assert_eq!(value["outcome"], "validated");
            assert_eq!(events.len(), 3);
            for (event, stage) in
                events
                    .iter()
                    .zip(["runtime-result", "rust-decode", "rust-publish"])
            {
                assert_eq!(event.run_id, run.id);
                assert_eq!(event.kind, "extract");
                assert_eq!(event.stage, stage);
                assert_eq!(event.outcome, "ok");
                assert_eq!(event.code, None);
            }
        } else {
            assert!(
                !path.exists(),
                "ordinary runtime created output diagnostics"
            );
            assert!(events.is_empty());
        }
    }
}

#[test]
fn formal_output_diagnostic_distinguishes_node_rejection_from_rust_decode() {
    for node_rejection in [true, false] {
        let fixture = TrialFixture::new(
            if node_rejection {
                "diagnostic-invalid-revise"
            } else {
                "normal"
            },
            true,
            true,
        );
        *fixture.runtime.trial_policy.lock().unwrap() = Some("mcp-only-diagnostic");
        let local = fixture.local.as_ref().unwrap();
        let run = extract(&fixture);
        assert_eq!(wait_business(&fixture, &run.id).status, "succeeded");
        let batch = local
            .access(|store| store.batch(run.source_id.as_deref().unwrap()))
            .unwrap();
        let candidate = &batch.candidates[0];
        if !node_rejection {
            fixture
                .runtime
                .output_decode_fault
                .store(true, Ordering::SeqCst);
        }
        let revised = fixture
            .runtime
            .start(
                local.clone(),
                fixture.directory.clone(),
                StartTask::Revise {
                    id: candidate.id.clone(),
                    version: candidate.version,
                    instruction: INSTRUCTION.into(),
                    time_zone: "UTC".into(),
                },
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let completed = wait_business(&fixture, &revised.id);
        assert_eq!(completed.status, "failed");
        assert_eq!(
            completed.error_code.as_deref(),
            Some("MODEL_INVALID_OUTPUT")
        );
        assert!(completed.preview.is_none());
        assert_eq!(
            local
                .access(|store| store.candidate(&candidate.id))
                .unwrap()
                .draft,
            candidate.draft
        );
        assert_eq!(count(&fixture.database(), "todos"), 0);
        assert_eq!(count(&fixture.database(), "todo_events"), 0);
        let events = fixture
            .runtime
            .output_diagnostics
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event.run_id == revised.id)
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(events.len(), if node_rejection { 1 } else { 2 });
        assert_eq!(events[0].stage, "runtime-result");
        assert_eq!(
            events[0].outcome,
            if node_rejection { "error" } else { "ok" }
        );
        assert_eq!(
            events[0].code,
            if node_rejection {
                Some("MODEL_INVALID_OUTPUT")
            } else {
                None
            }
        );
        if !node_rejection {
            assert_eq!(events[1].stage, "rust-decode");
            assert_eq!(events[1].outcome, "error");
            assert_eq!(events[1].code, Some("MODEL_INVALID_OUTPUT"));
        }
        assert!(events.iter().all(|event| event.stage != "rust-publish"));
        let diagnostic: Value = serde_json::from_slice(
            &fs::read(
                fixture
                    .root
                    .join("workspace/runs")
                    .join(&revised.id)
                    .join("output-diagnostic.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            diagnostic["outcome"],
            if node_rejection {
                "rejected"
            } else {
                "validated"
            }
        );
        assert_eq!(
            diagnostic["reason"],
            if node_rejection {
                json!("changes-empty")
            } else {
                Value::Null
            }
        );
    }
}

#[test]
fn formal_output_diagnostic_persistence_failure_preserves_existing_file() {
    let fixture = TrialFixture::new("normal", true, true);
    *fixture.runtime.trial_policy.lock().unwrap() = Some("mcp-only-diagnostic");
    fixture
        .runtime
        .output_diagnostic_conflict
        .store(true, Ordering::SeqCst);
    let run = extract(&fixture);
    let completed = wait_business(&fixture, &run.id);
    assert_eq!(completed.status, "failed");
    assert_eq!(completed.error_code.as_deref(), Some("RUNTIME_PROTOCOL"));
    let path = fixture
        .root
        .join("workspace/runs")
        .join(&run.id)
        .join("output-diagnostic.json");
    assert_eq!(
        fs::read(&path).unwrap(),
        b"controlled-existing-diagnostic\n"
    );
    assert_eq!(fs::symlink_metadata(&path).unwrap().mode() & 0o7777, 0o600);
    for table in ["candidates", "todos", "todo_events", "todo_sources"] {
        assert_eq!(count(&fixture.database(), table), 0);
    }
    let events = fixture.runtime.output_diagnostics.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].stage, "runtime-result");
    assert_eq!(events[0].outcome, "error");
    assert_eq!(events[0].code, Some("RUNTIME_REJECTED"));
}

#[test]
fn formal_output_diagnostic_events_remain_bounded() {
    let runtime = RuntimeState::default();
    *runtime.trial_policy.lock().unwrap() = Some("mcp-only-diagnostic");
    for index in 0..80 {
        runtime.record_output_diagnostic(
            &format!("controlled-{index}"),
            Some("extract"),
            "runtime-result",
            None,
        );
    }
    let events = runtime.output_diagnostics.lock().unwrap();
    assert_eq!(events.len(), 64);
    assert_eq!(events.first().unwrap().run_id, "controlled-16");
    assert_eq!(events.last().unwrap().run_id, "controlled-79");
}

use crate::local_store::{
    AgentConfigInput, AppStore, CandidateDraft, McpRemoveInput, McpServerInput, McpTaskOwner,
    ModelConfigInput, SignChoice, TodoInput,
};
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};

const SOURCE: &str = "我整理合成清单。此事尚未完成，需要作为一条待办。";
const INSTRUCTION: &str = "把标题改为核对合成清单。";
const LIVE_CASE: &str = "runtime_host::mcp_formal_tests::formal_live_roundtrip_matrix";
fn count(db: &Connection, table: &str) -> i64 {
    db.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap()
}
fn database(workspace: &Path) -> Connection {
    Connection::open_with_flags(
        workspace.join("data/sidekick.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .unwrap()
}
fn wait_run(runtime: &RuntimeState, local: &LocalState, id: &str) -> ModelRun {
    let started = Instant::now();
    while runtime.active_run().is_some() {
        assert!(
            started.elapsed() < Duration::from_secs(130),
            "controlled task did not settle"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    local.access(|store| store.model_run(id)).unwrap()
}
fn input() -> TextInput {
    TextInput {
        text: SOURCE.into(),
        source_at_ms: None,
        time_zone: "UTC".into(),
    }
}
pub(super) fn roundtrip(
    local: &LocalState,
    runtime: &RuntimeState,
    directory: &Path,
    workspace: &Path,
    services: usize,
) -> Value {
    let baseline = super::mcp_recovery_tests::table_snapshot(workspace);
    let db = database(workspace);
    let todo_count = count(&db, "todos");
    let event_count = count(&db, "todo_events");
    let link_count = count(&db, "todo_sources");
    let run = runtime
        .start(
            local.clone(),
            directory.into(),
            StartTask::Extract {
                input: input(),
                retry: false,
            },
            Arc::new(|_, _| {}),
        )
        .unwrap();
    let completed = wait_run(runtime, local, &run.id);
    assert_eq!(completed.status, "succeeded", "{:?}", completed.error_code);
    let batch = local
        .access(|store| store.batch(run.source_id.as_deref().unwrap()))
        .unwrap();
    assert_eq!(batch.candidates.len(), 1);
    let candidate = &batch.candidates[0];
    assert_eq!(count(&db, "todos"), todo_count);
    assert_eq!(count(&db, "todo_events"), event_count);
    let revised = runtime
        .start(
            local.clone(),
            directory.into(),
            StartTask::Revise {
                id: candidate.id.clone(),
                version: candidate.version,
                instruction: INSTRUCTION.into(),
                time_zone: "UTC".into(),
            },
            Arc::new(|_, _| {}),
        )
        .unwrap();
    let revised = wait_run(runtime, local, &revised.id);
    assert_eq!(revised.status, "succeeded", "{:?}", revised.error_code);
    assert_eq!(
        revised.preview.as_ref().unwrap().fields.title,
        "核对合成清单"
    );
    assert_eq!(
        local
            .access(|store| store.candidate(&candidate.id))
            .unwrap()
            .draft,
        candidate.draft
    );
    assert_eq!(count(&db, "todos"), todo_count);
    assert_eq!(count(&db, "todo_events"), event_count);
    let applied = local
        .access(|store| store.apply_preview(&revised.id, candidate.version, "formal-apply"))
        .unwrap();
    assert_eq!(applied.draft.fields.title, "核对合成清单");
    assert_eq!(applied.draft.evidence, candidate.draft.evidence);
    assert!(!applied.draft.evidence.is_empty());
    assert!(SOURCE.contains(&applied.draft.evidence));
    assert_eq!(count(&db, "todos"), todo_count);
    assert_eq!(count(&db, "todo_events"), event_count);
    let choice = SignChoice {
        candidate_id: applied.id.clone(),
        expected_version: applied.version,
        fields: applied.draft.fields.clone(),
        time_reviewed: true,
        target: None,
    };
    let signed = local
        .access(|store| store.sign_candidates(vec![choice.clone()], "formal-sign"))
        .unwrap();
    assert_eq!(signed.len(), 1);
    assert_eq!(
        local
            .access(|store| store.sign_candidates(vec![choice.clone()], "formal-sign"))
            .unwrap(),
        signed
    );
    assert!(local
        .access(|store| store.sign_candidates(vec![choice], "formal-sign-new-operation"))
        .is_err());
    assert_eq!(count(&db, "todos"), todo_count + 1);
    assert_eq!(count(&db, "todo_events"), event_count + 1);
    assert_eq!(count(&db, "todo_sources"), link_count + 1);
    let before_trial = super::mcp_recovery_tests::table_snapshot(workspace);
    assert_ne!(before_trial, baseline);
    for table in ["sources", "candidates", "todos", "todo_events", "runs"] {
        assert!(!before_trial[table].as_array().unwrap().is_empty());
    }
    let trial = runtime
        .start_trial(
            local.clone(),
            directory.into(),
            "organizer",
            input(),
            Arc::new(|_, _| {}),
        )
        .unwrap();
    let started = Instant::now();
    while runtime.active_run().is_some() {
        assert!(started.elapsed() < Duration::from_secs(130));
        std::thread::sleep(Duration::from_millis(25));
    }
    let trial = local.access(|store| store.agent_run(&trial.id)).unwrap();
    assert_eq!(trial.status, "succeeded", "{:?}", trial.error_code);
    assert_eq!(
        super::mcp_recovery_tests::table_snapshot(workspace),
        before_trial
    );
    let args_sha = format!("{:x}", Sha256::digest(br#"{"text":"controlled"}"#));
    let schema_sha = format!("{:x}", Sha256::digest(serde_json::to_vec(&json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false})).unwrap()));
    let mut evidence = Vec::new();
    for (id, column) in [
        (&run.id, "run_id"),
        (&revised.id, "run_id"),
        (&trial.id, "agent_run_id"),
    ] {
        let rows = db.prepare(&format!("SELECT id,schema_sha256,arguments_sha256,response_category,send_state FROM tool_calls WHERE {column}=?1 ORDER BY id")).unwrap().query_map([id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?))).unwrap().map(|row| row.unwrap()).collect::<Vec<_>>();
        assert_eq!(
            rows.len(),
            services,
            "run {id} did not choose every controlled tool exactly once"
        );
        for (call, schema, arguments, category, state) in rows {
            assert_eq!(schema, schema_sha);
            assert_eq!(arguments, args_sha);
            assert_eq!(category, "success");
            assert_eq!(state, "responded");
            evidence.push(json!({"runId":id,"callId":call,"schema":schema,"argsSHA":arguments,"category":category}));
        }
    }
    json!({"calls":evidence,"businessCounts":{"todos":count(&db,"todos"),"todoEvents":count(&db,"todo_events"),"todoSources":count(&db,"todo_sources")},"trialBusinessUnchanged":true})
}

#[test]
fn formal_live_roundtrip_matrix() {
    match std::env::var_os("SIDEKICK_P5_LIVE_INFO") {
        Some(path) => live_roundtrip(Path::new(&path)),
        None => {
            let fixture = TrialFixture::new("normal", true, true);
            let evidence = roundtrip(
                fixture.local.as_ref().unwrap(),
                &fixture.runtime,
                &fixture.directory,
                &fixture.root.join("workspace"),
                2,
            );
            assert_eq!(evidence["calls"].as_array().unwrap().len(), 6);
            for index in 0..2 {
                assert_eq!(
                    fixture
                        .events(&format!("service-{index}.jsonl"))
                        .iter()
                        .filter(|event| event["type"] == "call")
                        .count(),
                    3
                );
            }
        }
    }
}

#[test]
fn formal_roundtrip_preserves_short_source_evidence() {
    let fixture = TrialFixture::new("short-evidence", true, true);
    let local = fixture.local.as_ref().unwrap();
    let evidence = roundtrip(
        local,
        &fixture.runtime,
        &fixture.directory,
        &fixture.root.join("workspace"),
        2,
    );
    assert_eq!(evidence["calls"].as_array().unwrap().len(), 6);
    let db = fixture.database();
    for table in ["candidates", "todo_sources"] {
        let stored: String = db
            .query_row(&format!("SELECT evidence FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, "我整理合成清单");
        assert_ne!(stored, SOURCE);
        assert!(SOURCE.contains(&stored));
    }
    let trial = local
        .access(|store| store.latest_agent_trial("organizer"))
        .unwrap()
        .unwrap();
    assert_eq!(trial.result.as_ref().unwrap()[0].evidence, "我整理合成清单");
    for index in 0..2 {
        assert_eq!(
            fixture
                .events(&format!("service-{index}.jsonl"))
                .iter()
                .filter(|event| event["type"] == "call")
                .count(),
            3
        );
    }
}

fn service_mode(fixture: &TrialFixture, mode: &str) {
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| {
            let configuration = store.mcp_configuration()?;
            let server = &configuration.servers[0];
            let mut settings = server.settings.clone();
            settings.stdio_mut().unwrap().args[3] = mode.into();
            store.save_mcp_server(McpServerInput {
                id: Some(server.id.clone()),
                expected_revision: configuration.revision,
                server: settings,
            })?;
            Ok(())
        })
        .unwrap();
}
fn wait_call(fixture: &TrialFixture) {
    let started = Instant::now();
    while !fixture
        .events("service-0.jsonl")
        .iter()
        .any(|event| event["type"] == "call")
    {
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn draft() -> CandidateDraft {
    CandidateDraft {
        fields: TodoInput {
            title: "Late controlled candidate".into(),
            kind: "action".into(),
            owner: "我".into(),
            priority: "medium".into(),
            tags: vec![],
            due: None,
            followup: None,
        },
        evidence: SOURCE.into(),
        due_expression: None,
        followup_expression: None,
        warnings: vec![],
        unresolved: false,
    }
}
#[test]
fn formal_commit_faults_keep_unknown_and_reject_late_publication() {
    for (policy, count, state) in [
        ("store-begin-before", 0, ""),
        ("store-begin-after", 0, "unknown"),
        ("store-response-before", 1, "unknown"),
        ("store-response-after", 1, "responded"),
    ] {
        let mut fixture = TrialFixture::new("normal", true, true);
        *fixture.runtime.trial_policy.lock().unwrap() = Some(policy);
        let run = extract(&fixture);
        let result = wait_business(&fixture, &run.id);
        assert_eq!(result.status, "failed", "{policy}");
        let expected = if state.is_empty() {
            vec![]
        } else {
            vec![(
                state.into(),
                if state == "responded" {
                    "success".into()
                } else {
                    String::new()
                },
            )]
        };
        assert_eq!(fixture.calls(), expected, "{policy}");
        assert_eq!(
            fixture
                .events("service-0.jsonl")
                .iter()
                .filter(|event| event["type"] == "call")
                .count(),
            count
        );
        assert_eq!(
            fixture
                .events("service-1.jsonl")
                .iter()
                .filter(|event| event["type"] == "call")
                .count(),
            0
        );
        let db = fixture.database();
        for table in ["candidates", "todos", "todo_events"] {
            assert_eq!(self::count(&db, table), 0);
        }
        assert_eq!(self::count(&db, "sources"), 1);
        let local = fixture.local.as_ref().unwrap();
        assert!(local
            .access(|store| store.publish_candidates(&run.id, vec![draft()]))
            .is_err());
        if state == "unknown" {
            assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
            let call: String = db
                .query_row(
                    "SELECT id FROM tool_calls WHERE run_id=?1",
                    [&run.id],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(local
                .access(|store| store.confirm_mcp_task_call(
                    McpTaskOwner::Business,
                    &run.id,
                    &call,
                    false
                ))
                .is_err());
            let late = local
                .access(|store| store.finish_run_error(&run.id, "MODEL_TIMEOUT"))
                .unwrap();
            assert_eq!(late.error_code, result.error_code);
            assert_eq!(late.finished_at_ms, result.finished_at_ms);
        }
        fixture.local.take();
        let reopened = AppStore::open(fixture.root.join("app"))
            .unwrap()
            .model_run(&run.id)
            .unwrap();
        assert_eq!(reopened.error_code, result.error_code);
        assert_eq!(reopened.finished_at_ms, result.finished_at_ms);
        assert_eq!(fixture.calls(), expected);
        assert_eq!(
            fixture
                .events("service-0.jsonl")
                .iter()
                .filter(|event| event["type"] == "call")
                .count(),
            count
        );
    }
}
#[test]
fn formal_lost_cancel_and_runtime_kill_never_replay_on_cold_open() {
    for action in ["lost", "cancel", "kill"] {
        let mut fixture = TrialFixture::new("lost", true, true);
        let run = extract(&fixture);
        wait_call(&fixture);
        if action == "cancel" {
            fixture.runtime.cancel(&run.id);
            fixture
                .local
                .as_ref()
                .unwrap()
                .access(|store| store.cancel_run(&run.id))
                .unwrap();
        } else if action == "kill" {
            let pid = fixture
                .runtime
                .slot
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .pid
                .load(Ordering::SeqCst);
            assert!(Command::new("/bin/kill")
                .args(["-KILL", &pid.to_string()])
                .status()
                .unwrap()
                .success());
        }
        let result = wait_business(&fixture, &run.id);
        assert_eq!(result.status, "failed");
        assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
        assert!(result.preview.is_none());
        assert_eq!(fixture.calls(), vec![("unknown".into(), String::new())]);
        assert_eq!(count(&fixture.database(), "candidates"), 0);
        for index in 0..2 {
            for event in fixture.events(&format!("service-{index}.jsonl")) {
                if event["type"] == "pid" {
                    let state = Command::new("/bin/ps")
                        .args([
                            "-p",
                            &event["pid"].as_u64().unwrap().to_string(),
                            "-o",
                            "stat=",
                        ])
                        .output()
                        .unwrap();
                    assert!(
                        !state.status.success()
                            || String::from_utf8_lossy(&state.stdout)
                                .trim()
                                .starts_with('Z')
                    );
                    assert_eq!(event["modelKeyPresent"], false);
                }
            }
        }
        fixture.local.take();
        let reopened = AppStore::open(fixture.root.join("app"))
            .unwrap()
            .model_run(&run.id)
            .unwrap();
        assert_eq!(reopened.error_code, result.error_code);
        assert_eq!(reopened.finished_at_ms, result.finished_at_ms);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(
            fixture
                .events("service-0.jsonl")
                .iter()
                .filter(|event| event["type"] == "call")
                .count(),
            1
        );
        assert_eq!(fixture.events("model.jsonl").len(), 1);
    }
}
#[test]
fn formal_known_tool_error_is_a_durable_response() {
    let fixture = TrialFixture::new("error", true, true);
    let run = extract(&fixture);
    assert_eq!(wait_business(&fixture, &run.id).status, "succeeded");
    assert_eq!(
        fixture.calls(),
        vec![
            ("responded".into(), "tool_error".into()),
            ("responded".into(), "success".into())
        ]
    );
    assert_eq!(count(&fixture.database(), "todos"), 0);
}
#[test]
fn formal_configuration_snapshot_survives_edits_and_active_delete_is_blocked() {
    let fixture = TrialFixture::new("freeze", true, true);
    let run = extract(&fixture);
    let started = Instant::now();
    while fixture.events("model.jsonl").is_empty() {
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(5));
    }
    let config = fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.mcp_configuration())
        .unwrap();
    assert!(fixture
        .runtime
        .remove_mcp_server(
            fixture.local.as_ref().unwrap(),
            McpRemoveInput {
                id: config.servers[1].id.clone(),
                expected_revision: config.revision.clone()
            }
        )
        .is_err());
    let mut settings = config.servers[0].settings.clone();
    settings.stdio_mut().unwrap().command = "/never-executed".into();
    settings.enabled = false;
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| {
            store.save_mcp_server(McpServerInput {
                id: Some(config.servers[0].id.clone()),
                expected_revision: config.revision.clone(),
                server: settings,
            })
        })
        .unwrap();
    fs::write(fixture.root.join("forbidden-marker.continue"), "continue").unwrap();
    let result = wait_business(&fixture, &run.id);
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.snapshot["mcp"]["revision"], config.revision);
    assert_eq!(fixture.calls().len(), 2);
}
#[test]
fn formal_no_mcp_disabled_tools_and_connection_tests_keep_the_old_path() {
    for (tool_call, enabled, connection) in [
        (false, true, false),
        (true, false, false),
        (true, true, true),
    ] {
        let fixture = TrialFixture::new("normal", tool_call, enabled);
        let run = if connection {
            fixture
                .runtime
                .start(
                    fixture.local.as_ref().unwrap().clone(),
                    fixture.directory.clone(),
                    StartTask::Test(None),
                    Arc::new(|_, _| {}),
                )
                .unwrap()
        } else {
            extract(&fixture)
        };
        let completed = wait_business(&fixture, &run.id);
        assert_eq!(completed.status, "succeeded", "{:?}", completed.error_code);
        assert!(fixture.calls().is_empty());
        for index in 0..2 {
            assert!(fixture.events(&format!("service-{index}.jsonl")).is_empty());
        }
    }
}
#[test]
fn formal_terminal_write_failure_retains_the_slot_until_reopen() {
    let mut fixture = TrialFixture::new("lost", true, true);
    let phases = fixture.phases.clone();
    let run = fixture
        .runtime
        .start(
            fixture.local.as_ref().unwrap().clone(),
            fixture.directory.clone(),
            StartTask::Extract {
                input: input(),
                retry: false,
            },
            Arc::new(move |_, phase| phases.lock().unwrap().push(phase.into())),
        )
        .unwrap();
    wait_call(&fixture);
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.test_mcp_query_only(true))
        .unwrap();
    let started = Instant::now();
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
        fixture.runtime.active_business().as_deref(),
        Some(run.id.as_str())
    );
    assert_eq!(
        fixture.calls(),
        vec![("possibly_sent".into(), String::new())]
    );
    assert_eq!(
        fixture
            .runtime
            .start(
                fixture.local.as_ref().unwrap().clone(),
                fixture.directory.clone(),
                StartTask::Test(None),
                Arc::new(|_, _| {})
            )
            .unwrap_err()
            .code,
        "RUNTIME_BUSY"
    );
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.test_mcp_query_only(false))
        .unwrap();
    fixture.local.take();
    assert_eq!(
        AppStore::open(fixture.root.join("app"))
            .unwrap()
            .model_run(&run.id)
            .unwrap()
            .error_code
            .as_deref(),
        Some("MCP_RESULT_UNKNOWN")
    );
}

#[test]
fn formal_revision_unknown_keeps_the_candidate_and_rejects_late_preview() {
    let fixture = TrialFixture::new("normal", true, true);
    let extracted = extract(&fixture);
    assert_eq!(wait_business(&fixture, &extracted.id).status, "succeeded");
    let candidate = fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.batch(extracted.source_id.as_deref().unwrap()))
        .unwrap()
        .candidates
        .remove(0);
    service_mode(&fixture, "lost");
    let run = fixture
        .runtime
        .start(
            fixture.local.as_ref().unwrap().clone(),
            fixture.directory.clone(),
            StartTask::Revise {
                id: candidate.id.clone(),
                version: candidate.version,
                instruction: INSTRUCTION.into(),
                time_zone: "UTC".into(),
            },
            Arc::new(|_, _| {}),
        )
        .unwrap();
    let result = wait_business(&fixture, &run.id);
    assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
    assert!(result.preview.is_none());
    let local = fixture.local.as_ref().unwrap();
    assert_eq!(
        local
            .access(|store| store.candidate(&candidate.id))
            .unwrap()
            .draft,
        candidate.draft
    );
    assert!(local
        .access(|store| store.publish_revision(&run.id, candidate.draft.clone()))
        .is_err());
    assert_eq!(count(&fixture.database(), "todos"), 0);
    assert_eq!(count(&fixture.database(), "todo_events"), 0);
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveInfo {
    version: u32,
    parent_pid: u32,
    nonce: String,
    base: PathBuf,
    exe: PathBuf,
    case: String,
    port: u16,
    relay_token: String,
    model_id: String,
}
struct LiveGuard {
    info: LiveInfo,
    base_identity: (u64, u64),
}
fn uid() -> std::result::Result<u32, &'static str> {
    let output = Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .map_err(|_| "LIVE_IDENTITY")?;
    if !output.status.success() {
        return Err("LIVE_IDENTITY");
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "LIVE_IDENTITY")?
        .trim()
        .parse()
        .map_err(|_| "LIVE_IDENTITY")
}
fn secure_metadata(meta: &fs::Metadata, owner: u32, mode: u32, directory: bool) -> bool {
    meta.uid() == owner
        && meta.mode() & 0o7777 == mode
        && if directory {
            meta.is_dir()
        } else {
            meta.is_file() && meta.nlink() == 1
        }
}
fn identity(meta: &fs::Metadata) -> (u64, u64) {
    (meta.dev(), meta.ino())
}
fn nofollow() -> i32 {
    #[cfg(target_os = "macos")]
    {
        0x100
    }
    #[cfg(not(target_os = "macos"))]
    {
        0x20000
    }
}
fn read_live_guard(path: &Path) -> std::result::Result<LiveGuard, &'static str> {
    let owner = uid()?;
    let before = fs::symlink_metadata(path).map_err(|_| "LIVE_INFO_FILE")?;
    if !secure_metadata(&before, owner, 0o600, false) {
        return Err("LIVE_INFO_FILE");
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(nofollow())
        .open(path)
        .map_err(|_| "LIVE_INFO_FILE")?;
    let opened = file.metadata().map_err(|_| "LIVE_INFO_FILE")?;
    if identity(&before) != identity(&opened)
        || !secure_metadata(&opened, owner, 0o600, false)
        || opened.len() > 16384
    {
        return Err("LIVE_INFO_FILE");
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(16385)
        .read_to_end(&mut bytes)
        .map_err(|_| "LIVE_INFO_FILE")?;
    if bytes.len() > 16384 {
        return Err("LIVE_INFO_FILE");
    }
    let info: LiveInfo = serde_json::from_slice(&bytes).map_err(|_| "LIVE_INFO_JSON")?;
    if info.version != 1
        || info.parent_pid <= 1
        || info.nonce.len() != 48
        || !info
            .nonce
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || info.port == 0
        || info.model_id.is_empty()
        || info.model_id.len() > 256
        || info.model_id.chars().any(char::is_control)
        || info.relay_token != format!("sidekick-p5-relay-{}", info.nonce)
        || info.case != LIVE_CASE
    {
        return Err("LIVE_INFO_CONTRACT");
    }
    let expected = Path::new("/tmp")
        .canonicalize()
        .map_err(|_| "LIVE_BASE")?
        .join(format!(
            "sidekick-p5-live-{}-{}",
            info.parent_pid, info.nonce
        ));
    if info.base != expected
        || path != expected.join("live-info.json")
        || info.base.canonicalize().map_err(|_| "LIVE_BASE")? != expected
    {
        return Err("LIVE_BASE");
    }
    let base = fs::symlink_metadata(&info.base).map_err(|_| "LIVE_BASE")?;
    if !secure_metadata(&base, owner, 0o700, true) {
        return Err("LIVE_BASE");
    }
    if fs::symlink_metadata(info.base.join("app")).is_ok()
        || fs::symlink_metadata(info.base.join("workspace")).is_ok()
    {
        return Err("LIVE_ROOT_EXISTS");
    }
    let exe = std::env::current_exe()
        .map_err(|_| "LIVE_EXE")?
        .canonicalize()
        .map_err(|_| "LIVE_EXE")?;
    if info.exe != exe || info.exe.canonicalize().map_err(|_| "LIVE_EXE")? != exe {
        return Err("LIVE_EXE");
    }
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args != ["--exact", LIVE_CASE, "--test-threads=1", "--nocapture"] {
        return Err("LIVE_ARGS");
    }
    let parent = Command::new("/bin/ps")
        .args(["-p", &std::process::id().to_string(), "-o", "ppid="])
        .output()
        .map_err(|_| "LIVE_PARENT")?;
    if !parent.status.success()
        || String::from_utf8_lossy(&parent.stdout)
            .trim()
            .parse::<u32>()
            .ok()
            != Some(info.parent_pid)
    {
        return Err("LIVE_PARENT");
    }
    let parent = Command::new("/bin/ps")
        .args([
            "-ww",
            "-p",
            &info.parent_pid.to_string(),
            "-o",
            "stat=,command=",
        ])
        .output()
        .map_err(|_| "LIVE_PARENT")?;
    let parent_command = String::from_utf8(parent.stdout).map_err(|_| "LIVE_PARENT")?;
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/probes/run-mcp-live.py")
        .canonicalize()
        .map_err(|_| "LIVE_PARENT")?;
    if !parent.status.success()
        || parent_command
            .split_whitespace()
            .next()
            .is_none_or(|state| state.starts_with('Z'))
        || !parent_command
            .split_whitespace()
            .any(|argument| argument == script.to_string_lossy())
    {
        return Err("LIVE_PARENT");
    }
    let after = fs::symlink_metadata(path).map_err(|_| "LIVE_INFO_FILE")?;
    let base_after = fs::symlink_metadata(&info.base).map_err(|_| "LIVE_BASE")?;
    if identity(&after) != identity(&opened)
        || !secure_metadata(&after, owner, 0o600, false)
        || identity(&base) != identity(&base_after)
        || !secure_metadata(&base_after, owner, 0o700, true)
    {
        return Err("LIVE_IDENTITY_CHANGED");
    }
    Ok(LiveGuard {
        info,
        base_identity: identity(&base),
    })
}
fn write_live_allow(guard: &LiveGuard, server_id: &str) {
    let base = fs::symlink_metadata(&guard.info.base).unwrap();
    assert_eq!(identity(&base), guard.base_identity);
    assert!(secure_metadata(&base, uid().unwrap(), 0o700, true));
    let name = format!(
        "mcp_{}",
        &format!(
            "{:x}",
            Sha256::digest(format!("{server_id}\0lookup").as_bytes())
        )[..56]
    );
    let allow = json!({"version":1,"nonce":guard.info.nonce,"tools":[{"name":name,"parameters":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}}],"source":SOURCE,"instruction":INSTRUCTION});
    let path = guard.info.base.join("allow.json");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(nofollow())
        .open(&path)
        .unwrap();
    assert!(secure_metadata(
        &file.metadata().unwrap(),
        uid().unwrap(),
        0o600,
        false
    ));
    file.write_all(&serde_json::to_vec(&allow).unwrap())
        .unwrap();
    file.sync_all().unwrap();
    File::open(&guard.info.base).unwrap().sync_all().unwrap();
    assert_eq!(
        identity(&fs::symlink_metadata(&path).unwrap()),
        identity(&file.metadata().unwrap())
    );
}
fn write_live_output_diagnostics(
    guard: &LiveGuard,
    events: &[OutputDiagnosticEvent],
) -> std::result::Result<(), &'static str> {
    let owner = uid()?;
    let base = &guard.info.base;
    if base.canonicalize().map_err(|_| "LIVE_OUTPUT_BASE")? != *base {
        return Err("LIVE_OUTPUT_BASE");
    }
    let before = fs::symlink_metadata(base).map_err(|_| "LIVE_OUTPUT_BASE")?;
    if identity(&before) != guard.base_identity || !secure_metadata(&before, owner, 0o700, true) {
        return Err("LIVE_OUTPUT_BASE");
    }
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(nofollow())
        .open(base)
        .map_err(|_| "LIVE_OUTPUT_BASE")?;
    let opened = directory.metadata().map_err(|_| "LIVE_OUTPUT_BASE")?;
    if identity(&opened) != guard.base_identity || !secure_metadata(&opened, owner, 0o700, true) {
        return Err("LIVE_OUTPUT_BASE");
    }
    if events.len() > 64 {
        return Err("LIVE_OUTPUT_LIMIT");
    }
    let mut bytes = serde_json::to_vec(&json!({"version":1,"events":events}))
        .map_err(|_| "LIVE_OUTPUT_JSON")?;
    bytes.push(b'\n');
    if bytes.len() > 16384 {
        return Err("LIVE_OUTPUT_LIMIT");
    }
    let path = base.join("output-diagnostics.json");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(nofollow())
        .open(&path)
        .map_err(|_| "LIVE_OUTPUT_FILE")?;
    let initial = file.metadata().map_err(|_| "LIVE_OUTPUT_FILE")?;
    if !secure_metadata(&initial, owner, 0o600, false) {
        return Err("LIVE_OUTPUT_FILE");
    }
    file.write_all(&bytes).map_err(|_| "LIVE_OUTPUT_WRITE")?;
    file.sync_all().map_err(|_| "LIVE_OUTPUT_WRITE")?;
    let after = fs::symlink_metadata(&path).map_err(|_| "LIVE_OUTPUT_FILE")?;
    let base_after = fs::symlink_metadata(base).map_err(|_| "LIVE_OUTPUT_BASE")?;
    if identity(&after) != identity(&initial)
        || !secure_metadata(&after, owner, 0o600, false)
        || identity(&base_after) != guard.base_identity
        || !secure_metadata(&base_after, owner, 0o700, true)
        || base.canonicalize().map_err(|_| "LIVE_OUTPUT_BASE")? != *base
    {
        return Err("LIVE_OUTPUT_IDENTITY");
    }
    directory.sync_all().map_err(|_| "LIVE_OUTPUT_WRITE")?;
    Ok(())
}

#[test]
fn formal_output_diagnostic_summary_rejects_unsafe_or_existing_targets() {
    let fixture = TrialFixture::new("normal", true, true);
    let base = fixture.root.join("output-summary");
    fs::create_dir(&base).unwrap();
    fs::set_permissions(&base, fs::Permissions::from_mode(0o700)).unwrap();
    let guard = LiveGuard {
        base_identity: identity(&fs::symlink_metadata(&base).unwrap()),
        info: LiveInfo {
            version: 1,
            parent_pid: std::process::id(),
            nonce: "controlled".into(),
            base: base.clone(),
            exe: PathBuf::new(),
            case: LIVE_CASE.into(),
            port: 1,
            relay_token: "controlled".into(),
            model_id: "synthetic".into(),
        },
    };
    let path = base.join("output-diagnostics.json");
    fs::write(&path, b"controlled-existing-summary\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        write_live_output_diagnostics(&guard, &[]),
        Err("LIVE_OUTPUT_FILE")
    );
    assert_eq!(fs::read(&path).unwrap(), b"controlled-existing-summary\n");
    fs::remove_file(&path).unwrap();
    fs::set_permissions(&base, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        write_live_output_diagnostics(&guard, &[]),
        Err("LIVE_OUTPUT_BASE")
    );
    assert!(!path.exists());
    fs::set_permissions(&base, fs::Permissions::from_mode(0o700)).unwrap();
    write_live_output_diagnostics(&guard, &[]).unwrap();
    let metadata = fs::symlink_metadata(&path).unwrap();
    assert!(secure_metadata(&metadata, uid().unwrap(), 0o600, false));
    assert_eq!(fs::read(&path).unwrap(), b"{\"events\":[],\"version\":1}\n");
}
struct RelayEnv(String);
impl Drop for RelayEnv {
    fn drop(&mut self) {
        std::env::remove_var(&self.0);
    }
}
fn live_roundtrip(path: &Path) {
    let guard = read_live_guard(path).unwrap_or_else(|code| panic!("{code}"));
    let info = &guard.info;
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../build/s0-runtime")
        .canonicalize()
        .unwrap();
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/mcp-trial.mjs")
        .canonicalize()
        .unwrap();
    let key = format!("SIDEKICK_P5_RELAY_{}", info.nonce);
    assert!(std::env::var_os(&key).is_none());
    let _relay_env = RelayEnv(key.clone());
    std::env::set_var(&key, &info.relay_token);
    let local = LocalState::new(info.base.join("app"));
    let saved = local.access(|store| {
        store.initialize(Some(info.base.join("workspace")), "UTC")?;
        store.upgrade_mcp_storage()?;
        store.save_models(ModelConfigInput { expected_revision: None, providers: json!({"providers":[{"id":"deepseek","apiFormat":"openai-compatible","baseUrl":format!("http://127.0.0.1:{}/v1",info.port),"auth":{"type":"bearer","apiKeyEnv":key},"enabled":true,"network":{"timeoutMs":120000,"retry":{"maxRetries":0}}}]}), models: json!({"models":[{"id":"p5-relay","providerId":"deepseek","apiModelId":info.model_id,"capabilities":{"toolCall":true,"input":["text"]}}]}), default_model_id: "p5-relay".into(), api_keys: Default::default() })?;
        let role = store.agent_config("organizer")?;
        store.save_agent_config(AgentConfigInput { agent_id: role.agent_id, expected_revision: role.revision, model_id: None, preferences: role.preferences, supplemental_instructions: "先自行选择并调用已注册的受控 MCP lookup 工具，参数为 {\"text\":\"controlled\"}，再按既有输出格式完成任务。".into() })?;
        store.save_mcp_server(McpServerInput { id: None, expected_revision: store.mcp_configuration()?.revision, server: serde_json::from_value(json!({"name":"P5 controlled lookup","transport":"stdio","enabled":true,"command":directory.join("node"),"args":[fixture,"service",info.base.join("service.jsonl"),"normal"],"cwd":null,"env":[],"connectTimeoutMs":3000,"toolTimeoutMs":1000})).unwrap() })
    }).unwrap();
    let server_id = saved.configuration.servers[0].id.clone();
    write_live_allow(&guard, &server_id);
    let runtime = RuntimeState::default();
    *runtime.trial_policy.lock().unwrap() = Some("mcp-only-diagnostic");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut evidence = roundtrip(
            &local,
            &runtime,
            &directory,
            &info.base.join("workspace"),
            1,
        );
        let events = fs::read_to_string(info.base.join("service.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            events
                .iter()
                .filter(|event| event["type"] == "call")
                .count(),
            3
        );
        for event in events.iter().filter(|event| event["type"] == "call") {
            assert_eq!(event["name"], "lookup");
            assert_eq!(event["arguments"], json!({"text":"controlled"}));
        }
        for event in events.iter().filter(|event| event["type"] == "pid") {
            assert_eq!(event["modelKeyPresent"], false);
        }
        evidence["serviceCounts"] = json!({"lookup":3});
        evidence
    }));
    let events = runtime
        .output_diagnostics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let written = write_live_output_diagnostics(&guard, &events);
    let evidence = match outcome {
        Ok(evidence) => {
            written.unwrap_or_else(|code| panic!("{code}"));
            evidence
        }
        Err(panic) => {
            if let Err(code) = written {
                eprintln!("{code}");
            }
            std::panic::resume_unwind(panic);
        }
    };
    println!(
        "P5_LIVE_EVIDENCE {}",
        serde_json::to_string(&evidence).unwrap()
    );
}

#[test]
fn formal_output_diagnostic_roundtrip_records_all_real_boundaries() {
    let fixture = TrialFixture::new("normal", true, true);
    *fixture.runtime.trial_policy.lock().unwrap() = Some("mcp-only-diagnostic");
    let evidence = roundtrip(
        fixture.local.as_ref().unwrap(),
        &fixture.runtime,
        &fixture.directory,
        &fixture.root.join("workspace"),
        2,
    );
    let calls = evidence["calls"].as_array().unwrap();
    let ids = calls
        .iter()
        .step_by(2)
        .map(|call| call["runId"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(ids.len(), 3);
    let events = fixture.runtime.output_diagnostics.lock().unwrap();
    assert_eq!(events.len(), 9);
    for ((group, kind), id) in events
        .chunks_exact(3)
        .zip(["extract", "revise", "trial"])
        .zip(ids)
    {
        for (event, stage) in group
            .iter()
            .zip(["runtime-result", "rust-decode", "rust-publish"])
        {
            assert_eq!(event.run_id, id);
            assert_eq!(event.kind, kind);
            assert_eq!(event.stage, stage);
            assert_eq!(event.outcome, "ok");
            assert_eq!(event.code, None);
        }
        let value: Value = serde_json::from_slice(
            &fs::read(
                fixture
                    .root
                    .join("workspace/runs")
                    .join(id)
                    .join("output-diagnostic.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(value["runId"], id);
        assert_eq!(value["kind"], kind);
        assert_eq!(value["outcome"], "validated");
    }
}

#[test]
fn formal_live_guard_rejects_before_store_or_workspace_creation() {
    let nonce = crate::mcp_host::nonce();
    let base = Path::new("/tmp")
        .canonicalize()
        .unwrap()
        .join(format!("sidekick-p5-live-{}-{nonce}", std::process::id()));
    fs::create_dir(&base).unwrap();
    fs::set_permissions(&base, fs::Permissions::from_mode(0o700)).unwrap();
    let path = base.join("live-info.json");
    let valid = json!({"version":1,"parentPid":std::process::id(),"nonce":nonce,"base":base,"exe":std::env::current_exe().unwrap().canonicalize().unwrap(),"case":LIVE_CASE,"port":1234,"relayToken":format!("sidekick-p5-relay-{nonce}"),"modelId":"synthetic"});
    for (field, value, expected) in [
        ("unexpected", json!(true), "LIVE_INFO_JSON"),
        ("version", json!(2), "LIVE_INFO_CONTRACT"),
        ("port", json!(0), "LIVE_INFO_CONTRACT"),
        (
            "relayToken",
            json!("not-a-real-token"),
            "LIVE_INFO_CONTRACT",
        ),
        ("base", json!("/tmp/unrelated"), "LIVE_BASE"),
        ("exe", json!("/bin/false"), "LIVE_EXE"),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = value;
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read_live_guard(&path).err(), Some(expected));
        assert!(!base.join("app").exists());
        assert!(!base.join("workspace").exists());
    }
    fs::write(&path, serde_json::to_vec(&valid).unwrap()).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(read_live_guard(&path).err(), Some("LIVE_INFO_FILE"));
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let hard = base.join("hardlink");
    fs::hard_link(&path, &hard).unwrap();
    assert_eq!(read_live_guard(&path).err(), Some("LIVE_INFO_FILE"));
    fs::remove_file(hard).unwrap();
    let link = base.join("link");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert_eq!(read_live_guard(&link).err(), Some("LIVE_INFO_FILE"));
    assert_eq!(read_live_guard(&path).err(), Some("LIVE_ARGS"));
    assert!(!base.join("app").exists());
    assert!(!base.join("workspace").exists());
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn formal_mcp_only_trial_has_only_mcp_tools_and_no_skill_metadata() {
    let fixture = TrialFixture::new("normal", true, true);
    *fixture.runtime.trial_policy.lock().unwrap() = Some("mcp-only");
    let evidence = roundtrip(
        fixture.local.as_ref().unwrap(),
        &fixture.runtime,
        &fixture.directory,
        &fixture.root.join("workspace"),
        2,
    );
    assert_eq!(evidence["calls"].as_array().unwrap().len(), 6);
    let requests = fixture.events("model.jsonl");
    assert_eq!(requests.len(), 6);
    for request in requests {
        let names = request["allNames"].as_array().unwrap();
        assert_eq!(names.len(), 2);
        assert!(names
            .iter()
            .all(|name| name.as_str().unwrap().starts_with("mcp_")));
        assert_eq!(request["hasSkills"], false);
    }
}

#[test]
fn formal_live_foreign_parent_is_rejected_before_store() {
    let nonce = crate::mcp_host::nonce();
    let claimed_parent = std::process::id() + 1000000;
    let base = Path::new("/tmp")
        .canonicalize()
        .unwrap()
        .join(format!("sidekick-p5-live-{claimed_parent}-{nonce}"));
    fs::create_dir(&base).unwrap();
    fs::set_permissions(&base, fs::Permissions::from_mode(0o700)).unwrap();
    let path = base.join("live-info.json");
    let exe = std::env::current_exe().unwrap().canonicalize().unwrap();
    let info = json!({"version":1,"parentPid":claimed_parent,"nonce":nonce,"base":base,"exe":exe,"case":LIVE_CASE,"port":1234,"relayToken":format!("sidekick-p5-relay-{nonce}"),"modelId":"synthetic"});
    fs::write(&path, serde_json::to_vec(&info).unwrap()).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let child = Command::new(exe)
        .args(["--exact", LIVE_CASE, "--test-threads=1", "--nocapture"])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("SIDEKICK_P5_LIVE_INFO", &path)
        .output()
        .unwrap();
    assert!(!child.status.success());
    assert!(String::from_utf8_lossy(&child.stdout).contains("FAILED"));
    assert!(String::from_utf8_lossy(&child.stderr).contains("LIVE_PARENT"));
    assert!(!base.join("app").exists());
    assert!(!base.join("workspace").exists());
    assert!(!base.join("allow.json").exists());
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn formal_v3_workspaces_keep_the_original_text_path_without_an_upgrade() {
    let fixture = TrialFixture::new("normal", true, true);
    let configuration = fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.read_models())
        .unwrap()
        .unwrap();
    let local = LocalState::new(fixture.root.join("v3-app"));
    let workspace = fixture.root.join("v3-workspace");
    local
        .access(|store| {
            store.initialize(Some(workspace.clone()), "UTC")?;
            store.save_models(ModelConfigInput {
                expected_revision: None,
                providers: configuration.providers,
                models: configuration.models,
                default_model_id: configuration.default_model_id,
                api_keys: Default::default(),
            })?;
            assert_eq!(store.mcp_storage_status()?.version, 3);
            Ok(())
        })
        .unwrap();
    let runtime = RuntimeState::default();
    let run = runtime
        .start(
            local.clone(),
            fixture.directory.clone(),
            StartTask::Extract {
                input: input(),
                retry: false,
            },
            Arc::new(|_, _| {}),
        )
        .unwrap();
    let completed = wait_run(&runtime, &local, &run.id);
    assert_eq!(completed.status, "succeeded", "{:?}", completed.error_code);
    assert!(completed.snapshot.get("mcp").is_none());
    assert_eq!(
        local
            .access(|store| store.mcp_storage_status())
            .unwrap()
            .version,
        3
    );
    assert_eq!(count(&database(&workspace), "candidates"), 1);
    assert_eq!(count(&database(&workspace), "todos"), 0);
    for index in 0..2 {
        assert!(fixture.events(&format!("service-{index}.jsonl")).is_empty());
    }
    assert_eq!(fixture.events("model.jsonl").len(), 1);
}

#[test]
fn formal_enabled_mcp_preparation_failure_does_not_silently_skip_the_service() {
    let fixture = TrialFixture::new("normal", true, true);
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| {
            let configuration = store.mcp_configuration()?;
            let mut settings = configuration.servers[0].settings.clone();
            settings.stdio_mut().unwrap().command =
                "/sidekick-synthetic-command-does-not-exist".into();
            store.save_mcp_server(McpServerInput {
                id: Some(configuration.servers[0].id.clone()),
                expected_revision: configuration.revision,
                server: settings,
            })?;
            Ok(())
        })
        .unwrap();
    let run = extract(&fixture);
    let result = wait_business(&fixture, &run.id);
    assert_eq!(result.status, "failed");
    assert_eq!(result.error_code.as_deref(), Some("MCP_COMMAND_MISSING"));
    assert!(fixture.calls().is_empty());
    assert!(fixture.events("model.jsonl").is_empty());
    assert_eq!(count(&fixture.database(), "sources"), 1);
    assert_eq!(count(&fixture.database(), "candidates"), 0);
    assert_eq!(count(&fixture.database(), "todos"), 0);
    for index in 0..2 {
        assert!(fixture.events(&format!("service-{index}.jsonl")).is_empty());
    }
}
