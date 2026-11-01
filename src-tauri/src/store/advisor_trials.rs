use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdvisorReason {
    pub code: String,
    #[serde(deserialize_with = "required_nullable")]
    pub related_todo_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub related_todo_version: Option<i64>,
}
fn required_nullable<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdvisorRecommendation {
    pub todo_id: String,
    pub todo_version: i64,
    pub reasons: Vec<AdvisorReason>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdvisorTrialResult {
    pub kind: String,
    pub version: u32,
    pub snapshot_id: String,
    pub date: String,
    pub time_zone: String,
    pub ranking: Vec<AdvisorRecommendation>,
}
pub(super) fn advisor_sample(id: &str) -> serde_json::Value {
    let date = "2026-11-02";
    let todos = json!([
        {"id":"advisor-action","version":2,"title":"整理接入清单","kind":"action","owner":"我","status":"open","dueDate":"2026-11-02","followupDate":null},
        {"id":"advisor-followup","version":3,"title":"修复SDK鉴权","kind":"followup","owner":"林川","status":"open","dueDate":"2026-11-03","followupDate":"2026-11-02"},
        {"id":"advisor-undated","version":1,"title":"确认试用名单","kind":"action","owner":"我","status":"open","dueDate":null,"followupDate":null},
        {"id":"advisor-done","version":1,"title":"归档合成纪要","kind":"action","owner":"我","status":"done","dueDate":"2026-11-01","followupDate":null}
    ]);
    let all = todos.as_array().expect("fixed advisor sample");
    let open: Vec<_> = all.iter().filter(|todo| todo["status"] == "open").collect();
    let counts = json!({"total":all.len(),"open":open.len(),"done":all.len()-open.len(),"dueToday":open.iter().filter(|todo|todo["dueDate"]==date).count(),"followupToday":open.iter().filter(|todo|todo["followupDate"]==date).count(),"undated":open.iter().filter(|todo|todo["dueDate"].is_null()&&todo["followupDate"].is_null()).count()});
    json!({"version":1,"snapshotId":id,"date":date,"timeZone":"Asia/Shanghai","anchorAtMs":1793581200000_i64,"todos":todos,"counts":counts})
}
fn invalid_advisor() -> StoreError {
    StoreError::new(
        "MODEL_INVALID_OUTPUT",
        "参谋建议与本次合成事实不一致，未应用结果。",
    )
}
impl AppStore {
    pub fn complete_advisor_trial(
        &mut self,
        id: &str,
        result: AdvisorTrialResult,
    ) -> Result<AgentRun> {
        let run = self.agent_run(id)?;
        if run.status != "running" {
            return Err(StoreError::new(
                "AGENT_TRIAL_STOPPED",
                "试跑已结束，迟到结果未应用。",
            ));
        }
        let facts = advisor_sample(id);
        if run.agent_id != "advisor"
            || result.kind != "advisor"
            || result.version != 1
            || run.snapshot["advisorSample"] != facts
            || run.input.time_zone != "Asia/Shanghai"
            || run.input.source_at_ms != Some(1793581200000)
            || result.snapshot_id != id
            || result.date != "2026-11-02"
            || result.time_zone != "Asia/Shanghai"
            || ![0, 3].contains(&result.ranking.len())
        {
            return Err(invalid_advisor());
        }
        let todos = facts["todos"].as_array().ok_or_else(invalid_advisor)?;
        let mut seen = std::collections::BTreeSet::new();
        for item in &result.ranking {
            let todo = todos
                .iter()
                .find(|todo| {
                    todo["id"] == item.todo_id
                        && todo["version"] == item.todo_version
                        && todo["status"] == "open"
                })
                .ok_or_else(invalid_advisor)?;
            if !seen.insert(&item.todo_id) || item.reasons.is_empty() || item.reasons.len() > 3 {
                return Err(invalid_advisor());
            }
            let mut reasons = std::collections::BTreeSet::new();
            for reason in &item.reasons {
                if !reasons.insert((
                    &reason.code,
                    &reason.related_todo_id,
                    reason.related_todo_version,
                )) {
                    return Err(invalid_advisor());
                }
                let valid = if reason.code == "earlier_due" {
                    let other = todos
                        .iter()
                        .find(|other| {
                            other["id"].as_str() == reason.related_todo_id.as_deref()
                                && other["version"].as_i64() == reason.related_todo_version
                                && other["status"] == "open"
                        })
                        .ok_or_else(invalid_advisor)?;
                    other["id"] != todo["id"]
                        && matches!((todo["dueDate"].as_str(), other["dueDate"].as_str()), (Some(left), Some(right)) if left < right)
                } else {
                    if reason.related_todo_id.is_some() || reason.related_todo_version.is_some() {
                        return Err(invalid_advisor());
                    }
                    match reason.code.as_str() {
                        "due_today" => todo["dueDate"] == facts["date"],
                        "followup_today" => todo["followupDate"] == facts["date"],
                        "upcoming_due" => {
                            matches!(todo["dueDate"].as_str(), Some(date) if date > "2026-11-02")
                        }
                        "undated" => todo["dueDate"].is_null() && todo["followupDate"].is_null(),
                        "open_action" => todo["kind"] == "action",
                        "open_followup" => todo["kind"] == "followup",
                        _ => false,
                    }
                };
                if !valid {
                    return Err(invalid_advisor());
                }
            }
        }
        self.settle_trial_mcp(id)?;
        if self.trial_mcp_unknown(id)? {
            return Err(super::mcp_calls::unknown_error());
        }
        let changed = self.db()?.execute("UPDATE agent_runs SET status='succeeded',result_json=?2,finished_at_ms=?3 WHERE id=?1 AND agent_id='advisor' AND purpose='role_trial' AND status='running'", params![id,serde_json::to_string(&result).map_err(|_|invalid_advisor())?,now_ms()?]).map_err(db_error)?;
        if changed != 1 {
            return Err(StoreError::new(
                "AGENT_TRIAL_STOPPED",
                "试跑已结束，迟到结果未应用。",
            ));
        }
        self.agent_run(id)
    }
}
