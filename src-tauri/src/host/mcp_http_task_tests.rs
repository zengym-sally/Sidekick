use super::mcp_trial_tests::TrialFixture;
use super::*;
use crate::local_store::{McpServerInput, McpTransportConfig};
use std::time::{SystemTime, UNIX_EPOCH};

struct HttpFixture {
    base: TrialFixture,
    service: std::process::Child,
    url: String,
    variables: Vec<String>,
}
impl HttpFixture {
    fn new(mode: &str, model: &str, tool_call: bool) -> Self {
        let base = TrialFixture::new(model, tool_call, true);
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/mcp-http.mjs")
            .canonicalize()
            .unwrap();
        let mut service = Command::new(base.directory.join("node"))
            .arg(fixture)
            .arg(base.root.join("http.jsonl"))
            .arg(mode)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut url = String::new();
        BufReader::new(service.stdout.take().unwrap())
            .read_line(&mut url)
            .unwrap();
        assert!(url.starts_with("http://127.0.0.1:"));
        let url = url.trim().to_string();
        base.local.as_ref().unwrap().access(|store| {
            let config = store.mcp_configuration()?;
            store.save_mcp_server(McpServerInput { id: Some(config.servers[0].id.clone()), expected_revision: config.revision, server: serde_json::from_value(json!({"name":"合成HTTP任务","transport":"http","enabled":true,"url":url,"headers":[],"connectTimeoutMs":1000,"toolTimeoutMs":1000})).unwrap() })?;
            Ok(())
        }).unwrap();
        Self {
            base,
            service,
            url,
            variables: Vec::new(),
        }
    }
    fn header(&mut self, value: &str) -> String {
        let key = format!(
            "SIDEKICK_HTTP_PRIVATE_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::set_var(&key, value);
        self.variables.push(key.clone());
        self.base
            .local
            .as_ref()
            .unwrap()
            .access(|store| {
                let c = store.mcp_configuration()?;
                let mut d = c.servers[0].settings.clone();
                if let McpTransportConfig::Http(h) = &mut d.transport {
                    h.headers = serde_json::from_value(
                        json!([{"name":"X-Controlled-Secret","source":"environment","value":key}]),
                    )
                    .unwrap();
                }
                store.save_mcp_server(McpServerInput {
                    id: Some(c.servers[0].id.clone()),
                    expected_revision: c.revision,
                    server: d,
                })?;
                Ok(())
            })
            .unwrap();
        key
    }
    fn calls(&self) -> usize {
        self.base
            .events("http.jsonl")
            .iter()
            .filter(|event| event["type"] == "call")
            .count()
    }
    fn extract(&self) -> ModelRun {
        self.base
            .runtime
            .start(
                self.base.local.as_ref().unwrap().clone(),
                self.base.directory.clone(),
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
    fn wait_business(&self, id: &str) -> ModelRun {
        let started = Instant::now();
        while self.base.runtime.active_run().is_some() {
            assert!(started.elapsed() < Duration::from_secs(20));
            std::thread::sleep(Duration::from_millis(10));
        }
        self.base
            .local
            .as_ref()
            .unwrap()
            .access(|store| store.model_run(id))
            .unwrap()
    }
}
impl Drop for HttpFixture {
    fn drop(&mut self) {
        self.base.runtime.shutdown(&self.base.directory);
        let _ = self.service.kill();
        let _ = self.service.wait();
        for key in &self.variables {
            std::env::remove_var(key);
        }
    }
}

#[test]
fn http_mixed_trial_binds_same_name_tools_and_private_session_scope() {
    let f = HttpFixture::new("json", "normal", true);
    let run = f.base.start();
    let result = f.base.wait(&run.id);
    assert_eq!(result.status, "succeeded", "{:?}", result.error_code);
    assert_eq!(f.calls(), 1);
    assert_eq!(
        f.base.calls(),
        vec![("responded".into(), "success".into()); 2]
    );
    assert_eq!(
        result.snapshot["mcp"]["remoteClose"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
    assert!(!serde_json::to_string(&result)
        .unwrap()
        .contains("synthetic-session"));
    for table in ["sources", "candidates", "todos", "todo_events"] {
        assert_eq!(
            f.base
                .database()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    let model = f.base.events("model.jsonl");
    assert_eq!(model[0]["names"].as_array().unwrap().len(), 2);
    assert_ne!(model[0]["names"][0], model[0]["names"][1]);
}

#[test]
fn http_formal_extract_revise_apply_sign_and_nonempty_trial_roundtrip() {
    let f = HttpFixture::new("sse-all", "normal", true);
    let evidence = super::mcp_formal_tests::roundtrip(
        f.base.local.as_ref().unwrap(),
        &f.base.runtime,
        &f.base.directory,
        &f.base.root.join("workspace"),
        2,
    );
    assert_eq!(evidence["calls"].as_array().unwrap().len(), 6);
    assert_eq!(f.calls(), 3);
    assert_eq!(
        f.base
            .database()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
}

#[test]
fn http_missing_variable_and_disabled_tools_have_zero_network() {
    for missing in [false, true] {
        let f = HttpFixture::new("json", "normal", missing);
        if missing {
            f.base.local.as_ref().unwrap().access(|store| {
            let c=store.mcp_configuration()?;let mut d=c.servers[0].settings.clone();
            if let McpTransportConfig::Http(h)=&mut d.transport { h.headers=serde_json::from_value(json!([{"name":"X-Test","source":"environment","value":"SIDEKICK_HTTP_UNDECLARED_MISSING"}])).unwrap(); }
            store.save_mcp_server(McpServerInput{id:Some(c.servers[0].id.clone()),expected_revision:c.revision,server:d})?;Ok(())
        }).unwrap();
        }
        let run = f.base.start();
        let result = f.base.wait(&run.id);
        assert_eq!(result.status, if missing { "failed" } else { "succeeded" });
        assert!(f.base.events("http.jsonl").is_empty());
        assert!(f.base.calls().is_empty());
    }
}

#[test]
fn http_lost_status_and_expired_responses_remain_unknown_across_reopen() {
    for mode in ["lost", "status", "expired"] {
        for business in [false, true] {
            let mut f = HttpFixture::new(mode, "lost", true);
            let (id, error) = if business {
                let run = f.extract();
                let result = f.wait_business(&run.id);
                assert!(result.preview.is_none());
                (run.id, result.error_code)
            } else {
                let run = f.base.start();
                let result = f.base.wait(&run.id);
                assert!(result.result.is_none());
                (run.id, result.error_code)
            };
            assert_eq!(
                error.as_deref(),
                Some("MCP_RESULT_UNKNOWN"),
                "{mode}/{business}"
            );
            assert_eq!(f.calls(), 1);
            assert_eq!(f.base.calls(), vec![("unknown".into(), String::new())]);
            if business {
                f.base.local.take();
                let store = crate::local_store::AppStore::open(f.base.root.join("app")).unwrap();
                assert_eq!(store.model_run(&id).unwrap().error_code, error);
            } else {
                assert_eq!(f.base.reopen(&id).error_code, error);
            }
            assert_eq!(f.calls(), 1);
            assert!(!f.base.root.join("forbidden-marker").exists());
            assert_eq!(f.base.events("model.jsonl").len(), 1);
        }
    }
}

#[test]
fn http_valid_tool_error_is_a_known_response() {
    let f = HttpFixture::new("tool-error", "normal", true);
    let run = f.base.start();
    let result = f.base.wait(&run.id);
    assert_eq!(result.status, "succeeded", "{:?}", result.error_code);
    assert_eq!(f.calls(), 1);
    assert!(f
        .base
        .calls()
        .contains(&("responded".into(), "tool_error".into())));
}

#[test]
fn http_and_stdio_catalog_changes_stop_the_frozen_task() {
    for http in [false, true] {
        if http {
            let f = HttpFixture::new("list-changed", "normal", true);
            let run = f.base.start();
            let result = f.base.wait(&run.id);
            assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
            assert_eq!(f.calls(), 1);
            assert_eq!(f.base.calls(), vec![("unknown".into(), String::new())]);
        } else {
            let f = TrialFixture::new("list-changed", true, true);
            let run = f.start();
            let result = f.wait(&run.id);
            assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
            assert_eq!(f.calls(), vec![("unknown".into(), String::new())]);
            assert!(!f
                .events("service-1.jsonl")
                .iter()
                .any(|e| e["type"] == "call"));
        }
    }
}

#[test]
fn http_configuration_and_variables_are_frozen_until_the_next_task() {
    let mut f = HttpFixture::new("freeze-header", "freeze", true);
    let key = f.header("synthetic-first");
    let run = f.base.start();
    let started = Instant::now();
    while f.base.events("model.jsonl").is_empty() {
        assert!(started.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(5));
    }
    std::env::set_var(key, "synthetic-second");
    f.base
        .local
        .as_ref()
        .unwrap()
        .access(|store| {
            let c = store.mcp_configuration()?;
            let mut draft = c.servers[0].settings.clone();
            draft.enabled = false;
            if let McpTransportConfig::Http(h) = &mut draft.transport {
                h.url = format!("{}?new-task-only=true", f.url);
            }
            store.save_mcp_server(McpServerInput {
                id: Some(c.servers[0].id.clone()),
                expected_revision: c.revision,
                server: draft,
            })?;
            Ok(())
        })
        .unwrap();
    std::fs::write(f.base.root.join("forbidden-marker.continue"), "continue").unwrap();
    let result = f.base.wait(&run.id);
    assert_eq!(result.status, "succeeded", "{:?}", result.error_code);
    assert_eq!(f.calls(), 1);
    assert_eq!(result.snapshot["mcp"]["servers"][0]["url"], f.url);
}

#[test]
fn http_ack_and_store_faults_preserve_durable_unknown_priority() {
    for (policy, sends, expected) in [
        ("reject-begin", 0, ""),
        ("store-begin-before", 0, ""),
        ("store-begin-after", 0, "unknown"),
        ("drop-begin-ack", 0, "unknown"),
        ("before-response", 1, "unknown"),
        ("store-response-before", 1, "unknown"),
        ("store-response-after", 1, "responded"),
        ("drop-response-ack", 1, "responded"),
    ] {
        let f = HttpFixture::new("json", "normal", true);
        *f.base.runtime.trial_policy.lock().unwrap() = Some(policy);
        let run = f.base.start();
        let result = f.base.wait(&run.id);
        assert_eq!(result.status, "failed", "{policy}");
        assert_eq!(f.calls(), sends, "{policy}");
        if expected.is_empty() {
            assert!(f.base.calls().is_empty(), "{policy}");
        } else {
            assert_eq!(f.base.calls().len(), 1, "{policy}");
            assert_eq!(f.base.calls()[0].0, expected, "{policy}");
        }
        assert_eq!(
            result.error_code.as_deref() == Some("MCP_RESULT_UNKNOWN"),
            expected == "unknown",
            "{policy}"
        );
    }
}

#[test]
fn http_private_headers_sessions_and_catalogs_never_reach_models_or_snapshots() {
    for mode in ["private-header", "private-session", "private-catalog"] {
        let f = HttpFixture::new(mode, "normal", true);
        let key = format!(
            "SIDEKICK_HTTP_PRIVATE_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::set_var(&key, "http-synthetic-private-marker");
        f.base
            .local
            .as_ref()
            .unwrap()
            .access(|store| {
                let c = store.mcp_configuration()?;
                let mut d = c.servers[0].settings.clone();
                if let McpTransportConfig::Http(h) = &mut d.transport {
                    h.headers = serde_json::from_value(
                        json!([{"name":"X-Controlled-Secret","source":"environment","value":key}]),
                    )
                    .unwrap();
                }
                store.save_mcp_server(McpServerInput {
                    id: Some(c.servers[0].id.clone()),
                    expected_revision: c.revision,
                    server: d,
                })?;
                Ok(())
            })
            .unwrap();
        let run = f.base.start();
        let result = f.base.wait(&run.id);
        std::env::remove_var(key);
        assert_eq!(result.status, "failed");
        assert_eq!(
            result.error_code.as_deref(),
            Some(if mode == "private-catalog" {
                "MCP_PRIVATE_OUTPUT"
            } else {
                "MCP_RESULT_UNKNOWN"
            })
        );
        let public = serde_json::to_string(&result).unwrap()
            + &serde_json::to_string(&f.base.events("model.jsonl")).unwrap();
        assert!(!public.contains("http-synthetic-private-marker"));
        assert!(!public.contains("synthetic-session"));
        assert!(result.result.is_none());
    }
}

#[test]
fn http_side_effect_rejects_same_batch_retry_and_formal_revise_replay() {
    let mut f = HttpFixture::new("lost", "recovery-retry", true);
    let run = f.base.start();
    let result = f.base.wait(&run.id);
    assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
    assert_eq!(f.calls(), 1);
    assert_eq!(f.base.events("model.jsonl").len(), 1);
    assert!(!f.base.root.join("forbidden-marker").exists());
    assert_eq!(f.base.reopen(&run.id).error_code, result.error_code);
    assert_eq!(f.calls(), 1);
    let f = HttpFixture::new("after-first-lost", "normal", true);
    let extracted = f.extract();
    assert_eq!(f.wait_business(&extracted.id).status, "succeeded");
    let candidate = f
        .base
        .local
        .as_ref()
        .unwrap()
        .access(|s| s.batch(extracted.source_id.as_deref().unwrap()))
        .unwrap()
        .candidates[0]
        .clone();
    let run = f
        .base
        .runtime
        .start(
            f.base.local.as_ref().unwrap().clone(),
            f.base.directory.clone(),
            StartTask::Revise {
                id: candidate.id.clone(),
                version: candidate.version,
                instruction: "把标题改为核对合成清单。".into(),
                time_zone: "UTC".into(),
            },
            Arc::new(|_, _| {}),
        )
        .unwrap();
    let result = f.wait_business(&run.id);
    assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
    assert!(result.preview.is_none());
    assert_eq!(f.calls(), 2);
    assert_eq!(
        f.base
            .local
            .as_ref()
            .unwrap()
            .access(|s| s.candidate(&candidate.id))
            .unwrap()
            .draft,
        candidate.draft
    );
}

#[test]
fn http_cancel_and_late_responses_never_publish_or_replay() {
    for business in [false, true] {
        for mode in ["dribble", "late"] {
            let f = HttpFixture::new(mode, "lost", true);
            let id = if business {
                f.extract().id
            } else {
                f.base.start().id
            };
            let started = Instant::now();
            while f.calls() == 0 {
                assert!(started.elapsed() < Duration::from_secs(10));
                std::thread::sleep(Duration::from_millis(5));
            }
            if mode == "dribble" {
                f.base.runtime.cancel(&id);
            }
            if business {
                let result = f.wait_business(&id);
                assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
                assert!(result.preview.is_none());
            } else {
                let result = f.base.wait(&id);
                assert_eq!(result.error_code.as_deref(), Some("MCP_RESULT_UNKNOWN"));
                assert!(result.result.is_none());
            }
            if mode == "late" {
                std::thread::sleep(Duration::from_millis(1700));
                assert!(f
                    .base
                    .events("http.jsonl")
                    .iter()
                    .any(|e| e["type"] == "late_attempt" && e["closed"] == true));
            }
            assert_eq!(f.calls(), 1);
            assert_eq!(f.base.calls(), vec![("unknown".into(), String::new())]);
            assert_eq!(f.base.events("model.jsonl").len(), 1);
        }
    }
}

#[test]
fn http_auth_failure_and_remote_close_facts_are_not_call_responses() {
    let f = HttpFixture::new("auth", "normal", true);
    let run = f.base.start();
    let result = f.base.wait(&run.id);
    assert_eq!(result.error_code.as_deref(), Some("MCP_HTTP_AUTH"));
    assert_eq!(f.calls(), 0);
    assert!(f.base.calls().is_empty());
    assert!(f.base.events("model.jsonl").is_empty());
    for (mode, expected) in [
        ("delete-error", "unconfirmed"),
        ("delete-unsupported", "unsupported"),
    ] {
        let f = HttpFixture::new(mode, "normal", true);
        let run = f.base.start();
        let result = f.base.wait(&run.id);
        assert_eq!(result.status, "succeeded");
        assert!(result.snapshot["mcp"]["remoteClose"]
            .as_object()
            .unwrap()
            .values()
            .any(|v| v == expected));
        assert_eq!(f.calls(), 1);
    }
}
