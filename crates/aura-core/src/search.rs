//! Полнотекстовый поиск по проекту.
//!
//! Используем библиотечные крейты ripgrep (`grep-regex`, `grep-searcher`,
//! `ignore`) — не запускаем внешний бинарник. `ignore::WalkBuilder`
//! автоматически уважает `.gitignore`/`.ignore`.

use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::sinks::UTF8;
use grep_searcher::SearcherBuilder;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::Path;

use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SearchMatch {
    pub path: String,
    pub line: u64,
    pub column: u32,
    /// Полная текстовая строка совпадения (без trailing `\n`).
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SearchOptions {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    /// Максимум результатов, чтобы фронт не задохнулся.
    #[serde(default = "default_max")]
    pub max_results: usize,
}

fn default_max() -> usize {
    2_000
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            case_sensitive: false,
            whole_word: false,
            regex: false,
            max_results: default_max(),
        }
    }
}

pub fn search(root: &Path, query: &str, opts: &SearchOptions) -> CoreResult<Vec<SearchMatch>> {
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let pattern = build_pattern(query, opts);
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!opts.case_sensitive && !opts.regex)
        .case_smart(!opts.case_sensitive)
        .build(&pattern)
        .map_err(|e| CoreError::Search(e.to_string()))?;

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .multi_line(false)
        .build();

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .ignore(true)
        .build();

    let mut hits: Vec<SearchMatch> = Vec::new();
    'outer: for entry in walker.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path().to_path_buf();
        let path_str = path.to_string_lossy().to_string();
        let matcher_ref = &matcher;
        let result = searcher.search_path(
            matcher_ref,
            &path,
            UTF8(|lnum, line| {
                let col = matcher_ref
                    .find(line.as_bytes())
                    .ok()
                    .flatten()
                    .map(|m| m.start() as u32 + 1)
                    .unwrap_or(1);
                hits.push(SearchMatch {
                    path: path_str.clone(),
                    line: lnum,
                    column: col,
                    preview: line.trim_end_matches('\n').to_string(),
                });
                Ok(hits.len() < opts.max_results)
            }),
        );
        // Бинарники / нечитаемые файлы пропускаем без падения.
        let _ = result;
        if hits.len() >= opts.max_results {
            break 'outer;
        }
    }
    Ok(hits)
}

fn build_pattern(query: &str, opts: &SearchOptions) -> String {
    let core = if opts.regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    if opts.whole_word {
        format!(r"\b{core}\b")
    } else {
        core
    }
}

/// Мини-обёртка чтобы не тянуть `regex` только ради `escape`.
mod regex {
    pub fn escape(s: &str) -> String {
        // Классический список regex-мета: соответствует regex::escape,
        // но без транзитивной зависимости.
        let mut out = String::with_capacity(s.len());
        for c in s.chars() {
            match c {
                '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^'
                | '$' | '#' | '&' | '-' | '~' => {
                    out.push('\\');
                    out.push(c);
                }
                _ => out.push(c),
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn seed(dir: &Path) {
        // `ignore` уважает .gitignore ТОЛЬКО внутри git-репозитория. Реальный
        // проект в IDE — это git-репо, поэтому и тест такой же.
        git2::Repository::init(dir).unwrap();
        std::fs::write(dir.join("a.txt"), "hello world\nsecond line\n").unwrap();
        std::fs::write(dir.join("b.rs"), "fn hello() { println!(\"hi\"); }\n").unwrap();
        std::fs::create_dir(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("node_modules/x.js"), "hello from vendored\n").unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules\n").unwrap();
    }

    #[test]
    fn finds_plain_text_and_honors_gitignore() {
        let dir = tempdir().unwrap();
        seed(dir.path());
        let hits = search(dir.path(), "hello", &SearchOptions::default()).unwrap();
        assert!(hits.iter().any(|h| h.path.ends_with("a.txt")));
        assert!(hits.iter().any(|h| h.path.ends_with("b.rs")));
        assert!(
            !hits.iter().any(|h| h.path.contains("node_modules")),
            "gitignore should hide vendored files"
        );
    }

    #[test]
    fn case_sensitive_toggle() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "Hello\n").unwrap();
        let insensitive = search(dir.path(), "hello", &SearchOptions::default()).unwrap();
        assert_eq!(insensitive.len(), 1);
        let sensitive = search(
            dir.path(),
            "hello",
            &SearchOptions {
                case_sensitive: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(sensitive.is_empty());
    }

    #[test]
    fn whole_word_flag() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "hello helloworld\n").unwrap();
        let ww = search(
            dir.path(),
            "hello",
            &SearchOptions {
                whole_word: true,
                case_sensitive: true,
                ..Default::default()
            },
        )
        .unwrap();
        // Строка одна, но она содержит и `hello`, и `helloworld` — matcher
        // ловит первое совпадение. Мы возвращаем строку целиком; главное
        // чтобы `helloworld` без границы слова не давало ложный hit в
        // изоляции.
        assert_eq!(ww.len(), 1);
        let no_hit = search(
            dir.path(),
            "helloworl",
            &SearchOptions {
                whole_word: true,
                case_sensitive: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(no_hit.is_empty());
    }

    #[test]
    fn max_results_caps_hits() {
        let dir = tempdir().unwrap();
        let mut data = String::new();
        for _ in 0..500 {
            data.push_str("hello\n");
        }
        std::fs::write(dir.path().join("a.txt"), data).unwrap();
        let hits = search(
            dir.path(),
            "hello",
            &SearchOptions {
                max_results: 10,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(hits.len(), 10);
    }
}
