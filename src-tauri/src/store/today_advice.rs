use super::*;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodayFactTodo {
    pub id: String,
    pub version: i64,
    pub title: String,
    pub kind: String,
    pub owner: String,
    pub priority: String,
    pub tags: Vec<String>,
    pub status: String,
    pub due_date: Option<String>,
    pub followup_date: Option<String>,
    pub overdue: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodayCounts {
    pub total: usize,
    pub open: usize,
    pub completed: usize,
    pub deleted: usize,
    pub due_today: usize,
    pub followup_today: usize,
    pub undated: usize,
    pub overdue: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodayFacts {
    pub schema_version: u32,
    pub snapshot_id: String,
    pub anchor_at_ms: i64,
    pub time_zone: String,
    pub date: String,
    pub raw_todos: Vec<Todo>,
    pub todos: Vec<TodayFactTodo>,
    pub counts: TodayCounts,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodayAdviceResult {
    pub kind: String,
    pub version: u32,
    pub snapshot_id: String,
    pub date: String,
    pub time_zone: String,
    pub ranking: Vec<AdvisorRecommendation>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayAdviceRun {
    pub id: String,
    pub agent_id: String,
    pub purpose: String,
    pub status: String,
    pub snapshot: serde_json::Value,
    pub result: Option<TodayAdviceResult>,
    pub error_code: Option<String>,
    pub created_at_ms: i64,
    pub finished_at_ms: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayAdviceState {
    pub facts: TodayFacts,
    pub latest: Option<TodayAdviceRun>,
    pub last_success: Option<TodayAdviceRun>,
    pub latest_stale: Option<bool>,
    pub facts_valid_until_ms: Option<i64>,
    pub last_success_stale: bool,
    pub storage_version: i64,
}
fn invalid_today() -> StoreError {
    StoreError::new(
        "MODEL_INVALID_OUTPUT",
        "今日建议与本次事项事实不一致，未应用结果。",
    )
}
fn stopped() -> StoreError {
    StoreError::new(
        "TODAY_ADVICE_STOPPED",
        "本次今日建议已结束，迟到结果未应用。",
    )
}
pub(super) fn facts_changed(left: &TodayFacts, right: &TodayFacts) -> bool {
    left.schema_version != right.schema_version
        || left.time_zone != right.time_zone
        || left.date != right.date
        || left.raw_todos != right.raw_todos
        || left.todos != right.todos
        || left.counts != right.counts
}
fn validate_facts(facts: &TodayFacts) -> Result<()> {
    if facts.schema_version != 1
        || facts.date.len() != 10
        || facts.todos.len() != facts.raw_todos.len()
    {
        return Err(invalid_today());
    }
    let mut seen = std::collections::BTreeSet::new();
    for (row, raw) in facts.todos.iter().zip(&facts.raw_todos) {
        if !seen.insert(&row.id)
            || row.id != raw.id
            || row.version != raw.version
            || row.title != raw.fields.title
            || row.kind != raw.fields.kind
            || row.owner != raw.fields.owner
            || row.priority != raw.fields.priority
            || row.tags != raw.fields.tags
            || row.status != raw.status
            || !["open", "completed", "deleted"].contains(&row.status.as_str())
            || row.due_date.is_some() != raw.fields.due.is_some()
            || row.followup_date.is_some() != raw.fields.followup.is_some()
            || row.status != "open" && row.overdue
        {
            return Err(invalid_today());
        }
    }
    let open: Vec<_> = facts.todos.iter().filter(|t| t.status == "open").collect();
    let counts = TodayCounts {
        total: facts.todos.iter().filter(|t| t.status != "deleted").count(),
        open: open.len(),
        completed: facts
            .todos
            .iter()
            .filter(|t| t.status == "completed")
            .count(),
        deleted: facts.todos.iter().filter(|t| t.status == "deleted").count(),
        due_today: open
            .iter()
            .filter(|t| t.due_date.as_deref() == Some(&facts.date))
            .count(),
        followup_today: open
            .iter()
            .filter(|t| t.followup_date.as_deref() == Some(&facts.date))
            .count(),
        undated: open
            .iter()
            .filter(|t| t.due_date.is_none() && t.followup_date.is_none())
            .count(),
        overdue: open.iter().filter(|t| t.overdue).count(),
    };
    if counts != facts.counts {
        return Err(invalid_today());
    }
    Ok(())
}
fn validate_result(result: &TodayAdviceResult, facts: &TodayFacts) -> Result<()> {
    validate_facts(facts)?;
    if result.kind != "today_advice"
        || result.version != 1
        || result.snapshot_id != facts.snapshot_id
        || result.date != facts.date
        || result.time_zone != facts.time_zone
        || !result.ranking.is_empty() && result.ranking.len() != facts.counts.open
    {
        return Err(invalid_today());
    }
    let mut seen = std::collections::BTreeSet::new();
    for item in &result.ranking {
        let todo = facts
            .todos
            .iter()
            .find(|todo| {
                todo.id == item.todo_id
                    && todo.version == item.todo_version
                    && todo.status == "open"
            })
            .ok_or_else(invalid_today)?;
        if !seen.insert(&item.todo_id) || item.reasons.is_empty() || item.reasons.len() > 3 {
            return Err(invalid_today());
        }
        let mut reasons = std::collections::BTreeSet::new();
        for reason in &item.reasons {
            if !reasons.insert((
                &reason.code,
                &reason.related_todo_id,
                reason.related_todo_version,
            )) {
                return Err(invalid_today());
            }
            let valid = if reason.code == "earlier_due" {
                let other = facts
                    .todos
                    .iter()
                    .find(|other| {
                        Some(other.id.as_str()) == reason.related_todo_id.as_deref()
                            && Some(other.version) == reason.related_todo_version
                            && other.status == "open"
                    })
                    .ok_or_else(invalid_today)?;
                other.id != todo.id
                    && matches!((&todo.due_date,&other.due_date),(Some(left),Some(right)) if left<right)
            } else {
                if reason.related_todo_id.is_some() || reason.related_todo_version.is_some() {
                    return Err(invalid_today());
                }
                match reason.code.as_str() {
                    "due_today" => todo.due_date.as_deref() == Some(&facts.date),
                    "followup_today" => todo.followup_date.as_deref() == Some(&facts.date),
                    "upcoming_due" => todo
                        .due_date
                        .as_ref()
                        .is_some_and(|date| date > &facts.date),
                    "undated" => todo.due_date.is_none() && todo.followup_date.is_none(),
                    "open_action" => todo.kind == "action",
                    "open_followup" => todo.kind == "followup",
                    "overdue" => todo.overdue,
                    _ => false,
                }
            };
            if !valid {
                return Err(invalid_today());
            }
        }
    }
    Ok(())
}

fn input_from_facts(facts: &TodayFacts) -> serde_json::Value {
    json!({"snapshotId":facts.snapshot_id,"anchorAtMs":facts.anchor_at_ms,"timeZone":facts.time_zone,"rawTodos":facts.raw_todos})
}
fn validate_input(input: &serde_json::Value, id: &str) -> Result<()> {
    let object = input.as_object().ok_or_else(invalid_today)?;
    if object.len() != 4
        || !["snapshotId", "anchorAtMs", "timeZone", "rawTodos"]
            .iter()
            .all(|key| object.contains_key(*key))
        || input["snapshotId"] != id
        || id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        || input["anchorAtMs"]
            .as_i64()
            .is_none_or(|at| at.unsigned_abs() > 8_640_000_000_000_000)
        || input["timeZone"]
            .as_str()
            .is_none_or(|zone| zone.is_empty() || zone.len() > 128)
    {
        return Err(invalid_today());
    }
    let raw: Vec<Todo> =
        serde_json::from_value(input["rawTodos"].clone()).map_err(|_| invalid_today())?;
    if serde_json::to_value(&raw).map_err(|_| invalid_today())? != input["rawTodos"] {
        return Err(invalid_today());
    }
    let mut seen = std::collections::BTreeSet::new();
    for row in raw {
        if row.version < 1
            || !["open", "completed", "deleted"].contains(&row.status.as_str())
            || !seen.insert(row.id)
        {
            return Err(invalid_today());
        }
    }
    Ok(())
}
fn preparation_input(snapshot: &serde_json::Value) -> Result<Option<serde_json::Value>> {
    let Some(value) = snapshot.get("todayPreparation") else {
        return Ok(None);
    };
    let object = value.as_object().ok_or_else(invalid_today)?;
    if object.len() != 2 || value["version"] != 1 || !object.contains_key("input") {
        return Err(invalid_today());
    }
    let input = value["input"].clone();
    let id = input["snapshotId"].as_str().ok_or_else(invalid_today)?;
    validate_input(&input, id)?;
    Ok(Some(input))
}
impl AppStore {
    pub(crate) fn today_fact_input(&self, id: &str, anchor: i64) -> Result<serde_json::Value> {
        let mut rows = self.list()?;
        rows.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(
            json!({"snapshotId":id,"anchorAtMs":anchor,"timeZone":self.application_settings()?.time_zone,"rawTodos":rows}),
        )
    }

    fn insert_today_advice(
        &mut self,
        mut snapshot: serde_json::Value,
        input: serde_json::Value,
        facts: Option<TodayFacts>,
    ) -> Result<TodayAdviceRun> {
        if self
            .db()?
            .pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .map_err(db_error)?
            != 5
        {
            return Err(StoreError::new(
                "TODAY_SCHEMA_REQUIRED",
                "请先核对备份说明并升级今日建议存储。",
            ));
        }
        let id = input["snapshotId"].as_str().ok_or_else(invalid_today)?;
        let anchor = input["anchorAtMs"].as_i64().ok_or_else(invalid_today)?;
        validate_input(&input, id)?;
        if self.today_fact_input(id, anchor)? != input {
            return Err(StoreError::new(
                "TODAY_FACTS_CHANGED",
                "事项或时区已有变化，请刷新后重试。",
            ));
        }
        if snapshot["agent"]["agentId"] != "advisor"
            || [
                "skills",
                "advisorSample",
                "trackerSample",
                "todayFacts",
                "todayPreparation",
            ]
            .iter()
            .any(|key| snapshot.get(key).is_some())
        {
            return Err(invalid_today());
        }
        let raw: Vec<Todo> =
            serde_json::from_value(input["rawTodos"].clone()).map_err(|_| invalid_today())?;
        if !raw.iter().any(|todo| todo.status == "open") {
            return Err(StoreError::new(
                "TODAY_EMPTY",
                "当前没有开放事项，已保留事实版。",
            ));
        }
        if let Some(facts) = facts {
            validate_facts(&facts)?;
            if input_from_facts(&facts) != input {
                return Err(invalid_today());
            }
            snapshot["todayFacts"] = serde_json::to_value(facts).map_err(|_| invalid_today())?;
        } else {
            snapshot["todayPreparation"] = json!({"version":1,"input":input});
        }
        let stored_input = json!({"version":1,"factsInput":input});
        self.db()?.execute("INSERT INTO agent_runs(id,agent_id,purpose,status,snapshot_json,input_json,created_at_ms) VALUES(?1,'advisor','today_advice','running',?2,?3,?4)",params![id,serde_json::to_string(&snapshot).map_err(|_|invalid_today())?,stored_input.to_string(),anchor]).map_err(db_error)?;
        self.today_advice_run(id)
    }
    pub(crate) fn begin_preparing_today_advice(
        &mut self,
        snapshot: serde_json::Value,
        input: serde_json::Value,
    ) -> Result<TodayAdviceRun> {
        self.insert_today_advice(snapshot, input, None)
    }
    #[cfg(test)]
    pub(crate) fn begin_today_advice(
        &mut self,
        snapshot: serde_json::Value,
        facts: TodayFacts,
    ) -> Result<TodayAdviceRun> {
        let input = input_from_facts(&facts);
        self.insert_today_advice(snapshot, input, Some(facts))
    }
    pub(crate) fn bind_today_advice_facts(
        &mut self,
        id: &str,
        facts: TodayFacts,
    ) -> Result<TodayAdviceRun> {
        let run = self.today_advice_run(id)?;
        if run.status != "running" || run.snapshot.get("todayFacts").is_some() {
            return Err(stopped());
        }
        validate_facts(&facts)?;
        let expected = preparation_input(&run.snapshot)?.ok_or_else(invalid_today)?;
        if input_from_facts(&facts) != expected {
            return Err(invalid_today());
        }
        if self.today_fact_input(id, facts.anchor_at_ms)? != expected {
            return Err(StoreError::new(
                "TODAY_FACTS_CHANGED",
                "事项或时区已有变化，本次建议未进入模型。",
            ));
        }
        let mut snapshot = run.snapshot;
        snapshot
            .as_object_mut()
            .ok_or_else(invalid_today)?
            .remove("todayPreparation");
        snapshot["todayFacts"] = serde_json::to_value(facts).map_err(|_| invalid_today())?;
        let changed=self.db()?.execute("UPDATE agent_runs SET snapshot_json=?2 WHERE id=?1 AND purpose='today_advice' AND agent_id='advisor' AND status='running' AND json_type(snapshot_json,'$.todayPreparation')='object' AND json_type(snapshot_json,'$.todayFacts') IS NULL",params![id,snapshot.to_string()]).map_err(db_error)?;
        if changed != 1 {
            return Err(stopped());
        }
        self.today_advice_run(id)
    }
    pub fn today_advice_run(&self, id: &str) -> Result<TodayAdviceRun> {
        let row=self.db()?.query_row("SELECT id,agent_id,purpose,status,snapshot_json,result_json,error_code,created_at_ms,finished_at_ms,input_json FROM agent_runs WHERE id=?1 AND purpose='today_advice' AND agent_id='advisor'",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,i64>(7)?,r.get::<_,Option<i64>>(8)?,r.get::<_,String>(9)?))).map_err(db_error)?;
        let snapshot: serde_json::Value =
            serde_json::from_str(&row.4).map_err(|_| invalid_today())?;
        let facts: Option<TodayFacts> = snapshot
            .get("todayFacts")
            .map(|value| serde_json::from_value(value.clone()).map_err(|_| invalid_today()))
            .transpose()?;
        let preparation = preparation_input(&snapshot)?;
        if facts.is_some() == preparation.is_some() {
            return Err(invalid_today());
        }
        if let Some(facts) = &facts {
            validate_facts(facts)?;
            if facts.snapshot_id != row.0 {
                return Err(invalid_today());
            }
        }
        let stored: serde_json::Value =
            serde_json::from_str(&row.9).map_err(|_| invalid_today())?;
        if stored.get("version").is_some() {
            if stored.as_object().is_none_or(|map| map.len() != 2) || stored["version"] != 1 {
                return Err(invalid_today());
            }
            validate_input(&stored["factsInput"], &row.0)?;
            let expected = if let Some(facts) = &facts {
                input_from_facts(facts)
            } else {
                preparation.clone().ok_or_else(invalid_today)?
            };
            if stored["factsInput"] != expected {
                return Err(invalid_today());
            }
        } else if facts.is_none() || stored != json!({"snapshotId":row.0}) {
            return Err(invalid_today());
        }
        let result: Option<TodayAdviceResult> = row
            .5
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| invalid_today())?;
        if row.3 == "succeeded" {
            let facts = facts.as_ref().ok_or_else(invalid_today)?;
            validate_result(result.as_ref().ok_or_else(invalid_today)?, facts)?;
        } else if result.is_some() {
            return Err(invalid_today());
        }
        Ok(TodayAdviceRun {
            id: row.0,
            agent_id: row.1,
            purpose: row.2,
            status: row.3,
            snapshot,
            result,
            error_code: row.6,
            created_at_ms: row.7,
            finished_at_ms: row.8,
        })
    }
    pub fn today_advice_state(&self, facts: TodayFacts) -> Result<TodayAdviceState> {
        use rusqlite::OptionalExtension;
        validate_facts(&facts)?;
        let read = |successful: bool| -> Result<Option<TodayAdviceRun>> {
            let id:Option<String>=self.db()?.query_row("SELECT id FROM agent_runs WHERE purpose='today_advice' AND agent_id='advisor' AND (?1=0 OR status='succeeded') ORDER BY rowid DESC LIMIT 1",[successful],|r|r.get(0)).optional().map_err(db_error)?;
            id.map(|id| self.today_advice_run(&id)).transpose()
        };
        let latest = read(false)?;
        let last_success = read(true)?;
        let stale = |run: &Option<TodayAdviceRun>| -> Result<Option<bool>> {
            let Some(run) = run else {
                return Ok(None);
            };
            let Some(value) = run.snapshot.get("todayFacts") else {
                return Ok(None);
            };
            let old: TodayFacts =
                serde_json::from_value(value.clone()).map_err(|_| invalid_today())?;
            Ok(Some(facts_changed(&old, &facts)))
        };
        Ok(TodayAdviceState {
            latest_stale: stale(&latest)?,
            last_success_stale: stale(&last_success)?.unwrap_or(false),
            facts_valid_until_ms: None,
            storage_version: self
                .db()?
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .map_err(db_error)?,
            facts,
            latest,
            last_success,
        })
    }
    pub fn complete_today_advice(
        &mut self,
        id: &str,
        result: TodayAdviceResult,
    ) -> Result<TodayAdviceRun> {
        let run = self.today_advice_run(id)?;
        if run.status != "running" {
            return Err(stopped());
        }
        let facts: TodayFacts = serde_json::from_value(run.snapshot["todayFacts"].clone())
            .map_err(|_| invalid_today())?;
        validate_result(&result, &facts)?;
        let changed=self.db()?.execute("UPDATE agent_runs SET status='succeeded',result_json=?2,finished_at_ms=?3 WHERE id=?1 AND purpose='today_advice' AND agent_id='advisor' AND status='running'",params![id,serde_json::to_string(&result).map_err(|_|invalid_today())?,now_ms()?]).map_err(db_error)?;
        if changed != 1 {
            return Err(stopped());
        }
        self.today_advice_run(id)
    }
    pub fn finish_today_advice_error(&mut self, id: &str, code: &str) -> Result<TodayAdviceRun> {
        if code.len() > 64 || !code.bytes().all(|c| c.is_ascii_uppercase() || c == b'_') {
            return Err(invalid());
        }
        self.db()?.execute("UPDATE agent_runs SET status='failed',error_code=?2,finished_at_ms=?3 WHERE id=?1 AND purpose='today_advice' AND agent_id='advisor' AND status='running'",params![id,code,now_ms()?]).map_err(db_error)?;
        self.today_advice_run(id)
    }
    pub fn cancel_today_advice(&mut self, id: &str) -> Result<TodayAdviceRun> {
        self.db()?.execute("UPDATE agent_runs SET status='cancelled',error_code='CANCELLED',finished_at_ms=?2 WHERE id=?1 AND purpose='today_advice' AND agent_id='advisor' AND status='running'",params![id,now_ms()?]).map_err(db_error)?;
        self.today_advice_run(id)
    }
    pub(crate) fn interrupt_today_advice(&mut self, owned: Option<&str>) -> Result<()> {
        self.db()?.execute("UPDATE agent_runs SET status='interrupted',error_code='INTERRUPTED',finished_at_ms=?1 WHERE purpose='today_advice' AND status='running' AND (?2 IS NULL OR id<>?2)",params![now_ms()?,owned]).map_err(db_error)?;
        Ok(())
    }
}
