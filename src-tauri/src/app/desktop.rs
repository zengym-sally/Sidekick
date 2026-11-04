use crate::local_store::StoreError;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const SHORTCUT: &str = "CommandOrControl+Shift+K";
pub(crate) struct DesktopState {
    enabled: bool,
    shortcut_registered: AtomicBool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopStatus {
    enabled: bool,
    shortcut_registered: bool,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WindowAction {
    OpenMain,
    OpenQuick,
    ShowPet,
    HidePet,
    HideQuick,
}

fn enabled(state: &DesktopState) -> Result<(), StoreError> {
    if state.enabled {
        Ok(())
    } else {
        Err(StoreError {
            code: "DESKTOP_UNAVAILABLE",
            message: "专用验收载体未启用生产桌面入口。",
        })
    }
}
fn pressed(state: ShortcutState) -> bool {
    state == ShortcutState::Pressed
}
fn perform(app: &AppHandle, action: WindowAction) -> Result<(), StoreError> {
    enabled(&app.state::<DesktopState>())?;
    let failure = || StoreError {
        code: "DESKTOP_WINDOW",
        message: "窗口暂时无法操作，请从托盘或 Dock 重新打开。",
    };
    let label = match action {
        WindowAction::OpenMain => "main",
        WindowAction::OpenQuick | WindowAction::HideQuick => "quick",
        WindowAction::ShowPet | WindowAction::HidePet => "pet",
    };
    let window = app.get_webview_window(label).ok_or_else(failure)?;
    match action {
        WindowAction::HidePet | WindowAction::HideQuick => window.hide().map_err(|_| failure()),
        _ => {
            window.unminimize().map_err(|_| failure())?;
            window.show().map_err(|_| failure())?;
            window.set_focus().map_err(|_| failure())
        }
    }
}
#[tauri::command]
pub(crate) fn desktop_window_action(
    app: AppHandle,
    action: WindowAction,
) -> Result<(), StoreError> {
    perform(&app, action)
}
#[tauri::command]
pub(crate) fn read_desktop_status(state: State<'_, DesktopState>) -> DesktopStatus {
    DesktopStatus {
        enabled: state.enabled,
        shortcut_registered: state.shortcut_registered.load(Ordering::SeqCst),
    }
}

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let production = !cfg!(feature = "s33-mcp-ui-verification");
    app.manage(DesktopState {
        enabled: production,
        shortcut_registered: AtomicBool::new(false),
    });
    if !production {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html?window=pet".into()))
        .title("班班")
        .inner_size(280.0, 200.0)
        .center()
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    WebviewWindowBuilder::new(
        app,
        "quick",
        WebviewUrl::App("index.html?window=quick".into()),
    )
    .title("跟班 · 快速录入")
    .inner_size(600.0, 720.0)
    .min_inner_size(420.0, 520.0)
    .center()
    .visible(false)
    .build()?;
    let registered = app
        .global_shortcut()
        .on_shortcut(SHORTCUT, |app, _, event| {
            if pressed(event.state()) {
                let _ = perform(app, WindowAction::OpenQuick);
            }
        })
        .is_ok();
    app.state::<DesktopState>()
        .shortcut_registered
        .store(registered, Ordering::SeqCst);
    let show = MenuItem::with_id(app, "desktop-main", "打开工作台", true, None::<&str>)?;
    let quick = MenuItem::with_id(
        app,
        "desktop-quick",
        if registered {
            "快速录入（⌘⇧K）"
        } else {
            "快速录入（全局快捷键未注册）"
        },
        true,
        None::<&str>,
    )?;
    let show_pet = MenuItem::with_id(app, "desktop-pet", "显示班班", true, None::<&str>)?;
    let hide_pet = MenuItem::with_id(app, "desktop-hide-pet", "隐藏班班", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "desktop-quit", "退出跟班", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &show_pet, &hide_pet, &quit])?;
    TrayIconBuilder::new()
        .icon(tauri::image::Image::new_owned(
            [31, 58, 95, 255].repeat(16 * 16),
            16,
            16,
        ))
        .menu(&menu)
        .tooltip("跟班 Sidekick")
        .on_menu_event(|app, event| {
            let action = match event.id.as_ref() {
                "desktop-main" => WindowAction::OpenMain,
                "desktop-quick" => WindowAction::OpenQuick,
                "desktop-pet" => WindowAction::ShowPet,
                "desktop-hide-pet" => WindowAction::HidePet,
                "desktop-quit" => {
                    app.exit(0);
                    return;
                }
                _ => return,
            };
            let _ = perform(app, action);
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_actions_refuse_unknown_labels_urls_and_paths() {
        for value in [
            "open_main",
            "open_quick",
            "show_pet",
            "hide_pet",
            "hide_quick",
        ] {
            assert!(serde_json::from_value::<WindowAction>(serde_json::json!(value)).is_ok());
        }
        for value in [
            serde_json::json!("open_other"),
            serde_json::json!("../../quick"),
            serde_json::json!({"label":"main","url":"https://example.invalid"}),
        ] {
            assert!(serde_json::from_value::<WindowAction>(value).is_err());
        }
    }
    #[test]
    fn desktop_verification_gate_and_shortcut_release_fail_closed() {
        let state = DesktopState {
            enabled: false,
            shortcut_registered: AtomicBool::new(false),
        };
        assert_eq!(enabled(&state).unwrap_err().code, "DESKTOP_UNAVAILABLE");
        assert!(pressed(ShortcutState::Pressed));
        assert!(!pressed(ShortcutState::Released));
    }
}
