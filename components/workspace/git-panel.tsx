'use client'

/**
 * Полноценная Git-панель: изменения (staged/unstaged), diff, коммит,
 * push/pull/fetch, лог, переключение веток.
 *
 * Всё крутится вокруг `git status --porcelain=v1`: первая колонка = index,
 * вторая = worktree. Пример: 'M ' — staged modified, ' M' — unstaged modified,
 * '??' — untracked, 'MM' — оба сразу.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitBranch,
  GitCommit,
  History,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import {
  gitBranch,
  gitBranchList,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitFetch,
  gitLog,
  gitPull,
  gitPush,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  type GitBranchInfo,
  type GitLogEntry,
  type GitStatusEntry,
} from '@/lib/tauri'

const MonacoDiff = dynamic(() => import('@monaco-editor/react').then((m) => m.DiffEditor), {
  ssr: false,
})

// Разбор `git status --porcelain=v1`: две буквы + пробел + путь.
type Change = {
  path: string
  index: string // staged
  worktree: string // unstaged
  staged: boolean
  untracked: boolean
}
function parse(entries: GitStatusEntry[]): Change[] {
  return entries.map((e) => {
    const raw = (e.status + '  ').slice(0, 2)
    const index = raw[0]
    const worktree = raw[1]
    return {
      path: e.path,
      index,
      worktree,
      staged: index !== ' ' && index !== '?',
      untracked: raw === '??',
    }
  })
}

function labelOf(c: Change): { letter: string; color: string; title: string } {
  if (c.untracked) return { letter: 'U', color: 'text-green-500', title: 'untracked' }
  const s = c.staged ? c.index : c.worktree
  switch (s) {
    case 'M':
      return { letter: 'M', color: 'text-amber-500', title: 'modified' }
    case 'A':
      return { letter: 'A', color: 'text-green-500', title: 'added' }
    case 'D':
      return { letter: 'D', color: 'text-red-500', title: 'deleted' }
    case 'R':
      return { letter: 'R', color: 'text-blue-400', title: 'renamed' }
    case 'C':
      return { letter: 'C', color: 'text-blue-400', title: 'copied' }
    default:
      return { letter: s.trim() || '·', color: 'text-muted-foreground', title: s }
  }
}

export function GitPanel({ root, onOpenFile }: { root: string; onOpenFile: (p: string) => void }) {
  const [tab, setTab] = useState<'changes' | 'history' | 'branches'>('changes')
  const [changes, setChanges] = useState<Change[]>([])
  const [branch, setBranch] = useState<GitBranchInfo | null>(null)
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<{ name: string; current: boolean; remote: boolean }[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<{ before: string; after: string; path: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [st, br] = await Promise.all([
        gitStatus(root).catch(() => [] as GitStatusEntry[]),
        gitBranch(root).catch(() => null),
      ])
      setChanges(parse(st))
      setBranch(br)
    } catch {
      /* ignore */
    }
  }, [root])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (tab === 'history') gitLog(root, 100).then(setLog).catch(() => setLog([]))
    if (tab === 'branches') gitBranchList(root).then(setBranches).catch(() => setBranches([]))
  }, [tab, root])

  const withBusy = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    setNotice(null)
    try {
      const res = await fn()
      if (typeof res === 'string' && res) setNotice(res.slice(0, 200))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const openDiff = useCallback(
    async (c: Change) => {
      setSelected(c.path)
      try {
        // Показываем текущее рабочее состояние vs HEAD — самый полезный дифф.
        const patch = await gitDiff(root, c.path, false).catch(() => '')
        // Для наглядности показываем сам patch как «после», а «до» — пустой:
        // Monaco DiffEditor лучше работает на полных содержимых, но получить
        // предыдущую версию без git-плюмбинга дороже — показываем raw patch.
        setDiffText({ before: '', after: patch || '(нет изменений)', path: c.path })
      } catch {
        setDiffText({ before: '', after: '(diff недоступен)', path: c.path })
      }
    },
    [root],
  )

  const staged = useMemo(() => changes.filter((c) => c.staged), [changes])
  const unstaged = useMemo(() => changes.filter((c) => !c.staged), [changes])

  const doCommit = () =>
    withBusy('commit', async () => {
      await gitCommit({ cwd: root, message })
      setMessage('')
    })

  return (
    <div className="flex h-full flex-col text-sm">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <GitBranch className="size-4 text-primary" />
        <span className="truncate text-xs font-semibold">
          {branch?.current ?? '(нет репозитория)'}
        </span>
        {branch?.upstream && (
          <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <ArrowDown className="size-2.5" />
            {branch.behind}
            <ArrowUp className="size-2.5" />
            {branch.ahead}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="Fetch"
            onClick={() => withBusy('fetch', () => gitFetch(root))}
            className="rounded p-1 hover:bg-accent"
            disabled={!!busy}
          >
            <RefreshCw className={`size-3.5 ${busy === 'fetch' ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            title="Pull"
            onClick={() => withBusy('pull', () => gitPull(root))}
            className="rounded p-1 hover:bg-accent"
            disabled={!!busy}
          >
            <ArrowDown className="size-3.5" />
          </button>
          <button
            type="button"
            title="Push"
            onClick={() => withBusy('push', () => gitPush(root, !branch?.upstream))}
            className="rounded p-1 hover:bg-accent"
            disabled={!!busy}
          >
            <ArrowUp className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs">
        {(['changes', 'history', 'branches'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-2 py-1 ${tab === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'}`}
          >
            {t === 'changes' ? 'Изменения' : t === 'history' ? 'История' : 'Ветки'}
          </button>
        ))}
      </div>

      {error && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">{error}</div>
      )}
      {notice && (
        <div className="border-b border-border bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
          {notice}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'changes' && (
          <div className="flex h-full flex-col">
            <div className="border-b border-border p-2">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="сообщение коммита… (Ctrl+Enter)"
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void doCommit()
                }}
                className="h-16 w-full resize-none rounded border border-border bg-background p-2 text-xs outline-none focus:border-primary"
              />
              <div className="mt-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void doCommit()}
                  disabled={!message.trim() || !staged.length || !!busy}
                  className="flex flex-1 items-center justify-center gap-1 rounded bg-primary py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                >
                  {busy === 'commit' ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <GitCommit className="size-3" />
                  )}
                  Commit ({staged.length})
                </button>
                <button
                  type="button"
                  onClick={() => withBusy('stageAll', () => gitStageAll(root))}
                  disabled={!unstaged.length || !!busy}
                  className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40"
                  title="Stage all"
                >
                  Stage All
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Section
                title="Staged"
                items={staged}
                selected={selected}
                onOpen={(p) => onOpenFile(p)}
                onSelect={openDiff}
                actions={(c) => [
                  {
                    icon: <Minus className="size-3" />,
                    title: 'Unstage',
                    run: () => withBusy('unstage', () => gitUnstage(root, [c.path])),
                  },
                ]}
              />
              <Section
                title="Изменения"
                items={unstaged}
                selected={selected}
                onOpen={(p) => onOpenFile(p)}
                onSelect={openDiff}
                actions={(c) => [
                  {
                    icon: <Plus className="size-3" />,
                    title: 'Stage',
                    run: () => withBusy('stage', () => gitStage(root, [c.path])),
                  },
                  {
                    icon: <Undo2 className="size-3" />,
                    title: 'Discard',
                    danger: true,
                    run: async () => {
                      if (!confirm(`Отбросить изменения в ${c.path}?`)) return
                      await withBusy('discard', () => gitDiscard(root, [c.path]))
                    },
                  },
                ]}
              />
              {diffText && (
                <div className="border-t border-border">
                  <div className="border-b border-border bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground">
                    diff · {diffText.path}
                  </div>
                  <div className="h-64">
                    <MonacoDiff
                      original={diffText.before}
                      modified={diffText.after}
                      language="diff"
                      theme="vs-dark"
                      options={{
                        readOnly: true,
                        renderSideBySide: false,
                        minimap: { enabled: false },
                        fontSize: 12,
                      }}
                    />
                  </div>
                </div>
              )}
              {!changes.length && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  Дерево чистое — всё закоммичено
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="h-full overflow-y-auto">
            {log.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground">Нет коммитов</div>
            )}
            {log.map((c) => (
              <div key={c.hash} className="border-b border-border/50 px-3 py-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {c.short}
                  </span>
                  <span className="truncate font-medium">{c.subject}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{c.author}</span>
                  <span>·</span>
                  <span>{c.date}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'branches' && (
          <BranchTab
            branches={branches}
            root={root}
            onDone={() => {
              void refresh()
              gitBranchList(root).then(setBranches).catch(() => {})
            }}
          />
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  items,
  selected,
  onOpen,
  onSelect,
  actions,
}: {
  title: string
  items: Change[]
  selected: string | null
  onOpen: (path: string) => void
  onSelect: (c: Change) => void
  actions: (c: Change) => { icon: React.ReactNode; title: string; run: () => void; danger?: boolean }[]
}) {
  if (!items.length) return null
  return (
    <div>
      <div className="bg-muted/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </div>
      {items.map((c) => {
        const lb = labelOf(c)
        return (
          <div
            key={`${title}:${c.path}`}
            className={`group flex items-center gap-2 px-3 py-1 text-xs hover:bg-accent/50 ${
              selected === c.path ? 'bg-accent/60' : ''
            }`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => onSelect(c)}
              onDoubleClick={() => onOpen(c.path)}
              title={lb.title}
            >
              <span className={`w-3 shrink-0 text-center font-mono text-[10px] ${lb.color}`}>{lb.letter}</span>
              <span className="truncate">{c.path}</span>
            </button>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
              {actions(c).map((a) => (
                <button
                  key={a.title}
                  type="button"
                  title={a.title}
                  onClick={a.run}
                  className={`rounded p-0.5 hover:bg-accent ${a.danger ? 'text-red-400' : ''}`}
                >
                  {a.icon}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BranchTab({
  branches,
  root,
  onDone,
}: {
  branches: { name: string; current: boolean; remote: boolean }[]
  root: string
  onDone: () => void
}) {
  const [newName, setNewName] = useState('')
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2">
        <div className="flex gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="имя новой ветки…"
            className="h-7 w-full rounded border border-border bg-background px-2 text-xs outline-none"
          />
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={async () => {
              try {
                await gitCreateBranch(root, newName.trim(), true)
                setNewName('')
                onDone()
              } catch (e) {
                alert((e as Error).message)
              }
            }}
            className="rounded bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {branches.map((b) => (
          <button
            key={b.name}
            type="button"
            onClick={async () => {
              try {
                await gitCheckout(root, b.name.replace(/^remotes\//, ''))
                onDone()
              } catch (e) {
                alert((e as Error).message)
              }
            }}
            className={`flex w-full items-center gap-2 border-b border-border/40 px-3 py-1.5 text-left text-xs hover:bg-accent/50 ${
              b.current ? 'bg-accent/40' : ''
            }`}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="flex-1 truncate">{b.name}</span>
            {b.current && <Check className="size-3 text-green-500" />}
            {b.remote && !b.current && (
              <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">remote</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
