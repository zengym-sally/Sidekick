use super::*;
use crate::local_store::tests::{input, Fixture};
fn models() -> ModelConfigInput {
    ModelConfigInput {
        expected_revision: None,
        providers: json!({"providers":[{"id":"p","apiFormat":"openai-compatible","baseUrl":"https://example.invalid/v1","auth":{"type":"bearer","apiKeyEnv":"PATH"},"enabled":true}]}),
        models: json!({"models":[{"id":"default","providerId":"p","apiModelId":"wire-default"},{"id":"override","providerId":"p","apiModelId":"wire-override"}]}),
        default_model_id: "default".into(),
        api_keys: Default::default(),
    }
}
fn edit(c: &AgentConfig) -> AgentConfigInput {
    AgentConfigInput {
        agent_id: c.agent_id.clone(),
        expected_revision: c.revision.clone(),
        model_id: c.model_id.clone(),
        preferences: c.preferences.clone(),
        supplemental_instructions: c.supplemental_instructions.clone(),
    }
}
#[test]
fn three_agents_save_reset_and_reopen_without_business_writes() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    let todo = s.create(input(), "before-agent").unwrap();
    for role in AGENT_IDS {
        let c = s.agent_config(role).unwrap();
        assert_eq!(c.model_id, None);
        assert!(!s
            .root()
            .unwrap()
            .join(format!("config/agents/{role}.json"))
            .exists());
        let mut draft = edit(&c);
        draft.supplemental_instructions = "优先给出可核对的原文。".into();
        draft.preferences.detail = "concise".into();
        let saved = s.save_agent_config(draft).unwrap();
        assert_ne!(saved.configuration.revision, c.revision);
        assert_eq!(s.agent_config(role).unwrap(), saved.configuration);
        assert_eq!(
            fs::metadata(s.root().unwrap().join(format!("config/agents/{role}.json")))
                .unwrap()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            s.save_agent_config(edit(&c)).unwrap_err().code,
            "AGENT_VERSION_CONFLICT"
        );
    }
    assert!(s.agent_config("fourth").is_err());
    drop(s);
    let mut s = f.store();
    let old = s.agent_config("organizer").unwrap();
    assert_eq!(old.preferences.detail, "concise");
    let reset = s.reset_agent_config("organizer", &old.revision).unwrap();
    assert_eq!(reset.configuration.preferences.detail, "standard");
    assert_eq!(
        s.agent_config("tracker").unwrap().preferences.detail,
        "concise"
    );
    assert_eq!(s.list().unwrap(), vec![todo.clone()]);
    assert_eq!(s.history(&todo.id).unwrap().len(), 1);
}
#[test]
fn roles_resolve_models_and_protect_referenced_configuration() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    s.save_models(models()).unwrap();
    let c = s.agent_config("organizer").unwrap();
    let mut input = edit(&c);
    input.model_id = Some("override".into());
    let saved = s.save_agent_config(input).unwrap().configuration;
    assert_eq!(
        s.prepare_model().unwrap().snapshot["model"]["apiModelId"],
        "wire-override"
    );
    assert_eq!(
        s.prepare_connection_model().unwrap().snapshot["modelId"],
        "default"
    );
    assert_eq!(
        s.prepare_agent_model("tracker").unwrap().snapshot["modelId"],
        "default"
    );
    let mut removed = models();
    removed.models["models"].as_array_mut().unwrap().pop();
    assert_eq!(
        s.save_models(removed).unwrap_err().code,
        "AGENT_MODEL_REFERENCED"
    );
    let mut invalid = edit(&saved);
    invalid.model_id = Some("missing".into());
    assert!(s.save_agent_config(invalid).is_err());
    s.reset_agent_config("organizer", &saved.revision).unwrap();
    let mut changed = models();
    changed.default_model_id = "override".into();
    s.save_models(changed).unwrap();
    assert_eq!(s.prepare_model().unwrap().snapshot["modelId"], "override");
}
#[test]
fn invalid_config_and_links_never_overwrite_the_original() {
    for hard in [false, true] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "Asia/Shanghai").unwrap();
        let c = s.agent_config("organizer").unwrap();
        let path = s.agent_path("organizer").unwrap();
        let outside = f.0.join("outside-agent");
        fs::write(&outside, "sentinel").unwrap();
        if hard {
            fs::hard_link(&outside, &path).unwrap()
        } else {
            std::os::unix::fs::symlink(&outside, &path).unwrap()
        }
        assert!(s.agent_config("organizer").is_err());
        assert!(s.save_agent_config(edit(&c)).is_err());
        assert_eq!(fs::read_to_string(outside).unwrap(), "sentinel");
    }
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    let c = s.agent_config("organizer").unwrap();
    let mut bad = edit(&c);
    bad.preferences.focus = "unsupported".into();
    assert!(s.save_agent_config(bad).is_err());
    let mut bad = edit(&c);
    bad.supplemental_instructions = "x".repeat(4001);
    assert!(s.save_agent_config(bad).is_err());
    let path = s.agent_path("organizer").unwrap();
    let mut future = serde_json::to_value(c.clone()).unwrap();
    future["version"] = json!(99);
    fs::write(&path, serde_json::to_vec(&future).unwrap()).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(s.save_agent_config(edit(&c)).is_err());
    assert_eq!(fs::read(path).unwrap(), before);
}
#[test]
fn agent_save_reconciles_after_replace_and_blocks_an_unknown_result() {
    for phase in [
        AgentWriteFault::BeforeReplace,
        AgentWriteFault::AfterReplace,
        AgentWriteFault::Uncertain,
    ] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "Asia/Shanghai").unwrap();
        let before = s.agent_config("organizer").unwrap();
        let mut draft = edit(&before);
        draft.supplemental_instructions = "合成偏好".into();
        s.agent_write_fault = Some(phase);
        let result = s.save_agent_config(draft);
        if phase == AgentWriteFault::BeforeReplace {
            assert!(result.is_err());
            assert_eq!(s.agent_config("organizer").unwrap(), before)
        } else if phase == AgentWriteFault::AfterReplace {
            assert!(result.unwrap().warning.is_some())
        } else {
            assert_eq!(result.unwrap_err().code, "AGENT_SAVE_UNCERTAIN");
            assert!(s.agent_config("organizer").is_err());
            assert!(s.save_agent_config(edit(&before)).is_err());
            s.agent_write_fault = None;
            assert_eq!(
                s.read_agent_config("organizer")
                    .unwrap()
                    .supplemental_instructions,
                "合成偏好"
            );
        }
    }
}
#[test]
fn trial_results_are_private_conditional_and_never_formal_candidates() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    s.save_models(models()).unwrap();
    let text_input = TextInput {
        text: "我负责核对清单，时间待定。".into(),
        source_at_ms: Some(1793239200000),
        time_zone: "Asia/Shanghai".into(),
    };
    let run = s.begin_agent_trial("organizer", text_input).unwrap();
    assert_eq!(run.snapshot["agent"]["agentId"], "organizer");
    let draft = CandidateDraft {
        fields: input(),
        evidence: "我负责核对清单，时间待定。".into(),
        due_expression: None,
        followup_expression: None,
        warnings: vec![],
        unresolved: false,
    };
    s.complete_agent_trial(&run.id, vec![draft]).unwrap();
    assert_eq!(s.agent_run(&run.id).unwrap().status, "succeeded");
    assert!(s.cancel_agent_trial(&run.id).unwrap().status == "succeeded");
    assert!(s.list().unwrap().is_empty());
    assert!(s.list_batches().unwrap().is_empty());
    let count: i64 = s
        .db()
        .unwrap()
        .query_row("SELECT count(*) FROM candidates", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    drop(s);
    let s = f.store();
    assert_eq!(s.agent_run(&run.id).unwrap().status, "succeeded");
}

#[test]
fn cancelled_invalid_and_interrupted_trials_never_publish_results() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    s.save_models(models()).unwrap();
    let text = TextInput {
        text: "合成原文".into(),
        source_at_ms: None,
        time_zone: "Asia/Shanghai".into(),
    };
    assert!(s.begin_agent_trial("fourth", text.clone()).is_err());
    let r = s.begin_agent_trial("organizer", text.clone()).unwrap();
    s.cancel_agent_trial(&r.id).unwrap();
    assert!(s.complete_agent_trial(&r.id, vec![]).is_err());
    s.finish_agent_trial_error(&r.id, "MODEL_TIMEOUT").unwrap();
    assert_eq!(s.agent_run(&r.id).unwrap().status, "cancelled");
    let invalid = s.begin_agent_trial("organizer", text.clone()).unwrap();
    let forged = CandidateDraft {
        fields: input(),
        evidence: "伪造引用".into(),
        due_expression: None,
        followup_expression: None,
        warnings: vec![],
        unresolved: false,
    };
    assert!(s.complete_agent_trial(&invalid.id, vec![forged]).is_err());
    assert!(s.agent_run(&invalid.id).unwrap().result.is_none());
    let pending = s.begin_agent_trial("organizer", text).unwrap();
    drop(s);
    let s = f.store();
    assert_eq!(s.agent_run(&pending.id).unwrap().status, "interrupted");
    assert!(s.agent_run(&pending.id).unwrap().result.is_none());
    assert!(s.list_batches().unwrap().is_empty());
    assert!(s.list().unwrap().is_empty());
}
#[test]
fn v2_wal_is_backed_up_and_failed_v3_ddl_preserves_business_history() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    let todo = s.create(input(), "v2-history").unwrap();
    let history = serde_json::to_value(s.history(&todo.id).unwrap()).unwrap();
    let root = s.root().unwrap();
    drop(s);
    let mut legacy = Connection::open(root.join("data/sidekick.sqlite")).unwrap();
    legacy.execute_batch("DROP TABLE agent_runs; PRAGMA user_version=2; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;").unwrap();
    legacy
        .execute(
            "UPDATE todos SET title='v2 WAL合成事项' WHERE id=?1",
            [&todo.id],
        )
        .unwrap();
    assert!(root.join("data/sidekick.sqlite-wal").exists());
    let broken = format!(
        "{};INSERT INTO missing_s31 VALUES(1);",
        include_str!("../../migrations/003_agent_runs.sql")
    );
    assert!(Migrations::new(vec![
        M::up(include_str!("../../migrations/001_todos.sql")),
        M::up(include_str!("../../migrations/002_ingestion.sql")),
        M::up(&broken)
    ])
    .to_latest(&mut legacy)
    .is_err());
    assert_eq!(
        legacy
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert!(legacy.prepare("SELECT * FROM agent_runs").is_err());
    let s = f.store();
    assert_eq!(
        s.db()
            .unwrap()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(s.get(&todo.id).unwrap().fields.title, "v2 WAL合成事项");
    assert_eq!(
        serde_json::to_value(s.history(&todo.id).unwrap()).unwrap(),
        history
    );
    let backup = fs::read_dir(root.join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let saved = Connection::open_with_flags(backup, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        saved
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        saved
            .query_row("SELECT title FROM todos", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "v2 WAL合成事项"
    );
}

#[test]
fn tracker_trial_begins_with_host_owned_synthetic_facts() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    s.save_models(models()).unwrap();
    let run = s
        .begin_agent_trial(
            "tracker",
            TextInput {
                text: "林川已提交SDK鉴权修复，等待我验收。".into(),
                source_at_ms: None,
                time_zone: "Asia/Shanghai".into(),
            },
        )
        .unwrap();
    assert_eq!(run.agent_id, "tracker");
    assert_eq!(run.snapshot["trackerSample"]["version"], 1);
    assert_eq!(
        run.snapshot["trackerSample"]["todos"][1]["id"],
        "sample-followup"
    );
    assert!(s.list().unwrap().is_empty());
}

fn tracker_result() -> TrackerTrialResult {
    serde_json::from_value(json!({"kind":"tracker","version":1,"suggestions":[{"todoId":"sample-followup","todoVersion":1,"change":"submission","summary":"提交待验收","evidence":"林川已提交SDK鉴权修复"}]})).unwrap()
}
fn tracker_input() -> TextInput {
    TextInput {
        text: "林川已提交SDK鉴权修复，等待我验收。".into(),
        source_at_ms: None,
        time_zone: "Asia/Shanghai".into(),
    }
}
fn formal_rows(s: &AppStore) -> Vec<serde_json::Value> {
    [
        "sources",
        "candidates",
        "todos",
        "todo_events",
        "todo_sources",
    ]
    .into_iter()
    .map(|table| {
        let mut q = s
            .db()
            .unwrap()
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let width = q.column_count();
        let rows: Vec<Vec<String>> = q
            .query_map([], |row| {
                (0..width)
                    .map(|i| row.get_ref(i).map(|v| format!("{v:?}")))
                    .collect()
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        json!({"table":table,"rows":rows})
    })
    .collect()
}
#[test]
fn tracker_results_reopen_without_candidates_or_business_writes() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    s.save_models(models()).unwrap();
    let todo = s.create(input(), "tracker-formal-baseline").unwrap();
    let before = formal_rows(&s);
    let run = s.begin_agent_trial("tracker", tracker_input()).unwrap();
    assert!(s.complete_agent_trial(&run.id, vec![]).is_err());
    let result = s.complete_tracker_trial(&run.id, tracker_result()).unwrap();
    assert_eq!(result.status, "succeeded");
    assert!(result.result.is_none());
    assert_eq!(
        serde_json::to_value(&result.role_result).unwrap()["suggestions"][0]["change"],
        "submission"
    );
    assert_eq!(formal_rows(&s), before);
    assert_eq!(s.get(&todo.id).unwrap().status, "open");
    assert_eq!(s.cancel_agent_trial(&run.id).unwrap().status, "succeeded");
    drop(s);
    let s = f.store();
    let reopened = s.latest_agent_trial("tracker").unwrap().unwrap();
    assert_eq!(reopened.id, run.id);
    assert_eq!(
        serde_json::to_value(&reopened.role_result).unwrap()["suggestions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(formal_rows(&s), before);
}
#[test]
fn tracker_rejects_invalid_results_and_never_overwrites_terminal_or_other_roles() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    s.save_models(models()).unwrap();
    for invalid in [
        "id",
        "version",
        "change",
        "quote",
        "summary",
        "duplicate",
        "count",
        "kind",
        "format-version",
    ] {
        let run = s.begin_agent_trial("tracker", tracker_input()).unwrap();
        let mut value = tracker_result();
        match invalid {
            "id" => value.suggestions[0].todo_id = "formal-id".into(),
            "version" => value.suggestions[0].todo_version = 2,
            "change" => value.suggestions[0].change = "completed".into(),
            "quote" => value.suggestions[0].evidence = "已验收通过".into(),
            "summary" => value.suggestions[0].summary = "x".repeat(501),
            "duplicate" => value.suggestions.push(value.suggestions[0].clone()),
            "count" => value.suggestions = vec![value.suggestions[0].clone(); 21],
            "kind" => value.kind = "advisor".into(),
            _ => value.version = 2,
        }
        assert_eq!(
            s.complete_tracker_trial(&run.id, value).unwrap_err().code,
            "MODEL_INVALID_OUTPUT"
        );
        assert!(s.agent_run(&run.id).unwrap().role_result.is_none());
        s.cancel_agent_trial(&run.id).unwrap();
    }
    assert!(serde_json::from_value::<TrackerTrialResult>(
        json!({"kind":"tracker","version":1,"suggestions":[],"status":"done"})
    )
    .is_err());
    let organizer = s.begin_agent_trial("organizer", tracker_input()).unwrap();
    assert!(s
        .complete_tracker_trial(&organizer.id, tracker_result())
        .is_err());
    s.complete_agent_trial(&organizer.id, vec![]).unwrap();
    assert!(s
        .agent_run(&organizer.id)
        .unwrap()
        .result
        .unwrap()
        .is_empty());
    let cancelled = s.begin_agent_trial("tracker", tracker_input()).unwrap();
    s.cancel_agent_trial(&cancelled.id).unwrap();
    assert!(s
        .complete_tracker_trial(&cancelled.id, tracker_result())
        .is_err());
    let interrupted = s.begin_agent_trial("tracker", tracker_input()).unwrap();
    drop(s);
    let mut s = f.store();
    assert_eq!(s.agent_run(&interrupted.id).unwrap().status, "interrupted");
    assert!(s
        .complete_tracker_trial(&interrupted.id, tracker_result())
        .is_err());
}

#[test]
fn advisor_trial_begins_with_host_owned_dated_snapshot() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.save_models(models()).unwrap();
    let run = s
        .begin_agent_trial(
            "advisor",
            TextInput {
                text: "合成排序指导".into(),
                source_at_ms: None,
                time_zone: "UTC".into(),
            },
        )
        .unwrap();
    assert_eq!(run.snapshot["advisorSample"]["snapshotId"], run.id);
    assert_eq!(run.snapshot["advisorSample"]["date"], "2026-11-02");
    assert_eq!(
        run.snapshot["advisorSample"]["counts"],
        json!({"total":4,"open":3,"done":1,"dueToday":1,"followupToday":1,"undated":1})
    );
    assert_eq!(run.input.time_zone, "Asia/Shanghai");
    assert_eq!(run.input.source_at_ms, Some(1793581200000));
    assert!(s.list().unwrap().is_empty());
}

fn advisor_input() -> TextInput {
    TextInput {
        text: "请给出合成事项的排序与依据。".into(),
        source_at_ms: None,
        time_zone: "UTC".into(),
    }
}
fn advisor_result(id: &str, alternate: bool) -> AdvisorTrialResult {
    let reason = |code: &str| json!({"code":code,"relatedTodoId":null,"relatedTodoVersion":null});
    let action = json!({"todoId":"advisor-action","todoVersion":2,"reasons":if alternate {json!([reason("open_action")])} else {json!([reason("due_today"),{"code":"earlier_due","relatedTodoId":"advisor-followup","relatedTodoVersion":3}])}});
    let followup = json!({"todoId":"advisor-followup","todoVersion":3,"reasons":if alternate {json!([reason("upcoming_due"),reason("open_followup")])} else {json!([reason("followup_today")])}});
    let undated = json!({"todoId":"advisor-undated","todoVersion":1,"reasons":[reason("undated")]});
    serde_json::from_value(json!({"kind":"advisor","version":1,"snapshotId":id,"date":"2026-11-02","timeZone":"Asia/Shanghai","ranking":if alternate {vec![followup,undated,action]}else{vec![action,followup,undated]}})).unwrap()
}
#[test]
fn advisor_accepts_multiple_rankings_empty_results_and_reopens_frozen_history() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.save_models(models()).unwrap();
    s.create(input(), "advisor-formal-baseline").unwrap();
    let before = formal_rows(&s);
    let mut saved = Vec::new();
    for alternate in [false, true] {
        let run = s.begin_agent_trial("advisor", advisor_input()).unwrap();
        let answer = advisor_result(&run.id, alternate);
        let expected = serde_json::to_value(&answer).unwrap();
        assert!(s.complete_agent_trial(&run.id, vec![]).is_err());
        assert!(s.complete_tracker_trial(&run.id, tracker_result()).is_err());
        let done = s.complete_advisor_trial(&run.id, answer).unwrap();
        assert_eq!(done.status, "succeeded");
        assert!(done.result.is_none());
        assert_eq!(serde_json::to_value(&done.role_result).unwrap(), expected);
        assert_eq!(s.cancel_agent_trial(&run.id).unwrap().status, "succeeded");
        saved.push((run.id, expected));
    }
    let empty = s.begin_agent_trial("advisor", advisor_input()).unwrap();
    let mut answer = advisor_result(&empty.id, false);
    answer.ranking.clear();
    let done = s.complete_advisor_trial(&empty.id, answer).unwrap();
    assert_eq!(
        serde_json::to_value(done.role_result).unwrap()["ranking"],
        json!([])
    );
    assert_eq!(done.snapshot["advisorSample"]["counts"]["open"], 3);
    let c = s.agent_config("advisor").unwrap();
    s.reset_agent_config("advisor", &c.revision).unwrap();
    assert_eq!(formal_rows(&s), before);
    drop(s);
    let s = f.store();
    for (id, expected) in saved {
        let run = s.agent_run(&id).unwrap();
        assert_eq!(serde_json::to_value(run.role_result).unwrap(), expected);
        assert_eq!(run.snapshot["advisorSample"]["date"], "2026-11-02");
    }
    assert_eq!(
        s.latest_agent_trial("advisor").unwrap().unwrap().id,
        empty.id
    );
    assert_eq!(formal_rows(&s), before);
}
#[test]
fn advisor_rejects_false_reasons_refs_identity_and_terminal_results() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.save_models(models()).unwrap();
    for invalid in [
        "snapshot",
        "date",
        "zone",
        "kind",
        "version",
        "partial",
        "duplicate",
        "done",
        "todo-version",
        "false-reason",
        "self-comparison",
        "false-comparison",
        "comparison-version",
        "undated-comparison",
        "duplicate-reason",
        "empty-reason",
        "extra-reason",
    ] {
        let run = s.begin_agent_trial("advisor", advisor_input()).unwrap();
        let mut answer = advisor_result(&run.id, false);
        match invalid {
            "snapshot" => answer.snapshot_id = "stale-run".into(),
            "date" => answer.date = "2026-02-30".into(),
            "zone" => answer.time_zone = "UTC".into(),
            "kind" => answer.kind = "tracker".into(),
            "version" => answer.version = 2,
            "partial" => {
                answer.ranking.pop();
            }
            "duplicate" => answer.ranking[2] = answer.ranking[0].clone(),
            "done" => {
                answer.ranking[0].todo_id = "advisor-done".into();
                answer.ranking[0].todo_version = 1;
            }
            "todo-version" => answer.ranking[0].todo_version = 3,
            "false-reason" => answer.ranking[0].reasons[0].code = "followup_today".into(),
            "self-comparison" => {
                answer.ranking[0].reasons[1].related_todo_id = Some("advisor-action".into());
                answer.ranking[0].reasons[1].related_todo_version = Some(2);
            }
            "false-comparison" => {
                answer.ranking[1].reasons = vec![AdvisorReason {
                    code: "earlier_due".into(),
                    related_todo_id: Some("advisor-action".into()),
                    related_todo_version: Some(2),
                }]
            }
            "comparison-version" => answer.ranking[0].reasons[1].related_todo_version = Some(2),
            "undated-comparison" => {
                answer.ranking[0].reasons[1].related_todo_id = Some("advisor-undated".into());
                answer.ranking[0].reasons[1].related_todo_version = Some(1);
            }
            "duplicate-reason" => {
                answer.ranking[0].reasons[1] = answer.ranking[0].reasons[0].clone()
            }
            "empty-reason" => answer.ranking[0].reasons.clear(),
            _ => answer.ranking[0].reasons = vec![answer.ranking[0].reasons[0].clone(); 4],
        }
        assert_eq!(
            s.complete_advisor_trial(&run.id, answer).unwrap_err().code,
            "MODEL_INVALID_OUTPUT",
            "{invalid}"
        );
        assert!(s.agent_run(&run.id).unwrap().role_result.is_none());
        s.cancel_agent_trial(&run.id).unwrap();
    }
    for role in ["organizer", "tracker"] {
        let run = s.begin_agent_trial(role, tracker_input()).unwrap();
        assert_eq!(
            s.complete_advisor_trial(&run.id, advisor_result(&run.id, false))
                .unwrap_err()
                .code,
            "MODEL_INVALID_OUTPUT"
        );
        s.cancel_agent_trial(&run.id).unwrap();
    }
    let cancelled = s.begin_agent_trial("advisor", advisor_input()).unwrap();
    s.cancel_agent_trial(&cancelled.id).unwrap();
    assert_eq!(
        s.complete_advisor_trial(&cancelled.id, advisor_result(&cancelled.id, false))
            .unwrap_err()
            .code,
        "AGENT_TRIAL_STOPPED"
    );
    let interrupted = s.begin_agent_trial("advisor", advisor_input()).unwrap();
    s.interrupt_agent_trials(None).unwrap();
    assert_eq!(s.agent_run(&interrupted.id).unwrap().status, "interrupted");
    assert!(s
        .complete_advisor_trial(&interrupted.id, advisor_result(&interrupted.id, false))
        .is_err());
}
#[test]
fn advisor_final_receiver_checks_full_stored_facts_and_strict_json_shape() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.save_models(models()).unwrap();
    let keys = [
        "id",
        "version",
        "title",
        "kind",
        "owner",
        "status",
        "dueDate",
        "followupDate",
    ];
    for index in 0..4 {
        for key in keys {
            for remove in [false, true] {
                let run = s.begin_agent_trial("advisor", advisor_input()).unwrap();
                let mut snapshot = run.snapshot;
                let todo = &mut snapshot["advisorSample"]["todos"][index];
                if remove {
                    todo.as_object_mut().unwrap().remove(key);
                } else {
                    todo[key] = json!({"forged":true});
                }
                s.db()
                    .unwrap()
                    .execute(
                        "UPDATE agent_runs SET snapshot_json=?2 WHERE id=?1",
                        params![run.id, serde_json::to_string(&snapshot).unwrap()],
                    )
                    .unwrap();
                assert_eq!(
                    s.complete_advisor_trial(&run.id, advisor_result(&run.id, false))
                        .unwrap_err()
                        .code,
                    "MODEL_INVALID_OUTPUT",
                    "{index}/{key}/{remove}"
                );
                s.cancel_agent_trial(&run.id).unwrap();
            }
        }
    }
    for key in [
        "snapshotId",
        "date",
        "timeZone",
        "anchorAtMs",
        "counts",
        "version",
        "extra",
    ] {
        let run = s.begin_agent_trial("advisor", advisor_input()).unwrap();
        let mut snapshot = run.snapshot;
        snapshot["advisorSample"][key] = json!(null);
        s.db()
            .unwrap()
            .execute(
                "UPDATE agent_runs SET snapshot_json=?2 WHERE id=?1",
                params![run.id, serde_json::to_string(&snapshot).unwrap()],
            )
            .unwrap();
        assert!(s
            .complete_advisor_trial(&run.id, advisor_result(&run.id, false))
            .is_err());
        s.cancel_agent_trial(&run.id).unwrap();
    }
    let run = s.begin_agent_trial("advisor", advisor_input()).unwrap();
    for key in ["relatedTodoId", "relatedTodoVersion"] {
        let mut value = serde_json::to_value(advisor_result(&run.id, false)).unwrap();
        value["ranking"][0]["reasons"][0]
            .as_object_mut()
            .unwrap()
            .remove(key);
        assert!(
            serde_json::from_value::<AdvisorTrialResult>(value).is_err(),
            "{key}"
        );
    }
    for key in ["counts", "status", "owner", "dueDate", "explanation"] {
        let mut value = serde_json::to_value(advisor_result(&run.id, false)).unwrap();
        value[key] = json!("forged");
        assert!(serde_json::from_value::<AdvisorTrialResult>(value).is_err());
    }
    let tracker = s.begin_agent_trial("tracker", tracker_input()).unwrap();
    let original = serde_json::to_value(tracker_result()).unwrap();
    s.complete_tracker_trial(&tracker.id, tracker_result())
        .unwrap();
    assert_eq!(
        serde_json::to_value(s.agent_run(&tracker.id).unwrap().role_result).unwrap(),
        original
    );
    s.db()
        .unwrap()
        .execute(
            "UPDATE agent_runs SET result_json=?2 WHERE id=?1",
            params![run.id, serde_json::to_string(&original).unwrap()],
        )
        .unwrap();
    assert!(s.agent_run(&run.id).is_err());
}
