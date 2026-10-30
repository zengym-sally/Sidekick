use super::mcp_config::{
    check_configuration, check_server, config_error, conflict, limit, CONFIG_LIMIT,
};
use super::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::os::unix::ffi::OsStrExt;

const JOURNAL_LIMIT: usize = 512 * 1024;
const VALUE_LIMIT: usize = 4096;
const VALUES_LIMIT: usize = 256 * 1024;
const PUBLIC_LIMIT: usize = 2_000_000;
const JOURNAL_NAME: &str = "credentials-journal.json";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigurationView {
    pub version: u32,
    pub revision: String,
    pub servers: Vec<McpServer>,
    pub secure_storage_available: bool,
    pub credential_status: BTreeMap<String, BTreeMap<String, &'static str>>,
    pub warning: Option<&'static str>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpSecretInput {
    pub edit: McpServerInput,
    pub operation_id: String,
    pub values: BTreeMap<String, String>,
}
pub struct PreparedMcpEnvironment {
    pub revision: String,
    pub server_id: String,
    values: BTreeMap<String, String>,
}
impl PreparedMcpEnvironment {
    pub fn into_values(self) -> BTreeMap<String, String> {
        self.values
    }
}
pub(super) enum McpCredentialFailure {
    // The production backend is deliberately disabled; injected backends still
    // need to distinguish missing values from unavailable storage.
    #[cfg_attr(not(test), allow(dead_code))]
    Missing,
    Unavailable,
}
pub(super) trait McpCredentialBackend {
    fn available(&self) -> bool;
    fn get(
        &self,
        scope: &str,
        reference: &str,
    ) -> std::result::Result<String, McpCredentialFailure>;
    fn put(
        &self,
        scope: &str,
        reference: &str,
        value: &str,
    ) -> std::result::Result<(), McpCredentialFailure>;
}
pub(super) trait McpEnvironmentSource {
    fn get(&self, name: &str) -> Option<String>;
}
struct UnavailableCredentials;
impl McpCredentialBackend for UnavailableCredentials {
    fn available(&self) -> bool {
        false
    }
    fn get(
        &self,
        _scope: &str,
        _reference: &str,
    ) -> std::result::Result<String, McpCredentialFailure> {
        Err(McpCredentialFailure::Unavailable)
    }
    fn put(
        &self,
        _scope: &str,
        _reference: &str,
        _value: &str,
    ) -> std::result::Result<(), McpCredentialFailure> {
        Err(McpCredentialFailure::Unavailable)
    }
}
struct ProcessEnvironment;
impl McpEnvironmentSource for ProcessEnvironment {
    fn get(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
}
#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
pub(super) enum McpSecurityFault {
    AfterJournal,
    AfterFirstCredential,
    BeforePublish,
    AfterPublish,
    ReadBack,
    ArchiveSync,
}
#[derive(Clone, Copy)]
enum Directory {
    Mcp,
    Backups,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundReference {
    server_id: String,
    name: String,
    reference: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    version: u32,
    operation_id: String,
    server_id: String,
    base_revision: String,
    base_hash: String,
    target: McpConfiguration,
    old_refs: Vec<BoundReference>,
    new_refs: Vec<BoundReference>,
}
fn uncertain() -> StoreError {
    StoreError::new(
        "MCP_SAVE_UNCERTAIN",
        "MCP 保存或恢复结果暂无法确认，配置和操作记录已保留。请重新读取核对，勿重复提交。",
    )
}
fn path_changed() -> StoreError {
    StoreError::new(
        "MCP_PATH_CHANGED",
        "MCP 工作根或目录身份／权限已变化，原文件已保留。请恢复原目录后重新读取。",
    )
}
fn scope_error() -> StoreError {
    StoreError::new(
        "MCP_CREDENTIAL_SCOPE",
        "安全引用不属于当前工作根、服务或环境项，原配置未覆盖。",
    )
}
fn unavailable() -> StoreError {
    StoreError::new(
        "MCP_CREDENTIAL_UNAVAILABLE",
        "真实安全存储尚未启用，未访问钥匙串。请使用已有环境变量引用；真实凭据接入需另行批准。",
    )
}
fn missing() -> StoreError {
    StoreError::new(
        "MCP_CREDENTIAL_MISSING",
        "这项服务缺少可用安全值，请为对应环境项重新设置；已有明文不会回读。",
    )
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn valid_operation(value: &str) -> bool {
    value.len() == 39
        && value.starts_with("op-")
        && value[3..]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
}
fn valid_value(value: &str) -> bool {
    !value.is_empty() && value.len() <= VALUE_LIMIT && !value.contains('\0')
}
fn revision(old: &str) -> String {
    format!(
        "rev-{}",
        digest(format!("{}-{}-{old}", std::process::id(), nonce()).as_bytes())
    )
}
fn document_hash(value: &McpConfiguration) -> Result<String> {
    Ok(digest(
        &serde_json::to_vec(value).map_err(|_| config_error())?,
    ))
}
fn contains_value(value: &serde_json::Value, secret: &str) -> bool {
    match value {
        serde_json::Value::String(s) => s.contains(secret),
        serde_json::Value::Array(a) => a.iter().any(|v| contains_value(v, secret)),
        serde_json::Value::Object(o) => o
            .iter()
            .any(|(k, v)| k.contains(secret) || contains_value(v, secret)),
        _ => false,
    }
}

impl AppStore {
    fn verify_mcp_paths(&self) -> Result<()> {
        let workspace = self
            .workspace
            .as_ref()
            .ok_or_else(|| StoreError::new("SETUP_REQUIRED", "请先选择工作目录。"))?;
        if fs::canonicalize(&workspace.root).map_err(|_| path_changed())? != workspace.root {
            return Err(path_changed());
        }
        for (path, handle) in [
            (&workspace.root, &workspace.root_directory),
            (&workspace.root.join("mcp"), &workspace.mcp_directory),
            (
                &workspace.root.join("backups"),
                &workspace.backups_directory,
            ),
        ] {
            let current = fs::symlink_metadata(path).map_err(|_| path_changed())?;
            let held = handle.metadata().map_err(|_| path_changed())?;
            if !current.is_dir()
                || current.file_type().is_symlink()
                || current.mode() & 0o7777 != 0o700
                || current.dev() != held.dev()
                || current.ino() != held.ino()
            {
                return Err(path_changed());
            }
        }
        let marker =
            fs::symlink_metadata(workspace.root.join(ROOT_MARKER)).map_err(|_| path_changed())?;
        let held = workspace._lock.metadata().map_err(|_| path_changed())?;
        if !marker.is_file()
            || marker.file_type().is_symlink()
            || marker.nlink() != 1
            || marker.mode() & 0o7777 != 0o600
            || marker.dev() != held.dev()
            || marker.ino() != held.ino()
        {
            return Err(path_changed());
        }
        Ok(())
    }
    fn mcp_directory(&self, kind: Directory) -> Result<(PathBuf, &File)> {
        self.verify_mcp_paths()?;
        let w = self.workspace.as_ref().ok_or_else(path_changed)?;
        Ok(match kind {
            Directory::Mcp => (w.root.join("mcp"), &w.mcp_directory),
            Directory::Backups => (w.root.join("backups"), &w.backups_directory),
        })
    }
    fn read_mcp_private(
        &self,
        kind: Directory,
        name: &str,
        budget: usize,
    ) -> Result<Option<Vec<u8>>> {
        let (parent, _) = self.mcp_directory(kind)?;
        let path = parent.join(name);
        let before = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.verify_mcp_paths()?;
                return Ok(None);
            }
            Err(e) => return Err(io_error(e)),
        };
        if !before.is_file()
            || before.file_type().is_symlink()
            || before.nlink() != 1
            || before.mode() & 0o7777 != 0o600
        {
            return Err(config_error());
        }
        if before.len() > budget as u64 {
            return Err(limit());
        }
        let file = File::open(&path).map_err(io_error)?;
        let opened = file.metadata().map_err(io_error)?;
        if opened.dev() != before.dev() || opened.ino() != before.ino() || opened.nlink() != 1 {
            return Err(path_changed());
        }
        let mut bytes = Vec::new();
        file.take((budget + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        if bytes.len() > budget {
            return Err(limit());
        }
        self.verify_mcp_paths()?;
        let after = fs::symlink_metadata(&path).map_err(|_| path_changed())?;
        if after.file_type().is_symlink()
            || after.dev() != before.dev()
            || after.ino() != before.ino()
            || after.nlink() != 1
            || after.mode() & 0o7777 != 0o600
        {
            return Err(path_changed());
        }
        Ok(Some(bytes))
    }
    fn write_mcp_private(
        &self,
        kind: Directory,
        name: &str,
        bytes: &[u8],
        budget: usize,
    ) -> Result<()> {
        if bytes.len() > budget {
            return Err(limit());
        }
        self.read_mcp_private(kind, name, budget)?;
        let (parent, directory) = self.mcp_directory(kind)?;
        let path = parent.join(name);
        let temporary = parent.join(format!(".mcp-{}-{}.pending", std::process::id(), nonce()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(io_error)?;
        self.verify_mcp_paths()?;
        file.write_all(bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        let held = file.metadata().map_err(io_error)?;
        let current = fs::symlink_metadata(&temporary).map_err(io_error)?;
        if !current.is_file()
            || current.file_type().is_symlink()
            || current.nlink() != 1
            || current.dev() != held.dev()
            || current.ino() != held.ino()
            || current.mode() & 0o7777 != 0o600
        {
            return Err(path_changed());
        }
        self.verify_mcp_paths()?;
        self.read_mcp_private(kind, name, budget)?;
        fs::rename(&temporary, &path).map_err(io_error)?;
        self.verify_mcp_paths()?;
        let published = fs::symlink_metadata(&path).map_err(io_error)?;
        if published.dev() != held.dev()
            || published.ino() != held.ino()
            || published.nlink() != 1
            || published.file_type().is_symlink()
        {
            return Err(path_changed());
        }
        directory.sync_all().map_err(io_error)?;
        Ok(())
    }
    fn mcp_scope(&self) -> Result<String> {
        self.verify_mcp_paths()?;
        let mut bytes = self.app_dir.as_os_str().as_bytes().to_vec();
        bytes.push(0);
        bytes.extend(self.root()?.as_os_str().as_bytes());
        Ok(digest(&bytes))
    }
    fn reference_prefix(&self, id: &str, name: &str) -> Result<String> {
        Ok(format!(
            "mcp1:{}:{id}:{}:",
            self.mcp_scope()?,
            digest(name.as_bytes())
        ))
    }
    fn validate_reference(&self, id: &str, name: &str, reference: &str) -> Result<()> {
        let prefix = self.reference_prefix(id, name)?;
        if reference.len() > 512
            || !reference.starts_with(&prefix)
            || reference.len() != prefix.len() + 64
            || !reference[prefix.len()..]
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err(scope_error());
        }
        Ok(())
    }
    fn new_reference(&self, id: &str, name: &str) -> Result<String> {
        Ok(format!(
            "{}{}",
            self.reference_prefix(id, name)?,
            digest(format!("{}-{}", std::process::id(), nonce()).as_bytes())
        ))
    }
    fn validate_mcp_document(&self, document: &McpConfiguration) -> Result<()> {
        check_configuration(document)?;
        for server in &document.servers {
            for item in &server.settings.env {
                if item.source == "keychain" {
                    self.validate_reference(&server.id, &item.name, &item.value)?;
                }
            }
        }
        if serde_json::to_vec_pretty(document)
            .map_err(|_| config_error())?
            .len()
            > CONFIG_LIMIT
        {
            return Err(limit());
        }
        Ok(())
    }
    fn read_mcp_document(&self) -> Result<McpConfiguration> {
        let Some(bytes) = self.read_mcp_private(Directory::Mcp, "servers.json", CONFIG_LIMIT)?
        else {
            return Ok(McpConfiguration {
                version: 1,
                revision: String::new(),
                servers: Vec::new(),
            });
        };
        let value = serde_json::from_slice(&bytes).map_err(|_| config_error())?;
        self.validate_mcp_document(&value)?;
        Ok(value)
    }
    fn mcp_view(
        &self,
        document: &McpConfiguration,
        backend: &dyn McpCredentialBackend,
        warning: Option<&'static str>,
    ) -> Result<McpConfigurationView> {
        let mut servers = document.servers.clone();
        let mut status = BTreeMap::new();
        let scope = self.mcp_scope()?;
        for server in &mut servers {
            let mut fields = BTreeMap::new();
            for item in &mut server.settings.env {
                if item.source == "keychain" {
                    self.validate_reference(&server.id, &item.name, &item.value)?;
                    let state = if !backend.available() {
                        "unavailable"
                    } else {
                        match backend.get(&scope, &item.value) {
                            Ok(value) if valid_value(&value) => "stored",
                            Ok(_) | Err(McpCredentialFailure::Missing) => "missing",
                            Err(McpCredentialFailure::Unavailable) => "unavailable",
                        }
                    };
                    fields.insert(item.name.clone(), state);
                    item.value.clear();
                }
            }
            if !fields.is_empty() {
                status.insert(server.id.clone(), fields);
            }
        }
        let view = McpConfigurationView {
            version: document.version,
            revision: document.revision.clone(),
            servers,
            secure_storage_available: backend.available(),
            credential_status: status,
            warning,
        };
        if serde_json::to_vec(&view).map_err(|_| config_error())?.len() > PUBLIC_LIMIT {
            return Err(limit());
        }
        Ok(view)
    }
    pub fn mcp_configuration(&self) -> Result<McpConfigurationView> {
        self.mcp_configuration_with(&UnavailableCredentials)
    }
    pub(super) fn mcp_configuration_with(
        &self,
        backend: &dyn McpCredentialBackend,
    ) -> Result<McpConfigurationView> {
        let warning = self.reconcile_mcp_journal()?;
        self.mcp_view(&self.read_mcp_document()?, backend, warning)
    }
    fn edit_mcp(
        &self,
        mut input: McpServerInput,
        new_names: &BTreeSet<String>,
        operation: Option<&str>,
    ) -> Result<(McpConfiguration, String)> {
        let mut document = self.read_mcp_document()?;
        if document.revision != input.expected_revision {
            return Err(conflict());
        }
        input.server.name = input.server.name.trim().into();
        input.server.command = input.server.command.trim().into();
        input.server.cwd = input.server.cwd.filter(|s| !s.trim().is_empty());
        check_server(&input.server)?;
        let previous = if let Some(id) = &input.id {
            Some(
                document
                    .servers
                    .iter()
                    .find(|s| &s.id == id)
                    .cloned()
                    .ok_or_else(|| {
                        StoreError::new("MCP_NOT_FOUND", "服务已从配置移除，请重新读取后核对。")
                    })?,
            )
        } else {
            None
        };
        let id = if let Some(server) = &previous {
            server.id.clone()
        } else {
            if document.servers.len() >= 20 {
                return Err(limit());
            }
            format!(
                "mcp-{}",
                &digest(format!("{}-{}", self.mcp_scope()?, nonce()).as_bytes())[..24]
            )
        };
        for name in new_names {
            if !input
                .server
                .env
                .iter()
                .any(|item| &item.name == name && item.source == "keychain")
            {
                return Err(config_error());
            }
        }
        for item in &mut input.server.env {
            if item.source == "keychain" {
                if !item.value.is_empty() {
                    return Err(scope_error());
                }
                item.value = if new_names.contains(&item.name) {
                    self.new_reference(&id, &item.name)?
                } else {
                    previous
                        .as_ref()
                        .and_then(|s| {
                            s.settings
                                .env
                                .iter()
                                .find(|old| old.name == item.name && old.source == "keychain")
                        })
                        .map(|old| old.value.clone())
                        .ok_or_else(missing)?
                };
            }
        }
        let server = McpServer {
            id: id.clone(),
            last_secret_operation: operation.map(str::to_owned).or_else(|| {
                previous
                    .as_ref()
                    .and_then(|s| s.last_secret_operation.clone())
            }),
            settings: input.server,
        };
        if let Some(existing) = document.servers.iter_mut().find(|s| s.id == id) {
            *existing = server;
        } else {
            document.servers.push(server);
        }
        document.revision = revision(&document.revision);
        self.validate_mcp_document(&document)?;
        Ok((document, id))
    }
    fn publish_mcp(
        &self,
        target: McpConfiguration,
        server_id: Option<String>,
    ) -> Result<McpConfigSave> {
        self.validate_mcp_document(&target)?;
        let written = (|| {
            #[cfg(test)]
            if self.mcp_write_fault == Some(McpWriteFault::BeforeReplace) {
                return Err(io_error(std::io::Error::other("synthetic MCP write")));
            }
            self.write_mcp_private(
                Directory::Mcp,
                "servers.json",
                &serde_json::to_vec_pretty(&target).map_err(|_| config_error())?,
                CONFIG_LIMIT,
            )?;
            #[cfg(test)]
            if matches!(
                self.mcp_write_fault,
                Some(McpWriteFault::AfterReplace | McpWriteFault::ReadBack)
            ) {
                return Err(io_error(std::io::Error::other("synthetic MCP sync")));
            }
            Ok(())
        })();
        let actual = self.read_mcp_document();
        #[cfg(test)]
        let actual = if self.mcp_write_fault == Some(McpWriteFault::ReadBack) {
            Err(uncertain())
        } else {
            actual
        };
        match (written, actual) {
            (result, Ok(actual)) if actual == target => Ok(McpConfigSave {
                configuration: self.mcp_view(&actual, &UnavailableCredentials, None)?,
                server_id,
                warning: result
                    .err()
                    .map(|_| "配置已读回确认；磁盘同步未能确认，请稍后重新保存。"),
            }),
            (Err(error), Ok(_)) => Err(error),
            _ => Err(uncertain()),
        }
    }
    pub fn save_mcp_server(&self, input: McpServerInput) -> Result<McpConfigSave> {
        self.reconcile_mcp_journal()?;
        let (document, id) = self.edit_mcp(input, &BTreeSet::new(), None)?;
        self.publish_mcp(document, Some(id))
    }
    pub fn remove_mcp_server(&self, input: McpRemoveInput) -> Result<McpConfigSave> {
        self.reconcile_mcp_journal()?;
        let mut document = self.read_mcp_document()?;
        if document.revision != input.expected_revision {
            return Err(conflict());
        }
        let before = document.servers.len();
        document.servers.retain(|s| s.id != input.id);
        if document.servers.len() == before {
            return Err(StoreError::new(
                "MCP_NOT_FOUND",
                "服务已从配置移除，请重新读取后核对。",
            ));
        }
        document.revision = revision(&document.revision);
        self.publish_mcp(document, None)
    }
    fn archive_name(operation: &str) -> String {
        format!("mcp-credentials-{operation}.json")
    }
    fn validate_journal(&self, journal: &Journal) -> Result<()> {
        if journal.version != 1
            || !valid_operation(&journal.operation_id)
            || journal.base_hash.len() != 64
            || !journal.base_hash.bytes().all(|b| b.is_ascii_hexdigit())
            || journal.base_revision.len() > 128
            || journal.old_refs.len() > 64
            || journal.new_refs.is_empty()
            || journal.new_refs.len() > 64
        {
            return Err(uncertain());
        }
        self.validate_mcp_document(&journal.target)
            .map_err(|_| uncertain())?;
        let server = journal
            .target
            .servers
            .iter()
            .find(|s| {
                s.id == journal.server_id
                    && s.last_secret_operation.as_deref() == Some(&journal.operation_id)
            })
            .ok_or_else(uncertain)?;
        for references in [&journal.old_refs, &journal.new_refs] {
            let mut names = BTreeSet::new();
            for item in references {
                if item.server_id != journal.server_id
                    || !super::mcp_config::variable(&item.name)
                    || !names.insert(&item.name)
                {
                    return Err(uncertain());
                }
                self.validate_reference(&item.server_id, &item.name, &item.reference)
                    .map_err(|_| uncertain())?;
            }
        }
        for item in &journal.new_refs {
            if !server
                .settings
                .env
                .iter()
                .any(|e| e.name == item.name && e.source == "keychain" && e.value == item.reference)
            {
                return Err(uncertain());
            }
        }
        Ok(())
    }
    fn reconcile_mcp_journal(&self) -> Result<Option<&'static str>> {
        self.verify_mcp_paths()?;
        let Some(bytes) = self
            .read_mcp_private(Directory::Mcp, JOURNAL_NAME, JOURNAL_LIMIT)
            .map_err(|_| uncertain())?
        else {
            return Ok(None);
        };
        let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| uncertain())?;
        self.validate_journal(&journal)?;
        let actual = self.read_mcp_document().map_err(|_| uncertain())?;
        let actual_hash = document_hash(&actual)?;
        let published = actual_hash == document_hash(&journal.target)?;
        if !published
            && (actual_hash != journal.base_hash || actual.revision != journal.base_revision)
        {
            return Err(uncertain());
        }
        let name = Self::archive_name(&journal.operation_id);
        match self
            .read_mcp_private(Directory::Backups, &name, JOURNAL_LIMIT)
            .map_err(|_| uncertain())?
        {
            Some(previous) if previous != bytes => return Err(uncertain()),
            Some(_) => {}
            None => self
                .write_mcp_private(Directory::Backups, &name, &bytes, JOURNAL_LIMIT)
                .map_err(|_| uncertain())?,
        }
        if self
            .read_mcp_private(Directory::Backups, &name, JOURNAL_LIMIT)
            .map_err(|_| uncertain())?
            .as_deref()
            != Some(bytes.as_slice())
            || self
                .read_mcp_private(Directory::Mcp, JOURNAL_NAME, JOURNAL_LIMIT)
                .map_err(|_| uncertain())?
                .as_deref()
                != Some(bytes.as_slice())
        {
            return Err(uncertain());
        }
        // Even an existing byte-identical archive can be left by a failed
        // directory sync. Confirm it durably before removing the active journal.
        let (_, backups) = self.mcp_directory(Directory::Backups)?;
        #[cfg(test)]
        self.security_fault(McpSecurityFault::ArchiveSync)?;
        backups.sync_all().map_err(|_| uncertain())?;
        self.verify_mcp_paths()?;
        let (directory, handle) = self.mcp_directory(Directory::Mcp)?;
        fs::remove_file(directory.join(JOURNAL_NAME)).map_err(|_| uncertain())?;
        handle.sync_all().map_err(|_| uncertain())?;
        self.verify_mcp_paths()?;
        Ok(Some(if published {
            "上次保存已读回确认；已有安全值不会回读。"
        } else {
            "上次配置未发布，旧配置仍生效；新旧引用及操作记录已保留。"
        }))
    }
    #[cfg(test)]
    fn security_fault(&self, point: McpSecurityFault) -> Result<()> {
        if self.mcp_security_fault == Some(point) {
            Err(uncertain())
        } else {
            Ok(())
        }
    }
    pub fn save_mcp_secrets(&self, input: McpSecretInput) -> Result<McpConfigSave> {
        self.save_mcp_secrets_with(input, &UnavailableCredentials)
    }
    pub(super) fn save_mcp_secrets_with(
        &self,
        input: McpSecretInput,
        backend: &dyn McpCredentialBackend,
    ) -> Result<McpConfigSave> {
        if serde_json::to_vec(&input)
            .map_err(|_| config_error())?
            .len()
            > JOURNAL_LIMIT
            || input.values.len() > 64
            || input.values.values().map(String::len).sum::<usize>() > VALUES_LIMIT
        {
            return Err(limit());
        }
        if !valid_operation(&input.operation_id)
            || input.values.is_empty()
            || input
                .values
                .iter()
                .any(|(name, value)| !super::mcp_config::variable(name) || !valid_value(value))
        {
            return Err(config_error());
        }
        self.reconcile_mcp_journal()?;
        let base = self.read_mcp_document()?;
        let names = input.values.keys().cloned().collect();
        let (target, id) = self.edit_mcp(input.edit, &names, Some(&input.operation_id))?;
        let public = serde_json::to_value(&target).map_err(|_| config_error())?;
        if input
            .values
            .values()
            .any(|secret| contains_value(&public, secret))
        {
            return Err(StoreError::new(
                "MCP_PLAIN_CREDENTIAL",
                "配置中不能保留待保存安全值的明文。",
            ));
        }
        if !backend.available() {
            return Err(unavailable());
        }
        if self
            .read_mcp_private(
                Directory::Backups,
                &Self::archive_name(&input.operation_id),
                JOURNAL_LIMIT,
            )?
            .is_some()
        {
            return Err(StoreError::new(
                "MCP_OPERATION_REPLAY",
                "这次安全保存操作已有记录，请重新读取后发起新保存。",
            ));
        }
        let references = |document: &McpConfiguration, new_only: bool| {
            document
                .servers
                .iter()
                .filter(|s| s.id == id)
                .flat_map(|s| {
                    s.settings
                        .env
                        .iter()
                        .filter(|e| {
                            e.source == "keychain"
                                && (!new_only || input.values.contains_key(&e.name))
                        })
                        .map(|e| BoundReference {
                            server_id: id.clone(),
                            name: e.name.clone(),
                            reference: e.value.clone(),
                        })
                })
                .collect::<Vec<_>>()
        };
        let journal = Journal {
            version: 1,
            operation_id: input.operation_id,
            server_id: id.clone(),
            base_revision: base.revision.clone(),
            base_hash: document_hash(&base)?,
            old_refs: references(&base, false),
            new_refs: references(&target, true),
            target,
        };
        self.validate_journal(&journal)?;
        let bytes = serde_json::to_vec_pretty(&journal).map_err(|_| config_error())?;
        if bytes.len() > JOURNAL_LIMIT {
            return Err(limit());
        }
        let scope = self.mcp_scope()?;
        let written = (|| {
            self.write_mcp_private(Directory::Mcp, JOURNAL_NAME, &bytes, JOURNAL_LIMIT)?;
            #[cfg(test)]
            self.security_fault(McpSecurityFault::AfterJournal)?;
            for (index, item) in journal.new_refs.iter().enumerate() {
                let value = &input.values[&item.name];
                self.validate_reference(&id, &item.name, &item.reference)?;
                backend
                    .put(&scope, &item.reference, value)
                    .map_err(|_| unavailable())?;
                let read = backend
                    .get(&scope, &item.reference)
                    .map_err(|_| unavailable())?;
                if read != *value {
                    return Err(unavailable());
                }
                #[cfg(test)]
                if index == 0 {
                    self.security_fault(McpSecurityFault::AfterFirstCredential)?;
                }
                #[cfg(not(test))]
                let _ = index;
            }
            #[cfg(test)]
            self.security_fault(McpSecurityFault::BeforePublish)?;
            self.write_mcp_private(
                Directory::Mcp,
                "servers.json",
                &serde_json::to_vec_pretty(&journal.target).map_err(|_| config_error())?,
                CONFIG_LIMIT,
            )?;
            #[cfg(test)]
            self.security_fault(McpSecurityFault::AfterPublish)?;
            Ok(())
        })();
        #[cfg(test)]
        if self.mcp_security_fault == Some(McpSecurityFault::ReadBack) {
            return Err(uncertain());
        }
        let recovered = self.reconcile_mcp_journal();
        let actual = self.read_mcp_document();
        match (written, recovered, actual) {
            (result, Ok(warning), Ok(actual)) if actual == journal.target => Ok(McpConfigSave {
                configuration: self.mcp_view(&actual, backend, warning)?,
                server_id: Some(id),
                warning: result
                    .err()
                    .map(|_| "安全配置已读回确认，原始安全值不会回读。"),
            }),
            (Err(error), Ok(_), Ok(_)) => Err(error),
            _ => Err(uncertain()),
        }
    }
    pub fn prepare_mcp_environment(
        &self,
        id: &str,
        expected_revision: &str,
    ) -> Result<PreparedMcpEnvironment> {
        self.prepare_mcp_environment_with(
            id,
            expected_revision,
            &UnavailableCredentials,
            &ProcessEnvironment,
        )
    }
    pub(super) fn prepare_mcp_environment_with(
        &self,
        id: &str,
        expected_revision: &str,
        backend: &dyn McpCredentialBackend,
        environment: &dyn McpEnvironmentSource,
    ) -> Result<PreparedMcpEnvironment> {
        self.reconcile_mcp_journal()?;
        let document = self.read_mcp_document()?;
        if document.revision != expected_revision {
            return Err(conflict());
        }
        let server = document
            .servers
            .iter()
            .find(|s| s.id == id && s.settings.enabled)
            .ok_or_else(|| StoreError::new("MCP_NOT_FOUND", "服务不存在或已禁用，请核对配置。"))?;
        let scope = self.mcp_scope()?;
        let mut values = BTreeMap::new();
        let mut total = 0;
        for item in &server.settings.env {
            let value = match item.source.as_str() {
                "literal" => item.value.clone(),
                "environment" => environment
                    .get(&item.value)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        StoreError::new(
                            "MCP_ENV_MISSING",
                            "所配置的宿主环境变量缺失，请核对变量名与启动环境。",
                        )
                    })?,
                "keychain" => {
                    self.validate_reference(id, &item.name, &item.value)?;
                    if !backend.available() {
                        return Err(unavailable());
                    }
                    backend.get(&scope, &item.value).map_err(|e| match e {
                        McpCredentialFailure::Missing => missing(),
                        McpCredentialFailure::Unavailable => unavailable(),
                    })?
                }
                _ => return Err(config_error()),
            };
            if value.len() > VALUE_LIMIT || value.contains('\0') {
                return Err(StoreError::new(
                    "MCP_ENV_INVALID",
                    "环境值无效或超过4KiB，未准备服务环境。",
                ));
            }
            if item.source == "keychain" && value.is_empty() {
                return Err(missing());
            }
            total += value.len();
            if total > VALUES_LIMIT {
                return Err(limit());
            }
            values.insert(item.name.clone(), value);
        }
        Ok(PreparedMcpEnvironment {
            revision: document.revision,
            server_id: id.into(),
            values,
        })
    }
}
