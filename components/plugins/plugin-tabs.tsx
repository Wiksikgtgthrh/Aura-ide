'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { MarketplacePlugin, PluginManifest } from '@/app/actions/plugins'
import type { LanguageCode } from '@/lib/language'
import { PluginBadge } from './plugin-badge'
import { PluginToggle } from './plugin-toggle'
import { installPlugin, uninstallPlugin, getMarketplacePlugins } from '@/app/actions/plugins'
import { Button } from '@/components/ui/button'
import { Loader2, ArrowLeft } from 'lucide-react'

type Tab = 'about' | 'docs' | 'changelog' | 'recommendations'

const TAB_LABELS: Record<Tab, { ru: string; en: string }> = {
  about: { ru: 'О плагине', en: 'About' },
  docs: { ru: 'Документация', en: 'Docs' },
  changelog: { ru: 'Обновления', en: 'Changelog' },
  recommendations: { ru: 'Рекомендации', en: 'Related' },
}

export function PluginDetailTabs({
  plugin,
  allPlugins,
  lang = 'ru',
}: {
  plugin: MarketplacePlugin
  allPlugins: MarketplacePlugin[]
  lang?: LanguageCode
}) {
  const [activeTab, setActiveTab] = useState<Tab>('about')
  const [installed, setInstalled] = useState(plugin.isInstalled)
  const [enabled, setEnabled] = useState(plugin.enabled)
  const [busy, setBusy] = useState(false)

  const manifest = plugin.manifest as PluginManifest

  const handleInstall = async () => {
    setBusy(true)
    try {
      await installPlugin(plugin.id)
      setInstalled(true)
      setEnabled(true)
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
    } finally {
      setBusy(false)
    }
  }

  const recommendedPlugins = allPlugins.filter(
    (p) => manifest.recommendations?.includes(p.slug)
  )

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Back */}
      <Link
        href="/plugins"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 w-fit"
      >
        <ArrowLeft className="size-3.5" />
        {lang === 'ru' ? 'Все плагины' : 'All plugins'}
      </Link>

      {/* Plugin header */}
      <div className="flex items-start gap-4 p-5 rounded-xl border border-border bg-card">
        <div className="size-14 rounded-xl bg-muted flex items-center justify-center shrink-0 text-2xl">
          <span className="text-muted-foreground text-lg font-mono">{plugin.icon[0]}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-foreground text-balance">{plugin.name}</h1>
            <PluginBadge scope={plugin.scope} lang={lang} />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {plugin.author} · v{plugin.version}
          </p>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {plugin.description}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {installed && (
            <PluginToggle pluginId={plugin.id} enabled={enabled} onToggle={setEnabled} />
          )}
          {installed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUninstall}
              disabled={busy}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
            >
              {busy && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              {lang === 'ru' ? 'Удалить' : 'Uninstall'}
            </Button>
          ) : (
            <Button size="sm" onClick={handleInstall} disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              {lang === 'ru' ? 'Установить' : 'Install'}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b border-border">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 ${
              activeTab === tab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {TAB_LABELS[tab][lang]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="text-sm text-foreground leading-relaxed">
        {activeTab === 'about' && (
          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground">{plugin.description}</p>
            {manifest.whereItAppears && (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  {lang === 'ru' ? 'Где появится после установки' : 'Where it appears after install'}
                </p>
                <p className="text-sm text-foreground">{manifest.whereItAppears}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'docs' && (
          <div className="flex flex-col gap-4">
            {manifest.docs && (
              <p className="text-muted-foreground">{manifest.docs}</p>
            )}
            {manifest.rules && manifest.rules.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {lang === 'ru' ? 'Правила плагина' : 'Plugin rules'}
                </p>
                <div className="flex flex-col gap-1.5">
                  {manifest.rules.map((rule, i) => (
                    <div
                      key={i}
                      className="font-mono text-xs bg-muted/50 border border-border rounded-md px-3 py-2 text-foreground"
                    >
                      {rule}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'changelog' && (
          <div className="flex flex-col gap-4">
            {manifest.changelog && manifest.changelog.length > 0 ? (
              manifest.changelog.map((entry, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="size-2 rounded-full bg-foreground/30 mt-1.5" />
                    {i < (manifest.changelog?.length ?? 0) - 1 && (
                      <div className="w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1 pb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium text-foreground">
                        v{entry.version}
                      </span>
                      <span className="text-xs text-muted-foreground">{entry.date}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{entry.notes}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                {lang === 'ru' ? 'История изменений пуста' : 'No changelog entries'}
              </p>
            )}
          </div>
        )}

        {activeTab === 'recommendations' && (
          <div className="flex flex-col gap-3">
            {recommendedPlugins.length > 0 ? (
              recommendedPlugins.map((rp) => (
                <Link
                  key={rp.id}
                  href={`/plugins/${rp.slug}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors duration-200"
                >
                  <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xs font-mono text-muted-foreground">{rp.icon[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{rp.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{rp.description}</p>
                  </div>
                  <PluginBadge scope={rp.scope} lang={lang} />
                </Link>
              ))
            ) : (
              <p className="text-muted-foreground">
                {lang === 'ru' ? 'Нет рекомендаций' : 'No recommendations'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
