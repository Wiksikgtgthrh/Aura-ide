'use client'

/**
 * Ctrl+K попап над терминалом: пишешь «как убить процесс на 3000»,
 * получаешь shell-команду, Enter вставляет её в PTY.
 *
 * Не открывает чат, не переключает вкладки — маленький бокс, ESC закрывает.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { extractCode, streamAction } from '@/lib/ai-client'

export function TerminalAiPopup({
  onInsert,
  onClose,
  os,
}: {
  onInsert: (command: string, submit: boolean) => void
  onClose: () => void
  os?: string
}) {
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    setResult('')
    try {
      let acc = ''
      await streamAction({
        action: 'terminal',
        input: prompt,
        os,
        onChunk: (piece) => {
          acc += piece
          setResult(extractCode(acc))
        },
      })
      setResult(extractCode(acc))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const insert = (submit: boolean) => {
    if (!result.trim()) return
    onInsert(result.trim(), submit)
    onClose()
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 border-b border-border bg-popover shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <Sparkles className="size-3.5 text-amber-400" />
        <span className="text-muted-foreground">AI-команда · Enter — сгенерировать · Esc — отмена</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 hover:bg-accent">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="p-2">
        <div className="flex items-center gap-2 rounded border border-border bg-background px-2">
          <span className="text-xs text-muted-foreground">→</span>
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void run()
              }
            }}
            placeholder="напиши, что нужно сделать — например, «убить процесс на порту 3000»"
            className="h-8 w-full bg-transparent text-sm outline-none"
          />
          {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        {result && (
          <div className="mt-2 space-y-2">
            <pre className="max-h-40 overflow-y-auto rounded border border-border bg-muted/50 p-2 font-mono text-[12px] text-foreground">
              {result}
            </pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => insert(true)}
                className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              >
                Вставить и выполнить (Enter)
              </button>
              <button
                type="button"
                onClick={() => insert(false)}
                className="rounded border border-border px-3 py-1 text-xs hover:bg-accent"
              >
                Только вставить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
