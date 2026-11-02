use crate::store_commands::LocalState;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use tauri::Manager;

fn native_scope(scope: &str) -> Result<Option<(u16, u32)>, &'static str> {
    if !scope.starts_with("controlled-native-mcp:") && !scope.starts_with("controlled-native-g1:") {
        return Ok(None);
    }
    let values = scope.split(':').collect::<Vec<_>>();
    if values.len() != 3 {
        return Err("Invalid verification model owner");
    }
    let port = values[1]
        .parse::<u16>()
        .map_err(|_| "Invalid verification model port")?;
    let pid = values[2]
        .parse::<u32>()
        .map_err(|_| "Invalid verification model pid")?;
    if port < 1024 || pid < 2 {
        return Err("Invalid verification model owner");
    }
    Ok(Some((port, pid)))
}
fn upgrade_policy(scope: &str) -> Result<bool, &'static str> {
    if native_scope(scope)?.is_some() {
        return Ok(true);
    }
    match scope {
        "controlled-no-credentials" => Ok(true),
        "controlled-upgrade-no-credentials" => Ok(false),
        _ => Err("Invalid verification scope"),
    }
}

fn geometry_matches(
    width: u32,
    height: u32,
    actual_width: u32,
    actual_height: u32,
    scale: f64,
) -> bool {
    scale.is_finite()
        && scale > 0.0
        && scale < 8.0
        && actual_width == (f64::from(width) * scale).round() as u32
        && actual_height == (f64::from(height) * scale).round() as u32
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
    let g1 = args[6].starts_with("controlled-native-g1:");
    let resources = app.path().resource_dir()?;
    let local = if let Some((port, pid)) = native_scope(&args[6])? {
        let owner = crate::verification_root::NativeModelOwner::capture(
            port,
            pid,
            &args[3],
            resources.join("s33-ui/mcp-trial.mjs"),
        )
        .map_err(|e| e.code)?;
        if g1 {
            crate::verification_root::open_g1_native_local(&root, &args[3], args.len() == 8, owner)
        } else {
            crate::verification_root::open_native_local(&root, &args[3], args.len() == 8, owner)
        }
    } else {
        crate::verification_root::open_local(
            &root,
            &args[3],
            ".s33-ui-verification",
            args.len() == 8,
            upgrade,
        )
    }
    .map_err(|e| e.code)?;
    let status = local
        .access(|s| s.mcp_storage_status())
        .map_err(|e| e.code)?;
    let version_allowed = if g1 {
        status.version == 4 || args.len() == 8 && status.version == 5
    } else {
        (!upgrade || status.version == 4) && (3..=4).contains(&status.version)
    };
    if !version_allowed {
        return Err("Unexpected verification storage version".into());
    }
    let startup = if g1 {
        Some(
            local
                .native_startup_identity(&args[6])
                .map_err(|error| error.code)?,
        )
    } else {
        None
    };
    let window = app
        .get_webview_window("main")
        .ok_or("Missing main window")?;
    window.set_size(tauri::LogicalSize::new(width, height))?;
    let window = window.clone();
    let root = root.clone();
    let identifier = app.config().identifier.clone();
    let schema_version = status.version;
    let ready_local = local.clone();
    std::thread::spawn(move || {
        let ready = (|| -> Result<(), Box<dyn std::error::Error>> {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            let (physical, scale) = loop {
                let physical = window.inner_size()?;
                let scale = window.scale_factor()?;
                if geometry_matches(width, height, physical.width, physical.height, scale) {
                    break (physical, scale);
                }
                if std::time::Instant::now() >= deadline {
                    return Err("Native dimensions did not settle".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            };
            let monitor = window.primary_monitor()?.ok_or("Missing primary monitor")?;
            let outer = window.outer_size()?;
            if outer.width > monitor.size().width || outer.height > monitor.size().height {
                return Err("Verification window does not fit the primary monitor".into());
            }
            let target = tauri::PhysicalPosition::new(
                monitor.position().x + ((monitor.size().width - outer.width) / 2) as i32,
                monitor.position().y + ((monitor.size().height - outer.height) / 2) as i32,
            );
            window.set_position(target)?;
            let position = loop {
                let position = window.outer_position()?;
                if position == target {
                    break position;
                }
                if std::time::Instant::now() >= deadline {
                    return Err("Native position did not settle".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            };
            ready_local
                .access(|store| store.info())
                .map_err(|error| error.code)?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos();
            let mut report = serde_json::json!({"layer":"real native verification package; production invoke and MCP host","pid":std::process::id(),"identifier":identifier,"workspace":root.canonicalize()?.join("workspace"),"schemaVersion":schema_version,"node":resources.join("s0-runtime/node"),"service":resources.join("s33-ui/service.mjs"),"serviceLog":root.canonicalize()?.join("service.jsonl"),"requestedLogicalSize":{"width":width,"height":height},"physicalInnerSize":{"width":physical.width,"height":physical.height},"scale":scale,"geometryConfirmed":true,"credentials":if ready_local.native_model_pin().is_some(){"fixed synthetic only; model files and Keychain forbidden"}else{"disabled; model files forbidden; no tools/call"},"modelOwner":ready_local.native_model_pin(),"outerRect":{"x":position.x,"y":position.y,"width":outer.width,"height":outer.height},"primaryMonitor":{"x":monitor.position().x,"y":monitor.position().y,"width":monitor.size().width,"height":monitor.size().height},"nativeService":resources.join("s33-ui/mcp-trial.mjs")});
            if let Some(startup) = startup {
                report["scope"] = "controlled-native-g1".into();
                report["startupIdentity"] = startup;
            }
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(root.join(format!("native-info-{now}.json")))?;
            file.write_all(&serde_json::to_vec_pretty(&report)?)?;
            file.sync_all()?;
            File::open(&root)?.sync_all()?;
            println!("{}", report);
            Ok(())
        })();
        if ready.is_err() {
            eprintln!("Native verification geometry was not confirmed.");
        }
    });
    Ok(local)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_g1_scope_has_a_fixed_owned_native_entry() {
        assert!(native_scope("controlled-native-g1:1493:123")
            .unwrap()
            .is_some());
        assert!(upgrade_policy("controlled-native-g1:1493:123").unwrap());
        for scope in [
            "controlled-native-g1:0:123",
            "controlled-native-g1:1493:0",
            "controlled-native-g1:1493:123:extra",
            "controlled-native-g1:https://example.invalid:123",
        ] {
            assert!(upgrade_policy(scope).is_err(), "{scope}");
        }
    }
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
    #[test]
    fn verification_native_scope_requires_a_bounded_model_owner() {
        assert!(upgrade_policy("controlled-native-mcp:1493:123").unwrap());
        for scope in [
            "controlled-native-mcp:0:123",
            "controlled-native-mcp:443:123",
            "controlled-native-mcp:65536:123",
            "controlled-native-mcp:1493:0",
            "controlled-native-mcp:1493:123:extra",
            "controlled-native-mcp:https://example.invalid:123",
        ] {
            assert!(upgrade_policy(scope).is_err(), "{scope}");
        }
    }
    #[test]
    fn verification_native_geometry_rejects_a_pre_resize_observation() {
        assert!(!geometry_matches(640, 900, 1440, 1000, 1.0));
        assert!(geometry_matches(640, 900, 640, 900, 1.0));
        assert!(geometry_matches(1440, 1000, 2880, 2000, 2.0));
        assert!(!geometry_matches(1440, 1000, 1440, 1000, 2.0));
    }
}
