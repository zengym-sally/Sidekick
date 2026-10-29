use crate::local_store::{
    AppStore, ProfileInput, ProfileSave, StoreError, Todo, TodoEvent, TodoInput, UserProfile,
    WorkspaceInfo,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

pub struct LocalState {
    app_dir: PathBuf,
    store: Arc<Mutex<Option<AppStore>>>,
}
impl LocalState {
    pub fn new(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            store: Arc::new(Mutex::new(None)),
        }
    }
}

async fn call<T, F>(state: State<'_, LocalState>, action: F) -> Result<T, StoreError>
where
    T: Send + 'static,
    F: FnOnce(&mut AppStore) -> Result<T, StoreError> + Send + 'static,
{
    let shared = state.store.clone();
    let directory = state.app_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared.lock().map_err(|_| StoreError {
            code: "STORAGE_UNAVAILABLE",
            message: "本地存储暂不可用，请重启应用。",
        })?;
        if guard.is_none() {
            *guard = Some(AppStore::open(directory)?);
        }
        action(guard.as_mut().expect("store initialized above"))
    })
    .await
    .map_err(|_| StoreError {
        code: "STORAGE_UNAVAILABLE",
        message: "本地存储任务中断，请重试。",
    })?
}
fn changed(app: &tauri::AppHandle, todo: &Todo) {
    let _ = app.emit(
        "todos-changed",
        serde_json::json!({"id":todo.id,"version":todo.version}),
    );
}

#[tauri::command]
pub async fn workspace_info(state: State<'_, LocalState>) -> Result<WorkspaceInfo, StoreError> {
    call(state, |s| s.info()).await
}
#[tauri::command]
pub async fn read_profile(state: State<'_, LocalState>) -> Result<UserProfile, StoreError> {
    call(state, |s| s.profile()).await
}
#[tauri::command]
pub async fn save_profile(
    state: State<'_, LocalState>,
    input: ProfileInput,
) -> Result<ProfileSave, StoreError> {
    call(state, move |s| s.save_profile(input)).await
}
#[tauri::command]
pub async fn initialize_workspace(
    state: State<'_, LocalState>,
    path: Option<String>,
    time_zone: String,
) -> Result<WorkspaceInfo, StoreError> {
    call(state, move |s| {
        s.initialize(path.map(PathBuf::from), &time_zone)
    })
    .await
}
#[tauri::command]
pub async fn list_todos(state: State<'_, LocalState>) -> Result<Vec<Todo>, StoreError> {
    call(state, |s| s.list()).await
}
#[tauri::command]
pub async fn todo_history(
    state: State<'_, LocalState>,
    id: String,
) -> Result<Vec<TodoEvent>, StoreError> {
    call(state, move |s| s.history(&id)).await
}
#[tauri::command]
pub async fn create_todo(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    input: TodoInput,
    operation_id: String,
) -> Result<Todo, StoreError> {
    let result = call(state, move |s| s.create(input, &operation_id)).await?;
    changed(&app, &result);
    Ok(result)
}
#[tauri::command]
pub async fn update_todo(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    id: String,
    expected_version: i64,
    input: TodoInput,
    operation_id: String,
) -> Result<Todo, StoreError> {
    let result = call(state, move |s| {
        s.update(&id, expected_version, input, &operation_id)
    })
    .await?;
    changed(&app, &result);
    Ok(result)
}
#[tauri::command]
pub async fn set_todo_completed(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    id: String,
    expected_version: i64,
    completed: bool,
    operation_id: String,
) -> Result<Todo, StoreError> {
    let result = call(state, move |s| {
        s.set_completed(&id, expected_version, completed, &operation_id)
    })
    .await?;
    changed(&app, &result);
    Ok(result)
}
#[tauri::command]
pub async fn delete_todo(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    id: String,
    expected_version: i64,
    operation_id: String,
) -> Result<Todo, StoreError> {
    let result = call(state, move |s| {
        s.delete(&id, expected_version, &operation_id)
    })
    .await?;
    changed(&app, &result);
    Ok(result)
}
#[tauri::command]
pub async fn open_workspace_directory(state: State<'_, LocalState>) -> Result<(), StoreError> {
    call(state, |s| {
        let path = s.root()?;
        std::process::Command::new("/usr/bin/open")
            .arg(path)
            .status()
            .map_err(|_| StoreError {
                code: "OPEN_FAILED",
                message: "无法打开目录，可在设置中复制路径。",
            })?
            .success()
            .then_some(())
            .ok_or(StoreError {
                code: "OPEN_FAILED",
                message: "无法打开目录，可在设置中复制路径。",
            })
    })
    .await
}
