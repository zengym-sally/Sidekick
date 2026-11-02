use super::mcp_trial_tests::TrialFixture;
use super::*;
use crate::local_store::{
    AgentConfigInput, CandidateDraft, McpUpgradeInput, SignChoice, TodoInput,
};
use std::fs;
fn formal(f: &TrialFixture) {
    f.local.as_ref().unwrap().access(|s|{let fields=TodoInput{title:"合成正式跟进".into(),kind:"followup".into(),owner:"合成负责人".into(),priority:"medium".into(),tags:vec!["合成".into()],due:None,followup:None};s.create(fields.clone(),"today-manual")?;let batch=s.begin_import(TextInput{text:"合成负责人负责合成正式跟进。".into(),source_at_ms:None,time_zone:"UTC".into()},Value::Null,false)?;let batch=s.publish_candidates(&batch.run.unwrap().id,vec![CandidateDraft{fields,evidence:"合成负责人负责合成正式跟进。".into(),due_expression:None,followup_expression:None,warnings:vec![],unresolved:false}])?;let c=&batch.candidates[0];s.sign_candidates(vec![SignChoice{candidate_id:c.id.clone(),expected_version:c.version,fields:c.draft.fields.clone(),time_reviewed:true,target:None}],"today-signed")?;let prepared=s.prepare_agent_model("organizer")?;let old=s.begin_prepared_agent_trial("organizer",TextInput{text:"合成旧试跑".into(),source_at_ms:None,time_zone:"UTC".into()},prepared.snapshot)?;s.complete_agent_trial(&old.id,vec![])?;Ok(old.id)}).map(|id|{rusqlite::Connection::open_with_flags(f.root.join("workspace/data/sidekick.sqlite"),rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE|rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW).unwrap().execute("INSERT INTO tool_calls(id,agent_run_id,model_call_id,configuration_revision,schema_sha256,server_id,tool_name,arguments_sha256,send_state,response_category,created_at_ms,finished_at_ms) VALUES('today-old-call',?1,'old-model','old-revision',?2,'old-server','old-tool',?2,'responded','success',1,2)",rusqlite::params![id,"a".repeat(64)]).unwrap();}).unwrap();
    let status = f
        .local
        .as_ref()
        .unwrap()
        .access(|s| s.today_storage_status())
        .unwrap();
    f.runtime
        .confirm_today_storage(
            f.local.as_ref().unwrap(),
            McpUpgradeInput {
                confirmed: true,
                confirmation_token: status.confirmation_token.unwrap(),
            },
        )
        .unwrap();
}
fn start(f: &TrialFixture) -> crate::local_store::TodayAdviceRun {
    f.runtime
        .start_today(
            f.local.as_ref().unwrap().clone(),
            f.directory.clone(),
            Arc::new(|_, _| {}),
        )
        .unwrap()
}
fn wait(f: &TrialFixture, id: &str) -> crate::local_store::TodayAdviceRun {
    let start = Instant::now();
    while f.runtime.active_run().is_some() {
        assert!(start.elapsed() < Duration::from_secs(12));
        std::thread::sleep(Duration::from_millis(20));
    }
    f.local
        .as_ref()
        .unwrap()
        .access(|s| s.today_advice_run(id))
        .unwrap()
}
fn wait_request(f: &TrialFixture, count: usize) {
    let start = Instant::now();
    while f.events("model.jsonl").len() < count {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(20));
    }
}
fn rows(f: &TrialFixture) -> Vec<Value> {
    let db = f.database();
    [
        "sources",
        "candidates",
        "todos",
        "todo_events",
        "todo_sources",
        "tool_calls",
        "agent_runs",
    ]
    .into_iter()
    .map(|table| {
        let query = if table == "agent_runs" {
            "SELECT rowid,* FROM agent_runs WHERE purpose<>'today_advice' ORDER BY rowid".into()
        } else {
            format!("SELECT rowid,* FROM {table} ORDER BY rowid")
        };
        let mut q = db.prepare(&query).unwrap();
        let width = q.column_count();
        let values = q
            .query_map([], |r| {
                (0..width)
                    .map(|i| r.get_ref(i).map(|v| format!("{v:?}")))
                    .collect::<std::result::Result<Vec<_>, _>>()
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect::<Vec<_>>();
        json!({"table":table,"rows":values})
    })
    .collect()
}
#[test]
fn today_real_pi_uses_signed_formal_facts_and_frozen_config_without_formal_or_tool_writes() {
    let f = TrialFixture::new("today-freeze", true, true);
    formal(&f);
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            let c = s.agent_config("advisor")?;
            s.save_agent_config(AgentConfigInput {
                agent_id: "advisor".into(),
                expected_revision: c.revision,
                model_id: None,
                preferences: crate::local_store::AgentPreferences {
                    detail: "detailed".into(),
                    focus: "followup".into(),
                },
                supplemental_instructions: "按合成事实排序。".into(),
            })?;
            Ok(())
        })
        .unwrap();
    let before = rows(&f);
    assert!(before
        .iter()
        .all(|table| !table["rows"].as_array().unwrap().is_empty()));
    let run = start(&f);
    assert!(run.snapshot.get("todayPreparation").is_some());
    wait_request(&f, 1);
    let run = f
        .local
        .as_ref()
        .unwrap()
        .access(|store| store.today_advice_run(&run.id))
        .unwrap();
    assert_eq!(run.purpose, "today_advice");
    assert_eq!(run.snapshot["todayFacts"]["counts"]["open"], 2);
    assert_eq!(
        f.runtime
            .start_trial(
                f.local.as_ref().unwrap().clone(),
                f.directory.clone(),
                "advisor",
                TextInput {
                    text: "合成试跑".into(),
                    source_at_ms: None,
                    time_zone: "UTC".into()
                },
                Arc::new(|_, _| {})
            )
            .unwrap_err()
            .code,
        "RUNTIME_BUSY"
    );
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            let c = s.agent_config("advisor")?;
            s.reset_agent_config("advisor", &c.revision)?;
            Ok(())
        })
        .unwrap();
    fs::write(f.root.join("forbidden-marker.continue"), b"continue").unwrap();
    let result = wait(&f, &run.id);
    assert_eq!(result.status, "succeeded");
    assert_eq!(
        result.snapshot["agent"]["preferences"]["detail"],
        "detailed"
    );
    assert_eq!(result.result.unwrap().ranking.len(), 2);
    let events = f.events("model.jsonl");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["todayFacts"], run.snapshot["todayFacts"]);
    assert_eq!(events[0]["allNames"], json!([]));
    assert_eq!(events[0]["detail"], true);
    assert_eq!(rows(&f), before);
    assert!(f.events("service-0.jsonl").is_empty());
    assert!(f.events("service-1.jsonl").is_empty());
    assert!(!f.root.join("forbidden-marker").exists());
}
#[test]
fn today_real_pi_preserves_multiple_orders_empty_and_invalid_or_tool_outputs() {
    for mode in [
        "today-normal",
        "today-alternate",
        "today-empty",
        "today-invalid",
        "today-service-error",
        "today-tool-injection",
    ] {
        let f = TrialFixture::new(mode, false, true);
        formal(&f);
        let before = rows(&f);
        let run = start(&f);
        let done = wait(&f, &run.id);
        if ["today-invalid", "today-service-error"].contains(&mode) {
            assert_eq!(done.status, "failed");
            assert!(done.result.is_none());
        } else if mode != "today-tool-injection" {
            assert_eq!(done.status, "succeeded");
            let ids = done
                .result
                .unwrap()
                .ranking
                .into_iter()
                .map(|row| row.todo_id)
                .collect::<Vec<_>>();
            let mut expected = done.snapshot["todayFacts"]["todos"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|row| row["status"] == "open")
                .map(|row| row["id"].as_str().unwrap().to_string())
                .collect::<Vec<_>>();
            if mode == "today-alternate" {
                expected.reverse();
            }
            if mode == "today-empty" {
                expected.clear();
            }
            assert_eq!(ids, expected);
        }
        assert_eq!(rows(&f), before);
        assert!(f
            .events("model.jsonl")
            .iter()
            .all(|event| event["allNames"] == json!([])));
        assert!(f.events("service-0.jsonl").is_empty());
        assert!(!f.root.join("forbidden-marker").exists());
    }
}
#[test]
fn today_last_success_survives_new_failure_reopen_and_unowned_running_interrupt() {
    let mut f = TrialFixture::new("today-success-then-fail", true, true);
    formal(&f);
    let first = start(&f);
    assert_eq!(wait(&f, &first.id).status, "succeeded");
    let second = start(&f);
    assert_eq!(wait(&f, &second.id).status, "failed");
    let state = f
        .runtime
        .read_today(f.local.as_ref().unwrap(), &f.directory)
        .unwrap();
    assert_eq!(state.latest.unwrap().id, second.id);
    assert_eq!(state.last_success.unwrap().id, first.id);
    assert!(!state.last_success_stale);
    let pending = f
        .local
        .as_ref()
        .unwrap()
        .access(|s| {
            let key = "today-unowned-pending";
            let input = s.today_fact_input(key, 1793581200000)?;
            let facts = super::today_advice::derive_facts(&f.directory, input)?;
            let prepared = s.prepare_agent_model("advisor")?;
            s.begin_today_advice(prepared.snapshot, facts)
        })
        .unwrap();
    drop(f.local.take());
    let reopened = LocalState::new(f.root.join("app"));
    let state = f.runtime.read_today(&reopened, &f.directory).unwrap();
    assert_eq!(state.latest.as_ref().unwrap().id, pending.id);
    assert_eq!(state.latest.unwrap().status, "interrupted");
    assert_eq!(state.last_success.unwrap().id, first.id);
}
#[test]
fn today_fact_edit_cancel_late_result_and_timeout_are_absorbed() {
    for timeout in [false, true] {
        let f = TrialFixture::new("today-freeze", true, true);
        formal(&f);
        if timeout {
            *f.runtime.trial_policy.lock().unwrap() = Some("short-io");
        }
        let run = start(&f);
        wait_request(&f, 1);
        if !timeout {
            f.local
                .as_ref()
                .unwrap()
                .access(|s| {
                    let old = s.list()?.remove(0);
                    let mut fields = old.fields;
                    fields.title = "合成更新后的标题".into();
                    s.update(&old.id, old.version, fields, "today-concurrent-edit")?;
                    Ok(())
                })
                .unwrap();
            let state = f
                .runtime
                .read_today(f.local.as_ref().unwrap(), &f.directory)
                .unwrap();
            assert_eq!(state.latest_stale, Some(true));
            f.runtime.cancel(&run.id);
            f.local
                .as_ref()
                .unwrap()
                .access(|s| s.cancel_today_advice(&run.id))
                .unwrap();
            fs::write(f.root.join("forbidden-marker.continue"), b"continue").unwrap();
        }
        let done = wait(&f, &run.id);
        assert_eq!(done.status, if timeout { "failed" } else { "cancelled" });
        if timeout {
            assert_eq!(done.error_code.as_deref(), Some("MODEL_TIMEOUT"));
        }
        let facts = &done.snapshot["todayFacts"];
        let result:crate::local_store::TodayAdviceResult=serde_json::from_value(json!({"kind":"today_advice","version":1,"snapshotId":run.id,"date":facts["date"],"timeZone":facts["timeZone"],"ranking":[]})).unwrap();
        assert_eq!(
            f.local
                .as_ref()
                .unwrap()
                .access(|s| s.complete_today_advice(&run.id, result))
                .unwrap_err()
                .code,
            "TODAY_ADVICE_STOPPED"
        );
        assert_eq!(
            f.local
                .as_ref()
                .unwrap()
                .access(|s| s.finish_today_advice_error(&run.id, "MODEL_SERVICE"))
                .unwrap()
                .status,
            done.status
        );
    }
}
#[test]
#[ignore = "controlled subprocess entry only; invoked by today_real_host_crash_cold_reopen"]
fn today_child_crash_harness() {
    let app = std::env::var_os("SIDEKICK_TODAY_CHILD_APP").expect("controlled app");
    let directory = PathBuf::from(
        std::env::var_os("SIDEKICK_TODAY_CHILD_RUNTIME").expect("controlled runtime"),
    );
    let receipt = PathBuf::from(
        std::env::var_os("SIDEKICK_TODAY_CHILD_RECEIPT").expect("controlled receipt"),
    );
    let local = LocalState::new(app.into());
    let state = RuntimeState::default();
    let run = state
        .start_today(local, directory.clone(), Arc::new(|_, _| {}))
        .unwrap();
    let started = Instant::now();
    let pid = loop {
        let pid = state
            .slot
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .pid
            .load(Ordering::SeqCst);
        let phase = std::env::var("SIDEKICK_TODAY_CRASH_PHASE").unwrap_or_else(|_| "model".into());
        let script = if phase == "helper" {
            "today-facts.mjs"
        } else {
            "organizer.mjs"
        };
        if pid > 0 && owned(pid, &directory.join(script), &run.id, None) {
            break pid;
        }
        assert!(started.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    };
    fs::write(receipt, json!({"runId":run.id,"pid":pid}).to_string()).unwrap();
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}
#[test]
fn today_real_host_crash_cold_reopen_interrupts_run_and_keeps_success() {
    let mut f = TrialFixture::new("today-freeze", true, true);
    formal(&f);
    fs::write(f.root.join("forbidden-marker.continue"), b"continue").unwrap();
    let first = start(&f);
    assert_eq!(wait(&f, &first.id).status, "succeeded");
    fs::remove_file(f.root.join("forbidden-marker.continue")).unwrap();
    let key = f
        .local
        .as_ref()
        .unwrap()
        .access(|s| {
            Ok(
                s.read_models()?.unwrap().providers["providers"][0]["auth"]["apiKeyEnv"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            )
        })
        .unwrap();
    drop(f.local.take());
    let receipt = f.root.join("today-child.json");
    let mut child = CrashChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "runtime_host::today_advice_tests::today_child_crash_harness",
                "--ignored",
                "--nocapture",
            ])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("SIDEKICK_TODAY_CHILD_APP", f.root.join("app"))
            .env("SIDEKICK_TODAY_CHILD_RUNTIME", &f.directory)
            .env("SIDEKICK_TODAY_CHILD_RECEIPT", &receipt)
            .env(key, "p3-synthetic-token")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let start = Instant::now();
    while !receipt.exists() {
        if child.0.try_wait().unwrap().is_some() {
            panic!("controlled crash harness exited before receipt");
        }
        assert!(start.elapsed() < Duration::from_secs(8));
        std::thread::sleep(Duration::from_millis(20));
    }
    wait_request(&f, 2);
    let receipt: Value = serde_json::from_slice(&fs::read(receipt).unwrap()).unwrap();
    let pid = receipt["pid"].as_u64().unwrap() as u32;
    let id = receipt["runId"].as_str().unwrap();
    assert!(owned(pid, &f.directory.join("organizer.mjs"), id, None));
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    let started = Instant::now();
    while owned(pid, &f.directory.join("organizer.mjs"), id, None)
        && started.elapsed() < Duration::from_secs(5)
    {
        std::thread::sleep(Duration::from_millis(20));
    }
    if owned(pid, &f.directory.join("organizer.mjs"), id, None) {
        signal_group(pid, "-TERM");
        panic!("owned Runtime survived host loss");
    }
    let reopened = LocalState::new(f.root.join("app"));
    let state = RuntimeState::default()
        .read_today(&reopened, &f.directory)
        .unwrap();
    assert_eq!(state.latest.as_ref().unwrap().id, id);
    assert_eq!(state.latest.unwrap().status, "interrupted");
    assert_eq!(state.last_success.unwrap().id, first.id);
    assert!(f.events("service-0.jsonl").is_empty());
}

struct CrashChild(std::process::Child);
impl Drop for CrashChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}
#[test]
fn today_pure_helper_fails_closed_on_exit_overflow_timeout_and_forged_output() {
    let f = TrialFixture::new("today-normal", true, false);
    let directory = f.root.join("helper");
    fs::create_dir(&directory).unwrap();
    std::os::unix::fs::symlink(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../build/s0-runtime/node")
            .canonicalize()
            .unwrap(),
        directory.join("node"),
    )
    .unwrap();
    for script in [
        "process.exit(1);",
        "process.stdout.write('x'.repeat(1600002));",
        "setInterval(()=>{},1000);",
        "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('{}'));",
    ] {
        fs::write(directory.join("today-facts.mjs"), script).unwrap();
        let started = Instant::now();
        assert_eq!(super::today_advice::derive_facts(&directory,json!({"snapshotId":"controlled","anchorAtMs":1793581200000_i64,"timeZone":"UTC","rawTodos":[]})).unwrap_err().code,"TODAY_FACTS_UNAVAILABLE");
        assert!(started.elapsed() < Duration::from_secs(7));
    }
}
#[test]
fn today_empty_formal_list_never_requests_a_model() {
    let f = TrialFixture::new("today-normal", true, true);
    let status = f
        .local
        .as_ref()
        .unwrap()
        .access(|s| s.today_storage_status())
        .unwrap();
    f.runtime
        .confirm_today_storage(
            f.local.as_ref().unwrap(),
            McpUpgradeInput {
                confirmed: true,
                confirmation_token: status.confirmation_token.unwrap(),
            },
        )
        .unwrap();
    assert_eq!(
        f.runtime
            .start_today(
                f.local.as_ref().unwrap().clone(),
                f.directory.clone(),
                Arc::new(|_, _| {})
            )
            .unwrap_err()
            .code,
        "TODAY_EMPTY"
    );
    assert!(f.runtime.active_run().is_none());
    assert!(f.events("model.jsonl").is_empty());
    let state = f
        .runtime
        .read_today(f.local.as_ref().unwrap(), &f.directory)
        .unwrap();
    assert_eq!(state.facts.counts.open, 0);
    assert!(state.latest.is_none());
}
fn controlled_helper(f: &TrialFixture, exit_on_host_close: bool) -> PathBuf {
    let directory = f.root.join("controlled-helper-runtime");
    fs::create_dir(&directory).unwrap();
    for name in [
        "node",
        "organizer.mjs",
        "bash-worker.mjs",
        "mcp-guardian.mjs",
    ] {
        std::os::unix::fs::symlink(f.directory.join(name), directory.join(name)).unwrap();
    }
    fs::copy(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/today-helper.mjs"),
        directory.join("today-facts.mjs"),
    )
    .unwrap();
    let module = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../shared/today-facts.mjs")
        .canonicalize()
        .unwrap();
    let module = tauri::Url::from_file_path(module).unwrap().to_string();
    fs::write(directory.join("today-helper-control.json"),json!({"ready":f.root.join("helper-ready.json"),"release":f.root.join("helper-release"),"factsModule":module,"exitOnHostClose":exit_on_host_close}).to_string()).unwrap();
    directory
}
fn wait_helper_ready(f: &TrialFixture) -> Value {
    let start = Instant::now();
    while !f.root.join("helper-ready.json").exists() {
        assert!(start.elapsed() < Duration::from_secs(4));
        std::thread::sleep(Duration::from_millis(10));
    }
    serde_json::from_slice(&fs::read(f.root.join("helper-ready.json")).unwrap()).unwrap()
}
#[test]
fn today_preparation_cancel_is_durable_before_helper_release_and_never_starts_model() {
    let f = TrialFixture::new("today-normal", true, true);
    formal(&f);
    let directory = controlled_helper(&f, false);
    let local = f.local.as_ref().unwrap().clone();
    let state = f.runtime.clone();
    let starter = std::thread::spawn(move || {
        state.start_today(local, directory.clone(), Arc::new(|_, _| {}))
    });
    let ready = wait_helper_ready(&f);
    let id = ready["runId"].as_str().unwrap().to_string();
    let state = f.runtime.clone();
    let local = f.local.as_ref().unwrap().clone();
    let (tx, rx) = mpsc::channel();
    let cancel_id = id.clone();
    let canceller = std::thread::spawn(move || {
        state.cancel(&cancel_id);
        let cancelled = local.access(|s| s.cancel_today_advice(&cancel_id));
        let _ = tx.send(cancelled.map(|run| run.status));
    });
    let before_release = rx.recv_timeout(Duration::from_secs(1));
    fs::write(
        f.root.join("helper-release"),
        b"release after cancel checkpoint",
    )
    .unwrap();
    let started = starter.join().unwrap();
    canceller.join().unwrap();
    if let Ok(run) = &started {
        let _ = wait(&f, &run.id);
    }
    assert!(
        matches!(before_release,Ok(Ok(ref status)) if status=="cancelled"),
        "preparation cancellation did not persist before helper release: {before_release:?}"
    );
    assert!(
        f.events("model.jsonl").is_empty(),
        "model was requested after preparation cancellation"
    );
}
fn wait_checkpoint(f: &TrialFixture, id: &str, point: &str) {
    let start = Instant::now();
    while !f
        .runtime
        .trial_events
        .lock()
        .unwrap()
        .iter()
        .any(|event| event["runId"] == id && event["point"] == point)
    {
        assert!(
            start.elapsed() < Duration::from_secs(6),
            "checkpoint {point} missing"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn today_cancel_wins_before_each_preparation_binding_and_dispatch_barrier() {
    for (point, policy) in [
        ("today_before_helper", "hold-today-before-helper"),
        ("today_before_bind", "hold-today-before-bind"),
        ("today_after_bind", "hold-today-after-bind"),
        ("today_before_dispatch", "hold-today-before-dispatch"),
    ] {
        let f = TrialFixture::new("today-normal", true, true);
        formal(&f);
        let before = rows(&f);
        *f.runtime.trial_policy.lock().unwrap() = Some(policy);
        let run = start(&f);
        wait_checkpoint(&f, &run.id, point);
        let stopped = Instant::now();
        f.runtime.cancel(&run.id);
        assert_eq!(
            f.local
                .as_ref()
                .unwrap()
                .access(|s| s.cancel_today_advice(&run.id))
                .unwrap()
                .status,
            "cancelled"
        );
        assert!(stopped.elapsed() < Duration::from_secs(1));
        *f.runtime.trial_policy.lock().unwrap() = None;
        assert_eq!(wait(&f, &run.id).status, "cancelled");
        assert!(
            f.events("model.jsonl").is_empty(),
            "model request after cancellation at {point}"
        );
        assert_eq!(rows(&f), before);
    }
}
#[test]
fn today_preparation_timeout_is_durable_and_cleans_helper_without_model() {
    for short_total in [false, true] {
        let f = TrialFixture::new("today-normal", true, true);
        formal(&f);
        let directory = controlled_helper(&f, true);
        if short_total {
            *f.runtime.trial_policy.lock().unwrap() = Some("today-short-total");
        }
        let start = Instant::now();
        let run = f
            .runtime
            .start_today(
                f.local.as_ref().unwrap().clone(),
                directory.clone(),
                Arc::new(|_, _| {}),
            )
            .unwrap();
        let ready = wait_helper_ready(&f);
        let done = wait(&f, &run.id);
        assert_eq!(done.status, "failed");
        assert_eq!(done.error_code.as_deref(), Some("MODEL_TIMEOUT"));
        assert!(done.snapshot.get("todayPreparation").is_some());
        assert!(start.elapsed() < Duration::from_secs(if short_total { 3 } else { 7 }));
        assert!(f.events("model.jsonl").is_empty());
        assert!(!owned(
            ready["pid"].as_u64().unwrap() as u32,
            &directory.join("today-facts.mjs"),
            &run.id,
            None
        ));
    }
}
#[test]
fn today_cleanup_keeps_the_single_slot_busy_until_owned_helper_is_gone() {
    let f = TrialFixture::new("today-normal", true, true);
    formal(&f);
    let directory = controlled_helper(&f, true);
    *f.runtime.trial_policy.lock().unwrap() = Some("hold-today-cleanup");
    let run = f
        .runtime
        .start_today(
            f.local.as_ref().unwrap().clone(),
            directory.clone(),
            Arc::new(|_, _| {}),
        )
        .unwrap();
    let ready = wait_helper_ready(&f);
    f.runtime.cancel(&run.id);
    f.local
        .as_ref()
        .unwrap()
        .access(|s| s.cancel_today_advice(&run.id))
        .unwrap();
    wait_checkpoint(&f, &run.id, "today_cleanup");
    assert!(!owned(
        ready["pid"].as_u64().unwrap() as u32,
        &directory.join("today-facts.mjs"),
        &run.id,
        None
    ));
    assert_eq!(
        f.runtime
            .start_today(
                f.local.as_ref().unwrap().clone(),
                f.directory.clone(),
                Arc::new(|_, _| {})
            )
            .unwrap_err()
            .code,
        "RUNTIME_BUSY"
    );
    *f.runtime.trial_policy.lock().unwrap() = None;
    assert_eq!(wait(&f, &run.id).status, "cancelled");
    assert_eq!(wait(&f, &start(&f).id).status, "succeeded");
}
#[test]
fn today_read_helper_does_not_block_durable_cancel() {
    let f = TrialFixture::new("today-freeze", true, true);
    formal(&f);
    let run = start(&f);
    wait_request(&f, 1);
    let directory = controlled_helper(&f, true);
    let state = f.runtime.clone();
    let local = f.local.as_ref().unwrap().clone();
    let reader = std::thread::spawn(move || state.read_today(&local, &directory));
    wait_helper_ready(&f);
    let before = Instant::now();
    f.runtime.cancel(&run.id);
    assert_eq!(
        f.local
            .as_ref()
            .unwrap()
            .access(|s| s.cancel_today_advice(&run.id))
            .unwrap()
            .status,
        "cancelled"
    );
    assert!(before.elapsed() < Duration::from_secs(1));
    fs::write(
        f.root.join("helper-release"),
        b"release read after durable cancel",
    )
    .unwrap();
    let state = reader.join().unwrap().unwrap();
    assert_eq!(state.latest.unwrap().status, "cancelled");
    assert_eq!(wait(&f, &run.id).status, "cancelled");
}
#[test]
fn today_read_rechecks_new_active_identity_and_changed_formal_source() {
    for edit in [false, true] {
        let f = TrialFixture::new("today-freeze", true, true);
        formal(&f);
        let directory = controlled_helper(&f, true);
        let state = f.runtime.clone();
        let local = f.local.as_ref().unwrap().clone();
        let reader = std::thread::spawn(move || state.read_today(&local, &directory));
        wait_helper_ready(&f);
        let run = if edit {
            f.local
                .as_ref()
                .unwrap()
                .access(|s| {
                    let old = s.list()?.remove(0);
                    let mut fields = old.fields;
                    fields.title = "合成读取期间已更新".into();
                    s.update(&old.id, old.version, fields, "today-read-edit")?;
                    Ok(())
                })
                .unwrap();
            None
        } else {
            let run = start(&f);
            wait_request(&f, 1);
            Some(run)
        };
        fs::write(f.root.join("helper-release"), b"release read").unwrap();
        let data = reader.join().unwrap().unwrap();
        if let Some(run) = run {
            assert_eq!(data.latest.as_ref().unwrap().id, run.id);
            assert_eq!(data.latest.unwrap().status, "running");
            f.runtime.cancel(&run.id);
            f.local
                .as_ref()
                .unwrap()
                .access(|s| s.cancel_today_advice(&run.id))
                .unwrap();
            assert_eq!(wait(&f, &run.id).status, "cancelled");
        } else {
            assert!(data
                .facts
                .raw_todos
                .iter()
                .any(|todo| todo.fields.title == "合成读取期间已更新"));
        }
    }
}
#[test]
fn today_preparation_host_loss_reaps_helper_and_cold_reopens_raw_history() {
    let mut f = TrialFixture::new("today-normal", true, true);
    formal(&f);
    let first = start(&f);
    assert_eq!(wait(&f, &first.id).status, "succeeded");
    let key = f
        .local
        .as_ref()
        .unwrap()
        .access(|s| {
            Ok(
                s.read_models()?.unwrap().providers["providers"][0]["auth"]["apiKeyEnv"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            )
        })
        .unwrap();
    let directory = controlled_helper(&f, true);
    drop(f.local.take());
    let receipt = f.root.join("today-helper-child.json");
    let mut child = CrashChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "runtime_host::today_advice_tests::today_child_crash_harness",
                "--ignored",
                "--nocapture",
            ])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("SIDEKICK_TODAY_CHILD_APP", f.root.join("app"))
            .env("SIDEKICK_TODAY_CHILD_RUNTIME", &directory)
            .env("SIDEKICK_TODAY_CHILD_RECEIPT", &receipt)
            .env("SIDEKICK_TODAY_CRASH_PHASE", "helper")
            .env(key, "p3-synthetic-token")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let start = Instant::now();
    while !receipt.exists() {
        assert!(child.0.try_wait().unwrap().is_none());
        assert!(start.elapsed() < Duration::from_secs(6));
        std::thread::sleep(Duration::from_millis(10));
    }
    let receipt: Value = serde_json::from_slice(&fs::read(receipt).unwrap()).unwrap();
    let ready = wait_helper_ready(&f);
    assert_eq!(ready["runId"], receipt["runId"]);
    let id = receipt["runId"].as_str().unwrap();
    let pid = receipt["pid"].as_u64().unwrap() as u32;
    assert!(owned(pid, &directory.join("today-facts.mjs"), id, None));
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    let start = Instant::now();
    while owned(pid, &directory.join("today-facts.mjs"), id, None)
        && start.elapsed() < Duration::from_secs(5)
    {
        std::thread::sleep(Duration::from_millis(10));
    }
    if owned(pid, &directory.join("today-facts.mjs"), id, None) {
        signal_group(pid, "-KILL");
        panic!("owned helper survived host EOF");
    }
    let reopened = LocalState::new(f.root.join("app"));
    let state = RuntimeState::default()
        .read_today(&reopened, &f.directory)
        .unwrap();
    assert_eq!(state.latest.as_ref().unwrap().id, id);
    assert_eq!(state.latest.as_ref().unwrap().status, "interrupted");
    assert!(state
        .latest
        .unwrap()
        .snapshot
        .get("todayPreparation")
        .is_some());
    assert_eq!(state.latest_stale, None);
    assert_eq!(state.last_success.unwrap().id, first.id);
    assert_eq!(f.events("model.jsonl").len(), 1);
}
fn edit_helper_control(directory: &Path, key: &str, value: Value) {
    let path = directory.join("today-helper-control.json");
    let mut control: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    control[key] = value;
    fs::write(path, control.to_string()).unwrap();
}
#[test]
fn today_read_crossing_minute_expiry_recomputes_before_claiming_current() {
    let f = TrialFixture::new("today-normal", true, true);
    formal(&f);
    let due = wall_clock_ms() + 1000;
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            let old = s.list()?.remove(0);
            let mut fields = old.fields;
            fields.due = Some(crate::local_store::TimePoint {
                at_ms: due,
                time_zone: "UTC".into(),
                local_text: "合成即将截止".into(),
                precision: "minute".into(),
            });
            s.update(&old.id, old.version, fields, "today-near-boundary")?;
            Ok(())
        })
        .unwrap();
    let directory = controlled_helper(&f, true);
    let state = f.runtime.clone();
    let local = f.local.as_ref().unwrap().clone();
    let reader = std::thread::spawn(move || state.read_today(&local, &directory));
    wait_helper_ready(&f);
    while wall_clock_ms() <= due {
        std::thread::sleep(Duration::from_millis(5));
    }
    fs::write(
        f.root.join("helper-release"),
        b"release after exact minute edge",
    )
    .unwrap();
    let state = reader.join().unwrap().unwrap();
    assert!(state.facts.anchor_at_ms > due);
    assert_eq!(state.facts.counts.overdue, 1);
    assert!(state.facts_valid_until_ms.unwrap() > wall_clock_ms());
    assert!(f.events("model.jsonl").is_empty());
}
#[test]
fn today_read_null_horizon_fails_closed_without_infinite_currentness() {
    let f = TrialFixture::new("today-normal", true, true);
    formal(&f);
    let directory = controlled_helper(&f, true);
    edit_helper_control(&directory, "nullValidity", json!(true));
    fs::write(f.root.join("helper-release"), b"return null validity").unwrap();
    assert_eq!(
        f.runtime
            .read_today(f.local.as_ref().unwrap(), &directory)
            .unwrap_err()
            .code,
        "TODAY_FACTS_CHANGED"
    );
    assert!(f.events("model.jsonl").is_empty());
}
#[test]
fn today_read_retry_shares_one_five_second_budget() {
    let f = TrialFixture::new("today-normal", true, true);
    formal(&f);
    let directory = controlled_helper(&f, true);
    edit_helper_control(&directory, "consumeRelease", json!(true));
    let state = f.runtime.clone();
    let local = f.local.as_ref().unwrap().clone();
    let started = Instant::now();
    let reader = std::thread::spawn(move || state.read_today(&local, &directory));
    wait_helper_ready(&f);
    f.local
        .as_ref()
        .unwrap()
        .access(|s| {
            let old = s.list()?.remove(0);
            let mut fields = old.fields;
            fields.title = "合成迫使重取的更新".into();
            s.update(&old.id, old.version, fields, "today-late-read-edit")?;
            Ok(())
        })
        .unwrap();
    while started.elapsed() < Duration::from_secs(4) {
        std::thread::sleep(Duration::from_millis(10));
    }
    fs::write(f.root.join("helper-release"), b"release first read only").unwrap();
    assert_eq!(
        reader.join().unwrap().unwrap_err().code,
        "TODAY_FACTS_UNAVAILABLE"
    );
    assert!(started.elapsed() < Duration::from_secs(6));
    let ready: Value =
        serde_json::from_slice(&fs::read(f.root.join("helper-ready.json")).unwrap()).unwrap();
    let directory = f.root.join("controlled-helper-runtime");
    assert!(!owned(
        ready["pid"].as_u64().unwrap() as u32,
        &directory.join("today-facts.mjs"),
        "current",
        None
    ));
    assert!(f.events("model.jsonl").is_empty());
}

fn wall_clock_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
