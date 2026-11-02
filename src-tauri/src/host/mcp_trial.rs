#[cfg(test)]
use crate::local_store::McpCallFault;
use crate::local_store::{
    AppStore, McpCallInput, McpDiscoveredCatalog, McpHttpClose, McpTaskOwner, PreparedMcpTransport,
    StoreError, TrialMcpTool,
};
use crate::mcp_host::{self, HttpScope, Owner};
use crate::runtime_host::{Job, JobKind, RuntimeState};
use crate::store_commands::LocalState;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::mpsc::SyncSender;

#[derive(Clone)]
struct StdioSession {
    nonce: String,
    owner: Option<Owner>,
    ended: bool,
}
#[derive(Clone)]
enum Session {
    Stdio(StdioSession),
    Http {
        scope: HttpScope,
        ended: bool,
        close: McpHttpClose,
    },
}
impl Session {
    fn active(&self) -> bool {
        match self {
            Self::Stdio(s) => s.owner.is_some() && !s.ended,
            Self::Http { ended, .. } => !ended,
        }
    }
    fn ended(&self) -> bool {
        match self {
            Self::Stdio(s) => s.ended,
            Self::Http { ended, .. } => *ended,
        }
    }
}
#[derive(Default)]
pub(crate) struct TrialState {
    pub(crate) servers: BTreeSet<String>,
    http: BTreeMap<String, HttpScope>,
    sessions: BTreeMap<String, Session>,
}
impl TrialState {
    pub(crate) fn from_payload(payload: &Value) -> Self {
        Self {
            servers: payload["mcp"]["servers"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|server| server["id"].as_str().map(String::from))
                .collect(),
            sessions: BTreeMap::new(),
            http: payload["mcp"]["servers"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|server| server["transport"] == "http")
                .map(|server| {
                    let id = server["id"].as_str().unwrap_or_default().to_string();
                    (
                        id.clone(),
                        HttpScope {
                            run: payload["runId"].as_str().unwrap_or_default().into(),
                            server: id,
                            revision: server["configurationRevision"]
                                .as_str()
                                .unwrap_or_default()
                                .into(),
                            nonce: server["sessionNonce"].as_str().unwrap_or_default().into(),
                            endpoint: server["endpointSha256"].as_str().unwrap_or_default().into(),
                        },
                    )
                })
                .collect(),
        }
    }
}

pub(crate) fn prepare(
    store: &mut AppStore,
    run: &str,
    directory: &Path,
) -> Result<Value, StoreError> {
    prepare_task(store, McpTaskOwner::Trial, run, directory)
}

pub(crate) fn prepare_business(
    store: &mut AppStore,
    run: &str,
    directory: &Path,
) -> Result<Value, StoreError> {
    prepare_task(store, McpTaskOwner::Business, run, directory)
}

fn prepare_task(
    store: &mut AppStore,
    owner: McpTaskOwner,
    run: &str,
    directory: &Path,
) -> Result<Value, StoreError> {
    let prepared = match owner {
        McpTaskOwner::Trial => store.prepare_trial_mcp(run)?,
        McpTaskOwner::Business => store.prepare_mcp_task(owner, run)?,
    };
    let mut servers = Vec::new();
    for server in prepared.servers {
        if !["node", "organizer.mjs", "mcp-guardian.mjs"]
            .iter()
            .all(|file| directory.join(file).is_file())
        {
            return Err(StoreError {
                code: "MCP_DEPENDENCY_MISSING",
                message: "随包工具依赖缺失，未启动MCP任务。",
            });
        }
        let p = mcp_host::resolve_command(server.prepared, directory)?;
        let mut value = match p.transport {
            PreparedMcpTransport::Stdio {
                command,
                args,
                cwd,
                env,
                sensitive_names,
            } => {
                json!({"command":command,"args":args,"cwd":cwd,"env":env,"sensitiveNames":sensitive_names})
            }
            PreparedMcpTransport::Http { url, headers } => {
                let scope =
                    mcp_host::HttpScope::new(run, &server.server.id, &prepared.revision, &url)?;
                json!({"transport":"http","url":url,"httpHeaders":headers,"sensitiveValues":headers.values().collect::<Vec<_>>(),"sessionNonce":scope.nonce,"endpointSha256":scope.endpoint})
            }
        };
        value["id"] = json!(server.server.id);
        value["configurationRevision"] = json!(prepared.revision);
        value["connectTimeoutMs"] = json!(server.server.settings.connect_timeout_ms);
        value["toolTimeoutMs"] = json!(server.server.settings.tool_timeout_ms);
        servers.push(value);
    }
    Ok(json!({"revision":prepared.revision,"servers":servers}))
}

fn protocol() -> String {
    "MCP_PROTOCOL".into()
}
fn private(value: &Value, sensitive: &[String]) -> bool {
    match value {
        Value::String(text) => sensitive
            .iter()
            .any(|secret| !secret.is_empty() && text.contains(secret)),
        Value::Array(values) => values.iter().any(|v| private(v, sensitive)),
        Value::Object(values) => values.iter().any(|(key, value)| {
            private(&Value::String(key.clone()), sensitive) || private(value, sensitive)
        }),
        _ => false,
    }
}
fn result_bytes(
    result: &Value,
    sensitive: &[String],
    previous: usize,
) -> Result<(usize, bool), String> {
    let invalid = || "MCP_RESULT_INVALID".to_string();
    let object = result.as_object().ok_or_else(invalid)?;
    if object
        .keys()
        .any(|key| !["content", "structuredContent", "isError", "_meta"].contains(&key.as_str()))
        || object.get("isError").is_some_and(|v| !v.is_boolean())
        || ["structuredContent", "_meta"]
            .iter()
            .any(|key| object.get(*key).is_some_and(|v| !v.is_object()))
    {
        return Err(invalid());
    }
    let content = object
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    for block in content {
        let valid = match block["type"].as_str() {
            Some("text") => block["text"].is_string(),
            Some("image" | "audio") => block["data"].is_string() && block["mimeType"].is_string(),
            Some("resource_link") => block["uri"].is_string() && block["name"].is_string(),
            Some("resource") => {
                block["resource"]["uri"].is_string()
                    && (block["resource"]["text"].is_string()
                        || block["resource"]["blob"].is_string())
            }
            _ => false,
        };
        if !valid {
            return Err(invalid());
        }
    }
    let bytes = serde_json::to_vec(result).map_err(|_| invalid())?.len();
    if bytes > 262144 || bytes + previous > 524288 {
        return Err(invalid());
    }
    if private(result, sensitive) {
        return Err("MCP_PRIVATE_OUTPUT".into());
    }
    Ok((bytes, result["isError"] == true))
}

pub(crate) struct TrialControl<'a> {
    job: &'a Job,
    directory: &'a Path,
    local: &'a LocalState,
    requests: BTreeSet<String>,
    mapping: BTreeMap<String, TrialMcpTool>,
    catalogs: BTreeSet<String>,
    calls: BTreeMap<String, (String, bool)>,
    sensitive: Vec<String>,
    result_bytes: usize,
}
impl<'a> TrialControl<'a> {
    pub(crate) fn new(
        job: &'a Job,
        directory: &'a Path,
        local: &'a LocalState,
        payload: &Value,
    ) -> Self {
        let mut sensitive = vec![payload["apiKey"].as_str().unwrap_or_default().to_string()];
        for server in payload["mcp"]["servers"].as_array().into_iter().flatten() {
            sensitive.extend(
                server["sensitiveValues"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(String::from),
            );
            for name in server["sensitiveNames"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if let Some(value) = server["env"][name].as_str() {
                    sensitive.push(value.to_string());
                }
            }
        }
        Self {
            job,
            directory,
            local,
            requests: BTreeSet::new(),
            mapping: BTreeMap::new(),
            catalogs: BTreeSet::new(),
            calls: BTreeMap::new(),
            sensitive,
            result_bytes: 0,
        }
    }
    pub(crate) fn handle(
        &mut self,
        frame: &Value,
        pid: u32,
        state: &RuntimeState,
        writer: &SyncSender<Vec<u8>>,
    ) -> Result<(), String> {
        let slot = state.slot.lock().map_err(|_| protocol())?;
        if !slot
            .as_ref()
            .is_some_and(|job| job.run_id == self.job.run_id && job.nonce == self.job.nonce)
            || !matches!(self.job.kind, JobKind::Trial | JobKind::Business)
            || frame["runId"] != self.job.run_id
            || frame["hostNonce"] != self.job.nonce
        {
            return Err(protocol());
        }
        let task_owner = match self.job.kind {
            JobKind::Trial => McpTaskOwner::Trial,
            JobKind::Business => McpTaskOwner::Business,
            JobKind::Probe | JobKind::Today => return Err(protocol()),
        };
        let action = frame["action"].as_str().ok_or_else(protocol)?;
        #[cfg(test)]
        if action == "call_begin"
            && *state.trial_policy.lock().map_err(|_| protocol())? == Some("reject-begin")
        {
            return Err(protocol());
        }
        if self.job.cancel.load(std::sync::atomic::Ordering::SeqCst) && action != "end" {
            return Err(protocol());
        }
        let request = frame["requestId"]
            .as_str()
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
            .ok_or_else(protocol)?;
        if self.requests.len() >= 512 || !self.requests.insert(request.into()) {
            return Err(protocol());
        }
        let server = frame["serverId"].as_str().ok_or_else(protocol)?;
        let mut ownership = self.job.mcp_trial.lock().map_err(|_| protocol())?;
        if !ownership.servers.contains(server) {
            return Err(protocol());
        }
        if let Some(scope) = ownership.http.get(server) {
            if !scope.matches(frame)
                || !["http_open", "end", "catalog", "call_begin", "call_response"].contains(&action)
                || (action != "http_open"
                    && !ownership.sessions.get(server).is_some_and(Session::active))
            {
                return Err(protocol());
            }
        } else if frame.get("transport").is_some_and(|v| v != "stdio")
            || frame.get("endpointSha256").is_some()
        {
            return Err(protocol());
        }
        let mut ack = json!({"type":"mcp_ack","action":action,"requestId":request,"runId":self.job.run_id,"hostNonce":self.job.nonce,"serverId":server});
        for key in [
            "callId",
            "nonce",
            "guardian",
            "keeper",
            "configurationRevision",
            "transport",
            "endpointSha256",
            "run",
        ] {
            if let Some(value) = frame.get(key) {
                ack[key] = value.clone();
            }
        }
        match action {
            "http_open" => {
                let scope = ownership.http.get(server).cloned().ok_or_else(protocol)?;
                if ownership.sessions.contains_key(server) {
                    return Err(protocol());
                }
                ownership.sessions.insert(
                    server.into(),
                    Session::Http {
                        scope,
                        ended: false,
                        close: McpHttpClose::Unconfirmed,
                    },
                );
            }
            "prepare" => {
                let owner: Owner = serde_json::from_value(frame.clone()).map_err(|_| protocol())?;
                if ownership.sessions.contains_key(server)
                    || owner.run != self.job.run_id
                    || owner.guardian != 0
                    || owner.keeper != 0
                    || !mcp_host::valid_nonce(&owner.nonce)
                {
                    return Err(protocol());
                }
                ownership.sessions.insert(
                    server.into(),
                    Session::Stdio(StdioSession {
                        nonce: owner.nonce,
                        owner: None,
                        ended: false,
                    }),
                );
            }
            "owner" => {
                let owner: Owner = serde_json::from_value(frame.clone()).map_err(|_| protocol())?;
                let Some(Session::Stdio(session)) = ownership.sessions.get_mut(server) else {
                    return Err(protocol());
                };
                if session.owner.is_some()
                    || session.ended
                    || session.nonce != owner.nonce
                    || owner.run != self.job.run_id
                    || !mcp_host::owner_matches(&owner, self.directory, pid)
                {
                    return Err(protocol());
                }
                session.owner = Some(owner.clone());
                #[cfg(test)]
                state.test_trial_checkpoint(
                    self.job,
                    "owner",
                    json!({"serverId":server,"owner":owner}),
                );
            }
            "end" => {
                if let Some(Session::Http { ended, close, .. }) = ownership.sessions.get_mut(server)
                {
                    let actual: McpHttpClose = serde_json::from_value(frame["remoteClose"].clone())
                        .map_err(|_| protocol())?;
                    self.local
                        .access(|store| {
                            store.record_mcp_task_close(
                                task_owner,
                                &self.job.run_id,
                                server,
                                actual,
                            )
                        })
                        .map_err(|e| e.code.to_string())?;
                    *ended = true;
                    *close = actual;
                    ack["remoteClose"] = json!(actual);
                } else {
                    let owner: Owner =
                        serde_json::from_value(frame.clone()).map_err(|_| protocol())?;
                    let Some(Session::Stdio(session)) = ownership.sessions.get_mut(server) else {
                        return Err(protocol());
                    };
                    if session.ended
                        || !session.owner.as_ref().is_some_and(|old| {
                            old.guardian == owner.guardian
                                && old.keeper == owner.keeper
                                && old.nonce == owner.nonce
                                && old.run == owner.run
                        })
                        || !mcp_host::group_gone(owner.guardian)
                    {
                        return Err(protocol());
                    }
                    session.ended = true;
                    session.owner = None;
                }
            }
            "catalog" => {
                if !ownership.sessions.get(server).is_some_and(Session::active)
                    || !self.catalogs.insert(server.into())
                {
                    return Err(protocol());
                }
                let catalog: McpDiscoveredCatalog =
                    serde_json::from_value(frame["catalog"].clone()).map_err(|_| protocol())?;
                let mapping = self
                    .local
                    .access(|store| {
                        store.bind_mcp_task_catalog(
                            task_owner,
                            &self.job.run_id,
                            server,
                            &catalog,
                            &self.sensitive,
                        )
                    })
                    .map_err(|error| error.code.to_string())?;
                for tool in &mapping {
                    if self
                        .mapping
                        .insert(tool.model_name.clone(), tool.clone())
                        .is_some()
                    {
                        return Err(protocol());
                    }
                }
                ack["mapping"] = serde_json::to_value(mapping).map_err(|_| protocol())?;
            }
            "call_begin" => {
                if self.catalogs.len() != ownership.servers.len()
                    || !ownership.sessions.get(server).is_some_and(Session::active)
                {
                    return Err(protocol());
                }
                let input: McpCallInput =
                    serde_json::from_value(frame["input"].clone()).map_err(|_| protocol())?;
                if frame["callId"] != input.id
                    || !self.mapping.get(&input.model_name).is_some_and(|tool| {
                        tool.server_id == server && tool.schema_sha256 == input.schema_sha256
                    })
                {
                    return Err(protocol());
                }
                let arguments: Value =
                    serde_json::from_str(&input.arguments_json).map_err(|_| protocol())?;
                if private(&arguments, &self.sensitive) {
                    return Err("MCP_PRIVATE_OUTPUT".into());
                }
                let call_id = input.id.clone();
                #[cfg(test)]
                state.test_trial_checkpoint(self.job, "before_begin", json!({"callId":call_id}));
                self.local
                    .access(|store| {
                        #[cfg(test)]
                        match *state.trial_policy.lock().map_err(|_| StoreError {
                            code: "MCP_CALL_TEST_FAULT",
                            message: "Synthetic policy lock failure.",
                        })? {
                            Some("store-begin-before") => {
                                store.test_mcp_call_fault(Some(McpCallFault::BeforeBegin))
                            }
                            Some("store-begin-after") => {
                                store.test_mcp_call_fault(Some(McpCallFault::AfterBegin))
                            }
                            _ => {}
                        }
                        store.begin_mcp_task_call(task_owner, &self.job.run_id, input)
                    })
                    .map_err(|error| error.code.to_string())?;
                #[cfg(test)]
                state.test_trial_checkpoint(self.job, "after_begin", json!({"callId":call_id}));
                self.calls.insert(call_id, (server.into(), false));
            }
            "call_response" => {
                let call = frame["callId"].as_str().ok_or_else(protocol)?;
                if !self
                    .calls
                    .get(call)
                    .is_some_and(|(id, responded)| id == server && !responded)
                {
                    return Err(protocol());
                }
                let (bytes, is_error) =
                    result_bytes(&frame["result"], &self.sensitive, self.result_bytes)?;
                #[cfg(test)]
                if *state.trial_policy.lock().map_err(|_| protocol())? == Some("before-response") {
                    return Err(protocol());
                }
                #[cfg(test)]
                state.test_trial_checkpoint(self.job, "before_response", json!({"callId":call}));
                self.local
                    .access(|store| {
                        #[cfg(test)]
                        match *state.trial_policy.lock().map_err(|_| StoreError {
                            code: "MCP_CALL_TEST_FAULT",
                            message: "Synthetic policy lock failure.",
                        })? {
                            Some("store-response-before") => {
                                store.test_mcp_call_fault(Some(McpCallFault::BeforeResponse))
                            }
                            Some("store-response-after") => {
                                store.test_mcp_call_fault(Some(McpCallFault::AfterResponse))
                            }
                            _ => {}
                        }
                        store.confirm_mcp_task_call(task_owner, &self.job.run_id, call, is_error)
                    })
                    .map_err(|error| error.code.to_string())?;
                #[cfg(test)]
                state.test_trial_checkpoint(self.job, "after_response", json!({"callId":call}));
                self.result_bytes += bytes;
                self.calls.insert(call.into(), (server.into(), true));
            }
            _ => return Err(protocol()),
        }
        if action != "end" && self.job.cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(protocol());
        }
        #[cfg(test)]
        {
            let policy = *state.trial_policy.lock().map_err(|_| protocol())?;
            if (action == "call_begin" && policy == Some("drop-begin-ack"))
                || (action == "call_response" && policy == Some("drop-response-ack"))
            {
                return Ok(());
            }
        }
        let mut bytes = serde_json::to_vec(&ack).map_err(|_| protocol())?;
        bytes.push(b'\n');
        if bytes.len() > 1200000 {
            return Err(protocol());
        }
        writer.try_send(bytes).map_err(|_| protocol())
    }
}

#[cfg(test)]
pub(crate) fn test_trial_owners(job: &Job) -> Vec<Owner> {
    job.mcp_trial
        .lock()
        .expect("controlled owners lock")
        .sessions
        .values()
        .filter_map(|session| match session {
            Session::Stdio(s) => s.owner.clone(),
            Session::Http { .. } => None,
        })
        .collect()
}

pub(crate) fn ended(job: &Job) -> bool {
    job.mcp_trial.lock().is_ok_and(|state| {
        state.servers.len() == state.sessions.len() && state.sessions.values().all(Session::ended)
    })
}
pub(crate) fn has_http(job: &Job) -> bool {
    job.mcp_trial
        .lock()
        .is_ok_and(|state| !state.http.is_empty())
}
pub(crate) fn record_closes(job: &Job, local: &LocalState) -> Result<(), String> {
    let state = job.mcp_trial.lock().map_err(|_| protocol())?;
    let owner = if job.kind == JobKind::Trial {
        McpTaskOwner::Trial
    } else {
        McpTaskOwner::Business
    };
    for (server, session) in &state.sessions {
        if let Session::Http { close, .. } = session {
            local
                .access(|store| store.record_mcp_task_close(owner, &job.run_id, server, *close))
                .map_err(|e| e.code.to_string())?;
        }
    }
    Ok(())
}
pub(crate) fn cleanup(job: &Job, directory: &Path) -> bool {
    let Ok(state) = job.mcp_trial.lock() else {
        return false;
    };
    let sessions = state.sessions.values().cloned().collect::<Vec<_>>();
    drop(state);
    let mut owners = Vec::new();
    let mut complete = true;
    for session in sessions {
        if session.ended() {
            continue;
        }
        match session {
            Session::Http { scope, .. } => {
                if scope.run != job.run_id
                    || !mcp_host::group_gone(job.pid.load(std::sync::atomic::Ordering::SeqCst))
                {
                    complete = false;
                }
            }
            Session::Stdio(session) => {
                if let Some(owner) = session.owner {
                    owners.push(owner);
                } else {
                    match mcp_host::discover_intent(&job.run_id, &session.nonce, directory) {
                        Ok(found) => owners.extend(found),
                        Err(_) => complete = false,
                    }
                }
            }
        }
    }
    let cleaned = mcp_host::cleanup_owners(&owners, directory);
    if cleaned && complete {
        if let Ok(mut state) = job.mcp_trial.lock() {
            for session in state.sessions.values_mut() {
                match session {
                    Session::Stdio(s) => {
                        s.ended = true;
                        s.owner = None;
                    }
                    Session::Http { ended, .. } => *ended = true,
                }
            }
        }
    }
    cleaned && complete
}
