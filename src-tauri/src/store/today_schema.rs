use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::os::unix::ffi::OsStrExt;
pub(super) const SQL: &str = include_str!("../../migrations/005_today_advice.sql");
#[derive(Clone, Copy, Default, PartialEq)]
pub(super) enum TodayMigrationFault {
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
    ForeignKey,
    #[cfg(test)]
    Commit,
    #[cfg(test)]
    CommitResponse,
    #[cfg(test)]
    Rollback,
    #[cfg(test)]
    RollbackReadBack,
    #[cfg(test)]
    AfterCommitPath,
    #[cfg(test)]
    ForeignKeysOn,
}
pub(super) fn uncertain() -> StoreError {
    StoreError::new(
        "TODAY_SCHEMA_UNCERTAIN",
        "数据升级结果未确认，请关闭并重开应用核对；不要重试升级或覆盖数据库。",
    )
}
fn unsupported() -> StoreError {
    StoreError::new(
        "TODAY_SCHEMA_UNSUPPORTED",
        "当前数据库结构或依赖无法安全升级，原数据已保留。",
    )
}
pub(super) fn reference(version: i64) -> Result<Connection> {
    let db = mcp_schema::reference(version.min(4))?;
    if version == 5 {
        db.execute_batch(SQL).map_err(db_error)?;
        db.pragma_update(None, "user_version", 5)
            .map_err(db_error)?;
    }
    Ok(db)
}
fn preflight(db: &Connection, version: i64, target: i64) -> Result<()> {
    mcp_schema::integrity(db)?;
    let expected = mcp_schema::objects(&reference(version)?)?;
    let actual = mcp_schema::objects(db)?;
    for (key, definition) in &expected {
        if actual.get(key) != Some(definition) {
            return Err(unsupported());
        }
    }
    for key in mcp_schema::objects(&reference(target)?)?.keys() {
        if !expected.contains_key(key) && actual.contains_key(key) {
            return Err(unsupported());
        }
    }
    if actual.contains_key(&("table".into(), "agent_runs_v5".into())) {
        return Err(unsupported());
    }
    let mut rebuilt = BTreeSet::new();
    if target == 5 {
        rebuilt.insert("agent_runs");
    }
    if version == 1 {
        rebuilt.insert("todo_events");
    }
    for ((kind, name), sql) in &actual {
        if expected.get(&(kind.clone(), name.clone())) == Some(sql) {
            continue;
        }
        if ["index", "trigger", "view"].contains(&kind.as_str())
            && rebuilt
                .iter()
                .any(|table| sql.to_ascii_lowercase().contains(table))
        {
            return Err(unsupported());
        }
    }
    for (kind, table) in actual.keys() {
        if kind != "table" {
            continue;
        }
        let mut q = db
            .prepare("SELECT \"table\" FROM pragma_foreign_key_list(?1)")
            .map_err(db_error)?;
        for target in q
            .query_map([table], |r| r.get::<_, String>(0))
            .map_err(db_error)?
        {
            let target = target.map_err(db_error)?;
            if rebuilt.contains(target.to_ascii_lowercase().as_str())
                && !(table == "tool_calls"
                    && version >= 4
                    && expected.get(&("table".into(), table.clone()))
                        == actual.get(&("table".into(), table.clone())))
            {
                return Err(unsupported());
            }
        }
    }
    Ok(())
}
pub(super) fn validate_v5(db: &Connection) -> Result<()> {
    preflight(db, 5, 5)
}
fn version(db: &Connection) -> Result<i64> {
    db.pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(db_error)
}
fn schema_token(app: &Path, root: &Path, db: &Connection, target: i64) -> Result<(String, String)> {
    let meta = fs::symlink_metadata(root.join("data/sidekick.sqlite")).map_err(io_error)?;
    let mut bytes = app.as_os_str().as_bytes().to_vec();
    bytes.push(0);
    bytes.extend(root.as_os_str().as_bytes());
    bytes.extend(meta.dev().to_be_bytes());
    bytes.extend(meta.ino().to_be_bytes());
    let workspace = format!("{:x}", Sha256::digest(&bytes));
    bytes.extend(target.to_be_bytes());
    bytes.extend(version(db)?.to_be_bytes());
    bytes.extend(
        serde_json::to_vec(&mcp_schema::objects(db)?.into_iter().collect::<Vec<_>>())
            .map_err(|_| unsupported())?,
    );
    Ok((workspace, format!("{:x}", Sha256::digest(&bytes))))
}
pub(super) fn upgrade_fixed(
    db: &mut Connection,
    identity: &mut mcp_schema::DatabaseIdentity,
    root: &Path,
    backups: &File,
    target: i64,
    confirmation: Option<(&Path, &str)>,
    fault: TodayMigrationFault,
) -> Result<McpSchemaUpgrade> {
    #[cfg(not(test))]
    let _ = fault;
    if ![3, 5].contains(&target) {
        return Err(unsupported());
    }
    identity.verify(true)?;
    mcp_schema::same_directory(&root.join("backups"), backups, true)?;
    let from = version(db)?;
    if from > 5 {
        return Err(StoreError::new(
            "SCHEMA_TOO_NEW",
            "数据由较新版本创建，未执行升级。",
        ));
    }
    if from < 1 || from > target {
        return Err(unsupported());
    }
    if from == target {
        preflight(db, from, target)?;
        return Ok(McpSchemaUpgrade {
            from_version: from,
            to_version: target,
            backup: None,
        });
    }
    let before_objects = mcp_schema::objects(db)?;
    let before_app = db
        .pragma_query_value(None, "application_id", |r| r.get::<_, i64>(0))
        .map_err(db_error)?;
    db.pragma_update(None, "foreign_keys", false)
        .map_err(db_error)?;
    if db
        .pragma_query_value(None, "foreign_keys", |r| r.get::<_, i64>(0))
        .map_err(db_error)?
        != 0
    {
        return Err(uncertain());
    }
    if db.execute_batch("BEGIN IMMEDIATE").is_err() {
        let restored = db.pragma_update(None, "foreign_keys", true).is_ok()
            && db
                .pragma_query_value(None, "foreign_keys", |r| r.get::<_, i64>(0))
                .ok()
                == Some(1);
        return Err(if restored {
            StoreError::new("DATABASE_BUSY", "数据库正被占用，未执行升级。")
        } else {
            uncertain()
        });
    }
    let mut ddl = false;
    let mut committed = false;
    let mut backup_path = None;
    let result = (|| {
        identity.verify(true)?;
        if version(db)? != from
            || db
                .pragma_query_value(None, "application_id", |r| r.get::<_, i64>(0))
                .map_err(db_error)?
                != APPLICATION_ID
        {
            return Err(unsupported());
        }
        preflight(db, from, target)?;
        if let Some((app, token)) = confirmation {
            if schema_token(app, root, db, target)?.1 != token {
                return Err(StoreError::new(
                    "TODAY_UPGRADE_STALE",
                    "工作目录或版本已有变化，请重新读取后确认。",
                ));
            }
        }
        let reader = Connection::open_with_flags(
            root.join("data/sidekick.sqlite"),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(db_error)?;
        identity.verify(true)?;
        #[cfg(not(test))]
        let backup_fault = mcp_schema::McpMigrationFault::None;
        #[cfg(test)]
        let backup_fault = match fault {
            TodayMigrationFault::BackupCopy => mcp_schema::McpMigrationFault::BackupCopy,
            TodayMigrationFault::BackupSync => mcp_schema::McpMigrationFault::BackupSync,
            TodayMigrationFault::BackupCollision => mcp_schema::McpMigrationFault::BackupCollision,
            _ => mcp_schema::McpMigrationFault::None,
        };
        let (name, held) =
            mcp_schema::backup_database(&reader, identity, backups, from, target, backup_fault)?;
        drop(reader);
        identity.verify(true)?;
        mcp_schema::same_file(&root.join(&name), &held)?;
        preflight(db, from, target)?;
        backup_path = Some(name.clone());
        ddl = true;
        let sqls = [
            include_str!("../../migrations/001_todos.sql"),
            include_str!("../../migrations/002_ingestion.sql"),
            include_str!("../../migrations/003_agent_runs.sql"),
            include_str!("../../migrations/004_mcp_runs.sql"),
            SQL,
        ];
        for migration in sqls.iter().take(target as usize).skip(from as usize) {
            #[allow(unused_mut)]
            let mut sql = migration.to_string();
            #[cfg(test)]
            {
                if fault == TodayMigrationFault::Ddl {
                    sql.push_str("\nINSERT INTO missing_today_ddl VALUES(1);");
                }
                if fault == TodayMigrationFault::Copy {
                    sql = sql.replace(
                        "-- fault-point: after-copy",
                        "INSERT INTO missing_today_copy VALUES(1);",
                    );
                    if target == 3 {
                        sql.push_str("\nINSERT INTO missing_today_copy VALUES(1);");
                    }
                }
            }
            db.execute_batch(&sql).map_err(|_| uncertain())?;
        }
        #[cfg(test)]
        if fault == TodayMigrationFault::ForeignKey {
            db.execute("INSERT INTO todo_events(operation_id,todo_id,action,occurred_at_ms,request_json,after_json) VALUES('synthetic-orphan','missing-todo','create',1,'{}','{}')",[]).map_err(|_|uncertain())?;
        }
        #[cfg(test)]
        if matches!(
            fault,
            TodayMigrationFault::Rollback | TodayMigrationFault::RollbackReadBack
        ) {
            return Err(uncertain());
        }
        mcp_schema::integrity(db)?;
        db.pragma_update(None, "user_version", target)
            .map_err(|_| uncertain())?;
        preflight(db, target, target)?;
        #[cfg(test)]
        if fault == TodayMigrationFault::Commit {
            return Err(uncertain());
        }
        db.execute_batch("COMMIT").map_err(|_| uncertain())?;
        committed = true;
        #[cfg(test)]
        if fault == TodayMigrationFault::CommitResponse {
            return Err(uncertain());
        }
        #[cfg(test)]
        if fault == TodayMigrationFault::AfterCommitPath {
            let path = root.join("data/sidekick.sqlite");
            fs::rename(&path, root.join("data/retained-today-database")).map_err(io_error)?;
            fs::copy(root.join("data/retained-today-database"), &path).map_err(io_error)?;
        }
        identity.verify(true).map_err(|_| uncertain())?;
        mcp_schema::same_file(&root.join(name), &held).map_err(|_| uncertain())?;
        mcp_schema::same_directory(&root.join("backups"), backups, true)
            .map_err(|_| uncertain())?;
        preflight(db, target, target).map_err(|_| uncertain())?;
        Ok(())
    })();
    #[allow(unused_mut)]
    let mut rollback_ok = if !committed {
        db.execute_batch("ROLLBACK").is_ok()
    } else {
        true
    };
    #[cfg(test)]
    if fault == TodayMigrationFault::Rollback {
        rollback_ok = false;
    }
    #[allow(unused_mut)]
    let mut old_ok = committed
        || rollback_ok
            && version(db).ok() == Some(from)
            && mcp_schema::objects(db).ok() == Some(before_objects)
            && db
                .pragma_query_value(None, "application_id", |r| r.get::<_, i64>(0))
                .ok()
                == Some(before_app)
            && mcp_schema::integrity(db).is_ok();
    #[cfg(test)]
    if fault == TodayMigrationFault::RollbackReadBack {
        old_ok = false;
    }
    #[allow(unused_mut)]
    let mut on_ok = db.pragma_update(None, "foreign_keys", true).is_ok()
        && db
            .pragma_query_value(None, "foreign_keys", |r| r.get::<_, i64>(0))
            .ok()
            == Some(1);
    #[cfg(test)]
    if fault == TodayMigrationFault::ForeignKeysOn {
        on_ok = false;
    }
    if !on_ok || !rollback_ok || !old_ok {
        return Err(uncertain());
    }
    match result {
        Ok(()) => Ok(McpSchemaUpgrade {
            from_version: from,
            to_version: target,
            backup: backup_path,
        }),
        Err(error) => Err(if ddl || committed { uncertain() } else { error }),
    }
}
impl AppStore {
    pub fn today_storage_status(&mut self) -> Result<McpStorageStatus> {
        if self.today_schema_uncertain.get() {
            return Err(uncertain());
        }
        self.verify_mcp_paths()?;
        let w = self.workspace.as_mut().ok_or_else(invalid)?;
        w.database_identity.verify(true)?;
        let v = version(&w.db)?;
        if v > 5 {
            return Err(StoreError::new(
                "SCHEMA_TOO_NEW",
                "数据由较新版本创建，未执行升级。",
            ));
        }
        if !(1..=5).contains(&v)
            || w.db
                .pragma_query_value(None, "application_id", |row| row.get::<_, i64>(0))
                .map_err(db_error)?
                != APPLICATION_ID
        {
            return Err(unsupported());
        }
        preflight(&w.db, v, 5)?;
        let (id, token) = schema_token(&self.app_dir, &w.root, &w.db, 5)?;
        Ok(McpStorageStatus {
            root: w.root.to_string_lossy().into(),
            workspace_id: id,
            version: v,
            target_version: 5,
            confirmation_token: (v < 5).then_some(token),
        })
    }
    pub fn confirm_today_upgrade(&mut self, input: McpUpgradeInput) -> Result<McpSchemaUpgrade> {
        if !input.confirmed
            || input.confirmation_token.len() != 64
            || !input
                .confirmation_token
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err(StoreError::new(
                "TODAY_UPGRADE_CONFIRMATION",
                "请核对工作目录、备份和旧版本兼容说明，再明确确认升级。",
            ));
        }
        let status = self.today_storage_status()?;
        if status.confirmation_token.as_deref() != Some(input.confirmation_token.as_str()) {
            return Err(StoreError::new(
                "TODAY_UPGRADE_STALE",
                "升级确认已过期，请重新读取当前工作目录。",
            ));
        }
        let w = self.workspace.as_mut().ok_or_else(invalid)?;
        #[cfg(test)]
        let fault = self.today_migration_fault;
        #[cfg(not(test))]
        let fault = TodayMigrationFault::None;
        let result = upgrade_fixed(
            &mut w.db,
            &mut w.database_identity,
            &w.root,
            &w.backups_directory,
            5,
            Some((&self.app_dir, &input.confirmation_token)),
            fault,
        );
        if result
            .as_ref()
            .is_err_and(|e| e.code == "TODAY_SCHEMA_UNCERTAIN")
        {
            self.today_schema_uncertain.set(true);
        }
        result
    }
}
