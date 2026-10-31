use super::*;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextInput {
    pub text: String,
    pub source_at_ms: Option<i64>,
    pub time_zone: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSource {
    pub id: String,
    pub raw_text: String,
    pub source_at_ms: Option<i64>,
    pub imported_at_ms: i64,
    pub anchor_at_ms: i64,
    pub time_zone: String,
    pub succeeded_run_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRun {
    pub id: String,
    pub source_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub snapshot: serde_json::Value,
    pub input: serde_json::Value,
    pub candidate_id: Option<String>,
    pub candidate_version: Option<i64>,
    pub preview: Option<CandidateDraft>,
    pub error_code: Option<String>,
    pub created_at_ms: i64,
    pub finished_at_ms: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateDraft {
    pub fields: TodoInput,
    pub evidence: String,
    pub due_expression: Option<String>,
    pub followup_expression: Option<String>,
    pub warnings: Vec<String>,
    pub unresolved: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub source_id: String,
    pub run_id: String,
    pub status: String,
    pub version: i64,
    pub draft: CandidateDraft,
    pub accepted_todo_id: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatch {
    pub source: TextSource,
    pub run: Option<ModelRun>,
    pub candidates: Vec<Candidate>,
    pub previews: Vec<ModelRun>,
    pub started: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSummary {
    pub id: String,
    pub excerpt: String,
    pub imported_at_ms: i64,
    pub pending: i64,
    pub total: i64,
    pub status: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSourceLink {
    pub source_id: String,
    pub evidence: String,
    pub association: String,
    pub created_at_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkTarget {
    pub id: String,
    pub expected_version: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignChoice {
    pub candidate_id: String,
    pub expected_version: i64,
    pub fields: TodoInput,
    pub time_reviewed: bool,
    pub target: Option<LinkTarget>,
}

fn stale() -> StoreError {
    StoreError::new("CANDIDATE_STALE", "候选或目标事项已经变化，请刷新后核对。")
}
fn final_candidate() -> StoreError {
    StoreError::new("CANDIDATE_FINAL", "这条候选已经处理，不会重新写入。")
}
fn stopped() -> StoreError {
    StoreError::new("RUN_STOPPED", "整理任务已经结束或取消，迟到结果未写入。")
}
fn decode<T: serde::de::DeserializeOwned>(text: String) -> Result<T> {
    serde_json::from_str(&text)
        .map_err(|_| StoreError::new("DATA_INVALID", "本地记录无法读取，原数据未重置。"))
}
fn encode(value: &impl Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(|_| invalid())
}
fn new_id(db: &Connection) -> Result<String> {
    db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(db_error)
}
pub(crate) fn sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn source_row(row: &Row<'_>) -> rusqlite::Result<TextSource> {
    Ok(TextSource {
        id: row.get(0)?,
        raw_text: row.get(1)?,
        source_at_ms: row.get(2)?,
        imported_at_ms: row.get(3)?,
        anchor_at_ms: row.get(4)?,
        time_zone: row.get(5)?,
        succeeded_run_id: row.get(6)?,
    })
}
const SOURCE:&str="SELECT id,raw_text,source_at_ms,imported_at_ms,anchor_at_ms,time_zone,succeeded_run_id FROM sources";
fn load_source(db: &Connection, id: &str) -> Result<TextSource> {
    db.query_row(&format!("{SOURCE} WHERE id=?1"), [id], source_row)
        .map_err(db_error)
}
fn load_run(db: &Connection, id: &str) -> Result<ModelRun> {
    let r=db.query_row("SELECT id,source_id,kind,status,snapshot_json,input_json,candidate_id,candidate_version,preview_json,error_code,created_at_ms,finished_at_ms FROM runs WHERE id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<i64>>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,Option<String>>(9)?,r.get::<_,i64>(10)?,r.get::<_,Option<i64>>(11)?))).map_err(db_error)?;
    Ok(ModelRun {
        id: r.0,
        source_id: r.1,
        kind: r.2,
        status: r.3,
        snapshot: decode(r.4)?,
        input: decode(r.5)?,
        candidate_id: r.6,
        candidate_version: r.7,
        preview: r.8.map(decode).transpose()?,
        error_code: r.9,
        created_at_ms: r.10,
        finished_at_ms: r.11,
    })
}
fn load_candidate(db: &Connection, id: &str) -> Result<Candidate> {
    let r=db.query_row("SELECT id,source_id,run_id,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved,accepted_todo_id FROM candidates WHERE id=?1",[id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,String>(9)?,r.get::<_,bool>(10)?,r.get::<_,Option<String>>(11)?))).map_err(db_error)?;
    Ok(Candidate {
        id: r.0,
        source_id: r.1,
        run_id: r.2,
        status: r.3,
        version: r.4,
        draft: CandidateDraft {
            fields: decode(r.5)?,
            evidence: r.6,
            due_expression: r.7,
            followup_expression: r.8,
            warnings: decode(r.9)?,
            unresolved: r.10,
        },
        accepted_todo_id: r.11,
    })
}
fn ensure_pending(c: &Candidate, version: i64) -> Result<()> {
    if c.status != "pending" {
        return Err(final_candidate());
    }
    if c.version != version {
        return Err(stale());
    }
    Ok(())
}
pub(super) fn validate_draft(
    mut draft: CandidateDraft,
    source: &TextSource,
) -> Result<CandidateDraft> {
    draft.fields = draft.fields.normalized()?;
    if draft.evidence.trim().is_empty()
        || draft.evidence.chars().count() > 2000
        || !source.raw_text.contains(&draft.evidence)
        || draft.warnings.len() > 20
        || draft.warnings.iter().any(|s| s.len() > 1024)
        || [&draft.due_expression, &draft.followup_expression]
            .into_iter()
            .flatten()
            .any(|s| s.len() > 512)
    {
        return Err(StoreError::new(
            "MODEL_INVALID_OUTPUT",
            "整理结果或原文引用不符合要求，可重试或手工记录。",
        ));
    }
    Ok(draft)
}
fn operation_replay(db: &Connection, id: &str, request: &str) -> Result<Option<serde_json::Value>> {
    validate_operation(id)?;
    let old: Option<(String, String)> = db
        .query_row(
            "SELECT request_json,result_json FROM ingestion_operations WHERE operation_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db_error)?;
    if let Some((prior, result)) = old {
        if prior != request {
            return Err(StoreError::new(
                "OPERATION_CONFLICT",
                "操作标识已用于其他内容，请重新操作。",
            ));
        }
        return Ok(Some(decode(result)?));
    }
    let used: i64 = db
        .query_row(
            "SELECT count(*) FROM todo_events WHERE operation_id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    if used > 0 {
        return Err(StoreError::new(
            "OPERATION_CONFLICT",
            "操作标识已用于其他内容，请重新操作。",
        ));
    }
    Ok(None)
}
fn record_operation(
    tx: &Transaction<'_>,
    id: &str,
    kind: &str,
    request: &str,
    result: serde_json::Value,
) -> Result<()> {
    tx.execute("INSERT INTO ingestion_operations(operation_id,kind,request_json,result_json,created_at_ms) VALUES(?1,?2,?3,?4,?5)",params![id,kind,request,encode(&result)?,now_ms()?]).map_err(db_error)?;
    Ok(())
}
fn update_draft(tx: &Transaction<'_>, c: &Candidate, draft: &CandidateDraft) -> Result<()> {
    tx.execute("UPDATE candidates SET fields_json=?2,evidence=?3,due_expression=?4,followup_expression=?5,warnings_json=?6,unresolved=?7,version=version+1 WHERE id=?1",params![c.id,encode(&draft.fields)?,draft.evidence,draft.due_expression,draft.followup_expression,encode(&draft.warnings)?,draft.unresolved]).map_err(db_error)?;
    Ok(())
}
fn insert_run(
    db: &Connection,
    source_id: Option<&str>,
    kind: &str,
    snapshot: serde_json::Value,
    input: serde_json::Value,
    candidate: Option<&Candidate>,
) -> Result<ModelRun> {
    let id = new_id(db)?;
    db.execute("INSERT INTO runs(id,source_id,kind,status,snapshot_json,input_json,candidate_id,candidate_version,created_at_ms) VALUES(?1,?2,?3,'running',?4,?5,?6,?7,?8)",params![id,source_id,kind,encode(&snapshot)?,encode(&input)?,candidate.map(|c|c.id.as_str()),candidate.map(|c|c.version),now_ms()?]).map_err(db_error)?;
    load_run(db, &id)
}

impl AppStore {
    pub fn todo_source_links(&self, id: &str) -> Result<Vec<TodoSourceLink>> {
        let mut statement=self.db()?.prepare("SELECT source_id,evidence,association,created_at_ms FROM todo_sources WHERE todo_id=?1 ORDER BY created_at_ms").map_err(db_error)?;
        let rows = statement
            .query_map([id], |r| {
                Ok(TodoSourceLink {
                    source_id: r.get(0)?,
                    evidence: r.get(1)?,
                    association: r.get(2)?,
                    created_at_ms: r.get(3)?,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        Ok(rows)
    }
    pub fn interrupt_model_run(&self, id: &str) -> Result<ModelRun> {
        self.settle_mcp_task(mcp_calls::McpTaskOwner::Business, id)?;
        self.db()?.execute("UPDATE runs SET status='interrupted',error_code='INTERRUPTED',finished_at_ms=?2 WHERE id=?1 AND status IN ('running','queued')",params![id,now_ms()?]).map_err(db_error)?;
        self.model_run(id)
    }
    pub fn interrupt_unowned_runs(&self) -> Result<()> {
        mcp_calls::recover_business_mcp(self.db()?)?;
        self.db()?.execute("UPDATE runs SET status='interrupted',error_code='INTERRUPTED',finished_at_ms=?1 WHERE status IN ('running','queued')",[now_ms()?]).map_err(db_error)?;
        Ok(())
    }

    pub fn bind_run_snapshot(&self, id: &str, snapshot: serde_json::Value) -> Result<ModelRun> {
        let changed=self.db()?.execute("UPDATE runs SET snapshot_json=?2 WHERE id=?1 AND status='running' AND snapshot_json='null'",params![id,encode(&snapshot)?]).map_err(db_error)?;
        if changed != 1 {
            return Err(stopped());
        }
        self.model_run(id)
    }
    pub fn run_directory(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err(invalid());
        }
        let root = self.root()?.join("runs");
        private_dir(&root)?;
        let path = root.join(id);
        private_dir(&path)?;
        Ok(path)
    }
    pub fn begin_import(
        &mut self,
        input: TextInput,
        snapshot: serde_json::Value,
        retry: bool,
    ) -> Result<ImportBatch> {
        if input.text.trim().is_empty()
            || input.text.chars().count() > 64000
            || input.text.len() > 256000
            || input.time_zone.is_empty()
            || input.time_zone.len() > 128
            || input.time_zone.chars().any(char::is_control)
            || input
                .source_at_ms
                .is_some_and(|t| t.unsigned_abs() > 8_640_000_000_000_000)
        {
            return Err(StoreError::new(
                "INVALID_TEXT",
                "请填写有效原文、来源时间和时区；原文最多64000字。",
            ));
        }
        let fingerprint = sha256(&encode(&input)?);
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        let found: Option<String> = tx
            .query_row(
                "SELECT id FROM sources WHERE fingerprint=?1",
                [&fingerprint],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        let id = if let Some(id) = found {
            id
        } else {
            let id = new_id(&tx)?;
            let imported = now_ms()?;
            tx.execute("INSERT INTO sources(id,fingerprint,kind,raw_text,source_at_ms,imported_at_ms,anchor_at_ms,time_zone) VALUES(?1,?2,'text',?3,?4,?5,?6,?7)",params![id,fingerprint,input.text,input.source_at_ms,imported,input.source_at_ms.unwrap_or(imported),input.time_zone]).map_err(db_error)?;
            id
        };
        let source = load_source(&tx, &id)?;
        let prior:Option<String>=tx.query_row("SELECT id FROM runs WHERE source_id=?1 AND kind='extract' ORDER BY rowid DESC LIMIT 1",[&id],|r|r.get(0)).optional().map_err(db_error)?;
        let start = source.succeeded_run_id.is_none() && (prior.is_none() || retry);
        if start {
            if let Some(prior) = prior {
                if ["queued", "running"].contains(&load_run(&tx, &prior)?.status.as_str()) {
                    return Err(StoreError::new(
                        "RUN_ACTIVE",
                        "这批文本仍在整理，请等待或取消。",
                    ));
                }
            }
            insert_run(&tx, Some(&id), "extract", snapshot, json!({}), None)?;
        }
        tx.commit().map_err(db_error)?;
        let mut batch = self.batch(&id)?;
        batch.started = start;
        Ok(batch)
    }
    pub fn batch(&self, id: &str) -> Result<ImportBatch> {
        let source = load_source(self.db()?, id)?;
        let run:Option<String>=self.db()?.query_row("SELECT id FROM runs WHERE source_id=?1 AND kind='extract' ORDER BY rowid DESC LIMIT 1",[id],|r|r.get(0)).optional().map_err(db_error)?;
        let mut statement = self
            .db()?
            .prepare("SELECT id FROM candidates WHERE source_id=?1 ORDER BY ordinal")
            .map_err(db_error)?;
        let ids = statement
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        let candidates = ids
            .iter()
            .map(|id| load_candidate(self.db()?, id))
            .collect::<Result<Vec<_>>>()?;
        let mut statement = self
            .db()?
            .prepare("SELECT id FROM runs WHERE source_id=?1 AND kind='revise' ORDER BY rowid DESC")
            .map_err(db_error)?;
        let ids = statement
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        let previews = ids
            .iter()
            .map(|id| load_run(self.db()?, id))
            .collect::<Result<Vec<_>>>()?;
        Ok(ImportBatch {
            source,
            run: run.map(|id| load_run(self.db()?, &id)).transpose()?,
            candidates,
            previews,
            started: false,
        })
    }
    pub fn list_batches(&self) -> Result<Vec<BatchSummary>> {
        let mut statement=self.db()?.prepare("SELECT s.id,substr(s.raw_text,1,160),s.imported_at_ms,(SELECT count(*) FROM candidates WHERE source_id=s.id AND status='pending'),(SELECT count(*) FROM candidates WHERE source_id=s.id),coalesce((SELECT status FROM runs WHERE source_id=s.id AND kind='extract' ORDER BY rowid DESC LIMIT 1),'failed') FROM sources s ORDER BY s.imported_at_ms DESC,s.rowid DESC").map_err(db_error)?;
        let rows = statement
            .query_map([], |r| {
                Ok(BatchSummary {
                    id: r.get(0)?,
                    excerpt: r.get(1)?,
                    imported_at_ms: r.get(2)?,
                    pending: r.get(3)?,
                    total: r.get(4)?,
                    status: r.get(5)?,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error)?;
        Ok(rows)
    }
    pub fn candidate(&self, id: &str) -> Result<Candidate> {
        load_candidate(self.db()?, id)
    }
    pub fn model_run(&self, id: &str) -> Result<ModelRun> {
        load_run(self.db()?, id)
    }
    pub fn publish_candidates(
        &mut self,
        run_id: &str,
        drafts: Vec<CandidateDraft>,
    ) -> Result<ImportBatch> {
        self.settle_mcp_task(mcp_calls::McpTaskOwner::Business, run_id)?;
        if drafts.len() > 50 {
            return Err(invalid());
        }
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        let run = load_run(&tx, run_id)?;
        if run.kind != "extract" || run.status != "running" {
            return Err(stopped());
        }
        let source = load_source(&tx, run.source_id.as_deref().ok_or_else(invalid)?)?;
        if source.succeeded_run_id.is_some() {
            return Err(stopped());
        }
        let mut unique = BTreeSet::new();
        for (ordinal, draft) in drafts.into_iter().enumerate() {
            let draft = validate_draft(draft, &source)?;
            if !unique.insert(encode(&draft)?) {
                continue;
            }
            let id = new_id(&tx)?;
            tx.execute("INSERT INTO candidates(id,source_id,run_id,ordinal,status,version,fields_json,evidence,due_expression,followup_expression,warnings_json,unresolved) VALUES(?1,?2,?3,?4,'pending',1,?5,?6,?7,?8,?9,?10)",params![id,source.id,run.id,ordinal as i64,encode(&draft.fields)?,draft.evidence,draft.due_expression,draft.followup_expression,encode(&draft.warnings)?,draft.unresolved]).map_err(db_error)?;
        }
        tx.execute(
            "UPDATE runs SET status='succeeded',finished_at_ms=?2 WHERE id=?1 AND status='running'",
            params![run.id, now_ms()?],
        )
        .map_err(db_error)?;
        tx.execute(
            "UPDATE sources SET succeeded_run_id=?2 WHERE id=?1",
            params![source.id, run.id],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        self.batch(&source.id)
    }
    pub fn finish_run_error(&mut self, id: &str, code: &str) -> Result<ModelRun> {
        self.settle_mcp_task(mcp_calls::McpTaskOwner::Business, id)?;
        if code.len() > 64 || !code.bytes().all(|b| b.is_ascii_uppercase() || b == b'_') {
            return Err(invalid());
        }
        self.db()?.execute("UPDATE runs SET status='failed',error_code=?2,finished_at_ms=?3 WHERE id=?1 AND status IN ('running','queued')",params![id,code,now_ms()?]).map_err(db_error)?;
        self.model_run(id)
    }
    pub fn cancel_run(&mut self, id: &str) -> Result<ModelRun> {
        self.settle_mcp_task(mcp_calls::McpTaskOwner::Business, id)?;
        self.db()?.execute("UPDATE runs SET status='cancelled',error_code='CANCELLED',finished_at_ms=?2 WHERE id=?1 AND status IN ('running','queued')",params![id,now_ms()?]).map_err(db_error)?;
        self.model_run(id)
    }
    pub fn begin_model_test(&mut self, snapshot: serde_json::Value) -> Result<ModelRun> {
        insert_run(self.db()?, None, "test", snapshot, json!({}), None)
    }
    pub fn finish_model_test(&mut self, id: &str) -> Result<ModelRun> {
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        let run = load_run(&tx, id)?;
        if run.kind != "test" || run.status != "running" {
            return Err(stopped());
        }
        tx.execute(
            "UPDATE runs SET status='succeeded',finished_at_ms=?2 WHERE id=?1",
            params![id, now_ms()?],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        self.model_run(id)
    }
    pub fn edit_candidate(
        &mut self,
        id: &str,
        version: i64,
        fields: TodoInput,
        reviewed: bool,
        operation: &str,
    ) -> Result<Candidate> {
        let fields = fields.normalized()?;
        let request = encode(
            &json!({"kind":"candidate.edit","id":id,"version":version,"fields":fields,"reviewed":reviewed}),
        )?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        if operation_replay(&tx, operation, &request)?.is_some() {
            return load_candidate(&tx, id);
        }
        let c = load_candidate(&tx, id)?;
        ensure_pending(&c, version)?;
        let mut draft = c.draft.clone();
        draft.fields = fields;
        if reviewed {
            draft.unresolved = false;
        }
        update_draft(&tx, &c, &draft)?;
        record_operation(&tx, operation, "edit", &request, json!({"candidate":id}))?;
        tx.commit().map_err(db_error)?;
        self.candidate(id)
    }
    pub fn discard_candidate(
        &mut self,
        id: &str,
        version: i64,
        operation: &str,
    ) -> Result<Candidate> {
        let request = encode(&json!({"kind":"candidate.discard","id":id,"version":version}))?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        if operation_replay(&tx, operation, &request)?.is_some() {
            return load_candidate(&tx, id);
        }
        let c = load_candidate(&tx, id)?;
        ensure_pending(&c, version)?;
        tx.execute("UPDATE candidates SET status='discarded',version=version+1,processed_at_ms=?2 WHERE id=?1",params![id,now_ms()?]).map_err(db_error)?;
        record_operation(&tx, operation, "discard", &request, json!({"candidate":id}))?;
        tx.commit().map_err(db_error)?;
        self.candidate(id)
    }
    pub fn begin_revision(
        &mut self,
        id: &str,
        version: i64,
        instruction: String,
        snapshot: serde_json::Value,
    ) -> Result<ModelRun> {
        if instruction.trim().is_empty() || instruction.len() > 8000 {
            return Err(invalid());
        }
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        let c = load_candidate(&tx, id)?;
        ensure_pending(&c, version)?;
        let run = insert_run(
            &tx,
            Some(&c.source_id),
            "revise",
            snapshot,
            json!({"instruction":instruction}),
            Some(&c),
        )?;
        tx.commit().map_err(db_error)?;
        Ok(run)
    }
    pub fn publish_revision(&mut self, id: &str, preview: CandidateDraft) -> Result<ModelRun> {
        self.settle_mcp_task(mcp_calls::McpTaskOwner::Business, id)?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        let run = load_run(&tx, id)?;
        if run.kind != "revise" || run.status != "running" {
            return Err(stopped());
        }
        let c = load_candidate(&tx, run.candidate_id.as_deref().ok_or_else(invalid)?)?;
        ensure_pending(&c, run.candidate_version.ok_or_else(invalid)?)?;
        let source = load_source(&tx, &c.source_id)?;
        let preview = validate_draft(preview, &source)?;
        tx.execute(
            "UPDATE runs SET status='succeeded',preview_json=?2,finished_at_ms=?3 WHERE id=?1",
            params![id, encode(&preview)?, now_ms()?],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        self.model_run(id)
    }
    pub fn apply_preview(&mut self, id: &str, version: i64, operation: &str) -> Result<Candidate> {
        let request = encode(&json!({"kind":"preview.apply","run":id,"version":version}))?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        let run = load_run(&tx, id)?;
        let cid = run.candidate_id.as_deref().ok_or_else(invalid)?;
        if operation_replay(&tx, operation, &request)?.is_some() {
            return load_candidate(&tx, cid);
        }
        if run.status != "succeeded"
            || run.kind != "revise"
            || run.candidate_version != Some(version)
        {
            return Err(stale());
        }
        let c = load_candidate(&tx, cid)?;
        ensure_pending(&c, version)?;
        update_draft(&tx, &c, run.preview.as_ref().ok_or_else(invalid)?)?;
        record_operation(
            &tx,
            operation,
            "preview",
            &request,
            json!({"candidate":cid}),
        )?;
        tx.commit().map_err(db_error)?;
        self.candidate(cid)
    }
    pub fn sign_candidates(
        &mut self,
        mut choices: Vec<SignChoice>,
        operation: &str,
    ) -> Result<Vec<Todo>> {
        if choices.is_empty() || choices.len() > 50 {
            return Err(invalid());
        }
        choices.sort_by(|a, b| a.candidate_id.cmp(&b.candidate_id));
        for choice in &mut choices {
            choice.fields = choice.fields.clone().normalized()?;
        }
        if choices
            .windows(2)
            .any(|w| w[0].candidate_id == w[1].candidate_id)
        {
            return Err(invalid());
        }
        let request = encode(&json!({"kind":"sign","choices":choices}))?;
        let tx = self.db_mut()?.transaction().map_err(db_error)?;
        if let Some(result) = operation_replay(&tx, operation, &request)? {
            let ids: Vec<String> =
                serde_json::from_value(result.get("ids").cloned().ok_or_else(invalid)?)
                    .map_err(|_| invalid())?;
            return ids.iter().map(|id| load_todo(&tx, id)).collect();
        }
        let mut versions = BTreeMap::new();
        for choice in &choices {
            let c = load_candidate(&tx, &choice.candidate_id)?;
            ensure_pending(&c, choice.expected_version)?;
            if c.draft.unresolved && !choice.time_reviewed {
                return Err(StoreError::new(
                    "TIME_REVIEW_REQUIRED",
                    "请先核对有歧义的时间，补充日期或明确保留未定期。",
                ));
            }
            if let Some(target) = &choice.target {
                let todo = load_todo(&tx, &target.id)?;
                validate_change(&todo, target.expected_version)?;
                if versions
                    .insert(target.id.clone(), target.expected_version)
                    .is_some_and(|old| old != target.expected_version)
                {
                    return Err(stale());
                }
            }
        }
        let mut ids = BTreeSet::new();
        for choice in choices {
            let c = load_candidate(&tx, &choice.candidate_id)?;
            let child = format!("sign-{}", sha256(&format!("{operation}\0{}", c.id)));
            let (todo, association) = if let Some(target) = choice.target {
                let before = load_todo(&tx, &target.id)?;
                tx.execute(
                    "UPDATE todos SET version=version+1,updated_at_ms=?2 WHERE id=?1",
                    params![target.id, now_ms()?],
                )
                .map_err(db_error)?;
                let after = load_todo(&tx, &target.id)?;
                record_event(&tx, &child, "link", &request, Some(&before), &after)?;
                (after, "manual_link")
            } else {
                let todo = insert_todo(&tx, &choice.fields, "signed_ai")?;
                record_event(&tx, &child, "create", &request, None, &todo)?;
                (todo, "new")
            };
            tx.execute("INSERT INTO todo_sources(todo_id,source_id,candidate_id,evidence,association,operation_id,created_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![todo.id,c.source_id,c.id,c.draft.evidence,association,child,now_ms()?]).map_err(db_error)?;
            tx.execute("UPDATE candidates SET status='accepted',fields_json=?2,unresolved=0,accepted_todo_id=?3,processed_at_ms=?4,version=version+1 WHERE id=?1",params![c.id,encode(&choice.fields)?,todo.id,now_ms()?]).map_err(db_error)?;
            ids.insert(todo.id);
        }
        record_operation(&tx, operation, "sign", &request, json!({"ids":ids}))?;
        let result = ids
            .iter()
            .map(|id| load_todo(&tx, id))
            .collect::<Result<Vec<_>>>()?;
        tx.commit().map_err(db_error)?;
        Ok(result)
    }
}

#[cfg(test)]
#[path = "ingestion_tests.rs"]
mod tests;
