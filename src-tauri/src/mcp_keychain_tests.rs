use super::super::mcp_security::*;
use super::super::*;
use super::*;
use crate::local_store::tests::Fixture;
use keyring_core::Error as PlatformError;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;

const SECRET: &str = "synthetic-keychain-adapter-value";
const NEXT: &str = "synthetic-keychain-adapter-replacement";
const OP1: &str = "op-00000000-0000-4000-8000-000000000041";
const OP2: &str = "op-00000000-0000-4000-8000-000000000042";

#[derive(Clone, Copy, PartialEq, Default)]
enum Fault {
    #[default]
    None,
    WriteBefore,
    WriteAfter,
    SecondWriteAfter,
    WrongReadBack,
    DeniedReadBack,
}
#[derive(Default)]
struct FakePort {
    values: RefCell<BTreeMap<(String, String), String>>,
    calls: RefCell<Vec<(&'static str, String, String)>>,
    writes: Cell<usize>,
    fault: Cell<Fault>,
    read_error: Cell<Option<fn() -> PlatformError>>,
}
fn denied() -> PlatformError {
    PlatformError::NoStorageAccess(Box::new(std::io::Error::other(SECRET)))
}
impl KeychainPort for FakePort {
    fn read(&self, service: &str, account: &str) -> keyring_core::Result<String> {
        self.calls
            .borrow_mut()
            .push(("read", service.into(), account.into()));
        if let Some(error) = self.read_error.get() {
            return Err(error());
        }
        let value = self
            .values
            .borrow()
            .get(&(service.into(), account.into()))
            .cloned();
        match value {
            None => Err(PlatformError::NoEntry),
            Some(_) if self.fault.get() == Fault::DeniedReadBack => Err(denied()),
            Some(_) if self.fault.get() == Fault::WrongReadBack => {
                Ok("synthetic-wrong-readback".into())
            }
            Some(value) => Ok(value),
        }
    }
    fn write(&self, service: &str, account: &str, value: &str) -> keyring_core::Result<()> {
        self.calls
            .borrow_mut()
            .push(("write", service.into(), account.into()));
        self.writes.set(self.writes.get() + 1);
        if self.fault.get() == Fault::WriteBefore {
            return Err(denied());
        }
        self.values
            .borrow_mut()
            .insert((service.into(), account.into()), value.into());
        if self.fault.get() == Fault::WriteAfter
            || self.fault.get() == Fault::SecondWriteAfter && self.writes.get() == 2
        {
            return Err(denied());
        }
        Ok(())
    }
}
fn adapter() -> McpKeychain<FakePort> {
    McpKeychain {
        enabled: true,
        port: FakePort::default(),
    }
}
fn address() -> (String, String) {
    let scope = "a".repeat(64);
    let reference = format!(
        "mcp1:{scope}:mcp-synthetic:{}:{}",
        "b".repeat(64),
        "c".repeat(64)
    );
    (scope, reference)
}
fn draft() -> McpServerDraft {
    serde_json::from_value(json!({"name":"适配器合成服务","transport":"stdio","enabled":true,"command":"/synthetic/not-executed","args":[],"cwd":null,"env":[{"name":"TOKEN","source":"keychain","value":""}],"connectTimeoutMs":10000,"toolTimeoutMs":30000})).unwrap()
}
fn input(s: &AppStore, id: Option<String>, op: &str, value: &str) -> McpSecretInput {
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
fn initialized() -> (Fixture, AppStore) {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    (f, s)
}
struct EmptyEnvironment;
impl McpEnvironmentSource for EmptyEnvironment {
    fn get(&self, _: &str) -> Option<String> {
        None
    }
}
fn assert_private_files(s: &AppStore) {
    let root = s.root().unwrap();
    for directory in [root.join("mcp"), root.join("backups")] {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                let bytes = fs::read(path).unwrap();
                assert!(!bytes.windows(SECRET.len()).any(|w| w == SECRET.as_bytes()));
                assert!(!bytes.windows(NEXT.len()).any(|w| w == NEXT.as_bytes()));
            }
        }
    }
}
#[test]
fn mcp_keychain_default_factory_and_all_store_entrypoints_remain_closed() {
    let (f, s) = initialized();
    let a = adapter();
    let saved = s
        .save_mcp_secrets_with(input(&s, None, OP1, SECRET), &a)
        .unwrap();
    let id = saved.server_id.unwrap();
    let native = production_credentials();
    let (scope, reference) = address();
    assert!(!native.available());
    assert!(matches!(
        native.get(&scope, &reference),
        Err(McpCredentialFailure::Unavailable)
    ));
    assert!(matches!(
        native.put(&scope, &reference, SECRET),
        Err(McpCredentialFailure::Unavailable)
    ));
    let closed = McpKeychain {
        enabled: false,
        port: FakePort::default(),
    };
    assert!(!closed.available());
    assert!(closed.get(&scope, &reference).is_err());
    assert!(closed.put(&scope, &reference, SECRET).is_err());
    assert!(closed.port.calls.borrow().is_empty());
    assert!(!s.mcp_configuration().unwrap().secure_storage_available);
    assert_eq!(
        s.mcp_configuration().unwrap().credential_status[&id]["TOKEN"],
        "unavailable"
    );
    assert_eq!(
        s.prepare_mcp_environment(&id, &saved.configuration.revision)
            .err()
            .unwrap()
            .code,
        "MCP_CREDENTIAL_UNAVAILABLE"
    );
    assert_eq!(
        s.prepare_probe_environment(&id, &saved.configuration.revision)
            .err()
            .unwrap()
            .code,
        "MCP_CREDENTIAL_UNAVAILABLE"
    );
    assert_eq!(
        s.save_mcp_secrets(input(&s, Some(id.clone()), OP2, NEXT))
            .unwrap_err()
            .code,
        "MCP_CREDENTIAL_UNAVAILABLE"
    );
    let ordinary = s
        .save_mcp_server(McpServerInput {
            id: Some(id),
            expected_revision: saved.configuration.revision,
            server: draft(),
        })
        .unwrap();
    assert!(!ordinary.configuration.secure_storage_available);
    drop(s);
    assert!(
        !f.store()
            .mcp_configuration()
            .unwrap()
            .secure_storage_available
    );
}
#[test]
fn mcp_keychain_exact_namespace_account_and_read_write_sequence() {
    let a = adapter();
    let (scope, reference) = address();
    assert!(a.available());
    assert!(matches!(
        a.get(&scope, &reference),
        Err(McpCredentialFailure::Missing)
    ));
    assert!(a.put(&scope, &reference, SECRET).is_ok());
    assert!(a.get(&scope, &reference).ok().unwrap() == SECRET);
    let calls = a.port.calls.borrow();
    assert_eq!(
        calls.iter().map(|c| c.0).collect::<Vec<_>>(),
        ["read", "read", "write", "read"]
    );
    assert!(calls
        .iter()
        .all(|c| c.1 == format!("com.sidekick.mcp.credentials.v1.{scope}") && c.2 == reference));
}
#[test]
fn mcp_keychain_invalid_or_foreign_addresses_never_reach_port() {
    let a = adapter();
    let (scope, reference) = address();
    let cases = [
        (String::new(), reference.clone()),
        ("a".repeat(63), reference.clone()),
        ("z".repeat(64), reference.clone()),
        (scope.clone(), reference.replace("mcp1:", "model:")),
        (scope.clone(), reference.replace(&scope, &"d".repeat(64))),
        (scope.clone(), reference.replace("mcp-synthetic", "other")),
        (scope.clone(), reference.replace("mcp-synthetic", "mcp-坏")),
        (
            scope.clone(),
            reference.replace("mcp-synthetic", &format!("mcp-{}", "a".repeat(64))),
        ),
        (scope.clone(), reference.replace(&"b".repeat(64), "short")),
        (
            scope.clone(),
            reference.replace(&"c".repeat(64), &"g".repeat(64)),
        ),
        (scope.clone(), format!("{reference}:extra")),
        (scope.clone(), "mcp1:".repeat(103)),
    ];
    for (scope, reference) in cases {
        assert!(matches!(
            a.get(&scope, &reference),
            Err(McpCredentialFailure::Unavailable)
        ));
        assert!(matches!(
            a.put(&scope, &reference, SECRET),
            Err(McpCredentialFailure::Unavailable)
        ));
    }
    assert!(a.port.calls.borrow().is_empty());
}
#[test]
fn mcp_keychain_value_byte_limits_and_invalid_reads_are_finite() {
    let a = adapter();
    let (scope, reference) = address();
    for value in [
        String::new(),
        "x\0y".into(),
        "x".repeat(4097),
        "中".repeat(1366),
    ] {
        assert!(a.put(&scope, &reference, &value).is_err());
    }
    assert!(a.port.calls.borrow().is_empty());
    let limit = "中".repeat(1365) + "x";
    assert_eq!(limit.len(), 4096);
    assert!(a.put(&scope, &reference, &limit).is_ok());
    assert!(a.get(&scope, &reference).ok().unwrap() == limit);
    let key = (
        format!("com.sidekick.mcp.credentials.v1.{scope}"),
        reference.clone(),
    );
    for value in ["x\0y".to_string(), "x".repeat(4097)] {
        a.port.values.borrow_mut().insert(key.clone(), value);
        assert!(matches!(
            a.get(&scope, &reference),
            Err(McpCredentialFailure::Unavailable)
        ));
    }
    a.port.values.borrow_mut().insert(key, String::new());
    assert!(matches!(
        a.get(&scope, &reference),
        Err(McpCredentialFailure::Missing)
    ));
}
#[test]
fn mcp_keychain_platform_errors_do_not_escape_or_allow_writes() {
    let a = adapter();
    let (scope, reference) = address();
    let errors: [fn() -> PlatformError; 7] = [
        denied,
        || PlatformError::PlatformFailure(Box::new(std::io::Error::other(SECRET))),
        || PlatformError::BadEncoding(SECRET.as_bytes().to_vec()),
        || {
            PlatformError::BadDataFormat(
                SECRET.as_bytes().to_vec(),
                Box::new(std::io::Error::other(SECRET)),
            )
        },
        || PlatformError::BadStoreFormat(SECRET.into()),
        || PlatformError::Invalid(SECRET.into(), SECRET.into()),
        || PlatformError::NoDefaultStore,
    ];
    for error in errors {
        a.port.read_error.set(Some(error));
        assert!(matches!(
            a.get(&scope, &reference),
            Err(McpCredentialFailure::Unavailable)
        ));
        assert!(matches!(
            a.put(&scope, &reference, SECRET),
            Err(McpCredentialFailure::Unavailable)
        ));
    }
    assert_eq!(a.port.writes.get(), 0);
}
#[test]
fn mcp_keychain_existing_entries_even_empty_are_never_overwritten() {
    let a = adapter();
    let (scope, reference) = address();
    let key = (
        format!("com.sidekick.mcp.credentials.v1.{scope}"),
        reference.clone(),
    );
    for value in [String::new(), SECRET.to_string()] {
        a.port
            .values
            .borrow_mut()
            .insert(key.clone(), value.clone());
        assert!(a.put(&scope, &reference, NEXT).is_err());
        assert!(a.port.values.borrow()[&key] == value);
    }
    assert_eq!(a.port.writes.get(), 0);
}
#[test]
fn mcp_keychain_store_save_replace_reopen_redacts_and_preserves_old_refs() {
    let (f, s) = initialized();
    let a = adapter();
    let saved = s
        .save_mcp_secrets_with(input(&s, None, OP1, SECRET), &a)
        .unwrap();
    let id = saved.server_id.unwrap();
    assert_eq!(
        saved.configuration.credential_status[&id]["TOKEN"],
        "stored"
    );
    let old = a.port.values.borrow().clone();
    let replaced = s
        .save_mcp_secrets_with(input(&s, Some(id.clone()), OP2, NEXT), &a)
        .unwrap();
    assert_eq!(a.port.values.borrow().len(), 2);
    assert!(old
        .iter()
        .all(|(k, v)| a.port.values.borrow().get(k) == Some(v)));
    let public = serde_json::to_string(&replaced).unwrap();
    assert!(!public.contains(SECRET) && !public.contains(NEXT) && !public.contains("mcp1:"));
    assert_private_files(&s);
    assert!(
        s.prepare_mcp_environment_with(
            &id,
            &replaced.configuration.revision,
            &a,
            &EmptyEnvironment
        )
        .unwrap()
        .into_values()["TOKEN"]
            == NEXT
    );
    let writes = a.port.writes.get();
    drop(s);
    let s = f.store();
    let view = s.mcp_configuration_with(&a).unwrap();
    assert_eq!(view.credential_status[&id]["TOKEN"], "stored");
    assert_eq!(view.revision, replaced.configuration.revision);
    assert_eq!(a.port.writes.get(), writes);
}
#[test]
fn mcp_keychain_store_foreign_service_field_model_and_root_fail_before_port() {
    let (_f, s) = initialized();
    let a = adapter();
    s.save_mcp_secrets_with(input(&s, None, OP1, SECRET), &a)
        .unwrap();
    let path = s.root().unwrap().join("mcp/servers.json");
    let raw = fs::read(&path).unwrap();
    let original: serde_json::Value = serde_json::from_slice(&raw).unwrap();
    let count = a.port.calls.borrow().len();
    for kind in ["service", "field", "model"] {
        let mut document = original.clone();
        match kind {
            "service" => document["servers"][0]["id"] = json!("mcp-other"),
            "field" => document["servers"][0]["env"][0]["name"] = json!("OTHER"),
            _ => document["servers"][0]["env"][0]["value"] = json!("credential-model-ref"),
        }
        fs::write(&path, serde_json::to_vec(&document).unwrap()).unwrap();
        assert_eq!(
            s.mcp_configuration_with(&a).unwrap_err().code,
            "MCP_CREDENTIAL_SCOPE"
        );
    }
    fs::write(&path, &raw).unwrap();
    let (_other, second) = initialized();
    let other_path = second.root().unwrap().join("mcp/servers.json");
    fs::write(&other_path, &raw).unwrap();
    fs::set_permissions(&other_path, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(
        second.mcp_configuration_with(&a).unwrap_err().code,
        "MCP_CREDENTIAL_SCOPE"
    );
    assert_eq!(a.port.calls.borrow().len(), count);
}
#[test]
fn mcp_keychain_store_partial_and_uncertain_writes_preserve_base_without_compensating_delete() {
    for (fault, orphan_count) in [
        (Fault::WriteBefore, 0),
        (Fault::WriteAfter, 1),
        (Fault::WrongReadBack, 1),
        (Fault::DeniedReadBack, 1),
        (Fault::SecondWriteAfter, 2),
    ] {
        let (f, s) = initialized();
        let a = adapter();
        let saved = s
            .save_mcp_secrets_with(input(&s, None, OP1, SECRET), &a)
            .unwrap();
        let id = saved.server_id.unwrap();
        let path = s.root().unwrap().join("mcp/servers.json");
        let original = fs::read(&path).unwrap();
        let old_values = a.port.values.borrow().clone();
        a.port.writes.set(0);
        a.port.fault.set(fault);
        let mut replacement = input(&s, Some(id.clone()), OP2, NEXT);
        replacement.edit.server.env.push(McpEnvironment {
            name: "ALPHA".into(),
            source: "keychain".into(),
            value: String::new(),
        });
        replacement.values.insert("ALPHA".into(), NEXT.into());
        let error = s.save_mcp_secrets_with(replacement, &a).unwrap_err();
        assert_eq!(error.code, "MCP_CREDENTIAL_UNAVAILABLE");
        assert!(
            !error.message.contains(SECRET)
                && !error.message.contains(NEXT)
                && !error.message.contains("未访问钥匙串")
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(a.port.values.borrow().len(), 1 + orphan_count);
        assert!(old_values
            .iter()
            .all(|(k, v)| a.port.values.borrow().get(k) == Some(v)));
        assert_private_files(&s);
        let writes = a.port.writes.get();
        a.port.fault.set(Fault::None);
        drop(s);
        let s = f.store();
        assert_eq!(
            s.mcp_configuration_with(&a).unwrap().revision,
            saved.configuration.revision
        );
        assert_eq!(
            s.save_mcp_secrets_with(input(&s, Some(id), OP2, NEXT), &a)
                .unwrap_err()
                .code,
            "MCP_OPERATION_REPLAY"
        );
        assert_eq!(a.port.writes.get(), writes);
    }
}
#[test]
fn mcp_keychain_store_unknown_after_publish_rereads_without_replaying() {
    let (f, mut s) = initialized();
    let a = adapter();
    let saved = s
        .save_mcp_secrets_with(input(&s, None, OP1, SECRET), &a)
        .unwrap();
    let id = saved.server_id.unwrap();
    let replacement = input(&s, Some(id.clone()), OP2, NEXT);
    s.mcp_security_fault = Some(McpSecurityFault::ReadBack);
    assert_eq!(
        s.save_mcp_secrets_with(replacement, &a).unwrap_err().code,
        "MCP_SAVE_UNCERTAIN"
    );
    assert!(s
        .root()
        .unwrap()
        .join("mcp/credentials-journal.json")
        .exists());
    assert_private_files(&s);
    let writes = a.port.writes.get();
    drop(s);
    let s = f.store();
    let view = s.mcp_configuration_with(&a).unwrap();
    assert_eq!(view.servers[0].last_secret_operation.as_deref(), Some(OP2));
    assert_eq!(view.credential_status[&id]["TOKEN"], "stored");
    assert!(!s
        .root()
        .unwrap()
        .join("mcp/credentials-journal.json")
        .exists());
    assert_eq!(a.port.writes.get(), writes);
    assert_eq!(
        s.save_mcp_secrets_with(input(&s, Some(id), OP2, NEXT), &a)
            .unwrap_err()
            .code,
        "MCP_OPERATION_REPLAY"
    );
    assert_eq!(a.port.writes.get(), writes);
}
#[test]
fn mcp_keychain_store_journal_fault_boundaries_preserve_old_values_and_never_replay() {
    for fault in [
        McpSecurityFault::AfterJournal,
        McpSecurityFault::AfterFirstCredential,
        McpSecurityFault::BeforePublish,
        McpSecurityFault::AfterPublish,
    ] {
        let (f, mut s) = initialized();
        let a = adapter();
        let saved = s
            .save_mcp_secrets_with(input(&s, None, OP1, SECRET), &a)
            .unwrap();
        let old_values = a.port.values.borrow().clone();
        let replacement = input(&s, saved.server_id, OP2, NEXT);
        s.mcp_security_fault = Some(fault);
        let result = s.save_mcp_secrets_with(replacement, &a);
        assert_eq!(result.is_ok(), fault == McpSecurityFault::AfterPublish);
        assert_private_files(&s);
        let writes = a.port.writes.get();
        drop(s);
        let s = f.store();
        let view = s.mcp_configuration_with(&a).unwrap();
        assert_eq!(
            view.servers[0].last_secret_operation.as_deref(),
            Some(if fault == McpSecurityFault::AfterPublish {
                OP2
            } else {
                OP1
            })
        );
        assert_eq!(a.port.writes.get(), writes);
        assert!(old_values
            .iter()
            .all(|(k, v)| a.port.values.borrow().get(k) == Some(v)));
    }
}
