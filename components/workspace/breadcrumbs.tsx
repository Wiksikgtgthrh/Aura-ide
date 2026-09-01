'use client'

/**
 * Breadcrumbs — путь к текущему файлу под вкладками.
 * Каждый сегмент — кликабельный shortcut для Quick Open в этой директории
 * (пока просто onClick с колбэком).
 */

import { ChevronRight } from 'lucide-react'
import { iconForFile, iconForFolder } from '@/lib/file-icons'

export function Breadcrumbs({
  root,
  file,
  onNavigate,
}: {
  root: string
  file: string
  onNavigate?: (segmentPath: string) => void
}) {
  const norm = file.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = norm.startsWith(r) ? norm.slice(r.length + 1) : norm
  const parts = rel.split('/').filter(Boolean)
  let acc = r
  const fileSpec = iconForFile(parts[parts.length - 1] ?? file)
  return (
    <div className="flex h-6 items-center gap-0.5 overflow-x-auto border-b border-border/50 bg-muted/30 px-3 text-[11px] text-muted-foreground">
      {parts.map((p, i) => {
        acc = `${acc}/${p}`
        const isLast = i === parts.length - 1
        const spec = isLast ? fileSpec : iconForFolder(false)
        return (
          <div key={acc} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-50" />}
            <button
              type="button"
              onClick={() => onNavigate?.(acc)}
              className={`flex items-center gap-1 rounded px-1 hover:bg-accent ${isLast ? 'text-foreground' : ''}`}
            >
              <spec.Icon className={`size-3 shrink-0 ${spec.className}`} />
              <span className="truncate">{p}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
