//! Управление окном для кастомного titlebar (frameless).

use aura_core::error::CoreError;
use tauri::Manager;

fn map<E: std::fmt::Display>(e: E) -> CoreError {
    CoreError::Other(e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_minimize(app: tauri::AppHandle) -> Result<(), CoreError> {
    if let Some(w) = app.get_webview_window("main") {
        w.minimize().map_err(map)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn window_toggle_maximize(app: tauri::AppHandle) -> Result<(), CoreError> {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_maximized().map_err(map)? {
            w.unmaximize().map_err(map)?;
        } else {
            w.maximize().map_err(map)?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn window_close(app: tauri::AppHandle) -> Result<(), CoreError> {
    if let Some(w) = app.get_webview_window("main") {
        w.close().map_err(map)?;
    }
    Ok(())
}
