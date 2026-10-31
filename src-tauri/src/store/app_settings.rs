use super::*;
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationSettings {
    pub time_zone: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettingsInput {
    pub time_zone: String,
    pub expected_time_zone: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationSettingsSave {
    pub settings: ApplicationSettings,
    pub warning: Option<&'static str>,
}
#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
pub(super) enum SettingsWriteFault {
    BeforeReplace,
    AfterReplace,
    ReadBack,
}
fn valid_zone(zone: &str) -> bool {
    !zone.is_empty()
        && zone.len() <= 128
        && zone.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_+-".contains(&b))
        })
        && Path::new("/usr/share/zoneinfo").join(zone).is_file()
}
impl AppStore {
    fn application_config(&self) -> Result<(PathBuf, RootConfig)> {
        let path = self.root()?.join("config/app.json");
        let parent = fs::symlink_metadata(path.parent().ok_or_else(invalid)?).map_err(io_error)?;
        let meta = fs::symlink_metadata(&path).map_err(io_error)?;
        if !parent.is_dir()
            || parent.file_type().is_symlink()
            || !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.nlink() != 1
        {
            return Err(StoreError::new(
                "INVALID_SETTINGS",
                "应用配置必须是原工作目录中的独立普通文件，原配置未覆盖。",
            ));
        }
        let c: RootConfig = read_json(&path, "INVALID_SETTINGS")?;
        if c.app != "sidekick" || c.version != 1 || c.state != "ready" || !valid_zone(&c.time_zone)
        {
            return Err(StoreError::new(
                "INVALID_SETTINGS",
                "应用时间配置无法识别，请恢复原配置后重试。",
            ));
        }
        Ok((path, c))
    }
    pub fn application_settings(&self) -> Result<ApplicationSettings> {
        let (_, c) = self.application_config()?;
        Ok(ApplicationSettings {
            time_zone: c.time_zone,
        })
    }
    pub fn save_application_settings(
        &self,
        input: AppSettingsInput,
    ) -> Result<ApplicationSettingsSave> {
        if !valid_zone(&input.time_zone) {
            return Err(StoreError::new(
                "INVALID_TIMEZONE",
                "请选择有效的应用时区。",
            ));
        }
        let (path, mut c) = self.application_config()?;
        if c.time_zone != input.expected_time_zone {
            return Err(StoreError::new(
                "SETTINGS_CONFLICT",
                "通用设置已有更新，草稿已保留，请重新读取核对。",
            ));
        }
        c.time_zone = input.time_zone;
        let target = ApplicationSettings {
            time_zone: c.time_zone.clone(),
        };
        let write = (|| {
            #[cfg(test)]
            if self.settings_write_fault == Some(SettingsWriteFault::BeforeReplace) {
                return Err(io_error(std::io::Error::other("synthetic settings write")));
            }
            atomic_json(&path, &c)?;
            #[cfg(test)]
            if matches!(
                self.settings_write_fault,
                Some(SettingsWriteFault::AfterReplace | SettingsWriteFault::ReadBack)
            ) {
                return Err(io_error(std::io::Error::other("synthetic settings sync")));
            }
            Ok(())
        })();
        match write {
            Ok(()) => Ok(ApplicationSettingsSave {
                settings: target,
                warning: None,
            }),
            Err(e) => {
                let actual = self.application_settings();
                #[cfg(test)]
                let actual = if self.settings_write_fault == Some(SettingsWriteFault::ReadBack) {
                    Err(io_error(std::io::Error::other("synthetic settings read")))
                } else {
                    actual
                };
                match actual {
                    Ok(value) if value == target => Ok(ApplicationSettingsSave {
                        settings: value,
                        warning: Some("当前时区已生效，但磁盘同步未能确认，请稍后重新保存。"),
                    }),
                    Ok(_) => Err(e),
                    Err(_) => Err(StoreError::new(
                        "SETTINGS_UNCERTAIN",
                        "保存结果暂无法确认，请重新读取通用设置后继续。",
                    )),
                }
            }
        }
    }
}
