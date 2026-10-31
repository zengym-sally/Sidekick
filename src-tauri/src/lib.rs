//! Tauri 宿主库入口：只保留模块清单、feature 门控与 `run` 装配委托。
//!
//! 源码按职责归组在 `app/`（装配与 IPC）、`store/`（业务写入）、`host/`（外部宿主）、
//! `diagnostics/`（探针）；用 `#[path]` 保持模块名、公开路径与测试过滤不变。

mod app;

#[path = "app/commands.rs"]
mod store_commands;

#[path = "host/mcp_host.rs"]
mod mcp_host;

#[path = "host/mcp_trial.rs"]
mod mcp_trial;

#[path = "host/runtime_host.rs"]
mod runtime_host;

#[path = "host/skills_host.rs"]
mod skills_host;

#[path = "diagnostics/storage_probe.rs"]
mod storage_probe;

#[path = "diagnostics/s0_probe.rs"]
mod s0_probe;

#[path = "store/local_store.rs"]
pub mod local_store;

#[path = "store/mcp_upgrade.rs"]
mod mcp_upgrade;

#[cfg(feature = "s33-mcp-verification")]
#[path = "diagnostics/verification.rs"]
pub mod mcp_verification;

#[cfg(any(feature = "s33-mcp-verification", feature = "s33-mcp-ui-verification"))]
#[path = "diagnostics/verification_root.rs"]
mod verification_root;

#[cfg(feature = "s33-mcp-ui-verification")]
#[path = "diagnostics/mcp_ui_verification.rs"]
mod mcp_ui_verification;

pub fn run() {
    app::run();
}
