use super::*;
use crate::local_store::tests::{input, Fixture};

fn edit(
    expected: DesktopPreferences,
    work_mode: bool,
    pet_on_startup: bool,
) -> DesktopPreferencesInput {
    DesktopPreferencesInput {
        expected,
        preferences: DesktopPreferences {
            version: 1,
            work_mode,
            pet_on_startup,
        },
    }
}
#[test]
fn desktop_preferences_default_save_and_cold_reopen_preserve_business_and_app_config() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let root = s.root().unwrap();
    let todo = s.create(input(), "desktop-before").unwrap();
    let app = fs::read(root.join("config/app.json")).unwrap();
    let version: i64 = s
        .db()
        .unwrap()
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        s.desktop_preferences().unwrap(),
        DesktopPreferences::default()
    );
    assert!(!root.join("config/desktop.json").exists());
    let saved = s
        .save_desktop_preferences(edit(DesktopPreferences::default(), true, true))
        .unwrap();
    assert!(saved.warning.is_none());
    assert_eq!(
        fs::metadata(root.join("config/desktop.json"))
            .unwrap()
            .mode()
            & 0o777,
        0o600
    );
    drop(s);
    let s = f.store();
    assert_eq!(s.desktop_preferences().unwrap(), saved.preferences);
    assert_eq!(s.list().unwrap(), vec![todo.clone()]);
    assert_eq!(s.history(&todo.id).unwrap().len(), 1);
    assert_eq!(fs::read(root.join("config/app.json")).unwrap(), app);
    assert_eq!(
        s.db()
            .unwrap()
            .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        version
    );
}
#[test]
fn desktop_preferences_concurrent_changes_and_invalid_input_do_not_overwrite() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    s.save_desktop_preferences(edit(DesktopPreferences::default(), true, false))
        .unwrap();
    let bytes = fs::read(s.root().unwrap().join("config/desktop.json")).unwrap();
    assert_eq!(
        s.save_desktop_preferences(edit(DesktopPreferences::default(), false, true))
            .unwrap_err()
            .code,
        "DESKTOP_CONFLICT"
    );
    let mut invalid = edit(s.desktop_preferences().unwrap(), false, false);
    invalid.preferences.version = 99;
    assert!(s.save_desktop_preferences(invalid).is_err());
    assert_eq!(
        fs::read(s.root().unwrap().join("config/desktop.json")).unwrap(),
        bytes
    );
}
#[test]
fn desktop_preferences_corruption_future_version_and_unknown_fields_are_preserved() {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let path = s.root().unwrap().join("config/desktop.json");
    for bytes in [
        b"bad-json".as_slice(),
        br#"{"version":99,"workMode":false,"petOnStartup":false}"#,
        br#"{"version":1,"workMode":false,"petOnStartup":false,"extra":true}"#,
        br#"{"version":1,"workMode":"true","petOnStartup":false}"#,
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(s.desktop_preferences().is_err());
        assert!(s
            .save_desktop_preferences(edit(DesktopPreferences::default(), true, true))
            .is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}
#[test]
fn desktop_preferences_file_links_and_config_directory_links_are_rejected() {
    for hard in [false, true] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        let root = s.root().unwrap();
        let target = f.0.join("outside");
        fs::write(&target, b"sentinel").unwrap();
        let path = root.join("config/desktop.json");
        if hard {
            fs::hard_link(&target, &path).unwrap();
        } else {
            std::os::unix::fs::symlink(&target, &path).unwrap();
        }
        assert!(s.desktop_preferences().is_err());
        assert!(s
            .save_desktop_preferences(edit(DesktopPreferences::default(), true, true))
            .is_err());
        assert_eq!(fs::read(&target).unwrap(), b"sentinel");
    }
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(None, "UTC").unwrap();
    let root = s.root().unwrap();
    let outside = f.0.join("outside-config");
    fs::rename(root.join("config"), &outside).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("config")).unwrap();
    assert!(s.desktop_preferences().is_err());
    assert!(s
        .save_desktop_preferences(edit(DesktopPreferences::default(), true, true))
        .is_err());
    assert!(!outside.join("desktop.json").exists());
}
#[test]
fn desktop_preferences_write_failures_reconcile_without_false_failure_or_reset() {
    for fault in [
        SettingsWriteFault::BeforeReplace,
        SettingsWriteFault::AfterReplace,
        SettingsWriteFault::ReadBack,
    ] {
        let f = Fixture::new();
        let mut s = f.store();
        s.initialize(None, "UTC").unwrap();
        s.settings_write_fault = Some(fault);
        let saved = s.save_desktop_preferences(edit(DesktopPreferences::default(), true, false));
        match fault {
            SettingsWriteFault::BeforeReplace => {
                assert!(saved.is_err());
                assert_eq!(
                    s.desktop_preferences().unwrap(),
                    DesktopPreferences::default()
                );
            }
            SettingsWriteFault::AfterReplace => {
                let result = saved.unwrap();
                assert!(result.preferences.work_mode);
                assert!(result.warning.is_some());
            }
            SettingsWriteFault::ReadBack => {
                assert_eq!(saved.unwrap_err().code, "DESKTOP_UNCERTAIN")
            }
        }
    }
}
#[test]
fn desktop_preferences_no_workspace_does_not_create_config_or_business_data() {
    let f = Fixture::new();
    let s = f.store();
    assert_eq!(s.desktop_preferences().unwrap_err().code, "SETUP_REQUIRED");
    assert!(s
        .save_desktop_preferences(edit(DesktopPreferences::default(), true, true))
        .is_err());
    assert!(!f.0.join("app/workspace").exists());
}
