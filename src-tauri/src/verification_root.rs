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
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Identity {
    name: String,
    dev: u64,
    ino: u64,
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
}
pub(crate) struct VerificationRoot {
    scope: Scope,
    bytes: Vec<u8>,
}
fn invalid() -> StoreError {
    StoreError {
        code: "VERIFY_INPUT",
        message: "隔离验证根或启动参数无法确认，未打开工作库。",
    }
}
fn directory(path: &Path) -> Result<fs::Metadata, StoreError> {
    let m = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if !m.is_dir() || m.file_type().is_symlink() || m.mode() & 0o7777 != 0o700 {
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
        || m.len() > 16384
    {
        return Err(invalid());
    }
    let f = File::open(path).map_err(|_| invalid())?;
    let opened = f.metadata().map_err(|_| invalid())?;
    if m.dev() != opened.dev() || m.ino() != opened.ino() || opened.nlink() != 1 {
        return Err(invalid());
    }
    let mut b = Vec::new();
    f.take(16385).read_to_end(&mut b).map_err(|_| invalid())?;
    let after = fs::symlink_metadata(path).map_err(|_| invalid())?;
    if b.len() > 16384
        || after.ino() != m.ino()
        || after.dev() != m.dev()
        || after.nlink() != 1
        || after.file_type().is_symlink()
        || after.mode() & 0o7777 != 0o600
    {
        return Err(invalid());
    }
    Ok(b)
}
fn pointers(app: &Path, workspace: &Path) -> Result<(), StoreError> {
    for name in ["bootstrap.json", "workspace-init.json"] {
        let p = app.join("application").join(name);
        if name == "workspace-init.json"
            && fs::symlink_metadata(&p).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
        {
            continue;
        }
        let v: serde_json::Value =
            serde_json::from_slice(&private_file(&p)?).map_err(|_| invalid())?;
        if v["app"] != "sidekick" || v["version"] != 1 || v["root"].as_str() != workspace.to_str() {
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
    pub(crate) fn validate(&self) -> Result<(), StoreError> {
        if self.scope.directories.len() != DIRECTORIES.len() {
            return Err(invalid());
        }
        for (id, name) in self.scope.directories.iter().zip(DIRECTORIES) {
            if id.name != name {
                return Err(invalid());
            }
            let m = directory(&self.scope.app.join(name))?;
            if m.dev() != id.dev || m.ino() != id.ino {
                return Err(invalid());
            }
        }
        if private_file(&self.scope.app.join(&self.scope.marker))? != self.scope.nonce.as_bytes()
            || private_file(&self.scope.app.join(SCOPE))? != self.bytes
        {
            return Err(invalid());
        }
        pointers(&self.scope.app, &self.scope.workspace)
    }
}
pub(crate) fn open_local(
    app: &Path,
    nonce: &str,
    marker: &str,
    reopen: bool,
    upgrade: bool,
) -> Result<LocalState, StoreError> {
    if !app.is_absolute()
        || nonce.len() != 48
        || !nonce.bytes().all(|b| b.is_ascii_hexdigit())
        || ![".s33-discovery-verification", ".s33-ui-verification"].contains(&marker)
    {
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
        let directories = DIRECTORIES
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
        let scope = Scope {
            version: 1,
            app: app.clone(),
            workspace: workspace.clone(),
            nonce: nonce.into(),
            marker: marker.into(),
            directories,
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
            .and_then(|f| f.sync_all())
            .map_err(|_| invalid())?;
    }
    let bytes = private_file(&app.join(SCOPE))?;
    let scope: Scope = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if scope.version != 1
        || scope.app != app
        || scope.workspace != workspace
        || scope.nonce != nonce
        || scope.marker != marker
    {
        return Err(invalid());
    }
    let guard = VerificationRoot { scope, bytes };
    guard.validate()?;
    Ok(LocalState::new(app.join("application")).with_verification_guard(Arc::new(guard)))
}

#[cfg(test)]
mod tests {
    use super::*;
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
