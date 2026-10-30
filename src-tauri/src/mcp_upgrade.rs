use crate::local_store::{McpSchemaUpgrade, McpStorageStatus, McpUpgradeInput, StoreError};
use crate::runtime_host::RuntimeState;
use crate::store_commands::LocalState;
use tauri::State;

impl RuntimeState {
    pub(crate) fn confirm_mcp_storage(
        &self,
        local: &LocalState,
        input: McpUpgradeInput,
    ) -> Result<McpSchemaUpgrade, StoreError> {
        let slot = self.slot.lock().map_err(|_| StoreError {
            code: "RUNTIME_BUSY",
            message: "任务状态暂不可确认，未执行升级；请稍后核对。",
        })?;
        if slot.is_some() {
            return Err(StoreError {
                code: "RUNTIME_BUSY",
                message: "请先结束当前任务并等待清理完成，再开启诊断存储。",
            });
        }
        local.access(|s| s.confirm_mcp_upgrade(input))
    }
}

#[tauri::command]
pub async fn read_mcp_storage_status(
    local: State<'_, LocalState>,
) -> Result<McpStorageStatus, StoreError> {
    let local = local.inner().clone();
    tauri::async_runtime::spawn_blocking(move || local.access(|s| s.mcp_storage_status()))
        .await
        .map_err(|_| StoreError {
            code: "MCP_MIGRATION_UNCERTAIN",
            message: "存储状态读取中断，请关闭并重开应用核对。",
        })?
}

#[tauri::command]
pub async fn confirm_mcp_storage_upgrade(
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    input: McpUpgradeInput,
) -> Result<McpSchemaUpgrade, StoreError> {
    let local = local.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.confirm_mcp_storage(&local, input))
        .await
        .map_err(|_| StoreError {
            code: "MCP_MIGRATION_UNCERTAIN",
            message: "存储升级结果未确认，请关闭并重开应用核对，勿重复提交。",
        })?
}
