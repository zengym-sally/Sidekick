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
    pub(crate) fn open_native_store(self: &Arc<Self>) -> Result<AppStore, StoreError> {
        let model = self.scope.model.as_ref().ok_or_else(invalid)?.model();
        let guard = self.clone();
        AppStore::open_verification(
            self.scope.app.join("application"),
            self.scope.workspace.clone(),
            model,
            Arc::new(move || guard.validate()),
        )
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
            let mut model = Command::new(repo.join("build/s0-runtime/node"))
                .arg(&script)
                .args([
                    "model",
                    base.join("model.jsonl").to_str().unwrap(),
                    "normal",
                    "guard",
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
