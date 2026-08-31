//! Разделяемое состояние приложения между Tauri-командами.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aura_core::settings::SettingsStore;

use crate::pty::PtySession;
use crate::watcher::WatchHandle;

/// Глобальный state, привязывается через `.manage(...)` в `run()`.
pub struct AppState {
    pub settings: SettingsStore,
    /// Активные PTY-сессии.
    pub ptys: Arc<Mutex<HashMap<String, PtySession>>>,
    /// Активные fs-watch подписки.
    pub watchers: Arc<Mutex<HashMap<String, WatchHandle>>>,
    /// Токен для git операций (GitHub PAT/OAuth). В памяти + бэкап в
    /// keychain (tauri-plugin-store как fallback).
    pub git_token: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn new() -> Self {
        // В проде — ~/.aura; если создание не удалось (напр. read-only home)
        // фоллбэчимся во временную папку, чтобы IDE хотя бы запустилась.
        let settings = SettingsStore::default_location().unwrap_or_else(|_| {
            let tmp = std::env::temp_dir().join("aura-ide-fallback");
            SettingsStore::at(tmp).expect("cannot create fallback settings dir")
        });
        Self {
            settings,
            ptys: Arc::default(),
            watchers: Arc::default(),
            git_token: Arc::default(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
