'use client'

import { useRef, useState } from 'react'
import {
  Bold,
  Code,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pencil,
  Quote,
  SquareCode,
} from 'lucide-react'
import { Markdown } from '@/components/markdown'

/**
 * Удобный ввод документации: markdown-редактор с живым превью
 * (вкладки Писать/Превью) и панелью быстрой вставки — заголовки, списки,
 * код, ссылки. Вставка работает по выделению: выдели текст и нажми «B».
 */

type InsertAction = {
  icon: React.ReactNode
  title: string
  /** Обёртка вокруг выделения [before, after] ИЛИ префикс строки. */
  wrap?: [string, string]
  linePrefix?: string
  block?: string
}

const ACTIONS: InsertAction[] = [
  { icon: <Heading1 className="size-3.5" />, title: 'Заголовок', linePrefix: '# ' },
  { icon: <Heading2 className="size-3.5" />, title: 'Подзаголовок', linePrefix: '## ' },
  { icon: <Bold className="size-3.5" />, title: 'Жирный', wrap: ['**', '**'] },
  { icon: <Italic className="size-3.5" />, title: 'Курсив', wrap: ['*', '*'] },
  { icon: <Code className="size-3.5" />, title: 'Код в строке', wrap: ['`', '`'] },
  { icon: <SquareCode className="size-3.5" />, title: 'Блок кода', block: '```\nкод\n```' },
  { icon: <List className="size-3.5" />, title: 'Список', linePrefix: '- ' },
  { icon: <ListOrdered className="size-3.5" />, title: 'Нумерованный список', linePrefix: '1. ' },
  { icon: <Quote className="size-3.5" />, title: 'Цитата', linePrefix: '> ' },
  { icon: <Link2 className="size-3.5" />, title: 'Ссылка', wrap: ['[', '](https://)'] },
]

export function MarkdownEditor({
  value,
  onChange,
  rows = 12,
  placeholder = 'Markdown: # заголовки, **жирный**, списки, ```код```…',
}: {
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  const apply = (action: InsertAction) => {
    const area = areaRef.current
    if (!area) return
    const start = area.selectionStart ?? value.length
    const end = area.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    let next = value
    let cursorStart = start
    let cursorEnd = end

    if (action.wrap) {
      const [before, after] = action.wrap
      next = value.slice(0, start) + before + (selected || 'текст') + after + value.slice(end)
      cursorStart = start + before.length
      cursorEnd = cursorStart + (selected || 'текст').length
    } else if (action.linePrefix) {
      // Префикс каждой строки выделения (или текущей строки).
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const effEnd = Math.max(end, start)
      const segment = value.slice(lineStart, effEnd)
      const prefixed = segment
        .split('\n')
        .map((l) => (l.startsWith(action.linePrefix!) ? l : action.linePrefix + l))
        .join('\n')
      next = value.slice(0, lineStart) + prefixed + value.slice(effEnd)
      cursorStart = lineStart
      cursorEnd = lineStart + prefixed.length
    } else if (action.block) {
      const sep = value.length > 0 && !value.endsWith('\n') ? '\n\n' : value.length > 0 ? '\n' : ''
      const blockText = action.block.replace('код', selected || 'код')
      next = value.slice(0, end) + sep + blockText + value.slice(end)
      cursorStart = end + sep.length
      cursorEnd = cursorStart + blockText.length
    }

    onChange(next)
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(cursorStart, cursorEnd)
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      {/* Вкладки + панель вставки */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/40 px-2 py-1.5">
        <div className="flex items-center gap-0.5 rounded-md bg-background p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => setTab('write')}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              tab === 'write' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Pencil className="size-3" /> Писать
          </button>
          <button
            type="button"
            onClick={() => setTab('preview')}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              tab === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Eye className="size-3" /> Превью
          </button>
        </div>
        {tab === 'write' && (
          <div className="ml-auto flex flex-wrap items-center gap-0.5">
            {ACTIONS.map((a) => (
              <button
                key={a.title}
                type="button"
                title={a.title}
                onClick={() => apply(a)}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {a.icon}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'write' ? (
        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full resize-y bg-background px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground outline-none"
        />
      ) : (
        <div className="min-h-32 max-h-[480px] overflow-y-auto px-4 py-3">
          {value.trim() ? (
            <Markdown source={value} />
          ) : (
            <p className="text-sm text-muted-foreground">Пока пусто — напишите что-нибудь во вкладке «Писать».</p>
          )}
        </div>
      )}
    </div>
  )
}
