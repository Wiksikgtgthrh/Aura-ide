use serde::Serialize;
use specta::Type;
use thiserror::Error;

/// Единый тип ошибки, который отдаётся во фронтенд.
///
/// Все варианты сериализуются в JSON и попадают в reject у Tauri invoke.
/// Держим сообщения человекочитаемыми — фронт может показывать их пользователю.
#[derive(Debug, Error, Serialize, Type)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum CoreError {
    #[error("io: {0}")]
    Io(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("git: {0}")]
    Git(String),

    #[error("settings: {0}")]
    Settings(String),

    #[error("search: {0}")]
    Search(String),

    #[error("serde: {0}")]
    Serde(String),

    #[error("other: {0}")]
    Other(String),
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind::*;
        match e.kind() {
            NotFound => CoreError::NotFound(e.to_string()),
            PermissionDenied => CoreError::PermissionDenied(e.to_string()),
            _ => CoreError::Io(e.to_string()),
        }
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Serde(e.to_string())
    }
}

impl From<git2::Error> for CoreError {
    fn from(e: git2::Error) -> Self {
        CoreError::Git(e.message().to_string())
    }
}

impl From<anyhow::Error> for CoreError {
    fn from(e: anyhow::Error) -> Self {
        CoreError::Other(e.to_string())
    }
}

pub type CoreResult<T> = Result<T, CoreError>;
