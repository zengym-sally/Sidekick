use super::*;
use crate::local_store::{
    McpSchemaUpgrade, McpStorageStatus, McpUpgradeInput, TodayAdviceRun, TodayAdviceState,
    TodayFacts,
};
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FactsReceipt {
    version: u32,
    facts: TodayFacts,
    valid_until_ms: Option<i64>,
}
fn facts_error() -> StoreError {
    error(
        "TODAY_FACTS_UNAVAILABLE",
        "当前事项事实暂无法核对，已保留本地清单；请重新读取。",
    )
}
fn timeout() -> StoreError {
    error("MODEL_TIMEOUT", "核对或生成已超时，未启动新的模型请求。")
}
fn changed() -> StoreError {
    error(
        "TODAY_FACTS_CHANGED",
        "事项、时区或当前时间边界已有变化，请重新核对。",
    )
}
fn now() -> Result<i64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| facts_error())?
        .as_millis()
        .try_into()
        .map_err(|_| facts_error())
}
fn derive_receipt(
    directory: &Path,
    input: Value,
    job: Option<&Job>,
    budget: Instant,
) -> Result<FactsReceipt> {
    if job.is_some_and(|job| job.cancel.load(Ordering::SeqCst)) {
        return Err(error("CANCELLED", "本次核对已取消。"));
    }
    let deadline = (Instant::now() + Duration::from_secs(5)).min(budget);
    if Instant::now() >= deadline {
        return Err(if job.is_some() {
            timeout()
        } else {
            facts_error()
        });
    }
    let mut bytes = serde_json::to_vec(&input).map_err(|_| facts_error())?;
    if bytes.len() + 1 > 1_600_000 {
        return Err(facts_error());
    }
    bytes.push(b'\n');
    let id = input["snapshotId"].as_str().ok_or_else(facts_error)?;
    let mut command = Command::new(directory.join("node"));
    command
        .arg(directory.join("today-facts.mjs"))
        .args(["--run", id]);
    if let Some(job) = job {
        command.args(["--nonce", &job.nonce]);
    }
    let mut child = command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| facts_error())?;
    let pid = child.id();
    if let Some(job) = job {
        job.pid.store(pid, Ordering::SeqCst);
    }
    let mut stdin = child.stdin.take().ok_or_else(facts_error)?;
    let stdout = child.stdout.take().ok_or_else(facts_error)?;
    let writer = std::thread::spawn(move || {
        stdin.write_all(&bytes)?;
        Ok::<_, std::io::Error>(stdin)
    });
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(1_600_001)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let status = loop {
        if job.is_some_and(|job| job.cancel.load(Ordering::SeqCst)) {
            break Err(error("CANCELLED", "本次核对已取消。"));
        }
        if Instant::now() >= deadline {
            break Err(if job.is_some() {
                timeout()
            } else {
                facts_error()
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break Err(facts_error()),
        }
    };
    if status.is_err() {
        signal_group(pid, "-KILL");
        let _ = child.kill();
        let _ = child.wait();
    }
    let written = writer
        .join()
        .map_err(|_| facts_error())?
        .map_err(|_| facts_error());
    let output = reader
        .join()
        .map_err(|_| facts_error())?
        .map_err(|_| facts_error())?;
    if let Some(job) = job {
        let _ = job
            .pid
            .compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst);
    }
    let status = status?;
    if !status.success() || written.is_err() || output.len() > 1_600_000 {
        return Err(facts_error());
    }
    let raw: Value = serde_json::from_slice(&output).map_err(|_| facts_error())?;
    for key in ["rawTodos", "snapshotId", "anchorAtMs", "timeZone"] {
        if raw["facts"][key] != input[key] {
            return Err(facts_error());
        }
    }
    let receipt: FactsReceipt = serde_json::from_value(raw).map_err(|_| facts_error())?;
    if receipt.version != 1 {
        return Err(facts_error());
    }
    if receipt.valid_until_ms.is_some_and(|until| {
        until <= receipt.facts.anchor_at_ms || until.unsigned_abs() > 8_640_000_000_000_000
    }) {
        return Err(facts_error());
    }
    Ok(receipt)
}
#[cfg(test)]
pub(super) fn derive_facts(directory: &Path, input: Value) -> Result<TodayFacts> {
    derive_receipt(
        directory,
        input,
        None,
        Instant::now() + Duration::from_secs(5),
    )
    .map(|receipt| receipt.facts)
}
fn own_job(state: &RuntimeState, job: &Job) -> Result<()> {
    let slot = state.slot.lock().map_err(|_| busy())?;
    if !slot.as_ref().is_some_and(|active| {
        active.kind == JobKind::Today && active.run_id == job.run_id && active.nonce == job.nonce
    }) {
        return Err(error("TODAY_ADVICE_STOPPED", "本次建议不再属于当前运行。"));
    }
    if job.cancel.load(Ordering::SeqCst) {
        return Err(error("CANCELLED", "本次核对已取消。"));
    }
    Ok(())
}
#[cfg(test)]
fn checkpoint(state: &RuntimeState, job: &Job, point: &'static str) {
    state.test_trial_checkpoint(job, point, json!({}));
    let policy = match point {
        "today_before_helper" => "hold-today-before-helper",
        "today_before_bind" => "hold-today-before-bind",
        "today_after_bind" => "hold-today-after-bind",
        "today_cleanup" => "hold-today-cleanup",
        _ => return,
    };
    let start = Instant::now();
    while *state.trial_policy.lock().unwrap() == Some(policy)
        && (point == "today_cleanup" || !job.cancel.load(Ordering::SeqCst))
        && start.elapsed() < Duration::from_secs(5)
    {
        std::thread::sleep(Duration::from_millis(10));
    }
}
impl RuntimeState {
    fn clear_today_job(&self, job: &Job) {
        if let Ok(mut slot) = self.slot.lock() {
            if slot
                .as_ref()
                .is_some_and(|active| active.run_id == job.run_id && active.nonce == job.nonce)
            {
                *slot = None;
            }
        }
    }
    fn prepare_today(
        &self,
        local: LocalState,
        directory: PathBuf,
        job: Job,
        key: String,
        deadline: Instant,
        sink: Sink,
    ) {
        let state = self.clone();
        std::thread::spawn(move || {
            let work_deadline = deadline - Duration::from_secs(1);
            let prepared = (|| -> Result<Value> {
                #[cfg(test)]
                checkpoint(&state, &job, "today_before_helper");
                own_job(&state, &job)?;
                if Instant::now() >= work_deadline {
                    return Err(timeout());
                }
                let input = local.access(|s| {
                    let run = s.today_advice_run(&job.run_id)?;
                    if run.status != "running" {
                        return Err(error("TODAY_ADVICE_STOPPED", "本次建议已结束。"));
                    }
                    Ok(run.snapshot["todayPreparation"]["input"].clone())
                })?;
                let receipt = derive_receipt(&directory, input, Some(&job), work_deadline)?;
                #[cfg(test)]
                checkpoint(&state, &job, "today_before_bind");
                if Instant::now() >= work_deadline {
                    return Err(timeout());
                }
                let run = {
                    let slot = state.slot.lock().map_err(|_| busy())?;
                    if !slot.as_ref().is_some_and(|active| {
                        active.run_id == job.run_id && active.nonce == job.nonce
                    }) || job.cancel.load(Ordering::SeqCst)
                    {
                        return Err(error("CANCELLED", "本次核对已取消。"));
                    }
                    local.access(|s| s.bind_today_advice_facts(&job.run_id, receipt.facts))?
                };
                #[cfg(test)]
                checkpoint(&state, &job, "today_after_bind");
                own_job(&state, &job)?;
                if Instant::now() >= work_deadline {
                    return Err(timeout());
                }
                let cwd = local.access(|s| s.run_directory(&job.run_id))?;
                let remaining = work_deadline
                    .saturating_duration_since(Instant::now())
                    .as_millis() as u64;
                if remaining == 0 {
                    return Err(timeout());
                }
                let payload = json!({"runId":run.id,"kind":"today","snapshot":run.snapshot,"mcp":null,"apiKey":key,"cwd":cwd,"runLimitMs":remaining,"anchorAtMs":run.snapshot["todayFacts"]["anchorAtMs"],"source":{"rawText":"Read-only today advice.","timeZone":run.snapshot["todayFacts"]["timeZone"]}});
                if serde_json::to_vec(&payload)
                    .map_err(|_| facts_error())?
                    .len()
                    + 1
                    > 1_600_000
                {
                    return Err(facts_error());
                }
                Ok(payload)
            })();
            match prepared {
                Ok(payload) => state.launch(local, directory, job, payload, sink, Some(deadline)),
                Err(failure) => {
                    let stored = local.access(|s| {
                        if job.cancel.load(Ordering::SeqCst) || failure.code == "CANCELLED" {
                            s.cancel_today_advice(&job.run_id)
                        } else {
                            s.finish_today_advice_error(&job.run_id, failure.code)
                        }
                    });
                    #[cfg(test)]
                    checkpoint(&state, &job, "today_cleanup");
                    state.clear_today_job(&job);
                    sink(
                        &job.run_id,
                        if stored.is_ok() {
                            "changed"
                        } else {
                            "storage_error"
                        },
                    );
                }
            }
        });
    }
    pub(crate) fn start_today(
        &self,
        local: LocalState,
        directory: PathBuf,
        sink: Sink,
    ) -> Result<TodayAdviceRun> {
        let started = Instant::now();
        #[cfg(test)]
        let total = if *self.trial_policy.lock().unwrap() == Some("today-short-total") {
            Duration::from_secs(2)
        } else {
            Duration::from_secs(120)
        };
        #[cfg(not(test))]
        let total = Duration::from_secs(120);
        let deadline = started + total;
        let mut slot = self.slot.lock().map_err(|_| busy())?;
        if slot.is_some() {
            return Err(busy());
        }
        let id = format!("today-{}-{}", std::process::id(), crate::mcp_host::nonce());
        let anchor = now()?;
        let (run, key) = local.access(|s| {
            s.interrupt_unowned_runs()?;
            s.interrupt_agent_trials(None)?;
            s.interrupt_today_advice(None)?;
            if s.today_storage_status()?.version != 5 {
                return Err(error(
                    "TODAY_SCHEMA_REQUIRED",
                    "请先核对备份说明并升级今日建议存储。",
                ));
            }
            let prepared = s.prepare_agent_model("advisor")?;
            if Instant::now() >= deadline - Duration::from_secs(1) {
                return Err(timeout());
            }
            let input = s.today_fact_input(&id, anchor)?;
            let run = s.begin_preparing_today_advice(prepared.snapshot, input)?;
            Ok((run, prepared.api_key))
        })?;
        let job = Job {
            run_id: run.id.clone(),
            kind: JobKind::Today,
            nonce: crate::mcp_host::nonce(),
            server_id: None,
            mcp_owner: Default::default(),
            mcp_intent: Default::default(),
            mcp_trial: Default::default(),
            cancel: Arc::new(AtomicBool::new(false)),
            pid: Arc::new(AtomicU32::new(0)),
            workers: Default::default(),
        };
        *slot = Some(job.clone());
        drop(slot);
        self.prepare_today(local, directory, job, key, deadline, sink.clone());
        sink(&run.id, "started");
        Ok(run)
    }
    pub(crate) fn read_today(
        &self,
        local: &LocalState,
        directory: &Path,
    ) -> Result<TodayAdviceState> {
        let budget = Instant::now() + Duration::from_secs(5);
        for attempt in 0..2 {
            if Instant::now() >= budget {
                return Err(facts_error());
            }
            let input = {
                let slot = self.slot.try_lock().map_err(|_| busy())?;
                let active = slot
                    .as_ref()
                    .filter(|job| job.kind == JobKind::Today)
                    .map(|job| job.run_id.clone());
                local.access(|s| {
                    s.interrupt_today_advice(active.as_deref())?;
                    s.today_fact_input("current", now()?)
                })?
            };
            let receipt = derive_receipt(directory, input.clone(), None, budget)?;
            let result = (|| {
                let slot = self.slot.try_lock().map_err(|_| busy())?;
                let active = slot
                    .as_ref()
                    .filter(|job| job.kind == JobKind::Today)
                    .map(|job| job.run_id.clone());
                local.access(|s| {
                    s.interrupt_today_advice(active.as_deref())?;
                    if s.today_fact_input("current", receipt.facts.anchor_at_ms)? != input {
                        return Err(changed());
                    }
                    let mut state = s.today_advice_state(receipt.facts)?;
                    let at = now()?;
                    if !receipt
                        .valid_until_ms
                        .is_some_and(|until| state.facts.anchor_at_ms <= at && at < until)
                        || Instant::now() >= budget
                    {
                        return Err(changed());
                    }
                    state.facts_valid_until_ms = receipt.valid_until_ms;
                    Ok(state)
                })
            })();
            match result {
                Err(error) if error.code == "TODAY_FACTS_CHANGED" && attempt == 0 => continue,
                result => return result,
            }
        }
        Err(changed())
    }
    pub(crate) fn confirm_today_storage(
        &self,
        local: &LocalState,
        input: McpUpgradeInput,
    ) -> Result<McpSchemaUpgrade> {
        let slot = self.slot.lock().map_err(|_| busy())?;
        if slot.is_some() {
            return Err(busy());
        }
        local.access(|s| s.confirm_today_upgrade(input))
    }
}
#[tauri::command]
pub async fn start_today_advice(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
) -> Result<TodayAdviceRun> {
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| facts_error())?
        .join("s0-runtime");
    let local = local.inner().clone();
    let runtime = runtime.inner().clone();
    let sink: Sink = Arc::new(move |id, phase| {
        let _ = app.emit("today-advice-changed", json!({"runId":id,"phase":phase}));
    });
    tauri::async_runtime::spawn_blocking(move || runtime.start_today(local, directory, sink))
        .await
        .map_err(|_| facts_error())?
}
#[tauri::command]
pub async fn read_today_advice(
    app: tauri::AppHandle,
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
) -> Result<TodayAdviceState> {
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| facts_error())?
        .join("s0-runtime");
    let local = local.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.read_today(&local, &directory))
        .await
        .map_err(|_| facts_error())?
}
#[tauri::command]
pub async fn cancel_today_advice(
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    id: String,
) -> Result<TodayAdviceRun> {
    runtime.cancel(&id);
    let local = local.inner().clone();
    tauri::async_runtime::spawn_blocking(move || local.access(|s| s.cancel_today_advice(&id)))
        .await
        .map_err(|_| facts_error())?
}
#[tauri::command]
pub async fn read_today_storage_status(local: State<'_, LocalState>) -> Result<McpStorageStatus> {
    let local = local.inner().clone();
    tauri::async_runtime::spawn_blocking(move || local.access(|s| s.today_storage_status()))
        .await
        .map_err(|_| facts_error())?
}
#[tauri::command]
pub async fn confirm_today_storage_upgrade(
    local: State<'_, LocalState>,
    runtime: State<'_, RuntimeState>,
    input: McpUpgradeInput,
) -> Result<McpSchemaUpgrade> {
    let local = local.inner().clone();
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.confirm_today_storage(&local, input))
        .await
        .map_err(|_| {
            error(
                "TODAY_SCHEMA_UNCERTAIN",
                "升级结果未确认，请关闭并重开应用核对。",
            )
        })?
}
