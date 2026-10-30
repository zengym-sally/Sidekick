use super::*;

fn text() -> TextInput {
    TextInput {
        text: "我整理清单，周五提交。林川负责方案，我今天跟进。".into(),
        source_at_ms: Some(1793239200000),
        time_zone: "Asia/Shanghai".into(),
    }
}
fn draft(title: &str) -> CandidateDraft {
    CandidateDraft {
        fields: TodoInput {
            title: title.into(),
            kind: "action".into(),
            owner: "我".into(),
            priority: "medium".into(),
            due: None,
            followup: None,
            tags: vec![],
        },
        evidence: "我整理清单，周五提交。".into(),
        due_expression: Some("周五".into()),
        followup_expression: None,
        warnings: vec![],
        unresolved: false,
    }
}
fn ready(store: &mut AppStore) -> ImportBatch {
    let prepared = store
        .begin_import(
            text(),
            json!({"modelId":"fixture","apiModelId":"deployment"}),
            false,
        )
        .unwrap();
    store
        .publish_candidates(&prepared.run.unwrap().id, vec![draft("整理清单")])
        .unwrap()
}
fn choice(candidate: &Candidate) -> SignChoice {
    SignChoice {
        candidate_id: candidate.id.clone(),
        expected_version: candidate.version,
        fields: candidate.draft.fields.clone(),
        time_reviewed: true,
        target: None,
    }
}

#[test]
fn s2_unsigned_candidates_never_create_todos_and_signing_replays_current_state() {
    let fixture = crate::local_store::tests::Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let batch = ready(&mut store);
    assert_eq!(store.list().unwrap().len(), 0);
    let item = choice(&batch.candidates[0]);
    let accepted = store
        .sign_candidates(vec![item.clone()], "sign-one")
        .unwrap();
    assert_eq!(accepted.len(), 1);
    assert_eq!(accepted[0].source, "signed_ai");
    let deleted = store
        .delete(&accepted[0].id, accepted[0].version, "delete-signed")
        .unwrap();
    assert_eq!(
        store.sign_candidates(vec![item], "sign-one").unwrap(),
        vec![deleted]
    );
    assert_eq!(store.list().unwrap().len(), 1);
}

#[test]
fn s2_rejected_and_zero_result_sources_do_not_rerun() {
    let fixture = crate::local_store::tests::Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let batch = ready(&mut store);
    let c = &batch.candidates[0];
    store
        .discard_candidate(&c.id, c.version, "discard-one")
        .unwrap();
    let duplicate = store.begin_import(text(), json!({}), true).unwrap();
    assert!(!duplicate.started);
    assert_eq!(duplicate.candidates[0].status, "discarded");
    let mut another = text();
    another.text = "只有讨论，没有待办".into();
    let run = store
        .begin_import(another.clone(), json!({}), false)
        .unwrap()
        .run
        .unwrap();
    store.publish_candidates(&run.id, vec![]).unwrap();
    assert!(
        !store
            .begin_import(another, json!({}), true)
            .unwrap()
            .started
    );
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn s2_cancel_and_result_have_one_transaction_winner() {
    let fixture = crate::local_store::tests::Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let run = store
        .begin_import(text(), json!({}), false)
        .unwrap()
        .run
        .unwrap();
    store.cancel_run(&run.id).unwrap();
    assert!(store
        .publish_candidates(&run.id, vec![draft("迟到")])
        .is_err());
    assert!(store
        .batch(&run.source_id.clone().unwrap())
        .unwrap()
        .candidates
        .is_empty());
    let retry = store
        .begin_import(text(), json!({}), true)
        .unwrap()
        .run
        .unwrap();
    store
        .publish_candidates(&retry.id, vec![draft("有效")])
        .unwrap();
    assert_eq!(store.cancel_run(&retry.id).unwrap().status, "succeeded");
}

#[test]
fn s2_batch_second_failure_rolls_back_every_todo_candidate_and_operation() {
    let fixture = crate::local_store::tests::Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let run = store
        .begin_import(text(), json!({}), false)
        .unwrap()
        .run
        .unwrap();
    let batch = store
        .publish_candidates(&run.id, vec![draft("第一条"), draft("失败样本")])
        .unwrap();
    let selected = batch.candidates.iter().map(choice).collect::<Vec<_>>();
    store.db().unwrap().execute_batch("CREATE TRIGGER s2_fail BEFORE INSERT ON todos WHEN (SELECT count(*) FROM todos)>=1 BEGIN SELECT RAISE(ABORT,'synthetic'); END;").unwrap();
    assert!(store
        .sign_candidates(selected.clone(), "sign-batch")
        .is_err());
    assert!(store.list().unwrap().is_empty());
    assert!(store
        .batch(&batch.source.id)
        .unwrap()
        .candidates
        .iter()
        .all(|c| c.status == "pending" && c.version == 1));
    store
        .db()
        .unwrap()
        .execute_batch("DROP TRIGGER s2_fail")
        .unwrap();
    assert_eq!(
        store.sign_candidates(selected, "sign-batch").unwrap().len(),
        2
    );
}

#[test]
fn s2_multiple_links_use_the_initial_target_version_without_overwriting_fields() {
    let fixture = crate::local_store::tests::Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let todo = store
        .create(crate::local_store::tests::input(), "manual-target")
        .unwrap();
    let run = store
        .begin_import(text(), json!({}), false)
        .unwrap()
        .run
        .unwrap();
    let batch = store
        .publish_candidates(&run.id, vec![draft("关联一"), draft("关联二")])
        .unwrap();
    let selected = batch
        .candidates
        .iter()
        .map(|c| {
            let mut v = choice(c);
            v.target = Some(LinkTarget {
                id: todo.id.clone(),
                expected_version: todo.version,
            });
            v
        })
        .collect();
    let result = store.sign_candidates(selected, "two-links").unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].fields, todo.fields);
    assert_eq!(result[0].status, todo.status);
    assert_eq!(result[0].version, todo.version + 2);
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(store.history(&todo.id).unwrap().len(), 3);
}

#[test]
fn s2_revision_is_only_a_preview_and_old_candidate_versions_cannot_apply() {
    let fixture = crate::local_store::tests::Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let batch = ready(&mut store);
    let c = &batch.candidates[0];
    let run = store
        .begin_revision(&c.id, c.version, "改为准备检查".into(), json!({}))
        .unwrap();
    store.publish_revision(&run.id, draft("准备检查")).unwrap();
    assert_eq!(
        store.candidate(&c.id).unwrap().draft.fields.title,
        "整理清单"
    );
    let changed = store
        .apply_preview(&run.id, c.version, "apply-preview")
        .unwrap();
    assert_eq!(changed.draft.fields.title, "准备检查");
    assert!(store
        .apply_preview(&run.id, c.version, "another-apply")
        .is_err());
    assert!(store.list().unwrap().is_empty());
}

fn legacy_root(f: &crate::local_store::tests::Fixture) -> (PathBuf, Connection, Todo) {
    let mut store = f.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let root = store.root().unwrap();
    drop(store);
    let path = root.join("data/sidekick.sqlite");
    fs::rename(&path, root.join("data/unused-v2.sqlite")).unwrap();
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .unwrap();
    let mut db = Connection::open(&path).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA foreign_keys=ON;")
        .unwrap();
    Migrations::new(vec![M::up(include_str!("../migrations/001_todos.sql"))])
        .to_latest(&mut db)
        .unwrap();
    let fields = TodoInput {
        title: "v1合成事项".into(),
        kind: "action".into(),
        owner: "我".into(),
        priority: "medium".into(),
        due: None,
        followup: None,
        tags: vec![],
    };
    let todo = Todo {
        id: "legacy-item".into(),
        fields: fields.clone(),
        status: "open".into(),
        created_at_ms: 100,
        updated_at_ms: 100,
        completed_at_ms: None,
        deleted_at_ms: None,
        version: 1,
        source: "manual".into(),
    };
    db.execute("INSERT INTO todos(id,title,kind,owner,priority,status,tags_json,created_at_ms,updated_at_ms,version,source) VALUES('legacy-item','v1合成事项','action','我','medium','open','[]',100,100,1,'manual')",[]).unwrap();
    db.execute("INSERT INTO todo_events(sequence,operation_id,todo_id,action,occurred_at_ms,request_json,after_json) VALUES(7,'legacy-operation','legacy-item','create',100,?1,?2)",params![json!({"action":"create","input":fields}).to_string(),serde_json::to_string(&todo).unwrap()]).unwrap();
    (root, db, todo)
}

#[test]
fn s2_v1_wal_migration_backs_up_and_preserves_history_and_replay() {
    let f = crate::local_store::tests::Fixture::new();
    let (root, _legacy, todo) = legacy_root(&f);
    assert!(root.join("data/sidekick.sqlite-wal").exists());
    let mut upgraded = f.store();
    assert_eq!(upgraded.list().unwrap(), vec![todo.clone()]);
    assert_eq!(
        upgraded
            .create(todo.fields.clone(), "legacy-operation")
            .unwrap(),
        todo
    );
    assert_eq!(upgraded.history(&todo.id).unwrap().len(), 1);
    assert_eq!(
        upgraded
            .db()
            .unwrap()
            .query_row("SELECT sequence FROM todo_events", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        7
    );
    let backup = fs::read_dir(root.join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let snapshot = Connection::open_with_flags(&backup, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        snapshot
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        snapshot
            .query_row("SELECT title FROM todos", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "v1合成事项"
    );
    assert_eq!(fs::metadata(backup).unwrap().mode() & 0o777, 0o600);
    let check: i64 = upgraded
        .db()
        .unwrap()
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(check, 0);
}

#[test]
fn s2_backup_path_failure_leaves_v1_untouched_and_migration_ddl_rolls_back() {
    let f = crate::local_store::tests::Fixture::new();
    let (root, mut legacy, todo) = legacy_root(&f);
    fs::rename(root.join("backups"), root.join("saved-backups")).unwrap();
    fs::write(root.join("backups"), "sentinel").unwrap();
    assert!(AppStore::open(f.0.join("app")).is_err());
    assert_eq!(
        legacy
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    let broken = format!(
        "{};INSERT INTO missing_table VALUES(1);",
        include_str!("../migrations/002_ingestion.sql")
    );
    assert!(Migrations::new(vec![
        M::up(include_str!("../migrations/001_todos.sql")),
        M::up(&broken)
    ])
    .to_latest(&mut legacy)
    .is_err());
    assert_eq!(
        legacy
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        legacy
            .query_row("SELECT title FROM todos", [], |r| r.get::<_, String>(0))
            .unwrap(),
        todo.fields.title
    );
    assert_eq!(
        legacy
            .query_row("SELECT sequence FROM todo_events", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        7
    );
}

#[test]
fn s2_result_commit_failure_never_leaves_a_partial_candidate_batch() {
    let f = crate::local_store::tests::Fixture::new();
    let mut store = f.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let run = store
        .begin_import(text(), json!({}), false)
        .unwrap()
        .run
        .unwrap();
    store.db().unwrap().execute_batch("CREATE TRIGGER fail_result BEFORE UPDATE ON runs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic'); END;").unwrap();
    assert!(store
        .publish_candidates(&run.id, vec![draft("结果")])
        .is_err());
    let batch = store.batch(run.source_id.as_ref().unwrap()).unwrap();
    assert!(batch.candidates.is_empty());
    assert!(batch.source.succeeded_run_id.is_none());
    assert_eq!(batch.run.unwrap().status, "running");
    store
        .db()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_result")
        .unwrap();
    store
        .publish_candidates(&run.id, vec![draft("结果")])
        .unwrap();
    drop(store);
    let reopened = f.store();
    assert_eq!(
        reopened
            .batch(run.source_id.as_ref().unwrap())
            .unwrap()
            .run
            .unwrap()
            .status,
        "succeeded"
    );
}
