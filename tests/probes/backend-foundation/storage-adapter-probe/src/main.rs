//! CLI for the isolated storage-adapter probe harness. Every command prints a
//! single JSON object as its last stdout line and exits 0 only when the
//! observed outcome matches the expectation the Node runner asserts.

mod adapter;

use adapter::{
    acquire_root_lock, default_open_creates, Code, Error, Fault, StorageAdapter,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::exit;
use std::time::{SystemTime, UNIX_EPOCH};

const PRIVATE_DIRS: [&str; 7] = ["config", "data", "runs", "skills", "mcp", "logs", "backups"];

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
        for name in PRIVATE_DIRS {
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

fn open_check(args: &[String]) -> Value {
    let root = root_arg(args);
    let fault = match arg_value(args, "--fault").as_deref() {
        Some("swap-db") => Fault::SwapDatabase,
        Some("replace-marker") => Fault::ReplaceMarker,
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
        if fault == Fault::ReplaceMarker {
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
                "fault": "replace-marker",
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
        Err(error) => json!({"command":"open-reject","ok":ok,"root":root,"code":error.code.as_str(),"message":error.message}),
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
            &root.join("data/sidekick.sqlite"),
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
            .execute("INSERT INTO probe_items VALUES('wal-uncommitted','pending')", [])
            .map_err(|_| Error::new(Code::Io, "事务写入失败"))?;
        let reader_during: i64 = reader
            .query_row("SELECT count(*) FROM probe_items", [], |row| row.get(0))
            .map_err(|_| Error::new(Code::Io, "只读计数失败"))?;
        drop(transaction);
        // A failing statement rolls the whole transaction back.
        let rolled = adapter
            .begin_write()
            .map_err(|_| Error::new(Code::Io, "事务创建失败"))?;
        let _ = rolled.execute("INSERT INTO probe_items VALUES('wal-rollback','pending')", []);
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
    if let Err(error) = adapter.short_write("INSERT INTO probe_items VALUES('worker-committed','pending')") {
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
        if let Err(error) = fs::write(path, payload) {
            emit(error_json("hold", &adapter::io_error(error)));
            exit(1);
        }
    }
    emit(json!({"ready": true, "pid": std::process::id(), "root": root}));
    let mut buffer = [0u8; 512];
    let _ = std::io::stdin().read(&mut buffer);
    // stdin EOF models a graceful worker exit; dropping the adapter releases
    // the root lock. The crash cases never get here: the runner SIGKILLs.
    exit(0);
}

/// Scheduler-side admission: acquiring the root lock alone is not proof that
/// the previous worker stopped, so the recorded worker PID is verified too.
fn try_schedule(args: &[String]) -> Value {
    let root = root_arg(args);
    let worker_file = root.join("runs/worker.json");
    let worker = fs::read_to_string(&worker_file).ok().and_then(|text| {
        let parsed: Value = serde_json::from_str(&text).ok()?;
        let pid = parsed.get("pid").and_then(Value::as_i64)?;
        let alive = std::process::Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
        Some(json!({"pid": pid, "alive": alive}))
    });
    let reject = |code: &str, note: &str, worker: Option<Value>| {
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
    match acquire_root_lock(&root) {
        Err(error) if error.code == Code::RootInUse => reject(
            "ROOT_IN_USE",
            "根锁被占用：旧 worker 未退或旧实例仍在，暂停调度。",
            worker,
        ),
        Err(error) => {
            let mut value = error_json("try-schedule", &error);
            value["decision"] = Value::String("REJECT".into());
            value
        }
        Ok(lock) => {
            if worker.as_ref().and_then(|entry| entry.get("alive")).and_then(Value::as_bool)
                == Some(true)
            {
                return reject(
                    "WORKER_ALIVE",
                    "记录的 worker 进程仍可能存活：拿根锁不等于旧 worker 已停，暂停调度。",
                    worker,
                );
            }
            let database = root.join("data/sidekick.sqlite");
            if let Err(error) = StorageAdapter::validate_existing_database(&database, false) {
                let mut value = error_json("try-schedule", &error);
                value["decision"] = Value::String("REJECT".into());
                return value;
            }
            drop(lock);
            json!({
                "command": "try-schedule",
                "ok": true,
                "root": root,
                "decision": "ACCEPT",
                "code": null,
                "worker": worker,
                "note": "根锁可获取、记录的 worker 进程已确认退出、数据库可读。",
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
