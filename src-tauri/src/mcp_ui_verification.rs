use crate::store_commands::LocalState;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use tauri::Manager;

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
    if !(640..=2000).contains(&width)
        || !(600..=1400).contains(&height)
        || args[6] != "controlled-no-credentials"
    {
        return Err("Invalid verification dimensions or scope".into());
    }
    let local = crate::verification_root::open_local(
        &root,
        &args[3],
        ".s33-ui-verification",
        args.len() == 8,
        true,
    )
    .map_err(|e| e.code)?;
    local
        .access(|s| {
            s.latest_mcp_probe("verification-schema-check")?;
            s.info()
        })
        .map_err(|e| e.code)?;
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
    let report = serde_json::json!({"layer":"real native verification package; production invoke and MCP host","pid":std::process::id(),"identifier":app.config().identifier,"workspace":root.canonicalize()?.join("workspace"),"schemaVersion":4,"node":resources.join("s0-runtime/node"),"service":resources.join("s33-ui/service.mjs"),"serviceLog":root.canonicalize()?.join("service.jsonl"),"requestedLogicalSize":{"width":width,"height":height},"physicalInnerSize":{"width":physical.width,"height":physical.height},"scale":scale,"credentials":"disabled; model files forbidden; no tools/call"});
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
