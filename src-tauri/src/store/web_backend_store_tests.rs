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
        19
    );
    assert_eq!(
        store.pragma(&json!({"name": "user_version"})).unwrap()["value"],
        4
    );
    assert_eq!(
        store
            .query(
                &json!({"sql": "SELECT schema_version FROM schema_meta WHERE id=1", "params": []})
            )
            .unwrap()["rows"][0][0],
        4
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
        19
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
        // `workspace_operations` is an 001 table but not in this slice's
        // BUSINESS_TABLES whitelist, so it must stay unwritable.
        "INSERT INTO workspace_operations (operation_id,kind,state,created_at,updated_at) VALUES ('op_1','switch','pending',1,1)",
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
        4
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
    assert_eq!(tables, 19);
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
fn settings_write_scope_is_limited_to_the_application_key() {
    let (dir, _root, mut store) = init_store("settings-scope");
    // Allowed shapes: insert at version 1, then advance by parameterized CAS.
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO settings(key,value,version) VALUES('application.timeZone',?,1)",
            "params": ["Asia/Shanghai"]
        }]}))
        .unwrap();
    store
        .transact(&json!({"ops": [{
            "sql": "UPDATE settings SET value=?, version=version+1 WHERE key='application.timeZone' AND version=?",
            "params": ["UTC", 1]
        }]}))
        .unwrap();
    let value = store
        .query(&json!({"sql": "SELECT value FROM settings WHERE key='application.timeZone'", "params": []}))
        .unwrap()["rows"][0][0]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(value, "UTC");

    // Rejected: another key, a non-CAS update, or an out-of-scope statement.
    for sql in [
        "INSERT INTO settings(key,value,version) VALUES('other.key',?,1)",
        "UPDATE settings SET value=?, version=version+1 WHERE key='application.timeZone'",
        "DELETE FROM settings WHERE key='application.timeZone'",
        "DROP TABLE settings",
    ] {
        let outcome = store.transact(&json!({"ops": [{"sql": sql, "params": []}]}));
        assert!(
            outcome.is_err(),
            "accepted out-of-scope settings SQL: {sql}"
        );
        assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_SQL_DENIED");
    }
    // MINOR-2 adversarial shapes: none may write a row.
    for sql in [
        "INSERT INTO settings(key,value,version) SELECT 'probe.select.key','x',1 WHERE key='application.timeZone'",
        "INSERT INTO settings(key,value,version) VALUES('application.timeZone','x',1),('other.key','y',1)",
        "UPDATE settings SET value=?, version=version+1 WHERE key='application.timeZone' AND version=? OR 1=1",
        "UPDATE settings SET value=?, version=version+1 WHERE key='APPLICATION.TIMEZONE' AND version=?",
        "INSERT INTO settings(note,value,version) VALUES('application.timeZone','x',1)",
        "INSERT INTO settings(key,value,version) VALUES('application.timeZone',?,1); DROP TABLE settings",
    ] {
        let outcome = store.transact(&json!({"ops": [{"sql": sql, "params": []}]}));
        assert!(outcome.is_err(), "accepted adversarial settings SQL: {sql}");
        assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_SQL_DENIED");
    }
    // The CAS must not move a row when the version is wrong.
    let stale = store.transact(&json!({"ops": [{
        "sql": "UPDATE settings SET value=?, version=version+1 WHERE key='application.timeZone' AND version=?",
        "params": ["Asia/Tokyo", 99]
    }]}));
    assert_eq!(stale.unwrap()["results"][0]["changes"], 0);
    // Whitespace variations of the two production templates still pass.
    let (dir2, _root2, mut store2) = init_store("settings-whitespace");
    store2
        .transact(&json!({"ops": [{
            "sql": "INSERT  INTO  settings (key, value, version) VALUES ('application.timeZone', ?, 1)",
            "params": ["Asia/Shanghai"]
        }]}))
        .unwrap();
    store2
        .transact(&json!({"ops": [{
            "sql": "UPDATE settings SET value=?, version=version+1 WHERE key='application.timeZone' AND version=?",
            "params": ["UTC", 1]
        }]}))
        .unwrap();
    let _ = fs::remove_dir_all(&dir2);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_target_dispatch_ignores_business_names_in_subqueries() {
    let (dir, _root, mut store) = init_store("target-dispatch");
    // A business name inside a subquery/EXISTS must not grant write permission
    // to a settings-target statement (A11/A12), nor to another target.
    for sql in [
        "INSERT INTO settings(key,value,version) SELECT 'bypass.probe.key','x',1 FROM manual_items",
        "UPDATE settings SET value=?,version=version+1 WHERE key='application.timeZone' AND version=? OR EXISTS(SELECT 1 FROM manual_items)",
        "INSERT INTO settings(key,value,version) SELECT 'bypass.probe.key','x',1 WHERE EXISTS(SELECT 1 FROM manual_item_events)",
        "INSERT INTO \"settings\"(key,value,version) VALUES('application.timeZone',?,1)",
        "INSERT INTO main.settings(key,value,version) VALUES('application.timeZone',?,1)",
        "DELETE FROM workspace_operations WHERE operation_id IN (SELECT item_id FROM manual_items)",
        "UPDATE workspace_operations SET kind='switch' WHERE operation_id IN (SELECT item_id FROM manual_items)",
    ] {
        let outcome = store.transact(&json!({"ops": [{"sql": sql, "params": []}]}));
        assert!(outcome.is_err(), "accepted cross-target SQL: {sql}");
        assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_SQL_DENIED");
    }
    // The legitimate conditional history INSERT…SELECT still works: the target
    // really is manual_item_events.
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO manual_items (item_id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,due_precision,followup_at_ms,followup_timezone,followup_local,followup_precision,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source) VALUES ('mi_1','t','action','o','high','open',NULL,NULL,NULL,'minute',NULL,NULL,NULL,'minute','[]',1,1,NULL,NULL,1,'manual')",
            "params": []
        }]}))
        .unwrap();
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO manual_item_events(operation_id,item_id,action,occurred_at_ms,request_json,before_json,after_json) SELECT ?,?,?,?,?,?,? WHERE (SELECT changes())=1",
            "params": ["op_1", "mi_1", "create", 1, "{}", null, "{}"]
        }]}))
        .unwrap();
    let count = store
        .query(&json!({"sql": "SELECT count(*) FROM manual_item_events", "params": []}))
        .unwrap()["rows"][0][0]
        .as_i64()
        .unwrap();
    assert_eq!(count, 1);
    let settings_count = store
        .query(&json!({"sql": "SELECT count(*) FROM settings", "params": []}))
        .unwrap()["rows"][0][0]
        .as_i64()
        .unwrap();
    assert_eq!(settings_count, 0);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn business_table_whitelist_covers_the_sixteen_registered_targets() {
    let (dir, _root, mut store) = init_store("business-tables");
    // A statement whose target is whitelisted reaches the SQL engine (and then
    // fails on the deliberately missing column); a non-whitelisted target is
    // rejected by the guard before it is ever prepared.
    const BUSINESS_TABLES: [&str; 16] = [
        "manual_items",
        "manual_item_events",
        "text_sources",
        "candidates",
        "candidate_previews",
        "manual_item_sources",
        "sign_off_batches",
        "candidate_operations",
        "tasks",
        "task_attempts",
        "task_events",
        "task_result_payloads",
        "side_effect_receipts",
        "instance_epochs",
        "recovery_holds",
        "recovery_items",
    ];
    for table in BUSINESS_TABLES {
        let sql = format!("INSERT INTO {table} (definitely_missing_column) VALUES (1)");
        let outcome = store.transact(&json!({"ops": [{"sql": sql, "params": []}]}));
        assert_eq!(
            outcome.unwrap_err().code,
            "WEB_BACKEND_SQL_ERROR",
            "whitelisted table {table} must reach the SQL engine"
        );
    }
    // Tables outside the whitelist are refused by the guard.
    for table in [
        "workspace_operations",
        "schema_meta",
        "sqlite_sequence",
        "settings",
    ] {
        let sql = format!("INSERT INTO {table} (definitely_missing_column) VALUES (1)");
        let outcome = store.transact(&json!({"ops": [{"sql": sql, "params": []}]}));
        assert_eq!(
            outcome.unwrap_err().code,
            "WEB_BACKEND_SQL_DENIED",
            "non-whitelisted table {table} must be refused by the guard"
        );
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_concurrency_settings_templates_are_accepted_and_other_shapes_rejected() {
    let (dir, _root, mut store) = init_store("agent-concurrency");
    // The two exact agentConcurrency templates are accepted.
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO settings(key,value,version)VALUES('agentConcurrency',?,1)",
            "params": ["3"]
        }]}))
        .unwrap();
    store
        .transact(&json!({"ops": [{
            "sql": "UPDATE settings SET value=?,version=version+1 WHERE key='agentConcurrency' AND version=?",
            "params": ["5", 1]
        }]}))
        .unwrap();
    let value = store
        .query(&json!({"sql": "SELECT value FROM settings WHERE key='agentConcurrency'", "params": []}))
        .unwrap()["rows"][0][0]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(value, "5");
    // Adversarial shapes around the new key are refused.
    for sql in [
        "INSERT INTO settings(key,value,version) VALUES('other.key',?,1)",
        "UPDATE settings SET value=?,version=version+1 WHERE key='agentConcurrency'",
        "DELETE FROM settings WHERE key='agentConcurrency'",
        "INSERT INTO settings(key,value,version) SELECT 'agentConcurrency','x',1 WHERE key='application.timeZone'",
        "INSERT INTO settings(key,value,version) VALUES('agentConcurrency','x',1),('other.key','y',1)",
        "UPDATE settings SET value=?, version=version+1 WHERE key='agentConcurrency' AND version=? OR 1=1",
    ] {
        let outcome = store.transact(&json!({"ops": [{"sql": sql, "params": []}]}));
        assert!(
            outcome.is_err(),
            "accepted out-of-scope agentConcurrency SQL: {sql}"
        );
        assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_SQL_DENIED");
    }
    // A stale CAS must not move the row.
    let stale = store.transact(&json!({"ops": [{
        "sql": "UPDATE settings SET value=?,version=version+1 WHERE key='agentConcurrency' AND version=?",
        "params": ["9", 99]
    }]}));
    assert_eq!(stale.unwrap()["results"][0]["changes"], 0);
    // The frozen application.timeZone pair is still accepted unchanged.
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO settings(key,value,version) VALUES('application.timeZone',?,1)",
            "params": ["Asia/Shanghai"]
        }]}))
        .unwrap();
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
    assert_eq!(response.result.unwrap()["value"], 4);
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

#[test]
fn transact_expect_changes_aborts_before_commit_and_rolls_back() {
    let (dir, _root, mut store) = init_store("expect-changes");
    insert_item(&mut store, "mi_1");
    // The first op writes; the second must fail its assertion, so nothing may
    // survive — not even the first op.
    let outcome = store.transact(&json!({"ops": [
        {"sql": "UPDATE manual_items SET title='第一步',version=2 WHERE item_id='mi_1' AND version=1", "params": [], "expectChanges": 1},
        {"sql": "UPDATE manual_items SET title='第二步' WHERE item_id='mi_1' AND version=99", "params": [], "expectChanges": 1}
    ]}));
    assert_eq!(outcome.unwrap_err().code, "WEB_BACKEND_CONDITION_FAILED");
    assert_eq!(
        count(
            &store,
            "SELECT count(*) FROM manual_items WHERE title='第一步'"
        ),
        0
    );
    assert_eq!(
        store
            .query(&json!({"sql": "SELECT title,version FROM manual_items WHERE item_id='mi_1'", "params": []}))
            .unwrap()["rows"][0][0],
        "标题"
    );
    // A successful assertion commits.
    store
        .transact(&json!({"ops": [{
            "sql": "UPDATE manual_items SET title='已提交',version=2 WHERE item_id='mi_1' AND version=1",
            "params": [],
            "expectChanges": 1
        }]}))
        .unwrap();
    assert_eq!(
        store
            .query(
                &json!({"sql": "SELECT title FROM manual_items WHERE item_id='mi_1'", "params": []})
            )
            .unwrap()["rows"][0][0],
        "已提交"
    );
    // Invalid shapes are rejected before any write.
    for value in [json!(-1), json!(1.5), json!("1"), json!(null)] {
        let outcome = store.transact(&json!({"ops": [{
            "sql": "UPDATE manual_items SET title='非法' WHERE item_id='mi_1'",
            "params": [],
            "expectChanges": value
        }]}));
        assert_eq!(
            outcome.unwrap_err().code,
            "WEB_BACKEND_INVALID_PARAMS",
            "value {value}"
        );
    }
    assert_eq!(
        store
            .query(
                &json!({"sql": "SELECT title FROM manual_items WHERE item_id='mi_1'", "params": []})
            )
            .unwrap()["rows"][0][0],
        "已提交"
    );
    // Absent keeps the original behaviour (no assertion).
    store
        .transact(&json!({"ops": [{
            "sql": "UPDATE manual_items SET title='未断言' WHERE item_id='mi_1' AND version=99",
            "params": []
        }]}))
        .unwrap();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn candidate_operations_ledger_is_writable_through_the_adapter() {
    let (dir, _root, mut store) = init_store("ledger");
    // A real ledger insert travels the same `transact` surface as every other
    // business write: the target is whitelisted, the FK is live, and the
    // action CHECK is enforced by the database (surfaced as a SQL error).
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO tasks (task_id,operation_id,type,role,state,version,submit_seq,attempt_exit_state,result_pending_exit,pending_outcome,config_revision,original_config_revision,input_ref,cancel_intent,next_attempt_at,attempt_budget,result_ref,failure,created_at,updated_at,terminal_at) VALUES ('tsk_1','op_t1','extract','organizer','queued',1,1,'not_started',0,NULL,'cfg','cfg','{}',0,NULL,2,NULL,NULL,1,1,NULL)",
            "params": []
        }]}))
        .unwrap();
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO text_sources (source_id,fingerprint,kind,raw_text,source_at_ms,imported_at_ms,anchor_at_ms,time_zone,succeeded_run_id) VALUES ('src_1','fp_1','text','原文',NULL,1,1,'UTC','tsk_1')",
            "params": []
        }]}))
        .unwrap();
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO candidates (candidate_id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_item_id,processed_at_ms) VALUES ('cand_1','src_1','tsk_1',1,'pending',1,'{}','原文',NULL,NULL,'[]',0,NULL,NULL)",
            "params": []
        }]}))
        .unwrap();
    store
        .transact(&json!({"ops": [{
            "sql": "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_1','cand_1','edit','{}',1)",
            "params": []
        }]}))
        .unwrap();
    assert_eq!(
        count(&store, "SELECT count(*) FROM candidate_operations"),
        1
    );
    // The FK refuses an unknown candidate through the adapter too.
    let orphan = store.transact(&json!({"ops": [{
        "sql": "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_2','cand_missing','edit','{}',1)",
        "params": []
    }]}));
    assert_eq!(orphan.unwrap_err().code, "WEB_BACKEND_SQL_ERROR");
    // The action CHECK refuses an out-of-vocabulary action.
    let action = store.transact(&json!({"ops": [{
        "sql": "INSERT INTO candidate_operations (operation_id,candidate_id,action,request_json,occurred_at_ms) VALUES ('op_3','cand_1','sign_off','{}',1)",
        "params": []
    }]}));
    assert_eq!(action.unwrap_err().code, "WEB_BACKEND_SQL_ERROR");
    let _ = fs::remove_dir_all(&dir);
}
