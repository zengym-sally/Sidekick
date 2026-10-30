use super::*;
use rusqlite::backup::{Backup, StepResult};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

pub(super) const SQL: &str = include_str!("../migrations/004_mcp_runs.sql");
#[derive(Clone, Copy, Default, PartialEq)]
pub(super) enum McpMigrationFault {
    #[default]
    None,
    #[cfg(test)]
    BackupCopy,
    #[cfg(test)]
    BackupSync,
    #[cfg(test)]
    BackupCollision,
    #[cfg(test)]
    Ddl,
    #[cfg(test)]
    Copy,
    #[cfg(test)]
    AfterCommit,
    #[cfg(test)]
    AfterCommitPath,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSchemaUpgrade {
    pub from_version: i64,
    pub to_version: i64,
    pub backup: Option<String>,
}
fn changed() -> StoreError {
    StoreError::new(
        "MCP_DATABASE_CHANGED",
        "数据库或所属目录的身份／私有性已变化，未修复或替换文件；请恢复原路径后重开核对。",
    )
}
fn unsupported() -> StoreError {
    StoreError::new(
        "MCP_SCHEMA_UNSUPPORTED",
        "数据库存在未知结构或依赖，未执行迁移；原数据已保留。",
    )
}
fn backup_failed() -> StoreError {
    StoreError::new(
        "MCP_BACKUP_FAILED",
        "迁移前备份未确认，未执行DDL；原库及本次遗留文件已保留，不能将遗留文件视为有效备份。",
    )
}
pub(super) fn uncertain() -> StoreError {
    StoreError::new(
        "MCP_MIGRATION_UNCERTAIN",
        "迁移结果未确认，当前MCP存储已阻断；请关闭并重开核对，勿覆盖原库或自动还原备份。",
    )
}
fn same_file(path: &Path, held: &File) -> Result<()> {
    let m = fs::symlink_metadata(path).map_err(|_| changed())?;
    let old = held.metadata().map_err(|_| changed())?;
    if !m.is_file()
        || m.file_type().is_symlink()
        || m.nlink() != 1
        || m.mode() & 0o7777 != 0o600
        || m.dev() != old.dev()
        || m.ino() != old.ino()
    {
        return Err(changed());
    }
    Ok(())
}
fn open_private(path: &Path) -> Result<File> {
    let m = fs::symlink_metadata(path).map_err(|_| changed())?;
    if !m.is_file() || m.file_type().is_symlink() || m.nlink() != 1 || m.mode() & 0o7777 != 0o600 {
        return Err(changed());
    }
    let held = File::open(path).map_err(|_| changed())?;
    same_file(path, &held)?;
    let actual = held.metadata().map_err(|_| changed())?;
    if actual.dev() != m.dev() || actual.ino() != m.ino() {
        return Err(changed());
    }
    Ok(held)
}
fn same_directory(path: &Path, held: &File, private: bool) -> Result<()> {
    let m = fs::symlink_metadata(path).map_err(|_| changed())?;
    let old = held.metadata().map_err(|_| changed())?;
    if !m.is_dir()
        || m.file_type().is_symlink()
        || private && m.mode() & 0o7777 != 0o700
        || m.dev() != old.dev()
        || m.ino() != old.ino()
    {
        return Err(changed());
    }
    Ok(())
}
pub(super) struct DatabaseIdentity {
    root: PathBuf,
    root_handle: File,
    data_handle: File,
    database: File,
    side_files: BTreeMap<&'static str, File>,
}
impl DatabaseIdentity {
    pub(super) fn capture(root: &Path, root_handle: &File) -> Result<Self> {
        let data = root.join("data");
        let data_handle = File::open(&data).map_err(|_| changed())?;
        same_directory(&data, &data_handle, true)?;
        let mut result = Self {
            root: root.into(),
            root_handle: root_handle.try_clone().map_err(io_error)?,
            data_handle,
            database: open_private(&data.join("sidekick.sqlite"))?,
            side_files: BTreeMap::new(),
        };
        result.verify(false)?;
        Ok(result)
    }
    pub(super) fn verify(&mut self, private_root: bool) -> Result<()> {
        if fs::canonicalize(&self.root).map_err(|_| changed())? != self.root {
            return Err(changed());
        }
        same_directory(&self.root, &self.root_handle, private_root)?;
        same_directory(&self.root.join("data"), &self.data_handle, true)?;
        same_file(&self.root.join("data/sidekick.sqlite"), &self.database)?;
        for name in ["sidekick.sqlite-wal", "sidekick.sqlite-shm"] {
            let path = self.root.join("data").join(name);
            if let Some(held) = self.side_files.get(name) {
                same_file(&path, held)?;
            } else {
                match fs::symlink_metadata(&path) {
                    Ok(_) => {
                        self.side_files.insert(name, open_private(&path)?);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err(changed()),
                }
            }
        }
        Ok(())
    }
}
pub(super) fn validate_source_files(path: &Path) -> Result<()> {
    open_private(path)?;
    for extension in ["sqlite-wal", "sqlite-shm"] {
        let side = path.with_extension(extension);
        match fs::symlink_metadata(&side) {
            Ok(_) => {
                open_private(&side)?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(changed()),
        }
    }
    Ok(())
}
fn integrity(db: &Connection) -> Result<()> {
    let quick: String = db
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| unsupported())?;
    let foreign = db
        .prepare("PRAGMA foreign_key_check")
        .map_err(|_| unsupported())?
        .exists([])
        .map_err(|_| unsupported())?;
    if quick != "ok" || foreign {
        return Err(unsupported());
    }
    Ok(())
}
fn reference(version: i64) -> Result<Connection> {
    let mut db = Connection::open_in_memory().map_err(db_error)?;
    if version <= 3 {
        migrations()
            .to_version(&mut db, version as usize)
            .map_err(|_| unsupported())?;
    } else {
        with_four(SQL)
            .to_latest(&mut db)
            .map_err(|_| unsupported())?;
    }
    Ok(db)
}
fn with_four(sql: &str) -> Migrations<'_> {
    Migrations::new(vec![
        M::up(include_str!("../migrations/001_todos.sql")),
        M::up(include_str!("../migrations/002_ingestion.sql")),
        M::up(include_str!("../migrations/003_agent_runs.sql")),
        M::up(sql).foreign_key_check(),
    ])
}
fn objects(db: &Connection) -> Result<BTreeMap<(String, String), String>> {
    db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' ORDER BY type,name").map_err(db_error)?.query_map([], |r| Ok(((r.get(0)?,r.get(1)?),r.get(2)?))).map_err(db_error)?.collect::<std::result::Result<_,_>>().map_err(db_error)
}
pub(super) fn validate_v4(db: &Connection) -> Result<()> {
    let actual = objects(db)?;
    for (key, sql) in objects(&reference(4)?)? {
        if actual.get(&key) != Some(&sql) {
            return Err(unsupported());
        }
    }
    integrity(db)
}
fn preflight(db: &Connection, version: i64) -> Result<()> {
    integrity(db)?;
    let expected = objects(&reference(version)?)?;
    let actual = objects(db)?;
    for (key, definition) in &expected {
        if actual.get(key) != Some(definition) {
            return Err(unsupported());
        }
    }
    let mut rebuilt = BTreeSet::from(["agent_runs"]);
    if version == 1 {
        rebuilt.insert("todo_events");
    }
    for table in &rebuilt {
        let key = ("table".into(), (*table).into());
        if actual.get(&key) != expected.get(&key) {
            return Err(unsupported());
        }
        let mut indexes = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=?1 AND sql IS NOT NULL").map_err(db_error)?;
        for row in indexes
            .query_map([table], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(db_error)?
        {
            let (name, sql) = row.map_err(db_error)?;
            if expected.get(&("index".into(), name)) != Some(&sql) {
                return Err(unsupported());
            }
        }
        if db
            .prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND tbl_name=?1")
            .map_err(db_error)?
            .exists([table])
            .map_err(db_error)?
        {
            return Err(unsupported());
        }
        for ((kind, _), sql) in &actual {
            if kind == "view" && sql.to_ascii_lowercase().contains(table) {
                return Err(unsupported());
            }
        }
    }
    for (kind, table) in actual.keys() {
        if kind == "table" {
            let mut statement = db
                .prepare("SELECT \"table\" FROM pragma_foreign_key_list(?1)")
                .map_err(db_error)?;
            for target in statement
                .query_map([table], |r| r.get::<_, String>(0))
                .map_err(db_error)?
            {
                if rebuilt.contains(target.map_err(db_error)?.to_ascii_lowercase().as_str()) {
                    return Err(unsupported());
                }
            }
        }
    }
    for ((kind, name), sql) in &expected {
        if kind == "index"
            && rebuilt
                .iter()
                .any(|table| sql.to_ascii_lowercase().contains(table))
            && actual.get(&(kind.clone(), name.clone())) != Some(sql)
        {
            return Err(unsupported());
        }
    }
    if actual.contains_key(&("table".into(), "tool_calls".into()))
        || actual.contains_key(&("table".into(), "agent_runs_v4".into()))
    {
        return Err(unsupported());
    }
    Ok(())
}
fn backup_database(
    db: &Connection,
    identity: &mut DatabaseIdentity,
    backups: &File,
    version: i64,
    _fault: McpMigrationFault,
) -> Result<(String, File)> {
    identity.verify(true)?;
    let directory = identity.root.join("backups");
    same_directory(&directory, backups, true)?;
    let name = format!("before-schema-4-{}-{}.sqlite", std::process::id(), nonce());
    #[cfg(test)]
    let name = if _fault == McpMigrationFault::BackupCollision {
        "before-schema-4-synthetic-collision.sqlite".into()
    } else {
        name
    };
    let path = directory.join(&name);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .map_err(|_| backup_failed())?;
    same_file(&path, &file)?;
    {
        let mut destination = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|_| backup_failed())?;
        same_file(&path, &file)?;
        let deadline = Instant::now() + Duration::from_secs(10);
        {
            let backup = Backup::new(db, &mut destination).map_err(|_| backup_failed())?;
            loop {
                if Instant::now() >= deadline {
                    return Err(backup_failed());
                }
                let step = backup.step(1).map_err(|_| backup_failed())?;
                #[cfg(test)]
                if _fault == McpMigrationFault::BackupCopy {
                    return Err(backup_failed());
                }
                identity.verify(true)?;
                same_directory(&directory, backups, true)?;
                same_file(&path, &file)?;
                match step {
                    StepResult::Done => break,
                    StepResult::More => {}
                    _ => return Err(backup_failed()),
                }
            }
        }
        destination
            .execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")
            .map_err(|_| backup_failed())?;
        if destination
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .map_err(|_| backup_failed())?
            != version
            || destination
                .pragma_query_value(None, "application_id", |r| r.get::<_, i64>(0))
                .map_err(|_| backup_failed())?
                != APPLICATION_ID
        {
            return Err(backup_failed());
        }
        integrity(&destination).map_err(|_| backup_failed())?;
    }
    #[cfg(test)]
    if _fault == McpMigrationFault::BackupSync {
        return Err(backup_failed());
    }
    file.sync_all().map_err(|_| backup_failed())?;
    same_file(&path, &file)?;
    same_directory(&directory, backups, true)?;
    backups.sync_all().map_err(|_| backup_failed())?;
    identity.verify(true)?;
    Ok((format!("backups/{name}"), file))
}
pub(super) fn upgrade_database(
    db: &mut Connection,
    identity: &mut DatabaseIdentity,
    backups: &File,
    _fault: McpMigrationFault,
) -> Result<McpSchemaUpgrade> {
    identity.verify(true)?;
    same_directory(&identity.root.join("backups"), backups, true)?;
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(db_error)?;
    let app: i64 = db
        .pragma_query_value(None, "application_id", |r| r.get(0))
        .map_err(db_error)?;
    if version > 4 {
        return Err(StoreError::new(
            "SCHEMA_TOO_NEW",
            "数据由较新版本创建，未执行迁移。",
        ));
    }
    if app != APPLICATION_ID || !(1..=4).contains(&version) {
        return Err(unsupported());
    }
    if version == 4 {
        validate_v4(db)?;
        return Ok(McpSchemaUpgrade {
            from_version: 4,
            to_version: 4,
            backup: None,
        });
    }
    preflight(db, version)?;
    let (backup, backup_file) = backup_database(db, identity, backups, version, _fault)?;
    identity.verify(true)?;
    same_directory(&identity.root.join("backups"), backups, true)?;
    same_file(&identity.root.join(&backup), &backup_file)?;
    let sql = SQL.to_string();
    #[cfg(test)]
    let sql = match _fault {
        McpMigrationFault::Ddl => sql.replace(
            "-- fault-point: after-create",
            "INSERT INTO missing_mcp_ddl VALUES(1);",
        ),
        McpMigrationFault::Copy => sql.replace(
            "-- fault-point: after-copy",
            "INSERT INTO missing_mcp_copy VALUES(1);",
        ),
        _ => sql,
    };
    with_four(&sql).to_latest(db).map_err(|_| uncertain())?;
    #[cfg(test)]
    if _fault == McpMigrationFault::AfterCommitPath {
        let path = identity.root.join("data/sidekick.sqlite");
        let retained = identity.root.join("data/retained-database");
        fs::rename(&path, &retained).map_err(io_error)?;
        fs::copy(&retained, &path).map_err(io_error)?;
    }
    #[cfg(test)]
    if _fault == McpMigrationFault::AfterCommit {
        return Err(uncertain());
    }
    identity.verify(true).map_err(|_| uncertain())?;
    same_directory(&identity.root.join("backups"), backups, true).map_err(|_| uncertain())?;
    same_file(&identity.root.join(&backup), &backup_file).map_err(|_| uncertain())?;
    validate_v4(db).map_err(|_| uncertain())?;
    Ok(McpSchemaUpgrade {
        from_version: version,
        to_version: 4,
        backup: Some(backup),
    })
}
impl AppStore {
    pub fn upgrade_mcp_storage(&mut self) -> Result<McpSchemaUpgrade> {
        if self.mcp_schema_uncertain {
            return Err(uncertain());
        }
        self.verify_mcp_paths()?;
        #[cfg(test)]
        let fault = self.mcp_migration_fault.unwrap_or_default();
        #[cfg(not(test))]
        let fault = McpMigrationFault::None;
        let workspace = self.workspace.as_mut().ok_or_else(changed)?;
        let result = upgrade_database(
            &mut workspace.db,
            &mut workspace.database_identity,
            &workspace.backups_directory,
            fault,
        );
        if result
            .as_ref()
            .is_err_and(|e| e.code == "MCP_MIGRATION_UNCERTAIN")
        {
            self.mcp_schema_uncertain = true;
        }
        result
    }
    pub(super) fn require_mcp_schema(&self) -> Result<()> {
        if self.mcp_probe_uncertain {
            return Err(super::mcp_catalog::uncertain());
        }
        if self.mcp_schema_uncertain {
            return Err(uncertain());
        }
        if self
            .db()?
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .map_err(db_error)?
            != 4
        {
            return Err(StoreError::new(
                "MCP_SCHEMA_REQUIRED",
                "MCP诊断存储尚未显式升级；普通打开不会自动迁移到v4。",
            ));
        }
        Ok(())
    }
}
