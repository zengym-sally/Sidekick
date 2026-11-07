//! CLI for the isolated storage-adapter probe harness. Every command prints a
//! single JSON object as its last stdout line and exits 0 only when the
//! observed outcome matches the expectation the Node runner asserts.

mod adapter;

use adapter::{default_open_creates, Code, Error, Fault, StorageAdapter, REQUIRED_DIRS};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::{SystemTime, UNIX_EPOCH};

fn fail(message: impl Into<String>) -> ! {
    eprintln!("probe error: {}", message.into());
    exit(2);
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn require_arg(args: &[String], name: &str) -> String {
    arg_value(args, name).unwrap_or_else(|| fail(format!("missing {name}")))
}

fn emit(value: Value) {
    println!("{value}");
    let _ = std::io::stdout().flush();
}

fn error_json(command: &str, error: &Error) -> Value {
    json!({"command": command, "ok": false, "code": error.code.as_str(), "message": error.message})
}

fn root_arg(args: &[String]) -> PathBuf {
    PathBuf::from(require_arg(args, "--root"))
}

/// Create a valid synthetic root: marker, config, private directories and an
/// initialized database (application_id set, user_version 1, two rows).
fn seed(root: &Path) -> Value {
    let result = (|| -> std::result::Result<Value, Error> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(root)
            .map_err(adapter::io_error)?;
        for name in REQUIRED_DIRS {
            fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(root.join(name))
                .map_err(adapter::io_error)?;
        }
        let marker = root.join(adapter::ROOT_MARKER);
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&marker)
            .map_err(adapter::io_error)?
            .write_all(adapter::MAGIC)
            .map_err(adapter::io_error)?;
        fs::write(
            root.join("config/app.json"),
            r#"{"app":"sidekick","version":1,"state":"ready","timeZone":"Asia/Shanghai"}"#,
        )
        .map_err(adapter::io_error)?;
        let path = root.join("data/sidekick.sqlite");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(adapter::io_error)?;
        let db = Connection::open(&path).map_err(|_| Error::new(Code::Io, "种子库打开失败"))?;
        db.pragma_update(None, "application_id", adapter::APPLICATION_ID)
            .map_err(|_| Error::new(Code::Io, "application_id 写入失败"))?;
        db.pragma_update(None, "user_version", 1)
            .map_err(|_| Error::new(Code::Io, "user_version 写入失败"))?;
        db.execute_batch(
            "CREATE TABLE probe_items(id TEXT PRIMARY KEY, status TEXT NOT NULL);\
             INSERT INTO probe_items VALUES('seed-a','pending'),('seed-b','pending');",
        )
        .map_err(|_| Error::new(Code::Io, "种子表创建失败"))?;
        drop(db);
        Ok(json!({"command":"seed","ok":true,"root":root}))
    })();
    match result {
        Ok(value) => value,
        Err(error) => error_json("seed", &error),
    }
}

/// Explicit creation flow for a new workspace root: the only path that may
/// create the marker, the private directories and the database. Ordinary open
/// (`StorageAdapter::open` with `allow_init=false`) never creates anything.
fn init(args: &[String]) -> Value {
    let root = root_arg(args);
    let before = json!({
        "marker": fs::symlink_metadata(root.join(adapter::ROOT_MARKER)).is_ok(),
        "dirs": REQUIRED_DIRS
            .iter()
            .map(|name| root.join(name).exists())
            .collect::<Vec<_>>(),
        "database": root.join("data/sidekick.sqlite").exists(),
    });
    match StorageAdapter::open(&root, true, Fault::None) {
        Ok(adapter) => {
            drop(adapter);
            json!({
                "command": "init",
                "ok": true,
                "root": root,
                "before": before,
                "marker": adapter::ROOT_MARKER,
                "dirs": REQUIRED_DIRS,
                "database": "data/sidekick.sqlite",
            })
        }
        Err(error) => error_json("init", &error),
    }
}

fn open_check(args: &[String]) -> Value {
    let root = root_arg(args);
    let fault = match arg_value(args, "--fault").as_deref() {
        Some("swap-db") => Fault::SwapDatabase,
        Some("replace-marker") => Fault::ReplaceMarker,
        Some("replace-wal") => Fault::ReplaceWal,
        Some("replace-shm") => Fault::ReplaceShm,
        Some("degrade-runs") => Fault::DegradeRuns,
        Some("degrade-marker") => Fault::DegradeMarker,
        _ => Fault::None,
    };
    let outcome = (|| -> std::result::Result<Value, Error> {
        let adapter = StorageAdapter::open(&root, false, fault)?;
        let facts = json!({
            "journalMode": adapter.pragma("journal_mode")?,
            "busyTimeoutMs": adapter.pragma_int("busy_timeout")?,
            "synchronous": adapter.pragma_int("synchronous")?,
            "foreignKeys": adapter.pragma_int("foreign_keys")?,
            "sqliteVersion": adapter.sqlite_version()?,
            "userVersion": adapter.pragma_int("user_version")?,
        });
        // The lock must be held for the whole adapter lifetime: a second open of
        // the same root from this process must fail with ROOT_IN_USE.
        let second = StorageAdapter::open(&root, false, Fault::None).err();
        let root_in_use = second.as_ref().map(|error| error.code) == Some(Code::RootInUse);
        if fault != Fault::None {
            // First use after the fault must stop storage; the second use must
            // stay stopped instead of silently resuming.
            let first = adapter.count("probe_items").err();
            let second_use = adapter.count("probe_items").err();
            let stopped = second_use.as_ref().map(|error| error.code) == Some(Code::StorageStopped);
            return Ok(json!({
                "command": "open-check",
                "ok": true,
                "root": root,
                "facts": facts,
                "secondOpenRootInUse": root_in_use,
                "fault": fault.name(),
                "faultFirstUse": first.as_ref().map(|error| error.code.as_str()),
                "faultSecondUseStopped": stopped,
            }));
        }
        let before = adapter.count("probe_items")?;
        adapter.short_write("INSERT INTO probe_items VALUES('probe-short-tx','pending')")?;
        let count_after = adapter.count("probe_items")?;
        drop(adapter);
        // After the adapter drops, the root lock is released and the root opens
        // again; the connection and the lock share one lifetime.
        let reopened = StorageAdapter::open(&root, false, Fault::None).is_ok();
        Ok(json!({
            "command": "open-check",
            "ok": true,
            "root": root,
            "facts": facts,
            "secondOpenRootInUse": root_in_use,
            "countBefore": before,
            "countAfterShortWrite": count_after,
            "reopenAfterDrop": reopened,
        }))
    })();
    match outcome {
        Ok(value) => value,
        Err(error) => error_json("open-check", &error),
    }
}

fn open_reject(args: &[String]) -> Value {
    let root = root_arg(args);
    let expect = require_arg(args, "--expect");
    let outcome = StorageAdapter::open(&root, false, Fault::None);
    let ok = match &outcome {
        Err(error) => error.code.as_str() == expect,
        Ok(_) => false,
    };
    let mut value = match outcome {
        Ok(_adapter) => json!({"command":"open-reject","ok":ok,"root":root,"unexpected":"opened"}),
        Err(error) => {
            json!({"command":"open-reject","ok":ok,"root":root,"code":error.code.as_str(),"message":error.message})
        }
    };
    if !ok {
        value["ok"] = Value::Bool(false);
    }
    value["expect"] = Value::String(expect);
    value
}

/// WAL / short-transaction sequence against a second read-only connection.
fn wal_check(args: &[String]) -> Value {
    let root = root_arg(args);
    let outcome = (|| -> std::result::Result<Value, Error> {
        let adapter = StorageAdapter::open(&root, false, Fault::None)?;
        let before = adapter.count("probe_items")?;
        adapter.short_write("INSERT INTO probe_items VALUES('wal-committed','pending')")?;
        let after_commit = adapter.count("probe_items")?;
        let wal_after_write = adapter.wal_present();
        // A second read-only connection may read while the adapter holds the
        // root lock: WAL readers do not block on the writer.
        let reader = Connection::open_with_flags(
            root.join("data/sidekick.sqlite"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )
        .map_err(|_| Error::new(Code::Io, "只读连接打开失败"))?;
        let reader_count: i64 = reader
            .query_row("SELECT count(*) FROM probe_items", [], |row| row.get(0))
            .map_err(|_| Error::new(Code::Io, "只读计数失败"))?;
        // An uncommitted write is invisible to the reader.
        let transaction = adapter
            .begin_write()
            .map_err(|_| Error::new(Code::Io, "事务创建失败"))?;
        transaction
            .execute(
                "INSERT INTO probe_items VALUES('wal-uncommitted','pending')",
                [],
            )
            .map_err(|_| Error::new(Code::Io, "事务写入失败"))?;
        let reader_during: i64 = reader
            .query_row("SELECT count(*) FROM probe_items", [], |row| row.get(0))
            .map_err(|_| Error::new(Code::Io, "只读计数失败"))?;
        drop(transaction);
        // A failing statement rolls the whole transaction back.
        let rolled = adapter
            .begin_write()
            .map_err(|_| Error::new(Code::Io, "事务创建失败"))?;
        let _ = rolled.execute(
            "INSERT INTO probe_items VALUES('wal-rollback','pending')",
            [],
        );
        let failed = rolled
            .execute("INSERT INTO missing_table VALUES(1)", [])
            .is_err();
        drop(rolled);
        let after_rollback = adapter.count("probe_items")?;
        drop(reader);
        drop(adapter);
        // The last connection closing checkpoints and removes the WAL file.
        let wal_after_close = root.join("data/sidekick.sqlite-wal").exists();
        Ok(json!({
            "command": "wal-check",
            "ok": true,
            "root": root,
            "before": before,
            "afterCommit": after_commit,
            "walAfterWrite": wal_after_write,
            "readerCount": reader_count,
            "readerDuringUncommitted": reader_during,
            "rollbackFailedStatement": failed,
            "afterRollback": after_rollback,
            "walAfterClose": wal_after_close,
        }))
    })();
    match outcome {
        Ok(value) => value,
        Err(error) => error_json("wal-check", &error),
    }
}

/// Open the root like a worker, record the worker PID for the scheduler, then
/// hold until stdin reaches EOF (the runner kills the process for the crash
/// cases). `--write-tx` leaves one uncommitted row behind when killed. The
/// adapter must stay alive for the whole hold: it owns the root lock.
fn hold(args: &[String]) -> Value {
    let root = root_arg(args);
    let worker_file = arg_value(args, "--worker-file").map(PathBuf::from);
    let write_tx = args.iter().any(|arg| arg == "--write-tx");
    let adapter = match StorageAdapter::open(&root, false, Fault::None) {
        Ok(adapter) => adapter,
        Err(error) => {
            emit(error_json("hold", &error));
            exit(1);
        }
    };
    if let Err(error) =
        adapter.short_write("INSERT INTO probe_items VALUES('worker-committed','pending')")
    {
        emit(error_json("hold", &error));
        exit(1);
    }
    if write_tx {
        let transaction = match adapter.begin_write() {
            Ok(transaction) => transaction,
            Err(error) => {
                emit(error_json("hold", &error));
                exit(1);
            }
        };
        if let Err(error) = transaction.execute(
            "INSERT INTO probe_items VALUES('worker-uncommitted','pending')",
            [],
        ) {
            emit(error_json("hold", &Error::new(Code::Io, error.to_string())));
            exit(1);
        }
        // Keep the uncommitted transaction open: if the runner kills this
        // process, the WAL frame must be ignored on the next open.
        std::mem::forget(transaction);
    }
    if let Some(path) = &worker_file {
        if let Some(parent) = path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                emit(error_json("hold", &adapter::io_error(error)));
                exit(1);
            }
        }
        let payload = format!(
            "{{\"pid\":{},\"startedAtMs\":{}}}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|span| span.as_millis())
                .unwrap_or(0)
        );
        // The scheduler re-reads this record and only trusts a private,
        // single-hard-link 0600 file: a loose record is not verifiable.
        if let Err(error) = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .and_then(|mut file| file.write_all(payload.as_bytes()))
        {
            emit(error_json("hold", &adapter::io_error(error)));
            exit(1);
        }
    }
    emit(json!({"ready": true, "pid": std::process::id(), "root": root}));
    let mut buffer = [0u8; 512];
    let _ = std::io::stdin().read(&mut buffer);
    // stdin EOF models a graceful worker exit: run the adapter destructor so
    // the connection closes and the root lock is released through the normal
    // path. The crash cases never get here: the runner SIGKILLs, and the kernel
    // releases the lock instead.
    drop(adapter);
    exit(0);
}

/// `O_NONBLOCK` for the controlled record open, so a special file swapped in
/// between lstat and open cannot block the probe. Kept local to avoid adding a
/// direct `libc` dependency to the harness.
#[cfg(target_os = "macos")]
const O_NONBLOCK: i32 = 0x0004;
#[cfg(target_os = "linux")]
const O_NONBLOCK: i32 = 0o4000;

/// Identity/version of the worker record file at the moment it was read. It is
/// compared again before the admission decision is published, so a record that
/// changed after the read (replacement, permission change, in-place edit) can
/// never be used to grant admission.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct RecordIdentity {
    dev: u64,
    ino: u64,
    mode: u32,
    nlink: u64,
    mtime_sec: i64,
    mtime_nsec: i64,
    size: u64,
}

impl RecordIdentity {
    fn from_metadata(metadata: &fs::Metadata) -> Option<Self> {
        Some(Self {
            dev: metadata.dev(),
            ino: metadata.ino(),
            mode: metadata.mode() & 0o7777,
            nlink: metadata.nlink(),
            mtime_sec: metadata.mtime(),
            mtime_nsec: metadata.mtime_nsec(),
            size: metadata.size(),
        })
    }
}

/// The record path plus the identity captured when it was read.
struct RecordSnapshot {
    path: PathBuf,
    identity: RecordIdentity,
}

/// Outcome of reading the recorded worker file. A missing record means "no
/// history"; a record that exists but cannot be verified (unreadable, corrupt,
/// or wrong identity/permissions) must pause scheduling — the design requires
/// "unverifiable ⇒ pause", not "unverifiable ⇒ assume stopped".
enum WorkerRecord {
    Absent,
    Verified {
        pid: i64,
        snapshot: RecordSnapshot,
    },
    Unverified {
        reason: String,
        snapshot: Option<RecordSnapshot>,
    },
}

fn read_worker_record(path: &Path) -> WorkerRecord {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return WorkerRecord::Absent,
        Err(error) => {
            return WorkerRecord::Unverified {
                reason: format!("记录读取失败：{error}"),
                snapshot: None,
            }
        }
    };
    let identity = match RecordIdentity::from_metadata(&metadata) {
        Some(identity)
            if identity.nlink == 1
                && identity.mode == 0o600
                && metadata.is_file()
                && !metadata.file_type().is_symlink() =>
        {
            identity
        }
        _ => return WorkerRecord::Unverified {
            reason:
                "记录文件身份不符：必须是单一硬链、权限 0600 的普通文件，不能是符号链接或特殊文件。"
                    .into(),
            snapshot: None,
        },
    };
    // Controlled open: O_NONBLOCK so a special file swapped in between lstat
    // and open cannot block the probe; the handle identity is checked against
    // the lstat result, so a replacement between lstat and open is caught.
    let mut handle = match OpenOptions::new()
        .read(true)
        .custom_flags(O_NONBLOCK)
        .open(path)
    {
        Ok(handle) => handle,
        Err(error) => {
            return WorkerRecord::Unverified {
                reason: format!("记录打开失败：{error}"),
                snapshot: None,
            }
        }
    };
    let opened = match handle.metadata() {
        Ok(metadata) => metadata,
        Err(error) => {
            return WorkerRecord::Unverified {
                reason: format!("记录句柄核对失败：{error}"),
                snapshot: None,
            }
        }
    };
    if !opened.is_file() || opened.file_type().is_symlink() {
        return WorkerRecord::Unverified {
            reason: "记录在读取期间被替换为特殊文件或符号链接。".into(),
            snapshot: None,
        };
    }
    if RecordIdentity::from_metadata(&opened) != Some(identity) {
        return WorkerRecord::Unverified {
            reason: "记录在读取期间被替换。".into(),
            snapshot: None,
        };
    }
    let snapshot = RecordSnapshot {
        path: path.to_path_buf(),
        identity,
    };
    let mut text = String::new();
    if let Err(error) = handle.read_to_string(&mut text) {
        return WorkerRecord::Unverified {
            reason: format!("记录读取失败：{error}"),
            snapshot: Some(snapshot),
        };
    }
    let parsed: Value = match serde_json::from_str(&text) {
        Ok(parsed) => parsed,
        Err(error) => {
            return WorkerRecord::Unverified {
                reason: format!("记录不是合法 JSON：{error}"),
                snapshot: Some(snapshot),
            }
        }
    };
    match parsed.get("pid").and_then(Value::as_i64) {
        Some(pid) if pid > 0 => WorkerRecord::Verified { pid, snapshot },
        _ => WorkerRecord::Unverified {
            reason: "记录缺少有效的 pid 字段。".into(),
            snapshot: Some(snapshot),
        },
    }
}

/// Re-verify the record's identity/version immediately before publishing the
/// admission decision. A record that changed since it was read pauses
/// scheduling instead of relying on the stale observation.
fn recheck_worker_record(record: &WorkerRecord) -> Option<String> {
    let snapshot = match record {
        WorkerRecord::Verified { snapshot, .. } => snapshot,
        WorkerRecord::Unverified {
            snapshot: Some(snapshot),
            ..
        } => snapshot,
        WorkerRecord::Absent | WorkerRecord::Unverified { snapshot: None, .. } => return None,
    };
    // Distinguish "confirmed unchanged" from "could not re-check": a record
    // that disappeared or cannot be stat'd must pause scheduling, not inherit
    // the stale classification.
    let metadata = match fs::symlink_metadata(&snapshot.path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Some("记录在准入前被删除，无法确认其仍为已核实的记录。".into());
        }
        Err(error) => {
            return Some(format!("记录在准入前无法复查：{error}"));
        }
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Some("记录在准入前被替换为特殊文件或符号链接。".into());
    }
    let current = RecordIdentity::from_metadata(&metadata)?;
    if current != snapshot.identity {
        return Some(format!(
            "记录在准入前被替换或版本变化（读取时 mode={:04o} ino={} mtime={}.{:09}，当前 mode={:04o} ino={} mtime={}.{:09}）。",
            snapshot.identity.mode,
            snapshot.identity.ino,
            snapshot.identity.mtime_sec,
            snapshot.identity.mtime_nsec,
            current.mode,
            current.ino,
            current.mtime_sec,
            current.mtime_nsec,
        ));
    }
    None
}

/// Result of asking the OS whether the recorded PID is still alive. Only an
/// explicit "no such process" counts as exited; permission denial, an invalid
/// PID, or a failed probe command all leave the worker unverified.
enum WorkerLiveness {
    Alive,
    Exited,
    Unverified(String),
}

/// Probe the recorded worker PID with `kill -0`. The probe program can be
/// overridden with `SIDEKICK_PROBE_KILL` so the runner can drive synthetic
/// permission/spawn failures without touching a real process.
fn probe_worker(pid: i64) -> WorkerLiveness {
    if pid <= 0 || pid > i32::MAX as i64 {
        return WorkerLiveness::Unverified(format!(
            "pid {pid} 超出进程标识的有效范围（1..={}）",
            i32::MAX
        ));
    }
    let program = std::env::var_os("SIDEKICK_PROBE_KILL")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/bin/kill"));
    let output = match std::process::Command::new(&program)
        .arg("-0")
        .arg(pid.to_string())
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            return WorkerLiveness::Unverified(format!("进程探测命令启动失败：{error}"));
        }
    };
    if output.status.success() {
        return WorkerLiveness::Alive;
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    // EPERM means the process exists but this user may not signal it.
    if stderr.contains("Operation not permitted") {
        return WorkerLiveness::Alive;
    }
    if stderr.contains("No such process") {
        return WorkerLiveness::Exited;
    }
    let code = output
        .status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "terminated-by-signal".into());
    WorkerLiveness::Unverified(format!(
        "进程探测未确认状态：exit={code} stderr={}",
        stderr.trim()
    ))
}

/// Worker state used by the scheduler decision, combining record verification
/// with the liveness probe.
enum WorkerStatus {
    Absent,
    Alive { pid: i64 },
    Exited { pid: i64 },
    Unverified { reason: String },
}

fn classify_record(record: &WorkerRecord) -> WorkerStatus {
    match record {
        WorkerRecord::Absent => WorkerStatus::Absent,
        WorkerRecord::Verified { pid, .. } => match probe_worker(*pid) {
            WorkerLiveness::Alive => WorkerStatus::Alive { pid: *pid },
            WorkerLiveness::Exited => WorkerStatus::Exited { pid: *pid },
            WorkerLiveness::Unverified(reason) => WorkerStatus::Unverified { reason },
        },
        WorkerRecord::Unverified { reason, .. } => WorkerStatus::Unverified {
            reason: reason.clone(),
        },
    }
}

fn worker_json(status: &WorkerStatus) -> Value {
    match status {
        WorkerStatus::Absent => Value::Null,
        WorkerStatus::Alive { pid } => json!({"pid": pid, "alive": true}),
        WorkerStatus::Exited { pid } => json!({"pid": pid, "alive": false}),
        WorkerStatus::Unverified { reason } => json!({"state": "unverified", "reason": reason}),
    }
}

/// Scheduler-side admission. The full existing-root adapter and its lock are
/// acquired FIRST, so the worker record cannot be replaced by another
/// adapter-respecting writer between the check and the decision. The record is
/// then read through a controlled handle, its PID probed, and its
/// identity/version re-checked immediately before the decision is published.
/// Only a confirmed-exited worker may schedule.
fn try_schedule(args: &[String]) -> Value {
    let root = root_arg(args);
    let worker_path = root.join("runs/worker.json");
    let reject = |code: &str, note: &str, worker: Value| {
        json!({
            "command": "try-schedule",
            "ok": true,
            "root": root,
            "decision": "REJECT",
            "code": code,
            "worker": worker,
            "note": note,
        })
    };
    let adapter = match StorageAdapter::open(&root, false, Fault::None) {
        Ok(adapter) => adapter,
        Err(error) if error.code == Code::RootInUse => {
            // Diagnostic only: the decision is REJECT whatever the record says.
            let record = read_worker_record(&worker_path);
            let worker = worker_json(&classify_record(&record));
            return reject(
                "ROOT_IN_USE",
                "根锁被占用：旧 worker 未退或旧实例仍在，暂停调度。",
                worker,
            );
        }
        Err(error) => {
            let mut value = error_json("try-schedule", &error);
            value["ok"] = Value::Bool(true);
            value["decision"] = Value::String("REJECT".into());
            return value;
        }
    };
    // The lock is held: read and verify the current record.
    let record = read_worker_record(&worker_path);
    let mut status = classify_record(&record);
    // Re-check before publishing: a record that changed since the read pauses.
    if let Some(reason) = recheck_worker_record(&record) {
        status = WorkerStatus::Unverified { reason };
    }
    let worker = worker_json(&status);
    match status {
        WorkerStatus::Unverified { reason } => {
            drop(adapter);
            reject(
                Code::WorkerUnverified.as_str(),
                &format!("worker 记录无法核实（{reason}）：无法证明旧 worker 已停，暂停调度。"),
                worker,
            )
        }
        WorkerStatus::Alive { .. } => {
            drop(adapter);
            reject(
                "WORKER_ALIVE",
                "记录的 worker 进程仍可能存活：拿根锁不等于旧 worker 已停，暂停调度。",
                worker,
            )
        }
        WorkerStatus::Absent | WorkerStatus::Exited { .. } => {
            drop(adapter);
            json!({
                "command": "try-schedule",
                "ok": true,
                "root": root,
                "decision": "ACCEPT",
                "code": null,
                "worker": worker,
                "note": "已有根完整校验通过、根锁可获取、记录的 worker 进程已确认退出、数据库可读。",
            })
        }
    }
}

fn control_default_open(args: &[String]) -> Value {
    let path = PathBuf::from(require_arg(args, "--path"));
    match default_open_creates(&path) {
        Ok(created) => json!({"command": "control-default-open", "ok": true, "created": created}),
        Err(error) => error_json("control-default-open", &error),
    }
}

/// List the synthetic fixture rows so the runner can tell committed rows from
/// rows an interrupted transaction left behind.
fn rows(args: &[String]) -> Value {
    let root = root_arg(args);
    let outcome = (|| -> std::result::Result<Value, Error> {
        let adapter = StorageAdapter::open(&root, false, Fault::None)?;
        let ids = adapter.row_ids("probe_items")?;
        Ok(json!({"command": "rows", "ok": true, "root": root, "ids": ids}))
    })();
    match outcome {
        Ok(value) => value,
        Err(error) => error_json("rows", &error),
    }
}

/// Adjust pragmas on a seeded synthetic database to build negative fixtures.
fn mutate(args: &[String]) -> Value {
    let root = root_arg(args);
    let outcome = (|| -> std::result::Result<Value, Error> {
        let path = root.join("data/sidekick.sqlite");
        let db = Connection::open(&path).map_err(|_| Error::new(Code::Io, "数据库打开失败"))?;
        if let Some(value) = arg_value(args, "--application-id") {
            let id: i64 = value
                .parse()
                .map_err(|_| Error::new(Code::Io, "application-id 不是整数"))?;
            db.pragma_update(None, "application_id", id)
                .map_err(|_| Error::new(Code::Io, "application_id 写入失败"))?;
        }
        if let Some(value) = arg_value(args, "--user-version") {
            let version: i64 = value
                .parse()
                .map_err(|_| Error::new(Code::Io, "user-version 不是整数"))?;
            db.pragma_update(None, "user_version", version)
                .map_err(|_| Error::new(Code::Io, "user_version 写入失败"))?;
        }
        Ok(json!({"command": "mutate", "ok": true, "root": root}))
    })();
    match outcome {
        Ok(value) => value,
        Err(error) => error_json("mutate", &error),
    }
}

fn host_facts() -> Value {
    json!({
        "command": "host-facts",
        "ok": true,
        "targetOs": std::env::consts::OS,
        "targetArch": std::env::consts::ARCH,
        "sqliteVersion": Connection::open_in_memory()
            .and_then(|db| db.query_row("SELECT sqlite_version()", [], |row| row.get::<_, String>(0)))
            .unwrap_or_else(|_| "unknown".into()),
    })
}

#[cfg(target_os = "macos")]
fn keychain_facts() -> Value {
    use apple_native_keyring_store::keychain::Store;
    use keyring_core::api::CredentialStoreApi;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|span| span.as_nanos())
        .unwrap_or(0);
    let store = match Store::new() {
        Ok(store) => store,
        Err(_) => {
            return json!({"command":"keychain-facts","ok":false,"code":"KEYCHAIN_UNAVAILABLE","backend":"macOS login Keychain"})
        }
    };
    let service = format!("com.sidekick.probe.fixture.{nonce}");
    let entry = match store.build(&service, "synthetic-probe", None) {
        Ok(entry) => entry,
        Err(_) => {
            return json!({"command":"keychain-facts","ok":false,"code":"KEYCHAIN_ENTRY_FAILED","backend":"macOS login Keychain"})
        }
    };
    let missing_before = matches!(entry.get_password(), Err(keyring_core::Error::NoEntry));
    let written = entry.set_password("synthetic-probe-value").is_ok();
    let readback = entry.get_password().ok().as_deref() == Some("synthetic-probe-value");
    let removed = entry.delete_credential().is_ok();
    let missing_after = matches!(entry.get_password(), Err(keyring_core::Error::NoEntry));
    json!({
        "command": "keychain-facts",
        "ok": missing_before && written && readback && removed && missing_after,
        "backend": "macOS login Keychain",
        "syntheticOnly": true,
        "missingBefore": missing_before,
        "written": written,
        "readback": readback,
        "fixtureRemoved": removed,
        "missingAfter": missing_after,
    })
}

#[cfg(not(target_os = "macos"))]
fn keychain_facts() -> Value {
    json!({
        "command": "keychain-facts",
        "ok": true,
        "supported": false,
        "note": "当前 OS 无 macOS Keychain；Linux 默认环境引用，本探针不跨 OS 代签。",
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().cloned().unwrap_or_default();
    let rest = &args[1..];
    let value = match command.as_str() {
        "seed" => seed(&root_arg(rest)),
        "init" => init(rest),
        "open-check" => open_check(rest),
        "open-reject" => open_reject(rest),
        "wal-check" => wal_check(rest),
        "hold" => hold(rest),
        "rows" => rows(rest),
        "mutate" => mutate(rest),
        "try-schedule" => try_schedule(rest),
        "control-default-open" => control_default_open(rest),
        "host-facts" => host_facts(),
        "keychain-facts" => keychain_facts(),
        other => {
            eprintln!("unknown command: {other}");
            exit(2);
        }
    };
    let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
    emit(value);
    if !ok {
        exit(1);
    }
}
