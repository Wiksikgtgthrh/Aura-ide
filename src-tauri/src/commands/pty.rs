use aura_core::error::CoreError;
use portable_pty::PtySize;
use std::io::Write;
use tauri::State;

use crate::pty::spawn;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn pty_create(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: String,
    shell: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), CoreError> {
    let session = spawn(app, id.clone(), cwd, shell, cols, rows)?;
    let mut map = state
        .ptys
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    map.insert(id, session);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), CoreError> {
    let map = state
        .ptys
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    let Some(session) = map.get(&id) else {
        return Err(CoreError::NotFound(format!("pty {id}")));
    };
    let mut w = session
        .writer
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    w.write_all(data.as_bytes())
        .map_err(|e| CoreError::Io(e.to_string()))?;
    w.flush().map_err(|e| CoreError::Io(e.to_string()))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), CoreError> {
    let map = state
        .ptys
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    let Some(session) = map.get(&id) else {
        return Err(CoreError::NotFound(format!("pty {id}")));
    };
    let master = session
        .master
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| CoreError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_kill(state: State<'_, AppState>, id: String) -> Result<(), CoreError> {
    let mut map = state
        .ptys
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    let Some(session) = map.remove(&id) else {
        return Err(CoreError::NotFound(format!("pty {id}")));
    };
    let mut child = session
        .child
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?;
    let _ = child.kill();
    Ok(())
}
