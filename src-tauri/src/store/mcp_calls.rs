use super::*;
use rusqlite::OptionalExtension;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const CATALOG_LIMIT: usize = 512 * 1024;
const ARGUMENT_LIMIT: usize = 64 * 1024;
const UNKNOWN: &str = "MCP_RESULT_UNKNOWN";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum McpTaskOwner {
    Trial,
    Business,
}

impl McpTaskOwner {
    fn table(self) -> &'static str {
        match self {
            Self::Trial => "agent_runs",
            Self::Business => "runs",
        }
    }

    fn column(self) -> &'static str {
        match self {
            Self::Trial => "agent_run_id",
            Self::Business => "run_id",
        }
    }

    fn scope(self) -> &'static str {
        match self {
            Self::Trial => "purpose='role_trial' AND agent_id='organizer'",
            Self::Business => "kind IN ('extract','revise')",
        }
    }

    fn result_column(self) -> &'static str {
        match self {
            Self::Trial => "result_json",
            Self::Business => "preview_json",
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum McpCallFault {
    BeforeBegin,
    AfterBegin,
    BeforeResponse,
    AfterResponse,
}

#[cfg(test)]
fn test_call_fault() -> StoreError {
    StoreError::new(
        "MCP_CALL_TEST_FAULT",
        "Synthetic MCP call persistence failure.",
    )
}

pub(crate) struct PreparedTrialMcp {
    pub(crate) revision: String,
    pub(crate) servers: Vec<PreparedTrialMcpServer>,
}

pub(crate) struct PreparedTrialMcpServer {
    pub(crate) server: McpServer,
    pub(crate) prepared: PreparedMcpProbe,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TrialMcpTool {
    pub(crate) server_id: String,
    pub(crate) tool_name: String,
    pub(crate) model_name: String,
    pub(crate) schema_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct McpCallInput {
    pub(crate) id: String,
    pub(crate) model_call_id: String,
    pub(crate) model_name: String,
    pub(crate) configuration_revision: String,
    pub(crate) schema_sha256: String,
    pub(crate) arguments_json: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrialMcpSnapshot {
    revision: String,
    servers: Vec<McpServer>,
    catalogs: BTreeMap<String, McpDiscoveredCatalog>,
    mapping: Vec<TrialMcpTool>,
    #[serde(
        default,
        rename = "remoteClose",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    remote_close: BTreeMap<String, McpHttpClose>,
}

fn invalid_call() -> StoreError {
    StoreError::new(
        "MCP_CALL_INVALID",
        "工具调用归属、参数或阶段无效，未继续执行。",
    )
}

fn replay() -> StoreError {
    StoreError::new("MCP_CALL_REPLAY", "这次工具调用已登记，未重复执行。")
}

pub(super) fn unknown_error() -> StoreError {
    StoreError::new(UNKNOWN, "操作可能已生效，请先核对外部结果。")
}

fn hash(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}

fn schema_v4(db: &Connection) -> Result<bool> {
    Ok(db
        .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
        .map_err(db_error)?
        == 4)
}

fn running_snapshot(db: &Connection, owner: McpTaskOwner, id: &str) -> Result<Value> {
    let row = db
        .query_row(
            &format!(
                "SELECT status,snapshot_json,error_code FROM {} WHERE id=?1 AND {}",
                owner.table(),
                owner.scope()
            ),
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(invalid_call)?;
    if row.2.as_deref() == Some(UNKNOWN) {
        return Err(unknown_error());
    }
    if row.0 != "running" {
        return Err(invalid_call());
    }
    serde_json::from_str(&row.1).map_err(|_| invalid_call())
}

fn frozen(snapshot: &Value) -> Result<TrialMcpSnapshot> {
    serde_json::from_value(snapshot.get("mcp").cloned().ok_or_else(invalid_call)?)
        .map_err(|_| invalid_call())
}

fn write_snapshot(db: &Connection, owner: McpTaskOwner, id: &str, snapshot: &Value) -> Result<()> {
    let text = serde_json::to_string(snapshot).map_err(|_| invalid_call())?;
    let n = db
        .execute(
            &format!(
                "UPDATE {} SET snapshot_json=?2 WHERE id=?1 AND {} AND status='running'",
                owner.table(),
                owner.scope()
            ),
            params![id, text],
        )
        .map_err(db_error)?;
    if n != 1 {
        return Err(invalid_call());
    }
    Ok(())
}

fn settle(
    db: &Connection,
    owner: McpTaskOwner,
    id: Option<&str>,
    owned: Option<&str>,
) -> Result<()> {
    if !schema_v4(db)? {
        return Ok(());
    }
    let tx = db.unchecked_transaction().map_err(db_error)?;
    let now = now_ms()?;
    let table = owner.table();
    let column = owner.column();
    let scope = owner.scope();
    let result = owner.result_column();
    tx.execute(&format!("UPDATE tool_calls SET send_state='unknown',response_category=NULL,response_summary=NULL,finished_at_ms=MAX(?1,created_at_ms) WHERE send_state='possibly_sent' AND {column} IN (SELECT id FROM {table} WHERE {scope} AND (?2 IS NULL OR id=?2) AND (?3 IS NULL OR id<>?3))"), params![now,id,owned]).map_err(db_error)?;
    tx.execute(&format!("UPDATE {table} SET status='failed',error_code='MCP_RESULT_UNKNOWN',{result}=NULL,finished_at_ms=CASE WHEN error_code IS 'MCP_RESULT_UNKNOWN' AND finished_at_ms IS NOT NULL THEN finished_at_ms ELSE MAX(?1,created_at_ms) END WHERE {scope} AND (?2 IS NULL OR id=?2) AND (?3 IS NULL OR id<>?3) AND (status<>'failed' OR error_code IS NOT 'MCP_RESULT_UNKNOWN' OR {result} IS NOT NULL OR finished_at_ms IS NULL) AND EXISTS(SELECT 1 FROM tool_calls WHERE {column}={table}.id AND send_state='unknown')"), params![now,id,owned]).map_err(db_error)?;
    tx.commit().map_err(db_error)
}

pub(super) fn recover_trial_mcp(db: &Connection, owned: Option<&str>) -> Result<()> {
    settle(db, McpTaskOwner::Trial, None, owned)
}

pub(super) fn recover_business_mcp(db: &Connection) -> Result<()> {
    settle(db, McpTaskOwner::Business, None, None)
}

impl AppStore {
    pub(crate) fn record_mcp_task_close(
        &mut self,
        owner: McpTaskOwner,
        id: &str,
        server: &str,
        close: McpHttpClose,
    ) -> Result<()> {
        let mut snapshot = running_snapshot(self.db()?, owner, id)?;
        let mut mcp = frozen(&snapshot)?;
        if !mcp
            .servers
            .iter()
            .any(|s| s.id == server && s.settings.kind() == "http")
        {
            return Err(invalid_call());
        }
        mcp.remote_close.insert(server.into(), close);
        snapshot["mcp"] = serde_json::to_value(mcp).map_err(|_| invalid_call())?;
        write_snapshot(self.db()?, owner, id, &snapshot)
    }
    pub(crate) fn prepare_mcp_task(
        &mut self,
        owner: McpTaskOwner,
        id: &str,
    ) -> Result<PreparedTrialMcp> {
        let mut snapshot = running_snapshot(self.db()?, owner, id)?;
        if snapshot.get("mcp").is_some() {
            return Err(invalid_call());
        }
        if snapshot["model"]["capabilities"]["toolCall"] == false || !schema_v4(self.db()?)? {
            return Ok(PreparedTrialMcp {
                revision: String::new(),
                servers: Vec::new(),
            });
        }
        self.require_mcp_schema()?;
        let configuration = self.mcp_configuration()?;
        let mut servers = Vec::new();
        let mut public = Vec::new();
        for server in configuration
            .servers
            .into_iter()
            .filter(|s| s.settings.enabled)
        {
            let run_directory = self.run_directory(id)?;
            let transport = match &server.settings.transport {
                McpTransportConfig::Stdio(stdio) => {
                    let env = self
                        .prepare_mcp_environment(&server.id, &configuration.revision)?
                        .into_values();
                    let cwd = stdio
                        .cwd
                        .as_ref()
                        .map(PathBuf::from)
                        .unwrap_or_else(|| run_directory.clone());
                    if !cwd.is_dir() {
                        return Err(StoreError::new(
                            "MCP_DIRECTORY_MISSING",
                            "服务工作目录不可用。",
                        ));
                    }
                    PreparedMcpTransport::Stdio {
                        command: stdio.command.clone(),
                        args: stdio.args.clone(),
                        cwd,
                        env,
                        sensitive_names: stdio
                            .env
                            .iter()
                            .filter(|e| e.source != "literal")
                            .map(|e| e.name.clone())
                            .collect(),
                    }
                }
                McpTransportConfig::Http(http) => PreparedMcpTransport::Http {
                    url: super::mcp_config::checked_http_url(&http.url)?,
                    headers: self.prepare_mcp_http_headers(
                        &server.id,
                        &configuration.revision,
                        false,
                    )?,
                },
            };
            let prepared = PreparedMcpProbe {
                run_directory,
                transport,
            };
            public.push(server.clone());
            servers.push(PreparedTrialMcpServer { server, prepared });
        }
        let revision = configuration.revision;
        snapshot["mcp"] = serde_json::to_value(TrialMcpSnapshot {
            revision: revision.clone(),
            servers: public,
            catalogs: BTreeMap::new(),
            mapping: Vec::new(),
            remote_close: BTreeMap::new(),
        })
        .map_err(|_| invalid_call())?;
        write_snapshot(self.db()?, owner, id, &snapshot)?;
        Ok(PreparedTrialMcp { revision, servers })
    }

    pub(crate) fn bind_mcp_task_catalog(
        &mut self,
        owner: McpTaskOwner,
        id: &str,
        server_id: &str,
        catalog: &McpDiscoveredCatalog,
        sensitive: &[String],
    ) -> Result<Vec<TrialMcpTool>> {
        self.require_mcp_schema()?;
        let tx = self.db()?.unchecked_transaction().map_err(db_error)?;
        let mut snapshot = running_snapshot(&tx, owner, id)?;
        let mut mcp = frozen(&snapshot)?;
        if !mcp.servers.iter().any(|s| s.id == server_id) || mcp.catalogs.contains_key(server_id) {
            return Err(invalid_call());
        }
        let receipt = catalog.validate(sensitive)?;
        let mut names: BTreeSet<_> = mcp.mapping.iter().map(|t| t.model_name.clone()).collect();
        names.extend(["read", "bash", "Read", "Bash"].map(String::from));
        let mut mapping = Vec::new();
        for tool in receipt.tools {
            let digest = hash(format!("{server_id}\0{}", tool.name).as_bytes());
            let model_name = format!("mcp_{}", &digest[..56]);
            if !names.insert(model_name.clone()) {
                return Err(invalid_call());
            }
            mapping.push(TrialMcpTool {
                server_id: server_id.into(),
                tool_name: tool.name,
                model_name,
                schema_sha256: tool.schema_sha256,
            });
        }
        mcp.catalogs.insert(server_id.into(), catalog.clone());
        mcp.mapping.extend(mapping.clone());
        let mut total = 0;
        for value in mcp.catalogs.values() {
            total += serde_json::to_vec(value).map_err(|_| invalid_call())?.len();
        }
        if mcp.mapping.len() > 256 || total > CATALOG_LIMIT {
            return Err(StoreError::new(
                "MCP_CATALOG_INVALID",
                "工具目录超过256项或512KiB，未注册部分目录。",
            ));
        }
        snapshot["mcp"] = serde_json::to_value(mcp).map_err(|_| invalid_call())?;
        write_snapshot(&tx, owner, id, &snapshot)?;
        tx.commit().map_err(db_error)?;
        Ok(mapping)
    }

    pub(crate) fn begin_mcp_task_call(
        &mut self,
        owner: McpTaskOwner,
        id: &str,
        input: McpCallInput,
    ) -> Result<()> {
        self.require_mcp_schema()?;
        let valid_id = |value: &str, limit: usize| {
            !value.is_empty()
                && value.len() <= limit
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        };
        if !valid_id(&input.id, 128)
            || input.model_call_id.is_empty()
            || input.model_call_id.len() > 256
            || input.model_call_id.chars().any(char::is_control)
            || input.arguments_json.len() > ARGUMENT_LIMIT
        {
            return Err(invalid_call());
        }
        let args: Value =
            serde_json::from_str(&input.arguments_json).map_err(|_| invalid_call())?;
        if !args.is_object() {
            return Err(invalid_call());
        }
        #[cfg(test)]
        let fault = self.mcp_call_fault.take();
        let tx = self.db()?.unchecked_transaction().map_err(db_error)?;
        let snapshot = running_snapshot(&tx, owner, id)?;
        let mcp = frozen(&snapshot)?;
        if mcp.revision != input.configuration_revision || mcp.catalogs.len() != mcp.servers.len() {
            return Err(invalid_call());
        }
        let tool = mcp
            .mapping
            .iter()
            .find(|t| t.model_name == input.model_name && t.schema_sha256 == input.schema_sha256)
            .ok_or_else(invalid_call)?;
        let exists: bool = tx.query_row(&format!("SELECT EXISTS(SELECT 1 FROM tool_calls WHERE id=?1 OR ({}=?2 AND model_call_id=?3))", owner.column()), params![input.id,id,input.model_call_id], |r| r.get(0)).map_err(db_error)?;
        if exists {
            return Err(replay());
        }
        let pending: bool = tx.query_row(&format!("SELECT EXISTS(SELECT 1 FROM tool_calls WHERE {}=?1 AND send_state IN ('possibly_sent','unknown'))", owner.column()), [id], |r| r.get(0)).map_err(db_error)?;
        if pending {
            return Err(invalid_call());
        }
        tx.execute(&format!("INSERT INTO tool_calls(id,{},model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,created_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'possibly_sent',?9)", owner.column()), params![input.id,id,input.model_call_id,input.configuration_revision,input.schema_sha256,tool.server_id,tool.tool_name,hash(input.arguments_json.as_bytes()),now_ms()?]).map_err(db_error)?;
        #[cfg(test)]
        if fault == Some(McpCallFault::BeforeBegin) {
            return Err(test_call_fault());
        }
        tx.commit().map_err(db_error)?;
        #[cfg(test)]
        if fault == Some(McpCallFault::AfterBegin) {
            return Err(test_call_fault());
        }
        Ok(())
    }

    pub(crate) fn confirm_mcp_task_call(
        &mut self,
        owner: McpTaskOwner,
        id: &str,
        call_id: &str,
        is_error: bool,
    ) -> Result<()> {
        self.require_mcp_schema()?;
        #[cfg(test)]
        let fault = self.mcp_call_fault.take();
        let tx = self.db()?.unchecked_transaction().map_err(db_error)?;
        running_snapshot(&tx, owner, id)?;
        let category = if is_error { "tool_error" } else { "success" };
        let n = tx.execute(&format!("UPDATE tool_calls SET send_state='responded',response_category=?3,response_summary=NULL,finished_at_ms=MAX(?4,created_at_ms) WHERE id=?1 AND {}=?2 AND send_state='possibly_sent'", owner.column()), params![call_id,id,category,now_ms()?]).map_err(db_error)?;
        if n != 1 {
            return Err(invalid_call());
        }
        #[cfg(test)]
        if fault == Some(McpCallFault::BeforeResponse) {
            return Err(test_call_fault());
        }
        tx.commit().map_err(db_error)?;
        #[cfg(test)]
        if fault == Some(McpCallFault::AfterResponse) {
            return Err(test_call_fault());
        }
        Ok(())
    }

    pub(crate) fn mcp_task_unknown(&self, owner: McpTaskOwner, id: &str) -> Result<bool> {
        if !schema_v4(self.db()?)? {
            return Ok(false);
        }
        self.db()?
            .query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM tool_calls WHERE {}=?1 AND send_state='unknown')",
                    owner.column()
                ),
                [id],
                |r| r.get(0),
            )
            .map_err(db_error)
    }

    pub(crate) fn settle_mcp_task(&self, owner: McpTaskOwner, id: &str) -> Result<()> {
        settle(self.db()?, owner, Some(id), None)
    }

    pub(crate) fn prepare_trial_mcp(&mut self, id: &str) -> Result<PreparedTrialMcp> {
        self.prepare_mcp_task(McpTaskOwner::Trial, id)
    }

    #[cfg(test)]
    pub(crate) fn bind_trial_mcp_catalog(
        &mut self,
        id: &str,
        server_id: &str,
        catalog: &McpDiscoveredCatalog,
        sensitive: &[String],
    ) -> Result<Vec<TrialMcpTool>> {
        self.bind_mcp_task_catalog(McpTaskOwner::Trial, id, server_id, catalog, sensitive)
    }

    #[cfg(test)]
    pub(crate) fn begin_trial_mcp_call(&mut self, id: &str, input: McpCallInput) -> Result<()> {
        self.begin_mcp_task_call(McpTaskOwner::Trial, id, input)
    }

    #[cfg(test)]
    pub(crate) fn confirm_trial_mcp_call(
        &mut self,
        id: &str,
        call_id: &str,
        is_error: bool,
    ) -> Result<()> {
        self.confirm_mcp_task_call(McpTaskOwner::Trial, id, call_id, is_error)
    }

    pub(crate) fn trial_mcp_unknown(&self, id: &str) -> Result<bool> {
        self.mcp_task_unknown(McpTaskOwner::Trial, id)
    }

    pub(crate) fn settle_trial_mcp(&self, id: &str) -> Result<()> {
        self.settle_mcp_task(McpTaskOwner::Trial, id)
    }

    #[cfg(test)]
    pub(crate) fn test_mcp_call_fault(&mut self, fault: Option<McpCallFault>) {
        self.mcp_call_fault = fault;
    }

    #[cfg(test)]
    pub(crate) fn test_mcp_query_only(&self, readonly: bool) -> Result<()> {
        self.db()?
            .pragma_update(None, "query_only", readonly)
            .map_err(db_error)
    }
}

#[cfg(test)]
#[path = "mcp_calls_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "mcp_formal_calls_tests.rs"]
mod formal_tests;
