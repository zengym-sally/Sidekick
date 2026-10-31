use super::*;
use crate::local_store::tests::{input, Fixture};
use serde_json::json;
use sha2::{Digest, Sha256};

fn trial(store: &mut AppStore, tools: bool) -> String {
    let run = store
        .begin_prepared_agent_trial(
            "organizer",
            TextInput {
                text: "Synthetic material".into(),
                source_at_ms: None,
                time_zone: "UTC".into(),
            },
            json!({"model":{"capabilities":{"toolCall":tools}},"agent":{"agentId":"organizer"}}),
        )
        .unwrap();
    store.run_directory(&run.id).unwrap();
    run.id
}

fn server(store: &AppStore, name: &str) -> String {
    store
        .save_mcp_server(McpServerInput {
            id: None,
            expected_revision: store.mcp_configuration().unwrap().revision,
            server: serde_json::from_value(json!({"name":name,"transport":"stdio","enabled":true,"command":"/synthetic/never-executed","args":[],"cwd":null,"env":[],"connectTimeoutMs":1000,"toolTimeoutMs":1000})).unwrap(),
        })
        .unwrap()
        .server_id
        .unwrap()
}

fn catalog() -> McpDiscoveredCatalog {
    serde_json::from_value(json!({"tools":[{"name":"lookup","description":"Synthetic lookup","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":false}}]})).unwrap()
}

fn prepared() -> (Fixture, AppStore, String, TrialMcpTool) {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    let sid = server(&store, "synthetic");
    let id = trial(&mut store, true);
    store.prepare_trial_mcp(&id).unwrap();
    let tool = store
        .bind_trial_mcp_catalog(&id, &sid, &catalog(), &[])
        .unwrap()
        .remove(0);
    (f, store, id, tool)
}

fn call(store: &AppStore, id: &str, tool: &TrialMcpTool, cid: &str) -> McpCallInput {
    serde_json::from_value(json!({"id":cid,"modelCallId":format!("model-{cid}"),"modelName":tool.model_name,"configurationRevision":store.agent_run(id).unwrap().snapshot["mcp"]["revision"],"schemaSha256":tool.schema_sha256,"argumentsJson":"{\"query\":\"synthetic-private-argument\"}"})).unwrap()
}

fn states(store: &AppStore, id: &str) -> Vec<(String, Option<String>)> {
    store
        .db()
        .unwrap()
        .prepare("SELECT send_state,response_category FROM tool_calls WHERE agent_run_id=?1 ORDER BY rowid")
        .unwrap()
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap()
}

fn assert_unknown(store: &AppStore, id: &str) {
    let run = store.agent_run(id).unwrap();
    assert_eq!(run.status, "failed");
    assert_eq!(run.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
    assert!(run.result.is_none());
    assert!(store.trial_mcp_unknown(id).unwrap());
}

#[test]
fn mcp_calls_freezes_configuration_and_runtime_values_never_enter_snapshot() {
    let (f, mut store, id, tool) = prepared();
    let frozen = store.agent_run(&id).unwrap().snapshot["mcp"].clone();
    server(&store, "later-service");
    assert!(store.prepare_trial_mcp(&id).is_err());
    assert_eq!(store.agent_run(&id).unwrap().snapshot["mcp"], frozen);
    assert_eq!(tool.model_name.len(), 60);
    let name_hash = format!(
        "{:x}",
        Sha256::digest(format!("{}\0lookup", tool.server_id).as_bytes())
    );
    assert_eq!(tool.model_name, format!("mcp_{}", &name_hash[..56]));
    let schema_hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&catalog().tools[0].input_schema).unwrap())
    );
    assert_eq!(tool.schema_sha256, schema_hash);
    drop(store);
    let store = f.store();
    assert_eq!(store.agent_run(&id).unwrap().snapshot["mcp"], frozen);
}

#[test]
fn mcp_calls_environment_values_are_private_and_missing_references_fail() {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    let sid = server(&store, "environment");
    let variable = format!("SIDEKICK_SYNTHETIC_MCP_{}", nonce());
    let mut draft = store
        .mcp_configuration()
        .unwrap()
        .servers
        .remove(0)
        .settings;
    draft.env.push(McpEnvironment {
        name: "SYNTHETIC_VALUE".into(),
        source: "environment".into(),
        value: variable.clone(),
    });
    store
        .save_mcp_server(McpServerInput {
            id: Some(sid),
            expected_revision: store.mcp_configuration().unwrap().revision,
            server: draft,
        })
        .unwrap();
    let id = trial(&mut store, true);
    assert_eq!(
        store.prepare_trial_mcp(&id).err().unwrap().code,
        "MCP_ENV_MISSING"
    );
    assert!(store.agent_run(&id).unwrap().snapshot.get("mcp").is_none());
    std::env::set_var(&variable, "synthetic-secret-only-in-private-payload");
    let prepared = store.prepare_trial_mcp(&id).unwrap();
    std::env::remove_var(&variable);
    assert!(!prepared.revision.is_empty());
    assert_eq!(prepared.servers[0].server.settings.name, "environment");
    assert_eq!(
        prepared.servers[0].prepared.env["SYNTHETIC_VALUE"],
        "synthetic-secret-only-in-private-payload"
    );
    let snapshot = store.agent_run(&id).unwrap().snapshot.to_string();
    assert!(!snapshot.contains("synthetic-secret-only-in-private-payload"));
    assert!(snapshot.contains(&variable));
}

#[test]
fn mcp_calls_legacy_disabled_and_toolcall_false_preserve_text_trial() {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    let legacy = trial(&mut store, true);
    assert!(store.prepare_trial_mcp(&legacy).unwrap().servers.is_empty());
    assert!(!store.trial_mcp_unknown(&legacy).unwrap());
    store.cancel_agent_trial(&legacy).unwrap();
    store.interrupt_agent_trials(None).unwrap();
    assert_eq!(store.agent_run(&legacy).unwrap().status, "cancelled");
    store.upgrade_mcp_storage().unwrap();
    let sid = server(&store, "disabled");
    let mut draft = store
        .mcp_configuration()
        .unwrap()
        .servers
        .remove(0)
        .settings;
    draft.enabled = false;
    store
        .save_mcp_server(McpServerInput {
            id: Some(sid),
            expected_revision: store.mcp_configuration().unwrap().revision,
            server: draft,
        })
        .unwrap();
    let disabled = trial(&mut store, true);
    assert!(store
        .prepare_trial_mcp(&disabled)
        .unwrap()
        .servers
        .is_empty());
    server(&store, "enabled");
    let no_tools = trial(&mut store, false);
    assert!(store
        .prepare_trial_mcp(&no_tools)
        .unwrap()
        .servers
        .is_empty());
}

#[test]
fn mcp_calls_empty_enabled_set_is_frozen_before_later_configuration_changes() {
    for disabled in [false, true] {
        let f = Fixture::new();
        let mut store = f.store();
        store.initialize(None, "UTC").unwrap();
        store.upgrade_mcp_storage().unwrap();
        if disabled {
            let sid = server(&store, "initial-disabled");
            let mut draft = store
                .mcp_configuration()
                .unwrap()
                .servers
                .remove(0)
                .settings;
            draft.enabled = false;
            store
                .save_mcp_server(McpServerInput {
                    id: Some(sid),
                    expected_revision: store.mcp_configuration().unwrap().revision,
                    server: draft,
                })
                .unwrap();
        }
        let id = trial(&mut store, true);
        let prepared = store.prepare_trial_mcp(&id).unwrap();
        assert!(prepared.servers.is_empty());
        let expected =
            json!({"revision":prepared.revision,"servers":[],"catalogs":{},"mapping":[]});
        server(&store, "later-enabled");
        assert_eq!(
            store
                .prepare_trial_mcp(&id)
                .err()
                .expect("a frozen empty set must reject repeated preparation")
                .code,
            "MCP_CALL_INVALID"
        );
        assert_eq!(store.agent_run(&id).unwrap().snapshot["mcp"], expected);
    }
}

#[test]
fn mcp_calls_catalog_requires_frozen_service_and_full_valid_catalog() {
    let (_f, mut store, id, tool) = prepared();
    let before = store.agent_run(&id).unwrap().snapshot;
    assert!(store
        .bind_trial_mcp_catalog(&id, &tool.server_id, &catalog(), &[])
        .is_err());
    assert!(store
        .bind_trial_mcp_catalog(&id, "mcp-forged", &catalog(), &[])
        .is_err());
    assert_eq!(store.agent_run(&id).unwrap().snapshot, before);
    let other = trial(&mut store, true);
    store.prepare_trial_mcp(&other).unwrap();
    let mut private = catalog();
    private.tools[0].description = Some("synthetic-private-marker".into());
    assert_eq!(
        store
            .bind_trial_mcp_catalog(
                &other,
                &tool.server_id,
                &private,
                &["synthetic-private-marker".into()]
            )
            .unwrap_err()
            .code,
        "MCP_PRIVATE_OUTPUT"
    );
    let mut invalid = catalog();
    invalid.tools[0].input_schema = json!({"type":"object","$ref":"https://never-fetch.invalid"});
    assert!(store
        .bind_trial_mcp_catalog(&other, &tool.server_id, &invalid, &[])
        .is_err());
}

#[test]
fn mcp_calls_catalog_aggregate_budgets_are_atomic() {
    for oversized in [false, true] {
        let f = Fixture::new();
        let mut store = f.store();
        store.initialize(None, "UTC").unwrap();
        store.upgrade_mcp_storage().unwrap();
        let servers: Vec<_> = (0..5)
            .map(|n| server(&store, &format!("server-{n}")))
            .collect();
        let id = trial(&mut store, true);
        store.prepare_trial_mcp(&id).unwrap();
        let mut c = catalog();
        if oversized {
            c.tools[0].description = Some("x".repeat(150_000));
        } else {
            c.tools = (0..64)
                .map(|n| {
                    let mut t = c.tools[0].clone();
                    t.name = format!("lookup-{n}");
                    t
                })
                .collect();
        }
        let accepted = if oversized { 3 } else { 4 };
        for sid in &servers[..accepted] {
            store.bind_trial_mcp_catalog(&id, sid, &c, &[]).unwrap();
        }
        let before = store.agent_run(&id).unwrap().snapshot;
        assert!(store
            .bind_trial_mcp_catalog(&id, &servers[accepted], &c, &[])
            .is_err());
        assert_eq!(store.agent_run(&id).unwrap().snapshot, before);
    }
}

#[test]
fn mcp_calls_send_and_response_are_once_only_and_store_only_hashes() {
    let (_f, mut store, id, tool) = prepared();
    let mut request = call(&store, &id, &tool, "call-a");
    request.arguments_json = " { \"query\" : \"synthetic-private-argument\" } ".into();
    let expected = format!("{:x}", Sha256::digest(request.arguments_json.as_bytes()));
    store.begin_trial_mcp_call(&id, request).unwrap();
    assert_eq!(store.agent_run(&id).unwrap().status, "running");
    assert_eq!(states(&store, &id), vec![("possibly_sent".into(), None)]);
    assert_eq!(
        store
            .db()
            .unwrap()
            .query_row(
                "SELECT arguments_sha256 FROM tool_calls WHERE id='call-a'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        expected
    );
    assert!(store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-a"))
        .is_err());
    let mut repeated_model = call(&store, &id, &tool, "call-b");
    repeated_model.model_call_id = "model-call-a".into();
    assert!(store.begin_trial_mcp_call(&id, repeated_model).is_err());
    store.confirm_trial_mcp_call(&id, "call-a", true).unwrap();
    assert_eq!(
        states(&store, &id),
        vec![("responded".into(), Some("tool_error".into()))]
    );
    assert!(store.confirm_trial_mcp_call(&id, "call-a", false).is_err());
    let run = store.complete_agent_trial(&id, vec![]).unwrap();
    assert_eq!(run.status, "succeeded");
    assert!(!store.trial_mcp_unknown(&id).unwrap());
    let raw = store
        .db()
        .unwrap()
        .query_row(
            "SELECT response_summary FROM tool_calls WHERE id='call-a'",
            [],
            |r| r.get::<_, Option<String>>(0),
        )
        .unwrap();
    assert!(!raw
        .unwrap_or_default()
        .contains("synthetic-private-argument"));
}

#[test]
fn mcp_calls_begin_sqlite_write_rejection_leaves_no_pending_call() {
    let (f, mut store, id, tool) = prepared();
    let request = call(&store, &id, &tool, "call-readonly-begin");
    store.test_mcp_query_only(true).unwrap();
    let error = store.begin_trial_mcp_call(&id, request).unwrap_err();
    assert_eq!(error.code, "DATABASE_ERROR");
    assert!(!error.message.contains("synthetic-private-argument"));
    assert!(states(&store, &id).is_empty());
    assert_eq!(store.agent_run(&id).unwrap().status, "running");
    assert!(!store.trial_mcp_unknown(&id).unwrap());
    store.test_mcp_query_only(false).unwrap();
    drop(store);
    let store = f.store();
    assert!(states(&store, &id).is_empty());
    let run = store.agent_run(&id).unwrap();
    assert_eq!(run.status, "interrupted");
    assert_eq!(run.error_code.as_deref(), Some("INTERRUPTED"));
    assert!(!store.trial_mcp_unknown(&id).unwrap());
}

#[test]
fn mcp_calls_response_sqlite_write_rejection_recovers_pending_as_unknown() {
    let (f, mut store, id, tool) = prepared();
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-readonly-response"))
        .unwrap();
    store.test_mcp_query_only(true).unwrap();
    let error = store
        .confirm_trial_mcp_call(&id, "call-readonly-response", false)
        .unwrap_err();
    assert_eq!(error.code, "DATABASE_ERROR");
    assert_eq!(states(&store, &id), vec![("possibly_sent".into(), None)]);
    assert_eq!(store.agent_run(&id).unwrap().status, "running");
    store.test_mcp_query_only(false).unwrap();
    drop(store);
    let mut store = f.store();
    assert_unknown(&store, &id);
    assert_eq!(states(&store, &id), vec![("unknown".into(), None)]);
    assert!(store
        .confirm_trial_mcp_call(&id, "call-readonly-response", false)
        .is_err());
    assert!(store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-retry-response"))
        .is_err());
    assert_unknown(&store, &id);
}

#[test]
fn mcp_calls_begin_before_commit_error_rolls_back_insert() {
    let (f, mut store, id, tool) = prepared();
    store.test_mcp_call_fault(Some(McpCallFault::BeforeBegin));
    let error = store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-rollback-begin"))
        .unwrap_err();
    assert_eq!(error.code, "MCP_CALL_TEST_FAULT");
    assert!(!error.message.contains("synthetic-private-argument"));
    assert!(states(&store, &id).is_empty());
    assert!(!store.trial_mcp_unknown(&id).unwrap());
    drop(store);
    let store = f.store();
    assert!(states(&store, &id).is_empty());
    assert_eq!(store.agent_run(&id).unwrap().status, "interrupted");
    assert!(!store.trial_mcp_unknown(&id).unwrap());
}

#[test]
fn mcp_calls_begin_after_commit_error_recovers_committed_call_as_unknown() {
    let (f, mut store, id, tool) = prepared();
    store.test_mcp_call_fault(Some(McpCallFault::AfterBegin));
    let error = store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-committed-begin"))
        .unwrap_err();
    assert_eq!(error.code, "MCP_CALL_TEST_FAULT");
    assert_eq!(states(&store, &id), vec![("possibly_sent".into(), None)]);
    store.test_mcp_call_fault(None);
    assert_eq!(
        store
            .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-committed-begin"))
            .unwrap_err()
            .code,
        "MCP_CALL_REPLAY"
    );
    assert!(store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-fresh-before-reopen"))
        .is_err());
    drop(store);
    let mut store = f.store();
    assert_unknown(&store, &id);
    assert_eq!(states(&store, &id), vec![("unknown".into(), None)]);
    assert_eq!(
        store
            .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-fresh-after-reopen"))
            .unwrap_err()
            .code,
        "MCP_RESULT_UNKNOWN"
    );
    assert_eq!(
        store
            .confirm_trial_mcp_call(&id, "call-committed-begin", false)
            .unwrap_err()
            .code,
        "MCP_RESULT_UNKNOWN"
    );
    assert_unknown(&store, &id);
}

#[test]
fn mcp_calls_response_before_commit_error_rolls_back_update_and_recovers_unknown() {
    for is_error in [false, true] {
        let (f, mut store, id, tool) = prepared();
        store
            .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-rollback-response"))
            .unwrap();
        store.test_mcp_call_fault(Some(McpCallFault::BeforeResponse));
        assert_eq!(
            store
                .confirm_trial_mcp_call(&id, "call-rollback-response", is_error)
                .unwrap_err()
                .code,
            "MCP_CALL_TEST_FAULT"
        );
        assert_eq!(states(&store, &id), vec![("possibly_sent".into(), None)]);
        assert_eq!(store.agent_run(&id).unwrap().status, "running");
        drop(store);
        let mut store = f.store();
        assert_unknown(&store, &id);
        assert_eq!(states(&store, &id), vec![("unknown".into(), None)]);
        assert_eq!(
            store
                .confirm_trial_mcp_call(&id, "call-rollback-response", is_error)
                .unwrap_err()
                .code,
            "MCP_RESULT_UNKNOWN"
        );
        store.cancel_agent_trial(&id).unwrap();
        store
            .finish_agent_trial_error(&id, "MODEL_TIMEOUT")
            .unwrap();
        assert_unknown(&store, &id);
    }
}

#[test]
fn mcp_calls_response_after_commit_error_preserves_response_and_never_becomes_unknown() {
    for is_error in [false, true] {
        let (f, mut store, id, tool) = prepared();
        store
            .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-committed-response"))
            .unwrap();
        store.test_mcp_call_fault(Some(McpCallFault::AfterResponse));
        assert_eq!(
            store
                .confirm_trial_mcp_call(&id, "call-committed-response", is_error)
                .unwrap_err()
                .code,
            "MCP_CALL_TEST_FAULT"
        );
        let category = if is_error { "tool_error" } else { "success" };
        assert_eq!(
            states(&store, &id),
            vec![("responded".into(), Some(category.into()))]
        );
        assert!(!store.trial_mcp_unknown(&id).unwrap());
        store.test_mcp_call_fault(None);
        assert!(store
            .confirm_trial_mcp_call(&id, "call-committed-response", is_error)
            .is_err());
        assert_eq!(
            store
                .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-committed-response"))
                .unwrap_err()
                .code,
            "MCP_CALL_REPLAY"
        );
        drop(store);
        let mut store = f.store();
        assert_eq!(store.agent_run(&id).unwrap().status, "interrupted");
        assert_eq!(
            states(&store, &id),
            vec![("responded".into(), Some(category.into()))]
        );
        store.cancel_agent_trial(&id).unwrap();
        store
            .finish_agent_trial_error(&id, "MODEL_TIMEOUT")
            .unwrap();
        store.interrupt_agent_trials(None).unwrap();
        assert!(!store.trial_mcp_unknown(&id).unwrap());
        assert_eq!(store.agent_run(&id).unwrap().status, "interrupted");
        assert_eq!(
            states(&store, &id),
            vec![("responded".into(), Some(category.into()))]
        );
    }
}

#[test]
fn mcp_calls_accept_opaque_utf8_model_call_ids_and_reject_control_bytes() {
    let (_f, mut store, id, tool) = prepared();
    let mut invalid = call(&store, &id, &tool, "invalid-model-id");
    invalid.model_call_id = "opaque\nmodel".into();
    assert!(store.begin_trial_mcp_call(&id, invalid).is_err());
    let mut opaque = call(&store, &id, &tool, "opaque-call");
    opaque.model_call_id = "opaque:model/1-合成".into();
    store.begin_trial_mcp_call(&id, opaque).unwrap();
    store
        .confirm_trial_mcp_call(&id, "opaque-call", false)
        .unwrap();
    assert_eq!(
        store
            .db()
            .unwrap()
            .query_row(
                "SELECT model_call_id FROM tool_calls WHERE id='opaque-call'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "opaque:model/1-合成"
    );
}

#[test]
fn mcp_calls_two_services_keep_namespaces_and_require_all_catalogs() {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    let first = server(&store, "first");
    let second = server(&store, "second");
    let id = trial(&mut store, true);
    store.prepare_trial_mcp(&id).unwrap();
    let first_tool = store
        .bind_trial_mcp_catalog(&id, &first, &catalog(), &[])
        .unwrap()
        .remove(0);
    assert!(store
        .begin_trial_mcp_call(&id, call(&store, &id, &first_tool, "before-second-catalog"))
        .is_err());
    let second_tool = store
        .bind_trial_mcp_catalog(&id, &second, &catalog(), &[])
        .unwrap()
        .remove(0);
    assert_ne!(first_tool.model_name, second_tool.model_name);
    assert_eq!(first_tool.tool_name, second_tool.tool_name);
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &first_tool, "first-call"))
        .unwrap();
    assert!(store
        .begin_trial_mcp_call(&id, call(&store, &id, &second_tool, "parallel-call"))
        .is_err());
    store
        .confirm_trial_mcp_call(&id, "first-call", false)
        .unwrap();
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &second_tool, "second-call"))
        .unwrap();
    store
        .confirm_trial_mcp_call(&id, "second-call", false)
        .unwrap();
    assert_eq!(
        store.complete_agent_trial(&id, vec![]).unwrap().status,
        "succeeded"
    );
}

#[test]
fn mcp_calls_invalid_configuration_is_not_treated_as_no_services() {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    server(&store, "synthetic");
    fs::write(store.root().unwrap().join("mcp/servers.json"), b"invalid").unwrap();
    let id = trial(&mut store, true);
    assert_eq!(
        store.prepare_trial_mcp(&id).err().unwrap().code,
        "MCP_CONFIG_INVALID"
    );
    assert!(store.agent_run(&id).unwrap().snapshot.get("mcp").is_none());
    let no_tools = trial(&mut store, false);
    assert!(store
        .prepare_trial_mcp(&no_tools)
        .unwrap()
        .servers
        .is_empty());
}

#[test]
fn mcp_calls_reject_forged_mapping_ids_arguments_and_cross_run_response() {
    let (_f, mut store, id, tool) = prepared();
    for field in [
        "revision", "schema", "model", "id", "model-id", "array", "invalid", "budget",
    ] {
        let mut request = call(&store, &id, &tool, "call-valid");
        match field {
            "revision" => request.configuration_revision = "forged".into(),
            "schema" => request.schema_sha256 = "0".repeat(64),
            "model" => request.model_name = "bash".into(),
            "id" => request.id = "x".repeat(129),
            "model-id" => request.model_call_id = "x".repeat(257),
            "array" => request.arguments_json = "[]".into(),
            "invalid" => request.arguments_json = "{".into(),
            "budget" => request.arguments_json = format!("{{\"query\":\"{}\"}}", "x".repeat(65536)),
            _ => unreachable!(),
        }
        assert!(store.begin_trial_mcp_call(&id, request).is_err(), "{field}");
    }
    assert!(states(&store, &id).is_empty());
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-valid"))
        .unwrap();
    let other = trial(&mut store, true);
    assert!(store
        .confirm_trial_mcp_call(&other, "call-valid", false)
        .is_err());
    assert_eq!(states(&store, &id)[0].0, "possibly_sent");
}

#[test]
fn mcp_calls_unknown_precedes_cancel_timeout_completion_and_cold_reopen() {
    for ending in ["cancel", "timeout", "complete", "interrupt", "reopen"] {
        let (f, mut store, id, tool) = prepared();
        store
            .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-pending"))
            .unwrap();
        match ending {
            "cancel" => {
                store.cancel_agent_trial(&id).unwrap();
            }
            "timeout" => {
                store
                    .finish_agent_trial_error(&id, "MODEL_TIMEOUT")
                    .unwrap();
            }
            "complete" => {
                assert!(store.complete_agent_trial(&id, vec![]).is_err());
            }
            "interrupt" => {
                store.interrupt_agent_trials(None).unwrap();
            }
            "reopen" => {
                drop(store);
                store = f.store();
            }
            _ => unreachable!(),
        }
        assert_unknown(&store, &id);
        assert_eq!(states(&store, &id), vec![("unknown".into(), None)]);
        assert!(store
            .confirm_trial_mcp_call(&id, "call-pending", false)
            .is_err());
        assert!(store.complete_agent_trial(&id, vec![]).is_err());
        store.cancel_agent_trial(&id).unwrap();
        store
            .finish_agent_trial_error(&id, "MODEL_TIMEOUT")
            .unwrap();
        store.interrupt_agent_trials(None).unwrap();
        assert_unknown(&store, &id);
        drop(store);
        let store = f.store();
        assert_unknown(&store, &id);
    }
}

#[test]
fn mcp_calls_unowned_recovery_excludes_active_and_promotes_ordinary_terminals() {
    let (_f, mut store, id, tool) = prepared();
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-owned"))
        .unwrap();
    store.interrupt_agent_trials(Some(&id)).unwrap();
    assert_eq!(store.agent_run(&id).unwrap().status, "running");
    assert_eq!(states(&store, &id)[0].0, "possibly_sent");
    store.db().unwrap().execute("UPDATE agent_runs SET status='cancelled',error_code='CANCELLED',finished_at_ms=created_at_ms WHERE id=?1", [&id]).unwrap();
    store.interrupt_agent_trials(None).unwrap();
    assert_unknown(&store, &id);
}

#[test]
fn mcp_calls_responded_survives_cancellation_and_restart_without_unknown() {
    let (f, mut store, id, tool) = prepared();
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-known"))
        .unwrap();
    store
        .confirm_trial_mcp_call(&id, "call-known", false)
        .unwrap();
    store.cancel_agent_trial(&id).unwrap();
    assert_eq!(store.agent_run(&id).unwrap().status, "cancelled");
    assert!(!store.trial_mcp_unknown(&id).unwrap());
    drop(store);
    let store = f.store();
    assert_eq!(
        states(&store, &id),
        vec![("responded".into(), Some("success".into()))]
    );
    assert!(!store.trial_mcp_unknown(&id).unwrap());
}

#[test]
fn mcp_calls_unknown_terminal_timestamp_is_absorbing() {
    let (f, mut store, id, tool) = prepared();
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-unknown"))
        .unwrap();
    store.cancel_agent_trial(&id).unwrap();
    store
        .db()
        .unwrap()
        .execute(
            "UPDATE agent_runs SET created_at_ms=0,finished_at_ms=1 WHERE id=?1",
            [&id],
        )
        .unwrap();
    store.cancel_agent_trial(&id).unwrap();
    assert_eq!(store.agent_run(&id).unwrap().finished_at_ms, Some(1));
    drop(store);
    let store = f.store();
    assert_unknown(&store, &id);
    assert_eq!(store.agent_run(&id).unwrap().finished_at_ms, Some(1));
}

#[test]
fn mcp_calls_trial_lifecycle_does_not_change_business_tables_or_runs() {
    let (_f, mut store, id, tool) = prepared();
    let todo = store.create(input(), "mcp-calls-existing").unwrap();
    let batch = store
        .begin_import(
            TextInput {
                text: "Synthetic material".into(),
                source_at_ms: None,
                time_zone: "UTC".into(),
            },
            json!({}),
            false,
        )
        .unwrap();
    store
        .publish_candidates(
            &batch.run.unwrap().id,
            vec![CandidateDraft {
                fields: input(),
                evidence: "Synthetic material".into(),
                due_expression: None,
                followup_expression: None,
                warnings: vec![],
                unresolved: false,
            }],
        )
        .unwrap();
    let before: Vec<_> = ["sources", "candidates", "todos", "todo_events", "runs"]
        .iter()
        .map(|table| {
            let mut statement = store
                .db()
                .unwrap()
                .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = statement.column_count();
            statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|n| row.get::<_, rusqlite::types::Value>(n))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        })
        .collect();
    store
        .begin_trial_mcp_call(&id, call(&store, &id, &tool, "call-isolated"))
        .unwrap();
    store.cancel_agent_trial(&id).unwrap();
    for (table, expected) in ["sources", "candidates", "todos", "todo_events", "runs"]
        .iter()
        .zip(before)
    {
        let mut statement = store
            .db()
            .unwrap()
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .unwrap();
        let columns = statement.column_count();
        let actual = statement
            .query_map([], |row| {
                (0..columns)
                    .map(|n| row.get::<_, rusqlite::types::Value>(n))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(actual, expected, "{table}");
    }
    assert_eq!(store.get(&todo.id).unwrap(), todo);
}
