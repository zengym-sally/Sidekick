use super::web_backend_schema::{
    init_with_fault, open_with_fault, WebBackendMigrationFault, WebBackendSchema, SCHEMA_LINEAGE,
    SCHEMA_VERSION, WEB_BACKEND_APPLICATION_ID,
};
use super::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

const TASK_COLUMNS: &str = "task_id,operation_id,type,role,state,version,submit_seq,attempt_exit_state,result_pending_exit,pending_outcome,config_revision,original_config_revision,input_ref,cancel_intent,next_attempt_at,attempt_budget,result_ref,failure,created_at,updated_at,terminal_at";
const SQL_V1: &str = include_str!("../../migrations/web-backend/001_web_backend.sql");

fn temp_db(label: &str) -> (PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "sidekick-web-backend-{}-{}-{}",
        label,
        std::process::id(),
        nonce()
    ));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("web-backend.sqlite");
    (dir, path)
}

fn insert_task(conn: &Connection, task_id: &str, state: &str) {
    conn.execute(
        &format!(
            "INSERT INTO tasks ({TASK_COLUMNS}) VALUES(?1,?1,'organize','organizer',?2,1,1,'not_started',0,NULL,'cfg','cfg','{{}}',0,NULL,2,NULL,NULL,1,1,NULL)"
        ),
        rusqlite::params![task_id, state],
    )
    .unwrap();
}

fn table_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn index_names(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect()
}

#[test]
fn init_creates_exact_schema_and_is_idempotent() {
    let (dir, path) = temp_db("init");
    let schema = WebBackendSchema::init(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 13);
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT schema_lineage FROM schema_meta WHERE id=1",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        SCHEMA_LINEAGE
    );
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT schema_version FROM schema_meta WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        SCHEMA_VERSION
    );
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "application_id", |r| r.get::<_, i64>(0))
            .unwrap(),
        WEB_BACKEND_APPLICATION_ID
    );
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    assert!(index_names(schema.conn()).contains(&"task_attempts_current".to_string()));
    // The 002 migration adds the manual-item tables and their indexes.
    for table in ["manual_items", "manual_item_events"] {
        assert!(
            schema
                .conn()
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap()
                == 1
        );
    }
    assert!(index_names(schema.conn()).contains(&"manual_items_list_order".to_string()));
    drop(schema);

    // Idempotent: a second init validates and returns without duplicating.
    let again = WebBackendSchema::init(&path).unwrap();
    assert_eq!(table_count(again.conn()), 13);
    drop(again);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_rejects_missing_and_blank() {
    let (dir, path) = temp_db("missing");
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_MISSING_DATABASE"
    );
    fs::write(&path, b"").unwrap();
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_MISSING_DATABASE"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_rejects_unknown_lineage() {
    let (dir, path) = temp_db("unknown");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA application_id = 12345; CREATE TABLE other(x);")
        .unwrap();
    drop(conn);
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_UNKNOWN_DATABASE"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_rejects_version_mirror_mismatch() {
    let (dir, path) = temp_db("mirror");
    let schema = WebBackendSchema::init(&path).unwrap();
    schema
        .conn()
        .execute_batch("UPDATE schema_meta SET schema_version = 3 WHERE id = 1;")
        .unwrap();
    drop(schema);
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_SCHEMA_VERSION_MISMATCH"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_rejects_too_new() {
    let (dir, path) = temp_db("too-new");
    let schema = WebBackendSchema::init(&path).unwrap();
    schema
        .conn()
        .execute_batch(
            "UPDATE schema_meta SET schema_version = 3 WHERE id = 1; PRAGMA user_version = 3;",
        )
        .unwrap();
    drop(schema);
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_SCHEMA_TOO_NEW"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_rejects_corrupt_database() {
    let (dir, path) = temp_db("corrupt");
    fs::write(&path, b"this is not a sqlite database").unwrap();
    let err = WebBackendSchema::open(&path).unwrap_err();
    assert!(
        err.code == "WEB_BACKEND_CORRUPT_DATABASE" || err.code == "WEB_BACKEND_UNKNOWN_DATABASE"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn connection_settings_are_applied() {
    let (dir, path) = temp_db("settings");
    let schema = WebBackendSchema::init(&path).unwrap();
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "foreign_keys", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "journal_mode", |r| r.get::<_, String>(0))
            .unwrap()
            .to_lowercase(),
        "wal"
    );
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "synchronous", |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn consistency_backup_is_verified() {
    let (dir, path) = temp_db("backup");
    let schema = WebBackendSchema::init(&path).unwrap();
    insert_task(schema.conn(), "tsk_1", "queued");
    let destination = dir.join("backup-destination.sqlite");
    schema.consistency_backup(&destination).unwrap();
    let target = Connection::open(&destination).unwrap();
    assert_eq!(table_count(&target), 13);
    assert_eq!(
        target
            .pragma_query_value(None, "application_id", |r| r.get::<_, i64>(0))
            .unwrap(),
        WEB_BACKEND_APPLICATION_ID
    );
    assert_eq!(
        target
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    assert_eq!(
        target
            .query_row(
                "SELECT count(*) FROM tasks WHERE task_id='tsk_1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    drop(target);
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_failure_rolls_back_and_retry_succeeds() {
    let (dir, path) = temp_db("rollback");
    let failed = init_with_fault(&path, WebBackendMigrationFault::Ddl);
    assert_eq!(failed.unwrap_err().code, "WEB_BACKEND_MIGRATION_FAILED");
    let probe = Connection::open(&path).unwrap();
    // The fault is injected after the second migration. rusqlite_migration
    // applies every pending migration in one transaction, so a fresh init
    // rolls all the way back to a blank database.
    assert_eq!(table_count(&probe), 0);
    assert_eq!(
        probe
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    drop(probe);
    // The blank file is still initializable: the retry applies 001 + 002.
    let schema = WebBackendSchema::init(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 13);
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn forward_migration_failure_on_existing_v1_rolls_back_to_v1() {
    // Build a v1-only database first (001 applied, user_version 1, mirror 1).
    let (dir, path) = temp_db("forward-rollback");
    {
        let mut conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA application_id = 0x57424b31;")
            .unwrap();
        rusqlite_migration::Migrations::new(vec![rusqlite_migration::M::up(SQL_V1)])
            .to_latest(&mut conn)
            .unwrap();
    }
    let probe = Connection::open(&path).unwrap();
    assert_eq!(table_count(&probe), 11);
    assert_eq!(
        probe
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(probe);

    // Opening with the fault fails on 002 and leaves the database at v1.
    assert_eq!(
        open_with_fault(&path, WebBackendMigrationFault::Ddl)
            .unwrap_err()
            .code,
        "WEB_BACKEND_MIGRATION_FAILED"
    );
    let probe = Connection::open(&path).unwrap();
    assert_eq!(table_count(&probe), 11);
    assert_eq!(
        probe
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT schema_version FROM schema_meta WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='manual_items'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    drop(probe);

    // A normal open completes 002 without another fault.
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 13);
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_with_fault_rolls_back_pending_migration() {
    let (dir, path) = temp_db("rollback-open");
    fs::write(&path, b"").unwrap();
    assert_eq!(
        open_with_fault(&path, WebBackendMigrationFault::Ddl)
            .unwrap_err()
            .code,
        "WEB_BACKEND_MISSING_DATABASE"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn partial_unique_index_enforces_one_open_attempt() {
    let (dir, path) = temp_db("attempts");
    let schema = WebBackendSchema::init(&path).unwrap();
    insert_task(schema.conn(), "tsk_1", "queued");
    schema
        .conn()
        .execute(
            "INSERT INTO task_attempts(attempt_id,task_id,epoch,started_at) VALUES('att_1','tsk_1','inst_1',1)",
            [],
        )
        .unwrap();
    assert!(schema
        .conn()
        .execute(
            "INSERT INTO task_attempts(attempt_id,task_id,epoch,started_at) VALUES('att_2','tsk_1','inst_1',2)",
            [],
        )
        .is_err());
    schema
        .conn()
        .execute(
            "UPDATE task_attempts SET ended_at=3 WHERE attempt_id='att_1'",
            [],
        )
        .unwrap();
    schema
        .conn()
        .execute(
            "INSERT INTO task_attempts(attempt_id,task_id,epoch,started_at) VALUES('att_2','tsk_1','inst_1',4)",
            [],
        )
        .unwrap();
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn constraint_counterexamples() {
    let (dir, path) = temp_db("constraints");
    let schema = WebBackendSchema::init(&path).unwrap();
    let conn = schema.conn();

    // Invalid state enum.
    let invalid_state = format!(
        "INSERT INTO tasks ({TASK_COLUMNS}) VALUES('tsk_bad','op_bad','organize','organizer','bogus',1,9,'not_started',0,NULL,'cfg','cfg','{{}}',0,NULL,2,NULL,NULL,1,1,NULL)"
    );
    assert!(conn.execute(&invalid_state, []).is_err());

    // Staged result without a pending outcome.
    let pending_without_outcome = format!(
        "INSERT INTO tasks ({TASK_COLUMNS}) VALUES('tsk_p','op_p','organize','organizer','running',1,10,'active',1,NULL,'cfg','cfg','{{}}',0,NULL,2,NULL,NULL,1,1,NULL)"
    );
    assert!(conn.execute(&pending_without_outcome, []).is_err());

    // Terminal state without terminal_at.
    let terminal_without_time = format!(
        "INSERT INTO tasks ({TASK_COLUMNS}) VALUES('tsk_t','op_t','organize','organizer','succeeded',1,11,'exited_confirmed',0,NULL,'cfg','cfg','{{}}',0,NULL,2,NULL,NULL,1,1,NULL)"
    );
    assert!(conn.execute(&terminal_without_time, []).is_err());

    // A valid terminal row is accepted.
    let terminal = format!(
        "INSERT INTO tasks ({TASK_COLUMNS}) VALUES('tsk_ok','op_ok','organize','organizer','succeeded',1,12,'exited_confirmed',0,NULL,'cfg','cfg','{{}}',0,NULL,2,NULL,NULL,1,1,1)"
    );
    assert!(conn.execute(&terminal, []).is_ok());

    // Result payload size must match the stored blob.
    conn.execute(
        "INSERT INTO task_attempts(attempt_id,task_id,epoch,started_at,ended_at) VALUES('att_p','tsk_ok','inst_1',1,2)",
        [],
    )
    .unwrap();
    assert!(conn
        .execute(
            "INSERT INTO task_result_payloads(attempt_id,name,payload_blob,total_bytes,created_at) VALUES('att_p','payload',x'00',2,1)",
            [],
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO task_result_payloads(attempt_id,name,payload_blob,total_bytes,created_at) VALUES('att_p','payload',x'00',1,1)",
            [],
        )
        .is_ok());
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

fn snapshot(dir: &Path) -> (Vec<u8>, Vec<String>) {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let bytes = fs::read(dir.join("web-backend.sqlite")).unwrap();
    (bytes, names)
}

#[test]
fn rejection_leaves_foreign_delete_mode_database_untouched() {
    let (dir, path) = temp_db("no-side-effect");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA application_id = 0x53444b31; CREATE TABLE legacy(x);",
        )
        .unwrap();
    }
    let (before, files_before) = snapshot(&dir);
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_UNKNOWN_DATABASE"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(snapshot(&dir).1, files_before);
    assert_eq!(
        WebBackendSchema::init(&path).unwrap_err().code,
        "WEB_BACKEND_UNKNOWN_DATABASE"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(snapshot(&dir).1, files_before);
    assert!(!dir.join("web-backend.sqlite-wal").exists());
    assert!(!dir.join("web-backend.sqlite-shm").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejection_leaves_wrong_application_id_database_untouched() {
    let (dir, path) = temp_db("wrong-app-id");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA application_id = 12345; CREATE TABLE other(x);",
        )
        .unwrap();
    }
    let (before, files_before) = snapshot(&dir);
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_UNKNOWN_DATABASE"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(snapshot(&dir).1, files_before);
    assert_eq!(
        WebBackendSchema::init(&path).unwrap_err().code,
        "WEB_BACKEND_UNKNOWN_DATABASE"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(snapshot(&dir).1, files_before);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejection_leaves_legacy_marked_empty_database_untouched() {
    let (dir, path) = temp_db("legacy-empty");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA application_id = 0x53444b31;")
            .unwrap();
    }
    let (before, files_before) = snapshot(&dir);
    assert_eq!(
        WebBackendSchema::init(&path).unwrap_err().code,
        "WEB_BACKEND_UNKNOWN_DATABASE"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(snapshot(&dir).1, files_before);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn lineage_rejection_leaves_database_untouched() {
    let (dir, path) = temp_db("lineage-no-write");
    let schema = WebBackendSchema::init(&path).unwrap();
    schema
        .conn()
        .execute_batch("UPDATE schema_meta SET schema_lineage = 'other/1' WHERE id = 1;")
        .unwrap();
    drop(schema);
    let (before, _) = snapshot(&dir);
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_SCHEMA_LINEAGE_MISMATCH"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn version_rejection_leaves_database_untouched() {
    let (dir, path) = temp_db("version-no-write");
    let schema = WebBackendSchema::init(&path).unwrap();
    schema
        .conn()
        .execute_batch("UPDATE schema_meta SET schema_version = 3 WHERE id = 1;")
        .unwrap();
    drop(schema);
    let (before, _) = snapshot(&dir);
    assert_eq!(
        WebBackendSchema::open(&path).unwrap_err().code,
        "WEB_BACKEND_SCHEMA_VERSION_MISMATCH"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    let _ = fs::remove_dir_all(&dir);
}
