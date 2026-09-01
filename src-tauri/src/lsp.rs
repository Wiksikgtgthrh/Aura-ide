//! Language Server Protocol (LSP) — тонкий прокси между Monaco во вебвью
//! и настоящим language server'ом (по умолчанию `typescript-language-server
//! --stdio`) как дочерним процессом Rust.
//!
//! Транспорт LSP — Content-Length-framed JSON-RPC поверх stdio. Мы:
//!   1) спавним процесс, читаем stdout в поток, парсим кадры,
//!   2) кажый JSON-RPC message шлём во фронт событием `lsp://{id}` — JS-клиент
//!      разбирает его и обновляет Monaco модели/диагностику,
//!   3) команда `lsp_send` принимает JSON-RPC message от фронта, оборачивает
//!      его в Content-Length и пишет в stdin.
//!
//! Разные проекты/языки → разные server-id. `typescript`/`typescript-python`
//! запускаются по имени, кастомный path берётся из параметра. Установка
//! `typescript-language-server` — на пользователе (`npm i -g …`); если не
//! найден — spawn падает, фронт получает ошибку и отключает LSP.

use crate::AuraError;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub struct LspSession {
    child: Child,
    stdin: ChildStdin,
}

pub struct LspState {
    sessions: Mutex<HashMap<String, Arc<Mutex<LspSession>>>>,
}

impl Default for LspState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Serialize)]
struct LspOutbound {
    id: String,
    /// Уже распарсенный JSON от сервера. Отправляем как строку, чтобы
    /// избежать двойной сериализации на фронте.
    message: String,
    exited: bool,
    exit_code: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartArgs {
    /// Идентификатор сессии (обычно `ts:<root>`).
    pub id: String,
    /// Директория проекта — становится cwd для сервера.
    pub cwd: String,
    /// Явная команда: например `typescript-language-server` или полный путь.
    /// По умолчанию — `typescript-language-server`.
    #[serde(default)]
    pub command: Option<String>,
    /// Аргументы (без `--stdio` — мы добавим его сами, если пусто).
    #[serde(default)]
    pub args: Option<Vec<String>>,
}

fn default_ts_command() -> (String, Vec<String>) {
    // `typescript-language-server --stdio` — де-факто стандарт для TS/JS
    // в Monaco/VS Code. Пользователь ставит его глобально npm-ом.
    ("typescript-language-server".into(), vec!["--stdio".into()])
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, LspState>,
    args: LspStartArgs,
) -> Result<(), AuraError> {
    // Уже запущен — тихий no-op (Monaco инициализируется несколько раз при HMR).
    {
        let guard = state
            .sessions
            .lock()
            .map_err(|_| AuraError::Msg("lock".into()))?;
        if guard.contains_key(&args.id) {
            return Ok(());
        }
    }

    let (cmd, cmd_args) = match (args.command.clone(), args.args.clone()) {
        (Some(c), Some(a)) if !c.is_empty() => (c, a),
        (Some(c), None) if !c.is_empty() => (c, vec!["--stdio".into()]),
        _ => default_ts_command(),
    };

    let mut command = Command::new(&cmd);
    command
        .args(&cmd_args)
        .current_dir(&args.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let mut child = command
        .spawn()
        .map_err(|e| AuraError::Msg(format!("не удалось запустить {cmd}: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AuraError::Msg("нет stdout у LSP".into()))?;
    let stderr = child.stderr.take();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AuraError::Msg("нет stdin у LSP".into()))?;

    let session = Arc::new(Mutex::new(LspSession { child, stdin }));
    state
        .sessions
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?
        .insert(args.id.clone(), session.clone());

    // stdout: парсим Content-Length кадры и шлём каждое сообщение во фронт.
    let app_l = app.clone();
    let id_l = args.id.clone();
    std::thread::spawn(move || {
        read_frames(stdout, |msg| {
            let _ = app_l.emit(
                &format!("lsp://{id_l}"),
                LspOutbound {
                    id: id_l.clone(),
                    message: msg,
                    exited: false,
                    exit_code: None,
                },
            );
        });
    });

    // stderr — вылавливаем ошибки установки/зависимостей, отправляем как spec-notification.
    if let Some(mut stderr) = stderr {
        let app_l = app.clone();
        let id_l = args.id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut accum = String::new();
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        accum.push_str(&String::from_utf8_lossy(&buf[..n]));
                        if accum.len() > 2000 {
                            let _ = app_l.emit(
                                &format!("lsp://{id_l}"),
                                LspOutbound {
                                    id: id_l.clone(),
                                    message: format!(
                                        r#"{{"jsonrpc":"2.0","method":"$aura/stderr","params":{}}}"#,
                                        serde_json::to_string(&accum).unwrap_or_default()
                                    ),
                                    exited: false,
                                    exit_code: None,
                                },
                            );
                            accum.clear();
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Ждём завершения процесса — шлём `exited` во фронт.
    let session_l = session.clone();
    let app_l = app.clone();
    let id_l = args.id.clone();
    std::thread::spawn(move || {
        let code = if let Ok(mut s) = session_l.lock() {
            match s.child.wait() {
                Ok(status) => status.code(),
                Err(_) => None,
            }
        } else {
            None
        };
        let _ = app_l.emit(
            &format!("lsp://{id_l}"),
            LspOutbound {
                id: id_l.clone(),
                message: String::new(),
                exited: true,
                exit_code: code,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn lsp_send(
    state: State<'_, LspState>,
    id: String,
    message: String,
) -> Result<(), AuraError> {
    let sess = {
        let guard = state
            .sessions
            .lock()
            .map_err(|_| AuraError::Msg("lock".into()))?;
        guard.get(&id).cloned()
    };
    let Some(sess) = sess else {
        return Err(AuraError::Msg("нет сессии LSP".into()));
    };
    let mut s = sess.lock().map_err(|_| AuraError::Msg("lock".into()))?;
    let bytes = message.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
    s.stdin
        .write_all(header.as_bytes())
        .map_err(|e| AuraError::Msg(format!("write header: {e}")))?;
    s.stdin
        .write_all(bytes)
        .map_err(|e| AuraError::Msg(format!("write body: {e}")))?;
    s.stdin.flush().ok();
    Ok(())
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, LspState>, id: String) -> Result<(), AuraError> {
    let sess = {
        let mut guard = state
            .sessions
            .lock()
            .map_err(|_| AuraError::Msg("lock".into()))?;
        guard.remove(&id)
    };
    if let Some(sess) = sess {
        if let Ok(mut s) = sess.lock() {
            let _ = s.child.kill();
        }
    }
    Ok(())
}

// --- Парсер Content-Length frames ------------------------------------------

fn read_frames<R: Read, F: FnMut(String)>(mut reader: R, mut on_message: F) {
    let mut buf: Vec<u8> = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => break,
        }
        loop {
            // Ищем "\r\n\r\n" — конец заголовков.
            let Some(sep) = find_header_end(&buf) else {
                break;
            };
            let headers = &buf[..sep];
            let Some(content_len) = parse_content_length(headers) else {
                // Битый кадр — просто пропускаем разделитель, чтобы двигаться дальше.
                buf.drain(..sep + 4);
                continue;
            };
            let total = sep + 4 + content_len;
            if buf.len() < total {
                break; // ждём остаток
            }
            let body = &buf[sep + 4..total];
            if let Ok(s) = std::str::from_utf8(body) {
                on_message(s.to_string());
            }
            buf.drain(..total);
        }
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    // Ищем позицию перед \r\n\r\n.
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_content_length(headers: &[u8]) -> Option<usize> {
    let text = std::str::from_utf8(headers).ok()?;
    for line in text.split("\r\n") {
        let mut parts = line.splitn(2, ':');
        let key = parts.next()?.trim();
        let value = parts.next()?.trim();
        if key.eq_ignore_ascii_case("Content-Length") {
            return value.parse::<usize>().ok();
        }
    }
    None
}
