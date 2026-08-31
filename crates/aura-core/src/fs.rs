//! Файловые операции.
//!
//! Все пути, приходящие с фронта, проходят через [`safe_join`], который
//! проверяет, что финальный путь действительно лежит внутри корня проекта —
//! защита от `../../etc/passwd`.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, CoreResult};

/// Узел файлового дерева (одна папка/файл).
///
/// `children == None` — папка не раскрыта либо это файл. Пустая папка получит
/// `Some(vec![])`, чтобы фронт понимал разницу.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix mtime в миллисекундах, `None` если ФС не сообщает.
    pub modified_ms: Option<i64>,
    pub children: Option<Vec<FsEntry>>,
}

/// Проверяет, что `child` действительно внутри `root` после разрешения симлинков.
///
/// Возвращает канонический абсолютный путь.
pub fn safe_join(root: &Path, child: &str) -> CoreResult<PathBuf> {
    let root_canon = root
        .canonicalize()
        .map_err(|_| CoreError::InvalidPath(root.display().to_string()))?;
    let joined = if Path::new(child).is_absolute() {
        PathBuf::from(child)
    } else {
        root_canon.join(child)
    };

    // Для операций «создать» цель может ещё не существовать — тогда
    // канонизируем родителя и добавляем последний сегмент вручную.
    let canon = match joined.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let parent = joined.parent().ok_or_else(|| {
                CoreError::InvalidPath(joined.display().to_string())
            })?;
            let parent_canon = parent
                .canonicalize()
                .map_err(|_| CoreError::InvalidPath(parent.display().to_string()))?;
            let file = joined.file_name().ok_or_else(|| {
                CoreError::InvalidPath(joined.display().to_string())
            })?;
            parent_canon.join(file)
        }
    };

    if !canon.starts_with(&root_canon) {
        return Err(CoreError::InvalidPath(format!(
            "{} is outside project root {}",
            canon.display(),
            root_canon.display()
        )));
    }
    Ok(canon)
}

/// Читает дерево директории (нерекурсивно — рекурсию делает фронт по мере
/// раскрытия узлов). Игнорирует по правилам `.gitignore` + `.ignore`.
pub fn read_dir(root: &Path, rel: &str) -> CoreResult<Vec<FsEntry>> {
    let dir = safe_join(root, rel)?;
    let md = std::fs::metadata(&dir)?;
    if !md.is_dir() {
        return Err(CoreError::InvalidPath(format!(
            "{} is not a directory",
            dir.display()
        )));
    }

    let walker = ignore::WalkBuilder::new(&dir)
        .max_depth(Some(1))
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .ignore(true)
        .build();

    let mut out: Vec<FsEntry> = Vec::new();
    for entry in walker.flatten() {
        // Первый элемент — сама dir; пропускаем.
        if entry.path() == dir {
            continue;
        }
        let path = entry.path();
        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let ft = entry.file_type();
        let is_dir = ft.map(|t| t.is_dir()).unwrap_or(false);
        let meta = std::fs::metadata(path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_ms = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);

        out.push(FsEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            size,
            modified_ms,
            children: if is_dir { Some(vec![]) } else { None },
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

pub fn read_file(root: &Path, rel: &str) -> CoreResult<String> {
    let path = safe_join(root, rel)?;
    let bytes = std::fs::read(&path)?;
    // Пробуем UTF-8, при ошибке возвращаем lossy — редактор не крашится на
    // бинарнике, а увидит placeholder-символы. Помечать бинарник — задача UI.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn write_file(root: &Path, rel: &str, contents: &str) -> CoreResult<()> {
    let path = safe_join(root, rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Атомарная запись: сначала во временный файл, потом rename.
    let tmp = path.with_extension(format!(
        "{}.aura-tmp",
        path.extension()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    ));
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn create_file(root: &Path, rel: &str) -> CoreResult<()> {
    let path = safe_join(root, rel)?;
    if path.exists() {
        return Err(CoreError::Io(format!("{} already exists", path.display())));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, b"")?;
    Ok(())
}

pub fn create_dir(root: &Path, rel: &str) -> CoreResult<()> {
    let path = safe_join(root, rel)?;
    std::fs::create_dir_all(&path)?;
    Ok(())
}

pub fn rename(root: &Path, from_rel: &str, to_rel: &str) -> CoreResult<()> {
    let from = safe_join(root, from_rel)?;
    let to = safe_join(root, to_rel)?;
    std::fs::rename(&from, &to)?;
    Ok(())
}

pub fn delete(root: &Path, rel: &str) -> CoreResult<()> {
    let path = safe_join(root, rel)?;
    let md = std::fs::metadata(&path)?;
    if md.is_dir() {
        std::fs::remove_dir_all(&path)?;
    } else {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn read_dir_lists_top_level_only() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"a").unwrap();
        std::fs::create_dir(dir.path().join("nested")).unwrap();
        std::fs::write(dir.path().join("nested/b.txt"), b"b").unwrap();

        let entries = read_dir(dir.path(), ".").unwrap();
        assert_eq!(entries.len(), 2);
        // dirs first
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, "nested");
        assert_eq!(entries[1].name, "a.txt");
    }

    #[test]
    fn safe_join_rejects_escape() {
        let dir = tempdir().unwrap();
        let err = safe_join(dir.path(), "../etc/passwd").unwrap_err();
        assert!(matches!(err, CoreError::InvalidPath(_)));
    }

    #[test]
    fn write_and_read_roundtrip() {
        let dir = tempdir().unwrap();
        write_file(dir.path(), "hello.txt", "world").unwrap();
        let s = read_file(dir.path(), "hello.txt").unwrap();
        assert_eq!(s, "world");
    }

    #[test]
    fn rename_within_project() {
        let dir = tempdir().unwrap();
        write_file(dir.path(), "a.txt", "x").unwrap();
        rename(dir.path(), "a.txt", "b.txt").unwrap();
        assert_eq!(read_file(dir.path(), "b.txt").unwrap(), "x");
    }

    #[test]
    fn delete_recursive() {
        let dir = tempdir().unwrap();
        create_dir(dir.path(), "sub").unwrap();
        write_file(dir.path(), "sub/x", "1").unwrap();
        delete(dir.path(), "sub").unwrap();
        assert!(!dir.path().join("sub").exists());
    }

    #[test]
    fn create_file_refuses_overwrite() {
        let dir = tempdir().unwrap();
        create_file(dir.path(), "x").unwrap();
        assert!(create_file(dir.path(), "x").is_err());
    }
}
