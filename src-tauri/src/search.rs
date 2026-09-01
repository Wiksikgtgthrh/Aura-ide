//! Глобальный поиск/замена по проекту.
//!
//! Ripgrep-подобный обход через `ignore::WalkBuilder` (учитывает `.gitignore`
//! и стандартные скрытые/бинарные фильтры), совпадения — по `regex` с
//! опциональными флагами case-insensitive и whole-word. Тяжёлый обход
//! запускается в blocking-thread, чтобы UI-поток Tauri оставался живым.

use crate::AuraError;
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchInput {
    pub root: String,
    pub query: String,
    #[serde(default)]
    pub is_regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub include_glob: Option<String>,
    #[serde(default)]
    pub exclude_glob: Option<String>,
    /// Ограничение на количество совпадений (мягкое, ранний выход).
    #[serde(default)]
    pub max_matches: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
    pub match_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
    pub scanned_files: u64,
}

const MAX_LINE_PREVIEW: usize = 400;

#[tauri::command]
pub async fn fs_search(input: SearchInput) -> Result<SearchResult, AuraError> {
    if input.query.is_empty() {
        return Ok(SearchResult {
            matches: vec![],
            truncated: false,
            scanned_files: 0,
        });
    }
    let cap = input.max_matches.unwrap_or(2000);
    tokio::task::spawn_blocking(move || -> Result<SearchResult, AuraError> {
        let pattern = if input.is_regex {
            input.query.clone()
        } else {
            regex::escape(&input.query)
        };
        let pattern = if input.whole_word {
            format!(r"\b(?:{pattern})\b")
        } else {
            pattern
        };
        let re = RegexBuilder::new(&pattern)
            .case_insensitive(!input.case_sensitive)
            .multi_line(false)
            .build()
            .map_err(|e| AuraError::Msg(format!("regex: {e}")))?;

        let root = PathBuf::from(&input.root);
        let mut builder = WalkBuilder::new(&root);
        builder
            .hidden(true)
            .git_ignore(true)
            .git_exclude(true)
            .parents(true)
            .follow_links(false)
            .max_filesize(Some(2_000_000)); // 2 MB на файл — режем гигантские
        // Стандартные тяжёлые директории.
        for skip in ["node_modules", "target", "dist", ".next", ".git", ".aura"] {
            builder.add_custom_ignore_filename(skip);
        }

        let mut include: Option<globset::GlobSet> = None;
        let mut exclude: Option<globset::GlobSet> = None;
        if let Some(pat) = input.include_glob.as_deref().filter(|s| !s.is_empty()) {
            let mut b = globset::GlobSetBuilder::new();
            for p in pat.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                if let Ok(g) = globset::Glob::new(p) {
                    b.add(g);
                }
            }
            include = b.build().ok();
        }
        if let Some(pat) = input.exclude_glob.as_deref().filter(|s| !s.is_empty()) {
            let mut b = globset::GlobSetBuilder::new();
            for p in pat.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                if let Ok(g) = globset::Glob::new(p) {
                    b.add(g);
                }
            }
            exclude = b.build().ok();
        }

        let mut matches: Vec<SearchMatch> = Vec::new();
        let mut scanned: u64 = 0;
        let mut truncated = false;

        for entry in builder.build().flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            if let Some(inc) = &include {
                if !inc.is_match(path) {
                    continue;
                }
            }
            if let Some(exc) = &exclude {
                if exc.is_match(path) {
                    continue;
                }
            }
            let bytes = match std::fs::read(path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            // Отсекаем бинарники по NUL-байту в первом килобайте.
            if bytes.iter().take(1024).any(|&b| b == 0) {
                continue;
            }
            let text = match std::str::from_utf8(&bytes) {
                Ok(s) => s,
                Err(_) => continue,
            };
            scanned += 1;
            for (idx, line) in text.lines().enumerate() {
                for m in re.find_iter(line) {
                    let preview: String = if line.len() > MAX_LINE_PREVIEW {
                        line.chars().take(MAX_LINE_PREVIEW).collect::<String>() + "…"
                    } else {
                        line.to_string()
                    };
                    matches.push(SearchMatch {
                        file: path.to_string_lossy().to_string(),
                        line: (idx + 1) as u32,
                        column: (m.start() + 1) as u32,
                        preview,
                        match_text: m.as_str().to_string(),
                    });
                    if matches.len() >= cap {
                        truncated = true;
                        break;
                    }
                }
                if truncated {
                    break;
                }
            }
            if truncated {
                break;
            }
        }
        Ok(SearchResult {
            matches,
            truncated,
            scanned_files: scanned,
        })
    })
    .await
    .map_err(|e| AuraError::Msg(format!("join: {e}")))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceInput {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub match_text: String,
    pub replacement: String,
}

/// Точечная замена одного совпадения. UI сначала показывает результат
/// поиска, потом присылает список правок — по одной в этот эндпоинт.
#[tauri::command]
pub async fn fs_replace_at(input: ReplaceInput) -> Result<(), AuraError> {
    let content = std::fs::read_to_string(&input.file)?;
    let mut out = String::with_capacity(content.len());
    for (idx, line) in content.split_inclusive('\n').enumerate() {
        let ln = (idx + 1) as u32;
        if ln != input.line {
            out.push_str(line);
            continue;
        }
        let col = input.column as usize;
        let start = col.saturating_sub(1);
        // Меняем ТОЛЬКО если по указанной позиции лежит именно то, что мы нашли.
        let ends_at = start + input.match_text.len();
        if ends_at <= line.len() && &line[start..ends_at] == input.match_text {
            out.push_str(&line[..start]);
            out.push_str(&input.replacement);
            out.push_str(&line[ends_at..]);
        } else {
            out.push_str(line);
        }
    }
    std::fs::write(&input.file, out)?;
    Ok(())
}
