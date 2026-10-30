use super::*;
use std::collections::BTreeSet;

pub(super) const CONFIG_LIMIT: usize = 256 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpEnvironment {
    pub name: String,
    pub source: String,
    pub value: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerDraft {
    pub name: String,
    pub transport: String,
    pub enabled: bool,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<McpEnvironment>,
    pub connect_timeout_ms: u32,
    pub tool_timeout_ms: u32,
}
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_secret_operation: Option<String>,
    #[serde(flatten)]
    pub settings: McpServerDraft,
}
impl<'de> Deserialize<'de> for McpServer {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let mut value = serde_json::Value::deserialize(deserializer)?;
        let id = value
            .as_object_mut()
            .and_then(|object| object.remove("id"))
            .and_then(|id| id.as_str().map(str::to_owned))
            .ok_or_else(|| serde::de::Error::custom("invalid MCP server id"))?;
        let last_secret_operation = value
            .as_object_mut()
            .and_then(|object| object.remove("lastSecretOperation"))
            .map(serde_json::from_value)
            .transpose()
            .map_err(serde::de::Error::custom)?;
        let settings = serde_json::from_value(value).map_err(serde::de::Error::custom)?;
        Ok(Self {
            id,
            last_secret_operation,
            settings,
        })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct McpConfiguration {
    pub version: u32,
    pub revision: String,
    pub servers: Vec<McpServer>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerInput {
    pub id: Option<String>,
    pub expected_revision: String,
    pub server: McpServerDraft,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpRemoveInput {
    pub id: String,
    pub expected_revision: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigSave {
    pub configuration: super::mcp_security::McpConfigurationView,
    pub server_id: Option<String>,
    pub warning: Option<&'static str>,
}
#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
pub(super) enum McpWriteFault {
    BeforeReplace,
    AfterReplace,
    ReadBack,
}
pub(super) fn config_error() -> StoreError {
    StoreError::new(
        "MCP_CONFIG_INVALID",
        "MCP 配置无法识别或字段不合法，原文件未覆盖。请核对服务配置后重试。",
    )
}
pub(super) fn conflict() -> StoreError {
    StoreError::new(
        "MCP_VERSION_CONFLICT",
        "MCP 配置已有更新，草稿已保留，请重新读取后核对。",
    )
}
pub(super) fn limit() -> StoreError {
    StoreError::new(
        "MCP_LIMIT",
        "MCP 配置超过数量或大小限制：最多20项服务，配置文件最多256KiB。",
    )
}
pub(super) fn variable(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .enumerate()
            .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || i > 0 && b.is_ascii_digit())
}
pub(super) fn valid_id(id: &str) -> bool {
    id.starts_with("mcp-")
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
pub(super) fn check_server(s: &McpServerDraft) -> Result<()> {
    if s.name.trim().is_empty()
        || s.name.chars().count() > 100
        || s.name.chars().any(char::is_control)
        || s.transport != "stdio"
        || s.command.trim().is_empty()
        || s.command.len() > 4096
        || s.command.chars().any(char::is_control)
        || s.args.len() > 128
        || s.args.iter().any(|a| a.len() > 4096 || a.contains('\0'))
        || !(1000..=30000).contains(&s.connect_timeout_ms)
        || !(1000..=60000).contains(&s.tool_timeout_ms)
        || s.cwd.as_ref().is_some_and(|cwd| {
            cwd.len() > 4096 || cwd.contains('\0') || !Path::new(cwd).is_absolute()
        })
        || s.env.len() > 64
    {
        return Err(config_error());
    }
    if s.args.iter().any(|arg| {
        let flag = arg.split('=').next().unwrap_or("").to_ascii_lowercase();
        [
            "--api-key",
            "--apikey",
            "--token",
            "--access-token",
            "--password",
            "--secret",
            "--client-secret",
            "--authorization",
        ]
        .contains(&flag.as_str())
    }) {
        return Err(StoreError::new(
            "MCP_PLAIN_CREDENTIAL",
            "认证信息不能放在命令参数中，请改用环境变量引用或安全值。",
        ));
    }
    let mut names = BTreeSet::new();
    for item in &s.env {
        if !variable(&item.name)
            || !names.insert(&item.name)
            || item.value.len() > 4096
            || item.value.contains('\0')
            || !["literal", "environment", "keychain"].contains(&item.source.as_str())
            || item.source == "environment" && !variable(&item.value)
        {
            return Err(config_error());
        }
    }
    Ok(())
}
pub(super) fn check_configuration(c: &McpConfiguration) -> Result<()> {
    if c.version != 1
        || c.revision.is_empty()
        || c.revision.len() > 128
        || c.revision.chars().any(char::is_control)
    {
        return Err(config_error());
    }
    if c.servers.len() > 20 {
        return Err(limit());
    }
    let mut ids = BTreeSet::new();
    for server in &c.servers {
        if !valid_id(&server.id) || !ids.insert(&server.id) {
            return Err(config_error());
        }
        if server
            .last_secret_operation
            .as_ref()
            .is_some_and(|id| !super::mcp_security::valid_operation(id))
        {
            return Err(config_error());
        }
        check_server(&server.settings)?;
    }
    Ok(())
}
