use super::*;
use crate::local_store::tests::Fixture;
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;

fn stdio() -> McpServerDraft {
    serde_json::from_value(json!({"name":"合成stdio","transport":"stdio","enabled":true,"command":"/synthetic/not-executed","args":[],"cwd":null,"env":[],"connectTimeoutMs":10000,"toolTimeoutMs":30000})).unwrap()
}
fn http_value() -> serde_json::Value {
    json!({"name":"合成HTTP","transport":"http","enabled":true,"url":"http://127.0.0.1:43123/mcp","headers":[{"name":"X-Controlled-Auth","source":"environment","value":"SIDEKICK_HTTP_SYNTH_AUTH"}],"connectTimeoutMs":10000,"toolTimeoutMs":30000})
}
fn http() -> McpServerDraft {
    serde_json::from_value(http_value()).expect("approved HTTP wire format")
}
fn save(s: &AppStore, server: McpServerDraft) -> McpConfigSave {
    s.save_mcp_server(McpServerInput {
        id: None,
        expected_revision: s.mcp_configuration().unwrap().revision,
        server,
    })
    .unwrap()
}

#[test]
fn mcp_http_upgrade_backs_up_exact_v1_bytes_and_keeps_stdio_and_schema() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let old = save(&s, stdio());
    let root = s.root().unwrap();
    let path = root.join("mcp/servers.json");
    let before = fs::read(&path).unwrap();
    assert_eq!(old.configuration.version, 1);
    assert_eq!(s.mcp_configuration().unwrap().version, 1);
    assert_eq!(fs::read(&path).unwrap(), before);
    let added = save(&s, http());
    assert_eq!(added.configuration.version, 2);
    assert_eq!(added.configuration.servers[0], old.configuration.servers[0]);
    let backup = root
        .join("backups")
        .join(format!("mcp-servers-v1-{:x}.json", Sha256::digest(&before)));
    assert_eq!(fs::read(&backup).unwrap(), before);
    assert_eq!(fs::metadata(&backup).unwrap().mode() & 0o7777, 0o600);
    let public = serde_json::to_value(&added.configuration).unwrap();
    assert_eq!(public["servers"][1]["transport"], "http");
    for field in ["command", "args", "cwd", "env"] {
        assert!(public["servers"][1].get(field).is_none());
    }
    assert!(!String::from_utf8(fs::read(&path).unwrap())
        .unwrap()
        .contains("synthetic-secret"));
    s.remove_mcp_server(McpRemoveInput {
        id: added.server_id.unwrap(),
        expected_revision: added.configuration.revision,
    })
    .unwrap();
    assert_eq!(s.mcp_configuration().unwrap().version, 2);
    assert_eq!(
        s.db()
            .unwrap()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    drop(s);
    let s = f.store();
    assert_eq!(s.mcp_configuration().unwrap().servers.len(), 1);
    assert_eq!(fs::read(backup).unwrap(), before);
}

#[test]
fn mcp_http_backup_collision_fails_before_publishing_v2() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    save(&s, stdio());
    let root = s.root().unwrap();
    let path = root.join("mcp/servers.json");
    let before = fs::read(&path).unwrap();
    let backup = root
        .join("backups")
        .join(format!("mcp-servers-v1-{:x}.json", Sha256::digest(&before)));
    fs::write(&backup, b"synthetic collision").unwrap();
    fs::set_permissions(&backup, fs::Permissions::from_mode(0o600)).unwrap();
    let result = s.save_mcp_server(McpServerInput {
        id: None,
        expected_revision: s.mcp_configuration().unwrap().revision,
        server: http(),
    });
    assert_eq!(result.unwrap_err().code, "MCP_BACKUP_FAILED");
    assert_eq!(fs::read(path).unwrap(), before);
    assert_eq!(fs::read(backup).unwrap(), b"synthetic collision");
}

#[test]
fn mcp_http_wire_and_url_reject_ambiguous_or_plain_authentication() {
    for update in [
        json!({"command":"/synthetic/invalid"}),
        json!({"env":[]}),
        json!({"headers":[{"name":"Authorization","source":"literal","value":"synthetic-secret"}]}),
    ] {
        let mut value = http_value();
        for (key, value2) in update.as_object().unwrap() {
            value[key] = value2.clone();
        }
        let decoded = serde_json::from_value::<McpServerDraft>(value);
        assert!(decoded.is_err() || decoded.is_ok_and(|v| mcp_config::check_server(&v).is_err()));
    }
    for url in [
        "file:///synthetic",
        "http://example.invalid/mcp",
        "https://user:synthetic@example.invalid/mcp",
        "https://example.invalid/mcp#fragment",
        "https://example.invalid/mcp?api_key=synthetic",
    ] {
        let mut value = http_value();
        value["url"] = url.into();
        let draft: McpServerDraft = serde_json::from_value(value).unwrap();
        assert!(mcp_config::check_server(&draft).is_err());
    }
    for headers in [
        json!([{"name":"Host","source":"environment","value":"SIDEKICK_HTTP_SYNTH_AUTH"}]),
        json!([{"name":"X-Test","source":"environment","value":"A"},{"name":"x-test","source":"environment","value":"B"}]),
        json!([{"name":"X-Test","source":"environment","value":"${NO_INTERPOLATION}"}]),
    ] {
        let mut value = http_value();
        value["headers"] = headers;
        let draft: McpServerDraft = serde_json::from_value(value).unwrap();
        assert!(mcp_config::check_server(&draft).is_err());
    }
}

#[test]
fn mcp_http_old_stdio_serialization_order_is_unchanged_for_journal_hashes() {
    assert_eq!(
        serde_json::to_string(&stdio()).unwrap(),
        r#"{"name":"合成stdio","transport":"stdio","enabled":true,"command":"/synthetic/not-executed","args":[],"cwd":null,"env":[],"connectTimeoutMs":10000,"toolTimeoutMs":30000}"#
    );
    assert_eq!(serde_json::to_value(http()).unwrap(), http_value());
}

#[test]
fn mcp_http_publish_fault_retains_private_backup_and_readback_semantics() {
    for fault in [
        McpWriteFault::BeforeReplace,
        McpWriteFault::AfterReplace,
        McpWriteFault::ReadBack,
    ] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        save(&s, stdio());
        let root = s.root().unwrap();
        let before = fs::read(root.join("mcp/servers.json")).unwrap();
        s.mcp_write_fault = Some(fault);
        let result = s.save_mcp_server(McpServerInput {
            id: None,
            expected_revision: s.mcp_configuration().unwrap().revision,
            server: http(),
        });
        let backup = root
            .join("backups")
            .join(format!("mcp-servers-v1-{:x}.json", Sha256::digest(&before)));
        assert_eq!(fs::read(backup).unwrap(), before);
        match fault {
            McpWriteFault::BeforeReplace => {
                assert!(result.is_err());
                assert_eq!(fs::read(root.join("mcp/servers.json")).unwrap(), before);
            }
            McpWriteFault::AfterReplace => assert!(result.unwrap().warning.is_some()),
            McpWriteFault::ReadBack => assert_eq!(result.unwrap_err().code, "MCP_SAVE_UNCERTAIN"),
        }
    }
}

#[test]
fn mcp_http_duplicate_fields_are_rejected_before_value_conversion() {
    let raw = r#"{"id":"mcp-synthetic","name":"stdio","transport":"stdio","enabled":true,"command":"/synthetic","args":[],"cwd":null,"env":[{"name":"A","source":"literal","value":"one"}],"connectTimeoutMs":10000,"toolTimeoutMs":30000}"#;
    assert!(serde_json::from_str::<McpServer>(raw).is_ok());
    for (from, to) in [
        (
            r#""id":"mcp-synthetic""#,
            r#""id":"mcp-other","id":"mcp-synthetic""#,
        ),
        (r#""name":"stdio""#, r#""name":"other","name":"stdio""#),
        (
            r#""transport":"stdio""#,
            r#""transport":"stdio","transport":"stdio""#,
        ),
        (r#""value":"one""#, r#""value":"two","value":"one""#),
    ] {
        let duplicate = raw.replacen(from, to, 1);
        assert!(serde_json::from_str::<McpServer>(&duplicate).is_err());
    }
    let invalid = raw.replacen(
        r#""command":"/synthetic""#,
        r#""headers":[],"command":"/synthetic""#,
        1,
    );
    assert!(serde_json::from_str::<McpServer>(&invalid).is_err());
}

#[test]
fn mcp_http_legacy_server_and_document_compact_bytes_keep_journal_hashes() {
    let raw = r#"{"id":"mcp-synthetic","lastSecretOperation":"op-00000000-0000-0000-0000-000000000000","name":"stdio","transport":"stdio","enabled":true,"command":"/synthetic","args":["one argument",""],"cwd":null,"env":[{"name":"A","source":"literal","value":"one"},{"name":"B","source":"keychain","value":"synthetic-reference"}],"connectTimeoutMs":10000,"toolTimeoutMs":30000}"#;
    let server: McpServer = serde_json::from_str(raw).unwrap();
    assert_eq!(serde_json::to_string(&server).unwrap(), raw);
    let config = McpConfiguration {
        version: 1,
        revision: "old-revision".into(),
        servers: vec![server],
    };
    let expected = format!("{{\"version\":1,\"revision\":\"old-revision\",\"servers\":[{raw}]}}");
    assert_eq!(serde_json::to_string(&config).unwrap(), expected);
    assert_eq!(
        Sha256::digest(serde_json::to_vec(&config).unwrap()),
        Sha256::digest(expected.as_bytes())
    );
}

#[test]
fn mcp_http_backup_links_are_rejected_without_touching_the_target() {
    for hard in [false, true] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        save(&s, stdio());
        let root = s.root().unwrap();
        let path = root.join("mcp/servers.json");
        let before = fs::read(&path).unwrap();
        let target = root.join("synthetic-backup-target");
        fs::write(&target, b"preserve").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        let backup = root
            .join("backups")
            .join(format!("mcp-servers-v1-{:x}.json", Sha256::digest(&before)));
        if hard {
            fs::hard_link(&target, &backup).unwrap();
        } else {
            std::os::unix::fs::symlink(&target, &backup).unwrap();
        }
        let result = s.save_mcp_server(McpServerInput {
            id: None,
            expected_revision: s.mcp_configuration().unwrap().revision,
            server: http(),
        });
        assert_eq!(result.unwrap_err().code, "MCP_BACKUP_FAILED");
        assert_eq!(fs::read(path).unwrap(), before);
        assert_eq!(fs::read(target).unwrap(), b"preserve");
    }
}

#[test]
fn mcp_http_header_resolution_is_declared_only_private_and_revision_bound() {
    struct Environment(std::cell::RefCell<Vec<String>>, Option<String>);
    impl super::mcp_security::McpEnvironmentSource for Environment {
        fn get(&self, name: &str) -> Option<String> {
            self.0.borrow_mut().push(name.into());
            self.1.clone()
        }
    }
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let saved = save(&s, http());
    let id = saved.server_id.unwrap();
    let env = Environment(Default::default(), Some("Bearer synthetic-private".into()));
    let headers = s
        .prepare_mcp_http_headers_with(&id, &saved.configuration.revision, false, &env)
        .unwrap();
    assert_eq!(headers["X-Controlled-Auth"], "Bearer synthetic-private");
    assert_eq!(*env.0.borrow(), ["SIDEKICK_HTTP_SYNTH_AUTH"]);
    assert!(!serde_json::to_string(&s.mcp_configuration().unwrap())
        .unwrap()
        .contains("synthetic-private"));
    env.0.borrow_mut().clear();
    assert!(s
        .prepare_mcp_http_headers_with(&id, "stale", false, &env)
        .is_err());
    assert!(env.0.borrow().is_empty());
    for value in [
        None,
        Some(""),
        Some(" leading"),
        Some("trailing "),
        Some("line\nbreak"),
        Some("\u{100}"),
        Some(&"x".repeat(4097)),
    ] {
        let env = Environment(Default::default(), value.map(String::from));
        let code = s
            .prepare_mcp_http_headers_with(&id, &saved.configuration.revision, false, &env)
            .unwrap_err()
            .code;
        assert_eq!(
            code,
            if value.is_none_or(str::is_empty) {
                "MCP_ENV_MISSING"
            } else {
                "MCP_HTTP_HEADER"
            }
        );
    }
    let env = Environment(Default::default(), Some("x".repeat(4096)));
    assert_eq!(
        s.prepare_mcp_http_headers_with(&id, &saved.configuration.revision, false, &env)
            .unwrap()["X-Controlled-Auth"]
            .len(),
        4096
    );
}
