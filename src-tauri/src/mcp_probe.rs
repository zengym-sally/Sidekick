use super::*;
use rusqlite::OptionalExtension;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpProbeTool {
    pub name: String,
    pub schema_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpProbeCatalog {
    pub tools: Vec<McpProbeTool>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpProbeSnapshot {
    pub server_id: String,
    pub configuration_revision: String,
    pub connect_timeout_ms: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpProbeInput {
    pub server_id: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbe {
    pub id: String,
    pub agent_id: Option<String>,
    pub purpose: &'static str,
    pub status: String,
    pub snapshot: McpProbeSnapshot,
    pub input: McpProbeInput,
    pub result: Option<McpProbeCatalog>,
    pub error_code: Option<String>,
    pub created_at_ms: i64,
    pub finished_at_ms: Option<i64>,
}
pub enum McpProbeFailure {
    CommandMissing,
    DirectoryMissing,
    EnvironmentMissing,
    CredentialUnavailable,
    DependencyMissing,
    Timeout,
    Protocol,
    InvalidCatalog,
    Process,
}
impl McpProbeFailure {
    fn code(self) -> &'static str {
        match self {
            Self::CommandMissing => "MCP_COMMAND_MISSING",
            Self::DirectoryMissing => "MCP_DIRECTORY_MISSING",
            Self::EnvironmentMissing => "MCP_ENV_MISSING",
            Self::CredentialUnavailable => "MCP_CREDENTIAL_UNAVAILABLE",
            Self::DependencyMissing => "MCP_DEPENDENCY_MISSING",
            Self::Timeout => "MCP_TIMEOUT",
            Self::Protocol => "MCP_PROTOCOL",
            Self::InvalidCatalog => "MCP_CATALOG_INVALID",
            Self::Process => "MCP_PROCESS",
        }
    }
}
fn stopped() -> StoreError {
    StoreError::new("MCP_PROBE_STOPPED", "诊断已结束，迟到结果未写入。")
}
fn invalid_probe() -> StoreError {
    StoreError::new(
        "MCP_PROBE_INVALID",
        "诊断记录或工具元数据无效，未更新结果。",
    )
}
fn check_catalog(catalog: &McpProbeCatalog) -> Result<()> {
    if catalog.tools.len() > 64
        || serde_json::to_vec(catalog)
            .map_err(|_| invalid_probe())?
            .len()
            > 32 * 1024
    {
        return Err(StoreError::new(
            "MCP_PROBE_LIMIT",
            "诊断回执超过64工具或32KiB，未记录成功。",
        ));
    }
    let mut names = BTreeSet::new();
    for tool in &catalog.tools {
        if tool.name.is_empty()
            || tool.name.len() > 256
            || tool.name.chars().any(char::is_control)
            || !names.insert(&tool.name)
            || tool.schema_sha256.len() != 64
            || !tool
                .schema_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid_probe());
        }
    }
    Ok(())
}
impl AppStore {
    pub fn begin_mcp_probe(
        &mut self,
        server_id: &str,
        expected_revision: &str,
    ) -> Result<McpProbe> {
        self.require_mcp_schema()?;
        let configuration = self.mcp_configuration()?;
        if configuration.revision != expected_revision {
            return Err(super::mcp_config::conflict());
        }
        let server = configuration
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| StoreError::new("MCP_NOT_FOUND", "服务配置不存在，请重新读取。"))?;
        let snapshot = McpProbeSnapshot {
            server_id: server_id.into(),
            configuration_revision: configuration.revision,
            connect_timeout_ms: server.settings.connect_timeout_ms,
        };
        let input = McpProbeInput {
            server_id: server_id.into(),
        };
        let id = format!("mcp-probe-{}-{}", std::process::id(), nonce());
        self.db()?.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(?1,NULL,'mcp_probe','running',?2,?3,?4)",params![id,serde_json::to_string(&snapshot).map_err(|_|invalid_probe())?,serde_json::to_string(&input).map_err(|_|invalid_probe())?,now_ms()?]).map_err(db_error)?;
        self.mcp_probe(&id)
    }
    pub fn mcp_probe(&self, id: &str) -> Result<McpProbe> {
        self.require_mcp_schema()?;
        let row=self.db()?.query_row("SELECT id,status,snapshot_json,input_json,result_json,error_code,created_at_ms,finished_at_ms FROM agent_runs WHERE id=?1 AND purpose='mcp_probe' AND agent_id IS NULL",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,i64>(6)?,r.get::<_,Option<i64>>(7)?))).map_err(db_error)?;
        let snapshot: McpProbeSnapshot =
            serde_json::from_str(&row.2).map_err(|_| invalid_probe())?;
        let input: McpProbeInput = serde_json::from_str(&row.3).map_err(|_| invalid_probe())?;
        if snapshot.server_id != input.server_id
            || input.server_id.is_empty()
            || input.server_id.len() > 64
            || snapshot.configuration_revision.is_empty()
            || snapshot.configuration_revision.len() > 128
            || !(1000..=30000).contains(&snapshot.connect_timeout_ms)
        {
            return Err(invalid_probe());
        }
        let result = row
            .4
            .map(|text| {
                if text.len() > 32 * 1024 {
                    return Err(invalid_probe());
                }
                let catalog = serde_json::from_str(&text).map_err(|_| invalid_probe())?;
                check_catalog(&catalog)?;
                Ok(catalog)
            })
            .transpose()?;
        let code = row.5.as_deref();
        let known_failure = matches!(
            code,
            Some(
                "MCP_COMMAND_MISSING"
                    | "MCP_DIRECTORY_MISSING"
                    | "MCP_ENV_MISSING"
                    | "MCP_CREDENTIAL_UNAVAILABLE"
                    | "MCP_DEPENDENCY_MISSING"
                    | "MCP_TIMEOUT"
                    | "MCP_PROTOCOL"
                    | "MCP_CATALOG_INVALID"
                    | "MCP_PROCESS"
            )
        );
        let state_valid = match row.1.as_str() {
            "running" => result.is_none() && code.is_none() && row.7.is_none(),
            "succeeded" => result.is_some() && code.is_none() && row.7.is_some(),
            "failed" => result.is_none() && known_failure && row.7.is_some(),
            "cancelled" => result.is_none() && code == Some("CANCELLED") && row.7.is_some(),
            "interrupted" => result.is_none() && code == Some("INTERRUPTED") && row.7.is_some(),
            _ => false,
        };
        if !state_valid || row.6 < 0 || row.7.is_some_and(|time| time < row.6) {
            return Err(invalid_probe());
        }
        Ok(McpProbe {
            id: row.0,
            agent_id: None,
            purpose: "mcp_probe",
            status: row.1,
            snapshot,
            input,
            result,
            error_code: row.5,
            created_at_ms: row.6,
            finished_at_ms: row.7,
        })
    }
    pub fn latest_mcp_probe(&self, server_id: &str) -> Result<Option<McpProbe>> {
        self.require_mcp_schema()?;
        let id:Option<String>=self.db()?.query_row("SELECT id FROM agent_runs WHERE purpose='mcp_probe' AND agent_id IS NULL AND json_extract(input_json,'$.serverId')=?1 ORDER BY rowid DESC LIMIT 1",[server_id],|r|r.get(0)).optional().map_err(db_error)?;
        id.map(|id| self.mcp_probe(&id)).transpose()
    }
    pub fn complete_mcp_probe(&mut self, id: &str, catalog: McpProbeCatalog) -> Result<McpProbe> {
        self.require_mcp_schema()?;
        check_catalog(&catalog)?;
        let n=self.db()?.execute("UPDATE agent_runs SET status='succeeded',result_json=?2,finished_at_ms=?3 WHERE id=?1 AND purpose='mcp_probe' AND agent_id IS NULL AND status='running'",params![id,serde_json::to_string(&catalog).map_err(|_|invalid_probe())?,now_ms()?]).map_err(db_error)?;
        if n != 1 {
            return Err(stopped());
        }
        self.mcp_probe(id)
    }
    pub fn fail_mcp_probe(&mut self, id: &str, failure: McpProbeFailure) -> Result<McpProbe> {
        self.end_mcp_probe(id, "failed", failure.code())
    }
    pub fn cancel_mcp_probe(&mut self, id: &str) -> Result<McpProbe> {
        self.end_mcp_probe(id, "cancelled", "CANCELLED")
    }
    fn end_mcp_probe(&mut self, id: &str, status: &str, code: &str) -> Result<McpProbe> {
        self.require_mcp_schema()?;
        let n=self.db()?.execute("UPDATE agent_runs SET status=?2,error_code=?3,finished_at_ms=?4 WHERE id=?1 AND purpose='mcp_probe' AND agent_id IS NULL AND status='running'",params![id,status,code,now_ms()?]).map_err(db_error)?;
        if n != 1 {
            return Err(stopped());
        }
        self.mcp_probe(id)
    }
}
