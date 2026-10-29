use super::*;

#[test]
fn profile_defaults_save_and_cold_reopen_do_not_modify_todos() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store
        .initialize(Some(fixture.root()), "Asia/Shanghai")
        .unwrap();
    let todo = store.create(input(), "profile-todo").unwrap();
    assert_eq!(store.profile().unwrap(), UserProfile::default());
    assert_eq!(store.profile().unwrap().name, "小明同学");
    assert!(!fixture.root().join("config/profile.json").exists());
    let saved = store
        .save_profile(ProfileInput {
            name: "  合成昵称  ".into(),
            address: "  老大  ".into(),
        })
        .unwrap();
    assert_eq!(saved.profile.name, "合成昵称");
    assert_eq!(saved.profile.address, "老大");
    assert!(saved.warning.is_none());
    assert_eq!(
        fs::metadata(fixture.root().join("config/profile.json"))
            .unwrap()
            .mode()
            & 0o777,
        0o600
    );
    drop(store);
    let store = fixture.store();
    assert_eq!(store.profile().unwrap(), saved.profile);
    assert_eq!(store.list().unwrap(), vec![todo.clone()]);
    assert_eq!(store.history(&todo.id).unwrap().len(), 1);
    assert_eq!(
        store
            .save_profile(ProfileInput {
                name: String::new(),
                address: "  ".into()
            })
            .unwrap()
            .profile
            .address,
        "BOSS"
    );
}

#[test]
fn invalid_or_unknown_profile_is_not_overwritten() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    assert!(store
        .save_profile(ProfileInput {
            name: "x".repeat(61),
            address: "BOSS".into()
        })
        .is_err());
    let copied = "明".repeat(40);
    let long = store
        .save_profile(ProfileInput {
            name: copied.clone(),
            address: copied.clone(),
        })
        .unwrap();
    assert_eq!(long.profile.name, copied);
    assert_eq!(long.profile.address, long.profile.name);
    assert!(store
        .save_profile(ProfileInput {
            name: "合成昵称".into(),
            address: "明".repeat(61)
        })
        .is_err());
    assert!(store
        .save_profile(ProfileInput {
            name: "合成".into(),
            address: "a\nb".into()
        })
        .is_err());
    let path = store.root().unwrap().join("config/profile.json");
    for bytes in [
        b"not-json".as_slice(),
        br#"{"version":99,"name":"synthetic","address":"BOSS"}"#.as_slice(),
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(store.profile().is_err());
        assert!(store
            .save_profile(ProfileInput {
                name: String::new(),
                address: "BOSS".into()
            })
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn profile_file_links_are_rejected_without_changing_the_target() {
    for hard in [false, true] {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        store.initialize(None, "Asia/Shanghai").unwrap();
        let outside = fixture.0.join("outside-profile");
        fs::write(&outside, b"sentinel").unwrap();
        let path = store.root().unwrap().join("config/profile.json");
        if hard {
            fs::hard_link(&outside, &path).unwrap();
        } else {
            std::os::unix::fs::symlink(&outside, &path).unwrap();
        }
        assert!(store.profile().is_err());
        assert!(store
            .save_profile(ProfileInput {
                name: String::new(),
                address: "BOSS".into()
            })
            .is_err());
        assert_eq!(fs::read(outside).unwrap(), b"sentinel");
    }
}

#[test]
fn reading_a_legacy_empty_nickname_uses_the_default_without_rewriting_the_file() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let path = store.root().unwrap().join("config/profile.json");
    drop(store);
    for legacy in [
        br#"{"version":1,"name":"","address":"Existing address"}"#.as_slice(),
        br#"{"version":1,"address":"Existing address"}"#.as_slice(),
        br#"{"version":1,"name":"  ","address":"Existing address"}"#.as_slice(),
    ] {
        fs::write(&path, legacy).unwrap();
        let reopened = fixture.store();
        let profile = reopened.profile().unwrap();
        assert_eq!(profile.name, "小明同学");
        assert_eq!(profile.address, "Existing address");
        assert_eq!(fs::read(&path).unwrap(), legacy);
    }
}

#[test]
fn profile_write_failure_reconciles_the_authoritative_committed_value() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    store
        .save_profile(ProfileInput {
            name: String::new(),
            address: "原称呼".into(),
        })
        .unwrap();
    store.profile_write_fault = Some(ProfileWriteFault::BeforeReplace);
    assert!(store
        .save_profile(ProfileInput {
            name: String::new(),
            address: "新称呼".into()
        })
        .is_err());
    assert_eq!(store.profile().unwrap().address, "原称呼");
    store.profile_write_fault = Some(ProfileWriteFault::AfterReplace);
    let saved = store
        .save_profile(ProfileInput {
            name: String::new(),
            address: "新称呼".into(),
        })
        .unwrap();
    assert_eq!(saved.profile.address, "新称呼");
    assert!(saved.warning.is_some());
    assert_eq!(store.profile().unwrap(), saved.profile);
}

#[test]
fn profile_unknown_commit_result_does_not_change_todos_or_history() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let todo = store.create(input(), "unknown-profile-todo").unwrap();
    store.profile_write_fault = Some(ProfileWriteFault::AfterReplaceAndReadFailure);
    let result = store.save_profile(ProfileInput {
        name: "合成姓名".into(),
        address: "新称呼".into(),
    });
    assert_eq!(result.unwrap_err().code, "PROFILE_SAVE_UNCERTAIN");
    assert_eq!(store.profile().unwrap().address, "新称呼");
    assert_eq!(store.list().unwrap(), vec![todo.clone()]);
    assert_eq!(store.history(&todo.id).unwrap().len(), 1);
}

pub(super) struct Fixture(pub(super) PathBuf);
impl Fixture {
    pub(super) fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("sidekick-s1-{}-{}", std::process::id(), nonce()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn app(&self) -> PathBuf {
        self.0.join("app")
    }
    fn root(&self) -> PathBuf {
        self.0.join("workspace")
    }
    pub(super) fn store(&self) -> AppStore {
        AppStore::open(self.app()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn input() -> TodoInput {
    TodoInput {
        title: "验收：准备清单".into(),
        kind: "followup".into(),
        owner: "合成负责人".into(),
        priority: "medium".into(),
        due: Some(TimePoint {
            at_ms: 1793347200000,
            time_zone: "Asia/Shanghai".into(),
            local_text: "2026-10-30T16:00".into(),
            precision: "minute".into(),
        }),
        followup: Some(TimePoint {
            at_ms: 1793257200000,
            time_zone: "Asia/Shanghai".into(),
            local_text: "2026-10-29T15:00".into(),
            precision: "minute".into(),
        }),
        tags: vec!["验收".into(), "验收".into()],
    }
}

#[test]
fn manual_create_and_cold_reopen_preserve_fields_and_history() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store
        .initialize(Some(fixture.root()), "Asia/Shanghai")
        .unwrap();
    let created = store.create(input(), "create-a").unwrap();
    assert_eq!(created.source, "manual");
    assert_eq!(created.fields.tags, vec!["验收"]);
    assert_ne!(created.fields.due, created.fields.followup);
    drop(store);
    let reopened = fixture.store();
    assert!(!reopened.info().unwrap().needs_setup);
    assert_eq!(reopened.list().unwrap(), vec![created.clone()]);
    assert_eq!(reopened.history(&created.id).unwrap().len(), 1);
}

#[test]
fn edit_one_time_never_rewrites_the_other_and_completion_is_reversible() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let created = store.create(input(), "create-a").unwrap();
    let mut edited = created.fields.clone();
    edited.followup = None;
    edited.title = "验收：修改后的清单".into();
    let updated = store.update(&created.id, 1, edited, "edit-a").unwrap();
    assert_eq!(updated.fields.due, created.fields.due);
    assert!(updated.fields.followup.is_none());
    let done = store
        .set_completed(&created.id, 2, true, "complete-a")
        .unwrap();
    assert_eq!(done.status, "completed");
    assert!(done.completed_at_ms.is_some());
    let open = store
        .set_completed(&created.id, 3, false, "reopen-a")
        .unwrap();
    assert_eq!(open.status, "open");
    assert!(open.completed_at_ms.is_none());
    assert_eq!(store.history(&created.id).unwrap().len(), 4);
}

#[test]
fn retries_take_effect_once_and_return_current_authoritative_state() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let original = input();
    let created = store.create(original.clone(), "create-a").unwrap();
    let mut edited = created.fields.clone();
    edited.title = "验收：较新的内容".into();
    let current = store.update(&created.id, 1, edited, "edit-a").unwrap();
    assert_eq!(store.create(original, "create-a").unwrap(), current);
    assert_eq!(store.list().unwrap().len(), 1);
    assert_eq!(store.history(&created.id).unwrap().len(), 2);
    assert_eq!(
        store.create(input(), "edit-a").unwrap_err().code,
        "OPERATION_CONFLICT"
    );
}

#[test]
fn old_reopen_and_deleted_mutations_are_rejected() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let todo = store.create(input(), "create").unwrap();
    store.set_completed(&todo.id, 1, true, "done-1").unwrap();
    store.set_completed(&todo.id, 2, false, "open-1").unwrap();
    store.set_completed(&todo.id, 3, true, "done-2").unwrap();
    assert_eq!(
        store
            .set_completed(&todo.id, 2, false, "old-open")
            .unwrap_err()
            .code,
        "VERSION_CONFLICT"
    );
    let deleted = store.delete(&todo.id, 4, "delete").unwrap();
    assert_eq!(deleted.status, "deleted");
    assert_eq!(
        store
            .set_completed(&todo.id, 5, false, "after-delete")
            .unwrap_err()
            .code,
        "DELETED"
    );
    assert_eq!(
        store
            .update(&todo.id, 5, input(), "edit-deleted")
            .unwrap_err()
            .code,
        "DELETED"
    );
    assert_eq!(
        store.delete(&todo.id, 4, "delete").unwrap().status,
        "deleted"
    );
    assert_eq!(store.history(&todo.id).unwrap().len(), 5);
}

#[test]
fn blank_invalid_and_undated_inputs_have_explicit_results() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let mut invalid = input();
    invalid.title = "  ".into();
    assert_eq!(
        store.create(invalid, "blank").unwrap_err().code,
        "INVALID_INPUT"
    );
    let mut invalid = input();
    invalid.kind = "team".into();
    assert!(store.create(invalid, "kind").is_err());
    let mut plain = input();
    plain.kind = "action".into();
    plain.owner = "我".into();
    plain.due = None;
    plain.followup = None;
    let todo = store.create(plain, "undated").unwrap();
    assert!(todo.fields.due.is_none());
    assert_eq!(store.list().unwrap().len(), 1);
    let mut raw = serde_json::to_value(input()).unwrap();
    raw["source"] = json!("ai");
    assert!(serde_json::from_value::<TodoInput>(raw).is_err());
}

#[test]
fn sql_values_are_bound_and_history_failure_rolls_back_the_todo() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let mut data = input();
    data.title = "验收：' ; DROP TABLE todos; --".into();
    let todo = store.create(data, "create").unwrap();
    store.workspace.as_mut().unwrap().db.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON todo_events BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;").unwrap();
    let mut edited = todo.fields.clone();
    edited.title = "不应保存".into();
    assert!(store.update(&todo.id, 1, edited, "failed").is_err());
    assert_eq!(store.get(&todo.id).unwrap(), todo);
    assert_eq!(store.history(&todo.id).unwrap().len(), 1);
}

#[test]
fn app_lock_blocks_two_instances_even_before_different_roots_are_chosen() {
    let fixture = Fixture::new();
    let first = fixture.store();
    assert_eq!(
        AppStore::open(fixture.app()).err().unwrap().code,
        "APP_IN_USE"
    );
    drop(first);
    assert!(AppStore::open(fixture.app()).is_ok());
}

#[test]
fn root_lock_blocks_a_second_app_namespace() {
    let fixture = Fixture::new();
    let mut first = fixture.store();
    first
        .initialize(Some(fixture.root()), "Asia/Shanghai")
        .unwrap();
    let mut second = AppStore::open(fixture.0.join("other-app")).unwrap();
    assert_eq!(
        second
            .initialize(Some(fixture.root()), "Asia/Shanghai")
            .unwrap_err()
            .code,
        "ROOT_IN_USE"
    );
}

#[test]
fn unknown_nonempty_directory_is_never_adopted_or_overwritten() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.root()).unwrap();
    let sentinel = fixture.root().join("personal.txt");
    fs::write(&sentinel, "must remain").unwrap();
    let mut store = fixture.store();
    assert_eq!(
        store
            .initialize(Some(fixture.root()), "Asia/Shanghai")
            .unwrap_err()
            .code,
        "UNKNOWN_ROOT"
    );
    assert_eq!(fs::read_to_string(sentinel).unwrap(), "must remain");
    assert!(!fixture.app().join("bootstrap.json").exists());
}

#[test]
fn each_initialization_interruption_can_resume_the_same_root() {
    for phase in [
        InitPhase::Marker,
        InitPhase::Directories,
        InitPhase::BeforeSchema,
        InitPhase::Schema,
        InitPhase::Ready,
        InitPhase::BeforeBootstrap,
    ] {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        store.init_fault = Some(phase);
        assert_eq!(
            store
                .initialize(Some(fixture.root()), "Asia/Shanghai")
                .unwrap_err()
                .code,
            "INJECTED"
        );
        assert!(!fixture.app().join("bootstrap.json").exists());
        drop(store);
        let mut resumed = fixture.store();
        let info = resumed.info().unwrap();
        assert!(info.needs_setup);
        resumed
            .initialize(Some(fixture.root()), "Asia/Shanghai")
            .unwrap();
        assert_eq!(resumed.list().unwrap().len(), 0);
        assert!(!resumed.info().unwrap().needs_setup);
    }
}

#[test]
fn future_schema_and_missing_ready_database_never_fall_back_to_empty_data() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let root = store.workspace.as_ref().unwrap().root.clone();
    let todo = store.create(input(), "one").unwrap();
    drop(store);
    let db_path = root.join("data/sidekick.sqlite");
    {
        let db = Connection::open(&db_path).unwrap();
        db.pragma_update(None, "user_version", 99).unwrap();
    }
    let bytes = fs::read(&db_path).unwrap();
    assert_eq!(
        AppStore::open(fixture.app()).err().unwrap().code,
        "SCHEMA_TOO_NEW"
    );
    assert_eq!(fs::read(&db_path).unwrap(), bytes);
    {
        let db = Connection::open(&db_path).unwrap();
        db.pragma_update(None, "user_version", 2).unwrap();
    }
    let store = fixture.store();
    assert_eq!(store.get(&todo.id).unwrap().id, todo.id);
    drop(store);
    fs::rename(&db_path, root.join("data/saved.sqlite")).unwrap();
    assert_eq!(
        AppStore::open(fixture.app()).err().unwrap().code,
        "MISSING_DATABASE"
    );
    assert!(!db_path.exists());
}

#[test]
fn failed_initial_schema_rolls_back_tables_version_and_product_identity() {
    let mut db = Connection::open_in_memory().unwrap();
    let broken = format!(
        "{}; INSERT INTO table_that_does_not_exist VALUES(1);",
        include_str!("../migrations/001_todos.sql")
    );
    assert!(Migrations::new(vec![M::up(&broken)])
        .to_latest(&mut db)
        .is_err());
    let tables: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='todos'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    let app: i64 = db
        .pragma_query_value(None, "application_id", |r| r.get(0))
        .unwrap();
    assert_eq!((tables, version, app), (0, 0, 0));
}

#[test]
fn active_root_cannot_be_replaced_and_missing_root_is_not_recreated() {
    let fixture = Fixture::new();
    let mut store = fixture.store();
    store.initialize(None, "Asia/Shanghai").unwrap();
    let root = store.root().unwrap();
    let pointer = fs::read(fixture.app().join("bootstrap.json")).unwrap();
    let other = fixture.0.join("another-root");
    assert_eq!(
        store
            .initialize(Some(other.clone()), "Asia/Shanghai")
            .unwrap_err()
            .code,
        "ROOT_ALREADY_OPEN"
    );
    assert_eq!(
        fs::read(fixture.app().join("bootstrap.json")).unwrap(),
        pointer
    );
    assert!(!other.exists());
    drop(store);
    fs::rename(&root, fixture.0.join("moved-workspace")).unwrap();
    assert_eq!(
        AppStore::open(fixture.app()).err().unwrap().code,
        "MISSING_ROOT"
    );
    assert!(!root.exists());
}

#[test]
fn dangling_marker_is_rejected_without_writing_outside_the_root() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.root()).unwrap();
    let outside = fixture.0.join("outside-marker");
    std::os::unix::fs::symlink(&outside, fixture.root().join(ROOT_MARKER)).unwrap();
    let mut store = fixture.store();
    assert!(store
        .initialize(Some(fixture.root()), "Asia/Shanghai")
        .is_err());
    assert!(!outside.exists());
    assert!(!fixture.app().join("bootstrap.json").exists());
    assert!(!fixture.app().join("workspace-init.json").exists());
}

#[test]
fn hard_link_marker_never_changes_an_outside_file() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.root()).unwrap();
    let outside = fixture.0.join("outside-marker");
    fs::write(&outside, []).unwrap();
    fs::hard_link(&outside, fixture.root().join(ROOT_MARKER)).unwrap();
    let mut store = fixture.store();
    assert!(store
        .initialize(Some(fixture.root()), "Asia/Shanghai")
        .is_err());
    assert!(fs::read(&outside).unwrap().is_empty());
    assert!(!fixture.app().join("bootstrap.json").exists());
    assert!(!fixture.app().join("workspace-init.json").exists());
}

#[test]
fn a_new_app_namespace_never_rebuilds_a_damaged_existing_root() {
    for (missing_config, missing_database) in [(true, true), (true, false), (false, true)] {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        store
            .initialize(Some(fixture.root()), "Asia/Shanghai")
            .unwrap();
        store.create(input(), "saved-before-damage").unwrap();
        drop(store);
        let root = fixture.root();
        if missing_config {
            fs::rename(
                root.join("config/app.json"),
                root.join("config/saved-app.json"),
            )
            .unwrap();
        }
        if missing_database {
            fs::rename(
                root.join("data/sidekick.sqlite"),
                root.join("data/saved.sqlite"),
            )
            .unwrap();
        }
        let app = fixture.0.join("fresh-app");
        let mut reopened = AppStore::open(app.clone()).unwrap();
        assert!(reopened
            .initialize(Some(root.clone()), "Asia/Shanghai")
            .is_err());
        assert!(!app.join("bootstrap.json").exists());
        assert!(!app.join("workspace-init.json").exists());
        assert_eq!(root.join("config/app.json").exists(), !missing_config);
        assert_eq!(
            root.join("data/sidekick.sqlite").exists(),
            !missing_database
        );
    }
}

#[test]
fn committed_data_recovers_after_abrupt_process_stop() {
    if let Some(path) = std::env::var_os("SIDEKICK_S1_CRASH_FIXTURE") {
        let path = PathBuf::from(path);
        let mut store = AppStore::open(path.join("app")).unwrap();
        store
            .initialize(Some(path.join("workspace")), "Asia/Shanghai")
            .unwrap();
        let todo = store.create(input(), "crash-create").unwrap();
        let ready = path.join("committed.json");
        fs::write(&ready, serde_json::to_vec(&todo).unwrap()).unwrap();
        File::open(ready).unwrap().sync_all().unwrap();
        loop {
            std::thread::park();
        }
    }
    let fixture = Fixture::new();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "local_store::tests::committed_data_recovers_after_abrupt_process_stop",
        ])
        .env("SIDEKICK_S1_CRASH_FIXTURE", &fixture.0)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let ready = fixture.0.join("committed.json");
    for _ in 0..500 {
        if ready.exists() || child.try_wait().unwrap().is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let committed = ready.exists();
    let _ = child.kill();
    let status = child.wait().unwrap();
    assert!(committed, "child must commit before the abrupt stop");
    use std::os::unix::process::ExitStatusExt;
    assert_eq!(status.signal(), Some(9));
    let saved: Todo = serde_json::from_slice(&fs::read(ready).unwrap()).unwrap();
    let mut recovered = fixture.store();
    assert_eq!(recovered.list().unwrap(), vec![saved.clone()]);
    assert_eq!(recovered.history(&saved.id).unwrap().len(), 1);
    assert_eq!(recovered.create(input(), "crash-create").unwrap(), saved);
    assert_eq!(recovered.history(&saved.id).unwrap().len(), 1);
}
