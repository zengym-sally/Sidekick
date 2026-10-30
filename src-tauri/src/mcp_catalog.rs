use super::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const CATALOG_LIMIT: usize = 512 * 1024;
#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
pub(super) enum CatalogFault {
    AfterFileSync,
    AfterDatabase,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpDiscoveredTool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct McpDiscoveredCatalog {
    pub tools: Vec<McpDiscoveredTool>,
}
pub struct PreparedMcpProbe {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub run_directory: PathBuf,
    pub env: BTreeMap<String, String>,
    pub sensitive_names: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Artifact {
    version: u32,
    probe_id: String,
    server_id: String,
    configuration_revision: String,
    catalog: McpDiscoveredCatalog,
}
pub(super) fn uncertain() -> StoreError {
    StoreError::new(
        "MCP_PROBE_SAVE_UNCERTAIN",
        "诊断目录保存结果暂无法确认，现场已保留。请重开核对，勿重复提交。",
    )
}
fn invalid_catalog() -> StoreError {
    StoreError::new(
        "MCP_CATALOG_INVALID",
        "工具目录无效或超过预算，未发布成功结果。",
    )
}
fn path_error() -> StoreError {
    StoreError::new(
        "MCP_CATALOG_PATH",
        "诊断目录身份或权限变化，未发布或读取目录。",
    )
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn bytes<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|_| invalid_catalog())
}
fn schema(value: &serde_json::Value, depth: usize, count: &mut usize) -> Result<()> {
    *count += 1;
    if depth > 64 || *count > 4096 {
        return Err(invalid_catalog());
    }
    match value {
        serde_json::Value::Object(o) => {
            for v in o.values() {
                schema(v, depth + 1, count)?;
            }
        }
        serde_json::Value::Array(a) => {
            for v in a {
                schema(v, depth + 1, count)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn schema_shape(v: &serde_json::Value) -> Result<()> {
    let o = v.as_object().ok_or_else(invalid_catalog)?;
    let allowed = [
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "enum",
        "const",
        "default",
        "title",
        "description",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minLength",
        "maxLength",
        "pattern",
        "minItems",
        "maxItems",
        "uniqueItems",
        "minProperties",
        "maxProperties",
    ];
    if o.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(invalid_catalog());
    }
    if o.get("type").is_some_and(|x| {
        ![
            "object", "array", "string", "number", "integer", "boolean", "null",
        ]
        .iter()
        .any(|t| x == t)
    }) {
        return Err(invalid_catalog());
    }
    if let Some(properties) = o.get("properties") {
        for property in properties.as_object().ok_or_else(invalid_catalog)?.values() {
            schema_shape(property)?;
        }
    }
    for key in ["items", "additionalProperties"] {
        if let Some(s) = o.get(key) {
            if key != "additionalProperties" || !s.is_boolean() {
                schema_shape(s)?;
            }
        }
    }
    if let Some(required) = o.get("required") {
        let a = required.as_array().ok_or_else(invalid_catalog)?;
        if a.iter().any(|x| !x.is_string())
            || a.iter()
                .map(|x| x.as_str().unwrap_or_default())
                .collect::<BTreeSet<_>>()
                .len()
                != a.len()
        {
            return Err(invalid_catalog());
        }
    }
    for key in ["title", "description", "pattern"] {
        if o.get(key).is_some_and(|x| !x.is_string()) {
            return Err(invalid_catalog());
        }
    }
    for key in [
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
    ] {
        if o.get(key).is_some_and(|x| {
            !x.is_number() || (key == "multipleOf" && x.as_f64().is_none_or(|n| n <= 0.0))
        }) {
            return Err(invalid_catalog());
        }
    }
    for key in [
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minProperties",
        "maxProperties",
    ] {
        if o.get(key)
            .is_some_and(|x| x.as_u64().is_none_or(|n| n > 9007199254740991))
        {
            return Err(invalid_catalog());
        }
    }
    if o.get("uniqueItems").is_some_and(|x| !x.is_boolean())
        || o.get("enum")
            .is_some_and(|x| x.as_array().is_none_or(|a| a.is_empty()))
    {
        return Err(invalid_catalog());
    }
    Ok(())
}
fn contains(value: &serde_json::Value, secret: &str) -> bool {
    match value {
        serde_json::Value::String(s) => s.contains(secret),
        serde_json::Value::Array(a) => a.iter().any(|v| contains(v, secret)),
        serde_json::Value::Object(o) => o
            .iter()
            .any(|(k, v)| k.contains(secret) || contains(v, secret)),
        _ => false,
    }
}
impl McpDiscoveredCatalog {
    pub fn validate(&self, sensitive: &[String]) -> Result<McpProbeCatalog> {
        if self.tools.len() > 64 || bytes(self)?.len() > CATALOG_LIMIT {
            return Err(invalid_catalog());
        }
        let mut names = BTreeSet::new();
        let mut tools = Vec::new();
        for t in &self.tools {
            if t.name.is_empty()
                || t.name.len() > 256
                || t.name.chars().any(char::is_control)
                || !names.insert(&t.name)
                || t.input_schema.get("type").and_then(|v| v.as_str()) != Some("object")
                || bytes(&t.input_schema)?.len() > 32768
            {
                return Err(invalid_catalog());
            }
            schema(&t.input_schema, 0, &mut 0)?;
            schema_shape(&t.input_schema)?;
            tools.push(McpProbeTool {
                name: t.name.clone(),
                schema_sha256: hash(&bytes(&t.input_schema)?),
            });
        }
        let value = serde_json::to_value(self).map_err(|_| invalid_catalog())?;
        if sensitive
            .iter()
            .any(|s| !s.is_empty() && contains(&value, s))
        {
            return Err(StoreError::new(
                "MCP_PRIVATE_OUTPUT",
                "目录含敏感引用值，未保存或返回目录。",
            ));
        }
        Ok(McpProbeCatalog {
            tools,
            catalog_sha256: None,
        })
    }
}
fn identity(path: &Path, held: &File) -> Result<()> {
    let m = fs::symlink_metadata(path).map_err(|_| path_error())?;
    let h = held.metadata().map_err(|_| path_error())?;
    if !m.is_dir()
        || m.file_type().is_symlink()
        || m.mode() & 0o7777 != 0o700
        || m.ino() != h.ino()
        || m.dev() != h.dev()
    {
        return Err(path_error());
    }
    Ok(())
}
impl AppStore {
    fn probe_runs(&self) -> Result<(PathBuf, &File)> {
        self.verify_mcp_paths()?;
        let w = self.workspace.as_ref().ok_or_else(path_error)?;
        let path = w.root.join("runs");
        identity(&path, &w.runs_directory)?;
        Ok((path, &w.runs_directory))
    }
    fn probe_directory(&self, id: &str) -> Result<(PathBuf, File)> {
        self.mcp_probe(id)?;
        if !id.starts_with("mcp-probe-")
            || id
                .bytes()
                .any(|b| !(b.is_ascii_alphanumeric() || b == b'-'))
        {
            return Err(path_error());
        }
        let (runs, _) = self.probe_runs()?;
        let path = runs.join(id);
        let file = File::open(&path).map_err(|_| path_error())?;
        identity(&path, &file)?;
        if let Some(registered) = self.mcp_probe_directories.get(id) {
            identity(&path, registered)?;
        }
        Ok((path, file))
    }
    pub fn prepare_mcp_probe(&mut self, id: &str) -> Result<PreparedMcpProbe> {
        let probe = self.mcp_probe(id)?;
        let configuration = self.mcp_configuration()?;
        if configuration.revision != probe.snapshot.configuration_revision {
            return Err(super::mcp_config::conflict());
        }
        let server = configuration
            .servers
            .iter()
            .find(|s| s.id == probe.input.server_id)
            .ok_or_else(invalid_catalog)?;
        let env = self
            .prepare_probe_environment(&server.id, &configuration.revision)?
            .into_values();
        let (runs, held) = self.probe_runs()?;
        let path = runs.join(id);
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .map_err(|_| path_error())?;
        identity(&runs, held)?;
        let directory = File::open(&path).map_err(|_| path_error())?;
        identity(&path, &directory)?;
        held.sync_all().map_err(io_error)?;
        self.mcp_probe_directories.insert(id.into(), directory);
        let cwd = server
            .settings
            .cwd
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or(path.clone());
        if !cwd.is_dir() {
            return Err(StoreError::new(
                "MCP_DIRECTORY_MISSING",
                "服务工作目录不可用。",
            ));
        }
        Ok(PreparedMcpProbe {
            command: server.settings.command.clone(),
            args: server.settings.args.clone(),
            cwd,
            run_directory: path,
            env,
            sensitive_names: server
                .settings
                .env
                .iter()
                .filter(|e| e.source != "literal")
                .map(|e| e.name.clone())
                .collect(),
        })
    }
    pub fn publish_mcp_catalog(
        &mut self,
        id: &str,
        catalog: McpDiscoveredCatalog,
        sensitive: &[String],
    ) -> Result<McpProbe> {
        let probe = self.mcp_probe(id)?;
        if probe.status != "running" {
            return Err(invalid_catalog());
        }
        let mut receipt = catalog.validate(sensitive)?;
        let artifact = Artifact {
            version: 1,
            probe_id: id.into(),
            server_id: probe.input.server_id,
            configuration_revision: probe.snapshot.configuration_revision,
            catalog,
        };
        let data = bytes(&artifact)?;
        if data.len() > CATALOG_LIMIT + 4096 {
            return Err(invalid_catalog());
        }
        let (dir, held) = self.probe_directory(id)?;
        let path = dir.join("mcp-catalog.json");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|_| path_error())?;
        file.write_all(&data).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        let opened = file.metadata().map_err(|_| path_error())?;
        let current = fs::symlink_metadata(&path).map_err(|_| path_error())?;
        if !current.is_file()
            || current.file_type().is_symlink()
            || current.nlink() != 1
            || current.mode() & 0o7777 != 0o600
            || current.dev() != opened.dev()
            || current.ino() != opened.ino()
        {
            return Err(path_error());
        }
        identity(&dir, &held)?;
        self.probe_runs()?;
        held.sync_all().map_err(io_error)?;
        #[cfg(test)]
        if self.mcp_catalog_fault == Some(CatalogFault::AfterFileSync) {
            return Err(path_error());
        }
        receipt.catalog_sha256 = Some(hash(&data));
        let result = self.complete_mcp_probe(id, receipt);
        if result.is_err() {
            self.mcp_probe_uncertain = true;
            return Err(uncertain());
        }
        #[cfg(test)]
        if self.mcp_catalog_fault == Some(CatalogFault::AfterDatabase) {
            self.mcp_probe_uncertain = true;
            return Err(uncertain());
        }
        self.mcp_probe_directories.remove(id);
        match self.read_mcp_catalog(id) {
            Ok(Some(_)) => result,
            _ => {
                self.mcp_probe_uncertain = true;
                Err(uncertain())
            }
        }
    }
    pub fn read_mcp_catalog(&self, id: &str) -> Result<Option<McpDiscoveredCatalog>> {
        let probe = self.mcp_probe(id)?;
        let Some(receipt) = probe.result else {
            return Ok(None);
        };
        let Some(digest) = &receipt.catalog_sha256 else {
            return Ok(None);
        };
        let (dir, held) = self.probe_directory(id)?;
        let path = dir.join("mcp-catalog.json");
        let m = fs::symlink_metadata(&path).map_err(|_| path_error())?;
        if !m.is_file()
            || m.file_type().is_symlink()
            || m.nlink() != 1
            || m.mode() & 0o7777 != 0o600
            || m.len() > (CATALOG_LIMIT + 4096) as u64
        {
            return Err(path_error());
        }
        let file = File::open(&path).map_err(|_| path_error())?;
        let h = file.metadata().map_err(|_| path_error())?;
        if h.dev() != m.dev() || h.ino() != m.ino() || h.nlink() != 1 {
            return Err(path_error());
        }
        let mut data = Vec::new();
        file.take((CATALOG_LIMIT + 4097) as u64)
            .read_to_end(&mut data)
            .map_err(io_error)?;
        self.probe_runs()?;
        identity(&dir, &held)?;
        let after = fs::symlink_metadata(&path).map_err(|_| path_error())?;
        if after.dev() != m.dev()
            || after.ino() != m.ino()
            || after.nlink() != 1
            || after.mode() & 0o7777 != 0o600
            || after.file_type().is_symlink()
            || hash(&data) != *digest
        {
            return Err(path_error());
        }
        let artifact: Artifact = serde_json::from_slice(&data).map_err(|_| invalid_catalog())?;
        if artifact.version != 1
            || artifact.probe_id != id
            || artifact.server_id != probe.input.server_id
            || artifact.configuration_revision != probe.snapshot.configuration_revision
        {
            return Err(invalid_catalog());
        }
        if artifact.catalog.validate(&[])?.tools != receipt.tools {
            return Err(invalid_catalog());
        }
        Ok(Some(artifact.catalog))
    }
}
