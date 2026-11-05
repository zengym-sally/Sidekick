use crate::{
    local_store::{AppStore, StoreError},
    store_commands::LocalState,
};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::PathBuf,
    sync::Arc,
};

fn invalid() -> StoreError {
    StoreError {
        code: "PET_VERIFY_ROOT",
        message: "隔离验收根标记或文件身份不符，操作已停止。",
    }
}
fn private(metadata: &fs::Metadata) -> bool {
    extern "C" {
        fn geteuid() -> u32;
    }
    !metadata.file_type().is_symlink()
        && metadata.uid() == unsafe { geteuid() }
        && if metadata.is_dir() {
            metadata.mode() & 0o7777 == 0o700
        } else {
            metadata.is_file() && metadata.mode() & 0o7777 == 0o600 && metadata.nlink() == 1
        }
}
struct Pin {
    path: PathBuf,
    file: File,
    device: u64,
    inode: u64,
    directory: bool,
}
impl Pin {
    fn new(path: PathBuf) -> Result<Self, StoreError> {
        let metadata = fs::symlink_metadata(&path).map_err(|_| invalid())?;
        if !private(&metadata) {
            return Err(invalid());
        }
        let file = File::open(&path).map_err(|_| invalid())?;
        let opened = file.metadata().map_err(|_| invalid())?;
        if !private(&opened) || metadata.dev() != opened.dev() || metadata.ino() != opened.ino() {
            return Err(invalid());
        }
        Ok(Self {
            path,
            file,
            device: metadata.dev(),
            inode: metadata.ino(),
            directory: metadata.is_dir(),
        })
    }
    fn validate(&self) -> Result<(), StoreError> {
        let current = fs::symlink_metadata(&self.path).map_err(|_| invalid())?;
        let opened = self.file.metadata().map_err(|_| invalid())?;
        if !private(&current)
            || !private(&opened)
            || current.dev() != self.device
            || current.ino() != self.inode
            || current.is_dir() != self.directory
            || opened.dev() != self.device
            || opened.ino() != self.inode
        {
            return Err(invalid());
        }
        Ok(())
    }
}
pub(crate) struct PetUiRoot {
    pub directory: PathBuf,
    app: PathBuf,
    nonce: Vec<u8>,
    bootstrap: Vec<u8>,
    pins: Vec<Pin>,
}
impl PetUiRoot {
    pub fn create() -> Result<(Arc<Self>, LocalState), StoreError> {
        let mut random = [0u8; 16];
        File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(&mut random))
            .map_err(|_| invalid())?;
        let nonce = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
            .into_bytes();
        let name = String::from_utf8(nonce.clone()).map_err(|_| invalid())?;
        let directory = std::env::temp_dir().join(format!("sidekick-pet-ui-{name}"));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .map_err(|_| invalid())?;
        let directory = fs::canonicalize(directory).map_err(|_| invalid())?;
        let app = directory.join("application");
        let workspace = directory.join("workspace");
        for path in [&app, &workspace] {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(path)
                .map_err(|_| invalid())?;
        }
        let mut marker = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(directory.join("pet-ui.nonce"))
            .map_err(|_| invalid())?;
        marker
            .write_all(&nonce)
            .and_then(|_| marker.sync_all())
            .map_err(|_| invalid())?;
        if app
            .join("bootstrap.json")
            .try_exists()
            .map_err(|_| invalid())?
        {
            return Err(invalid());
        }
        let store = AppStore::open_pet_fixture(app.clone(), workspace.clone())?;
        let bootstrap = fs::read(app.join("bootstrap.json")).map_err(|_| invalid())?;
        let pins = [
            directory.clone(),
            app.clone(),
            workspace.clone(),
            workspace.join("data"),
            workspace.join("config"),
            workspace.join("data/sidekick.sqlite"),
            directory.join("pet-ui.nonce"),
            app.join("bootstrap.json"),
        ]
        .into_iter()
        .map(Pin::new)
        .collect::<Result<Vec<_>, _>>()?;
        let root = Arc::new(Self {
            directory,
            app: app.clone(),
            nonce,
            bootstrap,
            pins,
        });
        root.validate()?;
        let state = LocalState::pet_fixture(app, store, root.clone());
        Ok((root, state))
    }
    pub fn validate(&self) -> Result<(), StoreError> {
        for pin in &self.pins {
            pin.validate()?;
        }
        let nonce = fs::read(self.directory.join("pet-ui.nonce")).map_err(|_| invalid())?;
        let bootstrap = fs::read(self.app.join("bootstrap.json")).map_err(|_| invalid())?;
        if nonce != self.nonce || bootstrap != self.bootstrap {
            return Err(invalid());
        }
        Ok(())
    }
    #[cfg(test)]
    pub fn application(&self) -> &std::path::Path {
        &self.app
    }
}
