use super::*;
use apple_native_keyring_store::keychain::Store;
use keyring_core::api::CredentialStoreApi;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelConfigInput {
    pub providers: Value,
    pub models: Value,
    pub default_model_id: String,
    #[serde(default)]
    pub expected_revision: Option<String>,
    #[serde(default)]
    pub api_keys: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfiguration {
    pub providers: Value,
    pub models: Value,
    pub default_model_id: String,
    pub revision: String,
    pub credential_status: BTreeMap<String, String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigSave {
    pub configuration: ModelConfiguration,
    pub warning: Option<&'static str>,
}
pub struct PreparedModel {
    pub snapshot: Value,
    pub api_key: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelJournal {
    version: u32,
    providers: Value,
    models: Value,
}
fn config_error() -> StoreError {
    StoreError::new(
        "INVALID_MODEL_CONFIG",
        "模型配置无法识别，请检查供应商、模型引用、默认模型和认证方式。",
    )
}
fn encode(value: &impl Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(|_| config_error())
}
fn uncertain() -> StoreError {
    StoreError::new(
        "MODEL_CONFIG_UNCERTAIN",
        "模型配置保存结果暂无法确认，请重新读取恢复后再继续。",
    )
}
fn keychain_error() -> StoreError {
    StoreError::new(
        "KEYCHAIN_UNAVAILABLE",
        "无法访问系统钥匙串，请检查系统授权后重试。",
    )
}
fn id_field<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    let text = value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(config_error)?;
    if text.is_empty()
        || text.len() > 128
        || !text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-/".contains(&b))
    {
        return Err(config_error());
    }
    Ok(text)
}
fn authentication_name(name: &str) -> bool {
    let normalized: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    normalized.ends_with("apikey")
        || normalized.ends_with("authorization")
        || [
            "password",
            "secret",
            "token",
            "accesstoken",
            "refreshtoken",
            "cookie",
            "setcookie",
        ]
        .contains(&normalized.as_str())
}
fn reject_plain_secrets(value: &Value) -> Result<()> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if authentication_name(key) {
                    return Err(StoreError::new(
                        "PLAIN_CREDENTIAL",
                        "请把密钥写入系统钥匙串，配置文件只保留认证引用。",
                    ));
                }
                reject_plain_secrets(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_plain_secrets(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn validate_pair(providers: &Value, models: &Value, selected: &str) -> Result<()> {
    reject_plain_secrets(providers)?;
    reject_plain_secrets(models)?;
    let providers = providers
        .get("providers")
        .and_then(Value::as_array)
        .ok_or_else(config_error)?;
    let entries = models
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(config_error)?;
    if providers.is_empty()
        || providers.len() > 30
        || entries.is_empty()
        || entries.len() > 200
        || encode(providers)?.len() + encode(models)?.len() > 1_000_000
    {
        return Err(config_error());
    }
    let mut ids = BTreeSet::new();
    for provider in providers {
        if !ids.insert(id_field(provider, "id")?) {
            return Err(config_error());
        }
        let endpoint = provider
            .get("baseUrl")
            .and_then(Value::as_str)
            .ok_or_else(config_error)?;
        let url = tauri::Url::parse(endpoint).map_err(|_| config_error())?;
        if !["http", "https"].contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query_pairs().any(|(key, _)| authentication_name(&key))
        {
            return Err(config_error());
        }
        provider
            .get("apiFormat")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(config_error)?;
        let auth = provider
            .get("auth")
            .and_then(Value::as_object)
            .ok_or_else(config_error)?;
        if auth.get("type").and_then(Value::as_str) != Some("bearer")
            || auth.contains_key("apiKeyEnv") == auth.contains_key("apiKeyRef")
        {
            return Err(config_error());
        }
        let reference = auth
            .get("apiKeyEnv")
            .or_else(|| auth.get("apiKeyRef"))
            .and_then(Value::as_str)
            .ok_or_else(config_error)?;
        if reference.is_empty() || reference.len() > 128 || reference.chars().any(char::is_control)
        {
            return Err(config_error());
        }
        if auth.contains_key("apiKeyEnv")
            && (!reference
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
                || reference.starts_with(|c: char| c.is_ascii_digit()))
        {
            return Err(config_error());
        }
        if let Some(headers) = provider.get("extraHeaders") {
            for (name, value) in headers.as_object().ok_or_else(config_error)? {
                let key = name.to_ascii_lowercase();
                let value = value.as_str().ok_or_else(config_error)?;
                if authentication_name(&key)
                    || key.contains("token")
                    || name.contains(['\r', '\n'])
                    || value.contains(['\r', '\n'])
                {
                    return Err(StoreError::new(
                        "PLAIN_CREDENTIAL",
                        "认证请求头不能明文写入配置，请使用钥匙串引用。",
                    ));
                }
            }
        }
    }
    let mut model_ids = BTreeSet::new();
    for model in entries {
        validate_parameters(model)?;
        if !model_ids.insert(id_field(model, "id")?)
            || !ids.contains(id_field(model, "providerId")?)
        {
            return Err(config_error());
        }
        model
            .get("apiModelId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .ok_or_else(config_error)?;
    }
    let model = entries
        .iter()
        .find(|m| m.get("id").and_then(Value::as_str) == Some(selected))
        .ok_or_else(config_error)?;
    let provider = providers
        .iter()
        .find(|p| p["id"] == model["providerId"])
        .ok_or_else(config_error)?;
    if provider.get("enabled") == Some(&Value::Bool(false))
        || model.get("enabled") == Some(&Value::Bool(false))
        || model.get("status").and_then(Value::as_str) == Some("disabled")
    {
        return Err(config_error());
    }
    Ok(())
}
fn validate_parameters(model: &Value) -> Result<()> {
    for (path, min, max) in [
        ("/limits/maxInputTokens", 1024, 2_000_000),
        ("/limits/maxOutputTokens", 1, 262_144),
    ] {
        if let Some(v) = model.pointer(path).filter(|v| !v.is_null()) {
            if !v.as_u64().is_some_and(|n| (min..=max).contains(&n)) {
                return Err(config_error());
            }
        }
    }
    if let (Some(input), Some(output)) = (
        model
            .pointer("/limits/maxInputTokens")
            .and_then(Value::as_u64),
        model
            .pointer("/limits/maxOutputTokens")
            .and_then(Value::as_u64),
    ) {
        if output > input {
            return Err(config_error());
        }
    }
    for (path, max) in [
        ("/defaultParams/temperature", 2.0),
        ("/defaultParams/topP", 1.0),
    ] {
        if let Some(v) = model.pointer(path).filter(|v| !v.is_null()) {
            if !v
                .as_f64()
                .is_some_and(|n| n.is_finite() && (0.0..=max).contains(&n))
            {
                return Err(config_error());
            }
        }
    }
    if let Some(effort) = model
        .pointer("/reasoning/defaultEffort")
        .filter(|v| !v.is_null())
    {
        let effort = effort.as_str().ok_or_else(config_error)?;
        if ![
            "default", "off", "minimal", "low", "medium", "high", "xhigh", "max",
        ]
        .contains(&effort)
        {
            return Err(config_error());
        }
        if effort == "off"
            && (model.pointer("/reasoning/onlyReasoning") == Some(&Value::Bool(true))
                || model.pointer("/reasoning/canDisableThinking") == Some(&Value::Bool(false)))
        {
            return Err(config_error());
        }
        if !["default", "off"].contains(&effort)
            && model
                .pointer("/reasoning/supportedEfforts")
                .and_then(Value::as_array)
                .is_some_and(|values| !values.iter().any(|v| v.as_str() == Some(effort)))
        {
            return Err(config_error());
        }
    }
    Ok(())
}
fn persisted_metadata(providers: &Value, models: &Value) -> Result<(String, String)> {
    let metadata = models.get("sidekick").ok_or_else(config_error)?;
    if metadata.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(config_error());
    }
    let selected = id_field(metadata, "defaultModelId")?.to_string();
    let revision = id_field(metadata, "revision")?.to_string();
    validate_pair(providers, models, &selected)?;
    Ok((selected, revision))
}
impl AppStore {
    fn model_path(&self, name: &str) -> Result<PathBuf> {
        let directory = self.root()?.join("config");
        let metadata = fs::symlink_metadata(&directory).map_err(io_error)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(config_error());
        }
        let path = directory.join(name);
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && m.nlink() == 1 => {}
            Ok(_) => return Err(config_error()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_error(e)),
        }
        Ok(path)
    }
    fn credential_service(&self) -> Result<String> {
        Ok(format!(
            "com.sidekick.credentials.{}",
            sha256(&format!(
                "{}\0{}",
                self.app_dir.display(),
                self.root()?.display()
            ))
        ))
    }
    fn credential_read(&self, reference: &str) -> Result<String> {
        let store = Store::new().map_err(|_| keychain_error())?;
        let entry = store
            .build(&self.credential_service()?, reference, None)
            .map_err(|_| keychain_error())?;
        match entry.get_password() {
            Ok(key) if !key.is_empty() => Ok(key),
            Err(keyring_core::Error::NoEntry) | Ok(_) => Err(StoreError::new(
                "CREDENTIAL_MISSING",
                "没有可用的模型密钥，请在模型设置中填写并保存到钥匙串。",
            )),
            Err(_) => Err(keychain_error()),
        }
    }
    fn credential_write(&self, reference: &str, key: &str) -> Result<()> {
        if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
            return Err(StoreError::new(
                "INVALID_CREDENTIAL",
                "请填写有效的API Key。",
            ));
        }
        let store = Store::new().map_err(|_| keychain_error())?;
        let entry = store
            .build(&self.credential_service()?, reference, None)
            .map_err(|_| keychain_error())?;
        entry.set_password(key).map_err(|_| keychain_error())
    }
    fn remove_new_credentials(&self, references: &[String]) {
        if let (Ok(store), Ok(service)) = (Store::new(), self.credential_service()) {
            for reference in references {
                if let Ok(entry) = store.build(&service, reference, None) {
                    let _ = entry.delete_credential();
                }
            }
        }
    }
    fn model_fault(&self, phase: &str) -> Result<()> {
        #[cfg(test)]
        if matches!(
            (self.model_write_fault, phase),
            (Some(ModelWriteFault::BeforeJournal), "before")
                | (Some(ModelWriteFault::AfterJournal), "journal")
                | (
                    Some(ModelWriteFault::AfterProviders | ModelWriteFault::Uncertain),
                    "providers"
                )
                | (Some(ModelWriteFault::AfterModels), "models")
        ) {
            return Err(io_error(std::io::Error::other(
                "synthetic config interruption",
            )));
        }
        let _ = phase;
        Ok(())
    }
    fn recover_model_config(&self) -> Result<()> {
        let journal = self.model_path(".llm-journal.json")?;
        if !journal.exists() {
            return Ok(());
        }
        #[cfg(test)]
        if self.model_write_fault == Some(ModelWriteFault::Uncertain) {
            return Err(uncertain());
        }
        let pending: ModelJournal = read_json(&journal, "INVALID_MODEL_CONFIG")?;
        if pending.version != 1 {
            return Err(config_error());
        }
        persisted_metadata(&pending.providers, &pending.models)?;
        atomic_json(&self.model_path("providers.json")?, &pending.providers)?;
        atomic_json(&self.model_path("models.json")?, &pending.models)?;
        fs::remove_file(journal).map_err(io_error)?;
        Ok(())
    }
    pub fn read_models(&self) -> Result<Option<ModelConfiguration>> {
        self.recover_model_config()?;
        let providers = self.model_path("providers.json")?;
        let models = self.model_path("models.json")?;
        if !providers.exists() && !models.exists() {
            return Ok(None);
        }
        let providers: Value = read_json(&providers, "INVALID_MODEL_CONFIG")?;
        let models: Value = read_json(&models, "INVALID_MODEL_CONFIG")?;
        let (selected, revision) = persisted_metadata(&providers, &models)?;
        let mut credential_status = BTreeMap::new();
        for p in providers["providers"].as_array().ok_or_else(config_error)? {
            let auth = &p["auth"];
            let state = if let Some(variable) = auth["apiKeyEnv"].as_str() {
                if std::env::var(variable).is_ok_and(|s| !s.is_empty()) {
                    "environment"
                } else {
                    "missing"
                }
            } else {
                match self.credential_read(auth["apiKeyRef"].as_str().ok_or_else(config_error)?) {
                    Ok(_) => "stored",
                    Err(e) if e.code == "CREDENTIAL_MISSING" => "missing",
                    Err(_) => "unavailable",
                }
            };
            credential_status.insert(id_field(p, "id")?.to_string(), state.to_string());
        }
        Ok(Some(ModelConfiguration {
            providers,
            models,
            default_model_id: selected,
            revision,
            credential_status,
        }))
    }
    pub fn save_models(&self, mut input: ModelConfigInput) -> Result<ModelConfigSave> {
        let current = self.read_models()?;
        if input.expected_revision.as_ref().is_some_and(|expected| {
            current.as_ref().map(|c| c.revision.as_str()).unwrap_or("") != expected
        }) {
            return Err(StoreError::new(
                "MODEL_VERSION_CONFLICT",
                "模型配置已有更新，草稿已保留，请重新读取后核对。",
            ));
        }
        reject_plain_secrets(&input.providers)?;
        reject_plain_secrets(&input.models)?;
        let mut references = BTreeMap::new();
        let providers = input
            .providers
            .get_mut("providers")
            .and_then(Value::as_array_mut)
            .ok_or_else(config_error)?;
        for id in input.api_keys.keys() {
            let provider = providers
                .iter_mut()
                .find(|p| p["id"].as_str() == Some(id))
                .ok_or_else(config_error)?;
            let reference = format!("credential-{}", new_model_reference());
            let mut auth = provider["auth"]
                .as_object()
                .cloned()
                .ok_or_else(config_error)?;
            auth.remove("apiKeyEnv");
            auth.remove("apiKeyRef");
            auth.insert("type".into(), json!("bearer"));
            auth.insert("apiKeyRef".into(), json!(reference));
            provider["auth"] = Value::Object(auth);
            references.insert(id.clone(), reference);
        }
        validate_pair(&input.providers, &input.models, &input.default_model_id)?;
        self.validate_agent_model_refs(&input.providers, &input.models)?;
        for key in input.api_keys.values() {
            if !key.is_empty()
                && (encode(&input.providers)?.contains(key) || encode(&input.models)?.contains(key))
            {
                return Err(StoreError::new(
                    "PLAIN_CREDENTIAL",
                    "配置中不能保留API Key明文。",
                ));
            }
        }
        let mut written = Vec::new();
        for (id, reference) in references {
            if let Err(error) = self.credential_write(&reference, &input.api_keys[&id]) {
                self.remove_new_credentials(&written);
                return Err(error);
            }
            written.push(reference);
        }
        let revision = new_model_reference();
        input
            .models
            .as_object_mut()
            .ok_or_else(config_error)?
            .insert(
                "sidekick".into(),
                json!({"version":1,"revision":revision,"defaultModelId":input.default_model_id}),
            );
        let pending = ModelJournal {
            version: 1,
            providers: input.providers,
            models: input.models,
        };
        let write = (|| {
            self.model_fault("before")?;
            atomic_json(&self.model_path(".llm-journal.json")?, &pending)?;
            self.model_fault("journal")?;
            atomic_json(&self.model_path("providers.json")?, &pending.providers)?;
            self.model_fault("providers")?;
            atomic_json(&self.model_path("models.json")?, &pending.models)?;
            self.model_fault("models")?;
            fs::remove_file(self.model_path(".llm-journal.json")?).map_err(io_error)?;
            Ok(())
        })();
        let loaded = self.read_models();
        match (write, loaded) {
            (Ok(()), Ok(Some(configuration))) => Ok(ModelConfigSave {
                configuration,
                warning: None,
            }),
            (Err(_), Ok(Some(configuration))) if configuration.revision == revision => {
                Ok(ModelConfigSave {
                    configuration,
                    warning: Some("模型配置已恢复并保存，请测试连接确认。"),
                })
            }
            (Err(error), Ok(_)) => {
                if !self.model_path(".llm-journal.json")?.exists() {
                    self.remove_new_credentials(&written);
                }
                Err(error)
            }
            _ => Err(uncertain()),
        }
    }
    pub fn prepare_model(&self) -> Result<PreparedModel> {
        self.prepare_agent_model("organizer")
    }
    pub fn prepare_agent_model(&self, role: &str) -> Result<PreparedModel> {
        self.prepare_selected_model(Some(self.agent_config(role)?), None)
    }
    pub fn prepare_connection_model(&self) -> Result<PreparedModel> {
        self.prepare_selected_model(None, None)
    }
    pub fn prepare_connection_model_by_id(&self, id: Option<&str>) -> Result<PreparedModel> {
        self.prepare_selected_model(None, id)
    }
    fn prepare_selected_model(
        &self,
        agent: Option<AgentConfig>,
        override_id: Option<&str>,
    ) -> Result<PreparedModel> {
        let config = self.read_models()?.ok_or_else(|| {
            StoreError::new(
                "MODEL_NOT_CONFIGURED",
                "请先在个人信息与设置的模型页配置默认模型。",
            )
        })?;
        let selected = override_id
            .or(agent.as_ref().and_then(|a| a.model_id.as_deref()))
            .unwrap_or(&config.default_model_id);
        super::agent_config::validate_model_ref(selected, &config.providers, &config.models)?;
        let model = config.models["models"]
            .as_array()
            .ok_or_else(config_error)?
            .iter()
            .find(|m| m["id"].as_str() == Some(selected))
            .ok_or_else(config_error)?
            .clone();
        let provider = config.providers["providers"]
            .as_array()
            .ok_or_else(config_error)?
            .iter()
            .find(|p| p["id"] == model["providerId"])
            .ok_or_else(config_error)?
            .clone();
        if provider["apiFormat"] != "openai-compatible" {
            return Err(StoreError::new(
                "UNSUPPORTED_API",
                "当前版本只支持OpenAI兼容接口，请选择兼容供应商。",
            ));
        }
        if provider
            .pointer("/network/proxy")
            .is_some_and(|v| !v.is_null())
        {
            return Err(StoreError::new(
                "UNSUPPORTED_PROXY",
                "当前模型连接尚未支持独立代理，请使用可直接访问的端点。",
            ));
        }
        let retries = provider
            .pointer("/network/retry/maxRetries")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if retries > 2 {
            return Err(config_error());
        }
        let timeout = provider
            .pointer("/network/timeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(120000);
        if !(1000..=120000).contains(&timeout) {
            return Err(config_error());
        }
        let auth = &provider["auth"];
        let api_key = if let Some(variable) = auth["apiKeyEnv"].as_str() {
            std::env::var(variable)
                .ok()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    StoreError::new(
                        "CREDENTIAL_MISSING",
                        "宿主环境中没有认证变量，请改用钥匙串保存API Key。",
                    )
                })?
        } else {
            self.credential_read(auth["apiKeyRef"].as_str().ok_or_else(config_error)?)?
        };
        let profile = self.profile().unwrap_or_default();
        Ok(PreparedModel {
            snapshot: json!({"revision":config.revision,"modelId":selected,"model":model,"provider":provider,"profile":profile,"agent":agent}),
            api_key,
        })
    }
}
fn new_model_reference() -> String {
    format!("{:x}-{:x}", std::process::id(), nonce())
}

#[cfg(test)]
#[path = "model_config_tests.rs"]
mod tests;
