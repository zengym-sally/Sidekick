use super::web_backend_schema::{
    init_with_fault, open_with_fault, WebBackendMigrationFault, WebBackendSchema, SCHEMA_LINEAGE,
    SCHEMA_VERSION, WEB_BACKEND_APPLICATION_ID,
};
use super::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

const TASK_COLUMNS: &str = "task_id,operation_id,type,role,state,version,submit_seq,attempt_exit_state,result_pending_exit,pending_outcome,config_revision,original_config_revision,input_ref,cancel_intent,next_attempt_at,attempt_budget,result_ref,failure,created_at,updated_at,terminal_at";
const SQL_V1: &str = include_str!("../../migrations/web-backend/001_web_backend.sql");
const SQL_V2: &str = include_str!("../../migrations/web-backend/002_manual_items.sql");
const SQL_V3: &str = include_str!("../../migrations/web-backend/003_text_intake.sql");

/// Build a database stopped at v2 (001 + 002 applied, user_version 2, mirror 2).
fn build_v2_db(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    conn.execute_batch("PRAGMA application_id = 0x57424b31;")
        .unwrap();
    rusqlite_migration::Migrations::new(vec![
        rusqlite_migration::M::up(SQL_V1),
        rusqlite_migration::M::up(SQL_V2),
    ])
    .to_latest(&mut conn)
    .unwrap();
    drop(conn);
}

/// Build a database stopped at v3 (001 + 002 + 003 applied, user_version 3,
/// mirror 3) — the state an existing text-intake database is in before 004.
fn build_v3_db(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    conn.execute_batch("PRAGMA application_id = 0x57424b31;")
        .unwrap();
    rusqlite_migration::Migrations::new(vec![
        rusqlite_migration::M::up(SQL_V1),
        rusqlite_migration::M::up(SQL_V2),
        rusqlite_migration::M::up(SQL_V3),
    ])
    .to_latest(&mut conn)
    .unwrap();
    drop(conn);
}

fn insert_manual_item(conn: &Connection, item_id: &str, title: &str) {
    conn.execute(
        "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES (?1,?2,'action','李四','high','open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
        rusqlite::params![item_id, title],
    )
    .unwrap();
}

fn insert_event(conn: &Connection, sequence: i64, item_id: &str) {
    conn.execute(
        "INSERT INTO manual_item_events (sequence,operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES (?1,?1,?2,'create',1,'{}',NULL,'{}')",
        rusqlite::params![sequence, item_id],
    )
    .unwrap();
}

fn sequence_high_water(conn: &Connection, table: &str) -> Option<i64> {
    conn.query_row(
        "SELECT seq FROM sqlite_sequence WHERE name=?1",
        [table],
        |r| r.get::<_, i64>(0),
    )
    .ok()
}

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
    assert_eq!(table_count(schema.conn()), 19);
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
    // The 003 migration adds the five text-intake tables and rebuilds the
    // manual-item pair with the widened `source`/`action` CHECKs.
    for table in [
        "text_sources",
        "candidates",
        "candidate_previews",
        "manual_item_sources",
        "sign_off_batches",
    ] {
        assert_eq!(
            schema
                .conn()
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1,
            "missing 003 table {table}"
        );
    }
    // The 004 migration adds exactly one table: the candidate-operation ledger.
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='candidate_operations'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1,
        "missing 004 table candidate_operations"
    );
    // The transient high-water capture table must not survive the migration.
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='_web_backend_seq_high_water'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    drop(schema);

    // Idempotent: a second init validates and returns without duplicating.
    let again = WebBackendSchema::init(&path).unwrap();
    assert_eq!(table_count(again.conn()), 19);
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
        .execute_batch("UPDATE schema_meta SET schema_version = 5 WHERE id = 1;")
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
            "UPDATE schema_meta SET schema_version = 5 WHERE id = 1; PRAGMA user_version = 5;",
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
    assert_eq!(table_count(&target), 19);
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
    let failed = init_with_fault(&path, WebBackendMigrationFault::AfterThird);
    assert_eq!(failed.unwrap_err().code, "WEB_BACKEND_MIGRATION_FAILED");
    let probe = Connection::open(&path).unwrap();
    // The fault is injected after the third migration. rusqlite_migration
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
    // The blank file is still initializable: the retry applies 001 + 002 + 003.
    let schema = WebBackendSchema::init(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 19);
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
        open_with_fault(&path, WebBackendMigrationFault::AfterThird)
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

    // A normal open completes 002 + 003 without another fault.
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 19);
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
        open_with_fault(&path, WebBackendMigrationFault::AfterThird)
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
        .execute_batch("UPDATE schema_meta SET schema_version = 5 WHERE id = 1;")
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

#[test]
fn migration_003_preserves_rows_and_widened_check_constraints() {
    let (dir, path) = temp_db("003-preserve");
    build_v2_db(&path);
    {
        let conn = Connection::open(&path).unwrap();
        insert_manual_item(&conn, "mi_1", "旧事项");
        insert_event(&conn, 1, "mi_1");
        insert_event(&conn, 2, "mi_1");
    }
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 19);
    // The full pending chain (003 + 004) lands in one open, so the mirror and
    // `user_version` read 4; the rows below still pin 003's own preservation
    // semantics (004 only appends the ledger table).
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT schema_version FROM schema_meta WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        4
    );
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
    // Existing values are preserved byte-for-byte.
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT title FROM manual_items WHERE item_id='mi_1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "旧事项"
    );
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT count(*) FROM manual_item_events WHERE item_id='mi_1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    // The widened CHECKs accept the new source/action values.
    insert_manual_item(schema.conn(), "mi_2", "签收事项");
    schema
        .conn()
        .execute(
            "UPDATE manual_items SET source='signed_ai' WHERE item_id='mi_2'",
            [],
        )
        .unwrap();
    schema
        .conn()
        .execute(
            "INSERT INTO manual_item_events (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES ('op_link','mi_2','link',1,'{}',NULL,'{}')",
            [],
        )
        .unwrap();
    // The old values are still rejected.
    assert!(schema
        .conn()
        .execute(
            "UPDATE manual_items SET source='legacy' WHERE item_id='mi_1'",
            []
        )
        .is_err());
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_003_preserves_autoincrement_high_water_after_deleted_tail() {
    let (dir, path) = temp_db("003-high-water");
    build_v2_db(&path);
    {
        let conn = Connection::open(&path).unwrap();
        insert_manual_item(&conn, "mi_1", "事项");
        insert_event(&conn, 1, "mi_1");
        insert_event(&conn, 2, "mi_1");
        insert_event(&conn, 3, "mi_1");
        insert_event(&conn, 4, "mi_1");
        insert_event(&conn, 5, "mi_1");
        // A hard-deleted tail: the AUTOINCREMENT high-water stays at 5.
        conn.execute("DELETE FROM manual_item_events WHERE sequence >= 4", [])
            .unwrap();
        assert_eq!(sequence_high_water(&conn, "manual_item_events"), Some(5));
    }
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(
        sequence_high_water(schema.conn(), "manual_item_events"),
        Some(5),
        "003 must restore the historical AUTOINCREMENT high-water"
    );
    // A fresh event must not reuse the deleted tail's sequence numbers.
    schema
        .conn()
        .execute(
            "INSERT INTO manual_item_events (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES ('op_new','mi_1','create',1,'{}',NULL,'{}')",
            [],
        )
        .unwrap();
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT sequence FROM manual_item_events WHERE operation_id='op_new'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        6
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_003_preserves_nonzero_high_water_on_empty_table() {
    let (dir, path) = temp_db("003-empty-high-water");
    build_v2_db(&path);
    {
        let conn = Connection::open(&path).unwrap();
        insert_manual_item(&conn, "mi_1", "事项");
        insert_event(&conn, 1, "mi_1");
        insert_event(&conn, 2, "mi_1");
        insert_event(&conn, 3, "mi_1");
        conn.execute("DELETE FROM manual_item_events", []).unwrap();
        assert_eq!(sequence_high_water(&conn, "manual_item_events"), Some(3));
    }
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(
        sequence_high_water(schema.conn(), "manual_item_events"),
        Some(3)
    );
    schema
        .conn()
        .execute(
            "INSERT INTO manual_item_events (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES ('op_first','mi_1','create',1,'{}',NULL,'{}')",
            [],
        )
        .unwrap();
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT sequence FROM manual_item_events WHERE operation_id='op_first'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        4
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_003_enforces_real_foreign_keys() {
    let (dir, path) = temp_db("003-fk");
    let schema = WebBackendSchema::init(&path).unwrap();
    let conn = schema.conn();
    insert_task(conn, "tsk_1", "queued");
    conn.execute(
        "INSERT INTO text_sources (source_id,fingerprint,kind,raw_text,source_at_ms,imported_at_ms,anchor_at_ms,time_zone,succeeded_run_id) VALUES ('src_1','fp_1','text','原文',NULL,1,1,'UTC','tsk_1')",
        [],
    )
    .unwrap();
    // A candidate must reference both an existing source and an existing task.
    conn.execute(
        "INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms) VALUES ('cand_1','src_1','tsk_1',1,'pending',1,'{}','原文',NULL,NULL,'[]',0,NULL,NULL)",
        [],
    )
    .unwrap();
    assert!(conn
        .execute(
            "INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms) VALUES ('cand_2','src_missing','tsk_1',1,'pending',1,'{}','原文',NULL,NULL,'[]',0,NULL,NULL)",
            []
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms) VALUES ('cand_3','src_1','tsk_missing',1,'pending',1,'{}','原文',NULL,NULL,'[]',0,NULL,NULL)",
            []
        )
        .is_err());
    // The (source_id, ordinal) uniqueness is enforced.
    assert!(conn
        .execute(
            "INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms) VALUES ('cand_4','src_1','tsk_1',1,'pending',1,'{}','原文',NULL,NULL,'[]',0,NULL,NULL)",
            []
        )
        .is_err());
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_fault_after_003_rolls_back_to_v2_and_retry_completes() {
    let (dir, path) = temp_db("003-fault");
    build_v2_db(&path);
    {
        let conn = Connection::open(&path).unwrap();
        insert_manual_item(&conn, "mi_1", "事项");
        insert_event(&conn, 1, "mi_1");
    }
    assert_eq!(
        open_with_fault(&path, WebBackendMigrationFault::AfterThird)
            .unwrap_err()
            .code,
        "WEB_BACKEND_MIGRATION_FAILED"
    );
    let probe = Connection::open(&path).unwrap();
    assert_eq!(table_count(&probe), 13, "003 must roll back, leaving v2");
    assert_eq!(
        probe
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT schema_version FROM schema_meta WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='text_sources'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    // The pre-migration rows and the high-water survive the rollback.
    assert_eq!(
        probe
            .query_row(
                "SELECT title FROM manual_items WHERE item_id='mi_1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "事项"
    );
    assert_eq!(sequence_high_water(&probe, "manual_item_events"), Some(1));
    drop(probe);
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 19);
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_004_creates_the_append_only_ledger_with_a_real_foreign_key() {
    let (dir, path) = temp_db("004-ledger");
    let schema = WebBackendSchema::init(&path).unwrap();
    let conn = schema.conn();
    // The ledger is exactly the five approved columns; the action vocabulary is
    // the three direct-edit families and nothing else.
    let columns: Vec<String> = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(candidate_operations)")
            .unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(
        columns,
        vec![
            "operation_id",
            "candidate_id",
            "action",
            "request_json",
            "occurred_at_ms"
        ]
    );
    insert_task(conn, "tsk_1", "queued");
    conn.execute(
        "INSERT INTO text_sources (source_id,fingerprint,kind,raw_text,source_at_ms,imported_at_ms,anchor_at_ms,time_zone,succeeded_run_id) VALUES ('src_1','fp_1','text','原文',NULL,1,1,'UTC','tsk_1')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms) VALUES ('cand_1','src_1','tsk_1',1,'pending',1,'{}','原文',NULL,NULL,'[]',0,NULL,NULL)",
        [],
    )
    .unwrap();
    // A committed direct edit lands one ledger row bound to its candidate.
    conn.execute(
        "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_1','cand_1','edit','{\"action\":\"edit\"}',1)",
        [],
    )
    .unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM candidate_operations", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    // The FK is real: an unknown candidate is refused, not silently orphaned.
    assert!(conn
        .execute(
            "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_2','cand_missing','edit','{}',1)",
            []
        )
        .is_err());
    // The action CHECK is real: an out-of-vocabulary action is refused.
    for action in ["sign_off", "create", "UPDATE"] {
        assert!(conn
            .execute(
                "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_bad','cand_1',?1,'{}',1)",
                [action]
            )
            .is_err());
    }
    // The other two approved actions are accepted.
    for (operation_id, action) in [("op_3", "discard"), ("op_4", "apply_preview")] {
        conn.execute(
            "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES (?1,'cand_1',?2,'{}',1)",
            rusqlite::params![operation_id, action],
        )
        .unwrap();
    }
    // The canonical request bytes and the operation instant are NOT NULL.
    assert!(conn
        .execute(
            "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_5','cand_1','edit',NULL,1)",
            []
        )
        .is_err());
    assert!(conn
        .execute(
            "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_6','cand_1','edit','{}',NULL)",
            []
        )
        .is_err());
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_fault_after_004_rolls_back_to_v3_and_retry_completes() {
    // Build a v3 database (the state of an existing text-intake install) with a
    // row whose survival the rollback must prove.
    let (dir, path) = temp_db("004-fault");
    build_v3_db(&path);
    {
        let conn = Connection::open(&path).unwrap();
        insert_manual_item(&conn, "mi_1", "事项");
        insert_event(&conn, 1, "mi_1");
    }
    assert_eq!(
        open_with_fault(&path, WebBackendMigrationFault::AfterFourth)
            .unwrap_err()
            .code,
        "WEB_BACKEND_MIGRATION_FAILED"
    );
    let probe = Connection::open(&path).unwrap();
    assert_eq!(table_count(&probe), 18, "004 must roll back, leaving v3");
    assert_eq!(
        probe
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT schema_version FROM schema_meta WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        3
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='candidate_operations'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT title FROM manual_items WHERE item_id='mi_1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "事项"
    );
    assert_eq!(sequence_high_water(&probe, "manual_item_events"), Some(1));
    drop(probe);
    // The retry applies 004 alone and lands the ledger.
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 19);
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        4
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
        4
    );
    assert_eq!(
        schema
            .conn()
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='candidate_operations'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn migration_fault_after_004_on_v2_rolls_back_to_v2_and_retry_completes() {
    // A v2 database has 003 + 004 pending. The injected fault fails the FOURTH
    // migration, so 003 has already executed inside the pending set; the whole
    // set must roll back to v2. A runner that committed each migration on its
    // own would leave v3 behind — this case falsifies that.
    let (dir, path) = temp_db("004-fault-v2");
    build_v2_db(&path);
    {
        let conn = Connection::open(&path).unwrap();
        insert_manual_item(&conn, "mi_1", "事项");
        insert_event(&conn, 1, "mi_1");
    }
    assert_eq!(
        open_with_fault(&path, WebBackendMigrationFault::AfterFourth)
            .unwrap_err()
            .code,
        "WEB_BACKEND_MIGRATION_FAILED"
    );
    let probe = Connection::open(&path).unwrap();
    assert_eq!(
        table_count(&probe),
        13,
        "003 + 004 must roll back together, leaving v2"
    );
    assert_eq!(
        probe
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT schema_version FROM schema_meta WHERE id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='candidate_operations'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='text_sources'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        probe
            .query_row(
                "SELECT title FROM manual_items WHERE item_id='mi_1'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "事项"
    );
    assert_eq!(sequence_high_water(&probe, "manual_item_events"), Some(1));
    drop(probe);
    let schema = WebBackendSchema::open(&path).unwrap();
    assert_eq!(table_count(schema.conn()), 19);
    assert_eq!(
        schema
            .conn()
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        4
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
        4
    );
    drop(schema);
    let _ = fs::remove_dir_all(&dir);
}
