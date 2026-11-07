use super::*;
use rusqlite::backup::{Backup, StepResult};
use rusqlite::{Connection, OpenFlags};
use rusqlite_migration::{Migrations, M};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Lineage recorded in `schema_meta` and enforced before every normal open.
pub const SCHEMA_LINEAGE: &str = "web-backend/1";
/// File-level application id, distinct from the legacy store (`0x53444b31`).
pub const WEB_BACKEND_APPLICATION_ID: i64 = 0x57424b31;
/// Highest schema version this build knows how to operate.
pub const SCHEMA_VERSION: i64 = 1;
/// Default database location relative to the workspace root.
pub const DEFAULT_DB_FILE: &str = "data/web-backend.sqlite";

const SQL: &str = include_str!("../../migrations/web-backend/001_web_backend.sql");

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) enum WebBackendMigrationFault {
    #[default]
    None,
    #[cfg(test)]
    Ddl,
}

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(SQL)])
}

fn missing_database() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_MISSING_DATABASE",
        "新后端数据库不存在或未初始化，未创建空库替代；请显式初始化。",
    )
}
fn corrupt_database() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_CORRUPT_DATABASE",
        "新后端数据库完整性校验失败，未写入或重建；请从一致性备份恢复。",
    )
}
fn unknown_database() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_UNKNOWN_DATABASE",
        "该数据库不属于 web-backend/1，未合并、覆盖或续用。",
    )
}
fn lineage_mismatch() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_SCHEMA_LINEAGE_MISMATCH",
        "数据库 lineage 与 web-backend/1 不符，未新建或续用。",
    )
}
fn version_mismatch() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_SCHEMA_VERSION_MISMATCH",
        "迁移进度与 schema 镜像不一致，已拒绝打开且不自动修复；请人工核对。",
    )
}
fn too_new() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_SCHEMA_TOO_NEW",
        "数据库由较新的跟班版本创建，请升级应用后打开。",
    )
}
fn migration_failed() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_MIGRATION_FAILED",
        "数据库迁移失败或结果未确认，原库已保留；请重新打开核对。",
    )
}
fn backup_failed() -> StoreError {
    StoreError::new(
        "WEB_BACKEND_BACKUP_FAILED",
        "一致性备份未确认，原库与本次遗留文件已保留。",
    )
}

/// Apply the connection contract for a `web-backend/1` database.
///
/// WAL, `synchronous=FULL` and per-connection `foreign_keys=ON` are connection
/// settings, not schema state; every connection that touches the database must
/// apply them.
pub fn configure_connection(conn: &Connection) -> Result<()> {
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(db_error)?;
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
        .map_err(db_error)?;
    Ok(())
}

/// A validated, open `web-backend/1` database.
///
/// Obtained through [`WebBackendSchema::init`] (explicit initialization) or
/// [`WebBackendSchema::open`] (normal open). The module owns one connection;
/// later callers that open additional connections must apply
/// [`configure_connection`] to each of them.
pub struct WebBackendSchema {
    conn: Connection,
    path: PathBuf,
}

impl std::fmt::Debug for WebBackendSchema {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebBackendSchema")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl WebBackendSchema {
    /// Explicitly initialize the database at `path`.
    ///
    /// Idempotent: a blank file is created and migrated; an existing valid
    /// database is validated and any pending forward migrations are applied.
    /// A database of another lineage, a corrupt file, or a version mirror
    /// mismatch is rejected without repair.
    pub fn init(path: &Path) -> Result<WebBackendSchema> {
        init_with_fault(path, WebBackendMigrationFault::None)
    }

    /// Open and validate an existing database at `path`.
    ///
    /// A missing or blank file is rejected with [`missing_database`] rather
    /// than silently created.
    pub fn open(path: &Path) -> Result<WebBackendSchema> {
        open_with_fault(path, WebBackendMigrationFault::None)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Write a consistent backup to a new file at `destination`.
    ///
    /// The destination must not already exist. The copy is verified for
    /// integrity, `application_id` and `user_version` before success is
    /// reported.
    pub fn consistency_backup(&self, destination: &Path) -> Result<()> {
        if let Some(parent) = destination.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(io_error)?;
            }
        }
        let destination = canonical_parent(destination)?;
        self.conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(db_error)?;
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&destination)
            .map_err(|_| backup_failed())?;
        drop(file);
        let mut target = Connection::open_with_flags(
            &destination,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|_| backup_failed())?;
        target
            .execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")
            .map_err(|_| backup_failed())?;
        {
            let backup = Backup::new(&self.conn, &mut target).map_err(|_| backup_failed())?;
            loop {
                match backup.step(-1).map_err(|_| backup_failed())? {
                    StepResult::Done => break,
                    StepResult::More => {}
                    _ => return Err(backup_failed()),
                }
            }
        }
        let check: String = target
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(|_| backup_failed())?;
        if check != "ok" {
            return Err(backup_failed());
        }
        let app: i64 = target
            .pragma_query_value(None, "application_id", |r| r.get(0))
            .map_err(|_| backup_failed())?;
        let version: i64 = target
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|_| backup_failed())?;
        if app != WEB_BACKEND_APPLICATION_ID || version != SCHEMA_VERSION {
            return Err(backup_failed());
        }
        Ok(())
    }
}

pub(crate) fn init_with_fault(
    path: &Path,
    fault: WebBackendMigrationFault,
) -> Result<WebBackendSchema> {
    match classify(path)? {
        Target::Blank => create_with_fault(path, fault),
        Target::Initialized => open_existing_with_fault(path, fault),
    }
}

pub(crate) fn open_with_fault(
    path: &Path,
    fault: WebBackendMigrationFault,
) -> Result<WebBackendSchema> {
    match classify(path)? {
        Target::Blank => Err(missing_database()),
        Target::Initialized => open_existing_with_fault(path, fault),
    }
}

enum Target {
    /// Missing or zero-length file, or a database with no schema objects.
    Blank,
    /// A database that carries schema objects and must be validated.
    Initialized,
}

/// Resolve the parent directory so `NOFOLLOW` is not tripped by a symlinked
/// directory component (the same convention the legacy store uses when it
/// canonicalizes its application directory).
fn canonical_parent(path: &Path) -> Result<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().ok_or_else(|| {
        StoreError::new(
            "WEB_BACKEND_INVALID_PATH",
            "新后端数据库路径无效，未创建或打开文件。",
        )
    })?;
    Ok(fs::canonicalize(parent).map_err(io_error)?.join(file_name))
}

fn classify(path: &Path) -> Result<Target> {
    if !path.exists() {
        return Ok(Target::Blank);
    }
    if fs::metadata(path).map_err(io_error)?.len() == 0 {
        return Ok(Target::Blank);
    }
    let path = canonical_parent(path)?;
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(|_| corrupt_database())?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| corrupt_database())?;
    if check != "ok" {
        return Err(corrupt_database());
    }
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| corrupt_database())?;
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap_or(0);
    if tables == 0 && version == 0 {
        return Ok(Target::Blank);
    }
    Ok(Target::Initialized)
}

fn create_with_fault(path: &Path, fault: WebBackendMigrationFault) -> Result<WebBackendSchema> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
    }
    let path = canonical_parent(path)?;
    // Create the file first (the same convention as the legacy store), then
    // open it with NOFOLLOW so a symlink swap after creation is rejected.
    if !path.exists() {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(io_error)?;
    }
    let mut conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(db_error)?;
    configure_connection(&conn)?;
    conn.execute_batch(&format!(
        "PRAGMA application_id = {WEB_BACKEND_APPLICATION_ID};"
    ))
    .map_err(db_error)?;
    apply_migrations(&mut conn, fault)?;
    Ok(WebBackendSchema {
        conn,
        path: path.clone(),
    })
}

fn open_existing_with_fault(
    path: &Path,
    fault: WebBackendMigrationFault,
) -> Result<WebBackendSchema> {
    let path = canonical_parent(path)?;
    let mut conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(db_error)?;
    configure_connection(&conn)?;
    validate(&conn)?;
    apply_migrations(&mut conn, fault)?;
    Ok(WebBackendSchema {
        conn,
        path: path.clone(),
    })
}

fn validate(conn: &Connection) -> Result<()> {
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| corrupt_database())?;
    if check != "ok" {
        return Err(corrupt_database());
    }
    let app: i64 = conn
        .pragma_query_value(None, "application_id", |r| r.get(0))
        .map_err(|_| unknown_database())?;
    let user_version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(db_error)?;
    if app != WEB_BACKEND_APPLICATION_ID {
        return Err(unknown_database());
    }
    let lineage: String = conn
        .query_row(
            "SELECT schema_lineage FROM schema_meta WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| lineage_mismatch())?;
    if lineage != SCHEMA_LINEAGE {
        return Err(lineage_mismatch());
    }
    let schema_version: i64 = conn
        .query_row(
            "SELECT schema_version FROM schema_meta WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| lineage_mismatch())?;
    if schema_version != user_version {
        return Err(version_mismatch());
    }
    if schema_version > SCHEMA_VERSION {
        return Err(too_new());
    }
    Ok(())
}

#[cfg(test)]
fn apply_migrations(conn: &mut Connection, fault: WebBackendMigrationFault) -> Result<()> {
    if fault == WebBackendMigrationFault::Ddl {
        let sql = format!("{SQL}\nINSERT INTO missing_web_backend_table VALUES(1);");
        return Migrations::new(vec![M::up(&sql)])
            .to_latest(conn)
            .map_err(|_| migration_failed());
    }
    migrations().to_latest(conn).map_err(|_| migration_failed())
}

#[cfg(not(test))]
fn apply_migrations(conn: &mut Connection, _fault: WebBackendMigrationFault) -> Result<()> {
    migrations().to_latest(conn).map_err(|_| migration_failed())
}
