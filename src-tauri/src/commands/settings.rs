use aura_core::error::CoreError;
use aura_core::settings::{RecentProject, Settings};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn settings_load(state: State<'_, AppState>) -> Result<Settings, CoreError> {
    state.settings.load_settings()
}

#[tauri::command]
#[specta::specta]
pub fn settings_save(state: State<'_, AppState>, settings: Settings) -> Result<(), CoreError> {
    state.settings.save_settings(&settings)
}

#[tauri::command]
#[specta::specta]
pub fn recents_list(state: State<'_, AppState>) -> Result<Vec<RecentProject>, CoreError> {
    state.settings.load_recents()
}

#[tauri::command]
#[specta::specta]
pub fn recents_touch(
    state: State<'_, AppState>,
    path: String,
    name: String,
    ts_ms: i64,
) -> Result<Vec<RecentProject>, CoreError> {
    state.settings.touch_recent(&path, &name, ts_ms)
}

#[tauri::command]
#[specta::specta]
pub fn recents_remove(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<RecentProject>, CoreError> {
    state.settings.remove_recent(&path)
}
