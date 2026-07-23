'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { getMarketplacePlugins } from '@/app/actions/plugins'
import type { MarketplacePlugin } from '@/app/actions/plugins'
import { PluginCard } from './plugin-card'
import { useLanguage } from '@/lib/language'
import { Puzzle } from 'lucide-react'

type Filter = 'all' | 'installed' | 'utility' | 'skill' | 'system-mod'

export function PluginsContent({ initialPlugins }: { initialPlugins?: MarketplacePlugin[] }) {
  const { language, t } = useLanguage()
  const [filter, setFilter] = useState<Filter>('all')

  const { data: plugins, mutate } = useSWR<MarketplacePlugin[]>(
    'marketplace-plugins',
    () => getMarketplacePlugins(),
    {
      fallbackData: initialPlugins,
      revalidateOnMount: false,
      revalidateOnFocus: false,
    }
  )

  const filtered = plugins?.filter((p) => {
    if (filter === 'installed') return p.isInstalled
    if (filter === 'utility') return p.type === 'utility'
    if (filter === 'skill') return p.type === 'skill'
    if (filter === 'system-mod') return p.type === 'system-mod'
    return true
  }) ?? []

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: language === 'ru' ? 'Все' : 'All' },
    { key: 'installed', label: language === 'ru' ? 'Установленные' : 'Installed' },
    { key: 'utility', label: language === 'ru' ? 'Утилиты' : 'Utilities' },
    { key: 'skill', label: language === 'ru' ? 'Навыки ИИ' : 'AI Skills' },
    { key: 'system-mod', label: language === 'ru' ? 'Системные моды' : 'System Mods' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground text-balance">
          {t('pluginsTitle')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {language === 'ru'
            ? 'Расширяйте Aura новыми возможностями — утилиты, навыки ИИ и системные моды.'
            : 'Extend Aura with new capabilities — utilities, AI skills, and system mods.'}
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200 ${
              filter === tab.key
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Puzzle className="size-8" />
          <p className="text-sm">
            {language === 'ru' ? 'Плагинов не найдено' : 'No plugins found'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              lang={language}
              onMutate={() => mutate()}
            />
          ))}
        </div>
      )}
    </div>
  )
}
