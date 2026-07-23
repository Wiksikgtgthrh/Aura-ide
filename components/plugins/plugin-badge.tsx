import type { Plugin } from '@/app/actions/plugins'

const scopeConfig: Record<
  Plugin['scope'],
  { label: { ru: string; en: string }; className: string }
> = {
  'ide-component': {
    label: { ru: 'Компонент IDE', en: 'IDE Component' },
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
  },
  'ai-skill': {
    label: { ru: 'Навык ИИ', en: 'AI Skill' },
    className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20',
  },
  'system-ui': {
    label: { ru: 'Системный мод', en: 'System Mod' },
    className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20',
  },
}

export function PluginBadge({
  scope,
  lang = 'ru',
}: {
  scope: Plugin['scope']
  lang?: 'ru' | 'en'
}) {
  const config = scopeConfig[scope]
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}
    >
      {config.label[lang]}
    </span>
  )
}
