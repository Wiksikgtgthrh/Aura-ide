'use client'

import { useState, useTransition } from 'react'
import { Frame, X, Loader2, AlertCircle } from 'lucide-react'
import { useLanguage } from '@/lib/language'

export function FigmaDialog({
  open,
  onClose,
  onInsert,
}: {
  open: boolean
  onClose: () => void
  onInsert: (context: string) => void
}) {
  const { t } = useLanguage()
  const [frameUrl, setFrameUrl] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (!open) return null

  const handleExtract = () => {
    if (!frameUrl.trim()) {
      setError(t('figmaUrlRequired'))
      return
    }
    if (!token.trim()) {
      setError(t('figmaTokenRequired'))
      return
    }

    // Parse file key and node id from Figma URL
    // e.g. https://www.figma.com/file/FILEKEY/...?node-id=NODE
    const fileMatch = frameUrl.match(/figma\.com\/(?:file|design)\/([^/?]+)/)
    const nodeMatch = frameUrl.match(/node-id=([^&]+)/)
    if (!fileMatch) {
      setError(t('figmaInvalidUrl'))
      return
    }

    const fileKey = fileMatch[1]
    const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]) : undefined

    setError(null)
    startTransition(async () => {
      try {
        const params = new URLSearchParams({ fileKey })
        if (nodeId) params.set('nodeId', nodeId)

        const res = await fetch(`/api/figma?${params.toString()}`, {
          headers: { 'x-figma-token': token },
        })
        if (!res.ok) {
          const msg = await res.text()
          setError(msg || t('figmaFetchError'))
          return
        }
        const data = await res.json()
        const summary = JSON.stringify(data, null, 2).slice(0, 4000)
        onInsert(`[Figma design context]\n\`\`\`json\n${summary}\n\`\`\``)
        onClose()
      } catch {
        setError(t('figmaFetchError'))
      }
    })
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label={t('createFigma')}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover shadow-xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Frame className="size-4 text-muted-foreground" />
            {t('createFigma')}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">{t('figmaFrameUrl')}</label>
              <input
                type="url"
                value={frameUrl}
                onChange={(e) => setFrameUrl(e.target.value)}
                placeholder="https://www.figma.com/file/..."
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">{t('figmaToken')}</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="figd_..."
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">{t('figmaTokenHelp')}</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isPending && <Loader2 className="size-3.5 animate-spin" />}
                {t('figmaExtract')}
              </button>
            </div>
          </div>
      </div>
    </>
  )
}
