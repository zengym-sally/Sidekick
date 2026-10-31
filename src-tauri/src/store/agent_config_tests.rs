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
    assert!(s.begin_agent_trial("tracker", text.clone()).is_err());
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
