use apple_native_keyring_store::keychain::Store;
use keyring_core::api::CredentialStoreApi;
use rusqlite::{Connection, MAIN_DB};
use rusqlite_migration::{Migrations, M};
use serde_json::{json, Value};
use std::fs::{self, File};
use std::path::Path;

pub fn sqlite_probe(root: &Path) -> Result<Value, String> {
    fs::create_dir_all(root).map_err(|_| "probe directory creation failed")?;
    let mut db =
        Connection::open(root.join("probe.sqlite")).map_err(|_| "probe database open failed")?;
    db.pragma_update(None, "journal_mode", "WAL")
        .map_err(|_| "WAL setup failed")?;
    db.pragma_update(None, "wal_autocheckpoint", 0)
        .map_err(|_| "WAL checkpoint setup failed")?;
    let migrations = Migrations::new(vec![
        M::up("CREATE TABLE probe_items(id TEXT PRIMARY KEY, status TEXT NOT NULL);"),
        M::up("ALTER TABLE probe_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;"),
    ]);
    migrations
        .to_latest(&mut db)
        .map_err(|_| "migration failed")?;
    migrations
        .to_latest(&mut db)
        .map_err(|_| "repeated migration failed")?;
    db.execute("INSERT INTO probe_items VALUES('fixture','pending',1)", [])
        .map_err(|_| "fixture insert failed")?;
    {
        let tx = db
            .transaction()
            .map_err(|_| "transaction creation failed")?;
        tx.execute(
            "INSERT INTO probe_items VALUES('rolled-back','pending',1)",
            [],
        )
        .map_err(|_| "fixture transaction failed")?;
        if tx
            .execute("INSERT INTO missing_table VALUES(1)", [])
            .is_ok()
        {
            return Err("fault injection did not fail".into());
        }
    }
    let count: i64 = db
        .query_row("SELECT count(*) FROM probe_items", [], |r| r.get(0))
        .map_err(|_| "row count failed")?;
    if count != 1 {
        return Err("transaction rollback failed".into());
    }
    let faulty = Migrations::new(vec![
        M::up("CREATE TABLE probe_items(id TEXT PRIMARY KEY, status TEXT NOT NULL);"),
        M::up("ALTER TABLE probe_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;"),
        M::up("CREATE TABLE should_rollback(id INTEGER); INSERT INTO nonexistent VALUES(1);"),
    ]);
    if faulty.to_latest(&mut db).is_ok() {
        return Err("invalid migration unexpectedly succeeded".into());
    }
    let schema: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| "schema version read failed")?;
    let rolled_back: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='should_rollback'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "schema rollback query failed")?;
    if schema != 2 || rolled_back != 0 {
        return Err("schema rollback was incomplete".into());
    }
    if !root.join("probe.sqlite-wal").exists() {
        return Err("WAL fixture missing".into());
    }
    db.backup(MAIN_DB, root.join("snapshot.sqlite"), None)
        .map_err(|_| "online backup failed")?;
    let snapshot =
        Connection::open(root.join("snapshot.sqlite")).map_err(|_| "snapshot open failed")?;
    let integrity: String = snapshot
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "integrity check failed")?;
    let backup_count: i64 = snapshot
        .query_row("SELECT count(*) FROM probe_items", [], |r| r.get(0))
        .map_err(|_| "snapshot count failed")?;
    if integrity != "ok" || backup_count != 1 {
        return Err("backup lost committed WAL data".into());
    }
    let mut restored =
        Connection::open(root.join("restored.sqlite")).map_err(|_| "restore destination failed")?;
    restored
        .restore(
            MAIN_DB,
            root.join("snapshot.sqlite"),
            None::<fn(rusqlite::backup::Progress)>,
        )
        .map_err(|_| "restore failed")?;
    let restored_count: i64 = restored
        .query_row("SELECT count(*) FROM probe_items", [], |r| r.get(0))
        .map_err(|_| "restore count failed")?;
    if restored_count != 1 {
        return Err("restore data mismatch".into());
    }
    db.pragma_update(None, "user_version", 99)
        .map_err(|_| "future schema fixture failed")?;
    if migrations.to_latest(&mut db).is_ok() {
        return Err("future schema was accepted".into());
    }
    let lock = File::create(root.join("root.lock")).map_err(|_| "lock file failed")?;
    lock.try_lock().map_err(|_| "first lock failed")?;
    let second = File::open(root.join("root.lock")).map_err(|_| "second lock file failed")?;
    if second.try_lock().is_ok() {
        return Err("concurrent root lock was accepted".into());
    }
    let version: String = db
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .map_err(|_| "SQLite version failed")?;
    Ok(
        json!({"status":"passed","sqliteVersion":version,"migrationVersion":schema,"transactionRollback":true,"migrationRollback":true,"walBackupRows":backup_count,"restoredRows":restored_count,"futureSchemaRejected":true,"concurrentLockRejected":true}),
    )
}

pub fn keychain_probe() -> Result<Value, String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "clock unavailable")?
        .as_nanos();
    let store = Store::new().map_err(|_| "keychain backend unavailable")?;
    let service = format!("com.sidekick.s0.fixture.{nonce}");
    let entry = store
        .build(&service, "synthetic-probe", None)
        .map_err(|_| "keychain entry creation failed")?;
    if !matches!(entry.get_password(), Err(keyring_core::Error::NoEntry)) {
        return Err("keychain missing-entry classification failed".into());
    }
    entry
        .set_password("s0-synthetic-value")
        .map_err(|_| "keychain write failed")?;
    let verified = entry
        .get_password()
        .map(|s| s == "s0-synthetic-value")
        .unwrap_or(false);
    let cleanup = entry.delete_credential().is_ok();
    if !verified || !cleanup {
        return Err("keychain roundtrip or fixture cleanup failed".into());
    }
    if !matches!(entry.get_password(), Err(keyring_core::Error::NoEntry)) {
        return Err("keychain fixture still exists".into());
    }
    Ok(
        json!({"status":"passed","backend":"macOS login Keychain","syntheticOnly":true,"readback":true,"fixtureRemoved":true}),
    )
}

pub fn workspace_switch_probe(root: &Path) -> Result<Value, String> {
    let old = root.join("old");
    fs::create_dir_all(old.join("data")).map_err(|_| "workspace fixture failed")?;
    let source = Connection::open(old.join("data/sidekick.sqlite"))
        .map_err(|_| "workspace database failed")?;
    source.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE probe_items(id INTEGER PRIMARY KEY); INSERT INTO probe_items VALUES(1);").map_err(|_| "workspace seed failed")?;
    let pointer = root.join("bootstrap.json");
    fs::write(&pointer, old.to_string_lossy().as_bytes()).map_err(|_| "bootstrap seed failed")?;
    let failure = stage_switch(&source, &root.join("failed-target"), &pointer, true);
    if failure.is_ok()
        || fs::read_to_string(&pointer).map_err(|_| "bootstrap read failed")?
            != old.to_string_lossy()
    {
        return Err("failed migration changed the active root".into());
    }
    let target = root.join("new");
    stage_switch(&source, &target, &pointer, false)?;
    if fs::read_to_string(&pointer).map_err(|_| "new bootstrap read failed")?
        != target.to_string_lossy()
        || !old.join("data/sidekick.sqlite").exists()
    {
        return Err("successful migration lost root references".into());
    }
    if stage_switch(&source, &target, &pointer, false).is_ok() {
        return Err("existing root was implicitly merged".into());
    }
    Ok(
        json!({"status":"passed","failedSwitchRetainedOldRoot":true,"atomicPointerSwitch":true,"oldDataPreserved":true,"implicitMergeRejected":true,"scope":"filesystem and SQLite migration primitive; application task coordination remains G1"}),
    )
}

fn stage_switch(
    source: &Connection,
    target: &Path,
    pointer: &Path,
    fail_before_switch: bool,
) -> Result<(), String> {
    if target.exists() {
        return Err("target already exists".into());
    }
    fs::create_dir_all(target.join("data")).map_err(|_| "target creation failed")?;
    let database = target.join("data/sidekick.sqlite");
    source
        .backup(MAIN_DB, &database, None)
        .map_err(|_| "migration backup failed")?;
    let check = Connection::open(&database).map_err(|_| "migration verification open failed")?;
    let count: i64 = check
        .query_row("SELECT count(*) FROM probe_items", [], |r| r.get(0))
        .map_err(|_| "migration verification failed")?;
    if count != 1 {
        return Err("migration data mismatch".into());
    }
    drop(check);
    if fail_before_switch {
        return Err("controlled failure before pointer switch".into());
    }
    let pending = pointer.with_extension("pending");
    fs::write(&pending, target.to_string_lossy().as_bytes())
        .map_err(|_| "pending pointer write failed")?;
    File::open(&pending)
        .and_then(|f| f.sync_all())
        .map_err(|_| "pointer sync failed")?;
    fs::rename(pending, pointer).map_err(|_| "atomic pointer replacement failed")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_migration_wal_backup_restore_and_lock() {
        let root = std::env::temp_dir().join(format!("sidekick-sqlite-{}", std::process::id()));
        assert!(!root.exists());
        let result = sqlite_probe(&root);
        fs::remove_dir_all(root).expect("remove synthetic probe directory");
        assert_eq!(result.expect("storage probe must pass")["status"], "passed");
    }

    #[test]
    fn keychain_synthetic_roundtrip() {
        assert_eq!(
            keychain_probe().expect("synthetic keychain probe must pass")["status"],
            "passed"
        );
    }

    #[test]
    fn workspace_switch_preserves_source_on_failure_and_rejects_merge() {
        let root = std::env::temp_dir().join(format!("sidekick-switch-{}", std::process::id()));
        assert!(!root.exists());
        let result = workspace_switch_probe(&root);
        fs::remove_dir_all(root).expect("remove synthetic migration directory");
        assert_eq!(
            result.expect("workspace switch probe must pass")["status"],
            "passed"
        );
    }
}
