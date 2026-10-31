use crate::local_store::{
    AppStore, BatchSummary, Candidate, ImportBatch, ModelConfigInput, ModelConfigSave,
    ModelConfiguration, ModelRun, ProfileInput, ProfileSave, SignChoice, StoreError, Todo,
    TodoEvent, TodoInput, UserProfile, WorkspaceInfo,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

#[derive(Clone)]
pub struct LocalState {
    app_dir: PathBuf,
    store: Arc<Mutex<Option<AppStore>>>,
    #[cfg(any(feature = "s33-mcp-verification", feature = "s33-mcp-ui-verification"))]
    verification: Option<Arc<crate::verification_root::VerificationRoot>>,
}
impl LocalState {
    pub fn new(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            store: Arc::new(Mutex::new(None)),
            #[cfg(any(feature = "s33-mcp-verification", feature = "s33-mcp-ui-verification"))]
            verification: None,
        }
    }
    #[cfg(any(feature = "s33-mcp-verification", feature = "s33-mcp-ui-verification"))]
    pub(crate) fn with_verification_guard(
        mut self,
        guard: Arc<crate::verification_root::VerificationRoot>,
    ) -> Self {
        self.verification = Some(guard);
        self
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn native_model_pin(&self) -> Option<serde_json::Value> {
        self.verification
            .as_ref()
            .and_then(|guard| guard.native_pin())
    }
    pub(crate) fn access<T>(
        &self,
        action: impl FnOnce(&mut AppStore) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let mut guard = self.store.lock().map_err(|_| StoreError {
            code: "STORAGE_UNAVAILABLE",
            message: "本地存储暂不可用，请重启应用。",
        })?;
        #[cfg(any(feature = "s33-mcp-verification", feature = "s33-mcp-ui-verification"))]
        if let Some(verification) = &self.verification {
            verification.validate()?;
        }
        #[cfg(feature = "s33-mcp-ui-verification")]
        if let Some(verification) = self
            .verification
            .as_ref()
            .filter(|verification| guard.is_none() && verification.native_pin().is_some())
        {
            *guard = Some(verification.open_native_store()?);
        }
        if guard.is_none() {
            *guard = Some(AppStore::open(self.app_dir.clone())?);
        }
        action(guard.as_mut().expect("store initialized above"))
    }
}

async fn call<T, F>(state: State<'_, LocalState>, action: F) -> Result<T, StoreError>
where
    T: Send + 'static,
    F: FnOnce(&mut AppStore) -> Result<T, StoreError> + Send + 'static,
{
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.access(action))
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
    if cfg!(feature = "s33-mcp-ui-verification") {
        return Err(StoreError {
            code: "VERIFY_INPUT",
            message: "隔离验收包不允许更换工作根。",
        });
    }
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

#[tauri::command]
pub async fn read_model_configuration(
    state: State<'_, LocalState>,
) -> Result<Option<ModelConfiguration>, StoreError> {
    call(state, |s| s.read_models()).await
}
#[tauri::command]
pub async fn save_model_configuration(
    state: State<'_, LocalState>,
    input: ModelConfigInput,
) -> Result<ModelConfigSave, StoreError> {
    call(state, move |s| s.save_models(input)).await
}
#[tauri::command]
pub async fn list_import_batches(
    state: State<'_, LocalState>,
) -> Result<Vec<BatchSummary>, StoreError> {
    call(state, |s| s.list_batches()).await
}
#[tauri::command]
pub async fn read_import_batch(
    state: State<'_, LocalState>,
    id: String,
) -> Result<ImportBatch, StoreError> {
    call(state, move |s| s.batch(&id)).await
}
#[tauri::command]
pub async fn todo_source_links(
    state: State<'_, LocalState>,
    id: String,
) -> Result<Vec<crate::local_store::TodoSourceLink>, StoreError> {
    call(state, move |s| s.todo_source_links(&id)).await
}
#[tauri::command]
pub async fn read_model_run(
    state: State<'_, LocalState>,
    runtime: State<'_, crate::runtime_host::RuntimeState>,
    id: String,
) -> Result<ModelRun, StoreError> {
    let active = runtime.active_run();
    call(state, move |s| {
        let run = s.model_run(&id)?;
        if active.as_deref() != Some(&id) && ["running", "queued"].contains(&run.status.as_str()) {
            s.interrupt_model_run(&id)
        } else {
            Ok(run)
        }
    })
    .await
}

fn ingestion_changed(app: &tauri::AppHandle, source: &str) {
    let _ = app.emit(
        "organizer-changed",
        serde_json::json!({"sourceId":source,"phase":"changed"}),
    );
}
#[tauri::command]
pub async fn save_candidate(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    id: String,
    expected_version: i64,
    input: TodoInput,
    time_reviewed: bool,
    operation_id: String,
) -> Result<Candidate, StoreError> {
    let c = call(state, move |s| {
        s.edit_candidate(&id, expected_version, input, time_reviewed, &operation_id)
    })
    .await?;
    ingestion_changed(&app, &c.source_id);
    Ok(c)
}
#[tauri::command]
pub async fn discard_candidate(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    id: String,
    expected_version: i64,
    operation_id: String,
) -> Result<Candidate, StoreError> {
    let c = call(state, move |s| {
        s.discard_candidate(&id, expected_version, &operation_id)
    })
    .await?;
    ingestion_changed(&app, &c.source_id);
    Ok(c)
}
#[tauri::command]
pub async fn apply_candidate_preview(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    run_id: String,
    expected_version: i64,
    operation_id: String,
) -> Result<Candidate, StoreError> {
    let c = call(state, move |s| {
        s.apply_preview(&run_id, expected_version, &operation_id)
    })
    .await?;
    ingestion_changed(&app, &c.source_id);
    Ok(c)
}
#[tauri::command]
pub async fn sign_candidates(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    choices: Vec<SignChoice>,
    operation_id: String,
) -> Result<Vec<Todo>, StoreError> {
    let todos = call(state, move |s| s.sign_candidates(choices, &operation_id)).await?;
    for todo in &todos {
        changed(&app, todo);
    }
    let _ = app.emit("organizer-changed", serde_json::json!({"phase":"changed"}));
    Ok(todos)
}
#[tauri::command]
pub async fn cancel_model_run(
    app: tauri::AppHandle,
    state: State<'_, LocalState>,
    runtime: State<'_, crate::runtime_host::RuntimeState>,
    id: String,
) -> Result<ModelRun, StoreError> {
    let selected = id.clone();
    let run = call(state, move |s| s.cancel_run(&selected)).await?;
    runtime.cancel(&id);
    let _ = app.emit(
        "organizer-changed",
        serde_json::json!({"runId":id,"phase":"changed"}),
    );
    Ok(run)
}

#[tauri::command]
pub async fn read_agent_configuration(
    state: State<'_, LocalState>,
    agent_id: String,
) -> Result<crate::local_store::AgentConfig, StoreError> {
    call(state, move |s| s.read_agent_config(&agent_id)).await
}
#[tauri::command]
pub async fn save_agent_configuration(
    state: State<'_, LocalState>,
    input: crate::local_store::AgentConfigInput,
) -> Result<crate::local_store::AgentConfigSave, StoreError> {
    call(state, move |s| s.save_agent_config(input)).await
}
#[tauri::command]
pub async fn reset_agent_configuration(
    state: State<'_, LocalState>,
    agent_id: String,
    expected_revision: String,
) -> Result<crate::local_store::AgentConfigSave, StoreError> {
    call(state, move |s| {
        s.reset_agent_config(&agent_id, &expected_revision)
    })
    .await
}
#[tauri::command]
pub async fn read_agent_trial(
    state: State<'_, LocalState>,
    runtime: State<'_, crate::runtime_host::RuntimeState>,
    id: String,
) -> Result<crate::local_store::AgentRun, StoreError> {
    let active = runtime.active_trial();
    call(state, move |s| {
        let run = s.agent_run(&id)?;
        if active.as_deref() != Some(&id) && run.status == "running" {
            s.interrupt_agent_trials(active.as_deref())?;
        }
        s.agent_run(&id)
    })
    .await
}
#[tauri::command]
pub async fn latest_agent_trial(
    state: State<'_, LocalState>,
    agent_id: String,
) -> Result<Option<crate::local_store::AgentRun>, StoreError> {
    call(state, move |s| s.latest_agent_trial(&agent_id)).await
}
#[tauri::command]
pub async fn cancel_agent_trial(
    state: State<'_, LocalState>,
    runtime: State<'_, crate::runtime_host::RuntimeState>,
    id: String,
) -> Result<crate::local_store::AgentRun, StoreError> {
    runtime.cancel(&id);
    let key = id.clone();
    let run = call(state, move |s| s.cancel_agent_trial(&key)).await?;
    Ok(run)
}

#[tauri::command]
pub async fn read_application_settings(
    state: State<'_, LocalState>,
) -> Result<crate::local_store::ApplicationSettings, StoreError> {
    call(state, |s| s.application_settings()).await
}
#[tauri::command]
pub async fn save_application_settings(
    state: State<'_, LocalState>,
    input: crate::local_store::AppSettingsInput,
) -> Result<crate::local_store::ApplicationSettingsSave, StoreError> {
    call(state, move |s| s.save_application_settings(input)).await
}

#[tauri::command]
pub async fn read_mcp_configuration(
    state: State<'_, LocalState>,
) -> Result<crate::local_store::McpConfigurationView, StoreError> {
    call(state, |s| s.mcp_configuration()).await
}
#[tauri::command]
pub async fn save_mcp_server(
    state: State<'_, LocalState>,
    input: crate::local_store::McpServerInput,
) -> Result<crate::local_store::McpConfigSave, StoreError> {
    call(state, move |s| s.save_mcp_server(input)).await
}
#[tauri::command]
pub async fn remove_mcp_server(
    runtime: State<'_, crate::runtime_host::RuntimeState>,
    state: State<'_, LocalState>,
    input: crate::local_store::McpRemoveInput,
) -> Result<crate::local_store::McpConfigSave, StoreError> {
    let runtime = runtime.inner().clone();
    let local = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.remove_mcp_server(&local, input))
        .await
        .map_err(|_| StoreError {
            code: "STORAGE_UNAVAILABLE",
            message: "本地任务中断，请重试。",
        })?
}

#[tauri::command]
pub async fn save_mcp_secrets(
    state: State<'_, LocalState>,
    input: crate::local_store::McpSecretInput,
) -> Result<crate::local_store::McpConfigSave, StoreError> {
    call(state, move |s| s.save_mcp_secrets(input)).await
}
