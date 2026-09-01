'use client'

/**
 * Лёгкое контекстное меню для файлового дерева и вкладок.
 * Без Radix — тонкое всплывающее меню, position: fixed, авто-фокус.
 */

import { useEffect, useRef } from 'react'

export type CtxItem =
  | { kind: 'item'; label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; hint?: string }
  | { kind: 'separator' }

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: CtxItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  // Держимся в пределах экрана.
  const maxX = typeof window !== 'undefined' ? window.innerWidth - 220 : x
  const maxY = typeof window !== 'undefined' ? window.innerHeight - items.length * 30 - 8 : y

  return (
    <div
      ref={ref}
      className="fixed z-[1000] min-w-[200px] rounded-md border border-border bg-popover py-1 text-sm shadow-lg"
      style={{ left: Math.min(x, maxX), top: Math.min(y, maxY) }}
      role="menu"
    >
      {items.map((it, i) =>
        it.kind === 'separator' ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent ${
              it.danger ? 'text-red-500' : ''
            }`}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon && <span className="size-4 shrink-0">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-xs text-muted-foreground">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  )
}
