use crate::store_commands::LocalState;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use tauri::Manager;

fn upgrade_policy(scope: &str) -> Result<bool, &'static str> {
    match scope {
        "controlled-no-credentials" => Ok(true),
        "controlled-upgrade-no-credentials" => Ok(false),
        _ => Err("Invalid verification scope"),
    }
}

pub(crate) fn prepare(app: &tauri::App) -> Result<LocalState, Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    if app.config().identifier != "com.sidekick.s33.ui.verify"
        || !(args.len() == 7 || args.len() == 8)
        || args[1] != "--s33-mcp-ui"
        || (args.len() == 8 && args[7] != "--reopen")
    {
        return Err("Verification package requires explicit isolated launch arguments".into());
    }
    let root = PathBuf::from(&args[2]);
    let width: u32 = args[4].parse()?;
    let height: u32 = args[5].parse()?;
    if !(640..=2000).contains(&width) || !(600..=1400).contains(&height) {
        return Err("Invalid verification dimensions or scope".into());
    }
    let upgrade = upgrade_policy(&args[6])?;
    let local = crate::verification_root::open_local(
        &root,
        &args[3],
        ".s33-ui-verification",
        args.len() == 8,
        upgrade,
    )
    .map_err(|e| e.code)?;
    let status = local
        .access(|s| s.mcp_storage_status())
        .map_err(|e| e.code)?;
    if upgrade && status.version != 4 || !(3..=4).contains(&status.version) {
        return Err("Unexpected verification storage version".into());
    }
    let window = app
        .get_webview_window("main")
        .ok_or("Missing main window")?;
    window.set_size(tauri::LogicalSize::new(width, height))?;
    let physical = window.inner_size()?;
    let scale = window.scale_factor()?;
    let resources = app.path().resource_dir()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos();
    let report = serde_json::json!({"layer":"real native verification package; production invoke and MCP host","pid":std::process::id(),"identifier":app.config().identifier,"workspace":root.canonicalize()?.join("workspace"),"schemaVersion":status.version,"node":resources.join("s0-runtime/node"),"service":resources.join("s33-ui/service.mjs"),"serviceLog":root.canonicalize()?.join("service.jsonl"),"requestedLogicalSize":{"width":width,"height":height},"physicalInnerSize":{"width":physical.width,"height":physical.height},"scale":scale,"credentials":"disabled; model files forbidden; no tools/call"});
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(root.join(format!("native-info-{now}.json")))?;
    file.write_all(&serde_json::to_vec_pretty(&report)?)?;
    file.sync_all()?;
    File::open(&root)?.sync_all()?;
    println!("{}", report);
    Ok(local)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_scope_keeps_old_v4_and_new_v3_with_no_arbitrary_mode() {
        for (scope, version) in [
            ("controlled-no-credentials", 4),
            ("controlled-upgrade-no-credentials", 3),
        ] {
            let nonce = crate::mcp_host::nonce();
            let base = std::env::temp_dir().join(format!("sidekick-s33-scope-{nonce}"));
            std::fs::DirBuilder::new().create(&base).unwrap();
            let local = crate::verification_root::open_local(
                &base.join("app"),
                &nonce,
                ".s33-ui-verification",
                false,
                upgrade_policy(scope).unwrap(),
            )
            .unwrap();
            assert_eq!(
                local.access(|s| s.mcp_storage_status()).unwrap().version,
                version
            );
            drop(local);
            std::fs::remove_dir_all(base).unwrap();
        }
        for scope in [
            "",
            "arbitrary-root",
            "controlled-upgrade-no-credentials;other",
        ] {
            assert!(upgrade_policy(scope).is_err());
        }
    }
}
