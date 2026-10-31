use super::mcp_schema::McpMigrationFault;
use super::*;
use crate::local_store::tests::{input, Fixture};
use crate::runtime_host::{Job, JobKind, RuntimeState};
use crate::store_commands::LocalState;
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU32},
    Arc, Mutex,
};

fn fixture() -> (Fixture, LocalState, RuntimeState) {
    let f = Fixture::new();
    let local = LocalState::new(f.0.join("app"));
    local
        .access(|s| {
            s.initialize(Some(f.0.join("workspace")), "UTC")?;
            Ok(())
        })
        .unwrap();
    (f, local, RuntimeState::default())
}
fn confirmed(local: &LocalState) -> McpUpgradeInput {
    let status = local.access(|s| s.mcp_storage_status()).unwrap();
    McpUpgradeInput {
        confirmed: true,
        confirmation_token: status.confirmation_token.unwrap(),
    }
}
fn backups(f: &Fixture) -> Vec<PathBuf> {
    fs::read_dir(f.0.join("workspace/backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect()
}
fn fake_job(kind: JobKind) -> Job {
    Job {
        run_id: "synthetic-upgrade-busy".into(),
        kind,
        nonce: "synthetic".into(),
        server_id: None,
        mcp_owner: Arc::new(Mutex::new(None)),
        mcp_intent: Arc::new(Mutex::new(None)),
        mcp_trial: Default::default(),
        cancel: Arc::new(AtomicBool::new(true)),
        pid: Arc::new(AtomicU32::new(0)),
        workers: Arc::new(Mutex::new(BTreeMap::new())),
    }
}
#[test]
fn mcp_upgrade_status_does_not_upgrade_and_requires_explicit_bound_confirmation() {
    let (f, local, runtime) = fixture();
    let first = local.access(|s| s.mcp_storage_status()).unwrap();
    assert_eq!(first.version, 3);
    assert_eq!(first.target_version, 4);
    assert!(first.confirmation_token.is_some());
    assert!(backups(&f).is_empty());
    let mut input = confirmed(&local);
    input.confirmed = false;
    assert_eq!(
        runtime.confirm_mcp_storage(&local, input).unwrap_err().code,
        "MCP_UPGRADE_CONFIRMATION"
    );
    let mut input = confirmed(&local);
    input.confirmation_token = "f".repeat(64);
    assert_eq!(
        runtime.confirm_mcp_storage(&local, input).unwrap_err().code,
        "MCP_UPGRADE_STALE"
    );
    assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 3);
    assert!(backups(&f).is_empty());
    assert!(serde_json::from_value::<McpUpgradeInput>(
        json!({"confirmed":true,"confirmationToken":"a".repeat(64),"root":"/not-allowed"})
    )
    .is_err());
}
#[test]
fn mcp_upgrade_confirmed_entry_preserves_data_backs_up_once_and_cold_reopens_ready() {
    let (f, local, runtime) = fixture();
    local
        .access(|s| s.create(input(), "upgrade-retained"))
        .unwrap();
    let request = confirmed(&local);
    let stale = confirmed(&local);
    let result = runtime.confirm_mcp_storage(&local, request).unwrap();
    assert_eq!((result.from_version, result.to_version), (3, 4));
    let backup = result.backup.unwrap();
    assert!(backup.starts_with("backups/before-schema-4-"));
    let db = Connection::open_with_flags(
        f.0.join("workspace").join(backup),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM todos", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(db);
    assert_eq!(
        runtime.confirm_mcp_storage(&local, stale).unwrap_err().code,
        "MCP_UPGRADE_STALE"
    );
    assert_eq!(backups(&f).len(), 1);
    local.access(|s| {assert_eq!(s.list()?.len(),1);let saved=s.save_mcp_server(McpServerInput{id:None,expected_revision:String::new(),server:serde_json::from_value(json!({"name":"synthetic","transport":"stdio","enabled":true,"command":"/synthetic/never-started","args":[],"cwd":null,"env":[],"connectTimeoutMs":10000,"toolTimeoutMs":30000})).unwrap()})?;let run=s.begin_mcp_probe(&saved.server_id.unwrap(),&saved.configuration.revision)?;assert_eq!(run.purpose,"mcp_probe");Ok(())}).unwrap();
    drop(local);
    let local = LocalState::new(f.0.join("app"));
    let status = local.access(|s| s.mcp_storage_status()).unwrap();
    assert_eq!(status.version, 4);
    assert!(status.confirmation_token.is_none());
    assert_eq!(backups(&f).len(), 1);
}
#[test]
fn mcp_upgrade_foreign_root_and_changed_schema_tokens_fail_before_backup() {
    let (f, local, runtime) = fixture();
    let (_other, other, _) = fixture();
    assert_eq!(
        runtime
            .confirm_mcp_storage(&local, confirmed(&other))
            .unwrap_err()
            .code,
        "MCP_UPGRADE_STALE"
    );
    let before = confirmed(&local);
    local
        .access(|s| {
            s.db()?
                .execute_batch("CREATE TABLE synthetic_extension(id INTEGER);")
                .map_err(db_error)?;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        runtime
            .confirm_mcp_storage(&local, before)
            .unwrap_err()
            .code,
        "MCP_UPGRADE_STALE"
    );
    assert!(backups(&f).is_empty());
    assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 3);
}
#[test]
fn mcp_upgrade_busy_business_trial_probe_and_cleanup_slots_never_start_backup() {
    let (f, local, runtime) = fixture();
    for kind in [JobKind::Business, JobKind::Trial, JobKind::Probe] {
        *runtime.slot.lock().unwrap() = Some(fake_job(kind));
        assert_eq!(
            runtime
                .confirm_mcp_storage(&local, confirmed(&local))
                .unwrap_err()
                .code,
            "RUNTIME_BUSY"
        );
        assert!(backups(&f).is_empty());
    }
    *runtime.slot.lock().unwrap() = None;
    assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 3);
}
#[test]
fn mcp_upgrade_concurrent_confirmation_produces_one_upgrade_and_backup() {
    let (f, local, runtime) = fixture();
    let a = confirmed(&local);
    let b = confirmed(&local);
    let left = local.clone();
    let state = runtime.clone();
    let thread = std::thread::spawn(move || state.confirm_mcp_storage(&left, a));
    let right = runtime.confirm_mcp_storage(&local, b);
    let left = thread.join().unwrap();
    assert_eq!(usize::from(left.is_ok()) + usize::from(right.is_ok()), 1);
    assert_eq!(
        left.err().or_else(|| right.err()).unwrap().code,
        "MCP_UPGRADE_STALE"
    );
    assert_eq!(backups(&f).len(), 1);
    assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 4);
}
#[test]
fn mcp_upgrade_backup_failures_allow_recheck_but_ddl_and_copy_unknown_require_reopen() {
    for fault in [
        McpMigrationFault::BackupCopy,
        McpMigrationFault::BackupSync,
        McpMigrationFault::Ddl,
        McpMigrationFault::Copy,
    ] {
        let (f, local, runtime) = fixture();
        let request = confirmed(&local);
        local
            .access(|s| {
                s.mcp_migration_fault = Some(fault);
                Ok(())
            })
            .unwrap();
        let error = runtime.confirm_mcp_storage(&local, request).unwrap_err();
        let unknown = matches!(fault, McpMigrationFault::Ddl | McpMigrationFault::Copy);
        assert_eq!(
            error.code,
            if unknown {
                "MCP_MIGRATION_UNCERTAIN"
            } else {
                "MCP_BACKUP_FAILED"
            }
        );
        if unknown {
            assert_eq!(
                local.access(|s| s.mcp_storage_status()).unwrap_err().code,
                "MCP_MIGRATION_UNCERTAIN"
            );
        } else {
            assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 3);
        }
        assert!(!backups(&f).is_empty());
        drop(local);
        let local = LocalState::new(f.0.join("app"));
        assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 3);
        runtime
            .confirm_mcp_storage(&local, confirmed(&local))
            .unwrap();
        assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 4);
    }
}
#[test]
fn mcp_upgrade_commit_unknown_blocks_mcp_until_cold_schema_validation() {
    let (f, local, runtime) = fixture();
    let request = confirmed(&local);
    let repeat = confirmed(&local);
    local
        .access(|s| {
            s.mcp_migration_fault = Some(McpMigrationFault::AfterCommit);
            Ok(())
        })
        .unwrap();
    assert_eq!(
        runtime
            .confirm_mcp_storage(&local, request)
            .unwrap_err()
            .code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    assert_eq!(
        local.access(|s| s.mcp_configuration()).unwrap_err().code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    assert_eq!(
        runtime
            .confirm_mcp_storage(&local, repeat)
            .unwrap_err()
            .code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    assert_eq!(backups(&f).len(), 1);
    drop(local);
    let local = LocalState::new(f.0.join("app"));
    assert_eq!(local.access(|s| s.mcp_storage_status()).unwrap().version, 4);
    assert_eq!(backups(&f).len(), 1);
    assert!(runtime.active_run().is_none());
}
#[test]
fn mcp_upgrade_replaced_database_is_rejected_without_repair_or_backup() {
    let (f, local, runtime) = fixture();
    let request = confirmed(&local);
    let db = f.0.join("workspace/data/sidekick.sqlite");
    let retained = f.0.join("retained.sqlite");
    fs::rename(&db, &retained).unwrap();
    fs::copy(&retained, &db).unwrap();
    let original = fs::read(&db).unwrap();
    assert_eq!(
        runtime
            .confirm_mcp_storage(&local, request)
            .unwrap_err()
            .code,
        "MCP_DATABASE_CHANGED"
    );
    assert_eq!(fs::read(&db).unwrap(), original);
    assert!(backups(&f).is_empty());
}
