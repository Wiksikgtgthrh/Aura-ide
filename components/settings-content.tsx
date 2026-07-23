'use client'

import type { Preferences } from '@/app/actions/preferences'
import type { Memory } from '@/app/actions/memories'
import type { MarketplacePlugin } from '@/app/actions/plugins'
import type { McpServer } from '@/app/actions/mcp'
import type { BillingData } from '@/app/actions/billing'
import type { ApiKeysGrouped } from '@/app/actions/api-keys'
import type { UsageData } from '@/app/actions/usage'
import type { Profile } from '@/app/actions/profile'
import { PreferencesForm } from '@/components/preferences-form'
import { GeneralForm } from '@/components/general-form'
import { MemoriesForm } from '@/components/memories-form'
import { PluginsForm } from '@/components/plugins-form'
import { SkillsForm } from '@/components/skills-form'
import { IntegrationsForm } from '@/components/integrations-form'
import { BillingForm } from '@/components/billing-form'
import { ApiKeysForm } from '@/components/api-keys-form'
import { UsageForm } from '@/components/usage-form'
import { MembersForm } from '@/components/members-form'
import { ProfileForm } from '@/components/profile-form'
import { useLanguage } from '@/lib/language'
import { useSettings } from '@/components/settings-context'
import type { Section } from '@/components/settings-context'

export function SettingsContent({
  initial,
  initialMemories,
  initialPlugins,
  initialMcpServers,
  initialBillingData,
  initialApiKeys,
  initialUsageData,
  initialProfile,
}: {
  initial: Preferences
  initialMemories: Memory[]
  initialPlugins: MarketplacePlugin[]
  initialMcpServers?: McpServer[]
  initialBillingData?: BillingData
  initialApiKeys?: ApiKeysGrouped | null
  initialUsageData?: UsageData
  initialProfile: Profile
}) {
  const { t } = useLanguage()
  const { section } = useSettings()

  const titles: Record<Section, string> = {
    profile: t('profileTitle'),
    preferences: t('preferences'),
    general: t('general'),
    memories: t('memories'),
    plugins: 'Плагины',
    skills: 'Навыки',
    integrations: t('integrations'),
    billing: t('billing'),
    'api-keys': 'API-ключи',
    usage: 'Использование',
    members: 'Участники',
  }
  const descriptions: Record<Section, string> = {
    profile: t('profileDescription'),
    preferences: t('preferencesDescription'),
    general: t('generalDescription'),
    memories: t('memoriesDescription'),
    plugins: 'Устанавливайте расширения и утилиты для IDE и чата.',
    skills: 'Управляйте AI-навыками — специализированными инструкциями для Aura.',
    integrations: 'Подключайте внешние сервисы и MCP-серверы.',
    billing: 'Ваш баланс, тарифный план и реферальная программа.',
    'api-keys': 'Управляйте API-ключами для разных провайдеров AI. Перетаскивайте ключи по группам.',
    usage: 'Статистика использования токенов и активности в Aura.',
    members: 'Управляйте участниками воркспейса и их правами доступа.',
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 animate-in fade-in duration-150">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {titles[section] ?? titles.preferences}
      </h1>
      <p className="text-sm text-muted-foreground mt-1.5 mb-8">
        {descriptions[section] ?? descriptions.preferences}
      </p>

      {section === 'profile' && <ProfileForm initial={initialProfile} />}
      {section === 'preferences' && <PreferencesForm initial={initial} />}
      {section === 'general' && <GeneralForm initial={initial} />}
      {section === 'memories' && (
        <MemoriesForm initialMemories={initialMemories} initialPrefs={initial} />
      )}
      {section === 'plugins' && <PluginsForm initialPlugins={initialPlugins} />}
      {section === 'skills' && <SkillsForm initialPlugins={initialPlugins} />}
      {section === 'integrations' && <IntegrationsForm initialMcpServers={initialMcpServers} />}
      {section === 'billing' && <BillingForm initialData={initialBillingData} />}
      {section === 'api-keys' && <ApiKeysForm initialData={initialApiKeys} />}
      {section === 'usage' && <UsageForm initialData={initialUsageData} />}
      {section === 'members' && <MembersForm />}
    </div>
  )
}
