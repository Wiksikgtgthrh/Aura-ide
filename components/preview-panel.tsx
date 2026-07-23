'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  MonitorSmartphone,
  PanelLeft,
  RotateCw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/lib/language'

// Lazy — only loaded when the user opens Publish.
const PublishDialog = dynamic(
  () => import('@/components/publish-dialog').then((m) => m.PublishDialog),
  { ssr: false },
)

export function PreviewPanel({
  html,
  busy,
  chatCollapsed,
  onToggleChat,
  projectName = 'aura-site',
}: {
  html: string | null
  busy: boolean
  chatCollapsed: boolean
  onToggleChat: () => void
  projectName?: string
}) {
  const { t } = useLanguage()
  // reloadKey forces a full iframe remount only on manual reload
  const [reloadKey, setReloadKey] = useState(0)
  const [mobile, setMobile] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  // stableKey is set once when the first HTML arrives and never changes,
  // so the iframe is NOT remounted on each streaming chunk.
  const stableKeyRef = useRef<number | null>(null)
  const [iframeKey, setIframeKey] = useState(0)

  useEffect(() => {
    if (html && stableKeyRef.current === null) {
      stableKeyRef.current = Date.now()
      setIframeKey(stableKeyRef.current)
    }
  }, [html])

  const handleManualReload = () => {
    const next = Date.now()
    stableKeyRef.current = next
    setIframeKey(next)
    setReloadKey((k) => k + 1)
  }

  const srcDoc = html ?? ''

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-muted/30">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onToggleChat}
          aria-label={chatCollapsed ? 'Open chat panel' : 'Collapse chat panel'}
        >
          <PanelLeft className="size-4" />
        </Button>

        <div className="mx-auto flex w-full max-w-md items-center gap-1 rounded-lg border border-border bg-muted/50 px-2 py-1">
          <ChevronLeft className="size-4 shrink-0 text-muted-foreground/50" />
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
          <button
            type="button"
            onClick={() => setMobile((m) => !m)}
            className={`rounded p-0.5 ${mobile ? 'text-foreground' : 'text-muted-foreground/70'}`}
            aria-label="Toggle mobile viewport"
          >
            <MonitorSmartphone className="size-4" />
          </button>
          <span className="flex-1 truncate text-center text-xs text-muted-foreground">
            /
          </span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/50" />
          <button
            type="button"
            onClick={handleManualReload}
            className="rounded p-0.5 text-muted-foreground/70 hover:text-foreground"
            aria-label="Reload preview"
          >
            <RotateCw className="size-3.5" />
          </button>
        </div>

        <Button
          size="sm"
          className="h-8 rounded-full px-4 text-xs"
          onClick={() => setPublishOpen(true)}
          disabled={!html}
        >
          {t('publish')}
        </Button>
      </header>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        files={html ? { 'index.html': html } : {}}
        projectName={projectName}
        variant="html"
      />

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-0">
        {srcDoc ? (
          <>
            {/* Streaming indicator overlay */}
            {busy && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur-sm animate-in fade-in duration-300">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Generating…
              </div>
            )}
            <iframe
              key={iframeKey}
              title="Preview"
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              className={
                mobile
                  ? 'h-[85%] w-[390px] max-w-full rounded-2xl border border-border bg-background shadow-lg'
                  : 'h-full w-full border-0 bg-background'
              }
            />
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
            {busy ? (
              <>
                <Loader2 className="size-6 animate-spin" />
                <p className="text-sm">{t('previewGenerating')}</p>
              </>
            ) : (
              <>
                <Sparkles className="size-6" />
                <p className="max-w-xs text-sm text-pretty">
                  {t('previewEmpty')}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
