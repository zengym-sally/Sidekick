use super::*;

#[test]
fn mcp_schema_004_accepts_null_role_probe_and_preserves_trial_rowid() {
    let mut db = Connection::open_in_memory().unwrap();
    migrations().to_latest(&mut db).unwrap();
    db.execute("INSERT INTO agent_runs(rowid,id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(42,'old','organizer','role_trial','succeeded','{}','{}',1)",[]).unwrap();
    let sql = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations/004_mcp_runs.sql"),
    )
    .unwrap();
    Migrations::new(vec![
        M::up(include_str!("../../migrations/001_todos.sql")),
        M::up(include_str!("../../migrations/002_ingestion.sql")),
        M::up(include_str!("../../migrations/003_agent_runs.sql")),
        M::up(&sql),
    ])
    .to_latest(&mut db)
    .unwrap();
    db.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('probe',NULL,'mcp_probe','running','{}','{}',2)",[]).unwrap();
    assert_eq!(
        db.query_row("SELECT rowid FROM agent_runs WHERE id='old'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        42
    );
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
}

use super::mcp_schema::{upgrade_database, DatabaseIdentity, McpMigrationFault};
use crate::local_store::tests::{input, Fixture};
use rusqlite::types::Value;
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;

fn legacy(version: usize) -> (Fixture, Connection) {
    let f = Fixture::new();
    let root = f.0.join("workspace");
    let mut s = f.store();
    s.initialize(Some(root.clone()), "UTC").unwrap();
    drop(s);
    fs::remove_file(root.join("data/sidekick.sqlite")).unwrap();
    let mut db = Connection::open(root.join("data/sidekick.sqlite")).unwrap();
    migrations().to_version(&mut db, version).unwrap();
    fs::set_permissions(
        root.join("data/sidekick.sqlite"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    db.execute("INSERT INTO todos(id,title,kind,owner,priority,status,tags_json,created_at_ms,updated_at_ms,version,source) VALUES('todo','synthetic-history','action','fixture','medium','open','[]',1,1,1,'manual')",[]).unwrap();
    db.execute("INSERT INTO todo_events(sequence,operation_id,todo_id,action,occurred_at_ms,request_json,after_json) VALUES(7,'history','todo','create',1,'{}','{}')",[]).unwrap();
    if version >= 2 {
        db.execute("INSERT INTO sources(id,fingerprint,kind,raw_text,imported_at_ms,anchor_at_ms,time_zone,succeeded_run_id) VALUES('source','fingerprint','text','synthetic source',1,1,'UTC','run')",[]).unwrap();
        db.execute("INSERT INTO runs(id,source_id,kind,status,snapshot_json,input_json,created_at_ms,finished_at_ms) VALUES('run','source','extract','succeeded','{}','{}',1,2)",[]).unwrap();
        db.execute("INSERT INTO candidates(id,source_id,run_id,ordinal,status,version,fields_json,evidence,warnings_json,unresolved) VALUES('candidate','source','run',1,'pending',1,?1,'synthetic source','[]',0)",[serde_json::to_string(&input()).unwrap()]).unwrap();
    }
    if version >= 3 {
        db.execute("INSERT INTO agent_runs(rowid,id,agent_id,purpose,status,snapshot_json,input_json,result_json,created_at_ms,finished_at_ms) VALUES(42,'old','organizer','role_trial','succeeded','{}',?1,'[]',1,2)",[serde_json::to_string(&TextInput{text:"synthetic source".into(),source_at_ms:None,time_zone:"UTC".into()}).unwrap()]).unwrap();
    }
    (f, db)
}
fn raw_upgrade(
    f: &Fixture,
    db: &mut Connection,
    fault: McpMigrationFault,
) -> Result<McpSchemaUpgrade> {
    let root = fs::canonicalize(f.0.join("workspace")).unwrap();
    let mut identity = DatabaseIdentity::capture(&root, &File::open(&root).unwrap())?;
    upgrade_database(
        db,
        &mut identity,
        &File::open(root.join("backups")).unwrap(),
        fault,
    )
}
fn version(db: &Connection) -> i64 {
    db.pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap()
}
fn definitions(db: &Connection) -> Vec<(String, String, String)> {
    db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' ORDER BY type,name").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().collect::<std::result::Result<_,_>>().unwrap()
}
fn records(db: &Connection) -> BTreeMap<String, (Vec<String>, Vec<Vec<Value>>)> {
    let tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
    tables
        .into_iter()
        .map(|table| {
            let mut stmt = db
                .prepare(&format!(
                    "SELECT rowid,* FROM \"{}\" ORDER BY rowid",
                    table.replace('"', "\"\"")
                ))
                .unwrap();
            let columns = stmt
                .column_names()
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>();
            let n = columns.len();
            let rows = stmt
                .query_map([], |r| {
                    (0..n)
                        .map(|i| r.get(i))
                        .collect::<std::result::Result<Vec<Value>, _>>()
                })
                .unwrap()
                .collect::<std::result::Result<Vec<_>, _>>()
                .unwrap();
            (table, (columns, rows))
        })
        .collect()
}
fn assert_preserved(db: &Connection, before: &BTreeMap<String, (Vec<String>, Vec<Vec<Value>>)>) {
    for (table, (columns, expected)) in before {
        let fields = columns
            .iter()
            .map(|s| format!("\"{}\"", s.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(",");
        let mut stmt = db
            .prepare(&format!(
                "SELECT {fields} FROM \"{}\" ORDER BY rowid",
                table.replace('"', "\"\"")
            ))
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                (0..columns.len())
                    .map(|i| r.get(i))
                    .collect::<std::result::Result<Vec<Value>, _>>()
            })
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(&rows, expected, "table {table}");
    }
}
fn server(s: &AppStore) -> McpServerInput {
    McpServerInput{id:None,expected_revision:s.mcp_configuration().unwrap().revision,server:serde_json::from_value(json!({"name":"synthetic service","transport":"stdio","enabled":true,"command":"/synthetic/never-executed","args":[],"cwd":null,"env":[],"connectTimeoutMs":10000,"toolTimeoutMs":30000})).unwrap()}
}
fn catalog() -> McpProbeCatalog {
    McpProbeCatalog {
        catalog_sha256: None,
        tools: vec![McpProbeTool {
            name: "synthetic_echo".into(),
            schema_sha256: "a".repeat(64),
        }],
    }
}
#[test]
fn mcp_schema_real_v1_v2_v3_upgrade_preserves_rows_rowids_indexes_and_wal_backup() {
    for prior in [1, 2, 3] {
        let (f, mut db) = legacy(prior);
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
            .unwrap();
        db.execute(
            "UPDATE todos SET title='committed-only-in-wal' WHERE id='todo'",
            [],
        )
        .unwrap();
        assert!(
            f.0.join("workspace/data/sidekick.sqlite-wal")
                .metadata()
                .unwrap()
                .len()
                > 32
        );
        let before = records(&db);
        let indexes = definitions(&db)
            .into_iter()
            .filter(|r| r.0 == "index")
            .collect::<Vec<_>>();
        let result = raw_upgrade(&f, &mut db, McpMigrationFault::None).unwrap();
        assert_eq!((result.from_version, result.to_version), (prior as i64, 4));
        assert_eq!(version(&db), 4);
        assert_preserved(&db, &before);
        let after = definitions(&db);
        assert!(indexes.iter().all(|i| after.contains(i)));
        let path = f.0.join("workspace").join(result.backup.unwrap());
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o7777, 0o600);
        assert_eq!(fs::metadata(&path).unwrap().nlink(), 1);
        let saved = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(version(&saved), prior as i64);
        assert_eq!(records(&saved), before);
        assert_eq!(
            saved
                .query_row("SELECT title FROM todos", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "committed-only-in-wal"
        );
        let count = fs::read_dir(f.0.join("workspace/backups")).unwrap().count();
        assert!(raw_upgrade(&f, &mut db, McpMigrationFault::None)
            .unwrap()
            .backup
            .is_none());
        assert_eq!(
            fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
            count
        );
    }
}
#[test]
fn mcp_schema_copy_and_ddl_failures_rollback_full_chain_and_keep_verified_backup() {
    for prior in [1, 2, 3] {
        for fault in [McpMigrationFault::Ddl, McpMigrationFault::Copy] {
            let (f, mut db) = legacy(prior);
            let before = records(&db);
            let schema = definitions(&db);
            assert_eq!(
                raw_upgrade(&f, &mut db, fault).unwrap_err().code,
                "MCP_MIGRATION_UNCERTAIN"
            );
            assert_eq!(version(&db), prior as i64);
            assert_eq!(definitions(&db), schema);
            assert_eq!(records(&db), before);
            assert_eq!(
                db.pragma_query_value(None, "application_id", |r| r.get::<_, i64>(0))
                    .unwrap(),
                APPLICATION_ID
            );
            let backup = fs::read_dir(f.0.join("workspace/backups"))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            let saved =
                Connection::open_with_flags(backup, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
            assert_eq!(version(&saved), prior as i64);
            assert_eq!(records(&saved), before);
        }
    }
}
#[test]
fn mcp_schema_backup_copy_or_sync_failure_never_runs_ddl() {
    for fault in [McpMigrationFault::BackupCopy, McpMigrationFault::BackupSync] {
        let (f, mut db) = legacy(3);
        let before = records(&db);
        let schema = definitions(&db);
        assert_eq!(
            raw_upgrade(&f, &mut db, fault).unwrap_err().code,
            "MCP_BACKUP_FAILED"
        );
        assert_eq!(version(&db), 3);
        assert_eq!(definitions(&db), schema);
        assert_eq!(records(&db), before);
        assert_eq!(
            fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
            1
        );
    }
}
#[test]
fn mcp_schema_unknown_rebuilt_table_extensions_and_inbound_fks_are_rejected_before_backup() {
    for prior in [1, 3] {
        for mode in [
            "index",
            "index-definition",
            "column",
            "trigger",
            "view",
            "CASCADE",
            "SET NULL",
            "NO ACTION",
        ] {
            let (f, mut db) = legacy(prior);
            let table = if prior == 1 {
                "todo_events"
            } else {
                "agent_runs"
            };
            let key = if prior == 1 { "sequence" } else { "id" };
            match mode {"index"=>db.execute_batch(&format!("CREATE INDEX unknown_extra ON {table}({key});")).unwrap(),"index-definition"=>db.execute_batch(if prior==1{"DROP INDEX todo_events_item; CREATE INDEX todo_events_item ON todo_events(action);"}else{"DROP INDEX agent_runs_role; CREATE INDEX agent_runs_role ON agent_runs(purpose);"}).unwrap(),"column"=>db.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN private_extension TEXT DEFAULT 'preserve';")).unwrap(),"trigger"=>db.execute_batch(&format!("CREATE TRIGGER unknown_extra AFTER INSERT ON {table} BEGIN SELECT 1; END;")).unwrap(),"view"=>db.execute_batch(&format!("CREATE VIEW unknown_extra AS SELECT * FROM {table};")).unwrap(),action=>{db.execute_batch(&format!("CREATE TABLE extension(child TEXT PRIMARY KEY, parent REFERENCES {table}({key}) ON DELETE {action});")).unwrap();let parent=if prior==1{Value::Integer(7)}else{Value::Text("old".into())};db.execute("INSERT INTO extension VALUES('preserve-child',?1)",[parent]).unwrap();}}
            let before = records(&db);
            let schema = definitions(&db);
            assert_eq!(
                raw_upgrade(&f, &mut db, McpMigrationFault::None)
                    .unwrap_err()
                    .code,
                "MCP_SCHEMA_UNSUPPORTED",
                "{prior} {mode}"
            );
            assert_eq!(version(&db), prior as i64);
            assert_eq!(definitions(&db), schema);
            assert_eq!(records(&db), before);
            assert_eq!(
                fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
                0
            );
        }
    }
}
#[test]
fn mcp_schema_default_open_stays_v3_and_commit_response_loss_requires_reopen() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let saved = s.save_mcp_server(server(&s)).unwrap();
    let id = saved.server_id.unwrap();
    let revision = saved.configuration.revision;
    assert_eq!(version(s.db().unwrap()), 3);
    assert_eq!(
        s.begin_mcp_probe(&id, &revision).unwrap_err().code,
        "MCP_SCHEMA_REQUIRED"
    );
    s.mcp_migration_fault = Some(McpMigrationFault::AfterCommit);
    assert_eq!(
        s.upgrade_mcp_storage().unwrap_err().code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    assert_eq!(version(s.db().unwrap()), 4);
    assert_eq!(
        s.mcp_configuration().unwrap_err().code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    assert_eq!(
        s.begin_mcp_probe(&id, &revision).unwrap_err().code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    assert_eq!(
        s.upgrade_mcp_storage().unwrap_err().code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    drop(s);
    let mut s = f.store();
    assert_eq!(version(s.db().unwrap()), 4);
    assert!(s.upgrade_mcp_storage().unwrap().backup.is_none());
    let probe = s.begin_mcp_probe(&id, &revision).unwrap();
    assert_eq!(probe.agent_id, None);
    assert_eq!(probe.purpose, "mcp_probe");
}
#[test]
fn mcp_schema_probe_results_and_role_trial_are_separate_and_do_not_write_business_tables() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.upgrade_mcp_storage().unwrap();
    let saved = s.save_mcp_server(server(&s)).unwrap();
    let first = saved.server_id.unwrap();
    let rev = saved.configuration.revision;
    let probe = s.begin_mcp_probe(&first, &rev).unwrap();
    assert_eq!(s.agent_run(&probe.id).unwrap_err().code, "NOT_FOUND");
    assert_eq!(
        s.finish_agent_trial_error(&probe.id, "SYNTHETIC")
            .unwrap_err()
            .code,
        "NOT_FOUND"
    );
    assert_eq!(
        s.cancel_agent_trial(&probe.id).unwrap_err().code,
        "NOT_FOUND"
    );
    s.interrupt_agent_trials(None).unwrap();
    assert_eq!(s.mcp_probe(&probe.id).unwrap().status, "running");
    let trial = s
        .begin_prepared_agent_trial(
            "organizer",
            TextInput {
                text: "synthetic source".into(),
                source_at_ms: None,
                time_zone: "UTC".into(),
            },
            json!({"fixture":true}),
        )
        .unwrap();
    assert!(s.mcp_probe(&trial.id).is_err());
    assert_eq!(
        s.complete_mcp_probe(&trial.id, catalog()).unwrap_err().code,
        "MCP_PROBE_STOPPED"
    );
    s.complete_agent_trial(&trial.id, vec![]).unwrap();
    assert_eq!(
        s.latest_agent_trial("organizer").unwrap().unwrap().id,
        trial.id
    );
    let done = s.complete_mcp_probe(&probe.id, catalog()).unwrap();
    assert_eq!(done.result, Some(catalog()));
    assert!(s.cancel_mcp_probe(&probe.id).is_err());
    assert!(s
        .fail_mcp_probe(&probe.id, McpProbeFailure::Protocol)
        .is_err());
    assert_eq!(s.mcp_probe(&probe.id).unwrap().status, "succeeded");
    let second = s.save_mcp_server(server(&s)).unwrap();
    let second_id = second.server_id.unwrap();
    let pending = s
        .begin_mcp_probe(&second_id, &second.configuration.revision)
        .unwrap();
    assert_eq!(s.latest_mcp_probe(&first).unwrap().unwrap().id, probe.id);
    assert_eq!(
        s.latest_mcp_probe(&second_id).unwrap().unwrap().id,
        pending.id
    );
    assert!(s.latest_mcp_probe("mcp-missing").unwrap().is_none());
    for table in [
        "sources",
        "candidates",
        "todos",
        "todo_events",
        "tool_calls",
    ] {
        assert_eq!(
            s.db()
                .unwrap()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    let serialized = serde_json::to_string(&done).unwrap();
    for denied in [
        "never-executed",
        "apiKey",
        "environment",
        "apiKeyRef",
        "mcp1:",
    ] {
        assert!(!serialized.contains(denied));
    }
    drop(s);
    let s = f.store();
    assert_eq!(s.mcp_probe(&pending.id).unwrap().status, "interrupted");
    assert_eq!(s.mcp_probe(&probe.id).unwrap().result, Some(catalog()));
    assert_eq!(s.agent_run(&trial.id).unwrap().result.unwrap().len(), 0);
}
#[test]
fn mcp_schema_probe_validation_rejects_invalid_metadata_without_recording_success() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.upgrade_mcp_storage().unwrap();
    let saved = s.save_mcp_server(server(&s)).unwrap();
    let id = saved.server_id.unwrap();
    assert_eq!(
        s.begin_mcp_probe(&id, "old-revision").unwrap_err().code,
        "MCP_VERSION_CONFLICT"
    );
    let p = s
        .begin_mcp_probe(&id, &saved.configuration.revision)
        .unwrap();
    let exact = "界".repeat(85) + "x";
    assert_eq!(exact.len(), 256);
    let mut valid = catalog();
    valid.tools[0].name = exact.clone();
    for hash in [
        "A".repeat(64),
        "a".repeat(63),
        "g".repeat(64),
        "f".repeat(65),
        String::new(),
    ] {
        let mut bad = catalog();
        bad.tools[0].schema_sha256 = hash;
        assert_eq!(
            s.complete_mcp_probe(&p.id, bad).unwrap_err().code,
            "MCP_PROBE_INVALID"
        );
    }
    for name in [exact + "x", String::new(), "bad\0name".into()] {
        let mut bad = catalog();
        bad.tools[0].name = name;
        assert_eq!(
            s.complete_mcp_probe(&p.id, bad).unwrap_err().code,
            "MCP_PROBE_INVALID"
        );
    }
    let mut duplicate = catalog();
    duplicate.tools.push(duplicate.tools[0].clone());
    assert_eq!(
        s.complete_mcp_probe(&p.id, duplicate).unwrap_err().code,
        "MCP_PROBE_INVALID"
    );
    let too_many = McpProbeCatalog {
        catalog_sha256: None,
        tools: (0..65)
            .map(|n| McpProbeTool {
                name: format!("tool{n}"),
                schema_sha256: "a".repeat(64),
            })
            .collect(),
    };
    assert_eq!(
        s.complete_mcp_probe(&p.id, too_many).unwrap_err().code,
        "MCP_PROBE_LIMIT"
    );
    assert_eq!(s.mcp_probe(&p.id).unwrap().status, "running");
    s.complete_mcp_probe(&p.id, valid).unwrap();
}
#[test]
fn mcp_schema_source_aliases_replacements_and_side_file_links_preserve_outside_files() {
    for mode in [
        "database-hard",
        "database-soft",
        "database-replaced",
        "data-replaced",
        "wal-hard",
        "shm-soft",
    ] {
        let (f, mut db) = legacy(3);
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
            .unwrap();
        db.execute("UPDATE todos SET title='synthetic-wal'", [])
            .unwrap();
        let root = fs::canonicalize(f.0.join("workspace")).unwrap();
        let mut identity = DatabaseIdentity::capture(&root, &File::open(&root).unwrap()).unwrap();
        let backup = File::open(root.join("backups")).unwrap();
        let outside = f.0.join("outside-sentinel");
        if mode == "data-replaced" {
            fs::rename(root.join("data"), f.0.join("retained-data")).unwrap();
            fs::create_dir(root.join("data")).unwrap();
            fs::set_permissions(root.join("data"), fs::Permissions::from_mode(0o700)).unwrap();
        } else if mode.starts_with("wal") {
            fs::hard_link(root.join("data/sidekick.sqlite-wal"), &outside).unwrap();
        } else if mode.starts_with("shm") {
            fs::rename(root.join("data/sidekick.sqlite-shm"), &outside).unwrap();
            std::os::unix::fs::symlink(&outside, root.join("data/sidekick.sqlite-shm")).unwrap();
        } else if mode.ends_with("hard") {
            fs::hard_link(root.join("data/sidekick.sqlite"), &outside).unwrap();
        } else {
            fs::rename(root.join("data/sidekick.sqlite"), &outside).unwrap();
            if mode.ends_with("soft") {
                std::os::unix::fs::symlink(&outside, root.join("data/sidekick.sqlite")).unwrap();
            } else {
                fs::copy(&outside, root.join("data/sidekick.sqlite")).unwrap();
            }
        }
        let observed = if mode == "data-replaced" {
            f.0.join("retained-data/sidekick.sqlite")
        } else {
            outside.clone()
        };
        let sentinel = fs::read(&observed).unwrap();
        assert_eq!(
            upgrade_database(&mut db, &mut identity, &backup, McpMigrationFault::None)
                .unwrap_err()
                .code,
            "MCP_DATABASE_CHANGED",
            "{mode}"
        );
        assert_eq!(fs::read(&observed).unwrap(), sentinel);
        assert_eq!(version(&db), 3);
        assert_eq!(fs::read_dir(root.join("backups")).unwrap().count(), 0);
    }
}

#[test]
fn mcp_schema_catalog_encoded_budget_32k_has_independent_exact_and_plus_one_controls() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.upgrade_mcp_storage().unwrap();
    let saved = s.save_mcp_server(server(&s)).unwrap();
    let p = s
        .begin_mcp_probe(&saved.server_id.unwrap(), &saved.configuration.revision)
        .unwrap();
    let mut exact = McpProbeCatalog {
        catalog_sha256: None,
        tools: (0..64)
            .map(|n| McpProbeTool {
                name: format!("T{n:02}{}", "x".repeat(253)),
                schema_sha256: "a".repeat(64),
            })
            .collect(),
    };
    let mut needed = 32 * 1024 - serde_json::to_vec(&exact).unwrap().len();
    for tool in &mut exact.tools {
        let mut bytes = tool.name.as_bytes().to_vec();
        for byte in bytes.iter_mut().skip(3) {
            if needed > 0 {
                *byte = b'"';
                needed -= 1;
            }
        }
        tool.name = String::from_utf8(bytes).unwrap();
    }
    assert_eq!(needed, 0);
    assert_eq!(serde_json::to_vec(&exact).unwrap().len(), 32 * 1024);
    let mut over = exact.clone();
    let name = &mut over
        .tools
        .iter_mut()
        .find(|t| t.name.contains('x'))
        .unwrap()
        .name;
    let at = name.find('x').unwrap();
    name.replace_range(at..at + 1, "\"");
    assert_eq!(serde_json::to_vec(&over).unwrap().len(), 32 * 1024 + 1);
    assert_eq!(
        s.complete_mcp_probe(&p.id, over).unwrap_err().code,
        "MCP_PROBE_LIMIT"
    );
    assert_eq!(s.mcp_probe(&p.id).unwrap().status, "running");
    let result = s.complete_mcp_probe(&p.id, exact).unwrap();
    assert_eq!(result.result.unwrap().tools.len(), 64);
}
#[expect(
    clippy::too_many_arguments,
    reason = "Independent SQL column values form the constraint test matrix"
)]
fn call(
    db: &Connection,
    id: &str,
    owner: Option<&str>,
    agent: Option<&str>,
    state: &str,
    category: Option<&str>,
    summary: Option<&str>,
    finished: Option<i64>,
) -> rusqlite::Result<usize> {
    db.execute("INSERT INTO tool_calls(id,run_id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,response_category,response_summary,created_at_ms,finished_at_ms) VALUES(?1,?2,?3,'model-call','revision',?4,'mcp-synthetic','echo',?4,?5,?6,?7,1,?8)",params![id,owner,agent,"a".repeat(64),state,category,summary,finished])
}
#[test]
fn mcp_schema_tool_ledger_enforces_owner_response_hash_and_byte_constraints() {
    let (f, mut db) = legacy(3);
    raw_upgrade(&f, &mut db, McpMigrationFault::None).unwrap();
    db.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('probe',NULL,'mcp_probe','running','{}','{}',1)",[]).unwrap();
    call(
        &db,
        "business",
        Some("run"),
        None,
        "possibly_sent",
        None,
        None,
        None,
    )
    .unwrap();
    call(
        &db,
        "role",
        None,
        Some("old"),
        "responded",
        Some("tool_error"),
        Some("finite synthetic summary"),
        Some(2),
    )
    .unwrap();
    for (id, run, agent) in [
        ("none", None, None),
        ("both", Some("run"), Some("old")),
        ("missing", Some("missing"), None),
        ("probe", None, Some("probe")),
    ] {
        assert!(
            call(&db, id, run, agent, "possibly_sent", None, None, None).is_err(),
            "{id}"
        );
    }
    assert!(db
        .execute(
            "UPDATE tool_calls SET run_id=NULL,agent_run_id='probe' WHERE id='business'",
            []
        )
        .is_err());
    assert!(db
        .execute(
            "UPDATE agent_runs SET purpose='mcp_probe',agent_id=NULL WHERE id='old'",
            []
        )
        .is_err());
    for (state, category, finished) in [
        ("responded", None, Some(2)),
        ("possibly_sent", Some("success"), None),
        ("unknown", Some("success"), Some(2)),
        ("unknown", None, None),
        ("unknown", None, Some(0)),
    ] {
        assert!(call(
            &db,
            "bad-state",
            Some("run"),
            None,
            state,
            category,
            None,
            finished
        )
        .is_err());
    }
    call(
        &db,
        "unknown",
        Some("run"),
        None,
        "unknown",
        None,
        None,
        Some(2),
    )
    .unwrap();
    assert!(call(
        &db,
        "business",
        Some("run"),
        None,
        "possibly_sent",
        None,
        None,
        None
    )
    .is_err());
    let id = "界".repeat(42) + "xx";
    assert_eq!(id.len(), 128);
    call(
        &db,
        &id,
        Some("run"),
        None,
        "responded",
        Some("success"),
        Some(&"s".repeat(2048)),
        Some(2),
    )
    .unwrap();
    assert!(call(
        &db,
        &(id + "x"),
        Some("run"),
        None,
        "possibly_sent",
        None,
        None,
        None
    )
    .is_err());
    assert!(call(
        &db,
        "summary-over",
        Some("run"),
        None,
        "responded",
        Some("success"),
        Some(&"s".repeat(2049)),
        Some(2)
    )
    .is_err());
    assert!(db
        .execute(
            "UPDATE tool_calls SET arguments_sha256=?1 WHERE id='business'",
            ["A".repeat(64)]
        )
        .is_err());
    assert!(db
        .execute(
            "UPDATE tool_calls SET schema_sha256=?1 WHERE id='business'",
            ["a".repeat(63)]
        )
        .is_err());
    for (role, purpose) in [
        (None, "role_trial"),
        (Some("organizer"), "mcp_probe"),
        (Some("other"), "role_trial"),
        (None, "other"),
    ] {
        assert!(db.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('bad',?1,?2,'running','{}','{}',1)",params![role,purpose]).is_err());
    }
    let columns = db
        .prepare("PRAGMA table_info(tool_calls)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    for forbidden in [
        "arguments_json",
        "api_key",
        "raw_output",
        "stderr",
        "credential_ref",
    ] {
        assert!(!columns.iter().any(|c| c == forbidden));
    }
}
#[test]
fn mcp_schema_default_open_rejects_source_hardlink_before_writing_and_v4_damage_is_not_repaired() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let root = s.root().unwrap();
    drop(s);
    let outside = f.0.join("outside-database");
    fs::hard_link(root.join("data/sidekick.sqlite"), &outside).unwrap();
    let bytes = fs::read(&outside).unwrap();
    assert_eq!(
        AppStore::open(f.0.join("app")).err().unwrap().code,
        "MCP_DATABASE_CHANGED"
    );
    assert_eq!(fs::read(&outside).unwrap(), bytes);
    fs::remove_file(outside).unwrap();
    let mut s = f.store();
    s.upgrade_mcp_storage().unwrap();
    drop(s);
    let db = Connection::open(root.join("data/sidekick.sqlite")).unwrap();
    db.execute_batch("DROP TRIGGER tool_calls_owner_update;")
        .unwrap();
    drop(db);
    let bytes = fs::read(root.join("data/sidekick.sqlite")).unwrap();
    assert_eq!(
        AppStore::open(f.0.join("app")).err().unwrap().code,
        "MCP_SCHEMA_UNSUPPORTED"
    );
    assert_eq!(fs::read(root.join("data/sidekick.sqlite")).unwrap(), bytes);
}

#[test]
fn mcp_schema_post_commit_identity_failure_is_unknown_and_blocks_current_handle() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let saved = s.save_mcp_server(server(&s)).unwrap();
    s.mcp_migration_fault = Some(McpMigrationFault::AfterCommitPath);
    assert_eq!(
        s.upgrade_mcp_storage().unwrap_err().code,
        "MCP_MIGRATION_UNCERTAIN"
    );
    assert_eq!(
        s.begin_mcp_probe(&saved.server_id.unwrap(), &saved.configuration.revision)
            .unwrap_err()
            .code,
        "MCP_MIGRATION_UNCERTAIN"
    );
}

#[test]
fn mcp_schema_private_source_and_side_permissions_are_rejected_without_repair() {
    for name in [
        "root",
        "data",
        "sidekick.sqlite",
        "sidekick.sqlite-wal",
        "sidekick.sqlite-shm",
    ] {
        let (f, mut db) = legacy(3);
        db.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
        db.execute("UPDATE todos SET title='synthetic-private'", [])
            .unwrap();
        let root = fs::canonicalize(f.0.join("workspace")).unwrap();
        let path = match name {
            "root" => root.clone(),
            "data" => root.join("data"),
            file => root.join("data").join(file),
        };
        let mode = if name == "root" || name == "data" {
            0o755
        } else {
            0o644
        };
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        let before = records(&db);
        assert_eq!(
            raw_upgrade(&f, &mut db, McpMigrationFault::None)
                .unwrap_err()
                .code,
            "MCP_DATABASE_CHANGED",
            "{name}"
        );
        assert_eq!(records(&db), before);
        assert_eq!(version(&db), 3);
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o7777, mode);
        assert_eq!(fs::read_dir(root.join("backups")).unwrap().count(), 0);
    }
}
#[test]
fn mcp_schema_backup_collision_and_unknown_source_never_overwrite_or_migrate() {
    let (f, mut db) = legacy(3);
    let collision =
        f.0.join("workspace/backups/before-schema-4-synthetic-collision.sqlite");
    fs::write(&collision, b"retain-existing-backup").unwrap();
    fs::set_permissions(&collision, fs::Permissions::from_mode(0o600)).unwrap();
    let before = records(&db);
    assert_eq!(
        raw_upgrade(&f, &mut db, McpMigrationFault::BackupCollision)
            .unwrap_err()
            .code,
        "MCP_BACKUP_FAILED"
    );
    assert_eq!(fs::read(&collision).unwrap(), b"retain-existing-backup");
    assert_eq!(records(&db), before);
    assert_eq!(version(&db), 3);
    db.pragma_update(None, "application_id", 0).unwrap();
    assert_eq!(
        raw_upgrade(&f, &mut db, McpMigrationFault::None)
            .unwrap_err()
            .code,
        "MCP_SCHEMA_UNSUPPORTED"
    );
    db.pragma_update(None, "application_id", APPLICATION_ID)
        .unwrap();
    db.pragma_update(None, "user_version", 5).unwrap();
    assert_eq!(
        raw_upgrade(&f, &mut db, McpMigrationFault::None)
            .unwrap_err()
            .code,
        "SCHEMA_TOO_NEW"
    );
    assert_eq!(version(&db), 5);
    assert_eq!(
        fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
        1
    );
}
#[test]
fn mcp_schema_corrupt_probe_error_cannot_escape_the_closed_metadata_contract() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.upgrade_mcp_storage().unwrap();
    let saved = s.save_mcp_server(server(&s)).unwrap();
    let probe = s
        .begin_mcp_probe(&saved.server_id.unwrap(), &saved.configuration.revision)
        .unwrap();
    s.fail_mcp_probe(&probe.id, McpProbeFailure::Protocol)
        .unwrap();
    s.db()
        .unwrap()
        .execute(
            "UPDATE agent_runs SET error_code='synthetic-private-marker' WHERE id=?1",
            [&probe.id],
        )
        .unwrap();
    assert_eq!(
        s.mcp_probe(&probe.id).unwrap_err().code,
        "MCP_PROBE_INVALID"
    );
}

#[test]
fn mcp_schema_sqlite_like_user_table_name_cannot_hide_cascading_dependencies() {
    for prior in [1, 3] {
        for action in ["CASCADE", "SET NULL", "NO ACTION"] {
            let (f, mut db) = legacy(prior);
            let (table, key, parent) = if prior == 1 {
                ("todo_events", "sequence", Value::Integer(7))
            } else {
                ("agent_runs", "id", Value::Text("old".into()))
            };
            db.execute_batch(&format!("CREATE TABLE sqliteXchild(child TEXT PRIMARY KEY,parent REFERENCES {table}({key}) ON DELETE {action});")).unwrap();
            db.execute(
                "INSERT INTO sqliteXchild VALUES('keep-child',?1)",
                [&parent],
            )
            .unwrap();
            assert_eq!(
                db.query_row("SELECT count(*) FROM sqliteXchild", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            let before = definitions(&db);
            let result = raw_upgrade(&f, &mut db, McpMigrationFault::None);
            assert_eq!(
                db.query_row("SELECT count(*) FROM sqliteXchild", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1,
                "{prior} {action} must retain the child, migration result: {result:?}"
            );
            assert_eq!(
                db.query_row("SELECT parent FROM sqliteXchild", [], |r| r
                    .get::<_, Value>(0))
                    .unwrap(),
                parent
            );
            assert_eq!(result.unwrap_err().code, "MCP_SCHEMA_UNSUPPORTED");
            assert_eq!(version(&db), prior as i64);
            assert_eq!(definitions(&db), before);
            assert_eq!(
                fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
                0
            );
        }
    }
}
#[test]
fn mcp_schema_missing_required_table_or_index_is_rejected_before_backup_or_ddl() {
    for sql in [
        "DROP TABLE ingestion_operations;",
        "DROP INDEX todos_status;",
    ] {
        let (f, mut db) = legacy(3);
        db.execute_batch(sql).unwrap();
        let before = records(&db);
        let schema = definitions(&db);
        assert_eq!(
            raw_upgrade(&f, &mut db, McpMigrationFault::None)
                .unwrap_err()
                .code,
            "MCP_SCHEMA_UNSUPPORTED"
        );
        assert_eq!(version(&db), 3);
        assert_eq!(definitions(&db), schema);
        assert_eq!(records(&db), before);
        assert_eq!(
            fs::read_dir(f.0.join("workspace/backups")).unwrap().count(),
            0
        );
    }
}
#[test]
fn mcp_schema_hash_columns_reject_nul_suffixes_and_blob_bindings_on_insert_and_update() {
    let (f, mut db) = legacy(3);
    raw_upgrade(&f, &mut db, McpMigrationFault::None).unwrap();
    call(
        &db,
        "known",
        Some("run"),
        None,
        "possibly_sent",
        None,
        None,
        None,
    )
    .unwrap();
    for column in ["schema_sha256", "arguments_sha256"] {
        for invalid in [
            Value::Text("a".repeat(64) + "\0suffix"),
            Value::Text("a".repeat(63) + "\0"),
            Value::Blob(vec![b'a'; 64]),
        ] {
            let other = if column == "schema_sha256" {
                "arguments_sha256"
            } else {
                "schema_sha256"
            };
            assert!(db.execute(&format!("INSERT INTO tool_calls(id,run_id,model_call_id,configuration_revision,server_id,tool_name,{column},{other},send_state,created_at_ms) VALUES('invalid','run','model','revision','mcp-fixture','echo',?1,?2,'possibly_sent',1)"),params![&invalid,"a".repeat(64)]).is_err(),"INSERT {column} must reject non-text or non-64-byte digest");
            assert!(
                db.execute(
                    &format!("UPDATE tool_calls SET {column}=?1 WHERE id='known'"),
                    [invalid]
                )
                .is_err(),
                "UPDATE {column}"
            );
            assert_eq!(
                db.query_row(
                    &format!("SELECT {column} FROM tool_calls WHERE id='known'"),
                    [],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                "a".repeat(64)
            );
        }
    }
}

#[test]
fn mcp_schema_three_migration_version_guard_refuses_v4_without_downgrading() {
    let (f, mut db) = legacy(3);
    raw_upgrade(&f, &mut db, McpMigrationFault::None).unwrap();
    let schema = definitions(&db);
    let before = records(&db);
    assert!(migrations().to_latest(&mut db).is_err());
    assert_eq!(version(&db), 4);
    assert_eq!(definitions(&db), schema);
    assert_eq!(records(&db), before);
}
