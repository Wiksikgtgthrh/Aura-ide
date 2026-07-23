'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ActivitySquare,
  Wind,
  Moon,
  Puzzle,
  Loader2,
  type LucideProps,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PluginBadge } from './plugin-badge'
import { PluginToggle } from './plugin-toggle'
import { installPlugin, uninstallPlugin } from '@/app/actions/plugins'
import type { MarketplacePlugin } from '@/app/actions/plugins'

const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  ActivitySquare,
  Wind,
  Moon,
  Puzzle,
}

function PluginIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Puzzle
  return <Icon className={className} />
}

export function PluginCard({
  plugin,
  lang = 'ru',
  onMutate,
}: {
  plugin: MarketplacePlugin
  lang?: 'ru' | 'en'
  onMutate?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState(plugin.isInstalled)
  const [enabled, setEnabled] = useState(plugin.enabled)

  const handleInstall = async () => {
    setBusy(true)
    try {
      await installPlugin(plugin.id)
      setInstalled(true)
      setEnabled(true)
      onMutate?.()
    } finally {
      setBusy(false)
    }
  }

  const handleUninstall = async () => {
    setBusy(true)
    try {
      await uninstallPlugin(plugin.id)
      setInstalled(false)
      setEnabled(false)
      onMutate?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-card hover:border-border/80 transition-colors duration-200">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <PluginIcon name={plugin.icon} className="size-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/plugins/${plugin.slug}`}
              className="text-sm font-medium text-foreground hover:underline truncate"
            >
              {plugin.name}
            </Link>
            <PluginBadge scope={plugin.scope} lang={lang} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {plugin.author} · v{plugin.version}
          </p>
        </div>

        {installed && (
          <PluginToggle
            pluginId={plugin.id}
            enabled={enabled}
            onToggle={setEnabled}
          />
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
        {plugin.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <Link
          href={`/plugins/${plugin.slug}`}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          {lang === 'ru' ? 'Подробнее' : 'Learn more'} →
        </Link>

        {installed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleUninstall}
            disabled={busy}
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : null}
            {lang === 'ru' ? 'Удалить' : 'Uninstall'}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleInstall}
            disabled={busy}
            className="h-7 text-xs"
          >
            {busy ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
            {lang === 'ru' ? 'Установить' : 'Install'}
          </Button>
        )}
      </div>
    </div>
  )
}
