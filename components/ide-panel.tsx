'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  Download,
  ExternalLink,
  File,
  FileKey2,
  FilePlus,
  Folder,
  FolderPlus,
  History,
  Loader2,
  MonitorSmartphone,
  MoreHorizontal,
  MousePointerClick,
  PanelLeft,
  Pencil,
  RotateCcw,
  RotateCw,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLanguage } from '@/lib/language'
import {
  buildPreviewBootstrapHtml,
  buildStandalonePreviewHtml,
  type PreviewConsoleEntry,
  type PreviewConsoleLevel,
  type SelectedElement,
} from '@/lib/preview-runtime'
import { saveProjectFiles } from '@/app/actions/project-files'
import {
  getCheckpoints,
  getCheckpointSnapshot,
  restoreCheckpoint,
} from '@/app/actions/checkpoints'
import { deleteChat, duplicateChat, renameChat } from '@/app/actions/chats'
import { downloadZip } from '@/lib/zip'
import type { CheckpointListItem } from '@/lib/chat-store'
import useSWR from 'swr'
import { getPreferences } from '@/app/actions/preferences'

const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => m.DiffEditor),
  { ssr: false },
)

// Lazy — the Publish dialog (GitHub API client, scaffold, zip builder) is only
// needed when the user clicks Publish, so keep it out of the initial bundle.
const PublishDialog = dynamic(
  () => import('@/components/publish-dialog').then((m) => m.PublishDialog),
  { ssr: false },
)

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн назад`
}

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  ),
})

export type IdeFiles = Map<string, string>

// --- helpers -----------------------------------------------------------------

function monacoLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'css':
      return 'css'
    case 'json':
      return 'json'
    case 'html':
    case 'svg':
      return 'html'
    case 'md':
      return 'markdown'
    default:
      return 'plaintext'
  }
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

const NAME_RE = /^[\w.\- ]+$/

// --- file tree ---------------------------------------------------------------

type TreeNode = {
  name: string
  path: string
  isDir: boolean
  children: TreeNode[]
}

function buildTree(files: IdeFiles, emptyDirs: Set<string>): TreeNode[] {
  const root: TreeNode[] = []

  const insert = (path: string, isDirLeaf: boolean) => {
    const parts = path.split('/')
    let current = root
    let fullPath = ''
    for (let i = 0; i < parts.length; i++) {
      fullPath = fullPath ? `${fullPath}/${parts[i]}` : parts[i]
      const isLast = i === parts.length - 1
      let node = current.find((n) => n.name === parts[i])
      if (!node) {
        node = {
          name: parts[i],
          path: fullPath,
          isDir: isLast ? isDirLeaf : true,
          children: [],
        }
        current.push(node)
      } else if (!isLast && !node.isDir) {
        node.isDir = true
      }
      current = node.children
    }
  }

  for (const path of files.keys()) insert(path, false)
  for (const dir of emptyDirs) insert(dir, true)

  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    )
    for (const n of nodes) sortLevel(n.children)
  }
  sortLevel(root)

  return root
}

// Inline input used for "new file / new folder / rename" in the tree
function InlineNameInput({
  defaultValue,
  depth,
  onCommit,
  onCancel,
}: {
  defaultValue?: string
  depth: number
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(defaultValue ?? '')
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const name = value.trim()
          if (name && NAME_RE.test(name)) onCommit(name)
          else onCancel()
        }
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={onCancel}
      className="mx-2 my-0.5 w-[calc(100%-16px)] rounded border border-ring bg-background px-1.5 py-0.5 text-xs text-foreground outline-none"
      style={{ marginLeft: `${8 + depth * 12}px` }}
      spellCheck={false}
    />
  )
}

type PendingOp =
  | { kind: 'create-file'; parent: string }
  | { kind: 'create-folder'; parent: string }
  | { kind: 'rename'; path: string; isDir: boolean }
  | null

function FileTreeNode({
  node,
  activeFile,
  onSelect,
  pendingOp,
  setPendingOp,
  onCreate,
  onRename,
  onDelete,
  onContextMenu,
  defaultOpen = true,
  depth = 0,
}: {
  node: TreeNode
  activeFile: string
  onSelect: (path: string) => void
  pendingOp: PendingOp
  setPendingOp: (op: PendingOp) => void
  onCreate: (parent: string, name: string, isDir: boolean) => void
  onRename: (path: string, newName: string, isDir: boolean) => void
  onDelete: (path: string, isDir: boolean) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  defaultOpen?: boolean
  depth?: number
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(defaultOpen)
  const isActive = !node.isDir && node.path === activeFile
  const isRenaming = pendingOp?.kind === 'rename' && pendingOp.path === node.path
  const creatingHere =
    (pendingOp?.kind === 'create-file' || pendingOp?.kind === 'create-folder') &&
    pendingOp.parent === node.path

  if (isRenaming) {
    return (
      <InlineNameInput
        defaultValue={node.name}
        depth={depth}
        onCommit={(name) => {
          setPendingOp(null)
          if (name !== node.name) onRename(node.path, name, node.isDir)
        }}
        onCancel={() => setPendingOp(null)}
      />
    )
  }

  const rowActions = (
    <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
      {node.isDir && (
        <span
          role="button"
          tabIndex={0}
          title={t('ideNewFile')}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
            setPendingOp({ kind: 'create-file', parent: node.path })
          }}
          className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground"
        >
          <FilePlus className="size-3" />
        </span>
      )}
      <span
        role="button"
        tabIndex={0}
        title={t('ideRename')}
        onClick={(e) => {
          e.stopPropagation()
          setPendingOp({ kind: 'rename', path: node.path, isDir: node.isDir })
        }}
        className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground"
      >
        <Pencil className="size-3" />
      </span>
      <span
        role="button"
        tabIndex={0}
        title={t('ideDelete')}
        onClick={(e) => {
          e.stopPropagation()
          onDelete(node.path, node.isDir)
        }}
        className="rounded p-0.5 text-muted-foreground/70 hover:text-destructive"
      >
        <Trash2 className="size-3" />
      </span>
    </span>
  )

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onContextMenu={(e) => onContextMenu?.(e, node)}
          className="group/row flex w-full items-center gap-1.5 py-0.5 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <Folder className="size-3 shrink-0 text-sky-500" />
          <span className="truncate">{node.name}</span>
          {rowActions}
        </button>
        {open && creatingHere && (
          <InlineNameInput
            depth={depth + 1}
            onCommit={(name) => {
              setPendingOp(null)
              onCreate(node.path, name, pendingOp!.kind === 'create-folder')
            }}
            onCancel={() => setPendingOp(null)}
          />
        )}
        {open &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              activeFile={activeFile}
              onSelect={onSelect}
              pendingOp={pendingOp}
              setPendingOp={setPendingOp}
              onCreate={onCreate}
              onRename={onRename}
              onDelete={onDelete}
              onContextMenu={onContextMenu}
              defaultOpen={defaultOpen}
              depth={depth + 1}
            />
          ))}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      onContextMenu={(e) => onContextMenu?.(e, node)}
      className={`group/row flex w-full items-center gap-1.5 py-0.5 text-xs rounded transition-colors ${
        isActive
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: '8px' }}
    >
      <File className="size-3 shrink-0 text-sky-400/80" />
      <span className="truncate">{node.name}</span>
      {rowActions}
    </button>
  )
}

// --- console -----------------------------------------------------------------

const LEVEL_STYLES: Record<PreviewConsoleLevel, string> = {
  log: 'text-foreground/80',
  info: 'text-sky-500',
  warn: 'text-amber-500',
  error: 'text-red-500',
  debug: 'text-muted-foreground',
  result: 'text-violet-400',
}

// Dark-terminal palette (independent of app light/dark theme — a terminal is
// always dark, like VS Code's integrated terminal).
const TERM_LEVEL_STYLES: Record<PreviewConsoleLevel, string> = {
  log: 'text-zinc-300',
  info: 'text-sky-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  debug: 'text-zinc-500',
  result: 'text-violet-400',
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

type BottomTab = 'logs' | 'terminal'

/**
 * Bottom panel with Logs | Terminal tabs (VS Code style): logs collect the
 * preview's console output with timestamps + a filter box; the terminal is
 * the REPL (ls / cat / clear / help / JS eval) with its own scrollback.
 */
function BottomPanel({
  entries,
  onClear,
  onSubmit,
  onClose,
  onFix,
}: {
  entries: PreviewConsoleEntry[]
  onClear: () => void
  /** Runs a terminal line: shell-style command (ls/cat/clear/help) or JS eval. */
  onSubmit: (line: string) => void
  onClose: () => void
  /** Send an error to the chat for the AI to fix. */
  onFix?: (errorText: string) => void
}) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<BottomTab>('logs')
  const [filter, setFilter] = useState('')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const logEntries = useMemo(
    () => entries.filter((e) => (e.origin ?? 'log') === 'log'),
    [entries],
  )
  const termEntries = useMemo(
    () => entries.filter((e) => e.origin === 'term'),
    [entries],
  )

  const active = tab === 'logs' ? logEntries : termEntries
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? active.filter((e) => e.text.toLowerCase().includes(q)) : active
  }, [active, filter])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible.length, tab])

  const submit = () => {
    const line = input.trim()
    if (!line) return
    setHistory((h) => [...h, line])
    setHistIdx(null)
    onSubmit(line)
    setInput('')
  }

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(visible.map((e) => e.text).join('\n'))
    } catch {
      /* ignore */
    }
  }

  const logErrorCount = logEntries.filter((e) => e.level === 'error').length

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-border bg-zinc-950 text-zinc-200">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-zinc-800 px-2">
        {(
          [
            { key: 'logs' as BottomTab, label: t('ideLogsTab'), icon: null },
            { key: 'terminal' as BottomTab, label: t('ideTerminalTab'), icon: <SquareTerminal className="size-3" /> },
          ]
        ).map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key)
              if (key === 'terminal') requestAnimationFrame(() => inputRef.current?.focus())
            }}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
              tab === key
                ? 'text-zinc-100 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-zinc-100'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {icon}
            {label}
            {key === 'logs' && logErrorCount > 0 && (
              <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500/90 px-1 text-[9px] font-semibold text-white">
                {logErrorCount}
              </span>
            )}
          </button>
        ))}

        {/* Filter */}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('ideLogsFilter')}
          className="ml-auto h-6 w-44 rounded border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={copyAll}
          title={t('copy')}
          className="rounded p-1 text-zinc-500 hover:text-zinc-100 transition-colors"
        >
          <Copy className="size-3" />
        </button>
        <button
          type="button"
          onClick={onClear}
          title={t('ideConsoleClear')}
          className="rounded p-1 text-zinc-500 hover:text-zinc-100 transition-colors"
        >
          <Trash2 className="size-3" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:text-zinc-100 transition-colors"
          aria-label="Close panel"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* Scrollback */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed"
      >
        {visible.length === 0 ? (
          <p className="py-2 text-zinc-500">
            {filter
              ? t('searchNoResults')
              : tab === 'logs'
                ? t('ideLogsEmpty')
                : t('ideConsoleEmpty')}
          </p>
        ) : (
          visible.map((e) => (
            <div
              key={e.id}
              className={`group/line flex gap-2 whitespace-pre-wrap break-words py-0.5 ${TERM_LEVEL_STYLES[e.level] ?? 'text-zinc-300'}`}
            >
              {tab === 'logs' && (
                <span className="shrink-0 select-none text-zinc-600">{formatTs(e.ts)}</span>
              )}
              <span className="min-w-0 flex-1">
                {e.level === 'result' ? `⟵ ${e.text}` : e.text}
                {e.level === 'error' && onFix && (
                  <button
                    type="button"
                    onClick={() => onFix(e.text)}
                    className="ml-2 hidden rounded bg-emerald-800/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-100 hover:bg-emerald-700 group-hover/line:inline-block"
                  >
                    🤖 Исправить с ИИ
                  </button>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Terminal prompt (terminal tab only) */}
      {tab === 'terminal' && (
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 px-3 py-1.5">
          <span className="font-mono text-xs text-emerald-400">❯</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (history.length === 0) return
                const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1)
                setHistIdx(next)
                setInput(history[next])
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (histIdx === null) return
                const next = histIdx + 1
                if (next >= history.length) {
                  setHistIdx(null)
                  setInput('')
                } else {
                  setHistIdx(next)
                  setInput(history[next])
                }
              }
            }}
            placeholder={t('ideConsoleEval')}
            className="flex-1 bg-transparent font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  )
}

// --- panel -------------------------------------------------------------------

type PanelTab = 'preview' | 'design' | 'code'

const NEW_FILE_TEMPLATE = (path: string): string => {
  if (path.endsWith('.tsx')) {
    const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.tsx$/, '')
    const name = base.replace(/[^A-Za-z0-9]/g, '') || 'Component'
    return `import React from "react";\n\nexport function ${name}() {\n  return <div>${name}</div>;\n}\n`
  }
  if (path.endsWith('.ts')) return 'export {}\n'
  if (path.endsWith('.css')) return ''
  return ''
}

export function IdePanel({
  chatId,
  files,
  initialFiles,
  busy,
  chatCollapsed,
  onToggleChat,
  onFixError,
  onElementSelect,
  projectName = 'aura-project',
  openFileRequest = null,
}: {
  chatId?: string
  files: IdeFiles
  /** Persistent FS from the DB — wins over stale message history on mount. */
  initialFiles?: Record<string, string>
  busy: boolean
  chatCollapsed: boolean
  onToggleChat: () => void
  /** Send a preview error to the chat for the AI to fix. */
  onFixError?: (errorText: string) => void
  /** Design mode: the user clicked an element in the preview. */
  onElementSelect?: (el: SelectedElement) => void
  projectName?: string
  /** A file pill clicked in the chat — open this file in the code tab. */
  openFileRequest?: { path: string; epoch: number } | null
}) {
  const { t } = useLanguage()
  // Editor preferences from Settings → General (font size, tab size, wrap)
  const { data: prefs } = useSWR('preferences', getPreferences, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const [tab, setTab] = useState<PanelTab>('preview')
  const [mobile, setMobile] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [activeFile, setActiveFile] = useState('src/App.tsx')
  const hasDbFiles = !!initialFiles && Object.keys(initialFiles).length > 0
  // Seed the editor from the persistent FS (includes the user's manual edits).
  const [localFiles, setLocalFiles] = useState<IdeFiles>(() =>
    hasDbFiles ? new Map(Object.entries(initialFiles!)) : new Map(),
  )
  const [emptyDirs, setEmptyDirs] = useState<Set<string>>(new Set())
  const [pendingOp, setPendingOp] = useState<PendingOp>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const router = useRouter()
  // Project menu state: rename result overrides the SSR-provided name
  const [renamedTitle, setRenamedTitle] = useState<string | null>(null)
  const displayName = renamedTitle ?? projectName
  const [menuBusy, setMenuBusy] = useState(false)

  // A file pill was clicked in the chat — open that file in the code tab.
  useEffect(() => {
    if (!openFileRequest) return
    const { path } = openFileRequest
    if (filesRef.current.has(path)) {
      setActiveFile(path)
      setTab('code')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFileRequest?.epoch])

  // ---- Project menu actions -------------------------------------------------
  const handleRenameProject = async () => {
    if (!chatId) return
    const next = window.prompt(t('renameProject'), displayName)
    const trimmed = next?.trim()
    if (!trimmed || trimmed === displayName) return
    await renameChat(chatId, trimmed)
    setRenamedTitle(trimmed.slice(0, 100))
  }

  const handleDuplicateProject = async () => {
    if (!chatId || menuBusy) return
    setMenuBusy(true)
    try {
      const newId = await duplicateChat(chatId)
      if (newId) router.push(`/chat/${newId}`)
    } finally {
      setMenuBusy(false)
    }
  }

  const handleDeleteProject = async () => {
    if (!chatId) return
    if (!window.confirm(t('deleteProjectConfirm'))) return
    await deleteChat(chatId)
    router.push('/')
  }

  const handleDownloadProjectZip = () => {
    if (filesRef.current.size === 0) return
    downloadZip(
      Object.fromEntries(filesRef.current),
      `${displayName.replace(/\s+/g, '-') || 'aura-project'}.zip`,
    )
  }

  // Create (if needed) and open the .env file — its KEY=VALUE pairs are
  // exposed as process.env.* inside the preview runtime.
  const handleOpenEnvFile = () => {
    if (!filesRef.current.has('.env')) {
      setLocalFiles((prev) => {
        const next = new Map(prev)
        next.set(
          '.env',
          '# Переменные окружения превью (KEY=VALUE)\n# Доступны в коде как process.env.KEY\nVITE_API_URL=\n',
        )
        return next
      })
    }
    setActiveFile('.env')
    setTab('code')
  }

  // Monaco vs React <Activity>: this panel lives inside an Activity shell
  // (see app-content-area.tsx), so navigating away hides it and runs effect
  // cleanups. @monaco-editor/react disposes the underlying editor in its
  // cleanup but keeps stale internal refs, so when the panel is revealed
  // again React reconnects the old effects against the disposed instance and
  // crashes with "InstantiationService has been disposed"
  // (suren-atoyan/monaco-react#794). Bump an epoch in the cleanup: the state
  // update is deferred while hidden and applied on reveal, so the editors
  // below remount fresh instead of reconnecting onto a dead instance.
  const [editorEpoch, setEditorEpoch] = useState(0)
  useEffect(() => {
    return () => setEditorEpoch((e) => e + 1)
  }, [])

  // File explorer: search, right-click context menu, collapse-all
  const [fileSearch, setFileSearch] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null)
  const [collapseEpoch, setCollapseEpoch] = useState(0)

  // Version history (checkpoints)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [checkpoints, setCheckpoints] = useState<CheckpointListItem[] | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  // Diff viewer: snapshot files + selected path
  const [diffSnapshot, setDiffSnapshot] = useState<Record<string, string> | null>(null)
  const [diffPath, setDiffPath] = useState<string | null>(null)

  // Console state
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<PreviewConsoleEntry[]>([])
  const entryIdRef = useRef(0)
  const errorCount = useMemo(
    () => consoleEntries.filter((e) => e.level === 'error').length,
    [consoleEntries],
  )

  // Baseline for the remote-sync diff. When the DB seeded localFiles, the
  // baseline starts as the CURRENT extracted message history — so old file
  // blocks in past messages don't clobber the user's saved edits; only NEW
  // model output (content that differs from history-at-mount) applies.
  const prevFilesRef = useRef<IdeFiles | null>(null)
  if (prevFilesRef.current === null) {
    prevFilesRef.current = hasDbFiles ? new Map(files) : new Map()
  }
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const filesRef = useRef<IdeFiles>(localFiles)
  filesRef.current = localFiles

  const hasFiles = localFiles.size > 0 || emptyDirs.size > 0

  // Sync remote files into local state, preserving any local edits the user has made.
  // For each incoming remote file, only overwrite if the remote content changed
  // compared to the PREVIOUS remote snapshot — not the local version. Files the
  // user deleted locally stay deleted while the remote content is unchanged.
  useEffect(() => {
    const prevRemote = prevFilesRef.current ?? new Map<string, string>()
    let changed = false
    const next = new Map(filesRef.current)

    for (const [path, remoteCode] of files) {
      const prevRemoteCode = prevRemote.get(path)
      if (prevRemoteCode !== remoteCode) {
        next.set(path, remoteCode)
        changed = true
      }
    }

    if (changed) {
      prevFilesRef.current = new Map(files)
      setLocalFiles(next)
      setActiveFile((current) => {
        if (next.has(current)) return current
        if (next.has('src/App.tsx')) return 'src/App.tsx'
        const first = next.keys().next().value
        return first ?? current
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  // ---- Autosave the virtual FS to the DB (debounced full sync) --------------
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const lastSavedRef = useRef<string>(
    hasDbFiles ? JSON.stringify(Object.fromEntries(new Map(Object.entries(initialFiles!)))) : '',
  )
  useEffect(() => {
    if (!chatId || localFiles.size === 0) return
    const payload = Object.fromEntries(localFiles)
    const serialized = JSON.stringify(payload)
    if (serialized === lastSavedRef.current) return

    const timer = setTimeout(async () => {
      setSaveState('saving')
      try {
        const res = await saveProjectFiles(chatId, payload)
        if (res.ok) {
          lastSavedRef.current = serialized
          setSaveState('saved')
          setTimeout(() => setSaveState('idle'), 1500)
        } else {
          setSaveState('idle')
        }
      } catch {
        setSaveState('idle')
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [localFiles, chatId])

  // --- preview messaging ------------------------------------------------------

  const appendEntry = useCallback(
    (level: PreviewConsoleLevel, text: string, origin: 'log' | 'term' = 'log') => {
      setConsoleEntries((prev) => {
        const next = [
          ...prev,
          { id: ++entryIdRef.current, level, text, ts: Date.now(), origin },
        ]
        return next.length > 500 ? next.slice(next.length - 500) : next
      })
    },
    [],
  )

  const postFiles = useCallback(() => {
    const frame = iframeRef.current
    if (!frame?.contentWindow || !readyRef.current) return
    if (filesRef.current.size === 0) return
    frame.contentWindow.postMessage(
      { __aura: true, type: 'files', files: Object.fromEntries(filesRef.current) },
      '*',
    )
  }, [])

  // Listen for messages from the preview iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (!data || data.__aura !== true) return
      if (data.type === 'ready') {
        readyRef.current = true
        postFiles()
      } else if (data.type === 'console') {
        appendEntry(data.level as PreviewConsoleLevel, String(data.text ?? ''))
      } else if (data.type === 'eval-result') {
        appendEntry(data.ok ? 'result' : 'error', String(data.text ?? ''), 'term')
      } else if (data.type === 'element-selected' && data.element) {
        // Design mode: the user picked an element in the preview
        onElementSelect?.(data.element as SelectedElement)
      } else if (data.type === 'fix-error' && typeof data.text === 'string') {
        // "Fix with AI" button in the preview's error overlay
        onFixError?.(data.text)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendEntry, postFiles, onFixError])

  // Push file updates into the live iframe (debounced, no iframe reload)
  useEffect(() => {
    if (localFiles.size === 0) return
    const timer = setTimeout(postFiles, 300)
    return () => clearTimeout(timer)
  }, [localFiles, postFiles])

  const handleManualReload = () => {
    readyRef.current = false
    setReloadKey((k) => k + 1)
  }

  // Console line: shell-style commands are handled locally, everything else is
  // evaluated as JS inside the preview iframe.
  const handleConsoleSubmit = (line: string) => {
    appendEntry('info', `❯ ${line}`, 'term')
    const [cmd, ...rest] = line.split(/\s+/)
    const arg = rest.join(' ')

    switch (cmd) {
      case 'clear':
      case 'cls':
        setConsoleEntries([])
        return
      case 'help':
        appendEntry(
          'log',
          'Commands: ls, cat <file>, clear, help. Anything else runs as JS in the preview.',
          'term',
        )
        return
      case 'ls': {
        const paths = [...filesRef.current.keys()].sort()
        appendEntry('log', paths.length ? paths.join('\n') : '(no files)', 'term')
        return
      }
      case 'cat': {
        if (!arg) {
          appendEntry('error', 'usage: cat <file>', 'term')
          return
        }
        const code =
          filesRef.current.get(arg) ??
          filesRef.current.get(arg.replace(/^\.?\//, '')) ??
          [...filesRef.current.entries()].find(([p]) => p.endsWith(arg))?.[1]
        appendEntry(code === undefined ? 'error' : 'log', code ?? `cat: ${arg}: no such file`, 'term')
        return
      }
    }

    // Fall through → JS eval in the preview iframe
    const frame = iframeRef.current
    if (!frame?.contentWindow || !readyRef.current) {
      appendEntry('error', 'Preview is not ready yet', 'term')
      return
    }
    frame.contentWindow.postMessage(
      { __aura: true, type: 'eval', id: ++entryIdRef.current, code: line },
      '*',
    )
  }

  // ---- Version history handlers ---------------------------------------------

  const toggleHistory = async () => {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && chatId) {
      setCheckpoints(null)
      setCheckpoints(await getCheckpoints(chatId).catch(() => []))
    }
  }

  const handleRestore = async (checkpointId: string) => {
    if (!chatId || restoring) return
    setRestoring(checkpointId)
    try {
      const files = await restoreCheckpoint(chatId, checkpointId)
      if (files) {
        const map = new Map(Object.entries(files))
        setLocalFiles(map)
        lastSavedRef.current = JSON.stringify(files) // already synced server-side
        setActiveFile((cur) => (map.has(cur) ? cur : map.has('src/App.tsx') ? 'src/App.tsx' : (map.keys().next().value ?? cur)))
        setHistoryOpen(false)
        appendEntry('info', `⏪ Откат к версии выполнен (${map.size} файлов)`)
      }
    } finally {
      setRestoring(null)
    }
  }

  const openDiff = async (checkpointId: string) => {
    if (!chatId) return
    const snapshot = await getCheckpointSnapshot(chatId, checkpointId).catch(() => null)
    if (!snapshot) return
    setDiffSnapshot(snapshot)
    // Pick the first file that differs; fall back to the first file
    const allPaths = [...new Set([...Object.keys(snapshot), ...filesRef.current.keys()])].sort()
    const firstChanged = allPaths.find(
      (p) => (snapshot[p] ?? '') !== (filesRef.current.get(p) ?? ''),
    )
    setDiffPath(firstChanged ?? allPaths[0] ?? null)
    setHistoryOpen(false)
  }

  // Open the current preview in a real browser tab (works offline / without a
  // domain): a self-contained blob URL with the files inlined.
  const handleOpenNewTab = () => {
    if (filesRef.current.size === 0) return
    const html = buildStandalonePreviewHtml(Object.fromEntries(filesRef.current))
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  // Static bootstrap document — file updates flow via postMessage, so the
  // iframe is never remounted while typing (only on manual reload).
  const srcDoc = useMemo(() => buildPreviewBootstrapHtml(), [])

  // --- file operations ---------------------------------------------------------

  const handleCreate = useCallback(
    (parent: string, name: string, isDir: boolean) => {
      const path = joinPath(parent, name)
      if (filesRef.current.has(path)) return
      if (isDir) {
        setEmptyDirs((prev) => new Set(prev).add(path))
      } else {
        setLocalFiles((prev) => {
          if (prev.has(path)) return prev
          const next = new Map(prev)
          next.set(path, NEW_FILE_TEMPLATE(path))
          return next
        })
        setEmptyDirs((prev) => {
          if (!parent || !prev.has(parent)) return prev
          const next = new Set(prev)
          next.delete(parent)
          return next
        })
        setActiveFile(path)
      }
    },
    [],
  )

  const handleRename = useCallback((path: string, newName: string, isDir: boolean) => {
    if (!newName || !NAME_RE.test(newName)) return
    const parent = dirOf(path)
    const newPath = joinPath(parent, newName)
    if (newPath === path) return

    if (isDir) {
      const prefix = `${path}/`
      setLocalFiles((prev) => {
        const next = new Map<string, string>()
        for (const [p, code] of prev) {
          next.set(p.startsWith(prefix) ? `${newPath}/${p.slice(prefix.length)}` : p, code)
        }
        return next
      })
      setEmptyDirs((prev) => {
        const next = new Set<string>()
        for (const d of prev) {
          next.add(d === path ? newPath : d.startsWith(prefix) ? `${newPath}/${d.slice(prefix.length)}` : d)
        }
        return next
      })
      setActiveFile((current) =>
        current.startsWith(prefix) ? `${newPath}/${current.slice(prefix.length)}` : current,
      )
    } else {
      setLocalFiles((prev) => {
        if (!prev.has(path) || prev.has(newPath)) return prev
        const next = new Map(prev)
        const code = next.get(path)!
        next.delete(path)
        next.set(newPath, code)
        return next
      })
      setActiveFile((current) => (current === path ? newPath : current))
    }
  }, [])

  const handleDelete = useCallback(
    (path: string, isDir: boolean) => {
      if (isDir && !window.confirm(t('ideDeleteFolderConfirm'))) return

      if (isDir) {
        const prefix = `${path}/`
        setLocalFiles((prev) => {
          const next = new Map<string, string>()
          for (const [p, code] of prev) {
            if (p !== path && !p.startsWith(prefix)) next.set(p, code)
          }
          return next
        })
        setEmptyDirs((prev) => {
          const next = new Set<string>()
          for (const d of prev) {
            if (d !== path && !d.startsWith(prefix)) next.add(d)
          }
          return next
        })
      } else {
        setLocalFiles((prev) => {
          const next = new Map(prev)
          next.delete(path)
          return next
        })
      }

      setActiveFile((current) => {
        const gone = isDir ? current === path || current.startsWith(`${path}/`) : current === path
        if (!gone) return current
        const remaining = filesRef.current
        if (remaining.has('src/App.tsx') && 'src/App.tsx' !== current) return 'src/App.tsx'
        for (const key of remaining.keys()) {
          if (key !== current && !(isDir && key.startsWith(`${path}/`))) return key
        }
        return current
      })
    },
    [t],
  )

  // Explorer search: match by file name always, by content too (badge)
  const searchResults = useMemo(() => {
    const q = fileSearch.trim().toLowerCase()
    if (!q) return null
    const out: { path: string; inContent: boolean }[] = []
    for (const [path, code] of localFiles) {
      const nameHit = path.toLowerCase().includes(q)
      const contentHit = !nameHit && code.toLowerCase().includes(q)
      if (nameHit || contentHit) out.push({ path, inContent: contentHit })
    }
    return out.sort((a, b) => Number(a.inContent) - Number(b.inContent) || a.path.localeCompare(b.path)).slice(0, 50)
  }, [fileSearch, localFiles])

  const handleTreeContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, path: node.path, isDir: node.isDir })
  }, [])

  const handleDuplicate = useCallback((path: string) => {
    const code = filesRef.current.get(path)
    if (code === undefined) return
    const dot = path.lastIndexOf('.')
    const slash = path.lastIndexOf('/')
    const base = dot > slash ? path.slice(0, dot) : path
    const ext = dot > slash ? path.slice(dot) : ''
    let candidate = `${base}.copy${ext}`
    let n = 2
    while (filesRef.current.has(candidate)) candidate = `${base}.copy${n++}${ext}`
    setLocalFiles((prev) => new Map(prev).set(candidate, code))
    setActiveFile(candidate)
  }, [])

  const handleDownloadFile = useCallback((path: string) => {
    const code = filesRef.current.get(path)
    if (code === undefined) return
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = path.slice(path.lastIndexOf('/') + 1)
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [])

  const handleCopyPath = useCallback(async (path: string) => {
    try { await navigator.clipboard.writeText(path) } catch { /* ignore */ }
  }, [])

  const treeNodes = useMemo(() => buildTree(localFiles, emptyDirs), [localFiles, emptyDirs])
  const activeCode = localFiles.get(activeFile) ?? ''

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return
    setLocalFiles((prev) => {
      const next = new Map(prev)
      next.set(activeFile, value)
      return next
    })
  }

  const showPreview = tab === 'preview' || tab === 'design'
  const showCode = tab === 'code'

  // Toggle the preview's design-select mode when entering/leaving the tab
  useEffect(() => {
    const frame = iframeRef.current
    if (!frame?.contentWindow || !readyRef.current) return
    frame.contentWindow.postMessage(
      { __aura: true, type: 'design-mode', on: tab === 'design' },
      '*',
    )
  }, [tab])

  const tabLabels: Record<PanelTab, string> = {
    preview: t('idePreviewTab'),
    design: t('ideDesignTab'),
    code: t('ideCodeTab'),
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-muted/30">
      {/* Toolbar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onToggleChat}
          aria-label={chatCollapsed ? 'Open chat panel' : 'Collapse chat panel'}
        >
          <PanelLeft className="size-4" />
        </Button>

        {/* Tab switcher — Preview / Design / Code */}
        <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5 text-xs">
          {(['preview', 'design', 'code'] as PanelTab[]).map((t_) => (
            <button
              key={t_}
              type="button"
              onClick={() => setTab(t_)}
              className={`rounded-md px-2.5 py-1 transition-all duration-150 active:scale-95 ${
                tab === t_
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tabLabels[t_]}
            </button>
          ))}
        </div>

        {/* Version history */}
        <button
          type="button"
          onClick={toggleHistory}
          title="История версий"
          className={`relative flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-all duration-150 active:scale-95 ${
            historyOpen
              ? 'bg-background text-foreground shadow-xs'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground'
          }`}
          aria-pressed={historyOpen}
        >
          <History className="size-3.5" />
        </button>

        {/* Console toggle */}
        <button
          type="button"
          onClick={() => setConsoleOpen((o) => !o)}
          className={`relative flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-all duration-150 active:scale-95 ${
            consoleOpen
              ? 'bg-background text-foreground shadow-xs'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground'
          }`}
          aria-pressed={consoleOpen}
        >
          <SquareTerminal className="size-3.5" />
          <span className="hidden lg:inline">{t('ideConsole')}</span>
          {errorCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
              {errorCount > 99 ? '99+' : errorCount}
            </span>
          )}
        </button>

        <div className="mx-auto flex flex-1 items-center justify-center gap-1 text-xs text-muted-foreground truncate">
          {busy && hasFiles && (
            <span className="flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2 py-0.5 text-[10px]">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Generating…
            </span>
          )}
          {!busy && saveState !== 'idle' && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground animate-in fade-in duration-200">
              {saveState === 'saving' ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  {t('ideSaving')}
                </>
              ) : (
                t('ideSaved')
              )}
            </span>
          )}
        </div>

        {/* Project menu — v0-style: rename, duplicate, ZIP, console, .env, delete */}
        {chatId && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('projectMenu')}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuItem className="gap-2.5" onClick={handleRenameProject}>
                  <Pencil className="size-4" />
                  {t('renameProject')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2.5"
                  onClick={handleDuplicateProject}
                  disabled={menuBusy}
                >
                  {menuBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {t('duplicateProject')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2.5"
                  onClick={handleDownloadProjectZip}
                  disabled={localFiles.size === 0}
                >
                  <Download className="size-4" />
                  {t('downloadZip')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem className="gap-2.5" onClick={() => setConsoleOpen(true)}>
                  <SquareTerminal className="size-4" />
                  {t('ideConsole')}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2.5" onClick={handleOpenEnvFile}>
                  <FileKey2 className="size-4" />
                  {t('envFile')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2.5"
                  onClick={() => setPublishOpen(true)}
                  disabled={localFiles.size === 0}
                >
                  <Upload className="size-4" />
                  {t('publish')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2.5 text-destructive"
                onClick={handleDeleteProject}
              >
                <Trash2 className="size-4" />
                {t('deleteProject')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          size="sm"
          className="h-8 rounded-full px-4 text-xs transition-transform active:scale-95"
          onClick={() => setPublishOpen(true)}
          disabled={localFiles.size === 0}
        >
          {t('publish')}
        </Button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File explorer */}
        {hasFiles && (
          <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-background/60 py-2">
            <div className="flex items-center px-3 pb-1">
              <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {displayName}
              </p>
              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  title={t('ideNewFile')}
                  onClick={() => setPendingOp({ kind: 'create-file', parent: '' })}
                  className="rounded p-1 text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <FilePlus className="size-3" />
                </button>
                <button
                  type="button"
                  title={t('ideNewFolder')}
                  onClick={() => setPendingOp({ kind: 'create-folder', parent: '' })}
                  className="rounded p-1 text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <FolderPlus className="size-3" />
                </button>
                <button
                  type="button"
                  title={t('ideCollapseAll')}
                  onClick={() => setCollapseEpoch((e) => e + 1)}
                  className="rounded p-1 text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <ChevronsDownUp className="size-3" />
                </button>
              </span>
            </div>

            {/* Search (name + content) */}
            <div className="relative mx-2 mb-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder={t('ideFileSearch')}
                className="h-6 w-full rounded-md border border-border bg-background pl-6 pr-5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring"
                spellCheck={false}
              />
              {fileSearch && (
                <button
                  type="button"
                  onClick={() => setFileSearch('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {searchResults ? (
                searchResults.length === 0 ? (
                  <p className="px-3 py-3 text-[11px] text-muted-foreground">
                    {t('searchNoResults')}
                  </p>
                ) : (
                  searchResults.map(({ path, inContent }) => (
                    <button
                      key={path}
                      type="button"
                      onClick={() => setActiveFile(path)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxMenu({ x: e.clientX, y: e.clientY, path, isDir: false })
                      }}
                      className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] transition-colors ${
                        activeFile === path
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                      }`}
                    >
                      <File className="size-3 shrink-0 text-sky-400/80" />
                      <span className="truncate font-mono">{path}</span>
                      {inContent && (
                        <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                          abc
                        </span>
                      )}
                    </button>
                  ))
                )
              ) : (
                <>
                  {(pendingOp?.kind === 'create-file' || pendingOp?.kind === 'create-folder') &&
                    pendingOp.parent === '' && (
                      <InlineNameInput
                        depth={0}
                        onCommit={(name) => {
                          const isDir = pendingOp.kind === 'create-folder'
                          setPendingOp(null)
                          handleCreate('', name, isDir)
                        }}
                        onCancel={() => setPendingOp(null)}
                      />
                    )}
                  <div key={collapseEpoch}>
                    {treeNodes.map((node) => (
                      <FileTreeNode
                        key={node.path}
                        node={node}
                        activeFile={activeFile}
                        onSelect={setActiveFile}
                        pendingOp={pendingOp}
                        setPendingOp={setPendingOp}
                        onCreate={handleCreate}
                        onRename={handleRename}
                        onDelete={handleDelete}
                        onContextMenu={handleTreeContextMenu}
                        defaultOpen={collapseEpoch === 0}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>
        )}

        {/* Main area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!hasFiles ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              {busy ? (
                <>
                  <Loader2 className="size-6 animate-spin" />
                  <p className="text-sm">{t('previewGenerating')}</p>
                </>
              ) : (
                <>
                  <Sparkles className="size-6" />
                  <p className="max-w-xs text-center text-sm text-pretty">
                    {t('ideModeEmpty')}
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col">
                {/* Code editor */}
                {showCode && (
                  <div className="flex min-h-0 flex-1">
                    <MonacoEditor
                      key={`editor-${editorEpoch}`}
                      height="100%"
                      language={monacoLanguage(activeFile)}
                      theme="vs-dark"
                      value={activeCode}
                      onChange={handleEditorChange}
                      path={activeFile}
                      options={{
                        fontSize: prefs?.editorFontSize ?? 12,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: (prefs?.editorWordWrap ?? true) ? 'on' : 'off',
                        lineNumbers: 'on',
                        renderLineHighlight: 'line',
                        tabSize: prefs?.editorTabSize ?? 2,
                        padding: { top: 8, bottom: 8 },
                      }}
                    />
                  </div>
                )}

                {/* Preview pane — kept MOUNTED (css-hidden on Code tab) so the
                    runtime stays warm and the console keeps streaming. */}
                <div className={`min-h-0 flex-1 flex-col ${showPreview ? 'flex' : 'hidden'}`}>
                  {/* Browser-style address bar */}
                  <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
                    <button
                      type="button"
                      disabled
                      aria-label="Back"
                      className="rounded p-1 text-muted-foreground/40"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled
                      aria-label="Forward"
                      className="rounded p-1 text-muted-foreground/40"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleManualReload}
                      aria-label="Reload preview"
                      className="rounded p-1 text-muted-foreground/70 hover:text-foreground transition-transform active:rotate-90 active:scale-90"
                    >
                      <RotateCw className="size-3.5" />
                    </button>

                    {/* Fake URL bar */}
                    <div className="mx-1 flex h-6 flex-1 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3">
                      <span className="size-1.5 rounded-full bg-emerald-500/70" />
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        localhost / {activeFile.startsWith('src/') ? 'preview' : activeFile}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setMobile((m) => !m)}
                      aria-label="Toggle mobile viewport"
                      className={`rounded p-1 transition-colors ${mobile ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'}`}
                    >
                      <MonitorSmartphone className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenNewTab}
                      aria-label="Open in new tab"
                      title={t('ideOpenNewTab')}
                      className="rounded p-1 text-muted-foreground/70 hover:text-foreground transition-transform active:scale-90"
                    >
                      <ExternalLink className="size-3.5" />
                    </button>
                  </div>

                  {/* Design mode hint */}
                  {tab === 'design' && (
                    <div className="flex shrink-0 items-center gap-2 border-b border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-[11px] text-foreground animate-in fade-in duration-200">
                      <MousePointerClick className="size-3.5 text-indigo-500" />
                      {t('ideDesignHint')}
                    </div>
                  )}

                  {/* Preview iframe */}
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-background p-0">
                    <iframe
                      key={reloadKey}
                      ref={iframeRef}
                      title="IDE Preview"
                      sandbox="allow-scripts"
                      srcDoc={srcDoc}
                      className={
                        mobile
                          ? 'my-3 h-[85%] w-[390px] max-w-full rounded-2xl border border-border shadow-lg'
                          : 'h-full w-full border-0'
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Console */}
              {consoleOpen && (
                <BottomPanel
                  entries={consoleEntries}
                  onClear={() => setConsoleEntries([])}
                  onSubmit={handleConsoleSubmit}
                  onClose={() => setConsoleOpen(false)}
                  onFix={onFixError}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* File context menu (right click) */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtxMenu(null)
            }}
          />
          <div
            className="fixed z-[81] w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: Math.min(ctxMenu.x, typeof window !== 'undefined' ? window.innerWidth - 220 : ctxMenu.x),
              top: Math.min(ctxMenu.y, typeof window !== 'undefined' ? window.innerHeight - 260 : ctxMenu.y),
            }}
          >
            {(() => {
              const item =
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-accent transition-colors'
              const close = () => setCtxMenu(null)
              if (ctxMenu.isDir) {
                return (
                  <>
                    <button type="button" className={item} onClick={() => { close(); setPendingOp({ kind: 'create-file', parent: ctxMenu.path }) }}>
                      <FilePlus className="size-3.5 text-muted-foreground" /> {t('ideNewFile')}
                    </button>
                    <button type="button" className={item} onClick={() => { close(); setPendingOp({ kind: 'create-folder', parent: ctxMenu.path }) }}>
                      <FolderPlus className="size-3.5 text-muted-foreground" /> {t('ideNewFolder')}
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button type="button" className={item} onClick={() => { close(); handleCopyPath(ctxMenu.path) }}>
                      <Copy className="size-3.5 text-muted-foreground" /> {t('ideCopyPath')}
                    </button>
                    <button type="button" className={item} onClick={() => { close(); setPendingOp({ kind: 'rename', path: ctxMenu.path, isDir: true }) }}>
                      <Pencil className="size-3.5 text-muted-foreground" /> {t('ideRename')}
                      <kbd className="ml-auto text-[9px] text-muted-foreground">F2</kbd>
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button type="button" className={`${item} text-destructive hover:bg-destructive/10`} onClick={() => { close(); handleDelete(ctxMenu.path, true) }}>
                      <Trash2 className="size-3.5" /> {t('ideDelete')}
                    </button>
                  </>
                )
              }
              return (
                <>
                  <button type="button" className={item} onClick={() => { close(); setActiveFile(ctxMenu.path); setTab('code') }}>
                    <File className="size-3.5 text-muted-foreground" /> {t('ideOpenFile')}
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button type="button" className={item} onClick={() => { close(); handleDuplicate(ctxMenu.path) }}>
                    <Copy className="size-3.5 text-muted-foreground" /> {t('ideDuplicate')}
                  </button>
                  <button type="button" className={item} onClick={() => { close(); handleCopyPath(ctxMenu.path) }}>
                    <Copy className="size-3.5 text-muted-foreground" /> {t('ideCopyPath')}
                  </button>
                  <button type="button" className={item} onClick={() => { close(); handleDownloadFile(ctxMenu.path) }}>
                    <Download className="size-3.5 text-muted-foreground" /> {t('ideDownloadFile')}
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button type="button" className={item} onClick={() => { close(); setPendingOp({ kind: 'rename', path: ctxMenu.path, isDir: false }) }}>
                    <Pencil className="size-3.5 text-muted-foreground" /> {t('ideRename')}
                    <kbd className="ml-auto text-[9px] text-muted-foreground">F2</kbd>
                  </button>
                  <button type="button" className={`${item} text-destructive hover:bg-destructive/10`} onClick={() => { close(); handleDelete(ctxMenu.path, false) }}>
                    <Trash2 className="size-3.5" /> {t('ideDelete')}
                  </button>
                </>
              )
            })()}
          </div>
        </>
      )}

      {/* Version history dropdown */}
      {historyOpen && (
        <div className="absolute right-3 top-14 z-40 w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <History className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">История версий</span>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="ml-auto rounded p-1 text-muted-foreground/70 hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="size-3" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {checkpoints === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : checkpoints.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Версий пока нет — они создаются после каждого ответа ИИ.
              </p>
            ) : (
              checkpoints.map((cp, i) => (
                <div
                  key={cp.id}
                  className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {i === 0 ? '● ' : ''}{cp.label || 'Изменения ИИ'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {timeAgo(cp.createdAt)} · {cp.fileCount} файл(ов)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openDiff(cp.id)}
                    className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    Diff
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestore(cp.id)}
                    disabled={restoring !== null}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-foreground hover:bg-accent active:scale-95 transition-all disabled:opacity-50"
                  >
                    {restoring === cp.id ? (
                      <Loader2 className="size-2.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-2.5" />
                    )}
                    Откатить
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Diff viewer modal: checkpoint snapshot vs current files */}
      {diffSnapshot && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/40 p-4 animate-in fade-in duration-150"
          onClick={() => setDiffSnapshot(null)}
        >
          <div
            className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
              <History className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">
                Сравнение версии с текущим состоянием
              </span>
              <span className="font-mono text-[11px] text-muted-foreground truncate">
                {diffPath}
              </span>
              <button
                type="button"
                onClick={() => setDiffSnapshot(null)}
                className="ml-auto rounded p-1 text-muted-foreground/70 hover:text-foreground"
                aria-label="Закрыть"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1">
              {/* Changed files list */}
              <aside className="w-52 shrink-0 overflow-y-auto border-r border-border py-2">
                {[...new Set([...Object.keys(diffSnapshot), ...localFiles.keys()])]
                  .sort()
                  .map((p) => {
                    const before = diffSnapshot[p]
                    const after = localFiles.get(p)
                    const status =
                      before === undefined ? '+' : after === undefined ? '−' : before !== after ? '±' : ''
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setDiffPath(p)}
                        className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] transition-colors ${
                          diffPath === p
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                        }`}
                      >
                        <span
                          className={`w-3 shrink-0 font-mono ${
                            status === '+'
                              ? 'text-emerald-500'
                              : status === '−'
                                ? 'text-red-500'
                                : status === '±'
                                  ? 'text-amber-500'
                                  : 'text-transparent'
                          }`}
                        >
                          {status || '·'}
                        </span>
                        <span className="truncate font-mono">{p}</span>
                      </button>
                    )
                  })}
              </aside>
              {/* Monaco side-by-side diff */}
              <div className="min-w-0 flex-1">
                {diffPath && (
                  <MonacoDiffEditor
                    key={`diff-${editorEpoch}`}
                    height="100%"
                    language={monacoLanguage(diffPath)}
                    theme="vs-dark"
                    original={diffSnapshot[diffPath] ?? ''}
                    modified={localFiles.get(diffPath) ?? ''}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        files={Object.fromEntries(localFiles)}
        projectName={displayName}
      />
    </section>
  )
}
