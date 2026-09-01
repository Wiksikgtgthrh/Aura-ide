'use client'

/**
 * Регистрирует Monaco-провайдеры: inline completions (ghost text как Copilot)
 * и code actions (лампочка / контекстное меню).
 *
 * Все три активатора работают через один и тот же lifetime: возвращаем
 * `dispose()`, который снимает все подписки — вызывается при размонтировании
 * IDE, чтобы не плодить дубли при HMR.
 */

import { inlineComplete } from '@/lib/ai-client'

type AiActionRunner = (args: {
  action: 'explain' | 'refactor' | 'tests' | 'fix' | 'docs'
  code: string
  language: string
  path?: string
}) => void

export type MonacoAiOptions = {
  /** Читать из хранилища/настроек — включён ли ghost-text. */
  isInlineEnabled: () => boolean
  /** Что делать по клику на code action (обычно — открыть AI-панель). */
  onRunAction: AiActionRunner
}

export function registerMonacoAi(monaco: any, options: MonacoAiOptions): () => void {
  const disposables: { dispose(): void }[] = []

  // ---- Inline completions (ghost text) -------------------------------------
  const provider = {
    // Monaco зовёт handleItemDidShow/free — реализуем no-op, чтобы не ругался.
    freeInlineCompletions: () => {},
    // Основной вызов: возвращаем completions на каждую паузу пользователя.
    // Дебаунсим на клиенте — Monaco сам гасит частые запросы через
    // trigger=Automatic, но подстрахуемся через AbortController.
    provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
      if (!options.isInlineEnabled()) return { items: [] }
      const path = model.uri?.fsPath ?? model.uri?.toString?.() ?? ''
      const language = model.getLanguageId?.() ?? 'plaintext'

      // ±30 строк вокруг курсора — достаточно для локальной осмысленности,
      // не перегружает модель.
      const start = Math.max(1, position.lineNumber - 30)
      const endLine = Math.min(model.getLineCount(), position.lineNumber + 30)
      const prefixRange = new monaco.Range(start, 1, position.lineNumber, position.column)
      const suffixRange = new monaco.Range(
        position.lineNumber,
        position.column,
        endLine,
        model.getLineMaxColumn(endLine),
      )
      const prefix = model.getValueInRange(prefixRange)
      const suffix = model.getValueInRange(suffixRange)

      // Пустой префикс — ни в коем случае не спамим (пустой файл, начало ввода).
      if (prefix.trim().length < 3) return { items: [] }

      const controller = new AbortController()
      // Токен отмены от Monaco — прокидываем в fetch.
      token?.onCancellationRequested?.(() => controller.abort())

      const { completion } = await inlineComplete({
        prefix,
        suffix,
        language,
        path,
        signal: controller.signal,
      })
      if (!completion) return { items: [] }
      return {
        items: [
          {
            insertText: completion,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
          },
        ],
        // Enables the "next/prev" navigation & explicit Tab-accept.
        enableForwardStability: true,
      }
    },
  }
  // '*' — все языки; конкретные (typescript/javascript/...) тоже работают,
  // но у нас смешанный проект.
  const inline = monaco.languages.registerInlineCompletionsProvider(
    ['*'],
    provider,
  )
  disposables.push(inline)

  // ---- Code actions (лампочка + контекстное меню) --------------------------
  const kinds: {
    id: 'explain' | 'refactor' | 'tests' | 'fix' | 'docs'
    title: string
  }[] = [
    { id: 'explain', title: 'AI: объяснить код' },
    { id: 'refactor', title: 'AI: отрефакторить' },
    { id: 'tests', title: 'AI: сгенерировать тесты' },
    { id: 'fix', title: 'AI: исправить ошибку' },
    { id: 'docs', title: 'AI: добавить документацию' },
  ]

  const actionProvider = {
    provideCodeActions: (
      model: any,
      range: any,
      _context: any,
      _token: any,
    ) => {
      const language = model.getLanguageId?.() ?? 'plaintext'
      const path = model.uri?.fsPath ?? model.uri?.toString?.() ?? ''
      // Если выделения нет — берём весь текущий абзац (набор непустых строк).
      const value =
        range.isEmpty()
          ? model.getLineContent(range.startLineNumber)
          : model.getValueInRange(range)

      return {
        actions: kinds.map((k) => ({
          title: k.title,
          kind: 'quickfix',
          diagnostics: [],
          command: {
            id: `aura.ai.${k.id}`,
            title: k.title,
            arguments: [{ action: k.id, code: value, language, path }],
          },
        })),
        dispose: () => {},
      }
    },
  }
  const ca = monaco.languages.registerCodeActionProvider(['*'], actionProvider)
  disposables.push(ca)

  // Регистрируем команды `aura.ai.<id>` — их вызывает Monaco при клике.
  for (const k of kinds) {
    const cmd = monaco.editor.registerCommand(
      `aura.ai.${k.id}`,
      (_ctx: unknown, payload: { action: any; code: string; language: string; path?: string }) => {
        options.onRunAction(payload)
      },
    )
    disposables.push(cmd)
  }

  return () => {
    for (const d of disposables) {
      try {
        d.dispose()
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Темы редактора
// ---------------------------------------------------------------------------

const AURA_DARK = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0a0a0a',
    'editor.foreground': '#e4e4e7',
    'editor.lineHighlightBackground': '#18181b',
    'editorCursor.foreground': '#a1a1aa',
    'editor.selectionBackground': '#3f3f4680',
    'editorInlineHint.foreground': '#71717a',
    'editorInlineHint.background': '#00000000',
    'editorSuggestWidget.background': '#0a0a0a',
    'editorSuggestWidget.border': '#27272a',
  },
}

const AURA_LIGHT = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#18181b',
    'editor.lineHighlightBackground': '#f4f4f5',
    'editorCursor.foreground': '#3f3f46',
    'editor.selectionBackground': '#a1a1aa60',
  },
}

let themesRegistered = false
export function registerAuraThemes(monaco: any) {
  if (themesRegistered) return
  themesRegistered = true
  monaco.editor.defineTheme('aura-dark', AURA_DARK)
  monaco.editor.defineTheme('aura-light', AURA_LIGHT)
}

// ---------------------------------------------------------------------------
// TypeScript IntelliSense в рамках проекта (без внешнего LSP)
// ---------------------------------------------------------------------------

/**
 * Загружает tsconfig и «раздаёт» его Monaco. Плюс подтягивает содержимое
 * всех .ts/.tsx/.d.ts проекта как extra libs — так Monaco видит межфайловые
 * типы, cross-file imports, и умеет go-to-definition в рамках проекта.
 *
 * Пределы: 300 файлов, 200 KB каждый — иначе Monaco TS-worker деградирует.
 */
export async function primeMonacoTsProject(
  monaco: any,
  files: string[],
  read: (path: string) => Promise<string>,
  root: string,
): Promise<() => void> {
  const defaults = monaco.languages.typescript.typescriptDefaults
  const jsDefaults = monaco.languages.javascript.javascriptDefaults
  const disposers: (() => void)[] = []

  // 1. tsconfig.json → compilerOptions
  const tsconfigPath = files.find(
    (p) => /(^|[\\/])tsconfig\.json$/i.test(p),
  )
  let compilerOptions: Record<string, unknown> = {
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.Preserve,
    allowJs: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    strict: false,
    skipLibCheck: true,
  }
  if (tsconfigPath) {
    try {
      const raw = await read(tsconfigPath)
      const parsed = JSON.parse(stripJsonComments(raw))
      const co = parsed?.compilerOptions
      if (co && typeof co === 'object') {
        compilerOptions = { ...compilerOptions, ...co }
      }
    } catch {
      /* tsconfig может быть с JSON5-конструкциями — тогда просто дефолты */
    }
  }
  defaults.setCompilerOptions(compilerOptions as any)
  jsDefaults.setCompilerOptions(compilerOptions as any)
  defaults.setEagerModelSync(true)

  // 2. Файлы TS/TSX/D.TS/JS/JSON проекта → extra libs.
  const targets = files
    .filter((p) => /\.(ts|tsx|d\.ts|js|jsx|mjs|cjs)$/i.test(p))
    .slice(0, 300)

  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '')
  await Promise.all(
    targets.map(async (path) => {
      try {
        const content = await read(path)
        if (content.length > 200_000) return
        const rel = path.replace(/\\/g, '/').startsWith(rootNorm)
          ? path.replace(/\\/g, '/').slice(rootNorm.length + 1)
          : path
        const uri = `file:///${rel}`
        const d = defaults.addExtraLib(content, uri)
        disposers.push(() => d?.dispose?.())
      } catch {
        /* пропускаем — файл мог исчезнуть */
      }
    }),
  )

  return () => {
    for (const d of disposers) {
      try {
        d()
      } catch {
        /* ignore */
      }
    }
  }
}

function stripJsonComments(src: string): string {
  // Просто, дёшево: убираем // ... до конца строки и /* ... */.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}
