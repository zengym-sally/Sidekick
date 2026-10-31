use super::*;
use crate::local_store::tests::{input, Fixture};
use serde_json::json;

fn text() -> TextInput {
    TextInput {
        text: "Synthetic material".into(),
        source_at_ms: None,
        time_zone: "UTC".into(),
    }
}

fn draft() -> CandidateDraft {
    CandidateDraft {
        fields: input(),
        evidence: "Synthetic material".into(),
        due_expression: None,
        followup_expression: None,
        warnings: vec![],
        unresolved: false,
    }
}

fn persisted_pending() -> (Fixture, AppStore, String) {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    let id = store
        .begin_import(text(), json!({}), false)
        .unwrap()
        .run
        .unwrap()
        .id;
    store.db().unwrap().execute("INSERT INTO tool_calls(id,run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,created_at_ms) VALUES('synthetic-persisted-call',?1,'model-call','revision',?2,'synthetic-server','lookup',?2,'possibly_sent',1)",params![id,"0".repeat(64)]).unwrap();
    (f, store, id)
}

fn assert_unknown(store: &AppStore, id: &str) {
    let run = store.model_run(id).unwrap();
    assert_eq!(run.status, "failed");
    assert_eq!(run.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
    assert!(run.preview.is_none());
    assert!(run.finished_at_ms.is_some());
    let unknown: bool = store
        .db()
        .unwrap()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tool_calls WHERE run_id=?1 AND send_state='unknown')",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(unknown);
}

#[test]
fn mcp_calls_business_pending_precedes_ordinary_terminal_and_publication() {
    for ending in ["cancel", "error", "interrupt", "unowned", "publish"] {
        let (_f, mut store, id) = persisted_pending();
        match ending {
            "cancel" => {
                store.cancel_run(&id).unwrap();
            }
            "error" => {
                store.finish_run_error(&id, "MODEL_TIMEOUT").unwrap();
            }
            "interrupt" => {
                store.interrupt_model_run(&id).unwrap();
            }
            "unowned" => {
                store.interrupt_unowned_runs().unwrap();
            }
            "publish" => {
                assert!(store.publish_candidates(&id, vec![draft()]).is_err());
            }
            _ => unreachable!(),
        }
        assert_unknown(&store, &id);
        let run = store.model_run(&id).unwrap();
        let batch = store.batch(run.source_id.as_ref().unwrap()).unwrap();
        assert!(batch.candidates.is_empty());
        assert!(batch.source.succeeded_run_id.is_none());
        assert_eq!(batch.source.raw_text, text().text);
    }
}

#[test]
fn mcp_calls_business_cold_open_recovers_unknown_before_interrupted() {
    let (f, store, id) = persisted_pending();
    drop(store);
    let store = f.store();
    assert_unknown(&store, &id);
}

fn snapshot(tools: bool) -> Value {
    json!({"model":{"capabilities":{"toolCall":tools}},"agent":{"agentId":"organizer"}})
}

fn business(store: &mut AppStore, kind: &str, tools: bool) -> String {
    let run = store
        .begin_import(text(), snapshot(tools), false)
        .unwrap()
        .run
        .unwrap();
    if kind == "extract" {
        return run.id;
    }
    let batch = store.publish_candidates(&run.id, vec![draft()]).unwrap();
    let candidate = &batch.candidates[0];
    store
        .begin_revision(
            &candidate.id,
            candidate.version,
            "Synthetic revision".into(),
            snapshot(tools),
        )
        .unwrap()
        .id
}

fn server(store: &AppStore, name: &str) -> String {
    store.save_mcp_server(McpServerInput {
        id: None,
        expected_revision: store.mcp_configuration().unwrap().revision,
        server: serde_json::from_value(json!({"name":name,"transport":"stdio","enabled":true,"command":"/synthetic/never-executed","args":[],"cwd":null,"env":[],"connectTimeoutMs":1000,"toolTimeoutMs":1000})).unwrap(),
    }).unwrap().server_id.unwrap()
}

fn catalog() -> McpDiscoveredCatalog {
    serde_json::from_value(json!({"tools":[{"name":"lookup","description":"Synthetic lookup","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":false}}]})).unwrap()
}

fn prepared(kind: &str) -> (Fixture, AppStore, String, TrialMcpTool) {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    let sid = server(&store, "synthetic");
    let id = business(&mut store, kind, true);
    store.prepare_mcp_task(McpTaskOwner::Business, &id).unwrap();
    let tool = store
        .bind_mcp_task_catalog(McpTaskOwner::Business, &id, &sid, &catalog(), &[])
        .unwrap()
        .remove(0);
    (f, store, id, tool)
}

fn call(store: &AppStore, id: &str, tool: &TrialMcpTool, cid: &str) -> McpCallInput {
    serde_json::from_value(json!({"id":cid,"modelCallId":format!("model-{cid}"),"modelName":tool.model_name,"configurationRevision":store.model_run(id).unwrap().snapshot["mcp"]["revision"],"schemaSha256":tool.schema_sha256,"argumentsJson":"{\"query\":\"synthetic-private-argument\"}"})).unwrap()
}

fn states(store: &AppStore, id: &str) -> Vec<(String, Option<String>)> {
    store
        .db()
        .unwrap()
        .prepare(
            "SELECT send_state,response_category FROM tool_calls WHERE run_id=?1 ORDER BY rowid",
        )
        .unwrap()
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn counts(store: &AppStore) -> Vec<i64> {
    [
        "sources",
        "candidates",
        "todos",
        "todo_events",
        "todo_sources",
    ]
    .iter()
    .map(|table| {
        store
            .db()
            .unwrap()
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    })
    .collect()
}

#[test]
fn mcp_calls_business_extract_and_revise_use_frozen_catalog_and_hash_receipts() {
    for kind in ["extract", "revise"] {
        let (_f, mut store, id, tool) = prepared(kind);
        let before = store.model_run(&id).unwrap().snapshot;
        let baseline = counts(&store);
        server(&store, "later-service");
        assert!(store.prepare_mcp_task(McpTaskOwner::Business, &id).is_err());
        assert_eq!(store.model_run(&id).unwrap().snapshot, before);
        assert!(store
            .bind_mcp_task_catalog(
                McpTaskOwner::Business,
                &id,
                &tool.server_id,
                &catalog(),
                &[]
            )
            .is_err());
        for field in ["revision", "schema", "model", "array", "budget"] {
            let mut request = call(&store, &id, &tool, "invalid-call");
            match field {
                "revision" => request.configuration_revision = "forged".into(),
                "schema" => request.schema_sha256 = "0".repeat(64),
                "model" => request.model_name = "Bash".into(),
                "array" => request.arguments_json = "[]".into(),
                "budget" => {
                    request.arguments_json = format!("{{\"query\":\"{}\"}}", "x".repeat(65536))
                }
                _ => unreachable!(),
            }
            assert_eq!(
                store
                    .begin_mcp_task_call(McpTaskOwner::Business, &id, request)
                    .unwrap_err()
                    .code,
                "MCP_CALL_INVALID"
            );
        }
        assert!(states(&store, &id).is_empty());
        let request = call(&store, &id, &tool, "known-error");
        let expected_hash = hash(request.arguments_json.as_bytes());
        store
            .begin_mcp_task_call(McpTaskOwner::Business, &id, request)
            .unwrap();
        store
            .confirm_mcp_task_call(McpTaskOwner::Business, &id, "known-error", true)
            .unwrap();
        let receipt: (String, Option<String>, String, Option<String>) = store.db().unwrap().query_row("SELECT run_id,agent_run_id,arguments_sha256,response_summary FROM tool_calls WHERE id='known-error'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert_eq!(receipt, (id.clone(), None, expected_hash, None));
        assert_eq!(
            states(&store, &id),
            vec![("responded".into(), Some("tool_error".into()))]
        );
        assert!(!store.mcp_task_unknown(McpTaskOwner::Business, &id).unwrap());
        assert_eq!(counts(&store), baseline);
        if kind == "extract" {
            store.publish_candidates(&id, vec![draft()]).unwrap();
        } else {
            store.publish_revision(&id, draft()).unwrap();
        }
        assert_eq!(store.model_run(&id).unwrap().status, "succeeded");
    }
}

#[test]
fn mcp_calls_business_scope_rejects_test_other_roles_and_model_supplied_scope() {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    server(&store, "synthetic");
    let test = store.begin_model_test(snapshot(true)).unwrap();
    for owner in [McpTaskOwner::Business, McpTaskOwner::Trial] {
        assert_eq!(
            store.prepare_mcp_task(owner, &test.id).err().unwrap().code,
            "MCP_CALL_INVALID"
        );
    }
    for agent in ["organizer", "tracker", "advisor"] {
        let id = if agent == "organizer" {
            store
                .begin_prepared_agent_trial(agent, text(), snapshot(true))
                .unwrap()
                .id
        } else {
            assert_eq!(
                store
                    .begin_prepared_agent_trial(agent, text(), snapshot(true))
                    .unwrap_err()
                    .code,
                "AGENT_TRIAL_UNAVAILABLE"
            );
            let id = format!("unsupported-{agent}");
            store.db().unwrap().execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(?1,?2,'role_trial','running',?3,?4,1)",params![id,agent,snapshot(true).to_string(),serde_json::to_string(&text()).unwrap()]).unwrap();
            id
        };
        assert!(store.prepare_mcp_task(McpTaskOwner::Business, &id).is_err());
        if agent != "organizer" {
            assert!(store.prepare_mcp_task(McpTaskOwner::Trial, &id).is_err());
        }
    }
    store
        .db()
        .unwrap()
        .pragma_update(None, "ignore_check_constraints", true)
        .unwrap();
    store.db().unwrap().execute("INSERT INTO runs(id,kind,status,snapshot_json,input_json,created_at_ms) VALUES('future-kind','synthetic_future_kind','running',?1,'{}',1)",[snapshot(true).to_string()]).unwrap();
    store
        .db()
        .unwrap()
        .pragma_update(None, "ignore_check_constraints", false)
        .unwrap();
    assert!(store
        .prepare_mcp_task(McpTaskOwner::Business, "future-kind")
        .is_err());
    let id = business(&mut store, "extract", true);
    assert!(store.prepare_mcp_task(McpTaskOwner::Trial, &id).is_err());
    assert!(store
        .prepare_mcp_task(McpTaskOwner::Business, "new-kind-or-missing-run")
        .is_err());
    let forged = json!({"id":"forged-call","modelCallId":"model-forged","modelName":"lookup","configurationRevision":"revision","schemaSha256":"0".repeat(64),"argumentsJson":"{}","scope":"Business"});
    assert!(serde_json::from_value::<McpCallInput>(forged).is_err());
    let count: i64 = store
        .db()
        .unwrap()
        .query_row("SELECT count(*) FROM tool_calls", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    store.finish_model_test(&test.id).unwrap();
}

#[test]
fn mcp_calls_business_and_trial_same_id_keep_separate_ownership_and_replay_guards() {
    let (_f, mut store, id, tool) = prepared("extract");
    store.db().unwrap().execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(?1,'organizer','role_trial','running',?2,?3,1)",params![id,snapshot(true).to_string(),serde_json::to_string(&text()).unwrap()]).unwrap();
    store.prepare_trial_mcp(&id).unwrap();
    let trial_tool = store
        .bind_trial_mcp_catalog(&id, &tool.server_id, &catalog(), &[])
        .unwrap()
        .remove(0);
    store
        .begin_mcp_task_call(
            McpTaskOwner::Business,
            &id,
            call(&store, &id, &tool, "business-call"),
        )
        .unwrap();
    let mut trial_call = call(&store, &id, &trial_tool, "trial-call");
    trial_call.model_call_id = "model-business-call".into();
    store.begin_trial_mcp_call(&id, trial_call).unwrap();
    assert!(store
        .confirm_mcp_task_call(McpTaskOwner::Business, &id, "trial-call", false)
        .is_err());
    assert!(store
        .confirm_trial_mcp_call(&id, "business-call", false)
        .is_err());
    store
        .confirm_mcp_task_call(McpTaskOwner::Business, &id, "business-call", false)
        .unwrap();
    let mut repeated = call(&store, &id, &tool, "fresh-id");
    repeated.model_call_id = "model-business-call".into();
    assert_eq!(
        store
            .begin_mcp_task_call(McpTaskOwner::Business, &id, repeated)
            .unwrap_err()
            .code,
        "MCP_CALL_REPLAY"
    );
    assert_eq!(
        store
            .begin_mcp_task_call(
                McpTaskOwner::Business,
                &id,
                call(&store, &id, &tool, "trial-call")
            )
            .unwrap_err()
            .code,
        "MCP_CALL_REPLAY"
    );
    store
        .begin_mcp_task_call(
            McpTaskOwner::Business,
            &id,
            call(&store, &id, &tool, "business-pending"),
        )
        .unwrap();
    store.settle_mcp_task(McpTaskOwner::Business, &id).unwrap();
    assert!(store.mcp_task_unknown(McpTaskOwner::Business, &id).unwrap());
    assert!(!store.trial_mcp_unknown(&id).unwrap());
    assert_eq!(store.agent_run(&id).unwrap().status, "running");
    store
        .confirm_trial_mcp_call(&id, "trial-call", true)
        .unwrap();
    assert_eq!(
        store.complete_agent_trial(&id, vec![]).unwrap().status,
        "succeeded"
    );
    assert_unknown(&store, &id);
}

#[test]
fn mcp_calls_business_all_persistence_boundaries_survive_cold_open() {
    for kind in ["extract", "revise"] {
        for fault in [
            McpCallFault::BeforeBegin,
            McpCallFault::AfterBegin,
            McpCallFault::BeforeResponse,
            McpCallFault::AfterResponse,
        ] {
            let (f, mut store, id, tool) = prepared(kind);
            let baseline = counts(&store);
            let response_fault = matches!(
                fault,
                McpCallFault::BeforeResponse | McpCallFault::AfterResponse
            );
            if response_fault {
                store
                    .begin_mcp_task_call(
                        McpTaskOwner::Business,
                        &id,
                        call(&store, &id, &tool, "fault-call"),
                    )
                    .unwrap();
            }
            store.test_mcp_call_fault(Some(fault));
            let error = if response_fault {
                store
                    .confirm_mcp_task_call(McpTaskOwner::Business, &id, "fault-call", true)
                    .unwrap_err()
            } else {
                store
                    .begin_mcp_task_call(
                        McpTaskOwner::Business,
                        &id,
                        call(&store, &id, &tool, "fault-call"),
                    )
                    .unwrap_err()
            };
            assert_eq!(error.code, "MCP_CALL_TEST_FAULT");
            assert!(!error.message.contains("synthetic-private-argument"));
            let pending = matches!(
                fault,
                McpCallFault::AfterBegin | McpCallFault::BeforeResponse
            );
            match fault {
                McpCallFault::BeforeBegin => assert!(states(&store, &id).is_empty()),
                McpCallFault::AfterResponse => assert_eq!(
                    states(&store, &id),
                    vec![("responded".into(), Some("tool_error".into()))]
                ),
                _ => assert_eq!(states(&store, &id), vec![("possibly_sent".into(), None)]),
            }
            drop(store);
            let mut store = f.store();
            assert_eq!(counts(&store), baseline);
            if pending {
                assert_unknown(&store, &id);
                assert_eq!(
                    store
                        .confirm_mcp_task_call(McpTaskOwner::Business, &id, "fault-call", false)
                        .unwrap_err()
                        .code,
                    "MCP_RESULT_UNKNOWN"
                );
            } else {
                assert_eq!(store.model_run(&id).unwrap().status, "interrupted");
                assert!(!store.mcp_task_unknown(McpTaskOwner::Business, &id).unwrap());
                if response_fault {
                    assert_eq!(
                        states(&store, &id),
                        vec![("responded".into(), Some("tool_error".into()))]
                    );
                }
            }
        }
    }
}

#[test]
fn mcp_calls_business_query_only_rejects_begin_response_and_terminal_writes() {
    for kind in ["extract", "revise"] {
        for operation in ["begin", "response", "settle", "publish"] {
            let (f, mut store, id, tool) = prepared(kind);
            let baseline = counts(&store);
            if operation != "begin" {
                store
                    .begin_mcp_task_call(
                        McpTaskOwner::Business,
                        &id,
                        call(&store, &id, &tool, "readonly-call"),
                    )
                    .unwrap();
            }
            let request = call(&store, &id, &tool, "readonly-call");
            store.test_mcp_query_only(true).unwrap();
            let error = match operation {
                "begin" => store
                    .begin_mcp_task_call(McpTaskOwner::Business, &id, request)
                    .unwrap_err(),
                "response" => store
                    .confirm_mcp_task_call(McpTaskOwner::Business, &id, "readonly-call", false)
                    .unwrap_err(),
                "settle" => store.cancel_run(&id).unwrap_err(),
                "publish" if kind == "extract" => {
                    store.publish_candidates(&id, vec![draft()]).unwrap_err()
                }
                "publish" => store.publish_revision(&id, draft()).unwrap_err(),
                _ => unreachable!(),
            };
            assert_eq!(error.code, "DATABASE_ERROR");
            assert!(!error.message.contains("synthetic-private-argument"));
            assert_eq!(store.model_run(&id).unwrap().status, "running");
            assert_eq!(counts(&store), baseline);
            if operation == "begin" {
                assert!(states(&store, &id).is_empty());
            } else {
                assert_eq!(states(&store, &id), vec![("possibly_sent".into(), None)]);
            }
            store.test_mcp_query_only(false).unwrap();
            drop(store);
            let store = f.store();
            if operation == "begin" {
                assert_eq!(store.model_run(&id).unwrap().status, "interrupted");
            } else {
                assert_unknown(&store, &id);
            }
            assert_eq!(counts(&store), baseline);
        }
    }
}

#[test]
fn mcp_calls_business_unknown_absorbs_preview_ordinary_terminals_and_timestamps() {
    for kind in ["extract", "revise"] {
        let (f, mut store, id, tool) = prepared(kind);
        let baseline = counts(&store);
        store
            .begin_mcp_task_call(
                McpTaskOwner::Business,
                &id,
                call(&store, &id, &tool, "unknown-call"),
            )
            .unwrap();
        store.db().unwrap().execute("UPDATE runs SET status='failed',error_code='MODEL_TIMEOUT',preview_json=?2,finished_at_ms=created_at_ms WHERE id=?1",params![id,serde_json::to_string(&draft()).unwrap()]).unwrap();
        store.interrupt_unowned_runs().unwrap();
        assert_unknown(&store, &id);
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE runs SET created_at_ms=0,finished_at_ms=1 WHERE id=?1",
                [&id],
            )
            .unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE tool_calls SET created_at_ms=0,finished_at_ms=2 WHERE run_id=?1",
                [&id],
            )
            .unwrap();
        store.cancel_run(&id).unwrap();
        store.finish_run_error(&id, "MODEL_TIMEOUT").unwrap();
        store.interrupt_model_run(&id).unwrap();
        store.interrupt_unowned_runs().unwrap();
        assert!(store.publish_candidates(&id, vec![draft()]).is_err());
        assert!(store.publish_revision(&id, draft()).is_err());
        assert_eq!(
            store
                .confirm_mcp_task_call(McpTaskOwner::Business, &id, "unknown-call", false)
                .unwrap_err()
                .code,
            "MCP_RESULT_UNKNOWN"
        );
        assert_eq!(
            store
                .begin_mcp_task_call(
                    McpTaskOwner::Business,
                    &id,
                    call(&store, &id, &tool, "late-call")
                )
                .unwrap_err()
                .code,
            "MCP_RESULT_UNKNOWN"
        );
        assert_eq!(store.model_run(&id).unwrap().finished_at_ms, Some(1));
        assert_eq!(counts(&store), baseline);
        drop(store);
        let store = f.store();
        assert_unknown(&store, &id);
        assert_eq!(store.model_run(&id).unwrap().finished_at_ms, Some(1));
        let finished: i64 = store
            .db()
            .unwrap()
            .query_row(
                "SELECT finished_at_ms FROM tool_calls WHERE run_id=?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(finished, 2);
        assert_eq!(counts(&store), baseline);
    }
}

#[test]
fn mcp_calls_business_known_response_survives_cancel_and_reopen() {
    for kind in ["extract", "revise"] {
        for is_error in [false, true] {
            let (f, mut store, id, tool) = prepared(kind);
            store
                .begin_mcp_task_call(
                    McpTaskOwner::Business,
                    &id,
                    call(&store, &id, &tool, "responded-call"),
                )
                .unwrap();
            store
                .confirm_mcp_task_call(McpTaskOwner::Business, &id, "responded-call", is_error)
                .unwrap();
            store.cancel_run(&id).unwrap();
            let category = if is_error { "tool_error" } else { "success" };
            assert_eq!(store.model_run(&id).unwrap().status, "cancelled");
            drop(store);
            let mut store = f.store();
            store.finish_run_error(&id, "MODEL_TIMEOUT").unwrap();
            store.interrupt_unowned_runs().unwrap();
            assert_eq!(store.model_run(&id).unwrap().status, "cancelled");
            assert_eq!(
                states(&store, &id),
                vec![("responded".into(), Some(category.into()))]
            );
            assert!(!store.mcp_task_unknown(McpTaskOwner::Business, &id).unwrap());
        }
    }
}

#[test]
fn mcp_calls_business_v3_empty_disabled_and_no_tools_preserve_text_paths() {
    for mode in ["v3", "empty", "disabled", "no-tools"] {
        let f = Fixture::new();
        let mut store = f.store();
        store.initialize(None, "UTC").unwrap();
        if mode != "v3" {
            store.upgrade_mcp_storage().unwrap();
        }
        if ["disabled", "no-tools"].contains(&mode) {
            let sid = server(&store, "synthetic");
            if mode == "disabled" {
                let mut settings = store
                    .mcp_configuration()
                    .unwrap()
                    .servers
                    .remove(0)
                    .settings;
                settings.enabled = false;
                store
                    .save_mcp_server(McpServerInput {
                        id: Some(sid),
                        expected_revision: store.mcp_configuration().unwrap().revision,
                        server: settings,
                    })
                    .unwrap();
            } else {
                fs::write(store.root().unwrap().join("mcp/servers.json"), b"invalid").unwrap();
            }
        }
        let id = business(&mut store, "extract", mode != "no-tools");
        let prepared = store.prepare_mcp_task(McpTaskOwner::Business, &id).unwrap();
        assert!(prepared.servers.is_empty());
        assert!(!store.mcp_task_unknown(McpTaskOwner::Business, &id).unwrap());
        if ["empty", "disabled"].contains(&mode) {
            let frozen = store.model_run(&id).unwrap().snapshot["mcp"].clone();
            server(&store, "later-service");
            assert!(store.prepare_mcp_task(McpTaskOwner::Business, &id).is_err());
            assert_eq!(store.model_run(&id).unwrap().snapshot["mcp"], frozen);
        } else {
            assert!(store.model_run(&id).unwrap().snapshot.get("mcp").is_none());
        }
        store.publish_candidates(&id, vec![draft()]).unwrap();
        assert_eq!(store.model_run(&id).unwrap().status, "succeeded");
    }
}

#[test]
fn mcp_calls_business_preparation_failure_is_not_silently_no_services() {
    let f = Fixture::new();
    let mut store = f.store();
    store.initialize(None, "UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    let sid = server(&store, "synthetic");
    let mut settings = store
        .mcp_configuration()
        .unwrap()
        .servers
        .remove(0)
        .settings;
    let missing = format!("SIDEKICK_SYNTHETIC_MISSING_{}", nonce());
    settings.env.push(McpEnvironment {
        name: "SYNTHETIC_VALUE".into(),
        source: "environment".into(),
        value: missing,
    });
    store
        .save_mcp_server(McpServerInput {
            id: Some(sid),
            expected_revision: store.mcp_configuration().unwrap().revision,
            server: settings,
        })
        .unwrap();
    let id = business(&mut store, "extract", true);
    assert_eq!(
        store
            .prepare_mcp_task(McpTaskOwner::Business, &id)
            .err()
            .unwrap()
            .code,
        "MCP_ENV_MISSING"
    );
    assert!(store.model_run(&id).unwrap().snapshot.get("mcp").is_none());
    store.finish_run_error(&id, "MCP_ENV_MISSING").unwrap();
    assert_eq!(
        store.model_run(&id).unwrap().error_code.as_deref(),
        Some("MCP_ENV_MISSING")
    );
}

#[test]
fn mcp_calls_business_explicit_retry_creates_new_run_without_replaying_unknown() {
    let (_f, mut store, old_id, tool) = prepared("extract");
    store
        .begin_mcp_task_call(
            McpTaskOwner::Business,
            &old_id,
            call(&store, &old_id, &tool, "old-call"),
        )
        .unwrap();
    store.cancel_run(&old_id).unwrap();
    let no_retry = store.begin_import(text(), snapshot(true), false).unwrap();
    assert!(!no_retry.started);
    assert_eq!(no_retry.run.unwrap().id, old_id);
    let retry = store.begin_import(text(), snapshot(true), true).unwrap();
    assert!(retry.started);
    let new_id = retry.run.unwrap().id;
    assert_ne!(new_id, old_id);
    store
        .prepare_mcp_task(McpTaskOwner::Business, &new_id)
        .unwrap();
    let new_tool = store
        .bind_mcp_task_catalog(
            McpTaskOwner::Business,
            &new_id,
            &tool.server_id,
            &catalog(),
            &[],
        )
        .unwrap()
        .remove(0);
    store
        .begin_mcp_task_call(
            McpTaskOwner::Business,
            &new_id,
            call(&store, &new_id, &new_tool, "new-call"),
        )
        .unwrap();
    store
        .confirm_mcp_task_call(McpTaskOwner::Business, &new_id, "new-call", false)
        .unwrap();
    store.publish_candidates(&new_id, vec![draft()]).unwrap();
    assert_unknown(&store, &old_id);
    assert_eq!(states(&store, &old_id), vec![("unknown".into(), None)]);
    assert_eq!(store.model_run(&new_id).unwrap().status, "succeeded");
}

#[test]
fn mcp_calls_business_extract_revision_apply_sign_preserves_explicit_acceptance() {
    let (_f, mut store, extract, tool) = prepared("extract");
    let baseline = store.create(input(), "formal-existing-todo").unwrap();
    store
        .begin_mcp_task_call(
            McpTaskOwner::Business,
            &extract,
            call(&store, &extract, &tool, "extract-call"),
        )
        .unwrap();
    store
        .confirm_mcp_task_call(McpTaskOwner::Business, &extract, "extract-call", false)
        .unwrap();
    let batch = store.publish_candidates(&extract, vec![draft()]).unwrap();
    assert_eq!(store.list().unwrap(), vec![baseline.clone()]);
    let c = &batch.candidates[0];
    let revision = store
        .begin_revision(
            &c.id,
            c.version,
            "Synthetic revision".into(),
            snapshot(true),
        )
        .unwrap();
    store
        .prepare_mcp_task(McpTaskOwner::Business, &revision.id)
        .unwrap();
    let revision_tool = store
        .bind_mcp_task_catalog(
            McpTaskOwner::Business,
            &revision.id,
            &tool.server_id,
            &catalog(),
            &[],
        )
        .unwrap()
        .remove(0);
    store
        .begin_mcp_task_call(
            McpTaskOwner::Business,
            &revision.id,
            call(&store, &revision.id, &revision_tool, "revision-call"),
        )
        .unwrap();
    store
        .confirm_mcp_task_call(McpTaskOwner::Business, &revision.id, "revision-call", false)
        .unwrap();
    let mut revised = draft();
    revised.fields.title = "Synthetic revised title".into();
    store.publish_revision(&revision.id, revised).unwrap();
    assert_eq!(store.candidate(&c.id).unwrap().version, c.version);
    assert_eq!(store.list().unwrap(), vec![baseline.clone()]);
    let applied = store
        .apply_preview(&revision.id, c.version, "formal-apply-preview")
        .unwrap();
    assert_eq!(applied.status, "pending");
    assert_eq!(applied.draft.fields.title, "Synthetic revised title");
    assert_eq!(store.list().unwrap(), vec![baseline.clone()]);
    let choices = vec![SignChoice {
        candidate_id: applied.id.clone(),
        expected_version: applied.version,
        fields: applied.draft.fields.clone(),
        time_reviewed: true,
        target: None,
    }];
    let first = store
        .sign_candidates(choices.clone(), "formal-sign")
        .unwrap();
    let replay = store
        .sign_candidates(choices.clone(), "formal-sign")
        .unwrap();
    assert_eq!(first, replay);
    assert_eq!(
        store
            .sign_candidates(choices, "formal-sign-new-operation")
            .unwrap_err()
            .code,
        "CANDIDATE_FINAL"
    );
    assert_eq!(store.list().unwrap().len(), 2);
    assert_eq!(store.todo_source_links(&first[0].id).unwrap().len(), 1);
    assert_eq!(store.history(&first[0].id).unwrap().len(), 1);
    assert_eq!(store.history(&baseline.id).unwrap().len(), 1);
}
