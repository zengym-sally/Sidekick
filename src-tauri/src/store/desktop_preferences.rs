use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopPreferences {
    pub version: u32,
    pub work_mode: bool,
    pub pet_on_startup: bool,
}
impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            version: 1,
            work_mode: false,
            pet_on_startup: false,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopPreferencesInput {
    pub preferences: DesktopPreferences,
    pub expected: DesktopPreferences,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferencesSave {
    pub preferences: DesktopPreferences,
    pub warning: Option<&'static str>,
}
impl AppStore {
    fn desktop_preferences_path(&self) -> Result<PathBuf> {
        let directory = self.root()?.join("config");
        let meta = fs::symlink_metadata(&directory).map_err(io_error)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(StoreError::new(
                "INVALID_DESKTOP",
                "桌面配置目录无法识别，请恢复原工作目录后重试。",
            ));
        }
        let path = directory.join("desktop.json");
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() && meta.nlink() == 1 => {}
            Ok(_) => {
                return Err(StoreError::new(
                    "INVALID_DESKTOP",
                    "桌面配置必须是独立普通文件，原文件未覆盖。",
                ))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_error(e)),
        }
        Ok(path)
    }
    pub fn desktop_preferences(&self) -> Result<DesktopPreferences> {
        let path = self.desktop_preferences_path()?;
        if !path.exists() {
            return Ok(DesktopPreferences::default());
        }
        let preferences: DesktopPreferences = read_json(&path, "INVALID_DESKTOP")?;
        if preferences.version != 1 {
            return Err(StoreError::new(
                "DESKTOP_TOO_NEW",
                "桌面配置版本不支持，请使用兼容版本，原文件未覆盖。",
            ));
        }
        Ok(preferences)
    }
    pub fn save_desktop_preferences(
        &self,
        input: DesktopPreferencesInput,
    ) -> Result<DesktopPreferencesSave> {
        if input.preferences.version != 1 || input.expected.version != 1 {
            return Err(StoreError::new(
                "INVALID_DESKTOP",
                "桌面偏好格式不支持，请重新读取后继续。",
            ));
        }
        if self.desktop_preferences()? != input.expected {
            return Err(StoreError::new(
                "DESKTOP_CONFLICT",
                "桌面偏好已有更新，草稿已保留，请重新读取核对。",
            ));
        }
        let path = self.desktop_preferences_path()?;
        let write = (|| {
            #[cfg(test)]
            if self.settings_write_fault == Some(SettingsWriteFault::BeforeReplace) {
                return Err(io_error(std::io::Error::other("synthetic desktop write")));
            }
            atomic_json(&path, &input.preferences)?;
            #[cfg(test)]
            if matches!(
                self.settings_write_fault,
                Some(SettingsWriteFault::AfterReplace | SettingsWriteFault::ReadBack)
            ) {
                return Err(io_error(std::io::Error::other("synthetic desktop sync")));
            }
            Ok(())
        })();
        match write {
            Ok(()) => Ok(DesktopPreferencesSave {
                preferences: input.preferences,
                warning: None,
            }),
            Err(error) => {
                let actual = self.desktop_preferences();
                #[cfg(test)]
                let actual = if self.settings_write_fault == Some(SettingsWriteFault::ReadBack) {
                    Err(io_error(std::io::Error::other(
                        "synthetic desktop readback",
                    )))
                } else {
                    actual
                };
                match actual {
                    Ok(value) if value == input.preferences => Ok(DesktopPreferencesSave {
                        preferences: value,
                        warning: Some("桌面偏好已生效，但磁盘同步未能确认，请稍后重新保存。"),
                    }),
                    Ok(_) => Err(error),
                    Err(_) => Err(StoreError::new(
                        "DESKTOP_UNCERTAIN",
                        "保存结果暂无法确认，请重新读取桌面偏好后继续。",
                    )),
                }
            }
        }
    }
}
