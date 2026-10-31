use crate::{mcp_host, mcp_upgrade, runtime_host, skills_host, store_commands};
use serde_json::json;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub fn run() {
    if !cfg!(feature = "s33-mcp-ui-verification") && std::env::args().any(|a| a == "--s33-mcp-ui") {
        eprintln!("MCP UI verification is not enabled in this package");
        std::process::exit(2);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![mcp_upgrade::read_mcp_storage_status,mcp_upgrade::confirm_mcp_storage_upgrade,mcp_host::start_mcp_probe,mcp_host::read_mcp_probe,mcp_host::latest_mcp_probe,mcp_host::read_mcp_catalog,mcp_host::active_mcp_probe,mcp_host::cancel_mcp_probe,crate::s0_probe::run_s0_probes,store_commands::save_mcp_secrets,store_commands::read_mcp_configuration,store_commands::save_mcp_server,store_commands::remove_mcp_server,skills_host::skills_catalog,skills_host::restore_builtin_skill,skills_host::open_skills_directory,store_commands::read_application_settings,store_commands::save_application_settings,store_commands::workspace_info,store_commands::read_profile,store_commands::save_profile,store_commands::initialize_workspace,store_commands::list_todos,store_commands::todo_history,store_commands::create_todo,store_commands::update_todo,store_commands::set_todo_completed,store_commands::delete_todo,store_commands::open_workspace_directory,runtime_host::organize_text,runtime_host::revise_candidate,runtime_host::test_model,runtime_host::active_model_run,store_commands::read_model_configuration,store_commands::save_model_configuration,store_commands::list_import_batches,store_commands::todo_source_links,store_commands::read_import_batch,store_commands::read_model_run,store_commands::save_candidate,store_commands::discard_candidate,store_commands::apply_candidate_preview,store_commands::sign_candidates,store_commands::cancel_model_run,store_commands::read_agent_configuration,store_commands::save_agent_configuration,store_commands::reset_agent_configuration,store_commands::read_agent_trial,store_commands::latest_agent_trial,store_commands::cancel_agent_trial,runtime_host::start_agent_trial,runtime_host::active_agent_trial])
        .setup(|app| {
            #[cfg(feature = "s33-mcp-ui-verification")]
            app.manage(crate::mcp_ui_verification::prepare(app)?);
            #[cfg(not(feature = "s33-mcp-ui-verification"))]
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
