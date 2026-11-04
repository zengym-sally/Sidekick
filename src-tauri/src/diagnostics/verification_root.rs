use crate::local_store::{AppStore, StoreError};
use crate::store_commands::LocalState;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
const SCOPE: &str = ".s33-root-scope.json";
const DIRECTORIES: [&str; 5] = [
    "",
    "application",
    "workspace",
    "workspace/config",
    "workspace/data",
];
const NATIVE_DIRECTORIES: [&str; 10] = [
    "",
    "application",
    "workspace",
    "workspace/config",
    "workspace/data",
    "workspace/runs",
    "workspace/skills",
    "workspace/mcp",
    "workspace/logs",
    "workspace/backups",
];
#[cfg(feature = "s33-mcp-ui-verification")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeReadinessDiagnostic {
    pub(crate) stage: &'static str,
    pub(crate) reason: &'static str,
    pub(crate) requested: [u32; 2],
    pub(crate) inner: Option<[u32; 2]>,
    pub(crate) scale: Option<f64>,
    pub(crate) monitor: Option<[i64; 4]>,
    pub(crate) work_area: Option<[i64; 4]>,
    pub(crate) outer: Option<[u32; 2]>,
    pub(crate) target: Option<[i32; 2]>,
    pub(crate) position: Option<[i32; 2]>,
}
#[cfg(feature = "s33-mcp-ui-verification")]
impl NativeReadinessDiagnostic {
    pub(crate) fn new(width: u32, height: u32) -> Self {
        Self {
            stage: "size_request",
            reason: "api",
            requested: [width, height],
            inner: None,
            scale: None,
            monitor: None,
            work_area: None,
            outer: None,
            target: None,
            position: None,
        }
    }
    fn valid(&self) -> bool {
        let rect = |value: [i64; 4]| {
            i32::try_from(value[0]).is_ok()
                && i32::try_from(value[1]).is_ok()
                && u32::try_from(value[2]).is_ok()
                && u32::try_from(value[3]).is_ok()
        };
        [
            "size_request",
            "inner_size",
            "scale",
            "monitor",
            "outer_size",
            "bounds",
            "position_request",
            "position",
            "store",
        ]
        .contains(&self.stage)
            && ["api", "missing", "deadline", "bounds", "store"].contains(&self.reason)
            && (640..=2000).contains(&self.requested[0])
            && (600..=1400).contains(&self.requested[1])
            && self.scale.is_none_or(f64::is_finite)
            && self.monitor.is_none_or(rect)
            && self.work_area.is_none_or(rect)
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Identity {
    name: String,
    dev: u64,
    ino: u64,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativeModelOwner {
    pub(crate) port: u16,
    pub(crate) pid: u32,
    pub(crate) command: String,
    pub(crate) nonce: String,
    pub(crate) script: PathBuf,
}
fn owner_id() -> u32 {
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    unsafe { geteuid() }
}
impl NativeModelOwner {
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn capture(
        port: u16,
        pid: u32,
        nonce: &str,
        script: PathBuf,
    ) -> Result<Self, StoreError> {
        let command = std::process::Command::new("/bin/ps")
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .args(["-p", &pid.to_string(), "-o", "uid=,lstart=,command="])
            .output()
            .map_err(|_| invalid())?;
        let owner = Self {
            port,
            pid,
            command: String::from_utf8(command.stdout)
                .map_err(|_| invalid())?
                .trim()
                .into(),
            nonce: nonce.into(),
            script: script.canonicalize().map_err(|_| invalid())?,
        };
        owner.validate()?;
        Ok(owner)
    }
    fn validate(&self) -> Result<(), StoreError> {
        if self.port < 1024
            || self.pid < 2
            || self.nonce.len() != 48
            || !self.nonce.bytes().all(|b| b.is_ascii_hexdigit())
            || !self.script.is_absolute()
            || !self
                .command
                .contains(self.script.to_string_lossy().as_ref())
            || !self.command.contains(&self.nonce)
            || self
                .command
                .split_whitespace()
                .next()
                .and_then(|s| s.parse::<u32>().ok())
                != Some(owner_id())
        {
            return Err(invalid());
        }
        let actual = std::process::Command::new("/bin/ps")
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .args(["-p", &self.pid.to_string(), "-o", "uid=,lstart=,command="])
            .output()
            .map_err(|_| invalid())?;
        if !actual.status.success()
            || String::from_utf8(actual.stdout)
                .map_err(|_| invalid())?
                .trim()
                != self.command
        {
            return Err(invalid());
        }
        let listener = std::process::Command::new("/usr/sbin/lsof")
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .args([
                "-nP",
                "-a",
                "-p",
                &self.pid.to_string(),
                &format!("-iTCP@127.0.0.1:{}", self.port),
                "-sTCP:LISTEN",
                "-Fp",
            ])
            .output()
            .map_err(|_| invalid())?;
        if !listener.status.success()
            || !String::from_utf8_lossy(&listener.stdout)
                .lines()
                .any(|line| line == format!("p{}", self.pid))
        {
            return Err(invalid());
        }
        Ok(())
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    fn model(&self) -> crate::local_store::ModelConfiguration {
        crate::local_store::ModelConfiguration {
            providers: serde_json::json!({"providers":[{"id":"p6-synthetic","name":"P6 本机合成服务","apiFormat":"openai-compatible","baseUrl":format!("http://127.0.0.1:{}/v1",self.port),"auth":{"type":"bearer","apiKeyRef":"p6-synthetic-only"},"enabled":true,"network":{"timeoutMs":10000,"retry":{"maxRetries":0}}}]}),
            models: serde_json::json!({"models":[{"id":"p6-synthetic","name":"P6 本机合成模型","providerId":"p6-synthetic","apiModelId":"synthetic","capabilities":{"toolCall":true,"input":["text"]}}],"sidekick":{"version":1,"revision":self.nonce,"defaultModelId":"p6-synthetic"}}),
            default_model_id: "p6-synthetic".into(),
            revision: self.nonce.clone(),
            credential_status: std::collections::BTreeMap::from([(
                "p6-synthetic".into(),
                "synthetic".into(),
            )]),
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Scope {
    version: u32,
    app: PathBuf,
    workspace: PathBuf,
    nonce: String,
    marker: String,
    directories: Vec<Identity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model: Option<NativeModelOwner>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    database: Option<Identity>,
}
pub(crate) struct VerificationRoot {
    scope: Scope,
    bytes: Vec<u8>,
    held: Vec<File>,
}
fn invalid() -> StoreError {
    StoreError {
        code: "VERIFY_INPUT",
        message: "隔离验证根或启动参数无法确认，未打开工作库。",
    }
}
fn directory(path: &Path) -> Result<fs::Metadata, StoreError> {
    let m = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if !m.is_dir()
        || m.file_type().is_symlink()
        || m.mode() & 0o7777 != 0o700
        || m.uid() != owner_id()
    {
        return Err(invalid());
    }
    Ok(m)
}
fn private_file(path: &Path) -> Result<Vec<u8>, StoreError> {
    let m = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if !m.is_file()
        || m.file_type().is_symlink()
        || m.nlink() != 1
        || m.mode() & 0o7777 != 0o600
        || m.uid() != owner_id()
        || m.len() > 16384
    {
        return Err(invalid());
    }
    let f = File::open(path).map_err(|_| invalid())?;
    let opened = f.metadata().map_err(|_| invalid())?;
    if m.dev() != opened.dev() || m.ino() != opened.ino() || opened.nlink() != 1 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    f.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    let after = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if bytes.len() > 16384
        || after.dev() != m.dev()
        || after.ino() != m.ino()
        || after.nlink() != 1
        || after.file_type().is_symlink()
        || after.mode() & 0o7777 != 0o600
        || after.uid() != owner_id()
    {
        return Err(invalid());
    }
    Ok(bytes)
}
fn pointers(app: &Path, workspace: &Path) -> Result<(), StoreError> {
    for name in ["bootstrap.json", "workspace-init.json"] {
        let p = app.join("application").join(name);
        if name == "workspace-init.json"
            && fs::symlink_metadata(&p).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
        {
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_slice(&private_file(&p)?).map_err(|_| invalid())?;
        if value["app"] != "sidekick"
            || value["version"] != 1
            || value["root"].as_str() != workspace.to_str()
            || value["timeZone"] != "UTC"
        {
            return Err(invalid());
        }
    }
    for name in ["providers.json", "models.json", ".llm-journal.json"] {
        match fs::symlink_metadata(workspace.join("config").join(name)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(invalid()),
        }
    }
    Ok(())
}
impl VerificationRoot {
    fn names(&self) -> &[&str] {
        if self.scope.model.is_some() {
            &NATIVE_DIRECTORIES
        } else {
            &DIRECTORIES
        }
    }
    pub(crate) fn validate(&self) -> Result<(), StoreError> {
        if self.scope.directories.len() != self.names().len()
            || self.held.len() != self.names().len() + usize::from(self.scope.database.is_some())
            || self.scope.owner.is_some_and(|id| id != owner_id())
        {
            return Err(invalid());
        }
        for ((id, name), held) in self
            .scope
            .directories
            .iter()
            .zip(self.names())
            .zip(&self.held)
        {
            let m = directory(&self.scope.app.join(name))?;
            let actual = held.metadata().map_err(|_| invalid())?;
            if id.name != *name
                || m.dev() != id.dev
                || m.ino() != id.ino
                || actual.dev() != id.dev
                || actual.ino() != id.ino
            {
                return Err(invalid());
            }
        }
        if let Some(id) = &self.scope.database {
            let path = self.scope.app.join(&id.name);
            let m = fs::symlink_metadata(path).map_err(|_| invalid())?;
            let actual = self
                .held
                .last()
                .ok_or_else(invalid)?
                .metadata()
                .map_err(|_| invalid())?;
            if !m.is_file()
                || m.file_type().is_symlink()
                || m.nlink() != 1
                || m.mode() & 0o7777 != 0o600
                || m.uid() != owner_id()
                || m.dev() != id.dev
                || m.ino() != id.ino
                || actual.dev() != id.dev
                || actual.ino() != id.ino
                || actual.nlink() != 1
            {
                return Err(invalid());
            }
        }
        if private_file(&self.scope.app.join(&self.scope.marker))? != self.scope.nonce.as_bytes()
            || private_file(&self.scope.app.join(SCOPE))? != self.bytes
        {
            return Err(invalid());
        }
        pointers(&self.scope.app, &self.scope.workspace)?;
        if let Some(model) = &self.scope.model {
            model.validate()?;
        }
        Ok(())
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn native_pin(&self) -> Option<serde_json::Value> {
        self.scope
            .model
            .as_ref()
            .map(|model| serde_json::to_value(model).expect("native owner serializable"))
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn native_g1(&self) -> bool {
        self.scope.marker == ".s36-native-verification" && self.scope.model.is_some()
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn native_startup_identity(
        &self,
        launch_scope: &str,
    ) -> Result<serde_json::Value, StoreError> {
        self.validate()?;
        let model = self.scope.model.as_ref().ok_or_else(invalid)?;
        if !self.native_g1()
            || launch_scope != format!("controlled-native-g1:{}:{}", model.port, model.pid)
        {
            return Err(invalid());
        }
        let pid = std::process::id();
        let observe = |columns: &str| -> Result<String, StoreError> {
            let output = std::process::Command::new("/bin/ps")
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .args(["-p", &pid.to_string(), "-o", columns])
                .output()
                .map_err(|_| invalid())?;
            let text = String::from_utf8(output.stdout).map_err(|_| invalid())?;
            if !output.status.success() || text.trim().is_empty() {
                return Err(invalid());
            }
            Ok(text.trim().into())
        };
        let identity = observe("uid=,lstart=,command=")?;
        let command = observe("command=")?;
        let uid = identity
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<u32>().ok())
            .ok_or_else(invalid)?;
        if uid != owner_id() || !identity.contains(&command) {
            return Err(invalid());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| invalid())?;
        let data = serde_json::json!({
            "layer":"owned G1 verification process startup; no GUI assertion",
            "identifier":"com.sidekick.s33.ui.verify","scope":"controlled-native-g1",
            "launchScope":launch_scope,"root":self.scope.app,"nonce":self.scope.nonce,
            "pid":pid,"uid":uid,"identity":identity,"command":command,
            "createdAtMs":now.as_millis()
        });
        let bytes = serde_json::to_vec_pretty(&data).map_err(|_| invalid())?;
        if bytes.len() > 16384 {
            return Err(invalid());
        }
        self.validate()?;
        let path = self
            .scope
            .app
            .join(format!("native-startup-{}.json", now.as_nanos()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .map_err(|_| invalid())?;
        file.write_all(&bytes).map_err(|_| invalid())?;
        file.sync_all().map_err(|_| invalid())?;
        self.validate()?;
        Ok(data)
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn native_readiness_failure(
        &self,
        diagnostic: &NativeReadinessDiagnostic,
    ) -> Result<serde_json::Value, StoreError> {
        use sha2::{Digest, Sha256};
        self.validate()?;
        if !self.native_g1() || !diagnostic.valid() {
            return Err(invalid());
        }
        let data = serde_json::json!({
            "version":1,"kind":"g1-native-readiness-failure","scope":"controlled-native-g1",
            "pid":std::process::id(),"nonceSha256":format!("{:x}",Sha256::digest(self.scope.nonce.as_bytes())),
            "diagnostic":diagnostic
        });
        let bytes = serde_json::to_vec(&data).map_err(|_| invalid())?;
        if bytes.len() > 4096 {
            return Err(invalid());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| invalid())?;
        self.validate()?;
        let path = self
            .scope
            .app
            .join(format!("native-failure-{}.json", now.as_nanos()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .map_err(|_| invalid())?;
        file.write_all(&bytes).map_err(|_| invalid())?;
        file.sync_all().map_err(|_| invalid())?;
        self.validate()?;
        Ok(data)
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn open_native_store(self: &Arc<Self>) -> Result<AppStore, StoreError> {
        let mut model = self.scope.model.as_ref().ok_or_else(invalid)?.model();
        if self.native_g1() {
            model.providers["providers"][0]["network"]["timeoutMs"] = serde_json::json!(30000);
        }
        let guard = self.clone();
        if self.native_g1() {
            AppStore::open_g1_verification(
                self.scope.app.join("application"),
                self.scope.workspace.clone(),
                model,
                Arc::new(move || guard.validate()),
            )
        } else {
            AppStore::open_verification(
                self.scope.app.join("application"),
                self.scope.workspace.clone(),
                model,
                Arc::new(move || guard.validate()),
            )
        }
    }
}
pub(crate) fn open_local(
    app: &Path,
    nonce: &str,
    marker: &str,
    reopen: bool,
    upgrade: bool,
) -> Result<LocalState, StoreError> {
    if ![".s33-discovery-verification", ".s33-ui-verification"].contains(&marker) {
        return Err(invalid());
    }
    open_inner(app, nonce, marker, reopen, upgrade, None)
}
#[cfg(feature = "s33-mcp-ui-verification")]
pub(crate) fn open_native_local(
    app: &Path,
    nonce: &str,
    reopen: bool,
    model: NativeModelOwner,
) -> Result<LocalState, StoreError> {
    model.validate()?;
    if model.nonce != nonce {
        return Err(invalid());
    }
    open_inner(
        app,
        nonce,
        ".p6-native-verification",
        reopen,
        true,
        Some(model),
    )
}
#[cfg(feature = "s33-mcp-ui-verification")]
pub(crate) fn open_g1_native_local(
    app: &Path,
    nonce: &str,
    reopen: bool,
    model: NativeModelOwner,
) -> Result<LocalState, StoreError> {
    model.validate()?;
    if model.nonce != nonce {
        return Err(invalid());
    }
    open_inner(
        app,
        nonce,
        ".s36-native-verification",
        reopen,
        true,
        Some(model),
    )
}
fn open_inner(
    app: &Path,
    nonce: &str,
    marker: &str,
    reopen: bool,
    upgrade: bool,
    model: Option<NativeModelOwner>,
) -> Result<LocalState, StoreError> {
    if !app.is_absolute() || nonce.len() != 48 || !nonce.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(invalid());
    }
    let parent = app
        .parent()
        .ok_or_else(invalid)?
        .canonicalize()
        .map_err(|_| invalid())?;
    let temporary = std::env::temp_dir().canonicalize().map_err(|_| invalid())?;
    let private_tmp = Path::new("/tmp").canonicalize().map_err(|_| invalid())?;
    if !parent.starts_with(temporary) && !parent.starts_with(private_tmp) {
        return Err(invalid());
    }
    if !reopen {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(app)
            .map_err(|_| invalid())?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(app.join(marker))
            .map_err(|_| invalid())?;
        file.write_all(nonce.as_bytes()).map_err(|_| invalid())?;
        file.sync_all().map_err(|_| invalid())?;
    }
    directory(app)?;
    let app = app.canonicalize().map_err(|_| invalid())?;
    let workspace = app.join("workspace");
    if private_file(&app.join(marker))? != nonce.as_bytes() {
        return Err(invalid());
    }
    if !reopen {
        let application = app.join("application");
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&application)
            .map_err(|_| invalid())?;
        let mut store = AppStore::open(application)?;
        store.initialize(Some(workspace.clone()), "UTC")?;
        if upgrade {
            store.upgrade_mcp_storage()?;
        }
        drop(store);
        pointers(&app, &workspace)?;
        let names: &[&str] = if model.is_some() {
            &NATIVE_DIRECTORIES
        } else {
            &DIRECTORIES
        };
        let directories = names
            .iter()
            .map(|name| {
                let m = directory(&app.join(name))?;
                Ok(Identity {
                    name: (*name).into(),
                    dev: m.dev(),
                    ino: m.ino(),
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        let database = if model.is_some() {
            let m = fs::symlink_metadata(workspace.join("data/sidekick.sqlite"))
                .map_err(|_| invalid())?;
            Some(Identity {
                name: "workspace/data/sidekick.sqlite".into(),
                dev: m.dev(),
                ino: m.ino(),
            })
        } else {
            None
        };
        let scope = Scope {
            version: 1,
            app: app.clone(),
            workspace: workspace.clone(),
            nonce: nonce.into(),
            marker: marker.into(),
            directories,
            owner: Some(owner_id()),
            model: model.clone(),
            database,
        };
        let data = serde_json::to_vec(&scope).map_err(|_| invalid())?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(app.join(SCOPE))
            .map_err(|_| invalid())?;
        file.write_all(&data).map_err(|_| invalid())?;
        file.sync_all().map_err(|_| invalid())?;
        File::open(&app)
            .and_then(|file| file.sync_all())
            .map_err(|_| invalid())?;
    }
    let bytes = private_file(&app.join(SCOPE))?;
    let scope: Scope = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if scope.version != 1
        || scope.app != app
        || scope.workspace != workspace
        || scope.nonce != nonce
        || scope.marker != marker
        || scope.model != model
        || model.is_some() && (scope.owner != Some(owner_id()) || scope.database.is_none())
    {
        return Err(invalid());
    }
    let mut held = scope
        .directories
        .iter()
        .map(|id| File::open(app.join(&id.name)).map_err(|_| invalid()))
        .collect::<Result<Vec<_>, StoreError>>()?;
    if let Some(id) = &scope.database {
        held.push(File::open(app.join(&id.name)).map_err(|_| invalid())?);
    }
    let guard = Arc::new(VerificationRoot { scope, bytes, held });
    guard.validate()?;
    Ok(LocalState::new(app.join("application")).with_verification_guard(guard))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_v3_upgrade_scope_uses_the_confirmed_entry_and_reopens_v4() {
        let nonce = crate::mcp_host::nonce();
        let base = std::env::temp_dir().join(format!("sidekick-s33-upgrade-guard-{nonce}"));
        fs::DirBuilder::new().mode(0o700).create(&base).unwrap();
        let app = base.join("app");
        let local = open_local(&app, &nonce, ".s33-ui-verification", false, false).unwrap();
        let status = local.access(|s| s.mcp_storage_status()).unwrap();
        assert_eq!(status.version, 3);
        let runtime = crate::runtime_host::RuntimeState::default();
        runtime
            .confirm_mcp_storage(
                &local,
                crate::local_store::McpUpgradeInput {
                    confirmed: true,
                    confirmation_token: status.confirmation_token.unwrap(),
                },
            )
            .unwrap();
        drop(local);
        assert!(open_local(&app, "not-the-nonce", ".s33-ui-verification", true, false).is_err());
        let reopened = open_local(&app, &nonce, ".s33-ui-verification", true, false).unwrap();
        assert_eq!(
            reopened.access(|s| s.mcp_storage_status()).unwrap().version,
            4
        );
        assert_eq!(
            fs::read_dir(app.join("workspace/backups")).unwrap().count(),
            1
        );
        drop(reopened);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn verification_guard_rechecks_model_journal_before_every_action() {
        let nonce = crate::mcp_host::nonce();
        let base = std::env::temp_dir().join(format!("sidekick-s33-guard-{nonce}"));
        fs::DirBuilder::new().mode(0o700).create(&base).unwrap();
        let app = base.join("app");
        let state = open_local(&app, &nonce, ".s33-ui-verification", false, true).unwrap();
        state.access(|s| s.info()).unwrap();
        let path = app.join("workspace/config/.llm-journal.json");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        file.write_all(b"synthetic-never-read").unwrap();
        drop(file);
        let mut entered = false;
        let result = state.access(|_| {
            entered = true;
            Ok(())
        });
        assert_eq!(result.unwrap_err().code, "VERIFY_INPUT");
        assert!(!entered);
        assert_eq!(fs::read(&path).unwrap(), b"synthetic-never-read");
        drop(state);
        fs::remove_dir_all(base).unwrap();
    }
}

#[cfg(all(test, feature = "s33-mcp-ui-verification"))]
mod native_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::os::unix::fs::PermissionsExt;
    use std::process::{Child, Command, Stdio};
    struct Fixture {
        base: PathBuf,
        app: PathBuf,
        nonce: String,
        model: Child,
        owner: NativeModelOwner,
    }
    impl Fixture {
        fn new() -> Self {
            Self::new_mode("normal")
        }
        fn new_mode(mode: &str) -> Self {
            let nonce = crate::mcp_host::nonce();
            let base = std::env::temp_dir().join(format!("sidekick-p6-guard-{nonce}"));
            fs::DirBuilder::new().mode(0o700).create(&base).unwrap();
            let base = base.canonicalize().unwrap();
            let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .to_path_buf();
            let script = repo
                .join("tests/fixtures/mcp-trial.mjs")
                .canonicalize()
                .unwrap();
            let marker = if mode == "g1" {
                base.join("g1-app/synthetic-marker")
                    .to_string_lossy()
                    .into_owned()
            } else {
                "guard".into()
            };
            let mut model = Command::new(repo.join("build/s0-runtime/node"))
                .arg(&script)
                .args([
                    "model",
                    base.join("model.jsonl").to_str().unwrap(),
                    mode,
                    &marker,
                    &nonce,
                ])
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            let mut url = String::new();
            BufReader::new(model.stdout.take().unwrap())
                .read_line(&mut url)
                .unwrap();
            let port = url
                .trim()
                .strip_prefix("http://127.0.0.1:")
                .unwrap()
                .strip_suffix("/v1")
                .unwrap()
                .parse()
                .unwrap();
            let owner = NativeModelOwner::capture(port, model.id(), &nonce, script).unwrap();
            let app = base.join("app");
            drop(open_native_local(&app, &nonce, false, owner.clone()).unwrap());
            Self {
                base,
                app,
                nonce,
                model,
                owner,
            }
        }
        fn guard(&self) -> Arc<VerificationRoot> {
            let bytes = private_file(&self.app.join(SCOPE)).unwrap();
            let scope: Scope = serde_json::from_slice(&bytes).unwrap();
            let mut held = scope
                .directories
                .iter()
                .map(|id| File::open(self.app.join(&id.name)).unwrap())
                .collect::<Vec<_>>();
            held.push(File::open(self.app.join("workspace/data/sidekick.sqlite")).unwrap());
            let guard = Arc::new(VerificationRoot { scope, bytes, held });
            guard.validate().unwrap();
            guard
        }
        fn status(&self, id: &str) -> String {
            rusqlite::Connection::open_with_flags(
                self.app.join("workspace/data/sidekick.sqlite"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
            )
            .unwrap()
            .query_row("SELECT status FROM runs WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .unwrap()
        }
        fn pending(&self) -> String {
            let mut store = self.guard().open_native_store().unwrap();
            store
                .begin_model_test(serde_json::json!({"canary":"p6"}))
                .unwrap()
                .id
        }
        fn no_http(&self) {
            assert!(!self.base.join("model.jsonl").exists());
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            crate::local_store::verification_checkpoint_hook(None);
            let _ = self.model.kill();
            let _ = self.model.wait();
            if !std::thread::panicking() {
                let _ = fs::remove_dir_all(&self.base);
            } else {
                eprintln!("retained P6 guard fixture: {}", self.base.display());
            }
        }
    }
    fn verification_g1_rows(path: &Path) -> Vec<serde_json::Value> {
        let db = rusqlite::Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .unwrap();
        [
            "sources",
            "candidates",
            "todos",
            "todo_events",
            "todo_sources",
            "agent_runs",
            "tool_calls",
            "runs",
        ]
        .into_iter()
        .map(|table| {
            let mut query = db
                .prepare(&format!("SELECT rowid,* FROM {table} ORDER BY rowid"))
                .unwrap();
            let width = query.column_count();
            let rows = query
                .query_map([], |row| {
                    (0..width)
                        .map(|column| row.get_ref(column).map(|value| format!("{value:?}")))
                        .collect::<Result<Vec<_>, _>>()
                })
                .unwrap()
                .map(|row| row.unwrap())
                .collect::<Vec<_>>();
            serde_json::json!({"table":table,"rows":rows})
        })
        .collect()
    }
    fn verification_g1_seed(local: &LocalState, app: &Path) {
        use crate::local_store::{CandidateDraft, SignChoice, TextInput, TodoInput};
        let old_trial = local
            .access(|store| {
                let fields = TodoInput {
                    title: "核对合成清单".into(),
                    kind: "action".into(),
                    owner: "我".into(),
                    priority: "medium".into(),
                    tags: vec!["synthetic".into()],
                    due: None,
                    followup: None,
                };
                store.create(fields.clone(), "verification-g1-manual")?;
                let input = TextInput {
                    text: "我整理合成清单。".into(),
                    source_at_ms: None,
                    time_zone: "UTC".into(),
                };
                let imported = store.begin_import(input.clone(), serde_json::Value::Null, false)?;
                let published = store.publish_candidates(
                    &imported.run.unwrap().id,
                    vec![CandidateDraft {
                        fields,
                        evidence: input.text.clone(),
                        due_expression: None,
                        followup_expression: None,
                        warnings: vec![],
                        unresolved: false,
                    }],
                )?;
                let candidate = &published.candidates[0];
                store.sign_candidates(
                    vec![SignChoice {
                        candidate_id: candidate.id.clone(),
                        expected_version: candidate.version,
                        fields: candidate.draft.fields.clone(),
                        time_reviewed: true,
                        target: None,
                    }],
                    "verification-g1-sign",
                )?;
                let prepared = store.prepare_agent_model("organizer")?;
                let run =
                    store.begin_prepared_agent_trial("organizer", input, prepared.snapshot)?;
                store.complete_agent_trial(&run.id, vec![])?;
                Ok(run.id)
            })
            .unwrap();
        let database = app.join("workspace/data/sidekick.sqlite");
        let db = rusqlite::Connection::open_with_flags(
            &database,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        db.execute(
            "INSERT INTO tool_calls(id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,response_category,created_at_ms,finished_at_ms) VALUES('g1-old-call',?1,'old-model','old-revision',?2,'old-server','old-tool',?2,'responded','success',1,2)",
            rusqlite::params![old_trial, "a".repeat(64)],
        )
        .unwrap();
        drop(db);
    }
    #[test]
    fn verification_g1_v5_reopens_through_guarded_store_without_losing_rows() {
        use crate::local_store::McpUpgradeInput;
        let fixture = Fixture::new();
        let app = fixture.base.join("g1-app");
        let open = |reopen| {
            open_inner(
                &app,
                &fixture.nonce,
                ".s36-native-verification",
                reopen,
                true,
                Some(fixture.owner.clone()),
            )
            .unwrap()
        };
        let local = open(false);
        verification_g1_seed(&local, &app);
        let database = app.join("workspace/data/sidekick.sqlite");
        let status = local.access(|store| store.today_storage_status()).unwrap();
        local
            .access(|store| {
                store.confirm_today_upgrade(McpUpgradeInput {
                    confirmed: true,
                    confirmation_token: status.confirmation_token.unwrap(),
                })
            })
            .unwrap();
        drop(local);
        let before = verification_g1_rows(&database);
        assert!(before
            .iter()
            .all(|table| !table["rows"].as_array().unwrap().is_empty()));
        let reopened = open(true);
        let version = reopened
            .access(|store| store.today_storage_status())
            .map(|s| s.version);
        assert!(
            matches!(version, Ok(5)),
            "G1 v5 guarded reopen: {version:?}"
        );
        drop(reopened);
        assert_eq!(verification_g1_rows(&database), before);
        fixture.no_http();
    }
    #[test]
    fn verification_g1_and_legacy_native_markers_cannot_be_cross_reopened() {
        let fixture = Fixture::new();
        let app = fixture.base.join("g1-app");
        drop(open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap());
        let before = fs::read(app.join(SCOPE)).unwrap();
        assert!(open_native_local(&app, &fixture.nonce, true, fixture.owner.clone()).is_err());
        assert!(
            open_g1_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone())
                .is_err()
        );
        assert!(open_g1_native_local(&app, &"f".repeat(48), true, fixture.owner.clone()).is_err());
        assert_eq!(fs::read(app.join(SCOPE)).unwrap(), before);
        fixture.no_http();
    }
    #[test]
    fn verification_g1_does_not_relax_legacy_native_v4_policy() {
        use crate::local_store::McpUpgradeInput;
        let fixture = Fixture::new();
        let local =
            open_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone()).unwrap();
        let status = local.access(|store| store.today_storage_status()).unwrap();
        local
            .access(|store| {
                store.confirm_today_upgrade(McpUpgradeInput {
                    confirmed: true,
                    confirmation_token: status.confirmation_token.unwrap(),
                })
            })
            .unwrap();
        drop(local);
        let database = fixture.app.join("workspace/data/sidekick.sqlite");
        let before = fs::read(&database).unwrap();
        let reopened =
            open_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone()).unwrap();
        assert_eq!(
            reopened.access(|store| store.info()).unwrap_err().code,
            "VERIFY_INPUT"
        );
        drop(reopened);
        assert_eq!(fs::read(database).unwrap(), before);
        fixture.no_http();
    }
    #[test]
    fn verification_g1_rejects_damaged_v5_and_future_versions_without_repair() {
        use crate::local_store::McpUpgradeInput;
        let fixture = Fixture::new();
        for (name, sql) in [
            ("damaged", "DROP TABLE tool_calls;"),
            ("future", "PRAGMA user_version=6;"),
        ] {
            let app = fixture.base.join(name);
            let local =
                open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap();
            assert_eq!(
                local
                    .access(|store| store.mcp_storage_status())
                    .unwrap()
                    .version,
                4
            );
            let status = local.access(|store| store.today_storage_status()).unwrap();
            local
                .access(|store| {
                    store.confirm_today_upgrade(McpUpgradeInput {
                        confirmed: true,
                        confirmation_token: status.confirmation_token.unwrap(),
                    })
                })
                .unwrap();
            drop(local);
            let database = app.join("workspace/data/sidekick.sqlite");
            let db = rusqlite::Connection::open_with_flags(
                &database,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                    | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
            )
            .unwrap();
            db.execute_batch(sql).unwrap();
            drop(db);
            let before = fs::read(&database).unwrap();
            let identity = fs::symlink_metadata(&database).unwrap();
            let reopened =
                open_g1_native_local(&app, &fixture.nonce, true, fixture.owner.clone()).unwrap();
            assert!(reopened.access(|store| store.info()).is_err(), "{name}");
            drop(reopened);
            let after = fs::symlink_metadata(&database).unwrap();
            assert_eq!((after.dev(), after.ino()), (identity.dev(), identity.ino()));
            assert_eq!(fs::read(database).unwrap(), before, "{name}");
        }
        fixture.no_http();
    }
    fn verification_g1_wait(runtime: &crate::runtime_host::RuntimeState) {
        let started = std::time::Instant::now();
        while let Some(id) = runtime.active_run() {
            if started.elapsed() > std::time::Duration::from_secs(20) {
                runtime.cancel(&id);
                let cleanup = std::time::Instant::now();
                while runtime.active_run().is_some()
                    && cleanup.elapsed() < std::time::Duration::from_secs(5)
                {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                panic!("G1 run failed to finish: {id}");
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
    #[test]
    fn verification_g1_real_host_runs_toolless_roles_and_reopens_last_today_success() {
        use crate::local_store::{McpUpgradeInput, TextInput};
        let fixture = Fixture::new_mode("g1");
        let app = fixture.base.join("g1-app");
        let local =
            open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap();
        verification_g1_seed(&local, &app);
        let database = app.join("workspace/data/sidekick.sqlite");
        let formal = || {
            verification_g1_rows(&database)
                .into_iter()
                .filter(|table| table["table"] != "agent_runs")
                .collect::<Vec<_>>()
        };
        let baseline = formal();
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("build/s0-runtime");
        let runtime = crate::runtime_host::RuntimeState::default();
        for role in ["tracker", "advisor"] {
            let run = runtime
                .start_trial(
                    local.clone(),
                    directory.clone(),
                    role,
                    TextInput {
                        text: "林川已提交SDK鉴权修复，等待我验收。".into(),
                        source_at_ms: Some(1793239200000),
                        time_zone: "Asia/Shanghai".into(),
                    },
                    Arc::new(|_, _| {}),
                )
                .unwrap();
            verification_g1_wait(&runtime);
            let saved = local.access(|store| store.agent_run(&run.id)).unwrap();
            assert_eq!(saved.status, "succeeded", "{role}: {:?}", saved.error_code);
            assert_eq!(formal(), baseline);
        }
        let status = local.access(|store| store.today_storage_status()).unwrap();
        runtime
            .confirm_today_storage(
                &local,
                McpUpgradeInput {
                    confirmed: true,
                    confirmation_token: status.confirmation_token.unwrap(),
                },
            )
            .unwrap();
        let run = runtime
            .start_today(local.clone(), directory, Arc::new(|_, _| {}))
            .unwrap();
        verification_g1_wait(&runtime);
        let saved = local
            .access(|store| store.today_advice_run(&run.id))
            .unwrap();
        assert_eq!(saved.status, "succeeded", "{:?}", saved.error_code);
        assert!(!saved.result.unwrap().ranking.is_empty());
        assert_eq!(formal(), baseline);
        let records = fs::read_to_string(fixture.base.join("model.jsonl")).unwrap();
        let records = records
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .collect::<Vec<_>>();
        let models = records
            .iter()
            .filter(|record| record["type"] == "model")
            .collect::<Vec<_>>();
        assert_eq!(models.len(), 3);
        assert!(models
            .iter()
            .all(|record| record["allNames"] == serde_json::json!([])));
        assert!(records
            .iter()
            .any(|record| record["type"] == "g1-ready" && record["runId"] == run.id));
        let before = verification_g1_rows(&database);
        drop(local);
        let reopened =
            open_g1_native_local(&app, &fixture.nonce, true, fixture.owner.clone()).unwrap();
        let previous = reopened
            .access(|store| store.today_advice_run(&run.id))
            .unwrap();
        assert_eq!(previous.status, "succeeded");
        assert!(previous.result.is_some());
        drop(reopened);
        assert_eq!(verification_g1_rows(&database), before);
    }
    fn verification_g1_skill(local: &LocalState, app: &Path, directory: &Path) {
        let skill = app.join("workspace/skills/s36-reader");
        fs::create_dir_all(skill.join("references")).unwrap();
        fs::create_dir_all(skill.join("scripts")).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: s36-reader\ndescription: Read the controlled G1 acceptance input and run its owned script.\n---\n# G1 synthetic reader\nRead [context](references/context.md), then run scripts/echo.sh.\n",
        )
        .unwrap();
        fs::write(
            skill.join("references/context.md"),
            "G1 controlled relative context.\n",
        )
        .unwrap();
        fs::write(
            skill.join("scripts/echo.sh"),
            "#!/bin/sh\nif /usr/bin/env | /usr/bin/grep -q '^SIDEKICK_S36_NATIVE_MODEL_PIN='; then exit 91; fi\nprintf 'g1-skill-ok' > g1-skill-output.txt\nprintf 'g1-skill-ok\\n'\n",
        )
        .unwrap();
        let catalog = local
            .access(|store| {
                crate::skills_host::request(
                    directory,
                    &store.root()?,
                    serde_json::json!({"action":"scan"}),
                )
            })
            .unwrap();
        assert!(catalog["skills"]
            .as_array()
            .unwrap()
            .iter()
            .any(|skill| skill["name"] == "s36-reader"));
    }
    #[test]
    fn verification_g1_organizer_reads_relative_skill_and_runs_bash_without_transport_leak() {
        use crate::local_store::TextInput;
        let fixture = Fixture::new_mode("g1");
        let app = fixture.base.join("g1-app");
        let local =
            open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap();
        verification_g1_seed(&local, &app);
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("build/s0-runtime");
        verification_g1_skill(&local, &app, &directory);
        let database = app.join("workspace/data/sidekick.sqlite");
        let formal = || {
            verification_g1_rows(&database)
                .into_iter()
                .filter(|table| table["table"] != "agent_runs")
                .collect::<Vec<_>>()
        };
        let before = formal();
        let runtime = crate::runtime_host::RuntimeState::default();
        let run = runtime
            .start_trial(
                local.clone(),
                directory,
                "organizer",
                TextInput {
                    text: "我整理合成清单。".into(),
                    source_at_ms: None,
                    time_zone: "UTC".into(),
                },
                Arc::new(|_, _| {}),
            )
            .unwrap();
        verification_g1_wait(&runtime);
        let saved = local.access(|store| store.agent_run(&run.id)).unwrap();
        assert_eq!(saved.status, "succeeded", "{:?}", saved.error_code);
        let run_directory = app.join("workspace/runs").join(&run.id);
        let proof: serde_json::Value =
            serde_json::from_slice(&fs::read(run_directory.join("skills-proof.json")).unwrap())
                .unwrap();
        let proof = proof.as_array().unwrap();
        assert_eq!(
            proof.iter().filter(|entry| entry["type"] == "read").count(),
            2
        );
        assert_eq!(
            proof.iter().filter(|entry| entry["type"] == "bash").count(),
            1
        );
        assert!(proof.iter().any(|entry| entry["path"]
            .as_str()
            .is_some_and(|path| path.ends_with("references/context.md"))));
        assert_eq!(
            fs::read_to_string(run_directory.join("g1-skill-output.txt")).unwrap(),
            "g1-skill-ok"
        );
        assert_eq!(formal(), before);
        let records = fs::read_to_string(fixture.base.join("model.jsonl")).unwrap();
        assert!(!records.contains("SIDEKICK_S36_NATIVE_MODEL_PIN"));
        assert!(!records.contains(&fixture.owner.command));
    }
    #[test]
    fn verification_g1_and_legacy_mcp_keep_tool_boundaries_and_service_environment_clean() {
        use crate::local_store::{McpServerInput, TextInput};
        for g1 in [false, true] {
            let fixture = Fixture::new_mode(if g1 { "g1" } else { "normal" });
            let app = if g1 {
                fixture.base.join("g1-app")
            } else {
                fixture.app.clone()
            };
            let local = if g1 {
                open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap()
            } else {
                open_native_local(&app, &fixture.nonce, true, fixture.owner.clone()).unwrap()
            };
            let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("build/s0-runtime");
            verification_g1_seed(&local, &app);
            verification_g1_skill(&local, &app, &directory);
            let service_log = fixture.base.join("service.jsonl");
            let probe = fixture.base.join("service-environment.json");
            let wrapper = fixture.base.join("service-wrapper.mjs");
            let configuration = serde_json::json!({
                "probe":probe,
                "script":fixture.owner.script,
                "record":service_log,
                "marker":fixture.base.join("service-marker")
            });
            let source = "import {writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';\nconst input=".to_string()
                + &configuration.to_string()
                + ";\nwriteFileSync(input.probe,JSON.stringify({controlPresent:Object.hasOwn(process.env,'SIDEKICK_S36_NATIVE_MODEL_PIN')}),{mode:0o600,flag:'wx'});\nprocess.argv=[process.execPath,input.script,'service',input.record,'normal',input.marker];await import(pathToFileURL(input.script).href);\n";
            fs::write(&wrapper, source).unwrap();
            local
                .access(|store| {
                    store.save_mcp_server(McpServerInput {
                        id: None,
                        expected_revision: store.mcp_configuration()?.revision,
                        server: serde_json::from_value(serde_json::json!({
                            "name":"synthetic-scope-service","transport":"stdio","enabled":true,
                            "command":directory.join("node"),"args":[wrapper],"cwd":null,"env":[],
                            "connectTimeoutMs":3000,"toolTimeoutMs":1000
                        }))
                        .unwrap(),
                    })
                })
                .unwrap();
            let database = app.join("workspace/data/sidekick.sqlite");
            let formal = || {
                verification_g1_rows(&database)
                    .into_iter()
                    .filter(|table| {
                        table["table"] != "agent_runs" && table["table"] != "tool_calls"
                    })
                    .collect::<Vec<_>>()
            };
            let before = formal();
            let runtime = crate::runtime_host::RuntimeState::default();
            let run = runtime
                .start_trial(
                    local.clone(),
                    directory,
                    "organizer",
                    TextInput {
                        text: "我整理合成清单。".into(),
                        source_at_ms: None,
                        time_zone: "UTC".into(),
                    },
                    Arc::new(|_, _| {}),
                )
                .unwrap();
            verification_g1_wait(&runtime);
            let result = local.access(|store| store.agent_run(&run.id)).unwrap();
            assert_eq!(
                result.status, "succeeded",
                "g1={g1}: {:?}",
                result.error_code
            );
            assert_eq!(formal(), before);
            let environment: serde_json::Value =
                serde_json::from_slice(&fs::read(probe).unwrap()).unwrap();
            assert_eq!(environment["controlPresent"], false);
            let records = fs::read_to_string(fixture.base.join("model.jsonl")).unwrap();
            let models = records
                .lines()
                .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
                .filter(|record| record["type"] == "model")
                .collect::<Vec<_>>();
            assert_eq!(models.len(), 2);
            for model in &models {
                let names = model["allNames"].as_array().unwrap();
                assert!(names
                    .iter()
                    .any(|name| name.as_str().unwrap().starts_with("mcp_")));
                assert_eq!(names.iter().any(|name| name == "read"), g1);
                assert_eq!(names.iter().any(|name| name == "bash"), g1);
            }
            let service = fs::read_to_string(service_log).unwrap();
            assert_eq!(
                service
                    .lines()
                    .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
                    .filter(|record| record["type"] == "call")
                    .count(),
                1
            );
        }
    }
    #[test]
    fn verification_g1_startup_identity_is_private_and_bound_before_geometry() {
        let fixture = Fixture::new_mode("g1");
        let app = fixture.base.join("g1-app");
        let local =
            open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap();
        let scope = format!(
            "controlled-native-g1:{}:{}",
            fixture.owner.port, fixture.owner.pid
        );
        let identity = local.native_startup_identity(&scope).unwrap();
        assert_eq!(identity["pid"], std::process::id());
        assert_eq!(identity["uid"], owner_id());
        assert_eq!(identity["root"], serde_json::json!(app));
        assert_eq!(identity["nonce"], fixture.nonce);
        assert_eq!(identity["launchScope"], scope);
        assert_eq!(identity["scope"], "controlled-native-g1");
        assert!(identity["identity"]
            .as_str()
            .unwrap()
            .contains(identity["command"].as_str().unwrap()));
        let entries = || {
            fs::read_dir(&app)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .filter(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with("native-startup-")
                })
                .collect::<Vec<_>>()
        };
        let paths = entries();
        assert_eq!(paths.len(), 1);
        let metadata = fs::symlink_metadata(&paths[0]).unwrap();
        assert_eq!(metadata.mode() & 0o7777, 0o600);
        assert_eq!(metadata.nlink(), 1);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&paths[0]).unwrap()).unwrap(),
            identity
        );
        assert!(local
            .native_startup_identity("controlled-native-mcp:1493:123")
            .is_err());
        assert_eq!(entries(), paths);
        let legacy =
            open_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone()).unwrap();
        assert!(legacy.native_startup_identity(&scope).is_err());
        fixture.no_http();
    }
    #[test]
    fn verification_g1_readiness_failure_is_private_bounded_and_redacted() {
        use sha2::{Digest, Sha256};
        let fixture = Fixture::new_mode("g1");
        let app = fixture.base.join("g1-app");
        let local =
            open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap();
        let mut diagnostic = NativeReadinessDiagnostic::new(1440, 800);
        diagnostic.stage = "position";
        diagnostic.reason = "deadline";
        diagnostic.inner = Some([2880, 1600]);
        diagnostic.scale = Some(2.0);
        diagnostic.monitor = Some([-100, -200, 1280, 800]);
        diagnostic.work_area = Some([-100, -134, 1280, 700]);
        diagnostic.outer = Some([2880, 1656]);
        diagnostic.target = Some([72, 154]);
        diagnostic.position = Some([72, 150]);
        let data = local.native_readiness_failure(&diagnostic).unwrap();
        assert_eq!(data["pid"], std::process::id());
        assert_eq!(
            data["nonceSha256"],
            format!("{:x}", Sha256::digest(fixture.nonce.as_bytes()))
        );
        assert_eq!(data["diagnostic"]["monitor"][0], -100);
        assert_eq!(data["diagnostic"]["outer"][0], 2880);
        let paths = fs::read_dir(&app)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("native-failure-")
            })
            .collect::<Vec<_>>();
        assert_eq!(paths.len(), 1);
        let metadata = fs::symlink_metadata(&paths[0]).unwrap();
        assert_eq!(metadata.mode() & 0o7777, 0o600);
        assert_eq!(metadata.nlink(), 1);
        assert!(metadata.len() <= 4096);
        let bytes = fs::read(&paths[0]).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            data
        );
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains(&fixture.nonce));
        assert!(!text.contains(fixture.base.to_str().unwrap()));
        assert!(!text.contains("command") && !text.contains("env") && !text.contains("model"));
        assert!(fs::read_dir(&app).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("native-info-")));
        fixture.no_http();
    }
    #[test]
    fn verification_readiness_failure_rejects_invalid_observations_and_other_scopes() {
        let fixture = Fixture::new_mode("g1");
        let app = fixture.base.join("g1-app");
        let local =
            open_g1_native_local(&app, &fixture.nonce, false, fixture.owner.clone()).unwrap();
        for invalid_kind in ["stage", "reason", "scale", "rect", "requested"] {
            let mut diagnostic = NativeReadinessDiagnostic::new(1440, 800);
            match invalid_kind {
                "stage" => diagnostic.stage = "PRIVATE_DIAGNOSTIC_CANARY",
                "reason" => diagnostic.reason = "PRIVATE_DIAGNOSTIC_CANARY",
                "scale" => diagnostic.scale = Some(f64::NAN),
                "rect" => diagnostic.monitor = Some([i64::MAX, 0, 1, 1]),
                "requested" => diagnostic.requested = [0, 0],
                _ => unreachable!(),
            }
            assert!(local.native_readiness_failure(&diagnostic).is_err());
        }
        let diagnostic = NativeReadinessDiagnostic::new(1440, 800);
        let legacy =
            open_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone()).unwrap();
        assert!(legacy.native_readiness_failure(&diagnostic).is_err());
        let ordinary = LocalState::new(fixture.base.join("must-not-create"));
        assert!(ordinary.native_readiness_failure(&diagnostic).is_err());
        assert!(!fixture.base.join("must-not-create").exists());
        assert!(fs::read_dir(&app).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("native-failure-")));
        fs::write(app.join(".s36-native-verification"), "wrong-marker").unwrap();
        assert!(local.native_readiness_failure(&diagnostic).is_err());
        assert!(fs::read_dir(&app).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("native-failure-")));
        fixture.no_http();
    }
    #[test]
    fn verification_native_immutable_model_and_recovery_have_a_positive_control() {
        let fixture = Fixture::new();
        let guard = fixture.guard();
        let mut store = guard.open_native_store().unwrap();
        let config = store.read_models().unwrap().unwrap();
        assert_eq!(config.default_model_id, "p6-synthetic");
        let model = store.prepare_model().unwrap();
        assert_eq!(model.api_key, "p6-synthetic-token");
        assert_eq!(
            model.snapshot["provider"]["baseUrl"],
            format!("http://127.0.0.1:{}/v1", fixture.owner.port)
        );
        assert!(guard.native_pin().is_some());
        let run = store.begin_model_test(serde_json::json!({})).unwrap();
        drop(store);
        assert_eq!(fixture.status(&run.id), "running");
        drop(guard.open_native_store().unwrap());
        assert_eq!(fixture.status(&run.id), "interrupted");
        assert!(
            open_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone()).is_ok()
        );
        assert!(open_local(
            &fixture.app,
            &fixture.nonce,
            ".s33-ui-verification",
            true,
            true
        )
        .is_err());
        fixture.no_http();
    }
    #[test]
    fn verification_native_consumer_rejects_files_inserted_after_outer_validation() {
        for name in ["providers.json", "models.json", ".llm-journal.json"] {
            let fixture = Fixture::new();
            let guard = fixture.guard();
            let store = guard.open_native_store().unwrap();
            guard.validate().unwrap();
            let path = fixture.app.join("workspace/config").join(name);
            let bytes=br#"{"version":1,"providers":{"providers":[{"auth":{"apiKeyEnv":"P6_FORBIDDEN_ENV"},"baseUrl":"https://example.invalid"}]},"models":{}}"#;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .unwrap();
            file.write_all(bytes).unwrap();
            drop(file);
            assert_eq!(store.read_models().unwrap_err().code, "VERIFY_INPUT");
            assert_eq!(store.prepare_model().err().unwrap().code, "VERIFY_INPUT");
            assert_eq!(fs::read(path).unwrap(), bytes);
            assert!(
                open_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone())
                    .is_err()
            );
            fixture.no_http();
        }
    }
    #[test]
    fn verification_native_pointer_swap_after_validation_never_recovers_other_root() {
        let a = Fixture::new();
        let b = Fixture::new();
        let pending = b.pending();
        let guard = a.guard();
        guard.validate().unwrap();
        let pointer = a.app.join("application/bootstrap.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&pointer).unwrap()).unwrap();
        value["root"] = b.app.join("workspace").to_string_lossy().to_string().into();
        value["timeZone"] = "Asia/Shanghai".into();
        fs::write(&pointer, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(
            guard.open_native_store().err().unwrap().code,
            "VERIFY_INPUT"
        );
        assert_eq!(b.status(&pending), "running");
        a.no_http();
        b.no_http();
    }
    #[test]
    fn verification_native_stable_identity_swap_is_refused_before_configuration_or_sql() {
        for checkpoint in [
            "before-configuration",
            "before-database-open",
            "before-write-sql",
        ] {
            for relative in [
                "workspace",
                "workspace/config",
                "workspace/data",
                "workspace/data/sidekick.sqlite",
            ] {
                let fixture = Fixture::new();
                let pending = fixture.pending();
                let guard = fixture.guard();
                let path = fixture.app.join(relative);
                let old = fixture.base.join("held-original");
                let path_for_hook = path.clone();
                let old_for_hook = old.clone();
                let point = checkpoint.to_string();
                let fired = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let once = fired.clone();
                let is_db = relative.ends_with("sqlite");
                crate::local_store::verification_checkpoint_hook(Some(Box::new(move |name| {
                    if name == point && !once.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        fs::rename(&path_for_hook, &old_for_hook).unwrap();
                        if is_db {
                            fs::copy(&old_for_hook, &path_for_hook).unwrap();
                            fs::set_permissions(&path_for_hook, fs::Permissions::from_mode(0o600))
                                .unwrap();
                        } else {
                            fs::DirBuilder::new()
                                .mode(0o700)
                                .create(&path_for_hook)
                                .unwrap();
                        }
                    }
                })));
                let result = guard.open_native_store();
                crate::local_store::verification_checkpoint_hook(None);
                assert!(
                    fired.load(std::sync::atomic::Ordering::SeqCst),
                    "{checkpoint} {relative}"
                );
                assert_eq!(
                    result.err().unwrap().code,
                    if checkpoint == "before-write-sql" && relative != "workspace/config" {
                        "MCP_DATABASE_CHANGED"
                    } else {
                        "VERIFY_INPUT"
                    },
                    "{checkpoint} {relative}"
                );
                if is_db {
                    fs::remove_file(&path).unwrap();
                } else {
                    assert_eq!(
                        fs::read_dir(&path).unwrap().count(),
                        0,
                        "replacement must not be repaired"
                    );
                    fs::remove_dir(&path).unwrap();
                }
                fs::rename(old, path).unwrap();
                assert_eq!(
                    fixture.status(&pending),
                    "running",
                    "recovery SQL must not execute"
                );
                fixture.no_http();
            }
        }
    }
    #[test]
    fn verification_native_owner_nonce_receipt_permissions_and_links_fail_closed() {
        let fixture = Fixture::new();
        assert!(open_native_local(
            &fixture.app,
            "000000000000000000000000000000000000000000000000",
            true,
            fixture.owner.clone()
        )
        .is_err());
        let mut changed = fixture.owner.clone();
        changed.command.push_str(" wrong-owner");
        assert!(open_native_local(&fixture.app, &fixture.nonce, true, changed).is_err());
        let guard = fixture.guard();
        let path = fixture.app.join("workspace/data/sidekick.sqlite");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(guard.validate().unwrap_err().code, "VERIFY_INPUT");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let link = fixture.base.join("database-link");
        fs::hard_link(&path, &link).unwrap();
        assert!(guard.validate().is_err());
        fs::remove_file(link).unwrap();
        let receipt = fixture.app.join(SCOPE);
        let bytes = fs::read(&receipt).unwrap();
        let mut changed = bytes.clone();
        changed.push(b' ');
        fs::write(&receipt, changed).unwrap();
        assert!(guard.validate().is_err());
        fs::write(receipt, bytes).unwrap();
        guard.validate().unwrap();
        fixture.no_http();
    }
    #[test]
    fn verification_native_exited_model_cannot_be_reopened() {
        let mut fixture = Fixture::new();
        fixture.model.kill().unwrap();
        fixture.model.wait().unwrap();
        assert!(
            open_native_local(&fixture.app, &fixture.nonce, true, fixture.owner.clone()).is_err()
        );
        fixture.no_http();
    }
}
