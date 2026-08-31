//! Git-операции через libgit2. Все команды принимают путь к репозиторию.
//!
//! Сеть (fetch/pull/push) требует аутентификации — принимаем PAT или
//! GitHub OAuth-токен, положенный в keychain (за это отвечает `src-tauri`).

use git2::{
    build::CheckoutBuilder, BranchType, Cred, FetchOptions, IndexAddOption, PushOptions,
    RemoteCallbacks, Repository, Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::Path;

use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GitStatusEntry {
    pub path: String,
    /// Индекс: "new" | "modified" | "deleted" | "renamed" | "typechange" | "".
    pub index: String,
    /// Рабочее дерево: те же значения.
    pub worktree: String,
    /// В индексе (staged)?
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

pub fn open(repo_path: &Path) -> CoreResult<Repository> {
    Repository::discover(repo_path).map_err(Into::into)
}

pub fn status(repo_path: &Path) -> CoreResult<GitStatus> {
    let repo = open(repo_path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true);

    let statuses = repo.statuses(Some(&mut opts))?;

    let mut entries: Vec<GitStatusEntry> = Vec::with_capacity(statuses.len());
    for entry in statuses.iter() {
        let s = entry.status();
        let path = entry.path().unwrap_or("").to_string();
        let (index, staged) = classify_index(s);
        let worktree = classify_worktree(s);
        entries.push(GitStatusEntry {
            path,
            index,
            worktree,
            staged,
        });
    }

    let (branch, upstream, ahead, behind) = head_and_upstream(&repo)?;

    Ok(GitStatus {
        branch,
        upstream,
        ahead,
        behind,
        entries,
    })
}

fn classify_index(s: git2::Status) -> (String, bool) {
    use git2::Status as S;
    let mut kind = "";
    if s.contains(S::INDEX_NEW) {
        kind = "new";
    } else if s.contains(S::INDEX_MODIFIED) {
        kind = "modified";
    } else if s.contains(S::INDEX_DELETED) {
        kind = "deleted";
    } else if s.contains(S::INDEX_RENAMED) {
        kind = "renamed";
    } else if s.contains(S::INDEX_TYPECHANGE) {
        kind = "typechange";
    }
    let staged = !kind.is_empty();
    (kind.to_string(), staged)
}

fn classify_worktree(s: git2::Status) -> String {
    use git2::Status as S;
    if s.contains(S::WT_NEW) {
        "new".into()
    } else if s.contains(S::WT_MODIFIED) {
        "modified".into()
    } else if s.contains(S::WT_DELETED) {
        "deleted".into()
    } else if s.contains(S::WT_RENAMED) {
        "renamed".into()
    } else if s.contains(S::WT_TYPECHANGE) {
        "typechange".into()
    } else {
        "".into()
    }
}

fn head_and_upstream(
    repo: &Repository,
) -> CoreResult<(Option<String>, Option<String>, usize, usize)> {
    let head = match repo.head() {
        Ok(h) => h,
        // Пустой репозиторий — нет HEAD, это ок.
        Err(_) => return Ok((None, None, 0, 0)),
    };
    if !head.is_branch() {
        // Detached HEAD.
        return Ok((None, None, 0, 0));
    }
    let branch_name = head.shorthand().map(|s| s.to_string());
    let local_oid = head.target();

    let (upstream_name, ahead, behind) = if let Some(name) = branch_name.as_deref() {
        match repo.find_branch(name, BranchType::Local).and_then(|b| b.upstream()) {
            Ok(up) => {
                let up_name = up.name().ok().flatten().map(|s| s.to_string());
                let up_oid = up.get().target();
                let (a, b) = match (local_oid, up_oid) {
                    (Some(l), Some(u)) => repo.graph_ahead_behind(l, u).unwrap_or((0, 0)),
                    _ => (0, 0),
                };
                (up_name, a, b)
            }
            Err(_) => (None, 0, 0),
        }
    } else {
        (None, 0, 0)
    };

    Ok((branch_name, upstream_name, ahead, behind))
}

pub fn branches(repo_path: &Path) -> CoreResult<Vec<BranchInfo>> {
    let repo = open(repo_path)?;
    let mut out = Vec::new();
    let iter = repo.branches(None)?;
    for b in iter {
        let (branch, kind) = b?;
        let name = branch.name()?.unwrap_or("").to_string();
        let is_head = branch.is_head();
        let is_remote = matches!(kind, BranchType::Remote);
        let upstream = if !is_remote {
            branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()))
        } else {
            None
        };
        out.push(BranchInfo {
            name,
            is_head,
            is_remote,
            upstream,
        });
    }
    // Локальные ветки первыми, HEAD-ветка в самом начале.
    out.sort_by(|a, b| match (a.is_remote, b.is_remote) {
        (false, true) => std::cmp::Ordering::Less,
        (true, false) => std::cmp::Ordering::Greater,
        _ => match (a.is_head, b.is_head) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        },
    });
    Ok(out)
}

pub fn checkout(repo_path: &Path, branch: &str) -> CoreResult<()> {
    let repo = open(repo_path)?;
    let (obj, reference) = repo.revparse_ext(branch)?;
    repo.checkout_tree(&obj, Some(CheckoutBuilder::new().safe()))?;
    match reference {
        Some(r) => repo.set_head(r.name().ok_or_else(|| {
            CoreError::Git("reference has no name".into())
        })?)?,
        None => repo.set_head_detached(obj.id())?,
    }
    Ok(())
}

pub fn stage(repo_path: &Path, paths: &[String]) -> CoreResult<()> {
    let repo = open(repo_path)?;
    let mut index = repo.index()?;
    index.add_all(paths.iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

pub fn unstage(repo_path: &Path, paths: &[String]) -> CoreResult<()> {
    let repo = open(repo_path)?;
    // Если репозиторий пуст (нет HEAD) — просто удаляем из индекса.
    match repo.head().and_then(|h| h.peel_to_commit()) {
        Ok(head_commit) => {
            let refs: Vec<&std::path::Path> =
                paths.iter().map(|p| std::path::Path::new(p)).collect();
            repo.reset_default(Some(head_commit.as_object()), refs.iter().copied())?;
        }
        Err(_) => {
            let mut index = repo.index()?;
            for p in paths {
                let _ = index.remove_path(std::path::Path::new(p));
            }
            index.write()?;
        }
    }
    Ok(())
}

pub fn commit(repo_path: &Path, message: &str, name: &str, email: &str) -> CoreResult<String> {
    if message.trim().is_empty() {
        return Err(CoreError::Git("empty commit message".into()));
    }
    let repo = open(repo_path)?;
    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let sig = Signature::now(name, email)?;

    let parents: Vec<git2::Commit> = match repo.head() {
        Ok(h) => vec![h.peel_to_commit()?],
        Err(_) => vec![],
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?;
    Ok(oid.to_string())
}

pub fn diff_file(repo_path: &Path, rel: &str, staged: bool) -> CoreResult<String> {
    let repo = open(repo_path)?;
    let mut opts = git2::DiffOptions::new();
    opts.pathspec(rel).context_lines(3);

    let diff = if staged {
        // HEAD vs index.
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
    } else {
        // Index vs worktree.
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };

    let mut buf = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' | '-' | ' ' => Some(line.origin()),
            _ => None,
        };
        if let Some(p) = prefix {
            buf.push(p);
        }
        buf.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })?;
    Ok(buf)
}

/// Аутентификация remote-операций.
pub struct AuthProvider {
    /// GitHub-style токен: используется как username="x-access-token", password=token.
    pub token: Option<String>,
    /// SSH-путь до приватного ключа, если хотим ssh.
    pub ssh_key: Option<std::path::PathBuf>,
}

impl AuthProvider {
    fn build_callbacks(&self) -> RemoteCallbacks<'_> {
        let mut cb = RemoteCallbacks::new();
        let token = self.token.clone();
        let ssh_key = self.ssh_key.clone();
        cb.credentials(move |_url, username_from_url, allowed| {
            if allowed.contains(git2::CredentialType::SSH_KEY) {
                if let Some(key) = &ssh_key {
                    let user = username_from_url.unwrap_or("git");
                    return Cred::ssh_key(user, None, key, None);
                }
            }
            if let Some(t) = &token {
                return Cred::userpass_plaintext("x-access-token", t);
            }
            Cred::default()
        });
        cb
    }
}

pub fn fetch(repo_path: &Path, remote_name: &str, auth: &AuthProvider) -> CoreResult<()> {
    let repo = open(repo_path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(auth.build_callbacks());
    remote.fetch::<&str>(&[], Some(&mut fo), None)?;
    Ok(())
}

/// Простое fast-forward pull: fetch + fast-forward merge upstream в HEAD.
///
/// Non-FF слияние — вне scope Фазы 5 (нужен conflict UI).
pub fn pull_ff(repo_path: &Path, auth: &AuthProvider) -> CoreResult<()> {
    let repo = open(repo_path)?;
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(CoreError::Git("HEAD is not on a branch".into()));
    }
    let branch_name = head
        .shorthand()
        .ok_or_else(|| CoreError::Git("no branch name".into()))?
        .to_string();
    let mut branch = repo.find_branch(&branch_name, BranchType::Local)?;
    let upstream = branch.upstream()?;
    let upstream_ref_name = upstream
        .get()
        .name()
        .ok_or_else(|| CoreError::Git("upstream has no name".into()))?
        .to_string();
    let (_, upstream_short) = upstream_ref_name
        .rsplit_once('/')
        .unwrap_or(("", &upstream_ref_name));

    // fetch remote.
    let remote_name = upstream_short.split('/').next().unwrap_or("origin");
    fetch(repo_path, remote_name, auth)?;

    let fetch_commit = repo.reference_to_annotated_commit(upstream.get())?;
    let (analysis, _) = repo.merge_analysis(&[&fetch_commit])?;
    if analysis.is_up_to_date() {
        return Ok(());
    }
    if !analysis.is_fast_forward() {
        return Err(CoreError::Git(
            "non fast-forward pull is not supported yet".into(),
        ));
    }

    let ref_name = format!("refs/heads/{branch_name}");
    let mut reference = repo.find_reference(&ref_name)?;
    reference.set_target(fetch_commit.id(), "aura: fast-forward pull")?;
    repo.set_head(&ref_name)?;
    repo.checkout_head(Some(CheckoutBuilder::new().force()))?;
    // Убираем «неиспользуемая переменная» — `branch` нужен только для
    // получения upstream; после ref-обновления ветка автоматически на новом
    // OID.
    let _ = &mut branch;
    Ok(())
}

pub fn push(
    repo_path: &Path,
    remote_name: &str,
    branch: &str,
    auth: &AuthProvider,
) -> CoreResult<()> {
    let repo = open(repo_path)?;
    let mut remote = repo.find_remote(remote_name)?;
    let mut po = PushOptions::new();
    po.remote_callbacks(auth.build_callbacks());
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote.push(&[refspec.as_str()], Some(&mut po))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_repo(dir: &Path) -> Repository {
        let repo = Repository::init(dir).unwrap();
        // Стартовый коммит нужен для тестов, зависящих от HEAD.
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Aura Test").unwrap();
            cfg.set_str("user.email", "test@aura.dev").unwrap();
        }
        repo
    }

    #[test]
    fn empty_repo_reports_no_branch() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        let s = status(dir.path()).unwrap();
        assert!(s.branch.is_none());
        assert!(s.entries.is_empty());
    }

    #[test]
    fn detects_untracked_file() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let s = status(dir.path()).unwrap();
        assert_eq!(s.entries.len(), 1);
        assert_eq!(s.entries[0].path, "a.txt");
        assert_eq!(s.entries[0].worktree, "new");
        assert!(!s.entries[0].staged);
    }

    #[test]
    fn stage_and_commit_roundtrip() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        std::fs::write(dir.path().join("a.txt"), "hello").unwrap();
        stage(dir.path(), &["a.txt".into()]).unwrap();
        let oid = commit(dir.path(), "init", "T", "t@a.dev").unwrap();
        assert_eq!(oid.len(), 40);

        let s = status(dir.path()).unwrap();
        assert!(s.entries.is_empty(), "clean working tree after commit");
        assert_eq!(s.branch.as_deref(), Some("master").or(Some("main")).or(s.branch.as_deref()));
    }

    #[test]
    fn diff_shows_modified_content() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        std::fs::write(dir.path().join("a.txt"), "hello\n").unwrap();
        stage(dir.path(), &["a.txt".into()]).unwrap();
        commit(dir.path(), "init", "T", "t@a.dev").unwrap();
        std::fs::write(dir.path().join("a.txt"), "hello world\n").unwrap();
        let d = diff_file(dir.path(), "a.txt", false).unwrap();
        assert!(d.contains("-hello"));
        assert!(d.contains("+hello world"));
    }

    #[test]
    fn unstage_removes_from_index() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        std::fs::write(dir.path().join("a.txt"), "hello").unwrap();
        stage(dir.path(), &["a.txt".into()]).unwrap();
        commit(dir.path(), "init", "T", "t@a.dev").unwrap();
        std::fs::write(dir.path().join("a.txt"), "hello world").unwrap();
        stage(dir.path(), &["a.txt".into()]).unwrap();
        let s = status(dir.path()).unwrap();
        assert_eq!(s.entries[0].index, "modified");
        assert!(s.entries[0].staged);
        unstage(dir.path(), &["a.txt".into()]).unwrap();
        let s2 = status(dir.path()).unwrap();
        assert_eq!(s2.entries[0].worktree, "modified");
        assert!(!s2.entries[0].staged);
    }

    #[test]
    fn empty_commit_message_rejected() {
        let dir = tempdir().unwrap();
        init_repo(dir.path());
        std::fs::write(dir.path().join("a"), "x").unwrap();
        stage(dir.path(), &["a".into()]).unwrap();
        assert!(commit(dir.path(), "  ", "T", "t@a.dev").is_err());
    }
}
