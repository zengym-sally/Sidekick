#!/usr/bin/env python3
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import time

OLD_HEAD = 'c783c8560cde2269eed721ee206d53b0f7e022cf'
TEST_NAME = 'today_legacy_original_v4_guard_rejects_v5_without_writes'
SNIPPET = r'''

#[test]
fn today_legacy_original_v4_guard_rejects_v5_without_writes() {
    use rusqlite::types::Value;
    use std::collections::BTreeMap;
    fn snapshot(path: &Path) -> (Vec<u8>, i64, i64, Vec<(String,String,String)>, BTreeMap<String,Vec<Vec<Value>>>) {
        let bytes=fs::read(path).unwrap();
        let db=Connection::open_with_flags(path,OpenFlags::SQLITE_OPEN_READ_ONLY|OpenFlags::SQLITE_OPEN_NOFOLLOW).unwrap();
        let version=db.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap();
        let app=db.pragma_query_value(None,"application_id",|r|r.get::<_,i64>(0)).unwrap();
        let schema=db.prepare("SELECT type,name,COALESCE(sql,'') FROM sqlite_master ORDER BY type,name").unwrap().query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().map(|r|r.unwrap()).collect::<Vec<_>>();
        let tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().map(|r|r.unwrap()).collect::<Vec<_>>();
        let rows=tables.into_iter().map(|table|{let mut query=db.prepare(&format!("SELECT rowid,* FROM \"{}\" ORDER BY rowid",table.replace('"',"\"\""))).unwrap();let width=query.column_count();let rows=query.query_map([],|r|(0..width).map(|i|r.get(i)).collect::<std::result::Result<Vec<Value>,_>>()).unwrap().map(|r|r.unwrap()).collect();(table,rows)}).collect();
        (bytes,version,app,schema,rows)
    }
    let fixture=Fixture::new();
    let root=fixture.0.join("workspace");
    let mut store=fixture.store();
    store.initialize(Some(root.clone()),"UTC").unwrap();
    store.upgrade_mcp_storage().unwrap();
    store.create(input(),"legacy-guard-todo").unwrap();
    store.db().unwrap().execute("INSERT INTO agent_runs(rowid,id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(42,'legacy-role','organizer','role_trial','succeeded','{}','{}',1)",[]).unwrap();
    store.db().unwrap().execute("INSERT INTO tool_calls(rowid,id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,response_category,created_at_ms,finished_at_ms) VALUES(71,'legacy-call','legacy-role','model','revision',?1,'server','tool',?1,'responded','success',1,2)",["a".repeat(64)]).unwrap();
    drop(store);
    let path=root.join("data/sidekick.sqlite");
    let mut db=Connection::open_with_flags(&path,OpenFlags::SQLITE_OPEN_READ_WRITE|OpenFlags::SQLITE_OPEN_NOFOLLOW).unwrap();
    db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;").unwrap();
    let before4=snapshot(&path);
    assert_eq!(before4.1,4);
    validate_existing_database(&path,false).unwrap();
    assert_eq!(snapshot(&path),before4,"original v4 positive changed database");
    println!("LEGACY_TODAY_GUARD_V4_POSITIVE version=4 main_bytes_schema_rows_rowids_unchanged=true");
    let sql=fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/legacy-today-005.sql")).unwrap();
    db.pragma_update(None,"foreign_keys",false).unwrap();
    let tx=db.transaction().unwrap();
    tx.execute_batch(&sql).unwrap();
    tx.pragma_update(None,"user_version",5).unwrap();
    assert!(!tx.prepare("PRAGMA foreign_key_check").unwrap().exists([]).unwrap());
    tx.commit().unwrap();
    db.pragma_update(None,"foreign_keys",true).unwrap();
    db.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES('new-today','advisor','today_advice','running','{}','{}',2)",[]).unwrap();
    assert_eq!(db.query_row("SELECT rowid FROM agent_runs WHERE id='legacy-role'",[],|r|r.get::<_,i64>(0)).unwrap(),42);
    assert_eq!(db.query_row("SELECT rowid FROM tool_calls WHERE id='legacy-call'",[],|r|r.get::<_,i64>(0)).unwrap(),71);
    let before5=snapshot(&path);
    assert_eq!(before5.1,5);
    assert_eq!(validate_existing_database(&path,false).unwrap_err().code,"SCHEMA_TOO_NEW");
    assert_eq!(snapshot(&path),before5,"original v4 guard changed v5 database");
    println!("LEGACY_TODAY_GUARD_V5_NEGATIVE code=SCHEMA_TOO_NEW main_bytes_schema_rows_rowids_unchanged=true");
}
'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(path, *args):
    return subprocess.check_output(['git', '-C', str(path), *args])


def main():
    parser = argparse.ArgumentParser(description='Probe the unmodified c783 v4 guard in a separately prepared baseline clone.')
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    checkout, source, output = args.checkout.resolve(), args.source_root.resolve(), args.output.resolve()
    if checkout == source or source in checkout.parents:
        raise SystemExit('Use an isolated baseline clone outside the current source checkout.')
    if git(checkout, 'rev-parse', 'HEAD').decode().strip() != OLD_HEAD:
        raise SystemExit('The baseline checkout must be exact c783.')
    production = checkout / 'src-tauri/src/store/local_store.rs'
    expected_production = git(checkout, 'show', OLD_HEAD + ':src-tauri/src/store/local_store.rs')
    if production.read_bytes() != expected_production:
        raise SystemExit('Original local_store.rs differs from the baseline commit.')
    tests = checkout / 'src-tauri/src/store/local_store_tests.rs'
    expected_tests = git(checkout, 'show', OLD_HEAD + ':src-tauri/src/store/local_store_tests.rs')
    overlay = expected_tests + SNIPPET.encode()
    if tests.read_bytes() not in (expected_tests, overlay):
        raise SystemExit('The baseline test file contains unknown edits.')
    migration = source / 'src-tauri/migrations/005_today_advice.sql'
    sql = migration.read_bytes()
    sql_copy = checkout / 'tests/fixtures/legacy-today-005.sql'
    if sql_copy.exists() and sql_copy.read_bytes() != sql:
        raise SystemExit('The owned SQL overlay differs; retain and inspect it.')
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'legacy-guard.log').exists() or (output / 'legacy-guard.json').exists():
        raise SystemExit('Use a fresh output directory; existing evidence must remain unchanged.')
    tests.write_bytes(overlay)
    sql_copy.write_bytes(sql)
    command = ['cargo', 'test', '--manifest-path', str(checkout / 'src-tauri/Cargo.toml'), '--lib', TEST_NAME, '--', '--test-threads=1', '--nocapture']
    start = time.monotonic()
    log = output / 'legacy-guard.log'
    with log.open('wb') as stream:
        result = subprocess.run(command, cwd=checkout, stdout=stream, stderr=subprocess.STDOUT)
    raw = log.read_bytes()
    report = {
        'asOfUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'baseHead': OLD_HEAD,
        'command': command,
        'exitCode': result.returncode,
        'seconds': round(time.monotonic() - start, 3),
        'unmodifiedProductionSha256': sha(expected_production),
        'productionBeforeAfterExact': production.read_bytes() == expected_production,
        'input005Sha256': sha(sql),
        'testOverlaySha256': sha(overlay),
        'runnerSha256': sha(Path(__file__).read_bytes()),
        'positiveMarker': b'LEGACY_TODAY_GUARD_V4_POSITIVE' in raw,
        'negativeMarker': b'LEGACY_TODAY_GUARD_V5_NEGATIVE' in raw,
        'executedOnePassingTest': b'1 passed; 0 failed' in raw,
        'logSha256': sha(raw),
        'scope': 'unmodified original v4 guard; actual SQLite synthetic v4/v5; no GUI, model, credentials or real root',
        'limitations': 'Does not verify the current v5 upgrader, native installed application or full npm check. Independent reviewer must inspect the assertions and raw output.',
    }
    (output / 'legacy-guard.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))
    passed = result.returncode == 0 and report['productionBeforeAfterExact'] and report['positiveMarker'] and report['negativeMarker'] and report['executedOnePassingTest']
    raise SystemExit(0 if passed else 1)


if __name__ == '__main__':
    main()
