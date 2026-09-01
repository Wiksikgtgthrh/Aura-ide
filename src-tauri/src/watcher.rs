//! Автообновление дерева файлов через file-system watcher.
//!
//! Одна подписка на корень: любой mutating-event внутри → шлём в вебвью
//! событие `fs://changed`. Дебаунсинг (300 мс) сглаживает шторм от
//! `npm install` / `git checkout` — фронт делает один refresh на пачку.

use crate::AuraError;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, State};

pub struct WatcherState {
    // watcher хранится живым; ключ = корневой путь.
    inner: Mutex<HashMap<String, Debouncer<notify::RecommendedWatcher>>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct ChangeEvent {
    root: String,
    paths: Vec<String>,
}

#[tauri::command]
pub fn fs_watch_start(
    app: AppHandle,
    state: State<'_, WatcherState>,
    root: String,
) -> Result<(), AuraError> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?;
    if guard.contains_key(&root) {
        return Ok(());
    }
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err(AuraError::Msg("нет такой директории".into()));
    }
    let app_l = app.clone();
    let root_l = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let paths: Vec<String> = events
                    .into_iter()
                    .map(|e| e.path.to_string_lossy().to_string())
                    .filter(|p| {
                        // Не спамим на служебные каталоги — они меняются постоянно.
                        !p.contains("/node_modules/")
                            && !p.contains("/.git/")
                            && !p.contains("/target/")
                            && !p.contains("/.next/")
                    })
                    .collect();
                if paths.is_empty() {
                    return;
                }
                let _ = app_l.emit(
                    "fs://changed",
                    ChangeEvent {
                        root: root_l.clone(),
                        paths,
                    },
                );
            }
        },
    )
    .map_err(|e| AuraError::Msg(format!("watcher: {e}")))?;
    debouncer
        .watcher()
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| AuraError::Msg(format!("watch: {e}")))?;
    guard.insert(root, debouncer);
    Ok(())
}

#[tauri::command]
pub fn fs_watch_stop(state: State<'_, WatcherState>, root: String) -> Result<(), AuraError> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?;
    guard.remove(&root);
    Ok(())
}
