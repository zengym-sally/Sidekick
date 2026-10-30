use super::mcp_security::*;
use super::*;
use crate::local_store::tests::Fixture;
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::sync::Mutex;

#[derive(Default)]
struct MemoryCredentials {
    values: Mutex<BTreeMap<(String, String), String>>,
    reads: Mutex<usize>,
    writes: Mutex<usize>,
    fail_write: Mutex<bool>,
    fail_read: Mutex<bool>,
    wrong_read: Mutex<bool>,
}
impl McpCredentialBackend for MemoryCredentials {
    fn available(&self) -> bool {
        true
    }
    fn get(
        &self,
        scope: &str,
        reference: &str,
    ) -> std::result::Result<String, McpCredentialFailure> {
        *self.reads.lock().unwrap() += 1;
        if *self.fail_read.lock().unwrap() {
            return Err(McpCredentialFailure::Unavailable);
        }
        if *self.wrong_read.lock().unwrap() {
            return Ok("synthetic-wrong-readback".into());
        }
        self.values
            .lock()
            .unwrap()
            .get(&(scope.into(), reference.into()))
            .cloned()
            .ok_or(McpCredentialFailure::Missing)
    }
    fn put(
        &self,
        scope: &str,
        reference: &str,
        value: &str,
    ) -> std::result::Result<(), McpCredentialFailure> {
        *self.writes.lock().unwrap() += 1;
        if *self.fail_write.lock().unwrap() {
            return Err(McpCredentialFailure::Unavailable);
        }
        self.values
            .lock()
            .unwrap()
            .insert((scope.into(), reference.into()), value.into());
        Ok(())
    }
}
#[derive(Default)]
struct Environment(BTreeMap<String, String>);
impl McpEnvironmentSource for Environment {
    fn get(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
}
fn draft() -> McpServerDraft {
    serde_json::from_value(json!({"name":"合成安全服务","transport":"stdio","enabled":true,"command":"/synthetic/not-executed","args":[],"cwd":null,"env":[{"name":"TOKEN","source":"keychain","value":""}],"connectTimeoutMs":10000,"toolTimeoutMs":30000})).unwrap()
}
fn secret_input(s: &AppStore, id: Option<String>, op: &str, value: &str) -> McpSecretInput {
    McpSecretInput {
        edit: McpServerInput {
            id,
            expected_revision: s.mcp_configuration().unwrap().revision,
            server: draft(),
        },
        operation_id: op.into(),
        values: BTreeMap::from([("TOKEN".into(), value.into())]),
    }
}
const OP1: &str = "op-00000000-0000-4000-8000-000000000001";
const OP2: &str = "op-00000000-0000-4000-8000-000000000002";
const SECRET: &str = "synthetic-private-marker-only-in-memory";
#[test]
fn mcp_security_fake_credentials_are_bound_redacted_and_resolved_only_inside_host() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let saved = s
        .save_mcp_secrets_with(secret_input(&s, None, OP1, SECRET), &vault)
        .unwrap();
    let id = saved.server_id.clone().unwrap();
    assert_eq!(saved.configuration.servers[0].settings.env[0].value, "");
    assert_eq!(
        saved.configuration.credential_status[&id]["TOKEN"],
        "stored"
    );
    let view = serde_json::to_string(&saved).unwrap();
    assert!(!view.contains(SECRET));
    assert!(!view.contains("mcp1:"));
    let bytes = fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains(SECRET));
    assert!(String::from_utf8_lossy(&bytes).contains("mcp1:"));
    let prepared = s
        .prepare_mcp_environment_with(
            &id,
            &saved.configuration.revision,
            &vault,
            &Environment::default(),
        )
        .unwrap();
    assert!(prepared.into_values()["TOKEN"] == SECRET);
    drop(s);
    let s = f.store();
    assert_eq!(
        s.mcp_configuration_with(&vault).unwrap().credential_status[&id]["TOKEN"],
        "stored"
    );
}
#[test]
fn mcp_security_default_backend_never_establishes_credential_access() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    assert_eq!(
        s.save_mcp_secrets(secret_input(&s, None, OP1, SECRET))
            .unwrap_err()
            .code,
        "MCP_CREDENTIAL_UNAVAILABLE"
    );
    assert!(!s.root().unwrap().join("mcp/servers.json").exists());
    assert!(!s
        .root()
        .unwrap()
        .join("mcp/credentials-journal.json")
        .exists());
    assert!(!s.mcp_configuration().unwrap().secure_storage_available);
}
#[test]
fn mcp_security_foreign_service_root_field_and_model_references_are_rejected_before_backend_io() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let saved = s
        .save_mcp_secrets_with(secret_input(&s, None, OP1, SECRET), &vault)
        .unwrap();
    let path = s.root().unwrap().join("mcp/servers.json");
    let original = fs::read(&path).unwrap();
    let base: serde_json::Value = serde_json::from_slice(&original).unwrap();
    let reference = base["servers"][0]["env"][0]["value"]
        .as_str()
        .unwrap()
        .to_string();
    {
        let mut changed = base.clone();
        let n = *vault.reads.lock().unwrap();
        changed["servers"][0]["env"][0]["value"] = json!("credential-model-reference");
        fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert_eq!(
            s.mcp_configuration_with(&vault).unwrap_err().code,
            "MCP_CREDENTIAL_SCOPE"
        );
        assert_eq!(*vault.reads.lock().unwrap(), n);
    }
    for (field, value) in [
        ("id", json!("mcp-other-service")),
        ("name", json!("OTHER_FIELD")),
    ] {
        let mut changed = base.clone();
        if field == "id" {
            changed["servers"][0]["id"] = value;
        } else {
            changed["servers"][0]["env"][0]["name"] = value;
        }
        fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert_eq!(
            s.mcp_configuration_with(&vault).unwrap_err().code,
            "MCP_CREDENTIAL_SCOPE"
        );
    }
    fs::write(&path, &original).unwrap();
    let other = Fixture::new();
    let mut second = other.store();
    second.initialize(None, "UTC").unwrap();
    let other_path = second.root().unwrap().join("mcp/servers.json");
    fs::write(&other_path, &original).unwrap();
    fs::set_permissions(&other_path, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        second.mcp_configuration_with(&vault).unwrap_err().code,
        "MCP_CREDENTIAL_SCOPE"
    );
    let mut input = draft();
    input.env[0].value = reference;
    assert_eq!(
        s.save_mcp_server(McpServerInput {
            id: saved.server_id,
            expected_revision: saved.configuration.revision,
            server: input
        })
        .unwrap_err()
        .code,
        "MCP_CREDENTIAL_SCOPE"
    );
}
#[test]
fn mcp_security_explicit_environment_does_not_inherit_or_expand_and_missing_values_fail() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let mut d = draft();
    d.env = vec![
        McpEnvironment {
            name: "PLAIN".into(),
            source: "literal".into(),
            value: "$HOME remains literal".into(),
        },
        McpEnvironment {
            name: "LOOKUP".into(),
            source: "environment".into(),
            value: "SYNTHETIC_SOURCE".into(),
        },
    ];
    let saved = s
        .save_mcp_server(McpServerInput {
            id: None,
            expected_revision: String::new(),
            server: d,
        })
        .unwrap();
    let id = saved.server_id.clone().unwrap();
    let vault = MemoryCredentials::default();
    let environment = Environment(BTreeMap::from([
        ("SYNTHETIC_SOURCE".into(), "synthetic-result".into()),
        ("MODEL_API_KEY".into(), "never-inherited".into()),
    ]));
    let values = s
        .prepare_mcp_environment_with(&id, &saved.configuration.revision, &vault, &environment)
        .unwrap()
        .into_values();
    assert_eq!(values.len(), 2);
    assert_eq!(values["PLAIN"], "$HOME remains literal");
    assert_eq!(values["LOOKUP"], "synthetic-result");
    assert!(!values.contains_key("MODEL_API_KEY"));
    assert_eq!(*vault.reads.lock().unwrap(), 0);
    assert_eq!(
        s.prepare_mcp_environment_with(
            &id,
            &saved.configuration.revision,
            &vault,
            &Environment::default()
        )
        .err()
        .unwrap()
        .code,
        "MCP_ENV_MISSING"
    );
    let mut bad = environment;
    bad.0.insert("SYNTHETIC_SOURCE".into(), "bad\0value".into());
    assert_eq!(
        s.prepare_mcp_environment_with(&id, &saved.configuration.revision, &vault, &bad)
            .err()
            .unwrap()
            .code,
        "MCP_ENV_INVALID"
    );
}
#[test]
fn mcp_security_journal_reconciles_actual_files_without_replaying_credentials_or_overwriting_config(
) {
    for fault in [
        McpSecurityFault::AfterJournal,
        McpSecurityFault::AfterFirstCredential,
        McpSecurityFault::BeforePublish,
        McpSecurityFault::AfterPublish,
        McpSecurityFault::ReadBack,
    ] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let vault = MemoryCredentials::default();
        s.mcp_security_fault = Some(fault);
        let _ = s.save_mcp_secrets_with(secret_input(&s, None, OP1, SECRET), &vault);
        s.mcp_security_fault = None;
        let writes = *vault.writes.lock().unwrap();
        let view = s.mcp_configuration_with(&vault).unwrap();
        assert_eq!(*vault.writes.lock().unwrap(), writes);
        let published = matches!(
            fault,
            McpSecurityFault::AfterPublish | McpSecurityFault::ReadBack
        );
        assert_eq!(view.servers.len(), usize::from(published));
        assert!(!s
            .root()
            .unwrap()
            .join("mcp/credentials-journal.json")
            .exists());
        let archive = fs::read(
            s.root()
                .unwrap()
                .join(format!("backups/mcp-credentials-{OP1}.json")),
        )
        .unwrap();
        assert!(!String::from_utf8_lossy(&archive).contains(SECRET));
    }
}
#[test]
fn mcp_security_unknown_or_untrusted_journal_preserves_all_state() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let path = s.root().unwrap().join("mcp/credentials-journal.json");
    for bytes in [
        b"not-json".to_vec(),
        br#"{"version":99}"#.to_vec(),
        vec![b' '; 512 * 1024 + 1],
    ] {
        fs::write(&path, &bytes).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            s.mcp_configuration_with(&vault).unwrap_err().code,
            "MCP_SAVE_UNCERTAIN"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(*vault.writes.lock().unwrap(), 0);
    }
}
#[test]
fn mcp_security_credential_replacement_keeps_old_refs_and_missing_values_remain_explicit() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let saved = s
        .save_mcp_secrets_with(secret_input(&s, None, OP1, SECRET), &vault)
        .unwrap();
    let id = saved.server_id.clone().unwrap();
    let old_refs = vault
        .values
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let replaced = s
        .save_mcp_secrets_with(
            secret_input(&s, Some(id.clone()), OP2, "synthetic-replacement-marker"),
            &vault,
        )
        .unwrap();
    assert_eq!(vault.values.lock().unwrap().len(), 2);
    assert!(old_refs
        .iter()
        .all(|key| vault.values.lock().unwrap().contains_key(key)));
    vault.values.lock().unwrap().clear();
    assert_eq!(
        s.mcp_configuration_with(&vault).unwrap().credential_status[&id]["TOKEN"],
        "missing"
    );
    assert_eq!(
        s.prepare_mcp_environment_with(
            &id,
            &replaced.configuration.revision,
            &vault,
            &Environment::default()
        )
        .err()
        .unwrap()
        .code,
        "MCP_CREDENTIAL_MISSING"
    );
}
#[test]
fn mcp_security_swapped_root_mcp_or_backup_paths_block_without_creating_outside_files() {
    for directory in ["root", "mcp", "backups"] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let root = s.root().unwrap();
        let original = if directory == "root" {
            root.clone()
        } else {
            root.join(directory)
        };
        let moved = f.0.join(format!("moved-{directory}"));
        fs::rename(&original, &moved).unwrap();
        let outside = f.0.join("outside-dir");
        fs::create_dir(&outside).unwrap();
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o700)).unwrap();
        std::os::unix::fs::symlink(&outside, &original).unwrap();
        assert_eq!(s.mcp_configuration().unwrap_err().code, "MCP_PATH_CHANGED");
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }
}

fn private_bytes(path: &Path, bytes: &[u8]) {
    fs::write(path, bytes).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
}
fn pending(s: &mut AppStore, vault: &MemoryCredentials) -> (PathBuf, Vec<u8>) {
    s.mcp_security_fault = Some(McpSecurityFault::ReadBack);
    assert_eq!(
        s.save_mcp_secrets_with(secret_input(s, None, OP1, SECRET), vault)
            .unwrap_err()
            .code,
        "MCP_SAVE_UNCERTAIN"
    );
    s.mcp_security_fault = None;
    let path = s.root().unwrap().join("mcp/credentials-journal.json");
    let bytes = fs::read(&path).unwrap();
    (path, bytes)
}
#[test]
fn mcp_security_utf8_value_item_and_input_budgets_precede_backend_io() {
    // 4096 UTF-8 bytes is accepted, even though it is fewer characters.
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let exact = "界".repeat(1365) + "x";
    assert_eq!(exact.len(), 4096);
    s.save_mcp_secrets_with(secret_input(&s, None, OP1, &exact), &vault)
        .unwrap();
    let before = fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap();
    let writes = *vault.writes.lock().unwrap();
    for value in [exact + "x", String::new(), "bad\0value".into()] {
        let error = s
            .save_mcp_secrets_with(secret_input(&s, None, OP2, &value), &vault)
            .unwrap_err();
        assert_eq!(error.code, "MCP_CONFIG_INVALID");
        assert_eq!(*vault.writes.lock().unwrap(), writes);
        assert_eq!(
            fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap(),
            before
        );
    }
    let mut input = secret_input(&s, None, OP2, SECRET);
    input.edit.server.args = vec!["x".repeat(4096); 128];
    assert!(serde_json::to_vec(&input).unwrap().len() > 512 * 1024);
    assert_eq!(
        s.save_mcp_secrets_with(input, &vault).unwrap_err().code,
        "MCP_LIMIT"
    );
    let mut input = secret_input(&s, None, OP2, SECRET);
    input.values = (0..65)
        .map(|n| (format!("V{n}"), "synthetic-item".into()))
        .collect();
    assert_eq!(
        s.save_mcp_secrets_with(input, &vault).unwrap_err().code,
        "MCP_LIMIT"
    );
    assert_eq!(*vault.writes.lock().unwrap(), writes);
    assert_eq!(
        fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap(),
        before
    );
}
#[test]
fn mcp_security_64_values_and_resolved_environment_256k_exact_boundary() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let mut input = secret_input(&s, None, OP1, SECRET);
    input.edit.server.env = (0..64)
        .map(|n| McpEnvironment {
            name: format!("V{n}"),
            source: "keychain".into(),
            value: String::new(),
        })
        .collect();
    input.values = (0..64)
        .map(|n| (format!("V{n}"), "界".repeat(1365) + "x"))
        .collect();
    let saved = s.save_mcp_secrets_with(input, &vault).unwrap();
    assert_eq!(vault.values.lock().unwrap().len(), 64);
    let id = saved.server_id.clone().unwrap();
    let values = s
        .prepare_mcp_environment_with(
            &id,
            &saved.configuration.revision,
            &vault,
            &Environment::default(),
        )
        .unwrap()
        .into_values();
    assert_eq!(values.len(), 64);
    assert_eq!(values.values().map(String::len).sum::<usize>(), 256 * 1024);
    // Explicit host lookup has the same byte boundary and rejects +1.
    let mut d = draft();
    d.env = vec![McpEnvironment {
        name: "E".into(),
        source: "environment".into(),
        value: "SOURCE".into(),
    }];
    let saved = s
        .save_mcp_server(McpServerInput {
            id: Some(id.clone()),
            expected_revision: saved.configuration.revision,
            server: d,
        })
        .unwrap();
    let mut environment = Environment(BTreeMap::from([("SOURCE".into(), "界".repeat(1365) + "x")]));
    assert_eq!(
        s.prepare_mcp_environment_with(&id, &saved.configuration.revision, &vault, &environment)
            .unwrap()
            .into_values()["E"]
            .len(),
        4096
    );
    environment.0.get_mut("SOURCE").unwrap().push('x');
    assert_eq!(
        s.prepare_mcp_environment_with(&id, &saved.configuration.revision, &vault, &environment)
            .err()
            .unwrap()
            .code,
        "MCP_ENV_INVALID"
    );
}
#[test]
fn mcp_security_failed_backend_and_wrong_readback_never_publish_or_remove_old_refs() {
    for mode in ["write", "read", "wrong"] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let vault = MemoryCredentials::default();
        let saved = s
            .save_mcp_secrets_with(secret_input(&s, None, OP1, SECRET), &vault)
            .unwrap();
        let old = fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap();
        let old_keys = vault
            .values
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        match mode {
            "write" => *vault.fail_write.lock().unwrap() = true,
            "read" => *vault.fail_read.lock().unwrap() = true,
            _ => *vault.wrong_read.lock().unwrap() = true,
        };
        let err = s
            .save_mcp_secrets_with(
                secret_input(&s, saved.server_id, OP2, "synthetic-new-secret"),
                &vault,
            )
            .unwrap_err();
        assert_eq!(err.code, "MCP_CREDENTIAL_UNAVAILABLE");
        assert_eq!(
            fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap(),
            old
        );
        assert!(old_keys
            .iter()
            .all(|k| vault.values.lock().unwrap().contains_key(k)));
        let archive = fs::read(
            s.root()
                .unwrap()
                .join(format!("backups/mcp-credentials-{OP2}.json")),
        )
        .unwrap();
        assert!(!String::from_utf8_lossy(&archive).contains("synthetic-new-secret"));
    }
}
#[test]
fn mcp_security_same_field_retains_reference_rename_requires_new_value_and_revision_is_checked() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let saved = s
        .save_mcp_secrets_with(secret_input(&s, None, OP1, SECRET), &vault)
        .unwrap();
    let id = saved.server_id.clone().unwrap();
    let original: serde_json::Value =
        serde_json::from_slice(&fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap())
            .unwrap();
    let mut d = draft();
    d.name = "重命名服务".into();
    let saved = s
        .save_mcp_server(McpServerInput {
            id: Some(id.clone()),
            expected_revision: saved.configuration.revision,
            server: d.clone(),
        })
        .unwrap();
    let changed: serde_json::Value =
        serde_json::from_slice(&fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap())
            .unwrap();
    assert_eq!(
        original["servers"][0]["env"][0]["value"],
        changed["servers"][0]["env"][0]["value"]
    );
    let reads = *vault.reads.lock().unwrap();
    assert_eq!(
        s.prepare_mcp_environment_with(&id, "stale-revision", &vault, &Environment::default())
            .err()
            .unwrap()
            .code,
        "MCP_VERSION_CONFLICT"
    );
    assert_eq!(*vault.reads.lock().unwrap(), reads);
    d.env[0].name = "RENAMED".into();
    assert_eq!(
        s.save_mcp_server(McpServerInput {
            id: Some(id),
            expected_revision: saved.configuration.revision,
            server: d
        })
        .unwrap_err()
        .code,
        "MCP_CREDENTIAL_MISSING"
    );
}
#[test]
fn mcp_security_journal_third_state_unknown_fields_and_versions_preserve_exact_files() {
    for mode in ["third", "version", "field", "scope"] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let vault = MemoryCredentials::default();
        let (path, bytes) = pending(&mut s, &vault);
        let config = s.root().unwrap().join("mcp/servers.json");
        if mode == "third" {
            let mut doc: serde_json::Value =
                serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
            doc["servers"][0]["name"] = json!("third independent state");
            private_bytes(&config, &serde_json::to_vec(&doc).unwrap());
        } else {
            let mut journal: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            match mode {
                "version" => journal["version"] = json!(99),
                "field" => journal["unexpected"] = json!(true),
                _ => journal["newRefs"][0]["reference"] = json!("model-reference"),
            };
            private_bytes(&path, &serde_json::to_vec(&journal).unwrap());
        }
        let journal_before = fs::read(&path).unwrap();
        let config_before = fs::read(&config).unwrap();
        let writes = *vault.writes.lock().unwrap();
        assert_eq!(
            s.mcp_configuration_with(&vault).unwrap_err().code,
            "MCP_SAVE_UNCERTAIN"
        );
        assert_eq!(fs::read(&path).unwrap(), journal_before);
        assert_eq!(fs::read(&config).unwrap(), config_before);
        assert_eq!(*vault.writes.lock().unwrap(), writes);
        assert_eq!(
            s.save_mcp_server(McpServerInput {
                id: None,
                expected_revision: String::new(),
                server: draft()
            })
            .unwrap_err()
            .code,
            "MCP_SAVE_UNCERTAIN"
        );
    }
}
#[test]
fn mcp_security_journal_budget_has_valid_exact_control_and_rejects_plus_one() {
    for extra in [0, 1] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let vault = MemoryCredentials::default();
        let (path, mut bytes) = pending(&mut s, &vault);
        bytes.resize(512 * 1024 + extra, b' ');
        private_bytes(&path, &bytes);
        if extra == 0 {
            assert_eq!(s.mcp_configuration_with(&vault).unwrap().servers.len(), 1);
            assert!(!path.exists());
            assert_eq!(
                fs::read(
                    s.root()
                        .unwrap()
                        .join(format!("backups/mcp-credentials-{OP1}.json"))
                )
                .unwrap(),
                bytes
            );
        } else {
            assert_eq!(
                s.mcp_configuration_with(&vault).unwrap_err().code,
                "MCP_SAVE_UNCERTAIN"
            );
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
}
#[test]
fn mcp_security_journal_and_archive_links_collision_permissions_block_without_overwrite() {
    for mode in [
        "journal-soft",
        "journal-hard",
        "archive-soft",
        "archive-hard",
        "archive-collision",
        "archive-permission",
    ] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let vault = MemoryCredentials::default();
        let (path, bytes) = pending(&mut s, &vault);
        let archive = s
            .root()
            .unwrap()
            .join(format!("backups/mcp-credentials-{OP1}.json"));
        let target = f.0.join("private-link-target");
        private_bytes(&target, &bytes);
        let destination = if mode.starts_with("journal") {
            fs::remove_file(&path).unwrap();
            &path
        } else {
            &archive
        };
        if mode.ends_with("soft") {
            std::os::unix::fs::symlink(&target, destination).unwrap();
        } else if mode.ends_with("hard") {
            fs::hard_link(&target, destination).unwrap();
        } else if mode.ends_with("collision") {
            private_bytes(destination, b"preserve-collision");
        } else {
            private_bytes(destination, &bytes);
            fs::set_permissions(destination, fs::Permissions::from_mode(0o644)).unwrap();
        }
        let config = fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap();
        let writes = *vault.writes.lock().unwrap();
        assert_eq!(
            s.mcp_configuration_with(&vault).unwrap_err().code,
            "MCP_SAVE_UNCERTAIN",
            "{mode}"
        );
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(
            fs::read(s.root().unwrap().join("mcp/servers.json")).unwrap(),
            config
        );
        assert_eq!(*vault.writes.lock().unwrap(), writes);
        if mode.ends_with("collision") {
            assert_eq!(fs::read(&archive).unwrap(), b"preserve-collision");
        }
    }
}
#[test]
fn mcp_security_directory_permission_change_is_not_repaired_and_plaintext_is_rejected() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let mut input = secret_input(&s, None, OP1, SECRET);
    input.edit.server.args.push(SECRET.into());
    assert_eq!(
        s.save_mcp_secrets_with(input, &vault).unwrap_err().code,
        "MCP_PLAIN_CREDENTIAL"
    );
    assert_eq!(*vault.writes.lock().unwrap(), 0);
    for directory in [
        s.root().unwrap(),
        s.root().unwrap().join("mcp"),
        s.root().unwrap().join("backups"),
    ] {
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(s.mcp_configuration().unwrap_err().code, "MCP_PATH_CHANGED");
        assert_eq!(fs::metadata(&directory).unwrap().mode() & 0o7777, 0o755);
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    }
    assert!(s.mcp_configuration().is_ok());
}

#[test]
fn mcp_security_cold_reopen_missing_private_directory_preserves_moved_state() {
    for directory in ["mcp", "backups"] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let vault = MemoryCredentials::default();
        let (_, journal) = pending(&mut s, &vault);
        let root = s.root().unwrap();
        drop(s);
        let original = root.join(directory);
        let moved = f.0.join(format!("retained-{directory}"));
        fs::rename(&original, &moved).unwrap();
        let opened = AppStore::open(f.0.join("app"));
        assert!(
            opened.is_err(),
            "ready root must reject missing {directory}, not recreate it"
        );
        assert_eq!(opened.err().unwrap().code, "MCP_PATH_CHANGED");
        assert!(!original.exists());
        let retained = if directory == "mcp" {
            moved.join("credentials-journal.json")
        } else {
            root.join("mcp/credentials-journal.json")
        };
        assert_eq!(fs::read(retained).unwrap(), journal);
    }
}

#[test]
fn mcp_security_archive_sync_failure_keeps_journal_and_retries_existing_archive_durably() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let (path, bytes) = pending(&mut s, &vault);
    let writes = *vault.writes.lock().unwrap();
    // An archive may already exist after rename succeeded but directory sync failed.
    let archive = s
        .root()
        .unwrap()
        .join(format!("backups/mcp-credentials-{OP1}.json"));
    private_bytes(&archive, &bytes);
    s.mcp_security_fault = Some(McpSecurityFault::ArchiveSync);
    assert_eq!(
        s.mcp_configuration_with(&vault).unwrap_err().code,
        "MCP_SAVE_UNCERTAIN"
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::read(&archive).unwrap(), bytes);
    s.mcp_security_fault = None;
    assert_eq!(s.mcp_configuration_with(&vault).unwrap().servers.len(), 1);
    assert!(!path.exists());
    assert_eq!(fs::read(&archive).unwrap(), bytes);
    assert_eq!(*vault.writes.lock().unwrap(), writes);
}

#[test]
fn mcp_security_complete_input_512k_exact_and_plus_one_independent_of_target_budget() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let vault = MemoryCredentials::default();
    let mut ordinary = draft();
    ordinary.env.clear();
    s.save_mcp_server(McpServerInput {
        id: None,
        expected_revision: String::new(),
        server: ordinary,
    })
    .unwrap();
    let path = s.root().unwrap().join("mcp/servers.json");
    let before = fs::read(&path).unwrap();
    let mut input = secret_input(&s, None, OP1, SECRET);
    input.edit.server.env = (0..64)
        .map(|n| McpEnvironment {
            name: format!("V{n}"),
            source: "keychain".into(),
            value: String::new(),
        })
        .collect();
    input.values = (0..64)
        .map(|n| (format!("V{n}"), "q".repeat(4096)))
        .collect();
    // JSON escape expansion changes the encoded input size without increasing
    // raw value bytes or the target config, which contains only small references.
    let mut needed = 512 * 1024 - serde_json::to_vec(&input).unwrap().len();
    for value in input.values.values_mut() {
        let mut bytes = value.as_bytes().to_vec();
        for byte in &mut bytes {
            if needed >= 5 {
                *byte = 1;
                needed -= 5;
            } else if needed > 0 {
                *byte = b'\n';
                needed -= 1;
            }
        }
        *value = String::from_utf8(bytes).unwrap();
    }
    assert_eq!(needed, 0);
    assert_eq!(serde_json::to_vec(&input).unwrap().len(), 512 * 1024);
    let mut over: McpSecretInput =
        serde_json::from_slice(&serde_json::to_vec(&input).unwrap()).unwrap();
    let value = over.values.values_mut().find(|v| v.contains('q')).unwrap();
    let at = value.find('q').unwrap();
    value.replace_range(at..at + 1, "\n");
    assert_eq!(serde_json::to_vec(&over).unwrap().len(), 512 * 1024 + 1);
    assert_eq!(
        s.save_mcp_secrets_with(over, &vault).unwrap_err().code,
        "MCP_LIMIT"
    );
    assert_eq!(*vault.writes.lock().unwrap(), 0);
    assert_eq!(*vault.reads.lock().unwrap(), 0);
    assert_eq!(fs::read(&path).unwrap(), before);
    assert!(!s
        .root()
        .unwrap()
        .join("mcp/credentials-journal.json")
        .exists());
    let result = s.save_mcp_secrets_with(input, &vault).unwrap();
    assert_eq!(result.configuration.servers.len(), 2);
    assert!(fs::read(&path).unwrap().len() < 256 * 1024);
    assert_eq!(vault.values.lock().unwrap().len(), 64);
}
