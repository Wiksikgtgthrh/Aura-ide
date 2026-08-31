//! Git-команды. Токен для сетевых операций берётся из [`AppState::git_token`],
//! куда его кладёт фронт при логине через OAuth-flow (реализация flow — вне
//! этого модуля, тут только потребление).

use aura_core::error::{CoreError, CoreResult};
use aura_core::git::{self as core_git, AuthProvider, BranchInfo, GitStatus};
use std::path::PathBuf;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn git_status(root: String) -> Result<GitStatus, CoreError> {
    core_git::status(&PathBuf::from(root))
}

#[tauri::command]
#[specta::specta]
pub fn git_branches(root: String) -> Result<Vec<BranchInfo>, CoreError> {
    core_git::branches(&PathBuf::from(root))
}

#[tauri::command]
#[specta::specta]
pub fn git_checkout(root: String, branch: String) -> Result<(), CoreError> {
    core_git::checkout(&PathBuf::from(root), &branch)
}

#[tauri::command]
#[specta::specta]
pub fn git_stage(root: String, paths: Vec<String>) -> Result<(), CoreError> {
    core_git::stage(&PathBuf::from(root), &paths)
}

#[tauri::command]
#[specta::specta]
pub fn git_unstage(root: String, paths: Vec<String>) -> Result<(), CoreError> {
    core_git::unstage(&PathBuf::from(root), &paths)
}

#[tauri::command]
#[specta::specta]
pub fn git_commit(
    root: String,
    message: String,
    name: String,
    email: String,
) -> Result<String, CoreError> {
    core_git::commit(&PathBuf::from(root), &message, &name, &email)
}

#[tauri::command]
#[specta::specta]
pub fn git_diff_file(root: String, rel: String, staged: bool) -> Result<String, CoreError> {
    core_git::diff_file(&PathBuf::from(root), &rel, staged)
}

fn resolve_auth(state: &State<'_, AppState>) -> CoreResult<AuthProvider> {
    let token = state
        .git_token
        .lock()
        .map_err(|e| CoreError::Other(e.to_string()))?
        .clone();
    Ok(AuthProvider {
        token,
        ssh_key: None,
    })
}

#[tauri::command]
#[specta::specta]
pub fn git_pull(state: State<'_, AppState>, root: String) -> Result<(), CoreError> {
    let auth = resolve_auth(&state)?;
    core_git::pull_ff(&PathBuf::from(root), &auth)
}

#[tauri::command]
#[specta::specta]
pub fn git_push(
    state: State<'_, AppState>,
    root: String,
    remote: String,
    branch: String,
) -> Result<(), CoreError> {
    let auth = resolve_auth(&state)?;
    core_git::push(&PathBuf::from(root), &remote, &branch, &auth)
}
