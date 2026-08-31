'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, MessageSquare, CornerDownLeft } from 'lucide-react'
import type { ChatListItem } from '@/lib/chat-store'
import { useLanguage } from '@/lib/language'

/**
 * Command-palette search over the user's chats. Data comes from the already
 * loaded chat list (no network) so it opens and filters instantly. Opens via
 * the sidebar "Search" button or Cmd/Ctrl+K.
 */
export function SearchDialog({
  open,
  onOpenChange,
  chats,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chats: ChatListItem[]
}) {
  const { t } = useLanguage()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // focus after the dialog paints
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? chats.filter((c) => c.title.toLowerCase().includes(q))
      : chats
    return list.slice(0, 20)
  }, [query, chats])

  useEffect(() => {
    setActive(0)
  }, [query])

  const go = (id: string) => {
    onOpenChange(false)
    router.push(`/chat/${id}`)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-foreground/30 px-4 pt-[12vh] animate-in fade-in duration-150"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(results.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter' && results[active]) {
                e.preventDefault()
                go(results[active].id)
              } else if (e.key === 'Escape') {
                onOpenChange(false)
              }
            }}
            placeholder={t('searchChatsPlaceholder')}
            className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t('searchNoResults')}
            </p>
          ) : (
            results.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(c.id)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                  i === active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground hover:bg-accent/50'
                }`}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.title}</span>
                {i === active && (
                  <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
