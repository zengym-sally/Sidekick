pub mod local_store;
mod runtime_host;
mod skills_host;
mod storage_probe;
mod store_commands;

use serde_json::{json, Value};
use std::process::Command;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
async fn run_s0_probes(app: tauri::AppHandle) -> Result<Value, String> {
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![run_s0_probes,store_commands::save_mcp_secrets,store_commands::read_mcp_configuration,store_commands::save_mcp_server,store_commands::remove_mcp_server,skills_host::skills_catalog,skills_host::restore_builtin_skill,skills_host::open_skills_directory,store_commands::read_application_settings,store_commands::save_application_settings,store_commands::workspace_info,store_commands::read_profile,store_commands::save_profile,store_commands::initialize_workspace,store_commands::list_todos,store_commands::todo_history,store_commands::create_todo,store_commands::update_todo,store_commands::set_todo_completed,store_commands::delete_todo,store_commands::open_workspace_directory,runtime_host::organize_text,runtime_host::revise_candidate,runtime_host::test_model,runtime_host::active_model_run,store_commands::read_model_configuration,store_commands::save_model_configuration,store_commands::list_import_batches,store_commands::todo_source_links,store_commands::read_import_batch,store_commands::read_model_run,store_commands::save_candidate,store_commands::discard_candidate,store_commands::apply_candidate_preview,store_commands::sign_candidates,store_commands::cancel_model_run,store_commands::read_agent_configuration,store_commands::save_agent_configuration,store_commands::reset_agent_configuration,store_commands::read_agent_trial,store_commands::latest_agent_trial,store_commands::cancel_agent_trial,runtime_host::start_agent_trial,runtime_host::active_agent_trial])
        .setup(|app| {
            app.manage(store_commands::LocalState::new(app.path().app_data_dir()?));
            app.manage(runtime_host::RuntimeState::default());
            WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html?pet=1".into()))
                .title("班班 · S0")
                .inner_size(128.0, 128.0)
                .position(60.0, 600.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .build()?;
            WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html?quick=1".into()))
                .title("跟班 · 快捷入口探针")
                .inner_size(560.0, 260.0)
                .visible(false)
                .build()?;
            let show = MenuItem::with_id(app, "show", "打开工作台", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出跟班", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(tauri::image::Image::new_owned(
                    [31, 58, 95, 255].repeat(16 * 16),
                    16,
                    16,
                ))
                .menu(&menu)
                .tooltip("跟班 Sidekick · S0")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
                window.set_focus()?;
                let _ = std::fs::write(std::env::temp_dir().join("sidekick-s0-startup.json"), json!({"windows":app.webview_windows().keys().collect::<Vec<_>>(),"mainVisible":window.is_visible().unwrap_or(false),"mainUrl":window.url().map(|url|url.to_string()).unwrap_or_default()}).to_string());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Tauri host failed")
        .run(|app, event| {
            if matches!(event,tauri::RunEvent::Exit) {if let Ok(directory)=app.path().resource_dir(){app.state::<runtime_host::RuntimeState>().shutdown(&directory.join("s0-runtime"));}}
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
