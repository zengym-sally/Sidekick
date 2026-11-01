use super::*;
use crate::local_store::tests::{input, Fixture};

fn draft() -> McpServerDraft {
    serde_json::from_value(json!({"name":"合成本机服务","transport":"stdio","enabled":true,"command":"/synthetic/not-executed","args":["one argument",""],"cwd":null,"env":[],"connectTimeoutMs":10000,"toolTimeoutMs":30000})).unwrap()
}
fn save(s: &AppStore, id: Option<String>, server: McpServerDraft) -> Result<McpConfigSave> {
    s.save_mcp_server(McpServerInput {
        id,
        expected_revision: s.mcp_configuration()?.revision,
        server,
    })
}
#[test]
fn mcp_config_crud_reopen_is_private_and_never_runs_a_command() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let todo = s.create(input(), "mcp-before").unwrap();
    let root = s.root().unwrap();
    let path = root.join("mcp/servers.json");
    assert!(s.mcp_configuration().unwrap().servers.is_empty());
    assert!(!path.exists());
    let saved = save(&s, None, draft()).unwrap();
    let id = saved.server_id.unwrap();
    assert!(id.starts_with("mcp-"));
    assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
    let mut changed = draft();
    changed.name = "更名".into();
    changed.enabled = false;
    let updated = save(&s, Some(id.clone()), changed).unwrap();
    assert_ne!(updated.configuration.revision, saved.configuration.revision);
    assert_eq!(updated.configuration.servers[0].id, id);
    drop(s);
    let s = f.store();
    let config = s.mcp_configuration().unwrap();
    assert_eq!(config.servers[0].settings.name, "更名");
    assert!(!config.servers[0].settings.enabled);
    assert_eq!(s.list().unwrap(), vec![todo.clone()]);
    assert_eq!(s.history(&todo.id).unwrap().len(), 1);
    for table in ["runs", "agent_runs", "sources", "candidates"] {
        assert_eq!(
            s.db()
                .unwrap()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    let sentinel = root.join("do-not-touch");
    fs::write(&sentinel, b"preserve").unwrap();
    s.remove_mcp_server(McpRemoveInput {
        id,
        expected_revision: config.revision,
    })
    .unwrap();
    assert!(s.mcp_configuration().unwrap().servers.is_empty());
    assert_eq!(fs::read(sentinel).unwrap(), b"preserve");
    assert_eq!(
        s.db()
            .unwrap()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
}
#[test]
fn mcp_config_stale_revision_and_unknown_id_do_not_overwrite() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let saved = save(&s, None, draft()).unwrap();
    let path = s.root().unwrap().join("mcp/servers.json");
    let before = fs::read(&path).unwrap();
    assert_eq!(
        s.save_mcp_server(McpServerInput {
            id: None,
            expected_revision: String::new(),
            server: draft()
        })
        .unwrap_err()
        .code,
        "MCP_VERSION_CONFLICT"
    );
    assert_eq!(
        save(&s, Some("mcp-unknown".into()), draft())
            .unwrap_err()
            .code,
        "MCP_NOT_FOUND"
    );
    assert_eq!(
        s.remove_mcp_server(McpRemoveInput {
            id: saved.server_id.unwrap(),
            expected_revision: String::new()
        })
        .unwrap_err()
        .code,
        "MCP_VERSION_CONFLICT"
    );
    assert_eq!(fs::read(path).unwrap(), before);
}
#[test]
fn mcp_config_invalid_json_version_shape_links_and_limits_preserve_originals() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let path = s.root().unwrap().join("mcp/servers.json");
    for (bytes, code) in [
        (b"not-json".to_vec(), "MCP_CONFIG_INVALID"),
        (
            br#"{"version":99,"revision":"r","servers":[]}"#.to_vec(),
            "MCP_CONFIG_INVALID",
        ),
        (vec![b' '; 262145], "MCP_LIMIT"),
    ] {
        fs::write(&path, &bytes).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(s.mcp_configuration().unwrap_err().code, code);
        assert_eq!(
            s.save_mcp_server(McpServerInput {
                id: None,
                expected_revision: "r".into(),
                server: draft()
            })
            .unwrap_err()
            .code,
            code
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    fs::remove_file(&path).unwrap();
    let valid = save(&s, None, draft()).unwrap().configuration;
    let valid_bytes = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    let outside = f.0.join("outside");
    fs::write(&outside, &valid_bytes).unwrap();
    fs::set_permissions(&outside, fs::Permissions::from_mode(0o600)).unwrap();
    fs::copy(&outside, &path).unwrap();
    assert_eq!(s.mcp_configuration().unwrap(), valid);
    fs::remove_file(&path).unwrap();
    for hard in [false, true] {
        if hard {
            fs::hard_link(&outside, &path).unwrap();
        } else {
            std::os::unix::fs::symlink(&outside, &path).unwrap();
        }
        assert_eq!(
            s.mcp_configuration().unwrap_err().code,
            "MCP_CONFIG_INVALID"
        );
        assert_eq!(
            s.save_mcp_server(McpServerInput {
                id: None,
                expected_revision: valid.revision.clone(),
                server: draft()
            })
            .unwrap_err()
            .code,
            "MCP_CONFIG_INVALID"
        );
        assert_eq!(fs::read(&outside).unwrap(), valid_bytes);
        fs::remove_file(&path).unwrap();
    }
    let directory = path.parent().unwrap();
    fs::remove_dir(directory).unwrap();
    std::os::unix::fs::symlink(&f.0, directory).unwrap();
    assert!(s.mcp_configuration().is_err());
    assert!(save(&s, None, draft()).is_err());
}
#[test]
fn mcp_config_validates_fields_environment_and_encoded_budget() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    for field in ["name", "command"] {
        let mut value = serde_json::to_value(draft()).unwrap();
        value[field] = json!("");
        assert!(save(&s, None, serde_json::from_value(value).unwrap()).is_err());
    }
    for (key, value) in [
        ("transport", json!("http")),
        ("connectTimeoutMs", json!(0)),
        ("toolTimeoutMs", json!(60001)),
        ("cwd", json!("relative")),
        ("command", json!("bad\0command")),
        ("args", json!(["--api-key=synthetic"])),
    ] {
        let mut v = serde_json::to_value(draft()).unwrap();
        v[key] = value;
        if let Ok(server) = serde_json::from_value(v) {
            assert!(save(&s, None, server).is_err(), "{key}");
        }
    }
    for env in [
        json!([{"name":"BAD=NAME","source":"literal","value":"v"}]),
        json!([{"name":"A","source":"environment","value":"bad-name"}]),
        json!([{"name":"A","source":"literal","value":"v"},{"name":"A","source":"literal","value":"v"}]),
        json!([{"name":"A","source":"keychain","value":"other-model-key"}]),
    ] {
        let mut v = serde_json::to_value(draft()).unwrap();
        v["env"] = env;
        if let Ok(d) = serde_json::from_value(v) {
            assert!(save(&s, None, d).is_err());
        }
    }
    let mut configured = serde_json::to_value(draft()).unwrap();
    configured["env"] = json!([{"name":"NORMAL","source":"literal","value":"non-secret"},{"name":"REFERENCE","source":"environment","value":"SIDEKICK_SYNTHETIC_UNREAD"}]);
    let saved = save(&s, None, serde_json::from_value(configured).unwrap()).unwrap();
    assert_eq!(
        saved.configuration.servers[0]
            .settings
            .stdio()
            .unwrap()
            .env
            .len(),
        2
    );
    let path = s.root().unwrap().join("mcp/servers.json");
    let original = fs::read(&path).unwrap();
    let mut big = draft();
    big.stdio_mut().unwrap().args = vec!["明".repeat(1300); 80];
    assert!(save(&s, None, big).is_err());
    assert_eq!(fs::read(path).unwrap(), original);
    for _ in 1..20 {
        save(&s, None, draft()).unwrap();
    }
    assert_eq!(save(&s, None, draft()).unwrap_err().code, "MCP_LIMIT");
}
#[test]
fn mcp_config_write_failures_read_back_or_require_reconciliation() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let first = save(&s, None, draft()).unwrap();
    let path = s.root().unwrap().join("mcp/servers.json");
    let before = fs::read(&path).unwrap();
    s.mcp_write_fault = Some(McpWriteFault::BeforeReplace);
    assert!(save(&s, None, draft()).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    s.mcp_write_fault = Some(McpWriteFault::AfterReplace);
    let recovered = save(&s, None, draft()).unwrap();
    assert!(recovered.warning.is_some());
    assert_eq!(recovered.configuration.servers.len(), 2);
    s.mcp_write_fault = Some(McpWriteFault::ReadBack);
    assert_eq!(
        save(&s, None, draft()).unwrap_err().code,
        "MCP_SAVE_UNCERTAIN"
    );
    s.mcp_write_fault = None;
    assert_eq!(s.mcp_configuration().unwrap().servers.len(), 3);
    assert_eq!(
        s.mcp_configuration().unwrap().servers[0].id,
        first.server_id.unwrap()
    );
}

#[test]
fn mcp_config_rejects_unknown_fields_duplicate_ids_and_nonprivate_files() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    save(&s, None, draft()).unwrap();
    let path = s.root().unwrap().join("mcp/servers.json");
    let original = fs::read(&path).unwrap();
    let configuration: serde_json::Value = serde_json::from_slice(&original).unwrap();
    for changed in [
        {
            let mut c = configuration.clone();
            c["servers"][0]["apiKeyRef"] = json!("other-model-reference");
            c
        },
        {
            let mut c = configuration.clone();
            let duplicate = c["servers"][0].clone();
            c["servers"].as_array_mut().unwrap().push(duplicate);
            c
        },
        {
            let mut c = configuration.clone();
            c["servers"][0]["id"] = json!("../outside");
            c
        },
    ] {
        let bytes = serde_json::to_vec(&changed).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(s.mcp_configuration().is_err());
        assert!(save(&s, None, draft()).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    fs::write(&path, &original).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(s.mcp_configuration().is_err());
    assert!(save(&s, None, draft()).is_err());
    assert_eq!(fs::read(path).unwrap(), original);
}
