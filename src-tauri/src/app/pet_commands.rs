use super::{
    desktop::DesktopState,
    pet_native,
    pet_state::{Grant, PetState, Snapshot, View},
};
use crate::{
    local_store::StoreError,
    store_commands::{call, LocalState},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tauri::{
    menu::{Menu, MenuItem},
    LogicalPosition, Manager, State, WebviewWindow,
};

fn pet(window: &WebviewWindow) -> Result<Arc<PetState>, StoreError> {
    if window.label() != "pet" {
        return Err(StoreError {
            code: "PET_CALLER",
            message: "此操作仅限班班窗口。",
        });
    }
    window
        .state::<DesktopState>()
        .pet
        .clone()
        .ok_or_else(pet_native::failure)
}
fn client(state: &PetState, epoch: u64) -> Result<(), StoreError> {
    if state
        .lock()
        .map_err(|_| pet_native::failure())?
        .view
        .client_epoch
        != epoch
    {
        return Err(StoreError {
            code: "PET_CLIENT",
            message: "班班连接已更新，请重新显示。",
        });
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn read_pet_state(
    window: WebviewWindow,
    state: State<'_, LocalState>,
) -> Result<Snapshot, StoreError> {
    let pet = pet(&window)?;
    call(state, |_| Ok(())).await?;
    Ok(pet.snapshot())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Attached {
    attached: bool,
    snapshot: Snapshot,
}
#[tauri::command]
pub(crate) async fn attach_pet_client(
    window: WebviewWindow,
    expected_client_epoch: u64,
) -> Result<Attached, StoreError> {
    let state = pet(&window)?;
    let attached = {
        let mut inner = state.lock().map_err(|_| pet_native::failure())?;
        if inner.view.client_epoch != expected_client_epoch {
            false
        } else {
            inner.view.client_epoch += 1;
            inner.view.mask_sequence = 0;
            inner.view.policy_sequence = 0;
            inner.mask.clear();
            inner.mask_ack = 0;
            inner.view_ack = 0;
            inner.client_ready = false;
            inner.keyboard_focused = false;
            inner.page_visible = false;
            inner.reduced_motion = true;
            inner.barrier();
            true
        }
    };
    if attached {
        pet_native::input(&window, &state, false, None)?;
    }
    state.wake.notify_all();
    Ok(Attached {
        attached,
        snapshot: state.snapshot(),
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MaskRequest {
    client_epoch: u64,
    sequence: u64,
    mask: Vec<u8>,
}
#[tauri::command]
pub(crate) async fn set_pet_hit_mask(
    window: WebviewWindow,
    request: MaskRequest,
) -> Result<View, StoreError> {
    let state = pet(&window)?;
    client(&state, request.client_epoch)?;
    if request.mask.len() != 112 * 112
        || request.mask.iter().any(|v| *v > 1)
        || !request.mask.contains(&1)
    {
        return Err(StoreError {
            code: "PET_MASK",
            message: "班班轮廓暂不可确认。",
        });
    }
    pet_native::input(&window, &state, false, None)?;
    let mut inner = state.lock().map_err(|_| pet_native::failure())?;
    if inner.view.client_epoch == request.client_epoch
        && request.sequence > inner.view.mask_sequence
    {
        inner.mask = request.mask;
        inner.view.mask_sequence = request.sequence;
        inner.changed();
    }
    state.wake.notify_all();
    Ok(inner.view.clone())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PaintRequest {
    client_epoch: u64,
    view_sequence: u64,
    mask_sequence: u64,
}
#[tauri::command]
pub(crate) async fn confirm_pet_presentation(
    window: WebviewWindow,
    request: PaintRequest,
) -> Result<View, StoreError> {
    let state = pet(&window)?;
    let mut inner = state.lock().map_err(|_| pet_native::failure())?;
    if inner.view.client_epoch != request.client_epoch {
        return Err(pet_native::failure());
    }
    if request.view_sequence == inner.view.sequence {
        inner.view_ack = request.view_sequence;
    }
    if request.mask_sequence == inner.view.mask_sequence {
        inner.mask_ack = request.mask_sequence;
    }
    state.wake.notify_all();
    Ok(inner.view.clone())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PolicyRequest {
    client_epoch: u64,
    sequence: u64,
    client_ready: bool,
    #[serde(default)]
    keyboard_focused: bool,
    reduced_motion: bool,
    page_visible: bool,
}
#[tauri::command]
pub(crate) async fn set_pet_policy(
    window: WebviewWindow,
    request: PolicyRequest,
) -> Result<View, StoreError> {
    let state = pet(&window)?;
    let mut inner = state.lock().map_err(|_| pet_native::failure())?;
    if inner.view.client_epoch != request.client_epoch {
        return Err(pet_native::failure());
    }
    if request.sequence > inner.view.policy_sequence {
        let changed = inner.client_ready != request.client_ready
            || inner.page_visible != request.page_visible
            || inner.reduced_motion != request.reduced_motion;
        inner.client_ready = request.client_ready;
        inner.keyboard_focused = request.keyboard_focused;
        inner.page_visible = request.page_visible;
        inner.reduced_motion = request.reduced_motion;
        inner.view.policy_sequence = request.sequence;
        if changed {
            inner.barrier();
        }
    }
    state.wake.notify_all();
    Ok(inner.view.clone())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClaimRequest {
    client_epoch: u64,
    feedback_id: String,
    workspace_epoch: String,
    play_epoch: u64,
}
#[tauri::command]
pub(crate) async fn claim_pet_feedback(
    window: WebviewWindow,
    state: State<'_, LocalState>,
    request: ClaimRequest,
) -> Result<Option<Grant>, StoreError> {
    let pet = pet(&window)?;
    client(&pet, request.client_epoch)?;
    if request.feedback_id.len() > 100 || request.workspace_epoch.len() > 100 {
        return Err(pet_native::failure());
    }
    call(state, move |store| {
        client(&pet, request.client_epoch)?;
        let valid = pet
            .source()
            .is_some_and(|source| store.pet_receipt_valid(&source).unwrap_or(false));
        Ok(pet.claim(
            &request.feedback_id,
            &request.workspace_epoch,
            request.play_epoch,
            valid,
        ))
    })
    .await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MenuRequest {
    client_epoch: u64,
    keyboard: bool,
}
#[derive(Serialize)]
pub(crate) struct Prepared {
    token: u64,
    view: View,
}
#[tauri::command]
pub(crate) async fn prepare_pet_menu(
    window: WebviewWindow,
    request: MenuRequest,
) -> Result<Prepared, StoreError> {
    let state = pet(&window)?;
    client(&state, request.client_epoch)?;
    pet_native::input(&window, &state, false, None)?;
    let mut inner = state.lock().map_err(|_| pet_native::failure())?;
    if !inner.view.visible || inner.view.dragging || inner.view.menu_open {
        return Err(pet_native::failure());
    }
    inner.layout(false);
    inner.view.menu_open = true;
    inner.menu_token += 1;
    inner.menu_prepared = Some(Instant::now());
    inner.barrier();
    if request.keyboard {
        inner.leave_since = None;
    }
    state.wake.notify_all();
    Ok(Prepared {
        token: inner.menu_token,
        view: inner.view.clone(),
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TokenRequest {
    client_epoch: u64,
    token: u64,
}
#[tauri::command]
pub(crate) async fn popup_pet_menu(
    window: WebviewWindow,
    request: TokenRequest,
) -> Result<View, StoreError> {
    let state = pet(&window)?;
    client(&state, request.client_epoch)?;
    {
        let mut inner = state.lock().map_err(|_| pet_native::failure())?;
        if !inner.view.visible
            || !inner.view.menu_open
            || inner.menu_token != request.token
            || inner
                .menu_prepared
                .is_none_or(|at| at.elapsed().as_secs() >= 2)
            || !inner.painted()
        {
            return Err(pet_native::failure());
        }
        inner.menu_popping = true;
    }
    let result = (|| {
        let main = MenuItem::with_id(&window, "pet-main", "打开工作台", true, None::<&str>)?;
        let quick = MenuItem::with_id(&window, "pet-quick", "快速录入", true, None::<&str>)?;
        let hide = MenuItem::with_id(&window, "pet-hide", "隐藏班班", true, None::<&str>)?;
        let menu = Menu::with_items(&window, &[&main, &quick, &hide])?;
        window.popup_menu_at(&menu, LogicalPosition::new(96.0, 110.0))
    })();
    {
        let mut inner = state.lock().map_err(|_| pet_native::failure())?;
        inner.menu_popping = false;
        inner.menu_prepared = None;
        inner.view.menu_open = false;
        inner.leave_since = Some(Instant::now());
        inner.barrier();
        state.wake.notify_all();
    }
    result.map_err(|_| pet_native::failure())?;
    pet_native::view(&state)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClientRequest {
    client_epoch: u64,
}
#[tauri::command]
pub(crate) async fn prepare_pet_drag(
    window: WebviewWindow,
    request: ClientRequest,
) -> Result<Prepared, StoreError> {
    let state = pet(&window)?;
    client(&state, request.client_epoch)?;
    if !pet_native::button_down() {
        return Err(StoreError {
            code: "PET_DRAG_RELEASED",
            message: "拖动已结束。",
        });
    }
    pet_native::input(&window, &state, false, None)?;
    let mut inner = state.lock().map_err(|_| pet_native::failure())?;
    if !inner.view.visible || inner.view.menu_open {
        return Err(pet_native::failure());
    }
    inner.layout(false);
    inner.view.dragging = true;
    inner.drag_generation += 1;
    inner.barrier();
    state.wake.notify_all();
    Ok(Prepared {
        token: inner.drag_generation,
        view: inner.view.clone(),
    })
}
#[tauri::command]
pub(crate) async fn start_pet_drag(
    window: WebviewWindow,
    request: TokenRequest,
) -> Result<View, StoreError> {
    let state = pet(&window)?;
    client(&state, request.client_epoch)?;
    if !pet_native::button_down() {
        return Err(StoreError {
            code: "PET_DRAG_RELEASED",
            message: "拖动已结束。",
        });
    }
    let valid = {
        let inner = state.lock().map_err(|_| pet_native::failure())?;
        inner.view.visible
            && inner.view.dragging
            && !inner.view.menu_open
            && inner.drag_generation == request.token
            && inner.painted()
            && pet_native::button_down()
    };
    if !valid {
        return Err(pet_native::failure());
    }
    if window.start_dragging().is_err() {
        let mut inner = state.lock().map_err(|_| pet_native::failure())?;
        if inner.drag_generation == request.token {
            inner.view.dragging = false;
            inner.barrier();
        }
        return Err(pet_native::failure());
    }
    state.wake.notify_all();
    pet_native::view(&state)
}
