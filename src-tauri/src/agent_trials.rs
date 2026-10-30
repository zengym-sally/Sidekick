use super::*;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub id: String,
    pub agent_id: String,
    pub purpose: String,
    pub status: String,
    pub snapshot: serde_json::Value,
    pub input: TextInput,
    pub result: Option<Vec<CandidateDraft>>,
    pub error_code: Option<String>,
    pub created_at_ms: i64,
    pub finished_at_ms: Option<i64>,
}
fn trial_stopped() -> StoreError {
    StoreError::new("AGENT_TRIAL_STOPPED", "试跑已结束，迟到结果未应用。")
}
impl AppStore {
    pub fn agent_run(&self, id: &str) -> Result<AgentRun> {
        let r=self.db()?.query_row("SELECT id,agent_id,purpose,status,snapshot_json,input_json,result_json,error_code,created_at_ms,finished_at_ms FROM agent_runs WHERE id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,i64>(8)?,r.get::<_,Option<i64>>(9)?))).map_err(db_error)?;
        Ok(AgentRun {
            id: r.0,
            agent_id: r.1,
            purpose: r.2,
            status: r.3,
            snapshot: serde_json::from_str(&r.4).map_err(|_| invalid())?,
            input: serde_json::from_str(&r.5).map_err(|_| invalid())?,
            result: r
                .6
                .map(|x| serde_json::from_str(&x).map_err(|_| invalid()))
                .transpose()?,
            error_code: r.7,
            created_at_ms: r.8,
            finished_at_ms: r.9,
        })
    }
    pub fn latest_agent_trial(&self, id: &str) -> Result<Option<AgentRun>> {
        use rusqlite::OptionalExtension;
        self.agent_config(id)?;
        let found: Option<String> = self
            .db()?
            .query_row(
                "SELECT id FROM agent_runs WHERE agent_id=?1 ORDER BY rowid DESC LIMIT 1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        found.map(|id| self.agent_run(&id)).transpose()
    }
    #[cfg(test)]
    pub fn begin_agent_trial(&mut self, id: &str, input: TextInput) -> Result<AgentRun> {
        let prepared = self.prepare_agent_model(id)?;
        self.begin_prepared_agent_trial(id, input, prepared.snapshot)
    }
    pub(crate) fn begin_prepared_agent_trial(
        &mut self,
        id: &str,
        input: TextInput,
        snapshot: serde_json::Value,
    ) -> Result<AgentRun> {
        if id != "organizer" {
            return Err(StoreError::new(
                "AGENT_TRIAL_UNAVAILABLE",
                "这个角色暂未开放试跑，可先保存偏好。",
            ));
        }
        if input.text.trim().is_empty()
            || input.text.chars().count() > 64000
            || input.text.contains('\0')
            || input.time_zone.is_empty()
            || input.time_zone.len() > 128
            || input
                .source_at_ms
                .is_some_and(|v| v.unsigned_abs() > 8_640_000_000_000_000)
        {
            return Err(invalid());
        }
        let created = now_ms()?;
        let key = format!("trial-{}-{}", std::process::id(), nonce());
        self.db()?.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(?1,?2,'role_trial','running',?3,?4,?5)",params![key,id,serde_json::to_string(&snapshot).map_err(|_|invalid())?,serde_json::to_string(&input).map_err(|_|invalid())?,created]).map_err(db_error)?;
        self.agent_run(&key)
    }
    pub(crate) fn bind_trial_skills(
        &self,
        id: &str,
        skills: serde_json::Value,
    ) -> Result<AgentRun> {
        let run = self.agent_run(id)?;
        if run.status != "running" {
            return Err(trial_stopped());
        }
        let mut snapshot = run.snapshot;
        snapshot["skills"] = skills;
        self.db()?
            .execute(
                "UPDATE agent_runs SET snapshot_json=?2 WHERE id=?1 AND status='running'",
                params![id, serde_json::to_string(&snapshot).map_err(|_| invalid())?],
            )
            .map_err(db_error)?;
        self.agent_run(id)
    }
    pub fn complete_agent_trial(
        &mut self,
        id: &str,
        drafts: Vec<CandidateDraft>,
    ) -> Result<AgentRun> {
        let run = self.agent_run(id)?;
        if run.status != "running" {
            return Err(trial_stopped());
        }
        if drafts.len() > 50 {
            return Err(invalid());
        }
        let source = TextSource {
            id: String::new(),
            raw_text: run.input.text.clone(),
            source_at_ms: run.input.source_at_ms,
            imported_at_ms: run.created_at_ms,
            anchor_at_ms: run.input.source_at_ms.unwrap_or(run.created_at_ms),
            time_zone: run.input.time_zone.clone(),
            succeeded_run_id: None,
        };
        let drafts = drafts
            .into_iter()
            .map(|d| ingestion::validate_draft(d, &source))
            .collect::<Result<Vec<_>>>()?;
        let n=self.db()?.execute("UPDATE agent_runs SET status='succeeded',result_json=?2,finished_at_ms=?3 WHERE id=?1 AND status='running'",params![id,serde_json::to_string(&drafts).map_err(|_|invalid())?,now_ms()?]).map_err(db_error)?;
        if n != 1 {
            return Err(trial_stopped());
        }
        self.agent_run(id)
    }
    pub fn finish_agent_trial_error(&mut self, id: &str, code: &str) -> Result<AgentRun> {
        if code.len() > 64 || !code.bytes().all(|c| c.is_ascii_uppercase() || c == b'_') {
            return Err(invalid());
        }
        self.db()?.execute("UPDATE agent_runs SET status='failed',error_code=?2,finished_at_ms=?3 WHERE id=?1 AND status='running'",params![id,code,now_ms()?]).map_err(db_error)?;
        self.agent_run(id)
    }
    pub fn cancel_agent_trial(&mut self, id: &str) -> Result<AgentRun> {
        self.db()?.execute("UPDATE agent_runs SET status='cancelled',error_code='CANCELLED',finished_at_ms=?2 WHERE id=?1 AND status='running'",params![id,now_ms()?]).map_err(db_error)?;
        self.agent_run(id)
    }
    pub fn interrupt_agent_trials(&mut self, owned: Option<&str>) -> Result<()> {
        self.db()?.execute("UPDATE agent_runs SET status='interrupted',error_code='INTERRUPTED',finished_at_ms=?1 WHERE status='running' AND (?2 IS NULL OR id<>?2)",params![now_ms()?,owned]).map_err(db_error)?;
        Ok(())
    }
}
