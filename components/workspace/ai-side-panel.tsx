'use client'

/**
 * AI-панель прямо в IDE — коллапсируемый сайдбар справа с чатом.
 *
 * Реализация — тонкий iframe на существующую страницу `/chat/[id]`, чтобы
 * не дублировать всю логику чата (Vercel AI SDK, MCP, память, плагины).
 * Контекст открытого файла передаётся через query-параметр, чат может
 * подхватить его в системный промпт.
 */

import { useMemo } from 'react'
import { Bot, ExternalLink, X } from 'lucide-react'

export function AiSidePanel({
  activeFile,
  onClose,
  chatId,
}: {
  activeFile: string | null
  onClose: () => void
  chatId?: string
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
        <iframe src={src} className="h-full w-full border-0" title="ai-chat" />
      </div>
    </div>
  )
}
