//! Настоящий интерактивный терминал через `portable-pty` + xterm.js во фронте.
//!
//! Отличие от `term_run`: там мы запускаем ОДНУ команду и стримим её вывод.
//! Здесь — реальный shell в псевдо-терминале: работает history-стрелка,
//! Ctrl+R, vim/ssh/tmux, приглашение, цвета, escape-последовательности.
//!
//! Протокол:
//!   • `pty_open(id, cwd, cols, rows)` — создать сессию, спавнить дефолтный
//!     shell пользователя, начать пампить stdout → `pty://{id}`.
//!   • `pty_write(id, data)` — вписать байты в stdin (ввод пользователя).
//!   • `pty_resize(id, cols, rows)` — при изменении размеров WebView.
//!   • `pty_close(id)` — SIGHUP shell'у и удалить сессию.

use crate::AuraError;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};

/// Одна PTY-сессия: держим master (для чтения+resize+close), writer (stdin),
/// плюс сам ребёнок, чтобы можно было отправить ему сигнал закрытия.
pub struct PtySession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtyState {
    pub sessions: Mutex<HashMap<String, Arc<Mutex<PtySession>>>>,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct PtyChunk {
    id: String,
    data: Vec<u8>,
    exited: bool,
    code: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOpen {
    pub id: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    #[serde(default)]
    pub shell: Option<String>,
}

fn default_shell(user_pref: Option<&str>) -> (String, Vec<String>) {
    if let Some(s) = user_pref.filter(|s| !s.is_empty()) {
        return (s.to_string(), vec![]);
    }
    #[cfg(target_os = "windows")]
    {
        // На Windows: сначала пробуем PowerShell, иначе cmd. Проверять
        // существование через PATH не обязательно — CommandBuilder упадёт
        // сам, а pwsh/powershell гарантированно есть на Win10/11.
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        if std::env::var("PSModulePath").is_ok() {
            return ("powershell.exe".to_string(), vec!["-NoLogo".to_string()]);
        }
        (comspec, vec![])
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        (shell, vec!["-l".to_string()])
    }
}

#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    state: State<'_, PtyState>,
    args: PtyOpen,
) -> Result<(), AuraError> {
    // Уже открыто — молча выходим (frontend может дважды дёрнуть).
    {
        let guard = state.sessions.lock().map_err(|_| AuraError::Msg("lock".into()))?;
        if guard.contains_key(&args.id) {
            return Ok(());
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: args.rows.max(4),
            cols: args.cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AuraError::Msg(format!("openpty: {e}")))?;

    let (shell, shell_args) = default_shell(args.shell.as_deref());
    let mut cmd = CommandBuilder::new(&shell);
    for a in &shell_args {
        cmd.arg(a);
    }
    cmd.cwd(&args.cwd);
    // Разумные ENV — цвета, локаль, чтобы CLI-программы выводили UTF-8.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AuraError::Msg(format!("spawn: {e}")))?;
    // slave больше не нужен в родителе — иначе pty не закроется, когда shell выйдет.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AuraError::Msg(format!("clone reader: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AuraError::Msg(format!("take writer: {e}")))?;

    let session = Arc::new(Mutex::new(PtySession {
        master: pair.master,
        writer,
        child,
    }));
    state
        .sessions
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?
        .insert(args.id.clone(), session.clone());

    // Отдельный поток читает master и шлёт байты во фронт.
    let app_l = app.clone();
    let id_l = args.id.clone();
    let session_l = session.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app_l.emit(
                        &format!("pty://{id_l}"),
                        PtyChunk {
                            id: id_l.clone(),
                            data: buf[..n].to_vec(),
                            exited: false,
                            code: None,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // Дождаться завершения, отправить exited.
        let code = if let Ok(mut s) = session_l.lock() {
            match s.child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(_) => -1,
            }
        } else {
            -1
        };
        let _ = app_l.emit(
            &format!("pty://{id_l}"),
            PtyChunk {
                id: id_l.clone(),
                data: vec![],
                exited: true,
                code: Some(code),
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(
    state: State<'_, PtyState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), AuraError> {
    let sess = {
        let guard = state.sessions.lock().map_err(|_| AuraError::Msg("lock".into()))?;
        guard.get(&id).cloned()
    };
    let Some(sess) = sess else {
        return Err(AuraError::Msg("pty закрыт".into()));
    };
    let mut s = sess.lock().map_err(|_| AuraError::Msg("lock".into()))?;
    s.writer
        .write_all(&data)
        .map_err(|e| AuraError::Msg(format!("write: {e}")))?;
    s.writer.flush().ok();
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AuraError> {
    let sess = {
        let guard = state.sessions.lock().map_err(|_| AuraError::Msg("lock".into()))?;
        guard.get(&id).cloned()
    };
    let Some(sess) = sess else {
        return Ok(());
    };
    let s = sess.lock().map_err(|_| AuraError::Msg("lock".into()))?;
    s.master
        .resize(PtySize {
            rows: rows.max(4),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AuraError::Msg(format!("resize: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, id: String) -> Result<(), AuraError> {
    let sess = {
        let mut guard = state.sessions.lock().map_err(|_| AuraError::Msg("lock".into()))?;
        guard.remove(&id)
    };
    if let Some(sess) = sess {
        if let Ok(mut s) = sess.lock() {
            let _ = s.child.kill();
        }
    }
    Ok(())
}
