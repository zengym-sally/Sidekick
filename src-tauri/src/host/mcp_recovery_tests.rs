use super::mcp_trial_tests::TrialFixture;
use super::*;
use crate::local_store::{McpServerInput, TodoInput};
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use std::fs;

#[path = "mcp_host_recovery_tests.rs"]
mod host_crash;

pub(super) fn table_snapshot(workspace: &Path) -> Value {
    let db = Connection::open_with_flags(
        workspace.join("data/sidekick.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .unwrap();
    let mut result = serde_json::Map::new();
    for table in ["sources", "candidates", "todos", "todo_events", "runs"] {
        let mut statement = db
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let names = statement
            .column_names()
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        let rows = statement
            .query_map([], |row| {
                let mut values = serde_json::Map::new();
                for (index, name) in names.iter().enumerate() {
                    let value = match row.get_ref(index)? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(v) => json!(v),
                        ValueRef::Real(v) => json!(v),
                        ValueRef::Text(v) => json!(std::str::from_utf8(v).unwrap()),
                        ValueRef::Blob(v) => json!(v),
                    };
                    values.insert(name.clone(), value);
                }
                Ok(Value::Object(values))
            })
            .unwrap()
            .map(|row| row.unwrap())
            .collect::<Vec<_>>();
        result.insert(table.into(), Value::Array(rows));
    }
    Value::Object(result)
}

fn seed(fixture: &TrialFixture) -> Value {
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| {
            store.create(
                TodoInput {
                    title: "P4 controlled baseline".into(),
                    kind: "action".into(),
                    owner: "我".into(),
                    priority: "medium".into(),
                    due: None,
                    followup: None,
                    tags: vec!["p4-baseline".into()],
                },
                "p4-baseline",
            )
        })
        .unwrap();
    table_snapshot(&fixture.root.join("workspace"))
}
fn process(pid: u32) -> Option<(u32, u32, String, String)> {
    let output = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "ppid=,pgid=,stat=,command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut fields = text.split_whitespace();
    Some((
        fields.next()?.parse().ok()?,
        fields.next()?.parse().ok()?,
        fields.next()?.into(),
        fields.collect::<Vec<_>>().join(" "),
    ))
}
fn alive(pid: u32) -> bool {
    process(pid).is_some_and(|(_, _, state, _)| !state.starts_with('Z'))
}
fn assert_processes(fixture: &TrialFixture, owners: &[crate::mcp_host::Owner], runtime: u32) {
    assert!(!alive(runtime));
    for owner in owners {
        assert!(!alive(owner.guardian));
        assert!(!alive(owner.keeper));
        assert!(crate::mcp_host::group_gone(owner.guardian));
    }
    for index in 0..2 {
        for event in fixture.events(&format!("service-{index}.jsonl")) {
            if event["type"] == "pid" {
                assert!(!alive(event["pid"].as_u64().unwrap() as u32));
                assert_eq!(event["modelKeyPresent"], false);
            }
        }
    }
    assert!(alive(fixture.model.id()));
}
fn wait_call(fixture: &TrialFixture) {
    let started = Instant::now();
    while !fixture
        .events("service-0.jsonl")
        .iter()
        .any(|e| e["type"] == "call")
    {
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn actual_store_failures_preserve_the_committed_send_boundary() {
    for (policy, count, states) in [
        ("store-begin-before", 0, vec![]),
        ("store-begin-after", 0, vec!["unknown"]),
        ("store-response-before", 1, vec!["unknown"]),
        ("store-response-after", 1, vec!["responded"]),
    ] {
        let mut fixture = TrialFixture::new("normal", true, true);
        let before = seed(&fixture);
        *fixture.runtime.trial_policy.lock().unwrap() = Some(policy);
        let run = fixture.start();
        let result = fixture.wait(&run.id);
        assert_eq!(result.status, "failed", "{policy}");
        assert_eq!(
            fixture
                .calls()
                .iter()
                .map(|row| row.0.as_str())
                .collect::<Vec<_>>(),
            states,
            "{policy}"
        );
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
            0
        );
        assert_eq!(
            result.error_code.as_deref() == Some("MCP_RESULT_UNKNOWN"),
            states.contains(&"unknown")
        );
        assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
        let reopened = fixture.reopen(&run.id);
        assert_eq!(reopened.error_code, result.error_code);
        assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
    }
}

#[test]
fn explicit_fresh_retry_intent_cannot_replay_an_unknown_operation() {
    let expected_read = {
        let fixture = TrialFixture::new("recovery-read-control", true, true);
        let before = seed(&fixture);
        let run = fixture.start();
        let result = fixture.wait(&run.id);
        assert_eq!(result.status, "succeeded");
        assert!(fixture.calls().is_empty());
        let model = fixture.events("model.jsonl");
        assert_eq!(model.len(), 2);
        let target = Path::new(model[0]["readPath"].as_str().unwrap());
        assert_eq!(
            target,
            Path::new(
                run.snapshot["skills"]["index"][0]["filePath"]
                    .as_str()
                    .unwrap()
            )
        );
        let relative = target
            .strip_prefix(
                Path::new(run.snapshot["skills"]["root"].as_str().unwrap())
                    .parent()
                    .unwrap(),
            )
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
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
        assert_eq!(proof, json!([{"type":"read","path":relative}]));
        assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
        relative
    };
    let mut fixture = TrialFixture::new("recovery-retry", true, true);
    let before = seed(&fixture);
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
    let model = fixture.events("model.jsonl");
    let target = Path::new(model[0]["readPath"].as_str().unwrap());
    assert_eq!(
        target,
        Path::new(
            run.snapshot["skills"]["index"][0]["filePath"]
                .as_str()
                .unwrap()
        )
    );
    assert_eq!(
        target
            .strip_prefix(
                Path::new(run.snapshot["skills"]["root"].as_str().unwrap())
                    .parent()
                    .unwrap()
            )
            .unwrap()
            .to_str()
            .unwrap(),
        expected_read
    );
    assert!(!fixture.root.join("forbidden-marker").exists());
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
    assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
    let first_time = result.finished_at_ms;
    for _ in 0..2 {
        let row = fixture
            .local
            .as_ref()
            .unwrap()
            .access(|s| s.cancel_agent_trial(&run.id))
            .unwrap();
        assert_eq!(row.error_code, result.error_code);
        assert_eq!(row.finished_at_ms, first_time);
    }
    assert_eq!(fixture.reopen(&run.id).error_code, result.error_code);
    assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
}

fn modes(fixture: &TrialFixture, mode: &str) {
    fixture
        .local
        .as_ref()
        .unwrap()
        .access(|store| {
            let servers = store.mcp_configuration()?.servers;
            for server in servers {
                let mut settings = server.settings;
                settings.stdio_mut().unwrap().args[3] = mode.into();
                store.save_mcp_server(McpServerInput {
                    id: Some(server.id),
                    expected_revision: store.mcp_configuration()?.revision,
                    server: settings,
                })?;
            }
            Ok(())
        })
        .unwrap();
}
#[test]
fn cumulative_result_budget_accepts_exact_limit_and_rejects_one_extra_byte() {
    for (mode, expected) in [
        ("recovery-budget-at", 524288_u64),
        ("recovery-budget-over", 524289),
    ] {
        let fixture = TrialFixture::new(mode, true, true);
        modes(&fixture, mode);
        let before = seed(&fixture);
        let run = fixture.start();
        let result = fixture.wait(&run.id);
        let events = (0..2)
            .flat_map(|index| fixture.events(&format!("service-{index}.jsonl")))
            .collect::<Vec<_>>();
        assert_eq!(
            events
                .iter()
                .filter(|event| event["type"] == "result_bytes")
                .map(|event| event["bytes"].as_u64().unwrap())
                .sum::<u64>(),
            expected
        );
        let rows = fixture.calls();
        assert!(events
            .iter()
            .filter(|event| event["type"] == "result_bytes")
            .all(|event| event["characters"].as_u64().unwrap() < event["bytes"].as_u64().unwrap()));
        assert_eq!(rows.iter().filter(|row| row.0 == "responded").count(), 2);
        if expected == 524288 {
            assert_eq!(result.status, "succeeded");
            assert_eq!(rows.len(), 2);
        } else {
            assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
            assert_eq!(rows.len(), 3);
            assert_eq!(rows.iter().filter(|row| row.0 == "unknown").count(), 1);
            assert_eq!(
                fixture
                    .events("service-1.jsonl")
                    .iter()
                    .filter(|event| event["type"] == "call")
                    .count(),
                0
            );
            assert_eq!(fixture.events("model.jsonl").len(), 1);
        }
        assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
    }
}

#[test]
fn registered_guardian_keeper_and_service_kills_reap_both_groups() {
    for target in ["runtime", "guardian", "keeper", "service"] {
        let mut fixture = TrialFixture::new("recovery-retry", true, true);
        let before = seed(&fixture);
        let run = fixture.start();
        wait_call(&fixture);
        let job = fixture
            .runtime
            .slot
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .clone();
        let runtime = job.pid.load(Ordering::SeqCst);
        let owners = crate::mcp_trial::test_trial_owners(&job);
        assert_eq!(owners.len(), 2);
        let service_pid = fixture
            .events("service-0.jsonl")
            .iter()
            .find(|event| event["type"] == "pid" && event["role"] == "service")
            .unwrap()["pid"]
            .as_u64()
            .unwrap() as u32;
        let service_process = process(service_pid).unwrap();
        let owner = owners
            .iter()
            .find(|owner| owner.guardian == service_process.1)
            .unwrap();
        assert_eq!(owner.run, run.id);
        assert_eq!(service_process.0, owner.guardian);
        assert!(service_process.3.contains(
            &fixture
                .root
                .join("service-0.jsonl")
                .to_string_lossy()
                .to_string()
        ));
        let pid = match target {
            "runtime" => runtime,
            "guardian" => owner.guardian,
            "keeper" => owner.keeper,
            _ => service_pid,
        };
        let current = process(pid).unwrap();
        assert!(!current.2.starts_with('Z'));
        assert_eq!(
            current.1,
            if target == "runtime" {
                runtime
            } else {
                owner.guardian
            }
        );
        if target == "runtime" {
            assert_eq!(current.0, std::process::id());
            assert!(current
                .3
                .contains(fixture.directory.join("organizer.mjs").to_str().unwrap()));
            assert!(current.3.contains(&format!("--run {}", run.id)));
        } else if target != "service" {
            assert!(current.3.contains(&format!("--run {} ", run.id)));
            assert!(current.3.contains(&format!("--nonce {} ", owner.nonce)));
        }
        assert!(Command::new("/bin/kill")
            .args(["-KILL", &pid.to_string()])
            .status()
            .unwrap()
            .success());
        let result = fixture.wait(&run.id);
        assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
        assert_eq!(fixture.calls(), vec![("unknown".into(), String::new())]);
        assert_processes(&fixture, &owners, runtime);
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
        assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
        let receipts = fixture.calls();
        let services = [
            fixture.events("service-0.jsonl"),
            fixture.events("service-1.jsonl"),
        ];
        let model = fixture.events("model.jsonl");
        let reopened = fixture.reopen(&run.id);
        assert_eq!(reopened.error_code, result.error_code);
        assert_eq!(reopened.finished_at_ms, result.finished_at_ms);
        assert_eq!(fixture.calls(), receipts);
        assert_eq!(
            [
                fixture.events("service-0.jsonl"),
                fixture.events("service-1.jsonl")
            ],
            services
        );
        assert_eq!(fixture.events("model.jsonl"), model);
        assert_processes(&fixture, &owners, runtime);
        assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
    }
}

#[test]
fn stalled_input_and_invalid_stdout_cannot_hang_or_publish_partial_success() {
    for mode in [
        "no-read",
        "result-tail",
        "large-frame",
        "many-frames",
        "total-bytes",
    ] {
        let mut fixture = TrialFixture::new("normal", false, false);
        let before = seed(&fixture);
        let directory = fixture.root.join("fault-runtime");
        fs::create_dir(&directory).unwrap();
        std::os::unix::fs::symlink(fixture.directory.join("node"), directory.join("node")).unwrap();
        fs::copy(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../tests/fixtures/mcp-runtime-fault.mjs"),
            directory.join("organizer.mjs"),
        )
        .unwrap();
        fs::write(directory.join("mode.txt"), mode).unwrap();
        fixture.directory = directory.clone();
        *fixture.runtime.trial_policy.lock().unwrap() = Some("short-io");
        let run = fixture
            .runtime
            .start_trial(
                fixture.local.as_ref().unwrap().clone(),
                directory.clone(),
                "organizer",
                TextInput {
                    text: if mode == "no-read" {
                        "合".repeat(63000)
                    } else {
                        "我整理合成清单。".into()
                    },
                    source_at_ms: None,
                    time_zone: "UTC".into(),
                },
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let result = fixture.wait(&run.id);
        assert_eq!(result.status, "failed");
        assert_eq!(
            result.error_code.as_deref(),
            Some(if mode == "no-read" {
                "MODEL_TIMEOUT"
            } else {
                "RUNTIME_PROTOCOL"
            })
        );
        assert!(fixture.calls().is_empty());
        assert!(fixture.events("model.jsonl").is_empty());
        assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
        assert!(alive(fixture.model.id()));
        if mode == "total-bytes" {
            fs::write(directory.join("mode.txt"), "result-only").unwrap();
            let next = fixture.start();
            assert_eq!(fixture.wait(&next.id).status, "succeeded");
            assert!(fixture.calls().is_empty());
            assert!(fixture.events("model.jsonl").is_empty());
            assert_eq!(table_snapshot(&fixture.root.join("workspace")), before);
        }
    }
}
