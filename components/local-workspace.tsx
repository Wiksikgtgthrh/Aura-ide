'use client'

/**
 * Локальный workspace — «Open Folder» как в VS Code, максимально доделанный.
 *
 * Что тут теперь есть:
 *   • файловое дерево с иконками, контекстным меню, inline-rename, F2/Del,
 *     drag/copy/cut/paste, реагирует на file-system watcher;
 *   • сплит-редактор (Monaco), Ctrl+S, Ctrl+W, Ctrl+P (Quick Open),
 *     Ctrl+Shift+P (Command Palette), Ctrl+Shift+F (Global Search),
 *     Ctrl+`, Ctrl+B (левый сайдбар), Ctrl+J (нижняя панель), Ctrl+Alt+A (AI);
 *   • Breadcrumbs над редактором;
 *   • PTY-терминал (xterm.js) вместо одноразовых команд;
 *   • панель Git (изменения, diff, коммит, push/pull/fetch, лог, ветки);
 *   • Live Preview (dev-сервер в iframe);
 *   • панель Problems (маркеры Monaco);
 *   • AI-панель справа (iframe на /chat/[id]);
 *   • сохранение сессии (последний проект, табы, раскрытые папки);
 *   • workspace settings (.aura/settings.json) + format-on-save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Bot,
  Command as CommandIcon,
  FolderOpen,
  GitBranch,
  Loader2,
  MonitorSmartphone,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  RefreshCw,
  Search,
  Settings,
  SquareTerminal,
  X,
  Split as SplitIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  isDesktop,
  pickFolder,
  fsTree,
  fsRead,
  fsWrite,
  gitStatus,
  onFsChanged,
  fsWatchStart,
  fsWatchStop,
  type FsNode,
  type GitStatusEntry,
} from '@/lib/tauri'
import { iconForFile } from '@/lib/file-icons'
import { FileTree } from '@/components/workspace/file-tree'
import { CommandPalette, type PaletteCommand } from '@/components/workspace/command-palette'
import { GlobalSearchPanel } from '@/components/workspace/global-search'
import { PtyTerminal, type PtyTerminalHandle } from '@/components/workspace/pty-terminal'
import { TerminalAiPopup } from '@/components/workspace/terminal-ai-popup'
import { GitPanel } from '@/components/workspace/git-panel'
import { PreviewPanel } from '@/components/workspace/preview-panel'
import { AiSidePanel, type AiActionPreset } from '@/components/workspace/ai-side-panel'
import { ProblemsPanel, subscribeMonacoMarkers, type ProblemsMarker } from '@/components/workspace/problems-panel'
import { Breadcrumbs } from '@/components/workspace/breadcrumbs'
import { SymbolOutline } from '@/components/workspace/symbol-outline'
import { loadSession, saveSession } from '@/lib/session-store'
import { loadWorkspaceSettings, saveWorkspaceSettings, type WorkspaceSettings } from '@/lib/workspace-settings'
import { runFormatter, shouldFormat } from '@/lib/format-on-save'
import { primeMonacoTsProject, registerAuraThemes, registerMonacoAi } from '@/lib/monaco-ai'
import { termRun } from '@/lib/tauri'
import { LspClient } from '@/lib/lsp-client'
import { bridgeMonacoToLsp } from '@/lib/monaco-lsp-bridge'
import {
  loadUserIdePlugins,
  makeBaseCtx,
  type CompiledPlugins,
  type PluginCtx,
} from '@/lib/plugin-runtime'
import * as LucideIcons from 'lucide-react'

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
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sql: 'sql',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    xml: 'xml',
    php: 'php',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
  }
  return map[ext] ?? 'plaintext'
}

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

// Плоский список путей файлов (для Quick Open) из дерева.
function flattenFiles(nodes: FsNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.is_dir) flattenFiles(n.children, out)
    else out.push(n.path)
  }
  return out
}

type BottomTab = 'terminal' | 'problems'
type LeftTab = 'files' | 'search' | 'git' | 'outline'
type ThemeName = 'aura-dark' | 'vs-dark' | 'vs' | 'hc-black' | 'aura-light'

// pickLucideIcon — по строке из манифеста ('Puzzle', 'GitBranch', ...)
// достаём иконку из lucide-react. Названия нечувствительны к регистру.
function pickLucideIcon(name?: string): any {
  if (!name) return null
  const key = name.charAt(0).toUpperCase() + name.slice(1)
  const set = LucideIcons as unknown as Record<string, any>
  return set[key] ?? set[name] ?? null
}

// --- Plugin inline completions provider -------------------------------------
// Регистрируется РАЗ — тянет живые провайдеры из ref, чтобы не пере-mount'ить
// Monaco при каждом обновлении списка плагинов.
function registerPluginCompletions(
  monaco: any,
  pluginsRef: React.MutableRefObject<CompiledPlugins>,
  makeCtx: () => PluginCtx,
) {
  monaco.languages.registerInlineCompletionsProvider(['*'], {
    freeInlineCompletions: () => {},
    provideInlineCompletions: async (model: any, position: any) => {
      const providers = pluginsRef.current.completions
      if (!providers.length) return { items: [] }
      const language = model.getLanguageId?.() ?? 'plaintext'
      const active = providers.filter(
        (p) => p.languages.includes('*') || p.languages.includes(language),
      )
      if (!active.length) return { items: [] }
      const path = model.uri?.fsPath ?? ''
      const start = Math.max(1, position.lineNumber - 30)
      const endLine = Math.min(model.getLineCount(), position.lineNumber + 30)
      const prefix = model.getValueInRange(
        new monaco.Range(start, 1, position.lineNumber, position.column),
      )
      const suffix = model.getValueInRange(
        new monaco.Range(position.lineNumber, position.column, endLine, model.getLineMaxColumn(endLine)),
      )
      const base = makeCtx()
      // Первый плагин, вернувший непустое, выигрывает — как в Copilot.
      for (const p of active) {
        try {
          const text = await p.provide({ ...base, prefix, suffix, language, path })
          if (typeof text === 'string' && text.length) {
            return {
              items: [
                {
                  insertText: text,
                  range: new monaco.Range(
                    position.lineNumber,
                    position.column,
                    position.lineNumber,
                    position.column,
                  ),
                },
              ],
            }
          }
        } catch {
          /* пропускаем ошибочный плагин, идём к следующему */
        }
      }
      return { items: [] }
    },
  })
}

export function LocalWorkspace({ root, onClose }: { root: string; onClose: () => void }) {
  // --- Основное состояние ---------------------------------------------------
  const [tree, setTree] = useState<FsNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root]))
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [contents, setContents] = useState<Map<string, string>>(new Map())
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [git, setGit] = useState<Map<string, string>>(new Map())
  const [saving, setSaving] = useState(false)

  // Панели
  const [leftTab, setLeftTab] = useState<LeftTab>('files')
  const [leftOpen, setLeftOpen] = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal')
  const [rightOpen, setRightOpen] = useState(false)
  const [rightTab, setRightTab] = useState<'ai' | 'preview'>('ai')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteMode, setPaletteMode] = useState<'files' | 'commands'>('files')

  // Split
  const [splitFile, setSplitFile] = useState<string | null>(null)
  const [splitContent, setSplitContent] = useState('')

  // Settings + problems
  const [settings, setSettings] = useState<WorkspaceSettings>({})
  const [markers, setMarkers] = useState<ProblemsMarker[]>([])
  const [showSettings, setShowSettings] = useState(false)

  // AI: препостав для панели (code-actions/ревью-diff кладут сюда input).
  const [aiPreset, setAiPreset] = useState<AiActionPreset | null>(null)

  // Тема редактора — переключается из палитры, кладётся в .aura/settings.json.
  const [themeName, setThemeName] = useState<ThemeName>('aura-dark')

  // AI-попап в терминале (Ctrl+K над PTY).
  const [aiTermOpen, setAiTermOpen] = useState(false)
  const ptyRef = useRef<PtyTerminalHandle>(null)

  // Плагины IDE.
  const [plugins, setPlugins] = useState<CompiledPlugins>({
    toolbarButtons: [],
    paletteCommands: [],
    completions: [],
  })
  const [notice, setNotice] = useState<{ text: string; kind: 'info' | 'warn' | 'error' } | null>(null)

  // LSP.
  const lspClientRef = useRef<LspClient | null>(null)
  const lspDisposerRef = useRef<(() => void) | null>(null)
  const [lspStatus, setLspStatus] = useState<'off' | 'starting' | 'ready' | 'error'>('off')
  const [lspError, setLspError] = useState<string | null>(null)

  // Refs — избегаем стейл-клоужеров в кнопках/шорткатах
  const contentRef = useRef(content)
  contentRef.current = content
  const activeRef = useRef(activeFile)
  activeRef.current = activeFile
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const monacoInstance = useRef<any>(null)

  // --- Refresh (файлы + git) -----------------------------------------------
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

  // Внешние изменения на диске: (a) refresh дерева/git, (b) auto-reload
  // открытого чистого файла, (c) баннер «файл изменился снаружи» для
  // грязного файла.
  const [externallyChanged, setExternallyChanged] = useState<string | null>(null)
  useEffect(() => {
    if (!isDesktop()) return
    let unlisten: (() => void) | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null
    ;(async () => {
      await fsWatchStart(root).catch(() => {})
      unlisten = await onFsChanged((ev) => {
        if (ev.root !== root) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => void refresh(), 250)
        // Для каждого затронутого файла — если он открыт в табе, тянем его.
        for (const p of ev.paths) {
          if (!openTabs.includes(p)) continue
          if (dirtyRef.current.has(p)) {
            // грязный файл — только предупреждаем.
            if (p === activeRef.current) setExternallyChanged(p)
            continue
          }
          // чистый — молча перечитываем.
          fsRead(p)
            .then((fresh) => {
              setContents((prev) => new Map(prev).set(p, fresh))
              if (p === activeRef.current) setContent(fresh)
            })
            .catch(() => {})
        }
      })
    })()
    return () => {
      unlisten?.()
      void fsWatchStop(root).catch(() => {})
      if (debounce) clearTimeout(debounce)
    }
  }, [root, refresh, openTabs])

  // Загрузить настройки проекта.
  useEffect(() => {
    ;(async () => {
      const s = await loadWorkspaceSettings(root)
      setSettings(s)
      const t = (s as any)?.editor?.theme as ThemeName | undefined
      if (t) setThemeName(t)
    })()
  }, [root])

  // Загрузить плагины пользователя (server action). Не блокирует IDE.
  useEffect(() => {
    let cancelled = false
    loadUserIdePlugins()
      .then((p) => {
        if (!cancelled) setPlugins(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Восстановить сессию: раскрытые папки + табы + активный файл.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    const s = loadSession()
    if (s && s.root === root) {
      restoredRef.current = true
      setExpanded(new Set([root, ...s.expandedDirs]))
      setOpenTabs(s.openTabs)
      if (s.activeFile) void openFileByPath(s.activeFile)
    } else {
      restoredRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  // Автосохранение сессии при значимых изменениях.
  useEffect(() => {
    const t = setTimeout(() => {
      saveSession({
        root,
        openTabs,
        activeFile,
        expandedDirs: Array.from(expanded).filter((p) => p !== root),
        updatedAt: Date.now(),
      })
    }, 400)
    return () => clearTimeout(t)
  }, [root, openTabs, activeFile, expanded])

  // --- Открытие файлов ------------------------------------------------------
  const openFileByPath = useCallback(async (path: string, line?: number, column?: number) => {
    const cached = contents.get(path)
    const text = cached ?? (await fsRead(path).catch(() => ''))
    setContents((prev) => (prev.has(path) ? prev : new Map(prev).set(path, text)))
    setOpenTabs((t) => (t.includes(path) ? t : [...t, path]))
    setActiveFile(path)
    setContent(text)
    // Прыжок к строке, когда Monaco смонтируется, — через микротаск.
    if (line != null) {
      requestAnimationFrame(() => {
        try {
          const m = monacoInstance.current
          const editor = m?.editor?.getEditors?.()?.[0]
          editor?.revealLineInCenter?.(line)
          editor?.setPosition?.({ lineNumber: line, column: column ?? 1 })
          editor?.focus?.()
        } catch {
          /* mount race */
        }
      })
    }
  }, [contents])

  const openNode = useCallback(
    (n: FsNode) => {
      if (n.is_dir) return
      void openFileByPath(n.path)
    },
    [openFileByPath],
  )

  const switchTab = useCallback(
    async (path: string) => {
      const cached = contents.get(path)
      const text = cached ?? (await fsRead(path).catch(() => ''))
      setContents((prev) => (prev.has(path) ? prev : new Map(prev).set(path, text)))
      setActiveFile(path)
      setContent(text)
    },
    [contents],
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
          }
        }
        return next
      })
      setDirty((s) => {
        const n = new Set(s)
        n.delete(path)
        return n
      })
      setContents((prev) => {
        const n = new Map(prev)
        n.delete(path)
        return n
      })
    },
    [switchTab],
  )

  // --- Сохранение + formatter-on-save --------------------------------------
  const save = useCallback(async () => {
    const f = activeRef.current
    if (!f || !dirtyRef.current.has(f)) return
    setSaving(true)
    try {
      await fsWrite(f, contentRef.current)
      // format-on-save
      const s = settingsRef.current
      if (shouldFormat(s, f) && s.format?.command) {
        try {
          await runFormatter(root, s.format.command, f)
          const fresh = await fsRead(f).catch(() => contentRef.current)
          setContent(fresh)
          setContents((prev) => new Map(prev).set(f, fresh))
        } catch {
          /* тихо — форматтер не критичен для UX */
        }
      }
      setDirty((s) => {
        const n = new Set(s)
        n.delete(f)
        return n
      })
    } finally {
      setSaving(false)
    }
  }, [root])

  // --- Toggle раскрытия -----------------------------------------------------
  const toggleDir = useCallback((path: string) => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })
  }, [])

  // --- Список файлов для Quick Open ----------------------------------------
  const allFiles = useMemo(() => flattenFiles(tree), [tree])

  // Общий контекст для плагинов. Строим лениво, чтобы всегда видеть
  // самое свежее состояние (активный файл, буфер).
  const makePluginCtx = useCallback((): PluginCtx => {
    return makeBaseCtx(root, {
      openFile: (p, line, column) => void openFileByPath(p, line, column),
      showMessage: (text, kind = 'info') => setNotice({ text, kind }),
      getActiveFile: () => activeRef.current,
      getActiveText: () => contentRef.current,
      setActiveText: (text) => {
        const f = activeRef.current
        if (!f) return
        setContent(text)
        setContents((prev) => new Map(prev).set(f, text))
        setDirty((s) => new Set(s).add(f))
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  // Обёртка для action-провайдера Monaco: открывает AI-панель с preset'ом.
  const runAiAction = useCallback(
    (payload: { action: any; code: string; language: string; path?: string }) => {
      setAiPreset({
        action: payload.action,
        input: payload.code,
        language: payload.language,
        path: payload.path,
      })
      setRightOpen(true)
      setRightTab('ai')
    },
    [],
  )

  // При появлении Monaco: темы, AI-провайдеры, TS-IntelliSense, LSP,
  // plugin-completions.
  const primeMonaco = useCallback(
    async (monaco: any) => {
      monacoInstance.current = monaco
      try {
        registerAuraThemes(monaco)
      } catch {
        /* ignore */
      }
      // AI inline completions + code actions.
      registerMonacoAi(monaco, {
        isInlineEnabled: () =>
          (settingsRef.current as any)?.ai?.inlineCompletions !== false,
        onRunAction: runAiAction,
      })
      // Plugin-completions — свой inlineCompletionsProvider поверх ['*'].
      registerPluginCompletions(monaco, pluginsRef, makePluginCtx)
      // TS проектные типы через lightweight extraLibs — работает всегда,
      // даже без внешнего LSP.
      try {
        await primeMonacoTsProject(
          monaco,
          allFilesRef.current,
          (p) => fsRead(p),
          root,
        )
      } catch {
        /* тихо */
      }
      // Полноценный LSP (typescript-language-server) — по флагу в settings.
      const lspEnabled = (settingsRef.current as any)?.lsp?.enabled === true
      if (lspEnabled && isDesktop() && !lspClientRef.current) {
        setLspStatus('starting')
        try {
          const client = new LspClient(root)
          lspClientRef.current = client
          await client.start((settingsRef.current as any)?.lsp?.command)
          lspDisposerRef.current = bridgeMonacoToLsp(monaco, client)
          setLspStatus('ready')
        } catch (e) {
          setLspStatus('error')
          setLspError((e as Error).message)
          lspClientRef.current = null
        }
      }
    },
    [root, runAiAction, makePluginCtx],
  )

  // Держим свежий список плагинов в ref — Monaco инициализируется раньше,
  // чем данные плагинов доедут.
  const pluginsRef = useRef<CompiledPlugins>({
    toolbarButtons: [],
    paletteCommands: [],
    completions: [],
  })
  pluginsRef.current = plugins

  // Выключение LSP при размонтировании / смене проекта.
  useEffect(() => {
    return () => {
      lspDisposerRef.current?.()
      lspDisposerRef.current = null
      lspClientRef.current?.shutdown().catch(() => {})
      lspClientRef.current = null
    }
  }, [root])

  const allFilesRef = useRef<string[]>([])
  allFilesRef.current = allFiles

  // --- Palette commands ----------------------------------------------------
  const commands: PaletteCommand[] = useMemo(
    () => [
      {
        id: 'toggle-left',
        title: 'Вид: переключить сайдбар',
        hint: 'Ctrl+B',
        run: () => setLeftOpen((v) => !v),
      },
      {
        id: 'toggle-bottom',
        title: 'Вид: переключить нижнюю панель',
        hint: 'Ctrl+J',
        run: () => setBottomOpen((v) => !v),
      },
      {
        id: 'toggle-right',
        title: 'Вид: переключить AI-панель',
        hint: 'Ctrl+Alt+A',
        run: () => {
          setRightOpen((v) => !v)
          setRightTab('ai')
        },
      },
      {
        id: 'toggle-preview',
        title: 'Вид: переключить Live Preview',
        run: () => {
          setRightOpen(true)
          setRightTab('preview')
        },
      },
      { id: 'terminal', title: 'Терминал: показать/скрыть', hint: 'Ctrl+`', run: () => setBottomOpen((v) => !v) },
      { id: 'search', title: 'Поиск: по всему проекту', hint: 'Ctrl+Shift+F', run: () => { setLeftOpen(true); setLeftTab('search') } },
      { id: 'git', title: 'Git: панель изменений', run: () => { setLeftOpen(true); setLeftTab('git') } },
      { id: 'refresh', title: 'Файлы: обновить дерево', run: () => void refresh() },
      { id: 'settings', title: 'Настройки проекта…', run: () => setShowSettings(true) },
      {
        id: 'split',
        title: 'Редактор: разделить',
        run: () => activeFile && setSplitFile(activeFile),
      },
      {
        id: 'outline',
        title: 'Вид: структура файла',
        run: () => {
          setLeftOpen(true)
          setLeftTab('outline')
        },
      },
      {
        id: 'save',
        title: 'Файл: сохранить',
        hint: 'Ctrl+S',
        run: () => void save(),
      },
      {
        id: 'ai-toggle-inline',
        title: `AI: ${
          (settings as any)?.ai?.inlineCompletions === false ? 'включить' : 'выключить'
        } ghost-text`,
        run: async () => {
          const next = {
            ...settings,
            ai: {
              ...((settings as any).ai ?? {}),
              inlineCompletions: !((settings as any)?.ai?.inlineCompletions !== false),
            },
          }
          setSettings(next)
          await saveWorkspaceSettings(root, next).catch(() => {})
        },
      },
      {
        id: 'ai-terminal',
        title: 'AI: команда в терминале (Ctrl+K)',
        hint: 'Ctrl+K',
        run: () => {
          setBottomOpen(true)
          setBottomTab('terminal')
          setAiTermOpen(true)
        },
      },
      {
        id: 'close-folder',
        title: 'Файл: закрыть папку',
        run: onClose,
      },
      // Темы редактора — конкретный выбор.
      ...(['aura-dark', 'vs-dark', 'vs', 'aura-light', 'hc-black'] as ThemeName[]).map(
        (t) => ({
          id: `theme-${t}`,
          title: `Тема: ${t}`,
          run: async () => {
            setThemeName(t)
            const next = {
              ...settings,
              editor: { ...settings.editor, theme: t } as any,
            }
            setSettings(next)
            await saveWorkspaceSettings(root, next).catch(() => {})
          },
        }),
      ),
      // Задачи из .aura/settings.json — запускаются в реальном PTY, если открыт.
      ...(settings.tasks ?? []).map((t, i) => ({
        id: `task-${i}`,
        title: `Задача: ${t.label}`,
        run: () => {
          setBottomOpen(true)
          setBottomTab('terminal')
          // Если PTY активен — вставляем и выполняем прямо в нём.
          if (ptyRef.current) {
            ptyRef.current.insertText(t.command, true)
            return
          }
          // Фолбэк — одноразовый термналран (без интерактива).
          void termRun(`task-${i}-${Date.now()}`, root, t.command).catch(() => {})
        },
      })),
      // Плагин-команды — добавляются в палитру с префиксом slug.
      ...plugins.paletteCommands.map((c) => ({
        id: `plugin-${c.pluginSlug}-${c.id}`,
        title: c.title,
        hint: c.hint,
        keywords: `${c.keywords ?? ''} plugin ${c.pluginSlug}`,
        run: () => {
          try {
            c.run(makePluginCtx())
          } catch (e) {
            setNotice({ text: `Плагин ${c.pluginSlug}: ${(e as Error).message}`, kind: 'error' })
          }
        },
      })),
    ],
    [refresh, save, onClose, activeFile, settings, root, plugins, makePluginCtx],
  )

  // --- Глобальные шорткаты --------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteMode('commands')
        setPaletteOpen(true)
      } else if (meta && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPaletteMode('files')
        setPaletteOpen(true)
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setLeftOpen(true)
        setLeftTab('search')
      } else if (meta && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setLeftOpen((v) => !v)
      } else if (meta && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setBottomOpen((v) => !v)
      } else if (meta && e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setRightOpen((v) => !v)
        setRightTab('ai')
      } else if (meta && e.key === '`') {
        e.preventDefault()
        setBottomOpen((v) => !v)
        setBottomTab('terminal')
      } else if (meta && e.key.toLowerCase() === 'k') {
        // Ctrl+K — AI-подсказка. Если открыт терминал — попап над PTY,
        // иначе — Command Palette с готовой префикс-подсказкой (?? ).
        e.preventDefault()
        if (bottomOpen && bottomTab === 'terminal') setAiTermOpen(true)
        else {
          setBottomOpen(true)
          setBottomTab('terminal')
          setAiTermOpen(true)
        }
      } else if (meta && e.key.toLowerCase() === 'w') {
        if (activeRef.current) {
          e.preventDefault()
          closeTab(activeRef.current)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [save, closeTab, bottomOpen, bottomTab])

  // --- Split-контент --------------------------------------------------------
  useEffect(() => {
    if (!splitFile) {
      setSplitContent('')
      return
    }
    fsRead(splitFile)
      .then(setSplitContent)
      .catch(() => setSplitContent(''))
  }, [splitFile])

  // --- Render ---------------------------------------------------------------
  const folderLabel = useMemo(() => baseName(root), [root])

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Верхняя панель */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <FolderOpen className="size-4 text-primary" />
        <span className="truncate text-sm font-medium">{folderLabel}</span>
        <span className="truncate text-xs text-muted-foreground">{root}</span>
        <div className="ml-auto flex items-center gap-1">
          {lspStatus !== 'off' && (
            <span
              title={
                lspStatus === 'ready'
                  ? 'LSP: typescript-language-server готов'
                  : lspStatus === 'starting'
                    ? 'LSP: запуск…'
                    : `LSP ошибка: ${lspError ?? '—'}`
              }
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                lspStatus === 'ready'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : lspStatus === 'starting'
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-red-500/10 text-red-400'
              }`}
            >
              LSP {lspStatus === 'ready' ? '✓' : lspStatus === 'starting' ? '…' : '×'}
            </span>
          )}
          {/* Плагин-кнопки в тулбаре */}
          {plugins.toolbarButtons.map((b) => {
            const Icon = pickLucideIcon(b.icon)
            return (
              <Button
                key={`${b.pluginSlug}-${b.id}`}
                variant="ghost"
                size="icon"
                className="size-7"
                title={`${b.title} (${b.pluginSlug})`}
                onClick={() => {
                  try {
                    b.run(makePluginCtx())
                  } catch (e) {
                    setNotice({ text: `Плагин ${b.pluginSlug}: ${(e as Error).message}`, kind: 'error' })
                  }
                }}
              >
                {Icon ? (
                  <Icon className="size-3.5" />
                ) : (
                  <span className="text-[10px] font-semibold">{b.title[0]?.toUpperCase() ?? '?'}</span>
                )}
              </Button>
            )
          })}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Command Palette (Ctrl+Shift+P)"
            onClick={() => {
              setPaletteMode('commands')
              setPaletteOpen(true)
            }}
          >
            <CommandIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Обновить"
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Сайдбар (Ctrl+B)"
            onClick={() => setLeftOpen((v) => !v)}
          >
            <PanelLeft className={`size-3.5 ${leftOpen ? 'text-primary' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Нижняя панель (Ctrl+J)"
            onClick={() => setBottomOpen((v) => !v)}
          >
            <PanelBottom className={`size-3.5 ${bottomOpen ? 'text-primary' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="AI-панель (Ctrl+Alt+A)"
            onClick={() => {
              setRightOpen((v) => !v || rightTab !== 'ai')
              setRightTab('ai')
            }}
          >
            <Bot className={`size-3.5 ${rightOpen && rightTab === 'ai' ? 'text-primary' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Live Preview"
            onClick={() => {
              setRightOpen(true)
              setRightTab('preview')
            }}
          >
            <MonitorSmartphone className={`size-3.5 ${rightOpen && rightTab === 'preview' ? 'text-primary' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Настройки проекта"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" title="Закрыть папку" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Левый сайдбар */}
        {leftOpen && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-border">
            <div className="flex items-center gap-0.5 border-b border-border px-1 py-1 text-xs">
              <SidebarTab
                icon={<FolderOpen className="size-3.5" />}
                label="Файлы"
                active={leftTab === 'files'}
                onClick={() => setLeftTab('files')}
              />
              <SidebarTab
                icon={<Search className="size-3.5" />}
                label="Поиск"
                active={leftTab === 'search'}
                onClick={() => setLeftTab('search')}
              />
              <SidebarTab
                icon={<GitBranch className="size-3.5" />}
                label="Git"
                active={leftTab === 'git'}
                onClick={() => setLeftTab('git')}
              />
              <SidebarTab
                icon={<CommandIcon className="size-3.5" />}
                label="Outline"
                active={leftTab === 'outline'}
                onClick={() => setLeftTab('outline')}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {leftTab === 'files' && (
                <div className="h-full overflow-y-auto px-1 py-1">
                  <FileTree
                    tree={tree}
                    root={root}
                    git={git}
                    expanded={expanded}
                    active={activeFile}
                    onToggle={toggleDir}
                    onOpen={openNode}
                    onChanged={refresh}
                    onMoved={(from, to) => {
                      // Обновляем состояние табов и активного файла — путь перемещённого файла изменился.
                      setOpenTabs((tabs) => tabs.map((p) => (p === from ? to : p)))
                      setContents((prev) => {
                        if (!prev.has(from)) return prev
                        const n = new Map(prev)
                        n.set(to, n.get(from)!)
                        n.delete(from)
                        return n
                      })
                      setDirty((s) => {
                        if (!s.has(from)) return s
                        const n = new Set(s)
                        n.delete(from)
                        n.add(to)
                        return n
                      })
                      if (activeRef.current === from) setActiveFile(to)
                    }}
                  />
                  {tree.length === 0 && (
                    <p className="px-2 py-3 text-xs text-muted-foreground">Папка пуста</p>
                  )}
                </div>
              )}
              {leftTab === 'search' && (
                <GlobalSearchPanel
                  root={root}
                  onOpenFile={(p, l, c) => void openFileByPath(p, l, c)}
                />
              )}
              {leftTab === 'git' && (
                <GitPanel
                  root={root}
                  onOpenFile={(p) => void openFileByPath(p)}
                  onOpenAiReview={(diff) => {
                    setAiPreset({
                      action: 'diff-review',
                      input: diff,
                      title: 'AI Review · git diff',
                    })
                    setRightOpen(true)
                    setRightTab('ai')
                  }}
                />
              )}
              {leftTab === 'outline' && (
                <SymbolOutline
                  monaco={monacoInstance.current}
                  activeFile={activeFile}
                  onGoto={(line, column) => {
                    const editor = monacoInstance.current?.editor?.getEditors?.()?.[0]
                    editor?.revealLineInCenter?.(line)
                    editor?.setPosition?.({ lineNumber: line, column })
                    editor?.focus?.()
                  }}
                />
              )}
            </div>
          </aside>
        )}

        {/* Центральная область */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* Вкладки */}
          {openTabs.length > 0 && (
            <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border">
              {openTabs.map((p) => {
                const spec = iconForFile(baseName(p))
                const isDirty = dirty.has(p)
                return (
                  <div
                    key={p}
                    className={`group flex items-center gap-1 border-r border-border px-3 text-xs ${
                      activeFile === p
                        ? 'bg-background text-foreground'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <button
                      type="button"
                      className="flex items-center gap-1.5"
                      onClick={() => void switchTab(p)}
                    >
                      <spec.Icon className={`size-3 ${spec.className}`} />
                      {baseName(p)}
                      {isDirty && <span className="size-1.5 rounded-full bg-primary" title="Не сохранено" />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSplitFile(p)
                      }}
                      className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
                      title="Открыть рядом"
                    >
                      <SplitIcon className="size-3" />
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
                )
              })}
            </div>
          )}

          {/* Breadcrumbs */}
          {activeFile && <Breadcrumbs root={root} file={activeFile} />}

          {/* Баннер: файл изменился снаружи, а в буфере — несохранённые правки */}
          {externallyChanged && activeFile === externallyChanged && (
            <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300">
              <span>Файл изменился на диске, но у вас есть несохранённые правки.</span>
              <button
                type="button"
                className="ml-auto rounded bg-amber-500/20 px-2 py-0.5 hover:bg-amber-500/30"
                onClick={async () => {
                  const fresh = await fsRead(externallyChanged).catch(() => null)
                  if (fresh != null) {
                    setContent(fresh)
                    setContents((prev) => new Map(prev).set(externallyChanged, fresh))
                    setDirty((s) => {
                      const n = new Set(s)
                      n.delete(externallyChanged)
                      return n
                    })
                  }
                  setExternallyChanged(null)
                }}
              >
                Перезагрузить с диска
              </button>
              <button
                type="button"
                className="rounded border border-amber-500/30 px-2 py-0.5 hover:bg-amber-500/10"
                onClick={() => setExternallyChanged(null)}
              >
                Оставить моё
              </button>
            </div>
          )}

          {/* Редактор + split */}
      {notice && (
        <div
          className={`flex items-center gap-2 border-b border-border px-3 py-1 text-xs ${
            notice.kind === 'error'
              ? 'bg-red-500/10 text-red-400'
              : notice.kind === 'warn'
                ? 'bg-amber-500/10 text-amber-300'
                : 'bg-emerald-500/10 text-emerald-300'
          }`}
        >
          <span className="truncate">{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-auto rounded p-0.5 hover:bg-accent"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1">
              {activeFile ? (
                <MonacoEditor
                  path={activeFile}
                  language={monacoLanguage(activeFile)}
                  value={content}
                  onMount={(_editor, monaco) => {
                    void primeMonaco(monaco)
                    subscribeMonacoMarkers(monaco, setMarkers)
                  }}
                  onChange={(v) => {
                    setContent(v ?? '')
                    setContents((prev) => new Map(prev).set(activeFile, v ?? ''))
                    setDirty((s) => new Set(s).add(activeFile))
                  }}
                  theme={themeName}
                  options={{
                    minimap: { enabled: false },
                    fontSize: settings.editor?.fontSize ?? 13,
                    tabSize: settings.editor?.tabSize ?? 2,
                    insertSpaces: settings.editor?.insertSpaces ?? true,
                    wordWrap: settings.editor?.wordWrap ?? 'off',
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    inlineSuggest: { enabled: true },
                  }}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <FolderOpen className="size-8 opacity-40" />
                  <p className="text-sm">Выбери файл в проводнике слева</p>
                  <p className="text-xs">
                    Ctrl+P — быстрый поиск файла · Ctrl+Shift+P — команды · Ctrl+` — терминал
                  </p>
                </div>
              )}
            </div>
            {splitFile && (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border">
                <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border/50 bg-muted/30 px-2 text-[11px]">
                  <span className="truncate">{baseName(splitFile)}</span>
                  <button
                    type="button"
                    className="ml-auto rounded p-0.5 hover:bg-accent"
                    onClick={() => setSplitFile(null)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <MonacoEditor
                    path={splitFile}
                    language={monacoLanguage(splitFile)}
                    value={splitContent}
                    onChange={(v) => setSplitContent(v ?? '')}
                    theme={themeName}
                    options={{
                      minimap: { enabled: false },
                      fontSize: settings.editor?.fontSize ?? 13,
                      automaticLayout: true,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Нижняя панель */}
          {bottomOpen && (
            <div className="flex h-64 shrink-0 flex-col border-t border-border">
              <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2 text-xs">
                <button
                  type="button"
                  onClick={() => setBottomTab('terminal')}
                  className={`flex items-center gap-1 rounded px-2 py-1 ${
                    bottomTab === 'terminal' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                  }`}
                >
                  <SquareTerminal className="size-3" /> Терминал
                </button>
                <button
                  type="button"
                  onClick={() => setBottomTab('problems')}
                  className={`flex items-center gap-1 rounded px-2 py-1 ${
                    bottomTab === 'problems' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                  }`}
                >
                  Проблемы
                  {markers.length > 0 && (
                    <span className="rounded bg-red-500/20 px-1.5 text-[10px] text-red-400">
                      {markers.length}
                    </span>
                  )}
                </button>
                <div className="ml-auto flex items-center gap-1">
                  {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                  <button
                    type="button"
                    className="rounded p-1 hover:bg-accent"
                    onClick={() => setBottomOpen(false)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
              <div className="relative min-h-0 flex-1">
                {bottomTab === 'terminal' && (
                  <>
                    <PtyTerminal ref={ptyRef} id={`pty:${root}`} cwd={root} />
                    {aiTermOpen && (
                      <TerminalAiPopup
                        onClose={() => setAiTermOpen(false)}
                        os={typeof navigator !== 'undefined' ? navigator.platform : 'unix'}
                        onInsert={(cmd, submit) => ptyRef.current?.insertText(cmd, submit)}
                      />
                    )}
                  </>
                )}
                {bottomTab === 'problems' && (
                  <ProblemsPanel
                    markers={markers}
                    onOpen={(f, l, c) => void openFileByPath(f, l, c)}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {/* Правая панель — AI / Preview */}
        {rightOpen && (
          <aside className="flex w-[420px] shrink-0 flex-col border-l border-border">
            <div className="flex items-center gap-1 border-b border-border px-2 py-1 text-xs">
              <SidebarTab
                icon={<Bot className="size-3.5" />}
                label="AI"
                active={rightTab === 'ai'}
                onClick={() => setRightTab('ai')}
              />
              <SidebarTab
                icon={<Play className="size-3.5" />}
                label="Preview"
                active={rightTab === 'preview'}
                onClick={() => setRightTab('preview')}
              />
              <button
                type="button"
                onClick={() => setRightOpen(false)}
                className="ml-auto rounded p-1 hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {rightTab === 'ai' && (
                <AiSidePanel
                  activeFile={activeFile}
                  onClose={() => setRightOpen(false)}
                  preset={aiPreset}
                  onConsumePreset={() => setAiPreset(null)}
                  onApplyCode={(code) => {
                    if (!activeFile) return
                    setContent(code)
                    setContents((prev) => new Map(prev).set(activeFile, code))
                    setDirty((s) => new Set(s).add(activeFile))
                  }}
                />
              )}
              {rightTab === 'preview' && <PreviewPanel root={root} />}
            </div>
          </aside>
        )}
      </div>

      {showSettings && (
        <SettingsDialog
          root={root}
          initial={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (s) => {
            await saveWorkspaceSettings(root, s).catch(() => {})
            setSettings(s)
            setShowSettings(false)
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        files={allFiles}
        onOpenFile={(p) => void openFileByPath(p)}
        initialMode={paletteMode}
      />
    </div>
  )
}

function SidebarTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 ${
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function SettingsDialog({
  root: _root,
  initial,
  onClose,
  onSave,
}: {
  root: string
  initial: WorkspaceSettings
  onClose: () => void
  onSave: (s: WorkspaceSettings) => Promise<void>
}) {
  const [s, setS] = useState<WorkspaceSettings>(initial)
  return (
    <div
      className="fixed inset-0 z-[900] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-popover p-4 text-sm">
        <div className="mb-3 flex items-center gap-2">
          <Settings className="size-4" />
          <h2 className="font-medium">Настройки проекта</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Размер табуляции</label>
            <input
              type="number"
              value={s.editor?.tabSize ?? 2}
              onChange={(e) =>
                setS((v) => ({ ...v, editor: { ...v.editor, tabSize: Number(e.target.value) } }))
              }
              className="h-8 w-24 rounded border border-border bg-background px-2 outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Размер шрифта</label>
            <input
              type="number"
              value={s.editor?.fontSize ?? 13}
              onChange={(e) =>
                setS((v) => ({ ...v, editor: { ...v.editor, fontSize: Number(e.target.value) } }))
              }
              className="h-8 w-24 rounded border border-border bg-background px-2 outline-none"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={s.editor?.wordWrap === 'on'}
                onChange={(e) =>
                  setS((v) => ({
                    ...v,
                    editor: { ...v.editor, wordWrap: e.target.checked ? 'on' : 'off' },
                  }))
                }
              />
              Перенос строк (word wrap)
            </label>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Тема</label>
            <select
              value={(s.editor as any)?.theme ?? 'aura-dark'}
              onChange={(e) =>
                setS((v) => ({
                  ...v,
                  editor: { ...v.editor, theme: e.target.value } as any,
                }))
              }
              className="h-8 w-48 rounded border border-border bg-background px-2 text-xs outline-none"
            >
              <option value="aura-dark">Aura Dark</option>
              <option value="vs-dark">VS Dark</option>
              <option value="vs">VS Light</option>
              <option value="aura-light">Aura Light</option>
              <option value="hc-black">High Contrast</option>
            </select>
          </div>
          <div className="rounded border border-border p-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={(s as any).ai?.inlineCompletions !== false}
                onChange={(e) =>
                  setS((v) => ({
                    ...v,
                    ai: { ...(v as any).ai, inlineCompletions: e.target.checked },
                  }))
                }
              />
              AI inline completions (Copilot-подобный ghost text)
            </label>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Использует ваш активный API-ключ; каждая пауза при вводе — короткий
              non-streaming запрос.
            </p>
          </div>
          <div className="rounded border border-border p-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={(s as any).lsp?.enabled === true}
                onChange={(e) =>
                  setS((v) => ({
                    ...v,
                    lsp: { ...(v as any).lsp, enabled: e.target.checked },
                  }))
                }
              />
              Полноценный TypeScript LSP (typescript-language-server)
            </label>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Даёт Find All References, Rename Symbol и точные диагностики
              всего проекта. Требует установленного сервера:{' '}
              <code className="rounded bg-muted px-1 py-0.5">npm i -g typescript typescript-language-server</code>.
              После включения — переоткройте папку.
            </p>
            <input
              value={(s as any).lsp?.command ?? ''}
              onChange={(e) =>
                setS((v) => ({
                  ...v,
                  lsp: { ...(v as any).lsp, command: e.target.value },
                }))
              }
              placeholder="кастомная команда (по умолчанию: typescript-language-server)"
              className="mt-2 h-8 w-full rounded border border-border bg-background px-2 text-[11px] outline-none"
            />
          </div>
          <div className="rounded border border-border p-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={s.format?.onSave ?? false}
                onChange={(e) =>
                  setS((v) => ({ ...v, format: { ...v.format, onSave: e.target.checked } }))
                }
              />
              Форматировать при сохранении (Ctrl+S)
            </label>
            <input
              value={s.format?.command ?? ''}
              onChange={(e) => setS((v) => ({ ...v, format: { ...v.format, command: e.target.value } }))}
              placeholder="prettier --write {file}"
              className="mt-2 h-8 w-full rounded border border-border bg-background px-2 text-xs outline-none"
            />
            <input
              value={(s.format?.extensions ?? []).join(',')}
              onChange={(e) =>
                setS((v) => ({
                  ...v,
                  format: {
                    ...v.format,
                    extensions: e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                }))
              }
              placeholder="ts,tsx,js,jsx (пусто = все)"
              className="mt-2 h-8 w-full rounded border border-border bg-background px-2 text-xs outline-none"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-xs hover:bg-accent"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void onSave(s)}
            className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          >
            Сохранить в .aura/settings.json
          </button>
        </div>
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
