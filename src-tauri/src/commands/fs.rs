//! Tauri-обёртки над `aura_core::fs` + fs-watcher через `notify`.

use aura_core::error::CoreError;
use aura_core::fs::{self as core_fs, FsEntry};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::State;

use crate::state::AppState;
use crate::watcher::{spawn_watcher, WatchHandle};

fn as_path(root: &str) -> PathBuf {
    PathBuf::from(root)
}

#[tauri::command]
#[specta::specta]
pub fn fs_read_dir(root: String, rel: String) -> Result<Vec<FsEntry>, CoreError> {
    core_fs::read_dir(&as_path(&root), &rel)
}

#[tauri::command]
#[specta::specta]
pub fn fs_read_file(root: String, rel: String) -> Result<String, CoreError> {
    core_fs::read_file(&as_path(&root), &rel)
}

#[tauri::command]
#[specta::specta]
pub fn fs_write_file(root: String, rel: String, contents: String) -> Result<(), CoreError> {
    core_fs::write_file(&as_path(&root), &rel, &contents)
}

#[tauri::command]
#[specta::specta]
pub fn fs_create_file(root: String, rel: String) -> Result<(), CoreError> {
    core_fs::create_file(&as_path(&root), &rel)
}

#[tauri::command]
#[specta::specta]
pub fn fs_create_dir(root: String, rel: String) -> Result<(), CoreError> {
    core_fs::create_dir(&as_path(&root), &rel)
}

#[tauri::command]
#[specta::specta]
pub fn fs_rename(root: String, from_rel: String, to_rel: String) -> Result<(), CoreError> {
    core_fs::rename(&as_path(&root), &from_rel, &to_rel)
}

#[tauri::command]
#[specta::specta]
pub fn fs_delete(root: String, rel: String) -> Result<(), CoreError> {
    core_fs::delete(&as_path(&root), &rel)
}

/// Событие изменения файла — эмитим на фронт под именем `fs://event`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FsEvent {
    pub watch_id: String,
    pub kind: String,
    pub paths: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub fn fs_watch(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    watch_id: String,
    root: String,
) -> Result<(), CoreError> {
    let handle: WatchHandle = spawn_watcher(app, watch_id.clone(), PathBuf::from(&root))?;
    let mut map = state
        .watchers
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    map.insert(watch_id, handle);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn fs_unwatch(state: State<'_, AppState>, watch_id: String) -> Result<(), CoreError> {
    let mut map = state
        .watchers
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    map.remove(&watch_id);
    Ok(())
}
