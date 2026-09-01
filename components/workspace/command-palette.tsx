'use client'

/**
 * Command Palette (Ctrl+Shift+P) + Quick Open по файлам (Ctrl+P).
 *
 * Единый компонент с двумя режимами: '>' — команды, всё остальное —
 * fuzzy-поиск по путям файлов. Никаких сторонних библиотек ранжирования:
 * дешёвый бонусный алгоритм (последовательные символы + бонус за
 * границы слов) работает быстро и хорошо для типичного дерева проекта.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, FileText, Search, Zap } from 'lucide-react'
import { iconForFile } from '@/lib/file-icons'

export type PaletteCommand = {
  id: string
  title: string
  hint?: string
  keywords?: string
  run: () => void | Promise<void>
}

type Item =
  | { kind: 'cmd'; cmd: PaletteCommand; score: number }
  | { kind: 'file'; path: string; label: string; score: number }

// Fuzzy score: 0 если хотя бы один символ не найден, иначе — сумма
// бонусов (соседние символы, старт-слов, начало строки). Простой,
// быстрый, «на глаз» интуитивный.
function fuzzy(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let ti = 0
  let score = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) {
        found = j
        break
      }
    }
    if (found === -1) return 0
    let bonus = 1
    if (found === prevMatch + 1) bonus += 2
    if (found === 0 || /[\s/._-]/.test(t[found - 1] ?? ' ')) bonus += 2
    score += bonus
    prevMatch = found
    ti = found + 1
  }
  // Короче путь → выше — типичное ожидание Quick Open.
  return score - t.length * 0.01
}

export function CommandPalette({
  open,
  onClose,
  commands,
  files,
  onOpenFile,
  initialMode = 'auto',
}: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
  files: string[]
  onOpenFile: (path: string) => void
  /** 'files' — открыть с пустым вводом = список файлов, 'commands' — принудительно '>'. */
  initialMode?: 'auto' | 'files' | 'commands'
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQ(initialMode === 'commands' ? '>' : '')
    setIdx(0)
    // задержим фокус на кадр — модалка ещё не в DOM
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [open, initialMode])

  const items: Item[] = useMemo(() => {
    if (!open) return []
    const isCmd = q.startsWith('>')
    const query = isCmd ? q.slice(1).trim() : q.trim()
    if (isCmd) {
      const list = commands
        .map((c) => ({
          kind: 'cmd' as const,
          cmd: c,
          score: fuzzy(query, `${c.title} ${c.keywords ?? ''}`),
        }))
        .filter((x) => (query ? x.score > 0 : true))
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
      return list
    }
    if (!query) {
      // Пустой ввод — первые 100 файлов (без ранжирования).
      return files.slice(0, 100).map((p) => ({ kind: 'file' as const, path: p, label: p, score: 1 }))
    }
    const list = files
      .map((p) => ({ kind: 'file' as const, path: p, label: p, score: fuzzy(query, p) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
    return list
  }, [q, commands, files, open])

  useEffect(() => {
    setIdx(0)
  }, [q])

  if (!open) return null

  const run = (item: Item) => {
    onClose()
    if (item.kind === 'cmd') void item.cmd.run()
    else onOpenFile(item.path)
  }

  return (
    <div
      className="fixed inset-0 z-[900] flex items-start justify-center bg-black/40 p-4 pt-24"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {q.startsWith('>') ? (
            <Command className="size-4 text-primary" />
          ) : (
            <Search className="size-4 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(i + 1, items.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const it = items[idx]
                if (it) run(it)
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
            placeholder={q.startsWith('>') ? 'команда…' : 'поиск файла по имени · «>» — команды'}
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="hidden text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
            {q.startsWith('>') ? 'commands' : 'files'}
          </span>
        </div>
        <div className="max-h-[420px] overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Ничего не найдено</div>
          )}
          {items.map((it, i) => {
            const active = i === idx
            if (it.kind === 'cmd') {
              return (
                <button
                  key={`c:${it.cmd.id}`}
                  type="button"
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => run(it)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    active ? 'bg-accent text-foreground' : 'text-foreground/90'
                  }`}
                >
                  <Zap className="size-4 shrink-0 text-amber-400" />
                  <span className="flex-1 truncate">{it.cmd.title}</span>
                  {it.cmd.hint && (
                    <span className="ml-auto shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {it.cmd.hint}
                    </span>
                  )}
                </button>
              )
            }
            const name = it.path.split(/[\\/]/).pop() ?? it.path
            const dir = it.path.slice(0, it.path.length - name.length).replace(/[\\/]+$/, '')
            const spec = iconForFile(name)
            return (
              <button
                key={`f:${it.path}`}
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(it)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  active ? 'bg-accent text-foreground' : 'text-foreground/90'
                }`}
              >
                <spec.Icon className={`size-4 shrink-0 ${spec.className}`} />
                <span className="truncate">{name}</span>
                <span className="ml-auto max-w-[60%] truncate text-xs text-muted-foreground">{dir}</span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>↑↓ выбор · Enter — открыть · Esc — закрыть</span>
          <span>{items.length} результатов</span>
        </div>
      </div>
    </div>
  )
}
