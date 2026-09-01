//! Git — расширенные операции для панели в IDE.
//!
//! Всё через системный `git`: он есть у каждого разработчика, а сторонние
//! Rust-клиенты вроде git2/gix тянут libgit2/libssl и сильно раздувают
//! бинарник. Одна команда — один процесс, вывод парсится по строкам.

use crate::AuraError;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn git(cwd: &str) -> Command {
    let mut c = Command::new("git");
    c.arg("-C").arg(cwd);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

fn run(mut cmd: Command) -> Result<String, AuraError> {
    let out = cmd.output()?;
    if !out.status.success() {
        return Err(AuraError::Msg(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn run_allow_fail(mut cmd: Command) -> Result<String, AuraError> {
    let out = cmd.output()?;
    // Некоторые git-команды (diff при отсутствии изменений) возвращают 1 — это не ошибка.
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

// --- ветка / статус ---------------------------------------------------------

#[derive(Serialize)]
pub struct GitBranchInfo {
    pub current: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub upstream: Option<String>,
}

#[tauri::command]
pub fn git_branch(cwd: String) -> Result<GitBranchInfo, AuraError> {
    let mut c = git(&cwd);
    c.args(["rev-parse", "--abbrev-ref", "HEAD"]);
    let current = run(c).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    let mut c = git(&cwd);
    c.args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    let upstream = run(c).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    let (ahead, behind) = if upstream.is_some() {
        let mut c = git(&cwd);
        c.args(["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
        match run(c) {
            Ok(s) => {
                let mut parts = s.split_whitespace();
                let a = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                let b = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
                (a, b)
            }
            Err(_) => (0, 0),
        }
    } else {
        (0, 0)
    };
    Ok(GitBranchInfo {
        current,
        ahead,
        behind,
        upstream,
    })
}

#[derive(Serialize)]
pub struct GitBranchListItem {
    pub name: String,
    pub current: bool,
    pub remote: bool,
}

#[tauri::command]
pub fn git_branch_list(cwd: String) -> Result<Vec<GitBranchListItem>, AuraError> {
    let mut c = git(&cwd);
    c.args([
        "branch",
        "-a",
        "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)",
    ]);
    let out = run(c)?;
    let mut items = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\u{0}').collect();
        if parts.len() < 2 {
            continue;
        }
        let head = parts[0].trim();
        let name = parts[1].trim().to_string();
        if name.is_empty() || name.contains("HEAD ->") {
            continue;
        }
        let remote = name.starts_with("remotes/") || name.contains('/');
        items.push(GitBranchListItem {
            name,
            current: head == "*",
            remote,
        });
    }
    Ok(items)
}

#[tauri::command]
pub fn git_checkout(cwd: String, branch: String) -> Result<(), AuraError> {
    let mut c = git(&cwd);
    c.args(["checkout", &branch]);
    run(c)?;
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(cwd: String, name: String, checkout: bool) -> Result<(), AuraError> {
    let mut c = git(&cwd);
    if checkout {
        c.args(["checkout", "-b", &name]);
    } else {
        c.args(["branch", &name]);
    }
    run(c)?;
    Ok(())
}

// --- staging / commit -------------------------------------------------------

#[tauri::command]
pub fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), AuraError> {
    let mut c = git(&cwd);
    c.arg("add").arg("--");
    for p in &paths {
        c.arg(p);
    }
    run(c)?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), AuraError> {
    let mut c = git(&cwd);
    c.args(["reset", "HEAD", "--"]);
    for p in &paths {
        c.arg(p);
    }
    run(c)?;
    Ok(())
}

#[tauri::command]
pub fn git_stage_all(cwd: String) -> Result<(), AuraError> {
    let mut c = git(&cwd);
    c.args(["add", "-A"]);
    run(c)?;
    Ok(())
}

#[tauri::command]
pub fn git_discard(cwd: String, paths: Vec<String>) -> Result<(), AuraError> {
    // Работает и для tracked (checkout), и для untracked (clean) — двумя проходами.
    let mut c = git(&cwd);
    c.args(["checkout", "--"]);
    for p in &paths {
        c.arg(p);
    }
    let _ = run_allow_fail(c);
    let mut c = git(&cwd);
    c.args(["clean", "-f", "--"]);
    for p in &paths {
        c.arg(p);
    }
    let _ = run_allow_fail(c);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInput {
    pub cwd: String,
    pub message: String,
    #[serde(default)]
    pub amend: bool,
    #[serde(default)]
    pub sign_off: bool,
}

#[tauri::command]
pub fn git_commit(input: CommitInput) -> Result<String, AuraError> {
    if input.message.trim().is_empty() && !input.amend {
        return Err(AuraError::Msg("нужно сообщение коммита".into()));
    }
    let mut c = git(&input.cwd);
    c.arg("commit");
    if input.amend {
        c.arg("--amend");
    }
    if input.sign_off {
        c.arg("-s");
    }
    c.arg("-m").arg(&input.message);
    Ok(run(c)?.trim().to_string())
}

// --- push / pull / fetch ----------------------------------------------------

#[tauri::command]
pub fn git_push(cwd: String, set_upstream: bool) -> Result<String, AuraError> {
    let mut c = git(&cwd);
    c.arg("push");
    if set_upstream {
        // При первом push для новой ветки git сам подскажет upstream,
        // здесь просто добавляем -u.
        c.arg("-u");
        // origin + текущая ветка.
        let mut b = git(&cwd);
        b.args(["rev-parse", "--abbrev-ref", "HEAD"]);
        let branch = run(b)?.trim().to_string();
        c.args(["origin", &branch]);
    }
    Ok(run(c)?.trim().to_string())
}

#[tauri::command]
pub fn git_pull(cwd: String) -> Result<String, AuraError> {
    let mut c = git(&cwd);
    c.args(["pull", "--ff-only"]);
    Ok(run(c)?.trim().to_string())
}

#[tauri::command]
pub fn git_fetch(cwd: String) -> Result<String, AuraError> {
    let mut c = git(&cwd);
    c.args(["fetch", "--all", "--prune"]);
    Ok(run(c)?.trim().to_string())
}

// --- diff / log -------------------------------------------------------------

/// Diff одного файла: staged=true → индекс vs HEAD, иначе рабочая копия vs индекс.
#[tauri::command]
pub fn git_diff(cwd: String, path: String, staged: bool) -> Result<String, AuraError> {
    let mut c = git(&cwd);
    c.arg("diff");
    if staged {
        c.arg("--cached");
    }
    c.arg("--no-color").arg("--").arg(&path);
    // git diff при отсутствии разницы даёт код 0/пусто; при бинарном — заголовок.
    run_allow_fail(c)
}

#[derive(Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

#[tauri::command]
pub fn git_log(cwd: String, limit: Option<u32>) -> Result<Vec<GitLogEntry>, AuraError> {
    let n = limit.unwrap_or(50).min(500);
    let mut c = git(&cwd);
    c.args([
        "log",
        &format!("-n{n}"),
        "--pretty=format:%H%x00%h%x00%an%x00%ad%x00%s",
        "--date=iso",
    ]);
    let out = run_allow_fail(c)?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split('\u{0}').collect();
            if p.len() < 5 {
                return None;
            }
            Some(GitLogEntry {
                hash: p[0].into(),
                short: p[1].into(),
                author: p[2].into(),
                date: p[3].into(),
                subject: p[4].into(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn git_init(cwd: String) -> Result<(), AuraError> {
    let mut c = git(&cwd);
    c.arg("init");
    run(c)?;
    Ok(())
}
