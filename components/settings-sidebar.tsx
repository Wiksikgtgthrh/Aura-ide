'use client'

import Link from 'next/link'
import { useLanguage } from '@/lib/language'
import { useSettings, type Section } from '@/components/settings-context'
import {
  ArrowLeft,
  SlidersHorizontal,
  Building2,
  BookMarked,
  Zap,
  Cable,
  CreditCard,
  Users,
  Activity,
  KeyRound,
  Puzzle,
  UserCircle,
} from 'lucide-react'

type TranslationKey = Parameters<ReturnType<typeof useLanguage>['t']>[0]

// Sections with a real implementation
const ROUTED_SECTIONS = new Set([
  'profile',
  'preferences',
  'general',
  'memories',
  'plugins',
  'skills',
  'integrations',
  'billing',
  'api-keys',
  'usage',
  'members',
])

type SettingsItem = {
  key: TranslationKey
  icon: React.ComponentType<{ className?: string }>
  section?: string
}

const accountItems: SettingsItem[] = [
  { key: 'profile', icon: UserCircle, section: 'profile' },
  { key: 'preferences', icon: SlidersHorizontal, section: 'preferences' },
]

const workspaceItems: SettingsItem[] = [
  { key: 'general', icon: Building2, section: 'general' },
  { key: 'memories', icon: BookMarked, section: 'memories' },
  { key: 'skillsNav', icon: Zap, section: 'skills' },
  { key: 'pluginsNav', icon: Puzzle, section: 'plugins' },
  { key: 'integrations', icon: Cable, section: 'integrations' },
  { key: 'billing', icon: CreditCard, section: 'billing' },
  { key: 'members', icon: Users, section: 'members' },
  { key: 'usage', icon: Activity, section: 'usage' },
  { key: 'apiKeys', icon: KeyRound, section: 'api-keys' },
]

function SectionList({
  title,
  items,
}: {
  title: string
  items: SettingsItem[]
}) {
  const { t } = useLanguage()
  const { section: activeSection, setSection } = useSettings()
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        {title}
      </span>
      {items.map((item) => {
        const isActive = item.section === activeSection
        const isRoutable = item.section && ROUTED_SECTIONS.has(item.section)
        const className = `flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors duration-150 text-left w-full ${
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
        }`
        if (isRoutable && item.section) {
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSection(item.section as Section)}
              className={className}
            >
              <item.icon className="size-4 shrink-0" />
              {t(item.key)}
            </button>
          )
        }
        return (
          <button
            key={item.key}
            type="button"
            className={className}
            disabled
            title="Coming soon"
          >
            <item.icon className="size-4 shrink-0" />
            {t(item.key)}
          </button>
        )
      })}
    </div>
  )
}

export function SettingsSidebar({ userName }: { userName: string }) {
  const { t } = useLanguage()

  return (
    <aside className="w-64 shrink-0 h-svh flex flex-col bg-sidebar border-r border-sidebar-border">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="size-5 rounded-full bg-foreground flex items-center justify-center shrink-0">
            <span className="text-background text-[10px] font-semibold">A</span>
          </span>
          <span className="truncate text-sm font-medium text-sidebar-foreground">
            Aura — {userName}
          </span>
        </div>
      </div>

      <div className="px-3 pt-2">
        <Link
          href="/"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-200"
        >
          <ArrowLeft className="size-4" />
          {t('settings')}
        </Link>
      </div>

      <nav
        className="px-3 pt-4 flex flex-col gap-5"
        aria-label={t('settings')}
      >
        <SectionList title={t('account')} items={accountItems} />
        <SectionList title={t('workspace')} items={workspaceItems} />
      </nav>

      <div className="mt-auto px-3 pb-3 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2 py-1.5 min-w-0">
          <span className="size-6 rounded-full bg-gradient-to-br from-orange-400 to-red-600 shrink-0" />
          <span className="truncate text-sm text-sidebar-foreground">
            {userName}
          </span>
        </div>
        <span className="px-2.5 py-1 rounded-md border border-border bg-background text-xs text-foreground shrink-0">
          {t('free')}
        </span>
      </div>
    </aside>
  )
}
