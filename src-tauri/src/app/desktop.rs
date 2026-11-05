use super::{pet_native, pet_state::PetState};
use crate::local_store::{
    DesktopPreferences, DesktopPreferencesInput, DesktopPreferencesSave, StoreError,
};
use crate::store_commands::{call, LocalState};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const SHORTCUT: &str = "CommandOrControl+Shift+K";
pub(crate) struct DesktopState {
    enabled: bool,
    pub(super) pet: Option<Arc<PetState>>,
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
pub(super) fn perform(app: &AppHandle, action: WindowAction) -> Result<(), StoreError> {
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
    let pet = app.state::<DesktopState>().pet.clone();
    if matches!(action, WindowAction::ShowPet) {
        if let Some(pet) = &pet {
            pet_native::recover(&window, pet, true)?;
        }
    }
    let result = match action {
        WindowAction::HidePet | WindowAction::HideQuick => window.hide().map_err(|_| failure()),
        _ => {
            window.unminimize().map_err(|_| failure())?;
            window.show().map_err(|_| failure())?;
            if matches!(action, WindowAction::ShowPet) {
                if let Some(pet) = &pet {
                    pet_native::visibility(pet, true);
                }
            }
            window.set_focus().map_err(|_| failure())
        }
    };
    if result.is_ok() {
        if let Some(pet) = pet {
            if let WindowAction::HidePet = action {
                pet_native::visibility(&pet, false);
            }
        }
    }
    result
}
pub(super) fn pet_hidden(app: &AppHandle) {
    if let Some(pet) = &app.state::<DesktopState>().pet {
        pet_native::visibility(pet, false);
    }
}
pub(super) fn sync_pet_visibility(app: &AppHandle) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    let Some(pet) = &state.pet else {
        return;
    };
    let Some(window) = app.get_webview_window("pet") else {
        return;
    };
    if let Ok(visible) = window.is_visible() {
        if pet_native::observed_visibility(pet, visible) && visible {
            let _ = pet_native::input(&window, pet, false, None);
        }
    }
}
pub(super) fn stop_pet(app: &AppHandle) {
    if let Some(pet) = &app.state::<DesktopState>().pet {
        pet.stop();
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

#[tauri::command]
pub(crate) async fn read_desktop_preferences(
    app: AppHandle,
    state: State<'_, LocalState>,
) -> Result<DesktopPreferences, StoreError> {
    enabled(&app.state::<DesktopState>())?;
    call(state, |store| store.desktop_preferences()).await
}
#[tauri::command]
pub(crate) async fn save_desktop_preferences(
    app: AppHandle,
    state: State<'_, LocalState>,
    input: DesktopPreferencesInput,
) -> Result<DesktopPreferencesSave, StoreError> {
    enabled(&app.state::<DesktopState>())?;
    let mut result = call(state, move |store| store.save_desktop_preferences(input)).await?;
    if app.emit("desktop-preferences-changed", ()).is_err() {
        result.warning = Some(if result.warning.is_some() {
            "桌面偏好已生效，但磁盘同步和窗口通知未能确认，请稍后重读并重新保存。"
        } else {
            "桌面偏好已保存，窗口通知未能确认，请重新显示相关窗口。"
        });
    }
    Ok(result)
}

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let production = !cfg!(feature = "s33-mcp-ui-verification");
    app.manage(DesktopState {
        enabled: production,
        pet: production.then(|| Arc::new(PetState::new(false))),
        shortcut_registered: AtomicBool::new(false),
    });
    if !production {
        return Ok(());
    }
    let pet_on_startup = app
        .state::<LocalState>()
        .access(|store| store.desktop_preferences())
        .is_ok_and(|preferences| preferences.pet_on_startup);
    let pet_state = app
        .state::<DesktopState>()
        .pet
        .clone()
        .expect("production pet initialized");
    app.state::<LocalState>().observe_pet(&pet_state);
    let _ = app.state::<LocalState>().access(|_| Ok(()));
    let pet_window =
        WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html?window=pet".into()))
            .title("班班")
            .inner_size(192.0, 192.0)
            .resizable(false)
            .incognito(cfg!(feature = "pet-ui-verification"))
            .center()
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()?;
    WebviewWindowBuilder::new(
        app,
        "quick",
        WebviewUrl::App("index.html?window=quick".into()),
    )
    .incognito(cfg!(feature = "pet-ui-verification"))
    .title("跟班 · 快速录入")
    .inner_size(600.0, 720.0)
    .min_inner_size(420.0, 520.0)
    .center()
    .visible(false)
    .build()?;
    if pet_on_startup {
        pet_native::recover(&pet_window, &pet_state, true)
            .map_err(|e| std::io::Error::other(e.message))?;
        pet_window.show()?;
        pet_native::visibility(&pet_state, true);
    }
    pet_native::start(app.handle().clone(), pet_state);
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
        .icon(super::tray_icon::image())
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("跟班 Sidekick")
        .on_menu_event(|app, event| {
            let action = match event.id.as_ref() {
                "desktop-main" | "pet-main" => WindowAction::OpenMain,
                "desktop-quick" | "pet-quick" => WindowAction::OpenQuick,
                "desktop-pet" => WindowAction::ShowPet,
                "desktop-hide-pet" | "pet-hide" => WindowAction::HidePet,
                "desktop-quit" => {
                    app.exit(0);
                    return;
                }
                _ => return,
            };
            if let Err(error) = perform(app, action) {
                if let Some(pet) = &app.state::<DesktopState>().pet {
                    if let Some(window) = app.get_webview_window("pet") {
                        pet_native::degrade(&window, pet, error.message);
                    }
                }
            }
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
            pet: None,
            shortcut_registered: AtomicBool::new(false),
        };
        assert_eq!(enabled(&state).unwrap_err().code, "DESKTOP_UNAVAILABLE");
        assert!(pressed(ShortcutState::Pressed));
        assert!(!pressed(ShortcutState::Released));
    }
}
