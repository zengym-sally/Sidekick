//! Web backend storage protocol: the stdio command surface used by the Node
//! backend host. The adapter owns the business connection and the root lock;
//! Node never opens the database directly (`web-api/1` §9.1, W1 contract §9.1).
//!
//! Frame protocol (new in this slice; the subprocess/stdout-last-line/exit-code
//! pattern is the one proven by the backend-foundation probes):
//! - one JSON request per stdin line: `{id, command, params}`;
//! - one JSON response per stdout line: `{id, ok, result}` / `{id, ok, error}`;
//! - stdin EOF closes the connection and releases the root lock (exit 0).

use super::*;
use serde_json::{json, Value};
use std::io::BufRead;

/// Lock file kept inside the workspace root for the process lifetime.
const ROOT_LOCK_FILE: &str = ".web-backend-lock";
/// Business tables the `transact` surface may write in this slice: the frozen
/// 002 manual-item pair, the five 003 text-intake tables, the 004
/// candidate-operation ledger, and the eight 001 task-system tables. `settings`
/// and `schema_meta`/`sqlite_sequence` are deliberately excluded (settings goes
/// through the exact-template path; the latter two are migration-only). The
/// ledger is append-only by service-layer protocol, not by an INSERT-only
/// storage guard: the adapter still validates the real DML target.
const BUSINESS_TABLES: [&str; 16] = [
    "manual_items",
    "manual_item_events",
    "text_sources",
    "candidates",
    "candidate_previews",
    "manual_item_sources",
    "sign_off_batches",
    "candidate_operations",
    "tasks",
    "task_attempts",
    "task_events",
    "task_result_payloads",
    "side_effect_receipts",
    "instance_epochs",
    "recovery_holds",
    "recovery_items",
];
/// Read-only PRAGMA facts exposed through the `pragma` command.
const READONLY_PRAGMAS: [&str; 6] = [
    "journal_mode",
    "user_version",
    "application_id",
    "foreign_keys",
    "busy_timeout",
    "quick_check",
];
const FORBIDDEN_WRITE_KEYWORDS: [&str; 10] = [
    "ATTACH",
    "DETACH",
    "PRAGMA",
    "LOAD_EXTENSION",
    "VACUUM",
    "COPY",
    "DROP",
    "ALTER",
    "CREATE",
    "TRUNCATE",
];
const FORBIDDEN_READ_KEYWORDS: [&str; 12] = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "REPLACE",
    "ATTACH",
    "DETACH",
    "PRAGMA",
    "LOAD_EXTENSION",
    "VACUUM",
    "DROP",
    "ALTER",
    "CREATE",
];

#[derive(Debug, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub id: Value,
    pub command: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub id: Value,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Debug)]
pub(crate) struct ProtocolError {
    pub(crate) code: String,
    pub(crate) message: String,
}

impl ProtocolError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

pub(crate) type PResult<T> = std::result::Result<T, ProtocolError>;

fn p(code: &str, message: impl Into<String>) -> ProtocolError {
    ProtocolError::new(code, message)
}

impl From<StoreError> for ProtocolError {
    fn from(error: StoreError) -> Self {
        Self::new(error.code, error.message)
    }
}

impl From<rusqlite::Error> for ProtocolError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("WEB_BACKEND_SQL_ERROR", error.to_string())
    }
}

impl From<std::io::Error> for ProtocolError {
    fn from(error: std::io::Error) -> Self {
        Self::new("WEB_BACKEND_IO_ERROR", error.to_string())
    }
}

/// Deserialize an explicit `null` as `Some(Value::Null)` so a present-but-null
/// `expectChanges` is rejected instead of silently meaning "no assertion".
fn deserialize_some<'de, T, D>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize)]
struct Op {
    sql: String,
    #[serde(default)]
    params: Value,
    /// Optional pre-commit assertion: the DML must affect exactly this many
    /// rows or the whole transaction is rolled back with
    /// `WEB_BACKEND_CONDITION_FAILED`. Absent keeps the original behaviour.
    #[serde(
        default,
        rename = "expectChanges",
        deserialize_with = "deserialize_some"
    )]
    expect_changes: Option<Value>,
}

/// The storage adapter: one optional open database plus its root lock.
pub struct WebBackendStore {
    schema: Option<WebBackendSchema>,
    root: Option<PathBuf>,
    /// Declared last so field-drop order closes the connection before the lock.
    lock: Option<File>,
}

impl Default for WebBackendStore {
    fn default() -> Self {
        Self::new()
    }
}

impl WebBackendStore {
    pub fn new() -> Self {
        Self {
            schema: None,
            root: None,
            lock: None,
        }
    }

    pub(crate) fn init(&mut self, params: &Value) -> PResult<Value> {
        self.close_internal()?;
        let root = root_arg(params)?;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&root)?;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(root.join("data"))?;
        let lock = acquire_root_lock(&root)?;
        let schema = WebBackendSchema::init(&root.join("data/web-backend.sqlite"))?;
        self.schema = Some(schema);
        self.root = Some(root);
        self.lock = Some(lock);
        Ok(json!({"ok": true}))
    }

    pub(crate) fn open(&mut self, params: &Value) -> PResult<Value> {
        self.close_internal()?;
        let root = root_arg(params)?;
        if !root.is_dir() {
            return Err(p("WEB_BACKEND_INVALID_ROOT", "工作目录不存在或不是目录。"));
        }
        let lock = acquire_root_lock(&root)?;
        let schema = WebBackendSchema::open(&root.join("data/web-backend.sqlite"))?;
        self.schema = Some(schema);
        self.root = Some(root);
        self.lock = Some(lock);
        Ok(json!({"ok": true}))
    }

    pub(crate) fn close_internal(&mut self) -> PResult<()> {
        // Drop order matters: the connection closes before the lock releases.
        self.schema = None;
        self.lock = None;
        self.root = None;
        Ok(())
    }

    pub(crate) fn close(&mut self) -> PResult<Value> {
        self.close_internal()?;
        Ok(json!({"ok": true}))
    }

    pub(crate) fn backup(&self, params: &Value) -> PResult<Value> {
        let schema = self.schema.as_ref().ok_or_else(not_open)?;
        let destination = params
            .get("destination")
            .and_then(|value| value.as_str())
            .ok_or_else(|| p("WEB_BACKEND_INVALID_PARAMS", "缺少 destination。"))?;
        schema.consistency_backup(&PathBuf::from(destination))?;
        Ok(json!({"ok": true}))
    }

    pub(crate) fn transact(&mut self, params: &Value) -> PResult<Value> {
        let ops = op_list(params)?;
        let schema = self.schema.as_mut().ok_or_else(not_open)?;
        let conn = schema.conn_mut();
        let tx = conn.transaction()?;
        let mut results = Vec::with_capacity(ops.len());
        for op in &ops {
            validate_write(&op.sql)?;
            let expected = match &op.expect_changes {
                None => None,
                Some(value) => {
                    let expected = value.as_i64().ok_or_else(|| {
                        p(
                            "WEB_BACKEND_INVALID_PARAMS",
                            "expectChanges 必须是非负整数。",
                        )
                    })?;
                    if expected < 0 {
                        return Err(p(
                            "WEB_BACKEND_INVALID_PARAMS",
                            "expectChanges 必须是非负整数。",
                        ));
                    }
                    Some(expected as u64)
                }
            };
            let params = json_params(&op.params)?;
            let mut stmt = tx.prepare(&op.sql)?;
            let column_count = stmt.column_count();
            let mut rows = stmt.query(rusqlite::params_from_iter(params.iter()))?;
            let mut collected = Vec::new();
            while let Some(row) = rows.next()? {
                let mut values = Vec::with_capacity(column_count);
                for index in 0..column_count {
                    values.push(value_to_json(row.get_ref(index)?));
                }
                collected.push(Value::Array(values));
            }
            let changes = tx.changes();
            // Pre-commit assertion: a conditional write that matched the wrong
            // number of rows aborts the whole transaction before COMMIT.
            if let Some(expected) = expected {
                if changes != expected {
                    return Err(p("WEB_BACKEND_CONDITION_FAILED", "条件更新未匹配。"));
                }
            }
            results.push(json!({"rows": collected, "changes": changes}));
        }
        tx.commit()?;
        Ok(json!({"results": results}))
    }

    pub(crate) fn query(&self, params: &Value) -> PResult<Value> {
        let sql = params
            .get("sql")
            .and_then(|value| value.as_str())
            .ok_or_else(|| p("WEB_BACKEND_INVALID_PARAMS", "缺少 sql。"))?;
        validate_read(sql)?;
        let params = json_params(&params.get("params").cloned().unwrap_or(json!([])))?;
        let schema = self.schema.as_ref().ok_or_else(not_open)?;
        let mut stmt = schema.conn().prepare(sql)?;
        let column_count = stmt.column_count();
        let mut rows = stmt.query(rusqlite::params_from_iter(params.iter()))?;
        let mut collected = Vec::new();
        while let Some(row) = rows.next()? {
            let mut values = Vec::with_capacity(column_count);
            for index in 0..column_count {
                values.push(value_to_json(row.get_ref(index)?));
            }
            collected.push(Value::Array(values));
        }
        Ok(json!({"rows": collected}))
    }

    pub(crate) fn pragma(&self, params: &Value) -> PResult<Value> {
        let name = params
            .get("name")
            .and_then(|value| value.as_str())
            .ok_or_else(|| p("WEB_BACKEND_INVALID_PARAMS", "缺少 name。"))?;
        let normalized = name.trim().to_lowercase();
        if !READONLY_PRAGMAS.contains(&normalized.as_str()) {
            return Err(p("WEB_BACKEND_PRAGMA_DENIED", "仅允许只读 PRAGMA 事实。"));
        }
        let schema = self.schema.as_ref().ok_or_else(not_open)?;
        let value = match normalized.as_str() {
            "journal_mode" => {
                let value: String = schema
                    .conn()
                    .query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
                json!(value)
            }
            "user_version" => pragma_int(schema.conn(), "user_version")?,
            "application_id" => pragma_int(schema.conn(), "application_id")?,
            "foreign_keys" => pragma_int(schema.conn(), "foreign_keys")?,
            "busy_timeout" => pragma_int(schema.conn(), "busy_timeout")?,
            "quick_check" => {
                let value: String = schema
                    .conn()
                    .query_row("PRAGMA quick_check", [], |row| row.get(0))?;
                json!(value)
            }
            _ => unreachable!(),
        };
        Ok(json!({"value": value}))
    }
}

fn pragma_int(conn: &Connection, name: &str) -> PResult<Value> {
    let value = conn.pragma_query_value(None, name, |row| row.get::<_, i64>(0))?;
    Ok(json!(value))
}

fn not_open() -> ProtocolError {
    p("WEB_BACKEND_NOT_OPEN", "数据库尚未打开。")
}

fn root_arg(params: &Value) -> PResult<PathBuf> {
    let raw = params
        .get("root")
        .and_then(|value| value.as_str())
        .ok_or_else(|| p("WEB_BACKEND_INVALID_PARAMS", "缺少 root。"))?;
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(p("WEB_BACKEND_INVALID_ROOT", "工作目录必须是绝对路径。"));
    }
    Ok(path)
}

fn op_list(params: &Value) -> PResult<Vec<Op>> {
    let array = params
        .get("ops")
        .and_then(|value| value.as_array())
        .ok_or_else(|| p("WEB_BACKEND_INVALID_PARAMS", "缺少 ops 数组。"))?;
    array
        .iter()
        .map(|value| {
            serde_json::from_value::<Op>(value.clone())
                .map_err(|error| p("WEB_BACKEND_INVALID_PARAMS", format!("非法操作：{error}")))
        })
        .collect()
}

fn json_params(value: &Value) -> PResult<Vec<rusqlite::types::Value>> {
    let array = value
        .as_array()
        .ok_or_else(|| p("WEB_BACKEND_INVALID_PARAMS", "params 必须是数组。"))?;
    array.iter().map(json_value).collect()
}

fn json_value(value: &Value) -> PResult<rusqlite::types::Value> {
    use rusqlite::types::Value as SqlValue;
    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(if *value { 1 } else { 0 })),
        Value::Number(number) => {
            if let Some(value) = number.as_i64() {
                Ok(SqlValue::Integer(value))
            } else if let Some(value) = number.as_u64() {
                Ok(SqlValue::Integer(value as i64))
            } else if let Some(value) = number.as_f64() {
                Ok(SqlValue::Real(value))
            } else {
                Err(p("WEB_BACKEND_INVALID_PARAMS", "不支持的数值参数。"))
            }
        }
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        _ => Err(p(
            "WEB_BACKEND_INVALID_PARAMS",
            "参数只能是 null、布尔、数字或字符串。",
        )),
    }
}

fn value_to_json(value: rusqlite::types::ValueRef<'_>) -> Value {
    use rusqlite::types::ValueRef;
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) => json!(value),
        ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
        ValueRef::Blob(value) => json!(value),
    }
}

fn acquire_root_lock(root: &Path) -> PResult<File> {
    let marker = root.join(ROOT_LOCK_FILE);
    let metadata = match fs::symlink_metadata(&marker) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.nlink() == 1 =>
        {
            Some(metadata)
        }
        Ok(_) => return Err(p("WEB_BACKEND_INVALID_ROOT", "根锁文件无效。")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(ProtocolError::from(error)),
    };
    let mut options = OpenOptions::new();
    options.read(true).write(true).mode(0o600);
    if metadata.is_none() {
        options.create_new(true);
    }
    let file = options.open(&marker)?;
    let opened = file.metadata()?;
    let current = fs::symlink_metadata(&marker)?;
    if !current.is_file()
        || current.file_type().is_symlink()
        || current.nlink() != 1
        || opened.nlink() != 1
        || opened.dev() != current.dev()
        || opened.ino() != current.ino()
    {
        return Err(p("WEB_BACKEND_INVALID_ROOT", "根锁文件无效。"));
    }
    file.try_lock().map_err(|_| {
        p(
            "WEB_BACKEND_ROOT_IN_USE",
            "已有后端实例正在使用此工作目录，未取得根锁。",
        )
    })?;
    Ok(file)
}

/// Mask comments and string-literal contents so keyword checks cannot be
/// spoofed by values. Quoted regions collapse to spaces; identifiers outside
/// them are preserved.
fn mask_sql(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '-' if chars.peek() == Some(&'-') => {
                for character in chars.by_ref() {
                    if character == '\n' {
                        out.push('\n');
                        break;
                    }
                }
                out.push(' ');
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for character in chars.by_ref() {
                    if previous == '*' && character == '/' {
                        break;
                    }
                    previous = character;
                }
                out.push(' ');
            }
            '\'' | '"' | '`' => {
                let quote = character;
                while let Some(character) = chars.next() {
                    if character == quote {
                        if chars.peek() == Some(&quote) {
                            chars.next();
                            continue;
                        }
                        break;
                    }
                }
                out.push(' ');
            }
            _ => out.push(character),
        }
    }
    out
}

fn first_keyword(upper: &str) -> Option<String> {
    upper
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .find(|token| !token.is_empty())
        .map(|token| token.to_string())
}

fn contains_keyword(upper: &str, keyword: &str) -> bool {
    let bytes = upper.as_bytes();
    let keyword_bytes = keyword.as_bytes();
    let mut start = 0;
    while let Some(position) = upper[start..].find(keyword) {
        let absolute = start + position;
        let before_ok = absolute == 0
            || (!bytes[absolute - 1].is_ascii_alphanumeric() && bytes[absolute - 1] != b'_');
        let after = absolute + keyword_bytes.len();
        let after_ok =
            after >= bytes.len() || (!bytes[after].is_ascii_alphanumeric() && bytes[after] != b'_');
        if before_ok && after_ok {
            return true;
        }
        start = absolute + keyword_bytes.len();
    }
    false
}

fn reject_multiple_statements(masked: &str) -> PResult<()> {
    let trimmed = masked.trim_end();
    if let Some(index) = trimmed.find(';') {
        if !trimmed[index + 1..].trim().is_empty() {
            return Err(p("WEB_BACKEND_SQL_DENIED", "不允许一次执行多条语句。"));
        }
    }
    Ok(())
}

/// The table a DML statement actually writes, taken from its leading clause.
/// Quoted or schema-qualified targets are unsupported and yield `None`; a name
/// mentioned only inside a subquery/EXISTS never reaches here, so it cannot
/// grant write permission.
fn write_target(upper: &str) -> Option<String> {
    let words: Vec<&str> = upper.split_whitespace().collect();
    let first = words.first().copied()?;
    let target = match first {
        "INSERT" | "REPLACE" => {
            let into = words.iter().position(|word| *word == "INTO")?;
            words.get(into + 1).copied()?
        }
        "UPDATE" => words.get(1).copied()?,
        "DELETE" => {
            let from = words.iter().position(|word| *word == "FROM")?;
            words.get(from + 1).copied()?
        }
        _ => return None,
    };
    let target = target.split('(').next().unwrap_or(target);
    if target.starts_with('"')
        || target.starts_with('`')
        || target.starts_with('[')
        || target.contains('.')
    {
        return None;
    }
    Some(target.to_lowercase())
}

fn validate_write(sql: &str) -> PResult<()> {
    let masked = mask_sql(sql);
    reject_multiple_statements(&masked)?;
    let upper = masked.to_uppercase();
    let first = first_keyword(&upper).ok_or_else(|| p("WEB_BACKEND_SQL_DENIED", "空语句。"))?;
    if !matches!(first.as_str(), "INSERT" | "UPDATE" | "DELETE" | "REPLACE") {
        return Err(p(
            "WEB_BACKEND_SQL_DENIED",
            "transact 仅接受参数化 INSERT/UPDATE/DELETE/REPLACE。",
        ));
    }
    for keyword in FORBIDDEN_WRITE_KEYWORDS {
        if contains_keyword(&upper, keyword) {
            return Err(p(
                "WEB_BACKEND_SQL_DENIED",
                format!("transact 语句包含禁止的关键字：{keyword}"),
            ));
        }
    }
    // Dispatch on the real write target, never on a name that merely appears
    // somewhere in the statement (subqueries/EXISTS included).
    let target =
        write_target(&upper).ok_or_else(|| p("WEB_BACKEND_SQL_DENIED", "无法识别写目标。"))?;
    if target == "settings" {
        return validate_settings_write(sql);
    }
    if BUSINESS_TABLES.contains(&target.as_str()) {
        return Ok(());
    }
    Err(p(
        "WEB_BACKEND_SQL_DENIED",
        "transact 语句必须针对已登记的业务表或 settings。",
    ))
}

/// The exact production settings statements. `application-settings-service.mjs`
/// only ever sends the `application.timeZone` pair; the task-service sends the
/// `agentConcurrency` pair. No other settings write is accepted.
const SETTINGS_INSERT: &str =
    "INSERT INTO settings(key,value,version)VALUES('application.timeZone',?,1)";
const SETTINGS_UPDATE: &str =
    "UPDATE settings SET value=?,version=version+1 WHERE key='application.timeZone' AND version=?";
const SETTINGS_AGENT_CONCURRENCY_INSERT: &str =
    "INSERT INTO settings(key,value,version)VALUES('agentConcurrency',?,1)";
const SETTINGS_AGENT_CONCURRENCY_UPDATE: &str =
    "UPDATE settings SET value=?,version=version+1 WHERE key='agentConcurrency' AND version=?";

fn settings_drops_space(out: &str) -> bool {
    out.ends_with('(') || out.ends_with(')') || out.ends_with(',') || out.ends_with('=')
}

/// Canonical form for exact-template comparison: strip comments, keep string
/// literals verbatim (the key's case/whitespace is significant), collapse
/// whitespace, and drop spaces around `(`, `)`, `,`, `=`.
fn normalize_settings_sql(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    let mut pending_space = false;
    while let Some(character) = chars.next() {
        match character {
            '-' if chars.peek() == Some(&'-') => {
                for character in chars.by_ref() {
                    if character == '\n' {
                        break;
                    }
                }
                pending_space = true;
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for character in chars.by_ref() {
                    if previous == '*' && character == '/' {
                        break;
                    }
                    previous = character;
                }
                pending_space = true;
            }
            '\'' => {
                if pending_space && !out.is_empty() && !settings_drops_space(&out) {
                    out.push(' ');
                }
                pending_space = false;
                out.push('\'');
                while let Some(character) = chars.next() {
                    out.push(character);
                    if character == '\'' {
                        if chars.peek() == Some(&'\'') {
                            out.push(chars.next().unwrap());
                            continue;
                        }
                        break;
                    }
                }
            }
            character if character.is_whitespace() => pending_space = true,
            '(' | ')' | ',' | '=' => {
                if out.ends_with(' ') {
                    out.pop();
                }
                out.push(character);
                pending_space = false;
            }
            _ => {
                if pending_space && !out.is_empty() && !settings_drops_space(&out) {
                    out.push(' ');
                }
                pending_space = false;
                out.push(character);
            }
        }
    }
    out
}

/// The only settings writes this slice allows: the two exact production
/// templates, byte-for-byte after whitespace/comment normalization. This closes
/// the MINOR-2 gaps (INSERT…SELECT, multi-row VALUES, OR-widened predicates,
/// a rewritten key, or the literal appearing anywhere but the key position).
fn validate_settings_write(raw: &str) -> PResult<()> {
    let normalized = normalize_settings_sql(raw);
    if normalized == SETTINGS_INSERT
        || normalized == SETTINGS_UPDATE
        || normalized == SETTINGS_AGENT_CONCURRENCY_INSERT
        || normalized == SETTINGS_AGENT_CONCURRENCY_UPDATE
    {
        return Ok(());
    }
    Err(p("WEB_BACKEND_SQL_DENIED", "settings 写入形状非法。"))
}

fn validate_read(sql: &str) -> PResult<()> {
    let masked = mask_sql(sql);
    reject_multiple_statements(&masked)?;
    let upper = masked.to_uppercase();
    let first = first_keyword(&upper).ok_or_else(|| p("WEB_BACKEND_SQL_DENIED", "空语句。"))?;
    if first != "SELECT" {
        return Err(p("WEB_BACKEND_SQL_DENIED", "query 仅接受只读 SELECT。"));
    }
    for keyword in FORBIDDEN_READ_KEYWORDS {
        if contains_keyword(&upper, keyword) {
            return Err(p(
                "WEB_BACKEND_SQL_DENIED",
                format!("query 语句包含禁止的关键字：{keyword}"),
            ));
        }
    }
    Ok(())
}

pub(crate) fn dispatch(store: &mut WebBackendStore, request: &Request) -> Response {
    let id = request.id.clone();
    let outcome = match request.command.as_str() {
        "init" => store.init(&request.params),
        "open" => store.open(&request.params),
        "close" => store.close(),
        "backup" => store.backup(&request.params),
        "transact" => store.transact(&request.params),
        "query" => store.query(&request.params),
        "pragma" => store.pragma(&request.params),
        other => Err(p(
            "WEB_BACKEND_UNKNOWN_COMMAND",
            format!("未知命令：{other}"),
        )),
    };
    match outcome {
        Ok(result) => Response {
            id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => Response {
            id,
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code: error.code,
                message: error.message,
            }),
        },
    }
}

/// Run the stdio protocol loop. Returns the process exit code: 0 on a clean
/// stdin-EOF shutdown, 1 when stdout cannot be written.
pub fn run_stdio() -> i32 {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let mut store = WebBackendStore::new();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => dispatch(&mut store, &request),
            Err(error) => Response {
                id: Value::Null,
                ok: false,
                result: None,
                error: Some(ErrorBody {
                    code: "WEB_BACKEND_INVALID_REQUEST".to_string(),
                    message: format!("无法解析请求：{error}"),
                }),
            },
        };
        let encoded = serde_json::to_string(&response).unwrap_or_else(|_| {
            "{\"id\":null,\"ok\":false,\"error\":{\"code\":\"WEB_BACKEND_ENCODE_ERROR\",\"message\":\"响应编码失败。\"}}".to_string()
        });
        if writeln!(out, "{encoded}").is_err() {
            break;
        }
        let _ = out.flush();
    }
    // stdin EOF: closing the store drops the connection before the lock.
    let _ = store.close();
    0
}
