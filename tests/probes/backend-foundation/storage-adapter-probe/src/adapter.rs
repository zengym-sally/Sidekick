//! Reference model of the standalone Rust storage adapter contract from
//! docs/engineering/web-backend-design.md §2/§5, used only by this probe
//! harness. It mirrors the file-safety patterns already proven in
//! src-tauri/src/store (marker lock, no-CREATE open, identity capture) so the
//! boundary assumptions can be verified against synthetic roots without
//! touching the Tauri business implementation.

use rusqlite::{Connection, OpenFlags};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

pub const ROOT_MARKER: &str = ".sidekick-workspace";
pub const MAGIC: &[u8] = b"sidekick-workspace-v1\n";
pub const APPLICATION_ID: i64 = 0x53444b31;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Code {
    InvalidRoot,
    UnknownRoot,
    RootInUse,
    MissingDatabase,
    CorruptDatabase,
    UnknownDatabase,
    SchemaTooNew,
    PathChanged,
    StorageStopped,
    Io,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::InvalidRoot => "INVALID_ROOT",
            Code::UnknownRoot => "UNKNOWN_ROOT",
            Code::RootInUse => "ROOT_IN_USE",
            Code::MissingDatabase => "MISSING_DATABASE",
            Code::CorruptDatabase => "CORRUPT_DATABASE",
            Code::UnknownDatabase => "UNKNOWN_DATABASE",
            Code::SchemaTooNew => "SCHEMA_TOO_NEW",
            Code::PathChanged => "PATH_CHANGED",
            Code::StorageStopped => "STORAGE_STOPPED",
            Code::Io => "IO",
        }
    }
}

#[derive(Debug)]
pub struct Error {
    pub code: Code,
    pub message: String,
}

impl Error {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn io_error(error: std::io::Error) -> Error {
    Error::new(Code::Io, error.to_string())
}

fn invalid_root() -> Error {
    Error::new(
        Code::InvalidRoot,
        "工作目录标记必须是普通文件、单一硬链且权限 0600，不能是符号链接。",
    )
}

fn path_changed() -> Error {
    Error::new(
        Code::PathChanged,
        "数据库或所属目录的身份／私有性已变化，未修复或替换文件。",
    )
}

/// Fault points injected by the CLI to model mid-life failures. They exist only
/// for this probe and mirror the fault-injection style of the existing store
/// tests; production adapters have no such switches.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fault {
    None,
    /// Replace the database file with a different one after identity capture.
    SwapDatabase,
    /// Replace the root marker with a different file after a successful open.
    ReplaceMarker,
}

pub struct StorageAdapter {
    root: PathBuf,
    /// Root lock; dropped exactly when the adapter drops, so the lock lifetime
    /// equals the connection lifetime.
    lock: File,
    root_handle: File,
    data_handle: File,
    database_handle: File,
    /// WAL/SHM side files appear when WAL mode is enabled; newly appeared
    /// private side files are adopted, held ones must keep their identity.
    side_files: std::cell::RefCell<BTreeMap<&'static str, File>>,
    db: Connection,
    /// Once any verification fails the adapter stops all reads and writes.
    stopped: Cell<bool>,
}

fn same_directory(path: &Path, held: &File, private: bool) -> Result<()> {
    let current = fs::symlink_metadata(path).map_err(|_| path_changed())?;
    let before = held.metadata().map_err(|_| path_changed())?;
    if !current.is_dir()
        || current.file_type().is_symlink()
        || (private && current.mode() & 0o7777 != 0o700)
        || current.dev() != before.dev()
        || current.ino() != before.ino()
    {
        return Err(path_changed());
    }
    Ok(())
}

fn same_private_file(path: &Path, held: &File) -> Result<()> {
    let current = fs::symlink_metadata(path).map_err(|_| path_changed())?;
    let before = held.metadata().map_err(|_| path_changed())?;
    if !current.is_file()
        || current.file_type().is_symlink()
        || current.nlink() != 1
        || current.mode() & 0o7777 != 0o600
        || current.dev() != before.dev()
        || current.ino() != before.ino()
    {
        return Err(path_changed());
    }
    Ok(())
}

fn open_private(path: &Path) -> Result<File> {
    let metadata = fs::symlink_metadata(path).map_err(|_| path_changed())?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.nlink() != 1
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err(path_changed());
    }
    let held = File::open(path).map_err(|_| path_changed())?;
    same_private_file(path, &held)?;
    let opened = held.metadata().map_err(|_| path_changed())?;
    if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
        return Err(path_changed());
    }
    Ok(held)
}

fn private_dir(path: &Path) -> Result<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path).map_err(io_error)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || metadata.mode() & 0o7777 != 0o700 {
            return Err(path_changed());
        }
    } else {
        fs::DirBuilder::new().recursive(true).mode(0o700).create(path).map_err(io_error)?;
    }
    Ok(())
}

/// Acquire the root lock on the marker file. The lock is an advisory whole-file
/// lock: a second open of the same root — even from the same process through a
/// different descriptor — fails with ROOT_IN_USE, and the kernel releases it
/// automatically when the holding process dies.
pub fn acquire_root_lock(root: &Path) -> Result<File> {
    let marker = root.join(ROOT_MARKER);
    let metadata = match fs::symlink_metadata(&marker) {
        Ok(metadata) if metadata.is_file() && metadata.nlink() == 1 => Some(metadata),
        Ok(_) => return Err(invalid_root()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(io_error(error)),
    };
    let mut options = OpenOptions::new();
    options.read(true).write(true).mode(0o600);
    if metadata.is_none() {
        options.create_new(true);
    }
    let file = options.open(&marker).map_err(io_error)?;
    let opened = file.metadata().map_err(io_error)?;
    let current = fs::symlink_metadata(&marker).map_err(io_error)?;
    if !current.is_file()
        || current.nlink() != 1
        || opened.nlink() != 1
        || current.mode() & 0o7777 != 0o600
        || opened.dev() != current.dev()
        || opened.ino() != current.ino()
        || metadata.is_some_and(|before| before.dev() != opened.dev() || before.ino() != opened.ino())
    {
        return Err(invalid_root());
    }
    file.try_lock().map_err(|_| Error {
        code: Code::RootInUse,
        message: "已有实例正在使用此工作目录，未取得根锁。".into(),
    })?;
    Ok(file)
}

impl StorageAdapter {
    /// Open an existing synthetic root. `allow_init` distinguishes the explicit
    /// creation flow (new root) from ordinary open (existing root); the latter
    /// must never silently create a database.
    pub fn open(root: &Path, allow_init: bool, fault: Fault) -> Result<Self> {
        if !root.is_absolute() {
            return Err(Error::new(Code::InvalidRoot, "工作目录必须是绝对路径。"));
        }
        if !root.exists() {
            return Err(Error::new(Code::InvalidRoot, "工作目录不存在。"));
        }
        let root = fs::canonicalize(root).map_err(io_error)?;
        if !root.is_dir() {
            return Err(Error::new(Code::InvalidRoot, "工作目录不是目录。"));
        }
        let entries: Vec<_> = fs::read_dir(&root)
            .map_err(io_error)?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<std::io::Result<_>>()
            .map_err(io_error)?;
        let marker = root.join(ROOT_MARKER);
        let only_marker = entries
            .iter()
            .all(|name| name == ROOT_MARKER || name == ".DS_Store");
        if !marker.exists() && !only_marker {
            return Err(Error::new(
                Code::UnknownRoot,
                "这个目录已有其他内容，未识别为跟班工作目录。",
            ));
        }
        let mut lock = acquire_root_lock(&root)?;
        let mut content = Vec::new();
        lock.read_to_end(&mut content).map_err(io_error)?;
        if content != MAGIC {
            if !only_marker || !MAGIC.starts_with(&content) {
                return Err(Error::new(
                    Code::UnknownRoot,
                    "无法识别此工作目录，未合并或覆盖其中内容。",
                ));
            }
            if !allow_init {
                return Err(Error::new(Code::UnknownRoot, "归属标记未写完，未继续初始化。"));
            }
            lock.seek(SeekFrom::Start(0)).map_err(io_error)?;
            lock.set_len(0).map_err(io_error)?;
            lock.write_all(MAGIC).map_err(io_error)?;
            lock.sync_all().map_err(io_error)?;
        }
        let root_handle = File::open(&root).map_err(io_error)?;
        same_directory(&root, &root_handle, true)?;
        private_dir(&root.join("data"))?;
        let data_handle = File::open(root.join("data")).map_err(io_error)?;
        same_directory(&root.join("data"), &data_handle, true)?;
        for name in ["runs", "config", "skills", "mcp", "logs", "backups"] {
            private_dir(&root.join(name))?;
        }
        let path = root.join("data/sidekick.sqlite");
        if fs::symlink_metadata(&path).is_err() {
            if !allow_init {
                return Err(Error::new(
                    Code::MissingDatabase,
                    "工作目录的数据库缺失，未创建空库替代原数据。",
                ));
            }
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .map_err(io_error)?;
        }
        let database_handle = open_private(&path)?;
        let mut side_files = BTreeMap::new();
        for name in ["sidekick.sqlite-wal", "sidekick.sqlite-shm"] {
            let side = root.join("data").join(name);
            if fs::symlink_metadata(&side).is_ok() {
                let held = open_private(&side)?;
                side_files.insert(name, held);
            }
        }
        if fault == Fault::SwapDatabase {
            // A hostile or racing swap after identity capture: the held handle
            // must no longer match the path.
            let replacement = root.join("data/replacement.sqlite");
            fs::rename(&path, root.join("data/original.sqlite")).map_err(io_error)?;
            fs::copy(&root.join("data/original.sqlite"), &replacement).map_err(io_error)?;
            fs::rename(&replacement, &path).map_err(io_error)?;
        }
        let mut adapter = Self {
            root: root.clone(),
            lock,
            root_handle,
            data_handle,
            database_handle,
            side_files: std::cell::RefCell::new(side_files),
            // The connection is opened only after every file-safety check.
            db: Connection::open_in_memory().map_err(|_| Error::new(Code::Io, "占位连接失败"))?,
            stopped: Cell::new(false),
        };
        adapter.verify(true)?;
        Self::validate_existing_database(&path, allow_init)?;
        let db = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|_| Error::new(Code::Io, "数据库打开失败"))?;
        adapter.db = db;
        adapter.configure()?;
        adapter.verify(true)?;
        if fault == Fault::ReplaceMarker {
            fs::rename(&marker, root.join("data/marker-replaced")).map_err(io_error)?;
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&marker)
                .map_err(io_error)?;
        }
        Ok(adapter)
    }

    fn configure(&self) -> Result<()> {
        self.db
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| Error::new(Code::Io, "busy_timeout 设置失败"))?;
        self.db
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
            .map_err(|_| Error::new(Code::Io, "WAL/同步模式设置失败"))?;
        Ok(())
    }

    pub fn validate_existing_database(path: &Path, initializing: bool) -> Result<()> {        // No CREATE flag: a missing database is an error, never a new file.
        let db = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|_| {
            Error::new(
                Code::CorruptDatabase,
                "数据库无法打开，原文件未重置。",
            )
        })?;
        let version: i64 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| Error::new(Code::CorruptDatabase, "user_version 读取失败"))?;
        if version > 5 {
            return Err(Error::new(
                Code::SchemaTooNew,
                "数据由较新的跟班版本创建，请升级应用后打开。",
            ));
        }
        let app: i64 = db
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .map_err(|_| Error::new(Code::CorruptDatabase, "application_id 读取失败"))?;
        let tables: i64 = db
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| Error::new(Code::CorruptDatabase, "表清单读取失败"))?;
        if !(app == APPLICATION_ID && (1..=5).contains(&version)
            || initializing && app == 0 && version == 0 && tables == 0)
        {
            return Err(Error::new(
                Code::UnknownDatabase,
                "数据库不属于此版本的跟班，未写入或覆盖。",
            ));
        }
        let check: String = db
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|_| Error::new(Code::CorruptDatabase, "完整性检查失败"))?;
        if check != "ok" {
            return Err(Error::new(Code::CorruptDatabase, "数据库完整性检查失败，原文件未重置。"));
        }
        Ok(())
    }

    /// Re-verify every held identity. Any mismatch stops all further reads and
    /// writes: the adapter never repairs or replaces files it does not own.
    pub fn verify(&self, private_root: bool) -> Result<()> {
        let failed = (|| -> Result<()> {
            if fs::canonicalize(&self.root).map_err(|_| path_changed())? != self.root {
                return Err(path_changed());
            }
            same_directory(&self.root, &self.root_handle, private_root)?;
            same_directory(&self.root.join("data"), &self.data_handle, true)?;
            let marker = self.root.join(ROOT_MARKER);
            let held = self.lock.metadata().map_err(|_| path_changed())?;
            let current = fs::symlink_metadata(&marker).map_err(|_| path_changed())?;
            if !current.is_file()
                || current.file_type().is_symlink()
                || current.nlink() != 1
                || current.dev() != held.dev()
                || current.ino() != held.ino()
            {
                return Err(path_changed());
            }
            let database = self.root.join("data/sidekick.sqlite");
            same_private_file(&database, &self.database_handle)?;
            for name in ["sidekick.sqlite-wal", "sidekick.sqlite-shm"] {
                let path = self.root.join("data").join(name);
                let mut side_files = self.side_files.borrow_mut();
                if let Some(held) = side_files.get(name) {
                    same_private_file(&path, held)?;
                } else {
                    match fs::symlink_metadata(&path) {
                        Ok(_) => {
                            let held = open_private(&path)?;
                            side_files.insert(name, held);
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(_) => return Err(path_changed()),
                    }
                }
            }
            Ok(())
        })();
        if failed.is_err() {
            self.stopped.set(true);
        }
        failed
    }

    fn ensure_live(&self) -> Result<()> {
        if self.stopped.get() {
            return Err(Error::new(
                Code::StorageStopped,
                "存储已因身份或锁校验失败停止读写，请关闭后重新打开核对。",
            ));
        }
        Ok(())
    }

    /// Begin a short write transaction after re-verifying identities. The
    /// caller commits or rolls back; dropping rolls back.
    pub fn begin_write(&self) -> Result<rusqlite::Transaction<'_>> {
        self.ensure_live()?;
        self.verify(true)?;
        self.db
            .unchecked_transaction()
            .map_err(|_| Error::new(Code::Io, "事务创建失败"))
    }

    pub fn short_write(&self, sql: &str) -> Result<()> {
        self.ensure_live()?;
        self.verify(true)?;
        let transaction = self
            .db
            .unchecked_transaction()
            .map_err(|_| Error::new(Code::Io, "事务创建失败"))?;
        if let Err(error) = transaction.execute_batch(sql) {
            let _ = transaction.rollback();
            return Err(Error::new(Code::Io, error.to_string()));
        }
        transaction
            .commit()
            .map_err(|_| Error::new(Code::Io, "事务提交失败"))?;
        self.verify(true)?;
        Ok(())
    }

    pub fn count(&self, table: &str) -> Result<i64> {
        self.ensure_live()?;
        self.verify(true)?;
        self.db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row.get(0))
            .map_err(|_| Error::new(Code::Io, "计数失败"))
    }

    pub fn row_ids(&self, table: &str) -> Result<Vec<String>> {
        self.ensure_live()?;
        self.verify(true)?;
        let mut statement = self
            .db
            .prepare(&format!("SELECT id FROM {table} ORDER BY id"))
            .map_err(|_| Error::new(Code::Io, "查询准备失败"))?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| Error::new(Code::Io, "查询失败"))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| Error::new(Code::Io, "行收集失败"))?;
        Ok(ids)
    }

    pub fn pragma(&self, name: &str) -> Result<String> {
        self.ensure_live()?;
        self.db
            .pragma_query_value(None, name, |row| row.get::<_, String>(0))
            .map_err(|_| Error::new(Code::Io, format!("{name} 读取失败")))
    }

    pub fn pragma_int(&self, name: &str) -> Result<i64> {
        self.ensure_live()?;
        self.db
            .pragma_query_value(None, name, |row| row.get::<_, i64>(0))
            .map_err(|_| Error::new(Code::Io, format!("{name} 读取失败")))
    }

    pub fn sqlite_version(&self) -> Result<String> {
        self.ensure_live()?;
        self.db
            .query_row("SELECT sqlite_version()", [], |row| row.get::<_, String>(0))
            .map_err(|_| Error::new(Code::Io, "sqlite_version 读取失败"))
    }

    pub fn wal_present(&self) -> bool {
        self.root.join("data/sidekick.sqlite-wal").exists()
    }
}

/// Control case that documents why the adapter must not use default open flags:
/// `Connection::open` creates a missing database instead of failing.
pub fn default_open_creates(path: &Path) -> Result<bool> {
    let existed = path.exists();
    let connection = Connection::open(path).map_err(|_| Error::new(Code::Io, "默认打开失败"))?;
    drop(connection);
    Ok(!existed && path.exists())
}
