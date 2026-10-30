use super::*;

pub const AGENT_IDS: [&str; 3] = ["organizer", "tracker", "advisor"];
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentPreferences {
    pub detail: String,
    pub focus: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConfig {
    pub version: u32,
    pub agent_id: String,
    pub revision: String,
    pub model_id: Option<String>,
    pub preferences: AgentPreferences,
    pub supplemental_instructions: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConfigInput {
    pub agent_id: String,
    pub expected_revision: String,
    pub model_id: Option<String>,
    pub preferences: AgentPreferences,
    pub supplemental_instructions: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigSave {
    pub configuration: AgentConfig,
    pub warning: Option<&'static str>,
}
#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
pub(super) enum AgentWriteFault {
    BeforeReplace,
    AfterReplace,
    Uncertain,
}
fn invalid_agent() -> StoreError {
    StoreError::new(
        "INVALID_AGENT_CONFIG",
        "智能体配置无法识别，请检查角色、偏好和模型，原文件未覆盖。",
    )
}
fn uncertain_agent() -> StoreError {
    StoreError::new(
        "AGENT_SAVE_UNCERTAIN",
        "智能体配置保存结果暂无法确认，请重新读取核对后再继续。",
    )
}
fn role(id: &str) -> Result<()> {
    if AGENT_IDS.contains(&id) {
        Ok(())
    } else {
        Err(invalid_agent())
    }
}
fn defaults(id: &str) -> AgentConfig {
    AgentConfig {
        version: 1,
        agent_id: id.into(),
        revision: format!("default-1-{id}"),
        model_id: None,
        preferences: AgentPreferences {
            detail: "standard".into(),
            focus: match id {
                "organizer" => "balanced",
                "tracker" => "evidence",
                _ => "deadline",
            }
            .into(),
        },
        supplemental_instructions: String::new(),
    }
}
fn validate(c: &AgentConfig) -> Result<()> {
    role(&c.agent_id)?;
    let focuses = match c.agent_id.as_str() {
        "organizer" => vec!["balanced", "my_actions", "followups"],
        "tracker" => vec!["evidence", "risks"],
        _ => vec!["deadline", "followup"],
    };
    if c.version != 1
        || c.revision.is_empty()
        || c.revision.len() > 128
        || c.revision.chars().any(char::is_control)
        || !focuses.contains(&c.preferences.focus.as_str())
        || !["concise", "standard", "detailed"].contains(&c.preferences.detail.as_str())
        || c.supplemental_instructions.chars().count() > 4000
        || c.supplemental_instructions
            .chars()
            .any(|ch| ch.is_control() && !['\n', '\t'].contains(&ch))
        || c.model_id
            .as_ref()
            .is_some_and(|m| m.is_empty() || m.len() > 128 || m.chars().any(char::is_control))
    {
        return Err(invalid_agent());
    }
    Ok(())
}
impl AppStore {
    pub(super) fn agent_path(&self, id: &str) -> Result<PathBuf> {
        role(id)?;
        let config = self.root()?.join("config");
        private_dir(&config)?;
        let directory = config.join("agents");
        private_dir(&directory)?;
        let path = directory.join(format!("{id}.json"));
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && m.nlink() == 1 && m.len() <= 32768 => {}
            Ok(_) => return Err(invalid_agent()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_error(e)),
        }
        Ok(path)
    }
    fn load_agent(&self, id: &str) -> Result<AgentConfig> {
        let path = self.agent_path(id)?;
        if !path.exists() {
            return Ok(defaults(id));
        }
        let c: AgentConfig = read_json(&path, "INVALID_AGENT_CONFIG")?;
        validate(&c)?;
        if c.agent_id != id {
            return Err(invalid_agent());
        }
        Ok(c)
    }
    pub fn agent_config(&self, id: &str) -> Result<AgentConfig> {
        if self.agent_uncertain.contains(id) {
            return Err(uncertain_agent());
        }
        self.load_agent(id)
    }
    pub fn read_agent_config(&mut self, id: &str) -> Result<AgentConfig> {
        let c = self.load_agent(id)?;
        self.agent_uncertain.remove(id);
        Ok(c)
    }
    pub(super) fn validate_agent_model_refs(
        &self,
        providers: &serde_json::Value,
        models: &serde_json::Value,
    ) -> Result<()> {
        for id in AGENT_IDS {
            let c = self.agent_config(id)?;
            if let Some(id) = c.model_id {
                validate_model_ref(&id, providers, models)?
            }
        }
        Ok(())
    }
    pub fn save_agent_config(&mut self, input: AgentConfigInput) -> Result<AgentConfigSave> {
        let current = self.agent_config(&input.agent_id)?;
        if current.revision != input.expected_revision {
            return Err(StoreError::new(
                "AGENT_VERSION_CONFLICT",
                "这份配置已有新版本，请保留草稿并重新读取核对。",
            ));
        }
        let c = AgentConfig {
            version: 1,
            agent_id: input.agent_id,
            revision: format!("agent-{}-{}", std::process::id(), nonce()),
            model_id: input.model_id,
            preferences: input.preferences,
            supplemental_instructions: input.supplemental_instructions.trim().into(),
        };
        validate(&c)?;
        if let Some(id) = &c.model_id {
            let model = self.read_models()?.ok_or_else(|| {
                StoreError::new("AGENT_MODEL_MISSING", "请先配置模型，或选择继承默认模型。")
            })?;
            validate_model_ref(id, &model.providers, &model.models)?
        }
        let path = self.agent_path(&c.agent_id)?;
        let result = self.write_agent(&path, &c);
        match result {
            Ok(()) => Ok(AgentConfigSave {
                configuration: c,
                warning: None,
            }),
            Err(e) => {
                #[cfg(test)]
                let actual = if self.agent_write_fault == Some(AgentWriteFault::Uncertain) {
                    Err(uncertain_agent())
                } else {
                    self.load_agent(&c.agent_id)
                };
                #[cfg(not(test))]
                let actual = self.load_agent(&c.agent_id);
                match actual {
                    Ok(actual) if actual == c => Ok(AgentConfigSave {
                        configuration: actual,
                        warning: Some("配置已保存，但磁盘同步未确认，请重新读取核对。"),
                    }),
                    Ok(_) => Err(e),
                    Err(_) => {
                        self.agent_uncertain.insert(c.agent_id);
                        Err(uncertain_agent())
                    }
                }
            }
        }
    }
    fn write_agent(&self, path: &Path, c: &AgentConfig) -> Result<()> {
        #[cfg(test)]
        if self.agent_write_fault == Some(AgentWriteFault::BeforeReplace) {
            return Err(io_error(std::io::Error::other("synthetic before replace")));
        }
        atomic_json(path, c)?;
        #[cfg(test)]
        if matches!(
            self.agent_write_fault,
            Some(AgentWriteFault::AfterReplace | AgentWriteFault::Uncertain)
        ) {
            return Err(io_error(std::io::Error::other("synthetic after replace")));
        }
        Ok(())
    }
    pub fn reset_agent_config(&mut self, id: &str, revision: &str) -> Result<AgentConfigSave> {
        let c = defaults(id);
        self.save_agent_config(AgentConfigInput {
            agent_id: id.into(),
            expected_revision: revision.into(),
            model_id: None,
            preferences: c.preferences,
            supplemental_instructions: String::new(),
        })
    }
}
pub(super) fn validate_model_ref(
    id: &str,
    providers: &serde_json::Value,
    models: &serde_json::Value,
) -> Result<()> {
    let model = models["models"]
        .as_array()
        .and_then(|items| items.iter().find(|m| m["id"].as_str() == Some(id)));
    let available = model.is_some_and(|m| {
        m["status"] != "disabled"
            && m["enabled"] != false
            && providers["providers"].as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|p| p["id"] == m["providerId"] && p["enabled"] != false)
            })
    });
    if available {
        Ok(())
    } else {
        Err(StoreError::new(
            "AGENT_MODEL_REFERENCED",
            "智能体引用的模型不存在或已禁用，请先解除覆盖或修正模型配置。",
        ))
    }
}
#[cfg(test)]
#[path = "agent_config_tests.rs"]
mod tests;
