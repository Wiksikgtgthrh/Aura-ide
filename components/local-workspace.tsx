'use client'

/**
 * Локальный workspace — «Open Folder» как в VS Code.
 *
 * Открывает реальную папку с диска (нативный диалог Tauri), показывает
 * дерево файлов, Monaco-редактор с автосохранением и терминал, работающий
 * в этой папке. Всё через нативное Rust-ядро — без Postgres и Docker.
 *
 * В браузере (не desktop) кнопка не рендерится — см. home-content.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Loader2,
  RefreshCw,
  Save,
  SquareTerminal,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  isDesktop,
  pickFolder,
  fsTree,
  fsRead,
  fsWrite,
  fsCreateFile,
  fsCreateDir,
  fsDelete,
  gitStatus,
  termRun,
  onTermOutput,
  type FsNode,
  type GitStatusEntry,
} from '@/lib/tauri'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  ),
})

function monacoLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown',
    py: 'python', rs: 'rust', go: 'go', sql: 'sql', sh: 'shell', yml: 'yaml', yaml: 'yaml',
  }
  return map[ext] ?? 'plaintext'
}

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}

/** Git-статус файла → цвет буквы (M/U/?/D) в проводнике. */
function gitBadge(path: string, root: string, git: Map<string, string>): { letter: string; cls: string } | null {
  const rel = path.replace(root, '').replace(/^[\\/]/, '').replace(/\\/g, '/')
  const st = git.get(rel)
  if (!st) return null
  if (st.includes('?')) return { letter: 'U', cls: 'text-green-500' }
  if (st.includes('M')) return { letter: 'M', cls: 'text-amber-500' }
  if (st.includes('D')) return { letter: 'D', cls: 'text-red-500' }
  if (st.includes('A')) return { letter: 'A', cls: 'text-green-500' }
  return null
}

type TermLine = { text: string }

function TreeNode({
  node,
  depth,
  root,
  git,
  active,
  onOpen,
  onToggle,
  expanded,
}: {
  node: FsNode
  depth: number
  root: string
  git: Map<string, string>
  active: string | null
  onOpen: (n: FsNode) => void
  onToggle: (path: string) => void
  expanded: Set<string>
}) {
  const isOpen = expanded.has(node.path)
  const badge = gitBadge(node.path, root, git)
  return (
    <div>
      <button
        type="button"
        onClick={() => (node.is_dir ? onToggle(node.path) : onOpen(node))}
        className={`flex w-full items-center gap-1 rounded px-1 py-[3px] text-left text-[13px] hover:bg-accent ${
          active === node.path ? 'bg-accent text-foreground' : 'text-muted-foreground'
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {node.is_dir ? (
          <>
            {isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
            {isOpen ? <FolderOpen className="size-3.5 shrink-0 text-primary" /> : <FolderClosed className="size-3.5 shrink-0 text-primary" />}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <FileText className="size-3.5 shrink-0" />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {badge && <span className={`ml-auto shrink-0 font-mono text-[10px] font-semibold ${badge.cls}`}>{badge.letter}</span>}
      </button>
      {node.is_dir && isOpen && (
        <div>
          {node.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              root={root}
              git={git}
              active={active}
              onOpen={onOpen}
              onToggle={onToggle}
              expanded={expanded}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function LocalWorkspace({ root, onClose }: { root: string; onClose: () => void }) {
  const [tree, setTree] = useState<FsNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root]))
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [git, setGit] = useState<Map<string, string>>(new Map())
  const [termOpen, setTermOpen] = useState(false)
  const [termLines, setTermLines] = useState<TermLine[]>([])
  const [termInput, setTermInput] = useState('')
  const [termRunning, setTermRunning] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null)
  const termListRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const activeRef = useRef(activeFile)
  activeRef.current = activeFile
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const refresh = useCallback(async () => {
    const [nodes, status] = await Promise.all([
      fsTree(root).catch(() => [] as FsNode[]),
      gitStatus(root).catch(() => [] as GitStatusEntry[]),
    ])
    setTree(nodes)
    setGit(new Map(status.map((s) => [s.path.replace(/\\/g, '/'), s.status])))
  }, [root])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async () => {
    const f = activeRef.current
    if (!f || !dirtyRef.current) return
    setSaving(true)
    await fsWrite(f, contentRef.current).catch(() => {})
    setDirty(false)
    setSaving(false)
    void refresh()
  }, [refresh])

  // Ctrl+S — сохранить, как в VS Code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const openFile = useCallback(async (node: FsNode) => {
    if (node.is_dir) return
    setOpenTabs((t) => (t.includes(node.path) ? t : [...t, node.path]))
    setActiveFile(node.path)
    const text = await fsRead(node.path).catch(() => '')
    setContent(text)
    setDirty(false)
  }, [])

  const switchTab = useCallback(
    async (path: string) => {
      if (dirtyRef.current && activeRef.current) await save()
      setActiveFile(path)
      const text = await fsRead(path).catch(() => '')
      setContent(text)
      setDirty(false)
    },
    [save],
  )

  const closeTab = useCallback(
    (path: string) => {
      setOpenTabs((t) => {
        const next = t.filter((x) => x !== path)
        if (activeRef.current === path) {
          const nextActive = next[next.length - 1] ?? null
          if (nextActive) void switchTab(nextActive)
          else {
            setActiveFile(null)
            setContent('')
            setDirty(false)
          }
        }
        return next
      })
    },
    [switchTab],
  )

  const toggleDir = (path: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const createEntry = async () => {
    const name = newName.trim()
    if (!name || !creating) return
    const path = joinPath(root, name)
    if (creating === 'file') await fsCreateFile(path).catch(() => {})
    else await fsCreateDir(path).catch(() => {})
    setNewName('')
    setCreating(null)
    void refresh()
  }

  const deleteActive = async () => {
    const f = activeFile
    if (!f) return
    await fsDelete(f).catch(() => {})
    closeTab(f)
    void refresh()
  }

  // --- Терминал ---------------------------------------------------------------
  const termSeq = useRef(0)
  const runCommand = useCallback(
    async (line: string) => {
      if (!line.trim() || termRunning) return
      setTermOpen(true)
      setTermLines((l) => [...l, { text: `❯ ${line}` }])
      setTermRunning(true)
      const id = `local-${++termSeq.current}`
      const unlisten = await onTermOutput(id, (chunk) => {
        if (chunk.done) {
          setTermLines((l) => [...l, { text: `[завершено, код ${chunk.code ?? 0}]` }])
          return
        }
        if (chunk.data) setTermLines((l) => [...l, { text: chunk.data }])
      })
      try {
        await termRun(id, root, line)
      } catch (err) {
        setTermLines((l) => [
          ...l,
          { text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` },
        ])
      } finally {
        unlisten()
        setTermRunning(false)
        void refresh()
      }
    },
    [root, termRunning, refresh],
  )

  useEffect(() => {
    const el = termListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [termLines.length])

  const folderLabel = useMemo(() => baseName(root), [root])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Верхняя панель */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <FolderOpen className="size-4 text-primary" />
        <span className="truncate text-sm font-medium">{folderLabel}</span>
        <span className="truncate text-xs text-muted-foreground">{root}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" title="Обновить" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Терминал"
            onClick={() => setTermOpen((o) => !o)}
          >
            <SquareTerminal className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" title="Закрыть папку" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Проводник */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-border">
          <div className="flex items-center gap-1 px-2 py-1.5">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Проводник
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                title="Новый файл"
                className="rounded p-1 hover:bg-accent"
                onClick={() => setCreating('file')}
              >
                <FilePlus2 className="size-3.5" />
              </button>
              <button
                type="button"
                title="Новая папка"
                className="rounded p-1 hover:bg-accent"
                onClick={() => setCreating('dir')}
              >
                <FolderPlus className="size-3.5" />
              </button>
              <span title="Git-репозиторий" className="rounded p-1 text-muted-foreground">
                <GitBranch className="size-3.5" />
              </span>
            </div>
          </div>
          {creating && (
            <div className="flex items-center gap-1 px-2 pb-1.5">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createEntry()
                  if (e.key === 'Escape') {
                    setCreating(null)
                    setNewName('')
                  }
                }}
                placeholder={creating === 'file' ? 'имя файла…' : 'имя папки…'}
                className="h-7 w-full rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {tree.map((n) => (
              <TreeNode
                key={n.path}
                node={n}
                depth={0}
                root={root}
                git={git}
                active={activeFile}
                onOpen={openFile}
                onToggle={toggleDir}
                expanded={expanded}
              />
            ))}
            {tree.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">Папка пуста</p>
            )}
          </div>
        </aside>

        {/* Редактор + терминал */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* Вкладки */}
          {openTabs.length > 0 && (
            <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border">
              {openTabs.map((p) => (
                <div
                  key={p}
                  className={`group flex items-center gap-1 border-r border-border px-3 text-xs ${
                    activeFile === p ? 'bg-background text-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <button type="button" className="flex items-center gap-1.5" onClick={() => void switchTab(p)}>
                    <FileText className="size-3" />
                    {baseName(p)}
                    {activeFile === p && dirty && <span className="size-1.5 rounded-full bg-primary" title="Есть несохранённые изменения" />}
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
                    onClick={() => closeTab(p)}
                    title="Закрыть"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Monaco */}
          <div className="min-h-0 flex-1">
            {activeFile ? (
              <MonacoEditor
                path={activeFile}
                language={monacoLanguage(activeFile)}
                value={content}
                onChange={(v) => {
                  setContent(v ?? '')
                  setDirty(true)
                }}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <FolderOpen className="size-8 opacity-40" />
                <p className="text-sm">Выбери файл в проводнике слева</p>
                <p className="text-xs">Ctrl+S — сохранить · файлы на диске, не в облаке</p>
              </div>
            )}
          </div>

          {/* Терминал */}
          {termOpen && (
            <div className="flex h-52 shrink-0 flex-col border-t border-border bg-zinc-950">
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 px-3 text-xs text-zinc-400">
                <SquareTerminal className="size-3.5" />
                Терминал · {folderLabel}
                {termRunning && <Loader2 className="size-3 animate-spin" />}
                <div className="ml-auto flex items-center gap-1">
                  {activeFile && dirty && (
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={saving}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                      title="Сохранить активный файл"
                    >
                      <Save className="size-3" /> {saving ? 'Сохранение…' : 'Сохранить'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteActive()}
                    className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                    title="Удалить активный файл"
                  >
                    Удалить файл
                  </button>
                </div>
              </div>
              <div ref={termListRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-[12px] leading-5 text-zinc-200">
                {termLines.map((l, i) => (
                  <pre key={i} className="whitespace-pre-wrap break-all">{l.text}</pre>
                ))}
              </div>
              <div className="flex h-9 shrink-0 items-center gap-2 border-t border-zinc-800 px-3">
                <span className="text-xs text-zinc-500">❯</span>
                <input
                  value={termInput}
                  onChange={(e) => setTermInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const line = termInput
                      setTermInput('')
                      void runCommand(line)
                    }
                  }}
                  placeholder="команда… (Enter — выполнить)"
                  className="h-7 w-full bg-transparent font-mono text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** Кнопка «Открыть папку» для главной (desktop-only). */
export function OpenFolderButton({ onOpen }: { onOpen: (path: string) => void }) {
  const [busy, setBusy] = useState(false)
  if (!isDesktop()) return null
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const path = await pickFolder()
        setBusy(false)
        if (path) onOpen(path)
      }}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
      Открыть папку (как в VS Code)
    </button>
  )
}
