use super::web_backend_store::{dispatch, Request, WebBackendStore};
use super::*;
use serde_json::json;

fn temp_root(label: &str) -> (PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!(
        "sidekick-web-manual-items-{}-{}-{}",
        label,
        std::process::id(),
        nonce()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let root = dir.join("root");
    (dir, root)
}

fn init_store(label: &str) -> (PathBuf, PathBuf, WebBackendStore) {
    let (dir, root) = temp_root(label);
    let mut store = WebBackendStore::new();
    store
        .init(&json!({"root": root.to_string_lossy()}))
        .unwrap();
    (dir, root, store)
}

fn insert_item(store: &mut WebBackendStore, item_id: &str) {
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES (?1,?2,?3,?4,?5,'open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
            "params": [item_id, "标题", "action", "李四", "high"]
        }]}))
        .unwrap();
}

fn count(store: &WebBackendStore, sql: &str) -> i64 {
    let result = store.query(&json!({"sql": sql, "params": []})).unwrap();
    let rows = result.get("rows").unwrap().as_array().unwrap();
    rows[0][0].as_i64().unwrap()
}

#[test]
fn init_creates_manual_item_tables_and_is_idempotent() {
    let (dir, root, mut store) = init_store("init");
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'"
        ),
        13
    );
    assert_eq!(
        store.pragma(&json!({"name": "user_version"})).unwrap()["value"],
        2
    );
    assert_eq!(
        store
            .query(
                &json!({"sql": "SELECT schema_version FROM schema_meta WHERE id=1", "params": []})
            )
            .unwrap()["rows"][0][0],
        2
    );
    // A second init on the same root validates without duplicating.
    store
        .init(&json!({"root": root.to_string_lossy()}))
        .unwrap();
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'"
        ),
        13
    );
    store.close().unwrap();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn open_rejects_missing_root_and_requires_explicit_init() {
    let (dir, root) = temp_root("open-missing");
    let mut store = WebBackendStore::new();
    let error = store
        .open(&json!({"root": root.to_string_lossy()}))
        .unwrap_err();
    assert_eq!(error.code, "WEB_BACKEND_INVALID_ROOT");
    // init creates the root structure; a later open succeeds.
    store
        .init(&json!({"root": root.to_string_lossy()}))
        .unwrap();
    store.close().unwrap();
    store
        .open(&json!({"root": root.to_string_lossy()}))
        .unwrap();
    store.close().unwrap();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn transact_is_atomic_and_rolls_back_on_failure() {
    let (dir, _root, mut store) = init_store("atomic");
    let outcome = store.transact(&json!({"ops": [
        {
            "sql": "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES ('mi_1','标题','action','李四','high','open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
            "params": []
        },
        {
            "sql": "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES ('mi_2',NULL,'action','李四','high','open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
            "params": []
        }
    ]}));
    assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_SQL_ERROR");
    assert_eq!(count(&store, "SELECT count(*) FROM manual_items"), 0);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn conditional_update_reports_changes() {
    let (dir, _root, mut store) = init_store("changes");
    insert_item(&mut store, "mi_1");
    let first = store
        .transact(&json!({"ops": [{
            "sql": "UPDATE manual_items SET title='新标题', version=2, updated_at_ms=2 WHERE item_id='mi_1' AND version=1",
            "params": []
        }]}))
        .unwrap();
    assert_eq!(first["results"][0]["changes"], 1);
    let second = store
        .transact(&json!({"ops": [{
            "sql": "UPDATE manual_items SET title='再改', version=3, updated_at_ms=3 WHERE item_id='mi_1' AND version=1",
            "params": []
        }]}))
        .unwrap();
    assert_eq!(second["results"][0]["changes"], 0);
    assert_eq!(
        store
            .query(
                &json!({"sql": "SELECT title FROM manual_items WHERE item_id='mi_1'", "params": []})
            )
            .unwrap()["rows"][0][0],
        "新标题"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn history_insert_shares_the_item_transaction() {
    let (dir, _root, mut store) = init_store("history");
    store
        .transact(&json!({"ops": [
            {
                "sql": "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES ('mi_1','标题','action','李四','high','open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
                "params": []
            },
            {
                "sql": "INSERT INTO manual_item_events (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES ('op_1','mi_1','create',1,'{}',NULL,'{}')",
                "params": []
            }
        ]}))
        .unwrap();
    assert_eq!(count(&store, "SELECT count(*) FROM manual_item_events"), 1);
    // A failed event insert rolls the item insert back too.
    let outcome = store.transact(&json!({"ops": [
        {
            "sql": "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES ('mi_2','标题','action','李四','high','open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
            "params": []
        },
        {
            "sql": "INSERT INTO manual_item_events (operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES ('op_1','mi_2','create',1,'{}',NULL,'{}')",
            "params": []
        }
    ]}));
    assert!(outcome.is_err());
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM manual_items WHERE item_id='mi_2'"
        ),
        0
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_scope_rejects_out_of_scope_sql() {
    let (dir, _root, mut store) = init_store("scope");
    for sql in [
        "ATTACH DATABASE '/tmp/other.sqlite' AS other",
        "DROP TABLE manual_items",
        "CREATE TABLE scratch(x)",
        "INSERT INTO tasks (task_id) VALUES ('tsk_1')",
        "INSERT INTO manual_items (item_id) VALUES ('mi_1'); DROP TABLE manual_items",
        "PRAGMA user_version = 3",
    ] {
        let outcome = store.transact(&json!({"ops": [{"sql": sql, "params": []}]}));
        assert!(outcome.is_err(), "accepted out-of-scope SQL: {sql}");
        assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_SQL_DENIED");
    }
    // A value that merely contains a forbidden keyword is not a statement.
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES ('mi_1','DROP TABLE 也只是一句话','action','李四','high','open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
            "params": []
        }]}))
        .unwrap();
    assert_eq!(count(&store, "SELECT count(*) FROM manual_items"), 1);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn query_is_read_only() {
    let (dir, _root, mut store) = init_store("query");
    insert_item(&mut store, "mi_1");
    let result = store
        .query(&json!({"sql": "SELECT item_id,title FROM manual_items ORDER BY item_id", "params": []}))
        .unwrap();
    assert_eq!(result["rows"][0][0], "mi_1");
    for sql in [
        "DELETE FROM manual_items",
        "UPDATE manual_items SET title='x'",
        "INSERT INTO manual_items (item_id) VALUES ('mi_2')",
        "SELECT item_id FROM manual_items; DROP TABLE manual_items",
    ] {
        let outcome = store.query(&json!({"sql": sql, "params": []}));
        assert!(outcome.is_err(), "accepted non-read SQL: {sql}");
        assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_SQL_DENIED");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn pragma_is_read_only_and_whitelisted() {
    let (dir, _root, store) = init_store("pragma");
    assert_eq!(
        store.pragma(&json!({"name": "user_version"})).unwrap()["value"],
        2
    );
    assert_eq!(
        store.pragma(&json!({"name": "journal_mode"})).unwrap()["value"]
            .as_str()
            .unwrap()
            .to_lowercase(),
        "wal"
    );
    for name in ["user_version=3", "integrity_check", "table_info"] {
        let outcome = store.pragma(&json!({"name": name}));
        assert!(outcome.is_err(), "accepted non-whitelisted pragma: {name}");
        assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_PRAGMA_DENIED");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn backup_writes_a_verified_copy() {
    let (dir, _root, mut store) = init_store("backup");
    insert_item(&mut store, "mi_1");
    let destination = dir.join("backup.sqlite");
    store
        .backup(&json!({"destination": destination.to_string_lossy()}))
        .unwrap();
    assert!(destination.exists());
    let target = Connection::open(&destination).unwrap();
    let tables: i64 = target
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 13);
    drop(target);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn root_lock_blocks_a_second_open_until_close() {
    let (dir, root, mut store) = init_store("lock");
    let mut second = WebBackendStore::new();
    let error = second
        .open(&json!({"root": root.to_string_lossy()}))
        .unwrap_err();
    assert_eq!(error.code, "WEB_BACKEND_ROOT_IN_USE");
    store.close().unwrap();
    second
        .open(&json!({"root": root.to_string_lossy()}))
        .unwrap();
    second.close().unwrap();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dispatch_maps_requests_to_responses() {
    let (dir, _root, mut store) = init_store("dispatch");
    let request = Request {
        id: json!("1"),
        command: "pragma".to_string(),
        params: json!({"name": "user_version"}),
    };
    let response = dispatch(&mut store, &request);
    assert!(response.ok);
    assert_eq!(response.result.unwrap()["value"], 2);
    let unknown = Request {
        id: json!("2"),
        command: "nope".to_string(),
        params: json!({}),
    };
    let response = dispatch(&mut store, &unknown);
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "WEB_BACKEND_UNKNOWN_COMMAND");
    let _ = fs::remove_dir_all(&dir);
}
