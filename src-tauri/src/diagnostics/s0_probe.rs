use crate::storage_probe;
use serde_json::{json, Value};
use std::process::Command;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub(crate) async fn run_s0_probes(app: tauri::AppHandle) -> Result<Value, String> {
    if cfg!(feature = "s33-mcp-ui-verification") {
        return Err(
            "Credential and model probes are disabled in the MCP UI verification package".into(),
        );
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "clock unavailable")?.as_nanos();
        let root = std::env::temp_dir().join(format!("sidekick-native-{nonce}"));
        let storage = storage_probe::sqlite_probe(&root)?;
        let workspace_switch = storage_probe::workspace_switch_probe(&root.join("workspace-switch"))?;
        let keychain = storage_probe::keychain_probe()?;
        let resources = app.path().resource_dir().map_err(|_| "resources not found")?.join("s0-runtime");
        let output = Command::new(resources.join("node"))
            .arg(resources.join("probe.mjs"))
            .arg(resources.join("skills"))
            .env_clear().env("PATH", "/usr/bin:/bin")
            .output().map_err(|_| "bundled Node could not start")?;
        if !output.status.success() { return Err("bundled Runtime failed".into()); }
        let runtime: Value = serde_json::from_slice(&output.stdout).map_err(|_| "invalid bundled Runtime result")?;
        let cli = Command::new(resources.join("lark-cli")).arg("--version").env_clear().env("PATH", "/usr/bin:/bin").output().map_err(|_| "bundled CLI could not start")?;
        if !cli.status.success() { return Err("bundled CLI version probe failed".into()); }
        let pet = app.get_webview_window("pet").ok_or("pet window missing")?;
        pet.set_ignore_cursor_events(true).map_err(|_| "click-through enable failed")?;
        pet.set_ignore_cursor_events(false).map_err(|_| "click-through disable failed")?;
        pet.set_visible_on_all_workspaces(true).map_err(|_| "all-workspaces API failed")?;
        let monitors = pet.available_monitors().map_err(|_| "monitor enumeration failed")?;
        let shortcut = "CommandOrControl+Alt+Shift+K";
        let registered = app.global_shortcut().register(shortcut).is_ok();
        let duplicate_rejected = if registered {
            let rejected = app.global_shortcut().register(shortcut).is_err();
            app.global_shortcut().unregister(shortcut).map_err(|_| "shortcut cleanup failed")?;
            rejected
        } else { false };
        let report = json!({
            "scope":"S0 synthetic diagnostics only",
            "storage":storage,"workspaceSwitch":workspace_switch,"keychain":keychain,"runtime":runtime,"bundledCli":String::from_utf8_lossy(&cli.stdout).trim(),
            "windows":{"count":app.webview_windows().len(),"monitors":monitors.len(),"scaleFactors":monitors.iter().map(|m|m.scale_factor()).collect::<Vec<_>>(),"petAlwaysOnTop":pet.is_always_on_top().ok(),"clickThroughApiRoundtrip":true,"fullscreenInteraction":"not yet observed","displayUnplug":"not yet observed"},
            "shortcut":{"registered":registered,"duplicateRejected":duplicate_rejected},
            "autostart":match app.autolaunch().is_enabled() { Ok(enabled)=>json!({"query":"ok","enabled":enabled}), Err(_)=>json!({"query":"failed"}) },
            "notificationPermission":format!("{:?}",app.notification().permission_state()),
            "reportDirectory":root.to_string_lossy()
        });
        std::fs::write(root.join("report.json"), serde_json::to_vec_pretty(&report).map_err(|_| "report encoding failed")?).map_err(|_| "report write failed")?;
        Ok(report)
    }).await.map_err(|_| "native probe task failed")?;
    if let Err(ref error) = result {
        let _ = std::fs::write(
            std::env::temp_dir().join("sidekick-s0-last-error.txt"),
            error,
        );
    }
    result
}
