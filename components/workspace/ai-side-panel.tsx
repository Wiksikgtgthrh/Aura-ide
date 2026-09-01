'use client'

/**
 * AI-панель в IDE. Умеет два режима:
 *  1. «просто чат» — iframe на /chat/[id]?embed=1 с проброшенным ?file=.
 *  2. «действие» — если пришёл preset (explain/refactor/tests/fix/docs
 *     или diff-review), локально стримим ответ через /api/ai/action
 *     и показываем его без переключения в чат.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ExternalLink, Loader2, Sparkles, X, Copy, Check, RotateCw } from 'lucide-react'
import { extractCode, streamAction, type AiActionType } from '@/lib/ai-client'

export type AiActionPreset = {
  action: AiActionType
  input: string
  language?: string
  path?: string
  /** Дополнительный текст для action=custom / diff-review — например «сфокусируйся на …». */
  instruction?: string
  /** Заголовок карточки (по умолчанию — по action). */
  title?: string
}

const TITLES: Record<AiActionType, string> = {
  explain: 'Объяснение кода',
  refactor: 'Рефакторинг',
  tests: 'Тесты',
  fix: 'Исправление',
  docs: 'Документация',
  terminal: 'Команда терминала',
  'diff-review': 'AI Review',
  'commit-message': 'Сообщение коммита',
  custom: 'AI',
}

export function AiSidePanel({
  activeFile,
  onClose,
  chatId,
  preset,
  onConsumePreset,
  onApplyCode,
}: {
  activeFile: string | null
  onClose: () => void
  chatId?: string
  preset?: AiActionPreset | null
  onConsumePreset?: () => void
  /** Кнопка «Применить» — заменить активный код на результат из fenced-блока. */
  onApplyCode?: (code: string) => void
}) {
  const src = useMemo(() => {
    const id = chatId ?? 'ide-scratch'
    const params = new URLSearchParams({ embed: '1' })
    if (activeFile) params.set('file', activeFile)
    return `/chat/${encodeURIComponent(id)}?${params.toString()}`
  }, [activeFile, chatId])

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <Bot className="size-4 text-primary" />
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">AI</span>
        {activeFile && (
          <span className="ml-2 truncate text-[10px] text-muted-foreground">
            контекст: {activeFile.split(/[\\/]/).pop()}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="rounded p-1 hover:bg-accent"
            title="Открыть в отдельной вкладке"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {preset ? (
          <ActionRunner
            key={presetKey(preset)}
            preset={preset}
            onDone={() => {
              /* оставляем результат на экране — кнопкой «Чат» пользователь сам вернётся */
            }}
            onBackToChat={onConsumePreset}
            onApplyCode={onApplyCode}
          />
        ) : (
          <iframe src={src} className="h-full w-full border-0" title="ai-chat" />
        )}
      </div>
    </div>
  )
}

function presetKey(p: AiActionPreset): string {
  return `${p.action}::${p.path ?? ''}::${p.input.slice(0, 64)}`
}

function ActionRunner({
  preset,
  onBackToChat,
  onApplyCode,
}: {
  preset: AiActionPreset
  onDone: () => void
  onBackToChat?: () => void
  onApplyCode?: (code: string) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    setText('')
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      let acc = ''
      await streamAction({
        action: preset.action,
        input: preset.input,
        language: preset.language,
        path: preset.path,
        instruction: preset.instruction,
        signal: ctrl.signal,
        onChunk: (piece) => {
          acc += piece
          setText(acc)
        },
      })
      setText(acc)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [preset])

  useEffect(() => {
    void run()
    return () => abortRef.current?.abort()
  }, [run])

  const title = preset.title ?? TITLES[preset.action]
  const canApply = onApplyCode && ['refactor', 'fix', 'docs'].includes(preset.action)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs">
        <Sparkles className="size-3.5 text-amber-400" />
        <span className="font-medium">{title}</span>
        {busy && <Loader2 className="size-3 animate-spin" />}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Перезапустить"
            onClick={() => void run()}
            className="rounded p-1 hover:bg-accent"
          >
            <RotateCw className="size-3" />
          </button>
          <button
            type="button"
            title="Копировать"
            onClick={async () => {
              await navigator.clipboard?.writeText(text).catch(() => {})
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
            className="rounded p-1 hover:bg-accent"
          >
            {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
          </button>
          {onBackToChat && (
            <button
              type="button"
              onClick={onBackToChat}
              className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-accent"
            >
              К чату
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="border-b border-border bg-red-500/10 px-3 py-1 text-xs text-red-400">{error}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[12px] leading-5 text-foreground/90">
          {text || (busy ? 'думаем…' : 'нет ответа')}
        </pre>
      </div>
      {canApply && text && !busy && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => onApplyCode!(extractCode(text))}
            className="w-full rounded bg-primary py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Применить к активному файлу
          </button>
        </div>
      )}
    </div>
  )
}
