use aura_core::error::CoreError;
use aura_core::search::{search as core_search, SearchMatch, SearchOptions};
use std::path::PathBuf;

/// Полнотекстовый поиск. Обёртка над `aura_core::search`.
#[tauri::command]
#[specta::specta]
pub fn search_in_project(
    root: String,
    query: String,
    options: Option<SearchOptions>,
) -> Result<Vec<SearchMatch>, CoreError> {
    let opts = options.unwrap_or_default();
    core_search(&PathBuf::from(root), &query, &opts)
}
