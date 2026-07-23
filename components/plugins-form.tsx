'use client'

import { useState, useTransition, useMemo } from 'react'
import type { MarketplacePlugin } from '@/app/actions/plugins'
import {
  installPlugin,
  uninstallPlugin,
  togglePlugin,
} from '@/app/actions/plugins'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Puzzle,
  Zap,
  Settings2,
  Search,
  Download,
  Trash2,
  CheckCircle2,
} from 'lucide-react'

const TYPE_LABELS: Record<string, string> = {
  utility: 'Утилита',
  skill: 'Навык ИИ',
  'system-mod': 'Системный мод',
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  utility: <Puzzle className="size-3.5" />,
  skill: <Zap className="size-3.5" />,
  'system-mod': <Settings2 className="size-3.5" />,
}

const TYPE_COLORS: Record<string, string> = {
  utility: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  skill: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  'system-mod': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
}

function PluginCard({
  plugin,
  onInstall,
  onUninstall,
  onToggle,
  pending,
}: {
  plugin: MarketplacePlugin
  onInstall: (id: string) => void
  onUninstall: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  pending: boolean
}) {
  return (
    <div
      className={`group relative flex items-start gap-4 rounded-xl border p-4 transition-all duration-200 ${
        plugin.isInstalled
          ? 'border-border bg-muted/30'
          : 'border-border bg-background hover:border-muted-foreground/30 hover:bg-muted/20'
      }`}
    >
      {/* Icon */}
      <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
        {TYPE_ICONS[plugin.type] ?? <Puzzle className="size-4" />}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{plugin.name}</span>
          <span className="text-xs text-muted-foreground">v{plugin.version}</span>
          <span
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[plugin.type] ?? 'bg-muted text-muted-foreground border-border'}`}
          >
            {TYPE_ICONS[plugin.type]}
            {TYPE_LABELS[plugin.type] ?? plugin.type}
          </span>
          {plugin.isInstalled && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              <CheckCircle2 className="size-3" />
              Установлен
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
          {plugin.description || 'Нет описания.'}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground/60">by {plugin.author}</p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2">
        {plugin.isInstalled && (
          <Switch
            checked={plugin.enabled}
            onCheckedChange={(v) => onToggle(plugin.id, v)}
            disabled={pending}
            aria-label="Включить плагин"
          />
        )}
        {plugin.isInstalled ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60 hover:bg-destructive/10"
            onClick={() => onUninstall(plugin.id)}
            disabled={pending}
          >
            <Trash2 className="size-3.5" />
            Удалить
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => onInstall(plugin.id)}
            disabled={pending}
          >
            <Download className="size-3.5" />
            Установить
          </Button>
        )}
      </div>
    </div>
  )
}

export function PluginsForm({
  initialPlugins,
}: {
  initialPlugins: MarketplacePlugin[]
}) {
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>(initialPlugins)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'utility' | 'skill' | 'system-mod'>('all')
  const [filterInstalled, setFilterInstalled] = useState(false)
  const [pending, startTransition] = useTransition()

  const installed = useMemo(() => plugins.filter((p) => p.isInstalled), [plugins])

  const filtered = useMemo(() => {
    return plugins.filter((p) => {
      if (filterInstalled && !p.isInstalled) return false
      if (filterType !== 'all' && p.type !== filterType) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return (
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [plugins, search, filterType, filterInstalled])

  function optimisticInstall(id: string) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isInstalled: true, enabled: true } : p))
    )
    startTransition(async () => {
      await installPlugin(id)
    })
  }

  function optimisticUninstall(id: string) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isInstalled: false, enabled: false } : p))
    )
    startTransition(async () => {
      await uninstallPlugin(id)
    })
  }

  function optimisticToggle(id: string, enabled: boolean) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled } : p))
    )
    startTransition(async () => {
      await togglePlugin(id, enabled)
    })
  }

  const typeFilters: { value: typeof filterType; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'utility', label: 'Утилиты' },
    { value: 'skill', label: 'Навыки ИИ' },
    { value: 'system-mod', label: 'Системные моды' },
  ]

  return (
    <div className="flex flex-col gap-8">
      {/* Installed section */}
      {installed.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Установленные ({installed.length})
          </h2>
          <div className="flex flex-col gap-2">
            {installed.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onInstall={optimisticInstall}
                onUninstall={optimisticUninstall}
                onToggle={optimisticToggle}
                pending={pending}
              />
            ))}
          </div>
        </section>
      )}

      {/* Marketplace */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Маркетплейс
        </h2>

        {/* Search + filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Поиск по названию, автору..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1">
            {typeFilters.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilterType(f.value)}
                className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                  filterType === f.value
                    ? 'border-foreground/30 bg-muted text-foreground font-medium'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              onClick={() => setFilterInstalled((v) => !v)}
              className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
                filterInstalled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
              }`}
            >
              Установленные
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Puzzle className="size-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Плагины не найдены</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Попробуйте изменить фильтры или поисковый запрос
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onInstall={optimisticInstall}
                onUninstall={optimisticUninstall}
                onToggle={optimisticToggle}
                pending={pending}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
