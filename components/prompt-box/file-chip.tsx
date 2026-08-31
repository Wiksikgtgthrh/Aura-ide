'use client'

import { X, FileText, Image as ImgIcon } from 'lucide-react'
import type { AttachedFile } from './types'

export function FileChip({ file, onRemove }: { file: AttachedFile; onRemove: () => void }) {
  const isImage = file.type.startsWith('image/')
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 pl-2 pr-1 py-1 text-xs text-foreground">
      {isImage
        ? <ImgIcon className="size-3.5 shrink-0 text-muted-foreground" />
        : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="max-w-[120px] truncate">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={`Remove ${file.name}`}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
