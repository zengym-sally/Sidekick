use super::mcp_trial_tests::TrialFixture;
use super::*;
use crate::local_store::{AgentConfigInput, ModelConfigInput};
fn clues() -> TextInput {
    TextInput {
        text: "林川已提交SDK鉴权修复，等待我验收。".into(),
        source_at_ms: Some(1793239200000),
        time_zone: "Asia/Shanghai".into(),
    }
}
fn start(f: &TrialFixture) -> AgentRun {
    f.runtime
        .start_trial(
            f.local.as_ref().unwrap().clone(),
            f.directory.clone(),
            "advisor",
            clues(),
            Arc::new(|_, _| {}),
        )
        .unwrap()
}
fn rows(db: &rusqlite::Connection) -> Vec<Value> {
    [
        "sources",
        "candidates",
        "todos",
        "todo_events",
        "todo_sources",
        "tool_calls",
    ]
    .into_iter()
    .map(|table| {
        let mut q = db
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let width = q.column_count();
        let values: Vec<Vec<String>> = q
            .query_map([], |r| {
                (0..width)
                    .map(|i| r.get_ref(i).map(|v| format!("{v:?}")))
                    .collect()
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        json!({"table":table,"rows":values})
    })
    .collect()
}
fn formal(f: &TrialFixture) {
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            let fields = crate::local_store::TodoInput {
                title: "合成正式跟进".into(),
                kind: "followup".into(),
                owner: "合成负责人".into(),
                priority: "medium".into(),
                tags: vec![],
                due: None,
                followup: None,
            };
            s.create(fields.clone(), "advisor-manual-baseline")?;
            let batch = s.begin_import(
                TextInput {
                    text: "合成负责人负责合成正式跟进。".into(),
                    source_at_ms: None,
                    time_zone: "UTC".into(),
                },
                Value::Null,
                false,
            )?;
            let published = s.publish_candidates(
                &batch.run.unwrap().id,
                vec![crate::local_store::CandidateDraft {
                    fields,
                    evidence: "合成负责人负责合成正式跟进。".into(),
                    due_expression: None,
                    followup_expression: None,
                    warnings: vec![],
                    unresolved: false,
                }],
            )?;
            let c = &published.candidates[0];
            s.sign_candidates(
                vec![crate::local_store::SignChoice {
                    candidate_id: c.id.clone(),
                    expected_version: c.version,
                    fields: c.draft.fields.clone(),
                    time_reviewed: true,
                    target: None,
                }],
                "advisor-signed-baseline",
            )?;
            Ok(())
        })
        .unwrap();
}

fn wait_request(f: &TrialFixture) {
    let start = Instant::now();
    while f.events("model.jsonl").is_empty() {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(20));
    }
}
#[test]
fn advisor_real_pi_keeps_nonempty_formal_rows_and_config_snapshot() {
    let mut f = TrialFixture::new("advisor-freeze", true, true);
    formal(&f);
    let before = rows(&f.database());
    assert!(before[..5]
        .iter()
        .all(|table| !table["rows"].as_array().unwrap().is_empty()));
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            let c = s.agent_config("advisor")?;
            s.save_agent_config(AgentConfigInput {
                agent_id: "advisor".into(),
                expected_revision: c.revision,
                model_id: None,
                preferences: crate::local_store::AgentPreferences {
                    detail: "detailed".into(),
                    focus: "followup".into(),
                },
                supplemental_instructions: "合成偏好".into(),
            })?;
            Ok(())
        })
        .unwrap();
    let run = start(&f);
    wait_request(&f);
    assert_eq!(
        f.runtime
            .start_trial(
                f.local.as_ref().unwrap().clone(),
                f.directory.clone(),
                "organizer",
                clues(),
                Arc::new(|_, _| {})
            )
            .unwrap_err()
            .code,
        "RUNTIME_BUSY"
    );
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            let c = s.agent_config("advisor")?;
            s.reset_agent_config("advisor", &c.revision)?;
            let c = s.read_models()?.unwrap();
            let mut models = c.models;
            models["models"][0]["apiModelId"] = "changed-after-start".into();
            s.save_models(ModelConfigInput {
                expected_revision: Some(c.revision),
                providers: c.providers,
                models,
                default_model_id: c.default_model_id,
                api_keys: Default::default(),
            })?;
            Ok(())
        })
        .unwrap();
    std::fs::write(f.root.join("forbidden-marker.continue"), "continue").unwrap();
    let result = f.wait(&run.id);
    assert_eq!(result.status, "succeeded", "{:?}", result.error_code);
    assert!(result.result.is_none());
    assert_eq!(
        serde_json::to_value(&result.role_result).unwrap()["ranking"][0]["todoId"],
        "advisor-action"
    );
    assert_eq!(
        result.snapshot["agent"]["preferences"]["detail"],
        "detailed"
    );
    assert_eq!(result.snapshot["model"]["apiModelId"], "synthetic");
    assert!(result.snapshot.get("skills").is_none());
    assert!(result.snapshot.get("mcp").is_none());
    let requests = f.events("model.jsonl");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0]["model"], "synthetic");
    assert_eq!(requests[0]["detail"], true);
    assert_eq!(requests[0]["allNames"], json!([]));
    assert_eq!(requests[0]["hasSkills"], false);
    assert!(!f.root.join("service-0.jsonl").exists());
    assert!(!f.root.join("service-1.jsonl").exists());
    assert!(!f.root.join("forbidden-marker").exists());
    assert_eq!(rows(&f.database()), before);
    let reopened = f.reopen(&run.id);
    assert_eq!(
        serde_json::to_value(&reopened.role_result).unwrap()["ranking"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}
#[test]
fn advisor_invalid_model_result_and_cancelled_late_result_never_publish() {
    for mode in ["advisor-invalid", "advisor-freeze"] {
        let f = TrialFixture::new(mode, true, true);
        formal(&f);
        let before = rows(&f.database());
        let run = start(&f);
        if mode == "advisor-freeze" {
            wait_request(&f);
            f.runtime.cancel(&run.id);
            f.local
                .as_ref()
                .unwrap()
                .access(|s| s.cancel_agent_trial(&run.id))
                .unwrap();
            std::fs::write(f.root.join("forbidden-marker.continue"), "continue").unwrap();
        }
        let result = f.wait(&run.id);
        assert_eq!(
            result.status,
            if mode == "advisor-invalid" {
                "failed"
            } else {
                "cancelled"
            }
        );
        if mode == "advisor-invalid" {
            assert_eq!(result.error_code.as_deref(), Some("MODEL_INVALID_OUTPUT"));
        }
        assert!(result.result.is_none());
        assert!(result.role_result.is_none());
        assert_eq!(rows(&f.database()), before);
        assert!(!f.root.join("service-0.jsonl").exists());
    }
}
#[test]
fn advisor_preserves_existing_unknown_recovery_then_zero_call_write_set() {
    let f = TrialFixture::new("advisor", true, true);
    formal(&f);
    let (old, plain, business) = f
        .local
        .as_ref()
        .unwrap()
        .access(|s| {
            let snapshot = s.prepare_agent_model("organizer")?.snapshot;
            let old = s.begin_prepared_agent_trial("organizer", clues(), snapshot.clone())?;
            let plain = s.begin_prepared_agent_trial("organizer", clues(), snapshot)?;
            let business = s
                .begin_import(
                    TextInput {
                        text: "合成旧业务恢复资料".into(),
                        source_at_ms: None,
                        time_zone: "UTC".into(),
                    },
                    Value::Null,
                    false,
                )?
                .run
                .unwrap();
            Ok((old.id, plain.id, business.id))
        })
        .unwrap();
    rusqlite::Connection::open_with_flags(f.root.join("workspace/data/sidekick.sqlite"), rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW).unwrap().execute("INSERT INTO tool_calls(id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,created_at_ms) VALUES('old-call',?1,'old-model','old-revision',?2,'old-server','old-tool',?2,'possibly_sent',1)",rusqlite::params![old,"a".repeat(64)]).unwrap();
    rusqlite::Connection::open_with_flags(f.root.join("workspace/data/sidekick.sqlite"), rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW).unwrap().execute("INSERT INTO tool_calls(id,run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,created_at_ms) VALUES('old-business-call',?1,'old-business-model','old-revision',?2,'old-server','old-tool',?2,'possibly_sent',1)",rusqlite::params![business,"a".repeat(64)]).unwrap();
    let before = rows(&f.database());
    let run = start(&f);
    let result = f.wait(&run.id);
    assert_eq!(result.status, "succeeded");
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            assert_eq!(
                s.agent_run(&old)?.error_code.as_deref(),
                Some("MCP_RESULT_UNKNOWN")
            );
            assert_eq!(s.agent_run(&plain)?.status, "interrupted");
            assert_eq!(
                s.model_run(&business)?.error_code.as_deref(),
                Some("MCP_RESULT_UNKNOWN")
            );
            Ok(())
        })
        .unwrap();
    let after = rows(&f.database());
    assert_eq!(&before[..5], &after[..5]);
    assert_eq!(f.calls(), vec![("unknown".into(), String::new()); 2]);
    let second = start(&f);
    assert_eq!(f.wait(&second.id).status, "succeeded");
    assert_eq!(rows(&f.database()), after);
    assert_eq!(f.events("model.jsonl").len(), 2);
    assert!(!f.root.join("service-0.jsonl").exists());
}

#[test]
fn advisor_model_cannot_execute_an_unregistered_bash_tool() {
    let f = TrialFixture::new("advisor-tool-injection", true, true);
    formal(&f);
    let before = rows(&f.database());
    let run = start(&f);
    let result = f.wait(&run.id);
    assert_eq!(result.status, "succeeded", "{:?}", result.error_code);
    assert!(!f.root.join("forbidden-marker").exists());
    assert!(!f.root.join("service-0.jsonl").exists());
    assert_eq!(rows(&f.database()), before);
    let requests = f.events("model.jsonl");
    assert_eq!(requests.len(), 2);
    assert!(requests.iter().all(|r| r["allNames"] == json!([])));
}

#[test]
fn advisor_real_pi_preserves_distinct_explanations_and_empty_or_failed_fact_views() {
    for mode in [
        "advisor-alternate",
        "advisor-empty",
        "advisor-invalid-reason",
        "advisor-invalid-date",
        "advisor-invalid-identity",
        "advisor-service-error",
    ] {
        let f = TrialFixture::new(mode, false, true);
        formal(&f);
        let before = rows(&f.database());
        let run = start(&f);
        let result = f.wait(&run.id);
        let succeeds = ["advisor-alternate", "advisor-empty"].contains(&mode);
        assert_eq!(
            result.status,
            if succeeds { "succeeded" } else { "failed" },
            "{mode}: {:?}",
            result.error_code
        );
        assert_eq!(
            result.snapshot["advisorSample"]["counts"],
            json!({"total":4,"open":3,"done":1,"dueToday":1,"followupToday":1,"undated":1})
        );
        assert_eq!(result.input.source_at_ms, Some(1793581200000));
        assert_eq!(result.input.time_zone, "Asia/Shanghai");
        if mode == "advisor-alternate" {
            let answer = serde_json::to_value(&result.role_result).unwrap();
            assert_eq!(answer["ranking"][0]["todoId"], "advisor-followup");
            assert_eq!(answer["ranking"][0]["reasons"][0]["code"], "upcoming_due");
        } else if mode == "advisor-empty" {
            assert_eq!(
                serde_json::to_value(&result.role_result).unwrap()["ranking"],
                json!([])
            );
        } else {
            assert!(result.role_result.is_none());
            assert_eq!(
                result.error_code.as_deref(),
                Some(if mode == "advisor-service-error" {
                    "MODEL_SERVICE"
                } else {
                    "MODEL_INVALID_OUTPUT"
                })
            );
        }
        let events = f.events("model.jsonl");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["advisorSample"], result.snapshot["advisorSample"]);
        assert_eq!(events[0]["allNames"], json!([]));
        assert!(!f.root.join("service-0.jsonl").exists());
        assert_eq!(rows(&f.database()), before);
    }
}
#[test]
fn advisor_cold_reopen_interrupts_an_unowned_persisted_trial() {
    let mut f = TrialFixture::new("advisor", true, true);
    formal(&f);
    let before = rows(&f.database());
    let id = f
        .local
        .as_ref()
        .unwrap()
        .access(|s| {
            let prepared = s.prepare_agent_model("advisor")?;
            s.begin_prepared_agent_trial("advisor", clues(), prepared.snapshot)
                .map(|r| r.id)
        })
        .unwrap();
    let reopened = f.reopen(&id);
    assert_eq!(reopened.status, "interrupted");
    assert_eq!(reopened.error_code.as_deref(), Some("INTERRUPTED"));
    assert!(reopened.role_result.is_none());
    assert_eq!(rows(&f.database()), before);
    assert!(f.events("model.jsonl").is_empty());
}
