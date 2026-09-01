'use client'

/**
 * Панель глобального поиска/замены по проекту (Ctrl+Shift+F).
 *
 * Использует нативный `fs_search` (ignore/regex/walkdir во фронте не тянем).
 * Замена — по одному совпадению за раз, серверный `fs_replace_at` проверяет
 * позицию перед подстановкой, чтобы устаревшие результаты не портили файлы.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, Search, WholeWord, X } from 'lucide-react'
import { fsSearch, fsReplaceAt, type SearchMatch } from '@/lib/tauri'

type FileGroup = { file: string; matches: SearchMatch[] }

function groupByFile(matches: SearchMatch[]): FileGroup[] {
  const map = new Map<string, SearchMatch[]>()
  for (const m of matches) {
    const arr = map.get(m.file)
    if (arr) arr.push(m)
    else map.set(m.file, [m])
  }
  return Array.from(map.entries()).map(([file, matches]) => ({ file, matches }))
}

function shortenPath(root: string, path: string): string {
  const norm = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return norm.startsWith(r) ? norm.slice(r.length + 1) : norm
}

export function GlobalSearchPanel({
  root,
  onOpenFile,
  onClose,
}: {
  root: string
  onOpenFile: (path: string, line?: number, column?: number) => void
  onClose?: () => void
}) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [isRegex, setIsRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [includeGlob, setIncludeGlob] = useState('')
  const [excludeGlob, setExcludeGlob] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [truncated, setTruncated] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const runSearch = useCallback(async () => {
    if (!query) {
      setMatches([])
      setTruncated(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fsSearch({
        root,
        query,
        caseSensitive,
        isRegex,
        wholeWord,
        includeGlob: includeGlob || undefined,
        excludeGlob: excludeGlob || undefined,
        maxMatches: 2000,
      })
      setMatches(res.matches)
      setTruncated(res.truncated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [query, root, caseSensitive, isRegex, wholeWord, includeGlob, excludeGlob])

  // Debounce автозапуска, чтобы не долбить fs на каждый символ.
  useEffect(() => {
    if (!query) {
      setMatches([])
      return
    }
    const t = setTimeout(() => void runSearch(), 220)
    return () => clearTimeout(t)
  }, [query, caseSensitive, isRegex, wholeWord, includeGlob, excludeGlob, runSearch])

  const groups = useMemo(() => groupByFile(matches), [matches])

  const replaceOne = async (m: SearchMatch) => {
    try {
      await fsReplaceAt({ ...m, replacement })
      setMatches((prev) => prev.filter((x) => x !== m))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const replaceInFile = async (g: FileGroup) => {
    // Заменяем с конца — чтобы позиции ранее найденных совпадений не сдвигались.
    const sorted = [...g.matches].sort((a, b) =>
      a.line === b.line ? b.column - a.column : b.line - a.line,
    )
    for (const m of sorted) {
      try {
        await fsReplaceAt({ ...m, replacement })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        break
      }
    }
    // После пачки — переспросим бэк, вдруг regex/whole-word поменял ситуацию.
    void runSearch()
  }

  const replaceAll = async () => {
    for (const g of groups) await replaceInFile(g)
  }

  return (
    <div className="flex h-full flex-col text-sm">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Поиск по проекту
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Замена"
            onClick={() => setShowReplace((v) => !v)}
            className={`rounded p-1 hover:bg-accent ${showReplace ? 'bg-accent text-primary' : ''}`}
          >
            <Replace className="size-3.5" />
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-accent" title="Закрыть">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="border-b border-border p-2">
        <div className="flex items-center gap-1 rounded border border-border bg-background px-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ищем…"
            className="h-8 w-full bg-transparent text-sm outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
            }}
            autoFocus
          />
          <button
            type="button"
            title="Case sensitive"
            onClick={() => setCaseSensitive((v) => !v)}
            className={`rounded p-1 hover:bg-accent ${caseSensitive ? 'bg-accent text-primary' : ''}`}
          >
            <CaseSensitive className="size-3.5" />
          </button>
          <button
            type="button"
            title="Whole word"
            onClick={() => setWholeWord((v) => !v)}
            className={`rounded p-1 hover:bg-accent ${wholeWord ? 'bg-accent text-primary' : ''}`}
          >
            <WholeWord className="size-3.5" />
          </button>
          <button
            type="button"
            title="Regex"
            onClick={() => setIsRegex((v) => !v)}
            className={`rounded p-1 hover:bg-accent ${isRegex ? 'bg-accent text-primary' : ''}`}
          >
            <Regex className="size-3.5" />
          </button>
        </div>
        {showReplace && (
          <div className="mt-1 flex items-center gap-1 rounded border border-border bg-background px-2">
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="заменить на…"
              className="h-8 w-full bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => void replaceAll()}
              disabled={!matches.length}
              className="rounded bg-primary/20 px-2 py-1 text-[11px] text-primary hover:bg-primary/30 disabled:opacity-40"
            >
              Заменить все
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="mt-1 text-[11px] text-muted-foreground hover:underline"
        >
          {showFilters ? 'Скрыть фильтры' : 'Фильтры файлов…'}
        </button>
        {showFilters && (
          <div className="mt-1 grid gap-1">
            <input
              value={includeGlob}
              onChange={(e) => setIncludeGlob(e.target.value)}
              placeholder="включить: *.ts,*.tsx,src/**"
              className="h-7 w-full rounded border border-border bg-background px-2 text-xs outline-none"
            />
            <input
              value={excludeGlob}
              onChange={(e) => setExcludeGlob(e.target.value)}
              placeholder="исключить: **/*.test.ts,**/vendor/**"
              className="h-7 w-full rounded border border-border bg-background px-2 text-xs outline-none"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">{error}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {busy && !matches.length && <div className="p-3 text-xs text-muted-foreground">поиск…</div>}
        {!busy && query && !matches.length && (
          <div className="p-3 text-xs text-muted-foreground">Ничего не найдено</div>
        )}
        {truncated && (
          <div className="border-b border-border bg-amber-500/10 px-3 py-1 text-xs text-amber-400">
            Показаны первые 2000 совпадений — сузьте запрос
          </div>
        )}
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.file)
          return (
            <div key={g.file} className="border-b border-border/50">
              <div className="flex items-center gap-1 bg-muted/40 px-2 py-1 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((s) => {
                      const n = new Set(s)
                      if (n.has(g.file)) n.delete(g.file)
                      else n.add(g.file)
                      return n
                    })
                  }
                  className="rounded p-0.5 hover:bg-accent"
                >
                  {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                </button>
                <button
                  type="button"
                  className="flex-1 truncate text-left text-foreground hover:underline"
                  onClick={() => onOpenFile(g.file)}
                >
                  {shortenPath(root, g.file)}
                </button>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {g.matches.length}
                </span>
                {showReplace && (
                  <button
                    type="button"
                    onClick={() => void replaceInFile(g)}
                    className="rounded px-1 text-[10px] text-primary hover:bg-accent"
                    title="Заменить в файле"
                  >
                    заменить
                  </button>
                )}
              </div>
              {!isCollapsed &&
                g.matches.map((m, i) => (
                  <div
                    key={`${g.file}:${m.line}:${m.column}:${i}`}
                    className="group flex items-center gap-2 px-3 py-0.5 hover:bg-accent/50"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenFile(m.file, m.line, m.column)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left font-mono text-[11px]"
                    >
                      <span className="w-8 shrink-0 text-right text-muted-foreground">{m.line}</span>
                      <span className="truncate text-foreground/90">{m.preview}</span>
                    </button>
                    {showReplace && (
                      <button
                        type="button"
                        onClick={() => void replaceOne(m)}
                        className="rounded p-0.5 text-primary opacity-0 hover:bg-accent group-hover:opacity-100"
                        title="Заменить это совпадение"
                      >
                        <Replace className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
