//! Aura IDE — нативное desktop-ядро (Tauri).
//!
//! Что делает нативно (без Docker и без отдельного Node-бэкенда для этих задач):
//!  - терминал: реальные шелл-процессы в директории проекта, стрим вывода в
//!    вебвью через события, прерывание (Ctrl+C) через kill процесса/группы;
//!  - файловая система: дерево проекта, чтение/запись;
//!  - live-превью: запуск dev-сервера проекта (npm/pnpm) с авто-поиском
//!    свободного порта и стримом логов;
//!  - проверка API-ключей: пинг + проба стриминга с измерением скорости (TTFT),
//!    чтобы медленные и мёртвые ключи отключались автоматически;
//!  - автозапуск Next-сервера: при открытии приложения с иконки сервер
//!    поднимается сам, окно IDE открывается когда он готов.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::TcpStream,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, RunEvent, State};
use tokio::io::AsyncReadExt;
use tokio::process::Command as TokioCommand;

mod git;
mod pty;
mod search;
mod watcher;

// Windows-specific extension for CREATE_NO_WINDOW / creation_flags().
// Both std::process::Command and tokio::process::Command use this trait on Windows.
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ---------------------------------------------------------------------------
// Общие типы
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum AuraError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Msg(String),
}

type CmdResult<T> = Result<T, AuraError>;

impl Serialize for AuraError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

struct AppState {
    /// Активные терминальные команды: id → PID (kill по PID/группе).
    shells: Mutex<HashMap<String, u32>>,
    /// Активные dev-серверы превью: id → PID.
    previews: Mutex<HashMap<String, u32>>,
}

/// PID поднятого нами Next-сервера — убиваем при выходе из приложения.
static SERVER_PID: Mutex<Option<u32>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Убийство процессов (дерево/группа)
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn kill_process_tree(pid: u32) {
    unsafe {
        // Группа (терминал/превью стартуют в своей группе) + сам процесс.
        libc::killpg(pid as i32, libc::SIGKILL);
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn();
}

#[cfg(not(any(unix, windows)))]
fn kill_process_tree(_pid: u32) {}

// ---------------------------------------------------------------------------
// Терминал
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct TermChunk {
    id: String,
    data: String,
    done: bool,
    code: Option<i32>,
}

fn shell_command(line: &str, cwd: &Path) -> TokioCommand {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = TokioCommand::new("cmd");
        c.args(["/C", line]);
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = TokioCommand::new("sh");
        c.args(["-c", line]);
        c
    };
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    cmd.process_group(0); // своя группа процессов → killpg при Ctrl+C
    cmd
}

/// Запустить команду в директории проекта. Вывод стримится событием
/// `term://{id}` чанками; команда завершается, когда процесс завершён
/// (done-чанк с кодом выхода приходит перед возвратом).
#[tauri::command]
async fn term_run(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: String,
    command: String,
) -> CmdResult<()> {
    let cwd_path = PathBuf::from(&cwd);
    std::fs::create_dir_all(&cwd_path)?;
    let mut child = shell_command(&command, &cwd_path).spawn()?;
    let pid = child.id().unwrap_or(0);
    state
        .shells
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?
        .insert(id.clone(), pid);

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AuraError::Msg("нет stdout".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AuraError::Msg("нет stderr".into()))?;

    let emit_chunk = |app: &AppHandle, id: &str, data: String, done: bool, code: Option<i32>| {
        let _ = app.emit(
            &format!("term://{id}"),
            TermChunk {
                id: id.to_string(),
                data,
                done,
                code,
            },
        );
    };

    {
        let app = app.clone();
        let id = id.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 8192];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => emit_chunk(&app, &id, String::from_utf8_lossy(&buf[..n]).to_string(), false, None),
                    Err(_) => break,
                }
            }
        });
    }
    {
        let app = app.clone();
        let id = id.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 8192];
            loop {
                match stderr.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => emit_chunk(&app, &id, String::from_utf8_lossy(&buf[..n]).to_string(), false, None),
                    Err(_) => break,
                }
            }
        });
    }

    let code = child.wait().await.ok().and_then(|s| s.code());
    state
        .shells
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?
        .remove(&id);
    emit_chunk(&app, &id, String::new(), true, code);
    Ok(())
}

/// Прервать работающую команду (аналог Ctrl+C): убивает группу процессов.
#[tauri::command]
fn term_kill(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let pid = state
        .shells
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?
        .remove(&id);
    if let Some(pid) = pid {
        kill_process_tree(pid);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Файловая система проекта
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct FsNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FsNode>,
}

const SKIP_DIRS: &[&str] = &["node_modules", ".git", "dist", ".next", "target", ".aura"];
const MAX_FILE_BYTES: u64 = 1_000_000; // бинарники/гигантские файлы в дерево не тащим

fn read_tree(dir: &Path, depth: u32) -> Vec<FsNode> {
    if depth > 6 {
        return Vec::new();
    }
    let mut nodes: Vec<FsNode> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                !(e.path().is_dir() && SKIP_DIRS.contains(&name.as_str()))
            })
            .map(|e| {
                let p = e.path();
                let is_dir = p.is_dir();
                FsNode {
                    name: e.file_name().to_string_lossy().to_string(),
                    path: p.to_string_lossy().to_string(),
                    is_dir,
                    children: if is_dir { read_tree(&p, depth + 1) } else { Vec::new() },
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    nodes.sort_by(|a, b| match (b.is_dir, a.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    nodes
}

#[tauri::command]
fn fs_tree(root: String) -> CmdResult<Vec<FsNode>> {
    Ok(read_tree(Path::new(&root), 0))
}

#[tauri::command]
fn fs_read(path: String) -> CmdResult<String> {
    let meta = std::fs::metadata(&path)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(AuraError::Msg("файл слишком большой для редактора".into()));
    }
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
fn fs_write(path: String, content: String) -> CmdResult<()> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

#[tauri::command]
fn fs_create_file(path: String) -> CmdResult<()> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    if !Path::new(&path).exists() {
        std::fs::write(&path, "")?;
    }
    Ok(())
}

#[tauri::command]
fn fs_create_dir(path: String) -> CmdResult<()> {
    std::fs::create_dir_all(path)?;
    Ok(())
}

#[tauri::command]
fn fs_delete(path: String) -> CmdResult<()> {
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p)?;
    } else if p.exists() {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

#[tauri::command]
fn fs_rename(from: String, to: String) -> CmdResult<()> {
    if let Some(parent) = Path::new(&to).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct GitStatusEntry {
    status: String,
    path: String,
}

/// `git status --porcelain` для бейджей в проводнике. Папка не является
/// git-репозиторием (или git не установлен) → пустой список, это не ошибка.
#[tauri::command]
fn git_status(cwd: String) -> CmdResult<Vec<GitStatusEntry>> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(["-C", &cwd, "status", "--porcelain=v1"]);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return Ok(Vec::new()),
    };
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let status = line[..2].trim().to_string();
            let path = line[3..].trim().trim_matches('"').to_string();
            if path.is_empty() {
                return None;
            }
            Some(GitStatusEntry { status, path })
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Live-превью (dev-сервер проекта)
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct PreviewEvent {
    id: String,
    url: Option<String>,
    log: Option<String>,
    exited: bool,
}

/// Запустить dev-сервер проекта на свободном порту. URL приходит событием
/// `preview://{id}`, логи — тем же событием, завершение — exited=true.
#[tauri::command]
async fn preview_start(app: AppHandle, state: State<'_, AppState>, id: String, cwd: String) -> CmdResult<u16> {
    let port = portpicker::pick_unused_port().unwrap_or(5173);
    let cwd_path = PathBuf::from(&cwd);
    let runner = if cwd_path.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else {
        "npm"
    };
    let args = [
        "run".to_string(),
        "dev".to_string(),
        "--".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
    ];

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = TokioCommand::new("cmd");
        c.arg("/C").arg(runner).args(&args);
        c.creation_flags(0x0800_0000);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = TokioCommand::new(runner);
        c.args(&args);
        c
    };
    cmd.current_dir(&cwd_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn()?;
    let pid = child.id().unwrap_or(0);
    state
        .previews
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?
        .insert(id.clone(), pid);

    let url = format!("http://127.0.0.1:{port}");
    let _ = app.emit(
        &format!("preview://{id}"),
        PreviewEvent {
            id: id.clone(),
            url: Some(url),
            log: None,
            exited: false,
        },
    );

    if let Some(mut stdout) = child.stdout.take() {
        let app_l = app.clone();
        let id_l = id.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 8192];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = app_l.emit(
                            &format!("preview://{id_l}"),
                            PreviewEvent {
                                id: id_l.clone(),
                                url: None,
                                log: Some(String::from_utf8_lossy(&buf[..n]).to_string()),
                                exited: false,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Фон: когда dev-сервер завершится — убрать PID и сообщить вебвью.
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(port)
}

#[tauri::command]
fn preview_stop(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let pid = state
        .previews
        .lock()
        .map_err(|_| AuraError::Msg("lock".into()))?
        .remove(&id);
    if let Some(pid) = pid {
        kill_process_tree(pid);
        let _ = app.emit(
            &format!("preview://{id}"),
            PreviewEvent {
                id,
                url: None,
                log: None,
                exited: true,
            },
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Проверка API-ключей: пинг + скорость (TTFT) + стриминг
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyProbeInput {
    pub key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyProbeResult {
    /// 'active' | 'slow' | 'error' | 'timeout'
    pub status: String,
    pub ping_ms: Option<u64>,
    /// Время до первого токена стрима — главная метрика «скорости» модели.
    pub ttft_ms: Option<u64>,
    pub fail_reason: Option<String>,
}

const PING_TIMEOUT_MS: u64 = 4000;
const STREAM_TIMEOUT_MS: u64 = 8000;
/// Выше этого TTFT ключ считается «медленным» и отключается.
const SLOW_TTFT_MS: u64 = 5000;

fn http_client(timeout_ms: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .unwrap_or_default()
}

/// Нативная проба одного OpenAI-совместимого ключа.
/// Мёртвый (error/timeout) или медленный (TTFT > SLOW_TTFT_MS) → не 'active'.
#[tauri::command]
async fn api_key_probe(input: KeyProbeInput) -> CmdResult<KeyProbeResult> {
    let base = input
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1")
        .trim_end_matches('/');
    let model = input.model_id.as_deref().unwrap_or("gpt-4o-mini");
    let client = http_client(PING_TIMEOUT_MS);

    // 1. Пинг однотокеновым completion.
    let start = Instant::now();
    let res = client
        .post(format!("{base}/chat/completions"))
        .bearer_auth(&input.key)
        .json(&serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "." }],
            "max_tokens": 1
        }))
        .send()
        .await;
    let ping_ms = start.elapsed().as_millis() as u64;

    let resp = match res {
        Ok(r) => r,
        Err(e) => {
            let timeout = e.is_timeout();
            return Ok(KeyProbeResult {
                status: if timeout { "timeout".into() } else { "error".into() },
                ping_ms: None,
                ttft_ms: None,
                fail_reason: Some(e.to_string().chars().take(160).collect()),
            });
        }
    };
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Ok(KeyProbeResult {
            status: "error".into(),
            ping_ms: Some(ping_ms),
            ttft_ms: None,
            fail_reason: Some(format!("HTTP {code}: {}", body.chars().take(120).collect::<String>())),
        });
    }

    // 2. Проба стриминга с измерением времени до первого токена.
    let client = http_client(STREAM_TIMEOUT_MS);
    let start = Instant::now();
    let stream_res = client
        .post(format!("{base}/chat/completions"))
        .bearer_auth(&input.key)
        .json(&serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "." }],
            "max_tokens": 1,
            "stream": true
        }))
        .send()
        .await;

    let ttft_ms: Option<u64> = match stream_res {
        Ok(r) if r.status().is_success() => {
            use futures_util::StreamExt;
            let mut s = r.bytes_stream();
            let mut ttft = None;
            while let Some(chunk) = s.next().await {
                if let Ok(bytes) = chunk {
                    if !bytes.is_empty() {
                        ttft = Some(start.elapsed().as_millis() as u64);
                        break;
                    }
                }
            }
            ttft
        }
        _ => None,
    };

    let slow = ttft_ms.map(|t| t > SLOW_TTFT_MS).unwrap_or(true);
    let status = if slow { "slow" } else { "active" };
    let fail_reason = if ttft_ms.is_none() {
        Some("стриминг не отвечает — чат будет работать только в нестриминге".to_string())
    } else if slow {
        Some(format!("медленная модель: первый токен за {} мс", ttft_ms.unwrap_or(0)))
    } else {
        None
    };

    Ok(KeyProbeResult {
        status: status.into(),
        ping_ms: Some(ping_ms),
        ttft_ms,
        fail_reason,
    })
}

// ---------------------------------------------------------------------------
// Автозапуск Next-сервера (открытие IDE с иконки рабочего стола)
// ---------------------------------------------------------------------------

const SERVER_PORT: u16 = 3000;

fn server_ready() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{SERVER_PORT}").parse().unwrap(),
        Duration::from_millis(400),
    )
    .is_ok()
}

/// Поднять Next-сервер (`pnpm start`), если порт 3000 ещё не слушает.
/// Путь к проекту вшит при сборке: <repo>/src-tauri → родитель = корень.
fn ensure_next_server() {
    if server_ready() {
        return;
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    if !root.join("package.json").exists() {
        return; // сервер не сбандлен — README объясняет ручной запуск
    }
    let runner = if root.join("pnpm-lock.yaml").exists() { "pnpm" } else { "npm" };

    #[cfg(target_os = "windows")]
    let child = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", runner, "start"])
            .current_dir(&root)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
    };
    #[cfg(not(target_os = "windows"))]
    let child = std::process::Command::new(runner)
        .arg("start")
        .current_dir(&root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    if let Ok(c) = child {
        if let Ok(mut slot) = SERVER_PID.lock() {
            *slot = Some(c.id());
        }
    }
}

/// Ждать готовности сервера (холодный старт next start — единицы секунд).
fn wait_for_server(max_secs: u64) {
    for _ in 0..max_secs * 10 {
        if server_ready() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

// ---------------------------------------------------------------------------
// Инфраструктура
// ---------------------------------------------------------------------------

#[tauri::command]
fn local_ipv4() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.to_str().map(|s| s.to_string()))
        .and_then(|name| {
            std::net::ToSocketAddrs::to_socket_addrs(&(name.as_str(), 0))
                .ok()
                .and_then(|mut it| {
                    it.find_map(|a| match a.ip() {
                        std::net::IpAddr::V4(v4) if !v4.is_loopback() => Some(v4.to_string()),
                        _ => None,
                    })
                })
        })
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

pub fn run() {
    // Открытие с иконки рабочего стола: сервер поднимается сам, окно ждёт его.
    ensure_next_server();
    wait_for_server(45);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            shells: Mutex::new(HashMap::new()),
            previews: Mutex::new(HashMap::new()),
        })
        .manage(watcher::WatcherState::default())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            term_run,
            term_kill,
            fs_tree,
            fs_read,
            fs_write,
            fs_create_file,
            fs_create_dir,
            fs_delete,
            fs_rename,
            git_status,
            preview_start,
            preview_stop,
            api_key_probe,
            local_ipv4,
            // Поиск / замена по всему проекту
            search::fs_search,
            search::fs_replace_at,
            // File-system watcher
            watcher::fs_watch_start,
            watcher::fs_watch_stop,
            // Расширенный Git
            git::git_branch,
            git::git_branch_list,
            git::git_checkout,
            git::git_create_branch,
            git::git_stage,
            git::git_unstage,
            git::git_stage_all,
            git::git_discard,
            git::git_commit,
            git::git_push,
            git::git_pull,
            git::git_fetch,
            git::git_diff,
            git::git_log,
            git::git_init,
            git::git_show,
            git::git_diff_all,
            // Интерактивный терминал (PTY)
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .build(tauri::generate_context!())
        .expect("ошибка запуска Aura IDE");

    app.run(|_app, event| {
        // При выходе гасим поднятый нами Next-сервер, чтобы не оставался
        // сиротой в фоне после закрытия IDE.
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Ok(mut slot) = SERVER_PID.lock() {
                if let Some(pid) = slot.take() {
                    kill_process_tree(pid);
                }
            }
        }
    });
}
