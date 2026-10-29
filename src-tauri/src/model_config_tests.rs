use super::*;
use crate::local_store::tests::Fixture;
fn config(model: &str) -> ModelConfigInput {
    ModelConfigInput {
        providers: json!({"$comment":"fixture","providers":[{"id":"fixture","name":"合成服务","apiFormat":"openai-compatible","baseUrl":"http://127.0.0.1:1/v1","auth":{"type":"bearer","apiKeyEnv":"SIDEKICK_MISSING_SYNTHETIC_CREDENTIAL"},"network":{"timeoutMs":2000,"retry":{"maxRetries":0,"backoff":"exponential"}},"extraHeaders":{},"enabled":true,"tags":["test"]}]}),
        models: json!({"models":[{"id":model,"providerId":"fixture","apiModelId":"deployment-name","capabilities":{"input":["text"],"toolCall":true},"pricing":{"input":null},"reasoning":{"supported":false}}]}),
        default_model_id: model.into(),
        api_keys: std::collections::BTreeMap::new(),
    }
}
#[test]
fn model_documents_preserve_metadata_and_validate_references_without_secrets() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    assert!(s.read_models().unwrap().is_none());
    let saved = s.save_models(config("logical-id")).unwrap();
    assert_eq!(saved.configuration.default_model_id, "logical-id");
    assert_eq!(
        saved.configuration.models["models"][0]["apiModelId"],
        "deployment-name"
    );
    assert!(saved.configuration.models["models"][0]["pricing"]["input"].is_null());
    assert_eq!(s.prepare_model().err().unwrap().code, "CREDENTIAL_MISSING");
    let mut bad = config("bad");
    bad.models["models"][0]["providerId"] = json!("unknown");
    assert!(s.save_models(bad).is_err());
    assert_eq!(
        s.read_models().unwrap().unwrap().default_model_id,
        "logical-id"
    );
}
#[test]
fn model_pair_recovery_never_exposes_mixed_revisions() {
    for phase in [
        ModelWriteFault::BeforeJournal,
        ModelWriteFault::AfterJournal,
        ModelWriteFault::AfterProviders,
        ModelWriteFault::AfterModels,
    ] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "Asia/Shanghai").unwrap();
        s.save_models(config("old")).unwrap();
        s.model_write_fault = Some(phase);
        let _ = s.save_models(config("new"));
        drop(s);
        let s = f.store();
        let loaded = s.read_models().unwrap().unwrap();
        assert_eq!(
            loaded.default_model_id,
            if phase == ModelWriteFault::BeforeJournal {
                "old"
            } else {
                "new"
            }
        );
        assert!(s.list().unwrap().is_empty());
    }
}
#[test]
fn uncertain_model_save_keeps_journal_and_blocks_further_saves_or_tasks() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    s.save_models(config("old")).unwrap();
    s.model_write_fault = Some(ModelWriteFault::Uncertain);
    assert_eq!(
        s.save_models(config("new")).unwrap_err().code,
        "MODEL_CONFIG_UNCERTAIN"
    );
    assert!(s.root().unwrap().join("config/.llm-journal.json").exists());
    assert!(s.prepare_model().is_err());
    assert!(s.save_models(config("third")).is_err());
    s.model_write_fault = None;
    assert_eq!(s.read_models().unwrap().unwrap().default_model_id, "new");
}
#[test]
fn model_json_rejects_plain_secrets_and_conflicting_auth() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    for field in ["apiKey", "password", "token"] {
        let mut bad = config("bad");
        bad.providers["providers"][0][field] = json!("not-a-real-secret");
        assert!(s.save_models(bad).is_err());
    }
    let mut bad = config("bad");
    bad.providers["providers"][0]["auth"]["apiKeyRef"] = json!("also-ref");
    assert!(s.save_models(bad).is_err());
    assert!(s.read_models().unwrap().is_none());
}

#[test]
fn explicit_auth_carriers_and_invalid_journals_never_replace_current_config() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "Asia/Shanghai").unwrap();
    let old = s.save_models(config("old")).unwrap().configuration;
    let root = s.root().unwrap().join("config");
    let providers = fs::read(root.join("providers.json")).unwrap();
    let models = fs::read(root.join("models.json")).unwrap();
    for name in ["Proxy-Authorization", "X-Goog-Api-Key"] {
        let mut bad = config("bad");
        bad.providers["providers"][0]["extraHeaders"][name] = json!("synthetic-auth-value");
        assert!(s.save_models(bad).is_err());
        assert_eq!(fs::read(root.join("providers.json")).unwrap(), providers);
    }
    let mut bad = config("bad");
    bad.providers["providers"][0]["baseUrl"] = json!("https://example.invalid/v1?apiKey=synthetic");
    assert!(s.save_models(bad).is_err());
    for invalid in [
        json!({"version":2,"revision":"new","defaultModelId":"old"}),
        json!({"version":1,"defaultModelId":"old"}),
    ] {
        let mut invalid_models = old.models.clone();
        invalid_models["sidekick"] = invalid;
        let journal = json!({"version":1,"providers":old.providers,"models":invalid_models});
        let bytes = serde_json::to_vec(&journal).unwrap();
        fs::write(root.join(".llm-journal.json"), &bytes).unwrap();
        assert!(s.read_models().is_err());
        assert_eq!(fs::read(root.join("providers.json")).unwrap(), providers);
        assert_eq!(fs::read(root.join("models.json")).unwrap(), models);
        assert_eq!(fs::read(root.join(".llm-journal.json")).unwrap(), bytes);
    }
}
