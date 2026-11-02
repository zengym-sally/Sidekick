use super::*;
#[test]
fn today_migration_dedicated_purpose_retains_existing_owner_rows() {
    let mut db = Connection::open_in_memory().unwrap();
    migrations().to_latest(&mut db).unwrap();
    db.execute_batch(include_str!("../../migrations/004_mcp_runs.sql"))
        .unwrap();
    db.pragma_update(None, "user_version", 4).unwrap();
    db.execute("INSERT INTO agent_runs(rowid,id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(42,'old','organizer','role_trial','succeeded','{}','{}',1)",[]).unwrap();
    if let Ok(sql) = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations/005_today_advice.sql"),
    ) {
        db.pragma_update(None, "foreign_keys", false).unwrap();
        let tx = db.transaction().unwrap();
        tx.execute_batch(&sql).unwrap();
        tx.commit().unwrap();
        db.pragma_update(None, "foreign_keys", true).unwrap();
    }
    let added=db.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('today','advisor','today_advice','running','{}','{}',2)",[]);
    assert!(added.is_ok(), "dedicated today purpose rejected: {added:?}");
    assert_eq!(
        db.query_row("SELECT rowid FROM agent_runs WHERE id='old'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        42
    );
}

use super::today_schema::{upgrade_fixed, TodayMigrationFault};
use crate::local_store::tests::Fixture;
use rusqlite::types::Value;
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
fn legacy(version: usize) -> (Fixture, Connection) {
    let f = Fixture::new();
    let root = f.0.join("workspace");
    let mut store = f.store();
    store.initialize(Some(root.clone()), "UTC").unwrap();
    drop(store);
    fs::remove_file(root.join("data/sidekick.sqlite")).unwrap();
    let mut db = Connection::open(root.join("data/sidekick.sqlite")).unwrap();
    migrations().to_version(&mut db, version.min(3)).unwrap();
    if version == 4 {
        db.execute_batch(include_str!("../../migrations/004_mcp_runs.sql"))
            .unwrap();
        db.pragma_update(None, "user_version", 4).unwrap();
    }
    fs::set_permissions(
        root.join("data/sidekick.sqlite"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    db.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;",
    )
    .unwrap();
    db.execute("INSERT INTO todos(rowid,id,title,kind,owner,priority,status,tags_json,created_at_ms,updated_at_ms,version,source) VALUES(31,'legacy-todo','合成旧事项','action','我','medium','open','[]',1,1,1,'manual')",[]).unwrap();
    db.execute("INSERT INTO todo_events(sequence,operation_id,todo_id,action,occurred_at_ms,request_json,after_json) VALUES(17,'legacy-event','legacy-todo','create',1,'{}','{}')",[]).unwrap();
    if version >= 3 {
        db.execute("INSERT INTO agent_runs(rowid,id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(42,'legacy-trial','organizer','role_trial','succeeded','{}','{}',1)",[]).unwrap();
    }
    if version == 4 {
        db.execute("INSERT INTO agent_runs(rowid,id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(43,'legacy-probe',NULL,'mcp_probe','succeeded','{}','{}',1)",[]).unwrap();
        db.execute("INSERT INTO tool_calls(rowid,id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,response_category,created_at_ms,finished_at_ms) VALUES(71,'legacy-call','legacy-trial','model','revision',?1,'server','tool',?1,'responded','success',1,2)",["a".repeat(64)]).unwrap();
    }
    (f, db)
}
fn rows(db: &Connection) -> BTreeMap<String, (Vec<String>, Vec<Vec<Value>>)> {
    let tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect::<Vec<_>>();
    tables
        .into_iter()
        .map(|table| {
            let mut q = db
                .prepare(&format!("SELECT rowid,* FROM {table} ORDER BY rowid"))
                .unwrap();
            let keys = q
                .column_names()
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>();
            let width = q.column_count();
            let rows = q
                .query_map([], |r| {
                    (0..width)
                        .map(|i| r.get(i))
                        .collect::<std::result::Result<Vec<Value>, _>>()
                })
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            (table, (keys, rows))
        })
        .collect()
}
fn preserved(db: &Connection, before: &BTreeMap<String, (Vec<String>, Vec<Vec<Value>>)>) {
    for (table, (keys, expected)) in before {
        let fields = keys
            .iter()
            .map(|key| format!("\"{key}\""))
            .collect::<Vec<_>>()
            .join(",");
        let mut q = db
            .prepare(&format!("SELECT {fields} FROM {table} ORDER BY rowid"))
            .unwrap();
        let width = q.column_count();
        let actual = q
            .query_map([], |r| {
                (0..width)
                    .map(|i| r.get(i))
                    .collect::<std::result::Result<Vec<Value>, _>>()
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect::<Vec<_>>();
        assert_eq!(&actual, expected, "{table}");
    }
}
fn upgrade(
    f: &Fixture,
    db: &mut Connection,
    target: i64,
    fault: TodayMigrationFault,
) -> Result<McpSchemaUpgrade> {
    let root = f.0.join("workspace").canonicalize().unwrap();
    let mut identity = mcp_schema::DatabaseIdentity::capture(&root, &File::open(&root).unwrap())?;
    upgrade_fixed(
        db,
        &mut identity,
        &root,
        &File::open(root.join("backups")).unwrap(),
        target,
        None,
        fault,
    )
}
#[test]
fn today_upgrade_v1_through_v4_preserves_rows_rowids_fk_and_wal_backup() {
    for version in 1..=4 {
        let (f, mut db) = legacy(version);
        let before = rows(&db);
        assert!(
            fs::metadata(f.0.join("workspace/data/sidekick.sqlite-wal"))
                .unwrap()
                .len()
                > 0
        );
        let receipt = upgrade(&f, &mut db, 5, TodayMigrationFault::None).unwrap();
        assert_eq!(
            (receipt.from_version, receipt.to_version),
            (version as i64, 5)
        );
        preserved(&db, &before);
        today_schema::validate_v5(&db).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "foreign_keys", |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        let backup = Connection::open(f.0.join("workspace").join(receipt.backup.unwrap())).unwrap();
        preserved(&backup, &before);
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            version as i64
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='trigger'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            3
        );
        assert!(db.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('null-role',NULL,'today_advice','running','{}','{}',1)",[]).is_err());
        db.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('daily','advisor','today_advice','running','{}','{}',1)",[]).unwrap();
        assert!(db.execute("INSERT INTO tool_calls(id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,created_at_ms) VALUES('denied','daily','m','r',?1,'s','t',?1,'possibly_sent',1)",["a".repeat(64)]).is_err());
        assert!(upgrade(&f, &mut db, 5, TodayMigrationFault::None)
            .unwrap()
            .backup
            .is_none());
    }
}
#[test]
fn today_upgrade_faults_keep_known_backup_rejections_and_block_unknown_outcomes() {
    for target in [3, 5] {
        for fault in [
            TodayMigrationFault::BackupCopy,
            TodayMigrationFault::BackupSync,
            TodayMigrationFault::BackupCollision,
            TodayMigrationFault::Ddl,
            TodayMigrationFault::Copy,
            TodayMigrationFault::ForeignKey,
            TodayMigrationFault::Commit,
            TodayMigrationFault::CommitResponse,
            TodayMigrationFault::Rollback,
            TodayMigrationFault::RollbackReadBack,
            TodayMigrationFault::AfterCommitPath,
            TodayMigrationFault::ForeignKeysOn,
        ] {
            let (f, mut db) = legacy(if target == 3 { 1 } else { 4 });
            let before = rows(&db);
            if fault == TodayMigrationFault::BackupCollision {
                let path = f.0.join(format!(
                    "workspace/backups/before-schema-{target}-synthetic-collision.sqlite"
                ));
                fs::write(&path, b"collision sentinel").unwrap();
                fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
            }
            let error = upgrade(&f, &mut db, target, fault).unwrap_err();
            let known = matches!(
                fault,
                TodayMigrationFault::BackupCopy
                    | TodayMigrationFault::BackupSync
                    | TodayMigrationFault::BackupCollision
            );
            assert_eq!(
                error.code,
                if known {
                    "MCP_BACKUP_FAILED"
                } else {
                    "TODAY_SCHEMA_UNCERTAIN"
                }
            );
            preserved(&db, &before);
            assert_eq!(
                db.pragma_query_value(None, "foreign_keys", |r| r.get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
    }
}
#[test]
fn today_upgrade_rejects_unknown_dependencies_before_backup() {
    for sql in [
        "CREATE INDEX unknown_today_index ON agent_runs(status)",
        "CREATE VIEW unknown_today_view AS SELECT id FROM agent_runs",
        "CREATE TRIGGER unknown_today_trigger AFTER INSERT ON agent_runs BEGIN SELECT 1; END",
        "CREATE TABLE unknown_today_fk(parent TEXT REFERENCES agent_runs(id))",
        "CREATE TABLE agent_runs_v5(id TEXT)",
    ] {
        let (f, mut db) = legacy(4);
        db.execute_batch(sql).unwrap();
        let before = rows(&db);
        assert_eq!(
            upgrade(&f, &mut db, 5, TodayMigrationFault::None)
                .unwrap_err()
                .code,
            "TODAY_SCHEMA_UNSUPPORTED"
        );
        preserved(&db, &before);
        assert_eq!(
            fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
            0
        );
    }
}
#[test]
fn today_unknown_direct_app_store_blocks_mcp_database_entries() {
    let (f, db) = legacy(4);
    drop(db);
    let mut store = f.store();
    let status = store.today_storage_status().unwrap();
    store.today_migration_fault = TodayMigrationFault::CommitResponse;
    assert_eq!(
        store
            .confirm_today_upgrade(McpUpgradeInput {
                confirmed: true,
                confirmation_token: status.confirmation_token.unwrap(),
            })
            .unwrap_err()
            .code,
        "TODAY_SCHEMA_UNCERTAIN"
    );
    assert_eq!(store.list().unwrap_err().code, "TODAY_SCHEMA_UNCERTAIN");
    let status = store
        .mcp_storage_status()
        .map(|_| "OK")
        .unwrap_or_else(|e| e.code);
    let upgrade = store
        .upgrade_mcp_storage()
        .map(|_| "OK")
        .unwrap_or_else(|e| e.code);
    assert_eq!(
        (status, upgrade),
        ("TODAY_SCHEMA_UNCERTAIN", "TODAY_SCHEMA_UNCERTAIN")
    );
}
#[test]
fn today_unknown_screen_blocks_same_local_state_and_reopens_only_with_new_instance() {
    use crate::store_commands::LocalState;
    let (f, db) = legacy(4);
    drop(db);
    let local = LocalState::new(f.0.join("app"));
    let status = local.access(|s| s.today_storage_status()).unwrap();
    local
        .access(|s| {
            s.today_migration_fault = TodayMigrationFault::CommitResponse;
            Ok(())
        })
        .unwrap();
    assert_eq!(
        local
            .access(|s| s.confirm_today_upgrade(McpUpgradeInput {
                confirmed: true,
                confirmation_token: status.confirmation_token.unwrap()
            }))
            .unwrap_err()
            .code,
        "TODAY_SCHEMA_UNCERTAIN"
    );
    assert_eq!(
        local.access(|s| s.list()).unwrap_err().code,
        "TODAY_SCHEMA_UNCERTAIN"
    );
    assert_eq!(
        local.access(|s| s.profile()).unwrap_err().code,
        "TODAY_SCHEMA_UNCERTAIN"
    );
    drop(local);
    let reopened = LocalState::new(f.0.join("app"));
    assert_eq!(
        reopened
            .access(|s| s.today_storage_status())
            .unwrap()
            .version,
        5
    );
    assert_eq!(reopened.access(|s| s.list()).unwrap().len(), 1);
}
#[test]
fn today_ordinary_v1_v2_open_keeps_target3_and_safe_original_version_backup() {
    for version in [1, 2] {
        let (f, db) = legacy(version);
        let before = rows(&db);
        drop(db);
        let s = f.store();
        assert_eq!(
            s.db()
                .unwrap()
                .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
        preserved(s.db().unwrap(), &before);
        let files = fs::read_dir(f.0.join("workspace/backups"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);
        assert!(files[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("before-schema-3-"));
        let backup = Connection::open(&files[0]).unwrap();
        preserved(&backup, &before);
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            version as i64
        );
    }
}
#[test]
fn today_baseline_open_unknown_cannot_be_bypassed_by_local_state_auto_reopen() {
    use crate::store_commands::LocalState;
    for version in [1, 2] {
        for fault in [
            TodayMigrationFault::Commit,
            TodayMigrationFault::CommitResponse,
            TodayMigrationFault::Rollback,
            TodayMigrationFault::RollbackReadBack,
            TodayMigrationFault::ForeignKeysOn,
        ] {
            let (f, db) = legacy(version);
            drop(db);
            TODAY_OPEN_FAULT.with(|slot| slot.set(fault));
            let local = LocalState::new(f.0.join("app"));
            let first = local.access(|s| s.list());
            TODAY_OPEN_FAULT.with(|slot| slot.set(TodayMigrationFault::None));
            assert_eq!(first.unwrap_err().code, "TODAY_SCHEMA_UNCERTAIN");
            assert_eq!(
                local.access(|s| s.list()).unwrap_err().code,
                "TODAY_SCHEMA_UNCERTAIN"
            );
            drop(local);
            let reopened = LocalState::new(f.0.join("app"));
            assert_eq!(reopened.access(|s| s.list()).unwrap().len(), 1);
        }
    }
}
fn advice_fixture() -> (Fixture, AppStore, TodayFacts) {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(Some(f.0.join("workspace")), "UTC").unwrap();
    let status = s.today_storage_status().unwrap();
    s.confirm_today_upgrade(McpUpgradeInput {
        confirmed: true,
        confirmation_token: status.confirmation_token.unwrap(),
    })
    .unwrap();
    for (index, kind) in ["action", "followup", "action", "action"]
        .into_iter()
        .enumerate()
    {
        let row = s
            .create(
                TodoInput {
                    title: format!("合成事项{index}"),
                    kind: kind.into(),
                    owner: if kind == "action" {
                        "我"
                    } else {
                        "合成负责人"
                    }
                    .into(),
                    priority: "medium".into(),
                    tags: vec![],
                    due: None,
                    followup: None,
                },
                &format!("today-create-{index}"),
            )
            .unwrap();
        if index == 2 {
            s.set_completed(&row.id, row.version, true, "today-complete")
                .unwrap();
        }
        if index == 3 {
            s.delete(&row.id, row.version, "today-delete").unwrap();
        }
    }
    let mut raw = s.list().unwrap();
    raw.sort_by(|left, right| left.id.cmp(&right.id));
    let todos = raw
        .iter()
        .map(|row| TodayFactTodo {
            id: row.id.clone(),
            version: row.version,
            title: row.fields.title.clone(),
            kind: row.fields.kind.clone(),
            owner: row.fields.owner.clone(),
            priority: row.fields.priority.clone(),
            tags: row.fields.tags.clone(),
            status: row.status.clone(),
            due_date: None,
            followup_date: None,
            overdue: false,
        })
        .collect();
    let facts = TodayFacts {
        schema_version: 1,
        snapshot_id: "today-store-first".into(),
        anchor_at_ms: 1793581200000,
        time_zone: "UTC".into(),
        date: "2026-11-02".into(),
        raw_todos: raw,
        todos,
        counts: TodayCounts {
            total: 3,
            open: 2,
            completed: 1,
            deleted: 1,
            due_today: 0,
            followup_today: 0,
            undated: 2,
            overdue: 0,
        },
    };
    (f, s, facts)
}
fn advice_result(facts: &TodayFacts) -> serde_json::Value {
    json!({"kind":"today_advice","version":1,"snapshotId":facts.snapshot_id,"date":facts.date,"timeZone":facts.time_zone,"ranking":facts.todos.iter().filter(|row|row.status=="open").map(|row|json!({"todoId":row.id,"todoVersion":row.version,"reasons":[{"code":"undated","relatedTodoId":null,"relatedTodoVersion":null},{"code":if row.kind=="action"{"open_action"}else{"open_followup"},"relatedTodoId":null,"relatedTodoVersion":null}]})).collect::<Vec<_>>()})
}
#[test]
fn today_store_strict_result_validation_never_mutates_facts_or_old_history() {
    let (_f, mut s, facts) = advice_fixture();
    let before = rows(s.db().unwrap());
    let run = s
        .begin_today_advice(json!({"agent":{"agentId":"advisor"}}), facts.clone())
        .unwrap();
    let valid = advice_result(&facts);
    for case in 0..15 {
        let mut value = valid.clone();
        match case {
            0 => value["kind"] = "advisor".into(),
            1 => value["version"] = 2.into(),
            2 => value["snapshotId"] = "old-run".into(),
            3 => value["date"] = "2026-11-01".into(),
            4 => value["timeZone"] = "Asia/Shanghai".into(),
            5 => {
                value["ranking"].as_array_mut().unwrap().pop();
            }
            6 => value["ranking"][1] = value["ranking"][0].clone(),
            7 => value["ranking"][0]["todoVersion"] = 99.into(),
            8 => value["ranking"][0]["reasons"][0]["code"] = "overdue".into(),
            9 => value["ranking"][0]["reasons"][0]["relatedTodoId"] = "unrelated".into(),
            10 => value["ranking"][0]["reasons"][0]["code"] = json!(["undated"]),
            11 => {
                value["ranking"][0]["reasons"] = json!([{"code":"undated","relatedTodoId":null,"relatedTodoVersion":null},{"relatedTodoVersion":null,"code":"undated","relatedTodoId":null}])
            }
            12 => value["ranking"][0]["owner"] = "another".into(),
            13 => {
                value["counts"] = json!({"open":0});
            }
            _ => {
                let closed = facts
                    .todos
                    .iter()
                    .find(|todo| todo.status == "completed")
                    .unwrap();
                value["ranking"][0]["todoId"] = closed.id.clone().into();
                value["ranking"][0]["todoVersion"] = closed.version.into();
            }
        }
        match serde_json::from_value::<TodayAdviceResult>(value) {
            Ok(result) => assert_eq!(
                s.complete_today_advice(&run.id, result).unwrap_err().code,
                "MODEL_INVALID_OUTPUT"
            ),
            Err(_) => assert!([10, 12, 13].contains(&case)),
        }
        assert_eq!(s.today_advice_run(&run.id).unwrap().status, "running");
    }
    let mut alternate = valid.clone();
    alternate["ranking"].as_array_mut().unwrap().reverse();
    let done = s
        .complete_today_advice(&run.id, serde_json::from_value(alternate.clone()).unwrap())
        .unwrap();
    assert_eq!(
        serde_json::to_value(done.result.unwrap()).unwrap(),
        alternate
    );
    for (table, (columns, expected)) in before {
        if table != "agent_runs" {
            let before = BTreeMap::from([(table, (columns, expected))]);
            preserved(s.db().unwrap(), &before);
        }
    }
    assert_eq!(s.latest_agent_trial("advisor").unwrap().map(|r| r.id), None);
}
#[test]
fn today_store_latest_success_uses_rowid_and_semantic_currentness() {
    let (f, mut s, facts) = advice_fixture();
    let first = s
        .begin_today_advice(json!({"agent":{"agentId":"advisor"}}), facts.clone())
        .unwrap();
    s.complete_today_advice(
        &first.id,
        serde_json::from_value(advice_result(&facts)).unwrap(),
    )
    .unwrap();
    let mut second_facts = facts.clone();
    second_facts.snapshot_id = "today-store-second".into();
    second_facts.anchor_at_ms -= 1000;
    let second = s
        .begin_today_advice(json!({"agent":{"agentId":"advisor"}}), second_facts)
        .unwrap();
    s.finish_today_advice_error(&second.id, "MODEL_SERVICE")
        .unwrap();
    let state = s.today_advice_state(facts.clone()).unwrap();
    assert_eq!(state.latest.unwrap().id, second.id);
    assert_eq!(state.last_success.unwrap().id, first.id);
    assert!(!state.last_success_stale);
    let mut now = facts.clone();
    now.anchor_at_ms += 30000;
    now.snapshot_id = "current".into();
    assert!(
        !s.today_advice_state(now.clone())
            .unwrap()
            .last_success_stale
    );
    now.raw_todos[0].fields.title = "合成新标题".into();
    now.todos[0].title = "合成新标题".into();
    assert!(s.today_advice_state(now).unwrap().last_success_stale);
    let mut now = facts.clone();
    now.date = "2026-11-03".into();
    assert!(s.today_advice_state(now).unwrap().last_success_stale);
    drop(s);
    let reopened = f.store();
    assert_eq!(
        reopened
            .today_advice_state(facts)
            .unwrap()
            .last_success
            .unwrap()
            .id,
        first.id
    );
}
#[test]
fn today_confirmation_is_target_bound_once_only_and_v5_keeps_mcp_compatible() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(Some(f.0.join("workspace")), "UTC").unwrap();
    let today = s.today_storage_status().unwrap();
    let mcp = s.mcp_storage_status().unwrap();
    assert_ne!(today.confirmation_token, mcp.confirmation_token);
    assert_eq!(
        s.confirm_today_upgrade(McpUpgradeInput {
            confirmed: false,
            confirmation_token: today.confirmation_token.clone().unwrap()
        })
        .unwrap_err()
        .code,
        "TODAY_UPGRADE_CONFIRMATION"
    );
    assert_eq!(
        s.confirm_today_upgrade(McpUpgradeInput {
            confirmed: true,
            confirmation_token: mcp.confirmation_token.clone().unwrap()
        })
        .unwrap_err()
        .code,
        "TODAY_UPGRADE_STALE"
    );
    assert_eq!(
        s.confirm_mcp_upgrade(McpUpgradeInput {
            confirmed: true,
            confirmation_token: today.confirmation_token.clone().unwrap()
        })
        .unwrap_err()
        .code,
        "MCP_UPGRADE_STALE"
    );
    assert_eq!(
        fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
        0
    );
    let result = s
        .confirm_today_upgrade(McpUpgradeInput {
            confirmed: true,
            confirmation_token: today.confirmation_token.clone().unwrap(),
        })
        .unwrap();
    assert_eq!((result.from_version, result.to_version), (3, 5));
    assert_eq!(
        s.confirm_today_upgrade(McpUpgradeInput {
            confirmed: true,
            confirmation_token: today.confirmation_token.unwrap()
        })
        .unwrap_err()
        .code,
        "TODAY_UPGRADE_STALE"
    );
    let mcp = s.mcp_storage_status().unwrap();
    assert_eq!((mcp.version, mcp.target_version), (5, 4));
    assert!(mcp.confirmation_token.is_none());
    assert_eq!(s.upgrade_mcp_storage().unwrap().to_version, 5);
    assert_eq!(
        fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
        1
    );
}
#[test]
fn today_confirm_rejects_every_active_job_kind_without_creating_backup() {
    use crate::runtime_host::{Job, JobKind, RuntimeState};
    use crate::store_commands::LocalState;
    for kind in [
        JobKind::Business,
        JobKind::Trial,
        JobKind::Probe,
        JobKind::Today,
    ] {
        let f = Fixture::new();
        let local = LocalState::new(f.0.join("app"));
        local
            .access(|s| s.initialize(Some(f.0.join("workspace")), "UTC"))
            .unwrap();
        let status = local.access(|s| s.today_storage_status()).unwrap();
        let runtime = RuntimeState::default();
        *runtime.slot.lock().unwrap() = Some(Job {
            run_id: "controlled-busy".into(),
            kind,
            nonce: "controlled".into(),
            server_id: None,
            mcp_owner: Default::default(),
            mcp_intent: Default::default(),
            mcp_trial: Default::default(),
            cancel: Default::default(),
            pid: Default::default(),
            workers: Default::default(),
        });
        assert_eq!(
            runtime
                .confirm_today_storage(
                    &local,
                    McpUpgradeInput {
                        confirmed: true,
                        confirmation_token: status.confirmation_token.unwrap()
                    }
                )
                .unwrap_err()
                .code,
            "RUNTIME_BUSY"
        );
        assert_eq!(
            fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
            0
        );
        runtime.slot.lock().unwrap().take();
    }
}
#[test]
fn today_status_does_not_issue_confirmation_for_changed_product_identity() {
    let (f, db) = legacy(4);
    drop(db);
    let mut s = f.store();
    s.db()
        .unwrap()
        .pragma_update(None, "application_id", 0)
        .unwrap();
    assert_eq!(
        s.today_storage_status().unwrap_err().code,
        "TODAY_SCHEMA_UNSUPPORTED"
    );
    assert_eq!(
        fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
        0
    );
}
#[test]
fn today_raw_only_non_success_history_is_readable_without_hiding_success() {
    let (_f, mut s, facts) = advice_fixture();
    let first = s
        .begin_today_advice(json!({"agent":{"agentId":"advisor"}}), facts.clone())
        .unwrap();
    s.complete_today_advice(
        &first.id,
        serde_json::from_value(advice_result(&facts)).unwrap(),
    )
    .unwrap();
    let input = s
        .today_fact_input("today-raw-history", facts.anchor_at_ms)
        .unwrap();
    let snapshot =
        json!({"agent":{"agentId":"advisor"},"todayPreparation":{"version":1,"input":input}});
    s.db().unwrap().execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('today-raw-history','advisor','today_advice','running',?1,?2,?3)",params![snapshot.to_string(),json!({"version":1,"factsInput":input}).to_string(),facts.anchor_at_ms]).unwrap();
    let raw = s.today_advice_run("today-raw-history").unwrap();
    assert_eq!(raw.status, "running");
    assert!(raw.result.is_none());
    let state = s.today_advice_state(facts.clone()).unwrap();
    assert_eq!(state.latest.unwrap().id, "today-raw-history");
    assert_eq!(state.last_success.unwrap().id, first.id);
    s.cancel_today_advice("today-raw-history").unwrap();
    assert_eq!(
        s.today_advice_run("today-raw-history").unwrap().status,
        "cancelled"
    );
    s.db()
        .unwrap()
        .execute(
            "UPDATE agent_runs SET status='succeeded' WHERE id='today-raw-history'",
            [],
        )
        .unwrap();
    assert!(s.today_advice_run("today-raw-history").is_err());
}
#[test]
fn today_facts_binding_is_once_only_and_input_bytes_are_immutable() {
    let (_f, mut s, mut facts) = advice_fixture();
    facts.snapshot_id = "today-binding-once".into();
    let input = s
        .today_fact_input(&facts.snapshot_id, facts.anchor_at_ms)
        .unwrap();
    let run = s
        .begin_preparing_today_advice(json!({"agent":{"agentId":"advisor"}}), input.clone())
        .unwrap();
    let before: String = s
        .db()
        .unwrap()
        .query_row(
            "SELECT input_json FROM agent_runs WHERE id=?1",
            [&run.id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(s
        .complete_today_advice(
            &run.id,
            serde_json::from_value(advice_result(&facts)).unwrap()
        )
        .is_err());
    let bound = s.bind_today_advice_facts(&run.id, facts.clone()).unwrap();
    assert!(bound.snapshot.get("todayPreparation").is_none());
    assert_eq!(bound.snapshot["todayFacts"]["rawTodos"], input["rawTodos"]);
    assert_eq!(
        s.bind_today_advice_facts(&run.id, facts.clone())
            .unwrap_err()
            .code,
        "TODAY_ADVICE_STOPPED"
    );
    let after: String = s
        .db()
        .unwrap()
        .query_row(
            "SELECT input_json FROM agent_runs WHERE id=?1",
            [&run.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
    s.cancel_today_advice(&run.id).unwrap();
    assert_eq!(
        s.complete_today_advice(
            &run.id,
            serde_json::from_value(advice_result(&facts)).unwrap()
        )
        .unwrap_err()
        .code,
        "TODAY_ADVICE_STOPPED"
    );
}
#[test]
fn today_legacy_full_snapshot_rows_remain_readable_without_rewriting() {
    let (_f, mut s, facts) = advice_fixture();
    let run = s
        .begin_today_advice(json!({"agent":{"agentId":"advisor"}}), facts.clone())
        .unwrap();
    s.complete_today_advice(
        &run.id,
        serde_json::from_value(advice_result(&facts)).unwrap(),
    )
    .unwrap();
    let input = json!({"snapshotId":run.id}).to_string();
    s.db()
        .unwrap()
        .execute(
            "UPDATE agent_runs SET input_json=?2 WHERE id=?1",
            params![run.id, input],
        )
        .unwrap();
    let before = rows(s.db().unwrap());
    let read = s.today_advice_run(&run.id).unwrap();
    assert_eq!(read.status, "succeeded");
    assert_eq!(
        read.snapshot["todayFacts"],
        serde_json::to_value(&facts).unwrap()
    );
    preserved(s.db().unwrap(), &before);
}
