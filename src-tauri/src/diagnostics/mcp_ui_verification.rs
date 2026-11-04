use crate::store_commands::LocalState;
use crate::verification_root::NativeReadinessDiagnostic;
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

fn readiness_step<T, E>(
    diagnostic: &mut NativeReadinessDiagnostic,
    stage: &'static str,
    reason: &'static str,
    action: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    diagnostic.stage = stage;
    diagnostic.reason = reason;
    action()
}

fn finish_readiness<T, E>(
    prepared: Result<T, E>,
    publish: impl FnOnce(T) -> Result<(), E>,
    failed: impl FnOnce(),
) -> Result<(), E> {
    match prepared {
        Ok(report) => publish(report),
        Err(error) => {
            failed();
            Err(error)
        }
    }
}

fn readiness_expired(
    diagnostic: &mut NativeReadinessDiagnostic,
    stage: &'static str,
    deadline: std::time::Instant,
) -> bool {
    if std::time::Instant::now() < deadline {
        return false;
    }
    diagnostic.stage = stage;
    diagnostic.reason = "deadline";
    true
}

fn publish_info_with_sync(
    root: &std::path::Path,
    report: &serde_json::Value,
    sync: impl FnOnce(&File, &std::path::Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(std::io::Error::other)?
        .as_nanos();
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(root.join(format!("native-info-{now}.json")))?;
    file.write_all(&serde_json::to_vec_pretty(report).map_err(std::io::Error::other)?)?;
    sync(&file, root)
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
    let mut diagnostic = NativeReadinessDiagnostic::new(width, height);
    if let Err(error) = readiness_step(&mut diagnostic, "size_request", "api", || {
        window.set_size(tauri::LogicalSize::new(width, height))
    }) {
        if g1 {
            let _ = local.native_readiness_failure(&diagnostic);
        }
        return Err(error.into());
    }
    let window = window.clone();
    let root = root.clone();
    let identifier = app.config().identifier.clone();
    let schema_version = status.version;
    let ready_local = local.clone();
    let failure_local = local.clone();
    std::thread::spawn(move || {
        let prepared = (|| -> Result<serde_json::Value, Box<dyn std::error::Error>> {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            let (physical, scale) = loop {
                let physical =
                    readiness_step(&mut diagnostic, "inner_size", "api", || window.inner_size())?;
                diagnostic.inner = Some([physical.width, physical.height]);
                let scale =
                    readiness_step(&mut diagnostic, "scale", "api", || window.scale_factor())?;
                diagnostic.scale = scale.is_finite().then_some(scale);
                if geometry_matches(width, height, physical.width, physical.height, scale) {
                    break (physical, scale);
                }
                if readiness_expired(&mut diagnostic, "inner_size", deadline) {
                    return Err("Native dimensions did not settle".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            };
            let monitor = readiness_step(&mut diagnostic, "monitor", "api", || {
                window.primary_monitor()
            })?
            .ok_or_else(|| {
                diagnostic.reason = "missing";
                "Missing primary monitor"
            })?;
            diagnostic.monitor = Some([
                monitor.position().x as i64,
                monitor.position().y as i64,
                monitor.size().width as i64,
                monitor.size().height as i64,
            ]);
            let area = monitor.work_area();
            diagnostic.work_area = Some([
                area.position.x as i64,
                area.position.y as i64,
                area.size.width as i64,
                area.size.height as i64,
            ]);
            let outer =
                readiness_step(&mut diagnostic, "outer_size", "api", || window.outer_size())?;
            diagnostic.outer = Some([outer.width, outer.height]);
            diagnostic.stage = "bounds";
            diagnostic.reason = "bounds";
            if outer.width > monitor.size().width || outer.height > monitor.size().height {
                return Err("Verification window does not fit the primary monitor".into());
            }
            let target = tauri::PhysicalPosition::new(
                monitor.position().x + ((monitor.size().width - outer.width) / 2) as i32,
                monitor.position().y + ((monitor.size().height - outer.height) / 2) as i32,
            );
            diagnostic.target = Some([target.x, target.y]);
            readiness_step(&mut diagnostic, "position_request", "api", || {
                window.set_position(target)
            })?;
            let position = loop {
                let position = readiness_step(&mut diagnostic, "position", "api", || {
                    window.outer_position()
                })?;
                diagnostic.position = Some([position.x, position.y]);
                if position == target {
                    break position;
                }
                if readiness_expired(&mut diagnostic, "position", deadline) {
                    return Err("Native position did not settle".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            };
            readiness_step(&mut diagnostic, "store", "store", || {
                ready_local
                    .access(|store| store.info())
                    .map_err(|error| error.code)
            })?;
            let canonical_root =
                readiness_step(&mut diagnostic, "store", "api", || root.canonicalize())?;
            let mut report = serde_json::json!({"layer":"real native verification package; production invoke and MCP host","pid":std::process::id(),"identifier":identifier,"workspace":canonical_root.join("workspace"),"schemaVersion":schema_version,"node":resources.join("s0-runtime/node"),"service":resources.join("s33-ui/service.mjs"),"serviceLog":canonical_root.join("service.jsonl"),"requestedLogicalSize":{"width":width,"height":height},"physicalInnerSize":{"width":physical.width,"height":physical.height},"scale":scale,"geometryConfirmed":true,"credentials":if ready_local.native_model_pin().is_some(){"fixed synthetic only; model files and Keychain forbidden"}else{"disabled; model files forbidden; no tools/call"},"modelOwner":ready_local.native_model_pin(),"outerRect":{"x":position.x,"y":position.y,"width":outer.width,"height":outer.height},"primaryMonitor":{"x":monitor.position().x,"y":monitor.position().y,"width":monitor.size().width,"height":monitor.size().height},"nativeService":resources.join("s33-ui/mcp-trial.mjs")});
            if let Some(startup) = startup {
                report["scope"] = "controlled-native-g1".into();
                report["startupIdentity"] = startup;
            }
            Ok(report)
        })();
        let ready = finish_readiness(
            prepared,
            |report| {
                publish_info_with_sync(&root, &report, |file, root| {
                    file.sync_all()?;
                    File::open(root)?.sync_all()
                })?;
                println!("{}", report);
                Ok(())
            },
            || {
                if g1 {
                    let _ = failure_local.native_readiness_failure(&diagnostic);
                }
            },
        );
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
    fn verification_readiness_phase_errors_use_the_actual_failure_route_without_raw_text() {
        for (stage, reason) in [
            ("size_request", "api"),
            ("inner_size", "api"),
            ("scale", "api"),
            ("monitor", "missing"),
            ("outer_size", "api"),
            ("bounds", "bounds"),
            ("position_request", "api"),
            ("position", "api"),
            ("store", "store"),
            ("store", "api"),
        ] {
            let mut diagnostic = NativeReadinessDiagnostic::new(1440, 800);
            let result: Result<(), &str> = readiness_step(&mut diagnostic, stage, reason, || {
                Err("PRIVATE_DIAGNOSTIC_CANARY /Users/synthetic/private")
            });
            let published = std::cell::Cell::new(false);
            let failed = std::cell::Cell::new(false);
            assert!(finish_readiness(
                result,
                |_| {
                    published.set(true);
                    Ok(())
                },
                || {
                    failed.set(true);
                }
            )
            .is_err());
            assert!(!published.get());
            assert!(failed.get());
            assert_eq!(diagnostic.stage, stage);
            assert_eq!(diagnostic.reason, reason);
            assert!(
                diagnostic.inner.is_none()
                    && diagnostic.monitor.is_none()
                    && diagnostic.position.is_none()
            );
            let bytes = serde_json::to_string(&diagnostic).unwrap();
            assert!(!bytes.contains("PRIVATE_DIAGNOSTIC_CANARY") && !bytes.contains("/Users/"));
        }
    }
    #[test]
    fn verification_readiness_settling_keeps_one_shared_deadline() {
        let mut diagnostic = NativeReadinessDiagnostic::new(1440, 800);
        let expired = std::time::Instant::now() - std::time::Duration::from_millis(1);
        for stage in ["inner_size", "position"] {
            assert!(readiness_expired(&mut diagnostic, stage, expired));
            assert_eq!(diagnostic.stage, stage);
            assert_eq!(diagnostic.reason, "deadline");
        }
        let before = diagnostic.stage;
        assert!(!readiness_expired(
            &mut diagnostic,
            "inner_size",
            std::time::Instant::now() + std::time::Duration::from_secs(1)
        ));
        assert_eq!(diagnostic.stage, before);
    }
    #[test]
    fn verification_ready_publish_io_error_cannot_emit_a_late_failure() {
        use std::os::unix::fs::{DirBuilderExt, MetadataExt};
        let root = std::env::temp_dir().join(format!(
            "sidekick-native-publication-{}",
            crate::mcp_host::nonce()
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .unwrap();
        let report = serde_json::json!({"synthetic":true});
        let failed = std::cell::Cell::new(false);
        let result = finish_readiness(
            Ok::<_, std::io::Error>(report.clone()),
            |value| {
                publish_info_with_sync(&root, &value, |file, root| {
                    assert!(file.metadata()?.len() > 0);
                    let paths = std::fs::read_dir(root)?
                        .map(|entry| entry.unwrap().path())
                        .collect::<Vec<_>>();
                    assert_eq!(paths.len(), 1);
                    assert_eq!(
                        serde_json::from_slice::<serde_json::Value>(&std::fs::read(&paths[0])?)
                            .unwrap(),
                        report
                    );
                    assert_eq!(file.metadata()?.mode() & 0o7777, 0o600);
                    Err(std::io::ErrorKind::BrokenPipe.into())
                })
            },
            || {
                failed.set(true);
                std::fs::write(root.join("native-failure-unexpected.json"), b"unexpected").unwrap();
            },
        );
        assert!(result.is_err());
        assert!(!failed.get());
        assert!(!root.join("native-failure-unexpected.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
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
