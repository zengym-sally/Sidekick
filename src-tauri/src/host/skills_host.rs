use crate::local_store::StoreError;
use crate::store_commands::LocalState;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{Manager, State};

fn failure(code: &str) -> StoreError {
    let (code, message) = match code {
        "SKILLS_SCAN_REQUIRED" => (
            "SKILLS_SCAN_REQUIRED",
            "上次技能扫描未完成，请先在工具设置中重新扫描。",
        ),
        "SKILLS_CHANGED" => (
            "SKILLS_CHANGED",
            "技能目录已变化，请在工具设置中重新扫描后再试。",
        ),
        "SKILLS_RESTORE_UNKNOWN" => (
            "SKILLS_RESTORE_UNKNOWN",
            "技能恢复状态待核对，原目录、备份和操作记录已保留，请勿重复覆盖。",
        ),
        "SKILLS_PATH" => (
            "SKILLS_PATH",
            "技能管理目录含链接或位置已变化，请检查工作目录后重试。",
        ),
        "SKILL_LIMIT" => (
            "SKILL_LIMIT",
            "技能数量或体积超过限制，原索引已保留，请调整后重新扫描。",
        ),
        "SKILLS_CONFIG" => (
            "SKILLS_CONFIG",
            "技能索引或安装记录无法识别，原文件未覆盖。",
        ),
        "SKILLS_BUNDLE" => (
            "SKILLS_BUNDLE",
            "随包技能资源校验失败，请重新安装兼容版本。",
        ),
        "SKILLS_TIMEOUT" => (
            "SKILLS_TIMEOUT",
            "技能管理操作超时，已停止进程；请重新读取核对状态。",
        ),
        _ => (
            "SKILLS_IO",
            "技能目录暂时无法处理，请检查文件和访问权限后重新扫描。",
        ),
    };
    StoreError { code, message }
}

pub(crate) fn request(
    directory: &Path,
    root: &Path,
    mut input: Value,
) -> Result<Value, StoreError> {
    input["root"] = json!(root);
    input["builtin"] = json!(directory.join("builtin-skills"));
    let bytes = serde_json::to_vec(&input).map_err(|_| failure("SKILLS_CONFIG"))?;
    if bytes.len() > 16384 {
        return Err(failure("SKILLS_CONFIG"));
    }
    let mut child = Command::new(directory.join("node"))
        .arg(directory.join("skills-manager.mjs"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| failure("SKILLS_IO"))?;
    if child
        .stdin
        .take()
        .is_none_or(|mut stdin| stdin.write_all(&bytes).is_err())
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err(failure("SKILLS_IO"));
    }
    let stdout = child.stdout.take().ok_or_else(|| failure("SKILLS_IO"))?;
    let (send, receive) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(2_000_001).read_to_end(&mut bytes);
        let _ = send.send((result.is_ok(), bytes));
    });
    let started = Instant::now();
    let mut result = loop {
        if started.elapsed() > Duration::from_secs(8) {
            break Err(failure("SKILLS_TIMEOUT"));
        }
        match receive.recv_timeout(Duration::from_millis(25)) {
            Ok((true, bytes)) if bytes.len() <= 2_000_000 => {
                break serde_json::from_slice::<Value>(&bytes).map_err(|_| failure("SKILLS_IO"));
            }
            Ok(_) | Err(mpsc::RecvTimeoutError::Disconnected) => break Err(failure("SKILLS_IO")),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    };
    while matches!(child.try_wait(), Ok(None)) {
        if started.elapsed() > Duration::from_secs(8) {
            result = Err(failure("SKILLS_TIMEOUT"));
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if result.is_err() {
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &format!("-{}", child.id())])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.wait();
    let _ = reader.join();
    let response = result?;
    if response["ok"].as_bool() != Some(true) {
        return Err(failure(response["code"].as_str().unwrap_or("SKILLS_IO")));
    }
    Ok(response["value"].clone())
}

pub(crate) fn freeze(directory: &Path, root: &Path, run: &Path) -> Result<Value, StoreError> {
    request(
        directory,
        root,
        json!({"action":"snapshot","runDirectory":run}),
    )
}

#[tauri::command]
pub async fn skills_catalog(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
) -> Result<Value, StoreError> {
    let local = local.inner().clone();
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| failure("SKILLS_IO"))?
        .join("s0-runtime");
    tauri::async_runtime::spawn_blocking(move || {
        local.access(|store| request(&directory, &store.root()?, json!({"action":"scan"})))
    })
    .await
    .map_err(|_| failure("SKILLS_IO"))?
}

#[tauri::command]
pub async fn restore_builtin_skill(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    id: String,
    expected_hash: String,
) -> Result<Value, StoreError> {
    let local = local.inner().clone();
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| failure("SKILLS_IO"))?
        .join("s0-runtime");
    tauri::async_runtime::spawn_blocking(move || {
        local.access(|store| {
            request(
                &directory,
                &store.root()?,
                json!({"action":"restore","id":id,"expectedHash":expected_hash}),
            )
        })
    })
    .await
    .map_err(|_| failure("SKILLS_IO"))?
}

#[tauri::command]
pub async fn open_skills_directory(local: State<'_, LocalState>) -> Result<(), StoreError> {
    let local = local.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        local.access(|store| {
            let root = store.root()?;
            let path = root.join("skills");
            let m = std::fs::symlink_metadata(&path).map_err(|_| failure("SKILLS_PATH"))?;
            if !m.is_dir()
                || m.file_type().is_symlink()
                || path
                    .canonicalize()
                    .map_err(|_| failure("SKILLS_PATH"))?
                    .parent()
                    != Some(root.as_path())
            {
                return Err(failure("SKILLS_PATH"));
            }
            if Command::new("/usr/bin/open")
                .arg(path)
                .status()
                .map_err(|_| failure("SKILLS_IO"))?
                .success()
            {
                Ok(())
            } else {
                Err(failure("SKILLS_IO"))
            }
        })
    })
    .await
    .map_err(|_| failure("SKILLS_IO"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    fn temporary() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "sidekick-skills-host-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join(".sidekick-workspace"), "sidekick-workspace-v1\n").unwrap();
        root
    }
    #[test]
    fn bundled_skills_scan_and_snapshot_use_the_same_private_workspace() {
        let root = temporary();
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../build/s0-runtime")
            .canonicalize()
            .unwrap();
        let catalog = request(&directory, &root, json!({"action":"scan"})).unwrap();
        assert_eq!(catalog["skills"].as_array().unwrap().len(), 18);
        assert!(catalog["diagnostics"].as_array().unwrap().is_empty());
        fs::create_dir(root.join("runs/test")).unwrap();
        let snapshot = freeze(&directory, &root, &root.join("runs/test")).unwrap();
        assert_eq!(snapshot["index"].as_array().unwrap().len(), 18);
        let frozen = Path::new(snapshot["root"].as_str().unwrap());
        assert_eq!(
            fs::read(frozen.join("../events/im/message_receive.go")).unwrap(),
            fs::read(directory.join("builtin-skills/support/events/im/message_receive.go"))
                .unwrap()
        );
        fs::write(root.join("skills/lark-shared/SKILL.md"), "changed").unwrap();
        fs::create_dir(root.join("runs/later")).unwrap();
        assert_eq!(
            freeze(&directory, &root, &root.join("runs/later"))
                .unwrap_err()
                .code,
            "SKILLS_CHANGED"
        );
        assert!(frozen.join("lark-shared/SKILL.md").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn management_process_timeout_and_stderr_are_bounded() {
        let root = temporary();
        let directory = root.join("mock-runtime");
        fs::create_dir(&directory).unwrap();
        let node = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../build/s0-runtime/node")
            .canonicalize()
            .unwrap();
        symlink(node, directory.join("node")).unwrap();
        fs::write(directory.join("skills-manager.mjs"),"process.stderr.write('SYNTHETIC_PRIVATE_MARKER');process.stdout.end();setInterval(()=>{},1000);").unwrap();
        let start = Instant::now();
        let error = request(&directory, &root, json!({"action":"scan"})).unwrap_err();
        assert_eq!(error.code, "SKILLS_TIMEOUT");
        assert!(!error.message.contains("PRIVATE"));
        assert!(start.elapsed() < Duration::from_secs(10));
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod runtime_tests {
    use super::*;
    use crate::local_store::{ModelConfigInput, TextInput};
    use crate::runtime_host::RuntimeState;
    use std::io::{BufRead, BufReader};
    use std::sync::Arc;

    #[test]
    fn host_trial_reads_frozen_skill_executes_script_and_preserves_business_tables() {
        let root = std::env::temp_dir().join(format!(
            "sidekick-s32-host-trial-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../build/s0-runtime")
            .canonicalize()
            .unwrap();
        let server_path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/s32-model-server.mjs");
        let mut server = Command::new(directory.join("node"))
            .arg(server_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        struct Cleanup {
            root: std::path::PathBuf,
            server: std::process::Child,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.server.kill();
                let _ = self.server.wait();
                std::env::remove_var("SIDEKICK_S32_SYNTHETIC_KEY");
                let _ = std::fs::remove_dir_all(&self.root);
            }
        }
        let mut line = String::new();
        BufReader::new(server.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let _cleanup = Cleanup {
            root: root.clone(),
            server,
        };
        std::env::set_var("SIDEKICK_S32_SYNTHETIC_KEY", "synthetic-s32");
        let local = LocalState::new(root.join("app"));
        local
            .access(|s| s.initialize(Some(root.join("workspace")), "Asia/Shanghai"))
            .unwrap();
        let workspace = local.access(|s| s.root()).unwrap();
        let from =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/skills/s32-reader");
        fn copy(from: &Path, to: &Path) {
            std::fs::create_dir_all(to).unwrap();
            for entry in std::fs::read_dir(from).unwrap() {
                let entry = entry.unwrap();
                let dest = to.join(entry.file_name());
                if entry.file_type().unwrap().is_dir() {
                    copy(&entry.path(), &dest);
                } else {
                    std::fs::copy(entry.path(), dest).unwrap();
                }
            }
        }
        copy(&from, &workspace.join("skills/s32-reader"));
        local.access(|s|s.save_models(ModelConfigInput{expected_revision:None,providers:json!({"providers":[{"id":"synthetic","apiFormat":"openai-compatible","baseUrl":line.trim(),"auth":{"type":"bearer","apiKeyEnv":"SIDEKICK_S32_SYNTHETIC_KEY"},"enabled":true}]}),models:json!({"models":[{"id":"synthetic-model","providerId":"synthetic","apiModelId":"synthetic-wire","capabilities":{"toolCall":true}}]}),default_model_id:"synthetic-model".into(),api_keys:Default::default()})).unwrap();
        let database = rusqlite::Connection::open(workspace.join("data/sidekick.sqlite")).unwrap();
        let counts = || {
            ["sources", "candidates", "todos", "todo_events"].map(|table| {
                database
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| {
                        r.get::<_, i64>(0)
                    })
                    .unwrap()
            })
        };
        let before = counts();
        let runtime = RuntimeState::default();
        let run = runtime
            .start_trial(
                local.clone(),
                directory.clone(),
                "organizer",
                TextInput {
                    text: "我下周五整理清单。".into(),
                    source_at_ms: Some(1793239200000),
                    time_zone: "Asia/Shanghai".into(),
                },
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let started = Instant::now();
        let final_run = loop {
            let value = local.access(|s| s.agent_run(&run.id)).unwrap();
            if value.status != "running" {
                break value;
            }
            assert!(started.elapsed() < Duration::from_secs(15));
            std::thread::sleep(Duration::from_millis(25));
        };
        assert_eq!(final_run.status, "succeeded", "{:?}", final_run.error_code);
        assert_eq!(counts(), before);
        assert_eq!(
            std::fs::read_to_string(
                workspace
                    .join("runs")
                    .join(&run.id)
                    .join("skill-output.txt")
            )
            .unwrap(),
            "skill-proof-v1\n"
        );
        assert_eq!(
            final_run.snapshot["skills"]["index"]
                .as_array()
                .unwrap()
                .len(),
            19
        );
        let proof: Value = serde_json::from_slice(
            &std::fs::read(
                workspace
                    .join("runs")
                    .join(&run.id)
                    .join("skills-proof.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            proof
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["type"] == "read")
                .count(),
            2
        );
        assert!(proof
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "bash"));
    }
}
