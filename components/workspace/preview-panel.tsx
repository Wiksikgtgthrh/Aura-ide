'use client'

/**
 * Live Preview: запускает dev-сервер проекта и показывает его в iframe.
 * URL и логи прилетают из нативного `preview_start` через событие.
 */

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, Play, RotateCw, Square } from 'lucide-react'
import { onPreview, previewStart, previewStop } from '@/lib/tauri'

export function PreviewPanel({ root }: { root: string }) {
  const [id] = useState(() => `preview-${Math.random().toString(36).slice(2, 8)}`)
  const [url, setUrl] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    ;(async () => {
      unlisten = await onPreview(id, (ev) => {
        if (ev.url) setUrl(ev.url)
        if (ev.log) setLogs((l) => [...l.slice(-500), ev.log!])
        if (ev.exited) {
          setRunning(false)
          setUrl(null)
        }
      })
    })()
    return () => {
      unlisten?.()
      void previewStop(id).catch(() => {})
    }
  }, [id])

  const start = async () => {
    setLogs([])
    setRunning(true)
    try {
      await previewStart(id, root)
    } catch (e) {
      setLogs((l) => [...l, `[ошибка запуска] ${(e as Error).message}`])
      setRunning(false)
    }
  }

  const stop = async () => {
    try {
      await previewStop(id)
    } finally {
      setRunning(false)
      setUrl(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">Preview</span>
        {url && <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px]">{url}</span>}
        <div className="ml-auto flex items-center gap-1">
          {!running ? (
            <button
              type="button"
              onClick={() => void start()}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90"
            >
              <Play className="size-3" /> Запустить dev-сервер
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                title="Перезагрузить"
                className="rounded p-1 hover:bg-accent"
              >
                <RotateCw className="size-3.5" />
              </button>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded p-1 hover:bg-accent"
                  title="Открыть в браузере"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => void stop()}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
              >
                <Square className="size-3" /> Стоп
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className={`rounded px-2 py-1 text-[11px] hover:bg-accent ${showLogs ? 'bg-accent' : ''}`}
          >
            Логи
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {url ? (
          <iframe
            key={refreshKey}
            ref={iframeRef}
            src={url}
            className="h-full w-full border-0 bg-white"
            title="live-preview"
          />
        ) : running ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Ждём готовность dev-сервера…
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Нажмите «Запустить dev-сервер», чтобы увидеть проект
          </div>
        )}
      </div>
      {showLogs && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-border bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
          {logs.length === 0 ? (
            <span className="text-zinc-500">логов пока нет</span>
          ) : (
            logs.map((l, i) => (
              <pre key={i} className="whitespace-pre-wrap break-all">
                {l}
              </pre>
            ))
          )}
        </div>
      )}
    </div>
  )
}
