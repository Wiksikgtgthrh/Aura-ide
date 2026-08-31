//! Обёртка над `notify::RecommendedWatcher`.
//!
//! На каждый watch запускается поток, который читает канал событий и эмитит
//! их в главное окно как `fs://event`. Дропнутый `WatchHandle` останавливает
//! watcher (RecommendedWatcher закрывается автоматически).

use aura_core::error::{CoreError, CoreResult};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use specta::Type;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use tauri::Emitter;

pub struct WatchHandle {
    /// Держим watcher-инстанс живым, пока хэндл в HashMap. Дроп остановит его.
    _watcher: RecommendedWatcher,
    /// Флаг остановки треда-ретранслятора (mpsc-канал закроется автоматом
    /// при дропе `_watcher`).
    _thread: thread::JoinHandle<()>,
}

#[derive(Debug, Serialize, Clone, Type)]
pub struct FsEventPayload {
    pub watch_id: String,
    pub kind: String,
    pub paths: Vec<String>,
}

pub fn spawn_watcher(
    app: tauri::AppHandle,
    watch_id: String,
    root: PathBuf,
) -> CoreResult<WatchHandle> {
    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        // Errors тихо игнорим — watcher переживёт временную ошибку ФС.
        let _ = tx.send(res);
    })
    .map_err(|e| CoreError::Io(e.to_string()))?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| CoreError::Io(e.to_string()))?;

    let app_for_thread = app.clone();
    let watch_id_for_thread = watch_id.clone();
    let handle = thread::spawn(move || {
        for res in rx {
            let Ok(ev) = res else { continue };
            let kind = kind_name(&ev.kind);
            let paths: Vec<String> = ev
                .paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            let payload = FsEventPayload {
                watch_id: watch_id_for_thread.clone(),
                kind,
                paths,
            };
            let _ = app_for_thread.emit("fs://event", payload);
        }
    });

    Ok(WatchHandle {
        _watcher: watcher,
        _thread: handle,
    })
}

fn kind_name(k: &EventKind) -> String {
    match k {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        EventKind::Access(_) => "access",
        EventKind::Any => "any",
        EventKind::Other => "other",
    }
    .to_string()
}
