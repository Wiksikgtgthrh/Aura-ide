//! Настройки и список последних проектов (`~/.aura/`).

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, CoreResult};

const MAX_RECENTS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
    System,
}

impl Default for Theme {
    fn default() -> Self {
        Theme::System
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Settings {
    #[serde(default)]
    pub theme: Theme,
    /// Размер шрифта редактора.
    #[serde(default = "default_font_size")]
    pub editor_font_size: u32,
    /// Модель для AI-чата (пусто = дефолт).
    #[serde(default)]
    pub ai_model: String,
    /// Показывать ли AI-панель по умолчанию.
    #[serde(default = "default_true")]
    pub ai_panel_open: bool,
    /// Показывать ли встроенный терминал по умолчанию.
    #[serde(default = "default_true")]
    pub terminal_open: bool,
}

// `#[derive(Default)]` не использует `#[serde(default = "…")]` для полей —
// они работают только при десериализации из JSON. Пишем Default вручную,
// чтобы `Settings::default()` дал ту же картину, что и пустой `{}`.
impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            editor_font_size: default_font_size(),
            ai_model: String::new(),
            ai_panel_open: default_true(),
            terminal_open: default_true(),
        }
    }
}

fn default_font_size() -> u32 {
    14
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    /// Unix ms последнего открытия.
    pub last_opened_ms: i64,
}

/// Абстракция локации для тестов: в проде — `~/.aura/`, в тестах — tmpdir.
#[derive(Debug, Clone)]
pub struct SettingsStore {
    root: PathBuf,
}

impl SettingsStore {
    /// Дефолтная локация: `~/.aura/`.
    pub fn default_location() -> CoreResult<Self> {
        let proj = ProjectDirs::from("dev", "aura", "Aura")
            .ok_or_else(|| CoreError::Settings("no home directory".into()))?;
        let root = proj.config_dir().to_path_buf();
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    pub fn at(root: impl Into<PathBuf>) -> CoreResult<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    fn recents_path(&self) -> PathBuf {
        self.root.join("recents.json")
    }

    pub fn load_settings(&self) -> CoreResult<Settings> {
        let path = self.settings_path();
        if !path.exists() {
            return Ok(Settings::default());
        }
        let raw = std::fs::read_to_string(&path)?;
        // Битый файл — не крашим IDE, возвращаем дефолт, лог оставим на уровне
        // Tauri.
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    pub fn save_settings(&self, s: &Settings) -> CoreResult<()> {
        let raw = serde_json::to_string_pretty(s)?;
        atomic_write(&self.settings_path(), raw.as_bytes())
    }

    pub fn load_recents(&self) -> CoreResult<Vec<RecentProject>> {
        let path = self.recents_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = std::fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    /// Добавляет/поднимает проект в списке recents, обрезая до `MAX_RECENTS`.
    pub fn touch_recent(&self, path: &str, name: &str, ts_ms: i64) -> CoreResult<Vec<RecentProject>> {
        let mut list = self.load_recents()?;
        list.retain(|r| r.path != path);
        list.insert(
            0,
            RecentProject {
                path: path.to_string(),
                name: name.to_string(),
                last_opened_ms: ts_ms,
            },
        );
        list.truncate(MAX_RECENTS);
        let raw = serde_json::to_string_pretty(&list)?;
        atomic_write(&self.recents_path(), raw.as_bytes())?;
        Ok(list)
    }

    pub fn remove_recent(&self, path: &str) -> CoreResult<Vec<RecentProject>> {
        let mut list = self.load_recents()?;
        list.retain(|r| r.path != path);
        let raw = serde_json::to_string_pretty(&list)?;
        atomic_write(&self.recents_path(), raw.as_bytes())?;
        Ok(list)
    }
}

fn atomic_write(path: &Path, data: &[u8]) -> CoreResult<()> {
    let tmp = path.with_extension("aura-tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn load_default_when_file_missing() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::at(dir.path()).unwrap();
        let s = store.load_settings().unwrap();
        assert_eq!(s.editor_font_size, 14);
        assert!(matches!(s.theme, Theme::System));
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::at(dir.path()).unwrap();
        let mut s = Settings::default();
        s.theme = Theme::Dark;
        s.editor_font_size = 16;
        store.save_settings(&s).unwrap();
        let loaded = store.load_settings().unwrap();
        assert!(matches!(loaded.theme, Theme::Dark));
        assert_eq!(loaded.editor_font_size, 16);
    }

    #[test]
    fn recents_dedupe_and_move_to_top() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::at(dir.path()).unwrap();
        store.touch_recent("/a", "a", 1).unwrap();
        store.touch_recent("/b", "b", 2).unwrap();
        let list = store.touch_recent("/a", "a", 3).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, "/a");
        assert_eq!(list[0].last_opened_ms, 3);
        assert_eq!(list[1].path, "/b");
    }

    #[test]
    fn recents_cap_at_max() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::at(dir.path()).unwrap();
        for i in 0..(MAX_RECENTS + 5) {
            store
                .touch_recent(&format!("/p{i}"), &format!("p{i}"), i as i64)
                .unwrap();
        }
        let list = store.load_recents().unwrap();
        assert_eq!(list.len(), MAX_RECENTS);
        // Последний добавленный — на верху.
        assert_eq!(list[0].path, format!("/p{}", MAX_RECENTS + 4));
    }

    #[test]
    fn remove_recent_works() {
        let dir = tempdir().unwrap();
        let store = SettingsStore::at(dir.path()).unwrap();
        store.touch_recent("/a", "a", 1).unwrap();
        store.touch_recent("/b", "b", 2).unwrap();
        let list = store.remove_recent("/a").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "/b");
    }
}
