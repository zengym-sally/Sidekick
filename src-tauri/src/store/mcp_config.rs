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
#[derive(Debug, Clone, PartialEq)]
pub struct McpServerDraft {
    pub name: String,
    pub enabled: bool,
    pub transport: McpTransportConfig,
    pub connect_timeout_ms: u32,
    pub tool_timeout_ms: u32,
}
#[derive(Debug, Clone, PartialEq)]
pub struct McpStdioConfig {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<McpEnvironment>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct McpHttpConfig {
    pub url: String,
    pub headers: Vec<McpEnvironment>,
}
#[derive(Debug, Clone, PartialEq)]
pub enum McpTransportConfig {
    Stdio(McpStdioConfig),
    Http(McpHttpConfig),
}
impl McpServerDraft {
    pub fn kind(&self) -> &'static str {
        match self.transport {
            McpTransportConfig::Stdio(_) => "stdio",
            McpTransportConfig::Http(_) => "http",
        }
    }
    pub fn stdio(&self) -> Result<&McpStdioConfig> {
        match &self.transport {
            McpTransportConfig::Stdio(value) => Ok(value),
            _ => Err(config_error()),
        }
    }
    pub fn stdio_mut(&mut self) -> Result<&mut McpStdioConfig> {
        match &mut self.transport {
            McpTransportConfig::Stdio(value) => Ok(value),
            _ => Err(config_error()),
        }
    }
}
impl Serialize for McpServerDraft {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut object = serializer
            .serialize_struct("McpServerDraft", if self.kind() == "stdio" { 9 } else { 7 })?;
        object.serialize_field("name", &self.name)?;
        object.serialize_field("transport", self.kind())?;
        object.serialize_field("enabled", &self.enabled)?;
        match &self.transport {
            McpTransportConfig::Stdio(value) => {
                object.serialize_field("command", &value.command)?;
                object.serialize_field("args", &value.args)?;
                object.serialize_field("cwd", &value.cwd)?;
                object.serialize_field("env", &value.env)?;
            }
            McpTransportConfig::Http(value) => {
                object.serialize_field("url", &value.url)?;
                object.serialize_field("headers", &value.headers)?;
            }
        }
        object.serialize_field("connectTimeoutMs", &self.connect_timeout_ms)?;
        object.serialize_field("toolTimeoutMs", &self.tool_timeout_ms)?;
        object.end()
    }
}
#[derive(Deserialize)]
#[serde(tag = "transport", deny_unknown_fields)]
enum McpWire {
    #[serde(rename = "stdio")]
    Stdio {
        name: String,
        enabled: bool,
        command: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: Vec<McpEnvironment>,
        #[serde(rename = "connectTimeoutMs")]
        connect: u32,
        #[serde(rename = "toolTimeoutMs")]
        tool: u32,
    },
    #[serde(rename = "http")]
    Http {
        name: String,
        enabled: bool,
        url: String,
        headers: Vec<McpEnvironment>,
        #[serde(rename = "connectTimeoutMs")]
        connect: u32,
        #[serde(rename = "toolTimeoutMs")]
        tool: u32,
    },
}
struct McpJsonSeed(usize);
impl<'de> serde::de::DeserializeSeed<'de> for McpJsonSeed {
    type Value = serde_json::Value;
    fn deserialize<D: serde::Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        if self.0 > 32 {
            return Err(serde::de::Error::custom("MCP JSON nesting limit"));
        }
        deserializer.deserialize_any(McpJsonVisitor(self.0))
    }
}
struct McpJsonVisitor(usize);
impl<'de> serde::de::Visitor<'de> for McpJsonVisitor {
    type Value = serde_json::Value;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("strict MCP JSON")
    }
    fn visit_bool<E: serde::de::Error>(self, v: bool) -> std::result::Result<Self::Value, E> {
        Ok(v.into())
    }
    fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Self::Value, E> {
        Ok(v.into())
    }
    fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Self::Value, E> {
        Ok(v.into())
    }
    fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<Self::Value, E> {
        serde_json::Number::from_f64(v)
            .map(serde_json::Value::Number)
            .ok_or_else(|| E::custom("invalid MCP number"))
    }
    fn visit_str<E: serde::de::Error>(self, v: &str) -> std::result::Result<Self::Value, E> {
        Ok(v.into())
    }
    fn visit_string<E: serde::de::Error>(self, v: String) -> std::result::Result<Self::Value, E> {
        Ok(v.into())
    }
    fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Self::Value, E> {
        Ok(serde_json::Value::Null)
    }
    fn visit_seq<A: serde::de::SeqAccess<'de>>(
        self,
        mut seq: A,
    ) -> std::result::Result<Self::Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = seq.next_element_seed(McpJsonSeed(self.0 + 1))? {
            values.push(value);
        }
        Ok(values.into())
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(
        self,
        mut map: A,
    ) -> std::result::Result<Self::Value, A::Error> {
        let mut values = serde_json::Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(serde::de::Error::custom("duplicate MCP field"));
            }
            values.insert(key, map.next_value_seed(McpJsonSeed(self.0 + 1))?);
        }
        Ok(values.into())
    }
}
fn strict_value<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<serde_json::Value, D::Error> {
    serde::de::DeserializeSeed::deserialize(McpJsonSeed(0), deserializer)
}
impl<'de> Deserialize<'de> for McpServerDraft {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let wire: McpWire = serde_json::from_value(strict_value(deserializer)?)
            .map_err(serde::de::Error::custom)?;
        Ok(match wire {
            McpWire::Stdio {
                name,
                enabled,
                command,
                args,
                cwd,
                env,
                connect,
                tool,
            } => Self {
                name,
                enabled,
                transport: McpTransportConfig::Stdio(McpStdioConfig {
                    command,
                    args,
                    cwd,
                    env,
                }),
                connect_timeout_ms: connect,
                tool_timeout_ms: tool,
            },
            McpWire::Http {
                name,
                enabled,
                url,
                headers,
                connect,
                tool,
            } => Self {
                name,
                enabled,
                transport: McpTransportConfig::Http(McpHttpConfig { url, headers }),
                connect_timeout_ms: connect,
                tool_timeout_ms: tool,
            },
        })
    }
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
        let mut value = strict_value(deserializer)?;
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
        || !(1000..=30000).contains(&s.connect_timeout_ms)
        || !(1000..=60000).contains(&s.tool_timeout_ms)
    {
        return Err(config_error());
    }
    let stdio = match &s.transport {
        McpTransportConfig::Stdio(value) => value,
        McpTransportConfig::Http(value) => {
            checked_http_url(&value.url)?;
            let mut names = BTreeSet::new();
            if value.headers.len() > 64 {
                return Err(limit());
            }
            for h in &value.headers {
                let name = h.name.to_ascii_lowercase();
                if h.name.is_empty()
                    || h.name.len() > 128
                    || !h
                        .name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
                    || !names.insert(name.clone())
                    || h.source != "environment"
                    || !variable(&h.value)
                    || [
                        "host",
                        "accept",
                        "content-type",
                        "content-length",
                        "connection",
                        "transfer-encoding",
                        "origin",
                        "cookie",
                        "set-cookie",
                        "proxy-authorization",
                        "mcp-session-id",
                        "mcp-protocol-version",
                        "last-event-id",
                    ]
                    .contains(&name.as_str())
                {
                    return Err(config_error());
                }
            }
            return Ok(());
        }
    };
    if stdio.command.trim().is_empty()
        || stdio.command.len() > 4096
        || stdio.command.chars().any(char::is_control)
        || stdio.args.len() > 128
        || stdio
            .args
            .iter()
            .any(|a| a.len() > 4096 || a.contains('\0'))
        || stdio.cwd.as_ref().is_some_and(|cwd| {
            cwd.len() > 4096 || cwd.contains('\0') || !Path::new(cwd).is_absolute()
        })
        || stdio.env.len() > 64
    {
        return Err(config_error());
    }
    if stdio.args.iter().any(|arg| {
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
    for item in &stdio.env {
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
pub(super) fn checked_http_url(value: &str) -> Result<String> {
    if value.len() > 4096 || value.chars().any(char::is_control) {
        return Err(config_error());
    }
    let url = tauri::Url::parse(value).map_err(|_| config_error())?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || (url.scheme() == "http"
            && !matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "::1")))
    {
        return Err(config_error());
    }
    for (key, _) in url.query_pairs() {
        let key = key.to_ascii_lowercase().replace(['-', '_'], "");
        if [
            "token",
            "secret",
            "password",
            "passwd",
            "authorization",
            "credential",
            "apikey",
            "signature",
        ]
        .iter()
        .any(|needle| key.contains(needle))
            || ["auth", "key", "sig", "jwt"].contains(&key.as_str())
        {
            return Err(config_error());
        }
    }
    Ok(url.to_string())
}
pub(super) fn check_configuration(c: &McpConfiguration) -> Result<()> {
    if ![1, 2].contains(&c.version)
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
        if c.version == 1 && server.settings.kind() != "stdio" {
            return Err(config_error());
        }
    }
    Ok(())
}
