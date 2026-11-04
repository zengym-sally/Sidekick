use rusqlite::{params, Connection, OpenFlags, Row, Transaction};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const ROOT_MARKER: &str = ".sidekick-workspace";
const MAGIC: &[u8] = b"sidekick-workspace-v1\n";
const APPLICATION_ID: i64 = 0x53444b31;
const SELECT_TODO_V1: &str = "SELECT id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,followup_at_ms,followup_timezone,followup_local,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,source FROM todos";
const SELECT_TODO: &str = "SELECT id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,followup_at_ms,followup_timezone,followup_local,tags_json,created_at_ms,updated_at_ms,completed_at_ms,deleted_at_ms,version,capture_method,due_precision,followup_precision FROM todos";

#[derive(Debug, Clone, Serialize)]
pub struct StoreError {
    pub code: &'static str,
    pub message: &'static str,
}
impl StoreError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}
type Result<T> = std::result::Result<T, StoreError>;
fn io_error(_: std::io::Error) -> StoreError {
    StoreError::new(
        "WORKSPACE_IO",
        "无法读写工作目录，请检查访问权限和剩余空间。",
    )
}
fn db_error(error: rusqlite::Error) -> StoreError {
    match error {
        rusqlite::Error::QueryReturnedNoRows => {
            StoreError::new("NOT_FOUND", "这条事项已不存在，请刷新清单。")
        }
        rusqlite::Error::SqliteFailure(e, _)
            if matches!(
                e.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            ) =>
        {
            StoreError::new("DATABASE_BUSY", "数据库正被占用，请稍后重试。")
        }
        _ => StoreError::new(
            "DATABASE_ERROR",
            "本地数据操作失败，未确认的更改没有保存。请重试。",
        ),
    }
}
fn invalid() -> StoreError {
    StoreError::new(
        "INVALID_INPUT",
        "请检查标题、负责人、事项类型和时间；标题最多200字，标签最多12个。",
    )
}
fn nonce() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
fn now_ms() -> Result<i64> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| StoreError::new("CLOCK_ERROR", "设备时间异常，请校准后重试。"))?
            .as_millis(),
    )
    .map_err(|_| invalid())
}

fn minute_precision() -> String {
    "minute".into()
}
fn is_minute(precision: &str) -> bool {
    precision == "minute"
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimePoint {
    pub at_ms: i64,
    pub time_zone: String,
    pub local_text: String,
    #[serde(default = "minute_precision", skip_serializing_if = "is_minute")]
    pub precision: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoInput {
    pub title: String,
    pub kind: String,
    pub owner: String,
    pub priority: String,
    pub due: Option<TimePoint>,
    pub followup: Option<TimePoint>,
    pub tags: Vec<String>,
}
impl TodoInput {
    fn normalized(mut self) -> Result<Self> {
        self.title = self.title.trim().into();
        self.owner = self.owner.trim().into();
        if self.title.is_empty()
            || self.title.chars().count() > 200
            || self.title.chars().any(char::is_control)
            || self.owner.is_empty()
            || self.owner.chars().count() > 100
            || self.owner.chars().any(char::is_control)
            || !["action", "followup"].contains(&self.kind.as_str())
            || !["low", "medium", "high"].contains(&self.priority.as_str())
            || (self.kind == "action" && self.followup.is_some())
        {
            return Err(invalid());
        }
        for point in [&self.due, &self.followup].into_iter().flatten() {
            if !["minute", "day"].contains(&point.precision.as_str())
                || point.at_ms.unsigned_abs() > 8_640_000_000_000_000
                || point.time_zone.is_empty()
                || point.time_zone.len() > 128
                || point.time_zone.chars().any(char::is_control)
                || point.local_text.is_empty()
                || point.local_text.len() > 512
                || point.local_text.contains('\0')
            {
                return Err(invalid());
            }
        }
        let mut tags = Vec::new();
        for tag in self.tags {
            let tag = tag.trim().to_string();
            if tag.is_empty() {
                continue;
            }
            if tag.chars().count() > 32 || tag.chars().any(char::is_control) {
                return Err(invalid());
            }
            if !tags.contains(&tag) {
                tags.push(tag)
            }
        }
        if tags.len() > 12 {
            return Err(invalid());
        }
        self.tags = tags;
        Ok(self)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    #[serde(rename = "data")]
    pub fields: TodoInput,
    pub status: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub deleted_at_ms: Option<i64>,
    pub version: i64,
    pub source: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoEvent {
    pub operation_id: String,
    pub action: String,
    pub occurred_at_ms: i64,
    pub before: Option<Todo>,
    pub after: Todo,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub needs_setup: bool,
    pub root: Option<String>,
    pub default_root: String,
    pub pending_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserProfile {
    pub version: u32,
    #[serde(default)]
    pub name: String,
    pub address: String,
}
impl Default for UserProfile {
    fn default() -> Self {
        Self {
            version: 1,
            name: "小明同学".into(),
            address: "BOSS".into(),
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileInput {
    pub name: String,
    pub address: String,
}
impl ProfileInput {
    fn normalized(self) -> Result<UserProfile> {
        let name = self.name.trim().to_string();
        let address = self.address.trim().to_string();
        if name.chars().count() > 60
            || address.chars().count() > 60
            || name.chars().any(char::is_control)
            || address.chars().any(char::is_control)
        {
            return Err(StoreError::new(
                "INVALID_PROFILE",
                "昵称和称呼最多60字，请勿包含换行或控制字符。",
            ));
        }
        Ok(UserProfile {
            version: 1,
            name: if name.is_empty() {
                "小明同学".into()
            } else {
                name
            },
            address: if address.is_empty() {
                "BOSS".into()
            } else {
                address
            },
        })
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSave {
    pub profile: UserProfile,
    pub warning: Option<&'static str>,
}
#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
enum ModelWriteFault {
    BeforeJournal,
    AfterJournal,
    AfterProviders,
    AfterModels,
    Uncertain,
}
#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
enum ProfileWriteFault {
    BeforeReplace,
    AfterReplace,
    AfterReplaceAndReadFailure,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pointer {
    app: String,
    version: u32,
    root: String,
    time_zone: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RootConfig {
    app: String,
    version: u32,
    state: String,
    time_zone: String,
}

#[derive(Clone, Copy, PartialEq)]
enum InitPhase {
    Marker,
    Directories,
    BeforeSchema,
    Schema,
    Ready,
    BeforeBootstrap,
}
struct Workspace {
    root: PathBuf,
    db: Connection,
    _lock: File,
    root_directory: File,
    mcp_directory: File,
    runs_directory: File,
    backups_directory: File,
    database_identity: mcp_schema::DatabaseIdentity,
}
#[cfg(feature = "s33-mcp-ui-verification")]
#[derive(Clone, Copy)]
enum VerificationOpen {
    Mcp,
    G1,
}

pub struct AppStore {
    app_dir: PathBuf,
    workspace: Option<Workspace>,
    _instance: File,
    #[cfg(feature = "s33-mcp-ui-verification")]
    verification_model: Option<ModelConfiguration>,
    #[cfg(feature = "s33-mcp-ui-verification")]
    verification_validate: Option<std::sync::Arc<dyn Fn() -> Result<()> + Send + Sync>>,
    #[cfg(feature = "s33-mcp-ui-verification")]
    verification_open: VerificationOpen,
    #[cfg(test)]
    init_fault: Option<InitPhase>,
    #[cfg(test)]
    profile_write_fault: Option<ProfileWriteFault>,
    #[cfg(test)]
    settings_write_fault: Option<SettingsWriteFault>,
    #[cfg(test)]
    model_write_fault: Option<ModelWriteFault>,
    #[cfg(test)]
    agent_write_fault: Option<agent_config::AgentWriteFault>,
    agent_uncertain: std::collections::BTreeSet<String>,
    #[cfg(test)]
    mcp_write_fault: Option<McpWriteFault>,
    #[cfg(test)]
    mcp_call_fault: Option<mcp_calls::McpCallFault>,
    #[cfg(test)]
    mcp_security_fault: Option<mcp_security::McpSecurityFault>,
    mcp_schema_uncertain: bool,
    today_schema_uncertain: std::cell::Cell<bool>,
    #[cfg(test)]
    today_migration_fault: today_schema::TodayMigrationFault,
    mcp_probe_uncertain: bool,
    mcp_probe_directories: std::collections::BTreeMap<String, File>,
    #[cfg(test)]
    mcp_catalog_fault: Option<mcp_catalog::CatalogFault>,
    #[cfg(test)]
    mcp_migration_fault: Option<mcp_schema::McpMigrationFault>,
}

fn private_dir(path: &Path) -> Result<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path).map_err(io_error)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(StoreError::new(
                "INVALID_ROOT",
                "工作目录中的数据路径必须是普通目录。",
            ));
        }
    } else {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .map_err(io_error)?;
    }
    Ok(())
}
fn lock_file(path: &Path, code: &'static str) -> Result<File> {
    let invalid_marker = || {
        StoreError::new(
            "INVALID_ROOT",
            "工作目录标记必须是普通文件，不能是符号链接。",
        )
    };
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.nlink() == 1 => Some(metadata),
        Ok(_) => return Err(invalid_marker()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(io_error(error)),
    };
    let mut options = OpenOptions::new();
    options.read(true).write(true).mode(0o600);
    if metadata.is_none() {
        options.create_new(true);
    }
    let file = options.open(path).map_err(io_error)?;
    let opened = file.metadata().map_err(io_error)?;
    let current = fs::symlink_metadata(path).map_err(io_error)?;
    if !current.is_file()
        || current.nlink() != 1
        || opened.nlink() != 1
        || opened.dev() != current.dev()
        || opened.ino() != current.ino()
        || metadata
            .is_some_and(|before| before.dev() != opened.dev() || before.ino() != opened.ino())
    {
        return Err(invalid_marker());
    }
    file.try_lock().map_err(|_| {
        StoreError::new(
            code,
            "已有跟班实例正在使用此应用或工作目录，请先退出另一个实例。",
        )
    })?;
    Ok(file)
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path, code: &'static str) -> Result<T> {
    let bytes = fs::read(path).map_err(io_error)?;
    serde_json::from_slice(&bytes).map_err(|_| {
        StoreError::new(
            code,
            "本地配置无法识别，原数据未重置。请检查工作目录或联系维护者。",
        )
    })
}
fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| invalid())?;
    let temporary = path.with_extension(format!("{}-{}.pending", std::process::id(), nonce()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(io_error)?;
    file.write_all(&bytes).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    drop(file);
    fs::rename(&temporary, path).map_err(io_error)?;
    if let Some(parent) = path.parent() {
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(io_error)?;
    }
    Ok(())
}
fn prepare_root(path: &Path) -> Result<(PathBuf, File, bool)> {
    if !path.is_absolute() {
        return Err(StoreError::new(
            "INVALID_ROOT",
            "请选择绝对路径的工作目录。",
        ));
    }
    if !path.exists() {
        private_dir(path)?;
    }
    let root = fs::canonicalize(path).map_err(io_error)?;
    if !root.is_dir() {
        return Err(invalid());
    }
    let entries: Vec<_> = fs::read_dir(&root)
        .map_err(io_error)?
        .map(|e| e.map(|e| e.file_name()))
        .collect::<std::io::Result<_>>()
        .map_err(io_error)?;
    let marker = root.join(ROOT_MARKER);
    let only_marker = entries.iter().all(|n| n == ROOT_MARKER || n == ".DS_Store");
    if !marker.exists() && !only_marker {
        return Err(StoreError::new(
            "UNKNOWN_ROOT",
            "这个目录已有其他内容。请选择空目录或已由跟班建立的工作目录。",
        ));
    }
    let mut lock = lock_file(&marker, "ROOT_IN_USE")?;
    let mut content = Vec::new();
    lock.read_to_end(&mut content).map_err(io_error)?;
    if content != MAGIC {
        if !only_marker || !MAGIC.starts_with(&content) {
            return Err(StoreError::new(
                "UNKNOWN_ROOT",
                "无法识别此工作目录，未合并或覆盖其中内容。",
            ));
        }
        lock.seek(SeekFrom::Start(0)).map_err(io_error)?;
        lock.set_len(0).map_err(io_error)?;
        lock.write_all(MAGIC).map_err(io_error)?;
        lock.sync_all().map_err(io_error)?;
    }
    Ok((root, lock, only_marker))
}
fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/001_todos.sql")),
        M::up(include_str!("../../migrations/002_ingestion.sql")),
        M::up(include_str!("../../migrations/003_agent_runs.sql")),
    ])
}
fn validate_existing_database(path: &Path, initializing: bool) -> Result<()> {
    if !path.exists() {
        return if initializing {
            Ok(())
        } else {
            Err(StoreError::new(
                "MISSING_DATABASE",
                "工作目录的数据库缺失，未创建空库替代原数据。",
            ))
        };
    }
    mcp_schema::validate_source_files(path)?;
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| StoreError::new("CORRUPT_DATABASE", "数据库无法打开，原文件未重置。"))?;
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(db_error)?;
    if version > 5 {
        return Err(StoreError::new(
            "SCHEMA_TOO_NEW",
            "数据由较新的跟班版本创建，请升级应用后打开。",
        ));
    }
    let app: i64 = db
        .pragma_query_value(None, "application_id", |r| r.get(0))
        .map_err(db_error)?;
    let tables: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'",
            [],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    if !(app == APPLICATION_ID && (1..=5).contains(&version)
        || initializing && app == 0 && version == 0 && tables == 0)
    {
        return Err(StoreError::new(
            "UNKNOWN_DATABASE",
            "数据库不属于此版本的跟班，未写入或覆盖。",
        ));
    }
    let check: String = db
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(db_error)?;
    if check != "ok" {
        return Err(StoreError::new(
            "CORRUPT_DATABASE",
            "数据库完整性检查失败，原文件未重置。",
        ));
    }
    if version >= 1 {
        db.prepare(if version == 1 {
            SELECT_TODO_V1
        } else {
            SELECT_TODO
        })
        .map_err(db_error)?;
        db.prepare(
            "SELECT operation_id,todo_id,request_json,before_json,after_json FROM todo_events",
        )
        .map_err(db_error)?;
    }
    if version == 4 {
        mcp_schema::validate_v4(&db)?;
    } else if version == 5 {
        today_schema::validate_v5(&db)?;
    }
    Ok(())
}

#[cfg(all(test, feature = "s33-mcp-ui-verification"))]
type VerificationCheckpoint = Option<Box<dyn FnMut(&str)>>;
#[cfg(all(test, feature = "s33-mcp-ui-verification"))]
thread_local! { static VERIFICATION_CHECKPOINT: std::cell::RefCell<VerificationCheckpoint> = std::cell::RefCell::new(None); }
#[cfg(all(test, feature = "s33-mcp-ui-verification"))]
pub(crate) fn verification_checkpoint_hook(hook: VerificationCheckpoint) {
    VERIFICATION_CHECKPOINT.with(|slot| *slot.borrow_mut() = hook);
}
#[cfg(all(test, feature = "s33-mcp-ui-verification"))]
fn verification_checkpoint(name: &str) {
    VERIFICATION_CHECKPOINT.with(|slot| {
        if let Some(hook) = slot.borrow_mut().as_mut() {
            hook(name);
        }
    });
}
impl AppStore {
    fn open_empty(app_dir: PathBuf) -> Result<Self> {
        private_dir(&app_dir)?;
        let app_dir = fs::canonicalize(app_dir).map_err(io_error)?;
        let instance = lock_file(&app_dir.join(".sidekick-app.lock"), "APP_IN_USE")?;
        let store = Self {
            app_dir,
            _instance: instance,
            #[cfg(feature = "s33-mcp-ui-verification")]
            verification_model: None,
            #[cfg(feature = "s33-mcp-ui-verification")]
            verification_validate: None,
            #[cfg(feature = "s33-mcp-ui-verification")]
            verification_open: VerificationOpen::Mcp,
            workspace: None,
            #[cfg(test)]
            init_fault: None,
            #[cfg(test)]
            profile_write_fault: None,
            #[cfg(test)]
            settings_write_fault: None,
            #[cfg(test)]
            model_write_fault: None,
            #[cfg(test)]
            agent_write_fault: None,
            agent_uncertain: Default::default(),
            #[cfg(test)]
            mcp_write_fault: None,
            #[cfg(test)]
            mcp_call_fault: None,
            #[cfg(test)]
            mcp_security_fault: None,
            mcp_schema_uncertain: false,
            today_schema_uncertain: std::cell::Cell::new(false),
            #[cfg(test)]
            today_migration_fault: TODAY_OPEN_FAULT.with(std::cell::Cell::get),
            mcp_probe_uncertain: false,
            mcp_probe_directories: std::collections::BTreeMap::new(),
            #[cfg(test)]
            mcp_catalog_fault: None,
            #[cfg(test)]
            mcp_migration_fault: None,
        };
        Ok(store)
    }
    pub fn open(app_dir: PathBuf) -> Result<Self> {
        let mut store = Self::open_empty(app_dir)?;
        let bootstrap = store.app_dir.join("bootstrap.json");
        if bootstrap.exists() {
            let pointer: Pointer = read_json(&bootstrap, "CORRUPT_BOOTSTRAP")?;
            store.validate_pointer(&pointer)?;
            let selected = Path::new(&pointer.root);
            if !selected.is_dir()
                || fs::read(selected.join(ROOT_MARKER))
                    .map(|b| b != MAGIC)
                    .unwrap_or(true)
            {
                return Err(StoreError::new(
                    "MISSING_ROOT",
                    "原工作目录不存在或标记缺失，未新建目录替代。请恢复原目录后重试。",
                ));
            }
            let (root, lock, _) = prepare_root(Path::new(&pointer.root))?;
            let config: RootConfig = read_json(&root.join("config/app.json"), "CORRUPT_CONFIG")?;
            if config.state != "ready" {
                return Err(StoreError::new(
                    "INCOMPLETE_ROOT",
                    "工作目录尚未完成初始化，原数据未重置。",
                ));
            }
            store.workspace =
                Some(store.finish_root(root, lock, &pointer.time_zone, false, None)?);
        }
        Ok(store)
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn open_verification(
        app_dir: PathBuf,
        root: PathBuf,
        model: ModelConfiguration,
        validate: std::sync::Arc<dyn Fn() -> Result<()> + Send + Sync>,
    ) -> Result<Self> {
        Self::open_verification_kind(app_dir, root, model, validate, VerificationOpen::Mcp)
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    pub(crate) fn open_g1_verification(
        app_dir: PathBuf,
        root: PathBuf,
        model: ModelConfiguration,
        validate: std::sync::Arc<dyn Fn() -> Result<()> + Send + Sync>,
    ) -> Result<Self> {
        Self::open_verification_kind(app_dir, root, model, validate, VerificationOpen::G1)
    }
    #[cfg(feature = "s33-mcp-ui-verification")]
    fn open_verification_kind(
        app_dir: PathBuf,
        root: PathBuf,
        model: ModelConfiguration,
        validate: std::sync::Arc<dyn Fn() -> Result<()> + Send + Sync>,
        kind: VerificationOpen,
    ) -> Result<Self> {
        validate()?;
        let marker = root.join(ROOT_MARKER);
        let m = fs::symlink_metadata(&marker).map_err(io_error)?;
        if !m.is_file()
            || m.file_type().is_symlink()
            || m.nlink() != 1
            || m.mode() & 0o7777 != 0o600
            || fs::read(&marker).map_err(io_error)? != MAGIC
        {
            return Err(StoreError::new("VERIFY_INPUT", "隔离验证根标记不符。"));
        }
        validate()?;
        let mut store = Self::open_empty(app_dir)?;
        store.verification_open = kind;
        validate()?;
        let lock = lock_file(&marker, "ROOT_IN_USE")?;
        store.workspace =
            Some(store.finish_root(root, lock, "UTC", false, Some(validate.as_ref()))?);
        store.verification_model = Some(model);
        store.verification_validate = Some(validate);
        Ok(store)
    }
    fn validate_pointer(&self, p: &Pointer) -> Result<()> {
        if p.app != "sidekick" || p.version != 1 || !Path::new(&p.root).is_absolute() {
            return Err(StoreError::new(
                "CORRUPT_BOOTSTRAP",
                "启动配置无法识别，原数据未重置。",
            ));
        }
        Ok(())
    }
    pub fn info(&self) -> Result<WorkspaceInfo> {
        let pending_root =
            if self.workspace.is_none() && self.app_dir.join("workspace-init.json").exists() {
                let p: Pointer = read_json(
                    &self.app_dir.join("workspace-init.json"),
                    "CORRUPT_BOOTSTRAP",
                )?;
                self.validate_pointer(&p)?;
                Some(p.root)
            } else {
                None
            };
        Ok(WorkspaceInfo {
            needs_setup: self.workspace.is_none(),
            root: self
                .workspace
                .as_ref()
                .map(|w| w.root.to_string_lossy().into()),
            default_root: self.app_dir.join("workspace").to_string_lossy().into(),
            pending_root,
        })
    }
    pub fn initialize(&mut self, path: Option<PathBuf>, time_zone: &str) -> Result<WorkspaceInfo> {
        if let Some(current) = &self.workspace {
            let requested = path.unwrap_or_else(|| self.app_dir.join("workspace"));
            if fs::canonicalize(requested).ok().as_ref() == Some(&current.root) {
                return self.info();
            }
            return Err(StoreError::new(
                "ROOT_ALREADY_OPEN",
                "当前工作目录已打开；运行中迁移将在后续版本提供。",
            ));
        }
        if time_zone.is_empty() || time_zone.len() > 128 || time_zone.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        let candidate = path.unwrap_or_else(|| self.app_dir.join("workspace"));
        let (root, lock, empty_root) = prepare_root(&candidate)?;
        let intent_path = self.app_dir.join("workspace-init.json");
        let pending_matches = if intent_path.exists() {
            let prior: Pointer = read_json(&intent_path, "CORRUPT_BOOTSTRAP")?;
            self.validate_pointer(&prior)?;
            Path::new(&prior.root) == root
        } else {
            false
        };
        let allow_init = empty_root || pending_matches;
        let pointer = Pointer {
            app: "sidekick".into(),
            version: 1,
            root: root.to_string_lossy().into(),
            time_zone: time_zone.into(),
        };
        if allow_init {
            atomic_json(&intent_path, &pointer)?;
        }
        self.check_fault(InitPhase::Marker)?;
        let workspace = self.finish_root(root, lock, time_zone, allow_init, None)?;
        self.check_fault(InitPhase::BeforeBootstrap)?;
        let target = self.app_dir.join("bootstrap.json");
        if target.exists() {
            return Err(StoreError::new(
                "BOOTSTRAP_CHANGED",
                "启动位置已经改变，请重新打开应用后继续。",
            ));
        }
        atomic_json(&target, &pointer)?;
        self.workspace = Some(workspace);
        let _ = fs::remove_file(self.app_dir.join("workspace-init.json"));
        self.info()
    }
    fn check_fault(&self, phase: InitPhase) -> Result<()> {
        #[cfg(test)]
        if self.init_fault == Some(phase) {
            return Err(StoreError::new("INJECTED", "合成初始化中断。"));
        }
        let _ = phase;
        Ok(())
    }
    fn finish_root(
        &self,
        root: PathBuf,
        lock: File,
        time_zone: &str,
        allow_init: bool,
        validate: Option<&dyn Fn() -> Result<()>>,
    ) -> Result<Workspace> {
        if let Some(validate) = validate {
            validate()?;
        }
        let root_directory = File::open(&root).map_err(io_error)?;
        if let Some(validate) = validate {
            validate()?;
        }
        #[cfg(all(test, feature = "s33-mcp-ui-verification"))]
        if validate.is_some() {
            verification_checkpoint("before-configuration");
        }
        if let Some(validate) = validate {
            validate()?;
        }
        let config_path = root.join("config/app.json");
        let mut config = if config_path.exists() {
            read_json::<RootConfig>(&config_path, "CORRUPT_CONFIG")?
        } else {
            if !allow_init || root.join("data/sidekick.sqlite").exists() {
                return Err(StoreError::new(
                    "CORRUPT_CONFIG",
                    "工作目录配置缺失，未替换已有数据。",
                ));
            }
            private_dir(&root.join("config"))?;
            let c = RootConfig {
                app: "sidekick".into(),
                version: 1,
                state: "initializing".into(),
                time_zone: time_zone.into(),
            };
            atomic_json(&config_path, &c)?;
            c
        };
        if config.app != "sidekick"
            || config.version != 1
            || !["initializing", "ready"].contains(&config.state.as_str())
        {
            return Err(StoreError::new(
                "CORRUPT_CONFIG",
                "工作目录版本或状态无法识别，原数据未重置。",
            ));
        }
        if validate.is_some() && config.state != "ready" {
            return Err(StoreError::new("VERIFY_INPUT", "隔离验证根尚未就绪。"));
        }
        let initializing = config.state == "initializing";
        if initializing && !allow_init {
            return Err(StoreError::new(
                "INCOMPLETE_ROOT",
                "请先完成工作目录初始化。",
            ));
        }
        // A ready root must retain its sensitive directories. Recreating one
        // would hide the old configuration or an unresolved credential journal.
        if !initializing {
            for path in [
                &root,
                &root.join("mcp"),
                &root.join("backups"),
                &root.join("runs"),
            ] {
                let metadata = fs::symlink_metadata(path).map_err(|_| {
                    StoreError::new(
                        "MCP_PATH_CHANGED",
                        "工作根或MCP私有目录缺失，未重建目录；请恢复原目录后重新打开。",
                    )
                })?;
                if !metadata.is_dir()
                    || metadata.file_type().is_symlink()
                    || metadata.mode() & 0o7777 != 0o700
                {
                    return Err(StoreError::new(
                        "MCP_PATH_CHANGED",
                        "工作根或MCP私有目录身份／权限不符，未修复或重建；请核对原目录。",
                    ));
                }
            }
        }
        for name in ["config", "data", "runs", "skills", "mcp", "logs", "backups"] {
            if let Some(validate) = validate {
                validate()?;
            }
            private_dir(&root.join(name))?;
        }
        let mcp_directory = File::open(root.join("mcp")).map_err(io_error)?;
        let runs_directory = File::open(root.join("runs")).map_err(io_error)?;
        let backups_directory = File::open(root.join("backups")).map_err(io_error)?;
        self.check_fault(InitPhase::Directories)?;
        let path = root.join("data/sidekick.sqlite");
        if !path.exists() {
            validate_existing_database(&path, initializing)?;
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&path)
                .map_err(io_error)?;
        }
        let mut database_identity = mcp_schema::DatabaseIdentity::capture(&root, &root_directory)?;
        if let Some(validate) = validate {
            validate()?;
        }
        validate_existing_database(&path, initializing)?;
        database_identity.verify(false)?;
        #[cfg(all(test, feature = "s33-mcp-ui-verification"))]
        if validate.is_some() {
            verification_checkpoint("before-database-open");
        }
        if let Some(validate) = validate {
            validate()?;
        }
        let mut db = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(db_error)?;
        #[cfg(all(test, feature = "s33-mcp-ui-verification"))]
        if validate.is_some() {
            verification_checkpoint("before-write-sql");
        }
        database_identity.verify(false)?;
        if let Some(validate) = validate {
            validate()?;
            let version: i64 = db
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .map_err(db_error)?;
            let allowed = version == 4;
            #[cfg(feature = "s33-mcp-ui-verification")]
            let allowed =
                allowed || matches!(self.verification_open, VerificationOpen::G1) && version == 5;
            if !allowed {
                return Err(StoreError::new("VERIFY_INPUT", "隔离验证根版本不符。"));
            }
        }
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(db_error)?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )
        .map_err(db_error)?;
        let version: i64 = db
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(db_error)?;
        self.check_fault(InitPhase::BeforeSchema)?;
        if (1..3).contains(&version) {
            #[cfg(test)]
            let fault = self.today_migration_fault;
            #[cfg(not(test))]
            let fault = today_schema::TodayMigrationFault::None;
            let upgraded = today_schema::upgrade_fixed(
                &mut db,
                &mut database_identity,
                &root,
                &backups_directory,
                3,
                None,
                fault,
            );
            if upgraded
                .as_ref()
                .is_err_and(|e| e.code == "TODAY_SCHEMA_UNCERTAIN")
            {
                self.today_schema_uncertain.set(true);
            }
            upgraded?;
        } else if version == 0 {
            migrations().to_latest(&mut db).map_err(|_| {
                StoreError::new(
                    "MIGRATION_FAILED",
                    "数据库初始化失败或结果未确认，原库已保留；请重新打开核对。",
                )
            })?;
        }
        mcp_calls::recover_business_mcp(&db)?;
        mcp_calls::recover_trial_mcp(&db, None)?;
        db.execute("UPDATE runs SET status='interrupted',error_code='INTERRUPTED',finished_at_ms=?1 WHERE status IN ('queued','running')",[now_ms()?]).map_err(db_error)?;
        db.execute("UPDATE agent_runs SET status='interrupted',error_code='INTERRUPTED',finished_at_ms=?1 WHERE status='running'",[now_ms()?]).map_err(db_error)?;
        self.check_fault(InitPhase::Schema)?;
        db.prepare(SELECT_TODO).map_err(db_error)?;
        if initializing {
            config.state = "ready".into();
            atomic_json(&config_path, &config)?;
        }
        self.check_fault(InitPhase::Ready)?;
        database_identity.verify(false)?;
        Ok(Workspace {
            root,
            db,
            _lock: lock,
            root_directory,
            mcp_directory,
            runs_directory,
            backups_directory,
            database_identity,
        })
    }
    fn db(&self) -> Result<&Connection> {
        if self.today_schema_uncertain.get() {
            return Err(today_schema::uncertain());
        }
        self.workspace
            .as_ref()
            .map(|w| &w.db)
            .ok_or_else(|| StoreError::new("SETUP_REQUIRED", "请先选择工作目录。"))
    }
    fn db_mut(&mut self) -> Result<&mut Connection> {
        if self.today_schema_uncertain.get() {
            return Err(today_schema::uncertain());
        }
        self.workspace
            .as_mut()
            .map(|w| &mut w.db)
            .ok_or_else(|| StoreError::new("SETUP_REQUIRED", "请先选择工作目录。"))
    }
    pub fn root(&self) -> Result<PathBuf> {
        self.workspace
            .as_ref()
            .map(|w| w.root.clone())
            .ok_or_else(|| StoreError::new("SETUP_REQUIRED", "请先选择工作目录。"))
    }
    fn profile_path(&self) -> Result<PathBuf> {
        let directory = self.root()?.join("config");
        let metadata = fs::symlink_metadata(&directory).map_err(io_error)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(StoreError::new(
                "INVALID_PROFILE",
                "个人配置目录无法识别，请恢复原工作目录后重试。",
            ));
        }
        let path = directory.join("profile.json");
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && metadata.nlink() == 1 => {}
            Ok(_) => {
                return Err(StoreError::new(
                    "INVALID_PROFILE",
                    "个人配置必须是独立的普通文件，原文件未覆盖。",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        Ok(path)
    }
    pub fn profile(&self) -> Result<UserProfile> {
        let path = self.profile_path()?;
        if !path.exists() {
            return Ok(UserProfile::default());
        }
        let profile: UserProfile = read_json(&path, "INVALID_PROFILE")?;
        if profile.version != 1 {
            return Err(StoreError::new(
                "PROFILE_TOO_NEW",
                "个人配置版本不支持，请使用兼容版本后重试，原文件未覆盖。",
            ));
        }
        ProfileInput {
            name: profile.name,
            address: profile.address,
        }
        .normalized()
    }
    fn write_profile(&self, path: &Path, profile: &UserProfile) -> Result<()> {
        #[cfg(test)]
        if self.profile_write_fault == Some(ProfileWriteFault::BeforeReplace) {
            return Err(io_error(std::io::Error::other("synthetic before replace")));
        }
        atomic_json(path, profile)?;
        #[cfg(test)]
        if matches!(
            self.profile_write_fault,
            Some(ProfileWriteFault::AfterReplace | ProfileWriteFault::AfterReplaceAndReadFailure)
        ) {
            return Err(io_error(std::io::Error::other("synthetic after replace")));
        }
        Ok(())
    }
    pub fn save_profile(&self, input: ProfileInput) -> Result<ProfileSave> {
        let profile = input.normalized()?;
        self.profile()?;
        let path = self.profile_path()?;
        match self.write_profile(&path, &profile) {
            Ok(()) => Ok(ProfileSave {
                profile,
                warning: None,
            }),
            Err(error) => {
                let actual = self.profile();
                #[cfg(test)]
                let actual = if self.profile_write_fault
                    == Some(ProfileWriteFault::AfterReplaceAndReadFailure)
                {
                    Err(io_error(std::io::Error::other(
                        "synthetic reconcile read failure",
                    )))
                } else {
                    actual
                };
                match actual {
                    Ok(actual) if actual == profile => Ok(ProfileSave {
                        profile: actual,
                        warning: Some(
                            "当前称呼已生效，但磁盘同步未能确认。请保留工作目录并稍后重试保存。",
                        ),
                    }),
                    Ok(_) => Err(error),
                    Err(_) => Err(StoreError::new(
                        "PROFILE_SAVE_UNCERTAIN",
                        "保存结果暂无法确认，请重新读取个人信息后再继续。",
                    )),
                }
            }
        }
    }
    pub fn list(&self) -> Result<Vec<Todo>> {
        let mut statement = self
            .db()?
            .prepare(&format!("{SELECT_TODO} ORDER BY created_at_ms DESC,id"))
            .map_err(db_error)?;
        let result = statement
            .query_map([], todo_row)
            .map_err(db_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error);
        result
    }
    pub fn get(&self, id: &str) -> Result<Todo> {
        load_todo(self.db()?, id)
    }
    pub fn history(&self, id: &str) -> Result<Vec<TodoEvent>> {
        let mut statement=self.db()?.prepare("SELECT operation_id,action,occurred_at_ms,before_json,after_json FROM todo_events WHERE todo_id=?1 ORDER BY sequence DESC").map_err(db_error)?;
        let rows = statement
            .query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(db_error)?;
        let mut events = Vec::new();
        for row in rows {
            let (op, action, time, before, after) = row.map_err(db_error)?;
            events.push(TodoEvent {
                operation_id: op,
                action,
                occurred_at_ms: time,
                before: before
                    .map(|s| serde_json::from_str(&s))
                    .transpose()
                    .map_err(|_| db_error(rusqlite::Error::InvalidQuery))?,
                after: serde_json::from_str(&after)
                    .map_err(|_| db_error(rusqlite::Error::InvalidQuery))?,
            });
        }
        Ok(events)
    }
    pub fn create(&mut self, input: TodoInput, operation_id: &str) -> Result<Todo> {
        let input = input.normalized()?;
        let request = json!({"action":"create","input":input}).to_string();
        validate_operation(operation_id)?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        if let Some(todo) = replay(&tx, operation_id, &request)? {
            return Ok(todo);
        }
        let todo = insert_todo(&tx, &input, "manual")?;
        record_event(&tx, operation_id, "create", &request, None, &todo)?;
        tx.commit().map_err(db_error)?;
        Ok(todo)
    }
    pub fn update(
        &mut self,
        id: &str,
        version: i64,
        input: TodoInput,
        operation_id: &str,
    ) -> Result<Todo> {
        let input = input.normalized()?;
        let request =
            json!({"action":"update","id":id,"version":version,"input":input}).to_string();
        validate_operation(operation_id)?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        if let Some(todo) = replay(&tx, operation_id, &request)? {
            return Ok(todo);
        }
        let before = load_todo(&tx, id)?;
        validate_change(&before, version)?;
        tx.execute("UPDATE todos SET title=?2,kind=?3,owner=?4,priority=?5,due_at_ms=?6,due_timezone=?7,due_local=?8,followup_at_ms=?9,followup_timezone=?10,followup_local=?11,tags_json=?12,updated_at_ms=?13,version=version+1,due_precision=?14,followup_precision=?15 WHERE id=?1",
            params![id,input.title,input.kind,input.owner,input.priority,input.due.as_ref().map(|p|p.at_ms),input.due.as_ref().map(|p|p.time_zone.as_str()),input.due.as_ref().map(|p|p.local_text.as_str()),input.followup.as_ref().map(|p|p.at_ms),input.followup.as_ref().map(|p|p.time_zone.as_str()),input.followup.as_ref().map(|p|p.local_text.as_str()),serde_json::to_string(&input.tags).map_err(|_|invalid())?,now_ms()?,input.due.as_ref().map(|p|p.precision.as_str()).unwrap_or("minute"),input.followup.as_ref().map(|p|p.precision.as_str()).unwrap_or("minute")]).map_err(db_error)?;
        let after = load_todo(&tx, id)?;
        record_event(&tx, operation_id, "update", &request, Some(&before), &after)?;
        tx.commit().map_err(db_error)?;
        Ok(after)
    }
    pub fn set_completed(
        &mut self,
        id: &str,
        version: i64,
        completed: bool,
        operation_id: &str,
    ) -> Result<Todo> {
        self.change_status(
            id,
            version,
            if completed { "completed" } else { "open" },
            if completed { "complete" } else { "reopen" },
            operation_id,
        )
    }
    pub fn delete(&mut self, id: &str, version: i64, operation_id: &str) -> Result<Todo> {
        self.change_status(id, version, "deleted", "delete", operation_id)
    }
    fn change_status(
        &mut self,
        id: &str,
        version: i64,
        status: &str,
        action: &str,
        operation_id: &str,
    ) -> Result<Todo> {
        let request = json!({"action":action,"id":id,"version":version}).to_string();
        validate_operation(operation_id)?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        if let Some(todo) = replay(&tx, operation_id, &request)? {
            return Ok(todo);
        }
        let before = load_todo(&tx, id)?;
        validate_change(&before, version)?;
        let time = now_ms()?;
        if before.status == status {
            return Err(StoreError::new(
                "STATE_UNCHANGED",
                "事项已经是这个状态，请刷新清单。",
            ));
        }
        tx.execute("UPDATE todos SET status=?2,completed_at_ms=?3,deleted_at_ms=?4,updated_at_ms=?5,version=version+1 WHERE id=?1",params![id,status,if status=="completed"{Some(time)}else{before.completed_at_ms.filter(|_|status=="deleted")},if status=="deleted"{Some(time)}else{None},time]).map_err(db_error)?;
        let after = load_todo(&tx, id)?;
        record_event(&tx, operation_id, action, &request, Some(&before), &after)?;
        tx.commit().map_err(db_error)?;
        Ok(after)
    }
}
fn validate_operation(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Err(invalid())
    } else {
        Ok(())
    }
}
fn validate_change(todo: &Todo, version: i64) -> Result<()> {
    if todo.status == "deleted" {
        return Err(StoreError::new(
            "DELETED",
            "事项已删除，不能继续修改；历史仍保留。",
        ));
    }
    if todo.version != version {
        return Err(StoreError::new(
            "VERSION_CONFLICT",
            "事项已有更新，请刷新后再操作。",
        ));
    }
    Ok(())
}
fn replay(tx: &Transaction<'_>, operation: &str, request: &str) -> Result<Option<Todo>> {
    use rusqlite::OptionalExtension;
    if tx
        .query_row(
            "SELECT count(*) FROM ingestion_operations WHERE operation_id=?1",
            [operation],
            |r| r.get::<_, i64>(0),
        )
        .map_err(db_error)?
        > 0
    {
        return Err(StoreError::new(
            "OPERATION_CONFLICT",
            "操作标识已用于其他内容，请重新操作。",
        ));
    }
    let previous: Option<(String, String)> = tx
        .query_row(
            "SELECT todo_id,request_json FROM todo_events WHERE operation_id=?1",
            [operation],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db_error)?;
    if let Some((id, prior)) = previous {
        if prior != request {
            return Err(StoreError::new(
                "OPERATION_CONFLICT",
                "操作标识已用于其他内容，请重新打开表单。",
            ));
        }
        return Ok(Some(load_todo(tx, &id)?));
    }
    Ok(None)
}
fn record_event(
    tx: &Transaction<'_>,
    operation: &str,
    action: &str,
    request: &str,
    before: Option<&Todo>,
    after: &Todo,
) -> Result<()> {
    tx.execute("INSERT INTO todo_events(operation_id,todo_id,action,occurred_at_ms,request_json,before_json,after_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![operation,after.id,action,after.updated_at_ms,request,before.map(serde_json::to_string).transpose().map_err(|_|invalid())?,serde_json::to_string(after).map_err(|_|invalid())?]).map_err(db_error)?;
    Ok(())
}
fn insert_todo(tx: &Transaction<'_>, input: &TodoInput, method: &str) -> Result<Todo> {
    let id: String = tx
        .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(db_error)?;
    let time = now_ms()?;
    tx.execute("INSERT INTO todos(id,title,kind,owner,priority,status,due_at_ms,due_timezone,due_local,followup_at_ms,followup_timezone,followup_local,tags_json,created_at_ms,updated_at_ms,version,source,capture_method,due_precision,followup_precision) VALUES(?1,?2,?3,?4,?5,'open',?6,?7,?8,?9,?10,?11,?12,?13,?13,1,'manual',?14,?15,?16)",
        params![id,input.title,input.kind,input.owner,input.priority,input.due.as_ref().map(|p|p.at_ms),input.due.as_ref().map(|p|p.time_zone.as_str()),input.due.as_ref().map(|p|p.local_text.as_str()),input.followup.as_ref().map(|p|p.at_ms),input.followup.as_ref().map(|p|p.time_zone.as_str()),input.followup.as_ref().map(|p|p.local_text.as_str()),serde_json::to_string(&input.tags).map_err(|_|invalid())?,time,method,input.due.as_ref().map(|p|p.precision.as_str()).unwrap_or("minute"),input.followup.as_ref().map(|p|p.precision.as_str()).unwrap_or("minute")]).map_err(db_error)?;
    load_todo(tx, &id)
}
fn load_todo(db: &Connection, id: &str) -> Result<Todo> {
    db.query_row(&format!("{SELECT_TODO} WHERE id=?1"), [id], todo_row)
        .map_err(db_error)
}
fn point_row(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<TimePoint>> {
    let at: Option<i64> = row.get(index)?;
    Ok(match at {
        Some(at_ms) => Some(TimePoint {
            at_ms,
            time_zone: row.get(index + 1)?,
            local_text: row.get(index + 2)?,
            precision: row.get(if index == 6 { 19 } else { 20 })?,
        }),
        None => None,
    })
}
fn todo_row(row: &Row<'_>) -> rusqlite::Result<Todo> {
    let tags: String = row.get(12)?;
    Ok(Todo {
        id: row.get(0)?,
        fields: TodoInput {
            title: row.get(1)?,
            kind: row.get(2)?,
            owner: row.get(3)?,
            priority: row.get(4)?,
            due: point_row(row, 6)?,
            followup: point_row(row, 9)?,
            tags: serde_json::from_str(&tags).map_err(|_| rusqlite::Error::InvalidQuery)?,
        },
        status: row.get(5)?,
        created_at_ms: row.get(13)?,
        updated_at_ms: row.get(14)?,
        completed_at_ms: row.get(15)?,
        deleted_at_ms: row.get(16)?,
        version: row.get(17)?,
        source: row.get(18)?,
    })
}

#[cfg(test)]
#[path = "local_store_tests.rs"]
mod tests;

#[path = "ingestion.rs"]
mod ingestion;
pub use ingestion::*;

#[path = "model_config.rs"]
mod model_config;
pub use model_config::*;

#[path = "agent_config.rs"]
mod agent_config;
pub use agent_config::*;

#[path = "agent_trials.rs"]
mod agent_trials;
pub use agent_trials::*;
#[path = "advisor_trials.rs"]
mod advisor_trials;
pub use advisor_trials::*;

#[path = "app_settings.rs"]
mod app_settings;
#[cfg(test)]
use app_settings::SettingsWriteFault;
pub use app_settings::*;

#[path = "desktop_preferences.rs"]
mod desktop_preferences;
pub use desktop_preferences::*;

#[cfg(test)]
#[path = "desktop_preferences_tests.rs"]
mod desktop_preferences_tests;

#[path = "mcp_config.rs"]
mod mcp_config;
#[cfg(test)]
use mcp_config::McpWriteFault;
pub use mcp_config::*;

#[path = "mcp_security.rs"]
mod mcp_security;
pub use mcp_security::{McpConfigurationView, McpSecretInput, PreparedMcpEnvironment};

#[cfg(test)]
#[path = "mcp_config_tests.rs"]
mod mcp_config_tests;
#[cfg(test)]
#[path = "mcp_http_tests.rs"]
mod mcp_http_tests;

#[cfg(test)]
#[path = "mcp_security_tests.rs"]
mod mcp_security_tests;

#[path = "mcp_keychain.rs"]
mod mcp_keychain;

#[cfg(test)]
#[path = "mcp_schema_tests.rs"]
mod mcp_schema_tests;

#[cfg(test)]
#[path = "mcp_upgrade_tests.rs"]
mod mcp_upgrade_tests;

#[path = "mcp_schema.rs"]
mod mcp_schema;
pub use mcp_schema::{McpSchemaUpgrade, McpStorageStatus, McpUpgradeInput};

#[path = "mcp_probe.rs"]
mod mcp_probe;
pub use mcp_probe::*;

#[path = "mcp_catalog.rs"]
mod mcp_catalog;
pub use mcp_catalog::{
    McpDiscoveredCatalog, McpDiscoveredTool, PreparedMcpProbe, PreparedMcpTransport,
};

#[path = "mcp_calls.rs"]
mod mcp_calls;
pub(crate) use mcp_calls::*;

#[cfg(test)]
#[path = "mcp_catalog_tests.rs"]
mod mcp_catalog_tests;

#[cfg(test)]
#[path = "today_advice_tests.rs"]
mod today_advice_tests;

#[path = "today_advice.rs"]
mod today_advice;
#[path = "today_schema.rs"]
mod today_schema;
pub use today_advice::*;

#[cfg(test)]
thread_local! { static TODAY_OPEN_FAULT:std::cell::Cell<today_schema::TodayMigrationFault>=const {std::cell::Cell::new(today_schema::TodayMigrationFault::None)}; }
