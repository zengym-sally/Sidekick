use super::mcp_catalog::CatalogFault;
use super::tests::Fixture;
use super::*;
use std::os::unix::fs::{symlink, PermissionsExt};
fn prepared() -> (Fixture, AppStore, String) {
    let f = Fixture::new();
    let mut s = f.store();
    s.initialize(Some(f.0.join("workspace")), "UTC").unwrap();
    s.upgrade_mcp_storage().unwrap();
    let saved = s.save_mcp_server(McpServerInput { id: None, expected_revision: s.mcp_configuration().unwrap().revision, server: serde_json::from_value(json!({"name":"synthetic","transport":"stdio","enabled":false,"command":"/never-executed","args":[],"cwd":null,"env":[],"connectTimeoutMs":1000,"toolTimeoutMs":30000})).unwrap() }).unwrap();
    let run = s
        .begin_mcp_probe(
            saved.server_id.as_deref().unwrap(),
            &saved.configuration.revision,
        )
        .unwrap();
    s.prepare_mcp_probe(&run.id).unwrap();
    (f, s, run.id)
}
fn catalog() -> McpDiscoveredCatalog {
    serde_json::from_value(json!({"tools":[{"name":"lookup","inputSchema":{"type":"object","properties":{"query":{"type":"string"}}}}]})).unwrap()
}
#[test]
fn mcp_catalog_preserves_full_schema_and_cold_reopen_receipt() {
    let (f, mut s, id) = prepared();
    let expected = catalog();
    let run = s.publish_mcp_catalog(&id, expected.clone(), &[]).unwrap();
    assert_eq!(run.status, "succeeded");
    assert!(run.result.unwrap().catalog_sha256.is_some());
    assert_eq!(s.read_mcp_catalog(&id).unwrap(), Some(expected.clone()));
    drop(s);
    let s = f.store();
    assert_eq!(s.read_mcp_catalog(&id).unwrap(), Some(expected));
}
#[test]
fn mcp_catalog_file_synced_before_database_is_interrupted_not_replayed() {
    let (f, mut s, id) = prepared();
    s.mcp_catalog_fault = Some(CatalogFault::AfterFileSync);
    assert!(s.publish_mcp_catalog(&id, catalog(), &[]).is_err());
    assert_eq!(s.mcp_probe(&id).unwrap().status, "running");
    drop(s);
    let s = f.store();
    assert_eq!(s.mcp_probe(&id).unwrap().status, "interrupted");
    assert!(s.read_mcp_catalog(&id).unwrap().is_none());
    assert!(f
        .0
        .join("workspace/runs")
        .join(id)
        .join("mcp-catalog.json")
        .is_file());
}
#[test]
fn mcp_catalog_database_committed_unknown_blocks_handle_until_cold_receipt_check() {
    let (f, mut s, id) = prepared();
    s.mcp_catalog_fault = Some(CatalogFault::AfterDatabase);
    assert_eq!(
        s.publish_mcp_catalog(&id, catalog(), &[]).unwrap_err().code,
        "MCP_PROBE_SAVE_UNCERTAIN"
    );
    assert_eq!(
        s.mcp_configuration().unwrap_err().code,
        "MCP_PROBE_SAVE_UNCERTAIN"
    );
    assert_eq!(
        s.mcp_probe(&id).unwrap_err().code,
        "MCP_PROBE_SAVE_UNCERTAIN"
    );
    drop(s);
    let s = f.store();
    assert_eq!(s.mcp_probe(&id).unwrap().status, "succeeded");
    assert_eq!(s.read_mcp_catalog(&id).unwrap(), Some(catalog()));
}
#[test]
fn mcp_catalog_rejects_links_tampering_and_replaced_parent() {
    for mode in ["bytes", "symlink", "hardlink", "directory", "runs"] {
        let (f, mut s, id) = prepared();
        s.publish_mcp_catalog(&id, catalog(), &[]).unwrap();
        let dir = f.0.join("workspace/runs").join(&id);
        let file = dir.join("mcp-catalog.json");
        match mode {
            "bytes" => fs::write(&file, b"{}").unwrap(),
            "symlink" => {
                fs::rename(&file, dir.join("old")).unwrap();
                symlink(dir.join("old"), &file).unwrap();
            }
            "hardlink" => fs::hard_link(&file, dir.join("alias")).unwrap(),
            "directory" => fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap(),
            "runs" => {
                let runs = f.0.join("workspace/runs");
                fs::rename(&runs, f.0.join("old-runs")).unwrap();
                fs::create_dir(&runs).unwrap();
                fs::set_permissions(&runs, fs::Permissions::from_mode(0o700)).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(s.read_mcp_catalog(&id).is_err(), "{mode}");
    }
}
#[test]
fn mcp_catalog_prepared_directory_replacement_rejects_publish() {
    let (f, mut s, id) = prepared();
    let runs = f.0.join("workspace/runs");
    let dir = runs.join(&id);
    fs::rename(&dir, runs.join("old-probe")).unwrap();
    fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
    assert_eq!(
        s.publish_mcp_catalog(&id, catalog(), &[]).unwrap_err().code,
        "MCP_CATALOG_PATH"
    );
    assert!(!dir.join("mcp-catalog.json").exists());
    assert_eq!(s.mcp_probe(&id).unwrap().status, "running");
}
#[test]
fn mcp_catalog_host_rechecks_schema_budget_and_sensitive_values() {
    let good = catalog();
    assert!(good.validate(&[]).is_ok());
    for schema in [
        json!({"type":"object","$ref":"#bad"}),
        json!({"type":"object","properties":[]}),
        json!({"type":"object","required":[1]}),
        json!({"type":"object","title":"x".repeat(32768)}),
    ] {
        let mut bad = good.clone();
        bad.tools[0].input_schema = schema;
        assert!(bad.validate(&[]).is_err());
    }
    assert_eq!(
        good.validate(&["lookup".into()]).unwrap_err().code,
        "MCP_PRIVATE_OUTPUT"
    );
    let mut max = good;
    max.tools[0].description = Some("x".repeat(524288));
    assert!(max.validate(&[]).is_err());
}
