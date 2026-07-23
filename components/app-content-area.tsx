'use client'

import { Activity } from 'react'
import { usePathname } from 'next/navigation'
import { SWRConfig } from 'swr'
import { SettingsContent } from '@/components/settings-content'
import { HomeContent } from '@/components/home-content'
import { ProjectsContent } from '@/components/projects-content'
import { TeamsContent } from '@/components/team-management/teams-content'
import { PluginsContent } from '@/components/plugins/plugins-content'
import type { Preferences } from '@/app/actions/preferences'
import type { Memory } from '@/app/actions/memories'
import type { MarketplacePlugin, InstalledPlugin } from '@/app/actions/plugins'
import type { Profile } from '@/app/actions/profile'
import type { ApiKeyItem } from '@/app/actions/api-keys'
import type { ProjectItem } from '@/app/actions/projects'
import type { TeamItem } from '@/app/actions/teams'
import type { ChatListItem } from '@/lib/chat-store'

export type PreloadedSettingsData = {
  initial: Preferences
  initialMemories: Memory[]
  initialPlugins: MarketplacePlugin[]
  initialProfile: Profile
}

export type PreloadedPagesData = {
  initialProjects: ProjectItem[]
  initialTeams: TeamItem[]
  initialMarketplacePlugins: MarketplacePlugin[]
  initialChats: ChatListItem[]
  initialApiKeys: ApiKeyItem[]
  initialInstalledPlugins: InstalledPlugin[]
}

/**
 * Client wrapper for the main content area.
 *
 * All main pages (home, projects, teams, plugins, settings) are mounted
 * once in Activity shells. Navigating between them is a pure client-side
 * visibility toggle — zero RSC round-trips, zero network latency.
 *
 * The RSC page files for these routes return null (content is here).
 * Dynamic routes (/chat/[id], /teams/[id], /plugins/[slug]) still use
 * normal RSC rendering since they can't be pre-loaded.
 *
 * swrFallback populates the SWR cache so components never fetch on mount
 * for data already loaded in the layout.
 */
const EMPTY_PAGES_DATA: PreloadedPagesData = {
  initialProjects: [],
  initialTeams: [],
  initialMarketplacePlugins: [],
  initialChats: [],
  initialApiKeys: [],
  initialInstalledPlugins: [],
}

export function AppContentArea({
  children,
  settingsData,
  pagesData = EMPTY_PAGES_DATA,
  swrFallback = {},
}: {
  children: React.ReactNode
  settingsData: PreloadedSettingsData
  pagesData?: PreloadedPagesData
  swrFallback?: Record<string, unknown>
}) {
  const pathname = usePathname()

  const isHome = pathname === '/'
  const isProjects = pathname === '/projects'
  const isTeams = pathname === '/teams'
  const isPlugins = pathname === '/plugins'
  const isSettings = pathname.startsWith('/settings')
  // Dynamic routes: /chat/[id], /teams/[teamId], /plugins/[slug], etc.
  const isDynamic = !isHome && !isProjects && !isTeams && !isPlugins && !isSettings

  return (
    <SWRConfig value={{ fallback: swrFallback }}>
      {/* Home */}
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden${isHome ? '' : ' hidden'}`}>
        <Activity mode={isHome ? 'visible' : 'hidden'}>
          <HomeContent />
        </Activity>
      </div>

      {/* Projects */}
      <div className={`flex-1 min-w-0 overflow-y-auto${isProjects ? '' : ' hidden'}`}>
        <Activity mode={isProjects ? 'visible' : 'hidden'}>
          <main className="flex-1 min-w-0 overflow-y-auto">
            <ProjectsContent
              initialProjects={pagesData.initialProjects}
              initialChats={pagesData.initialChats}
            />
          </main>
        </Activity>
      </div>

      {/* Teams */}
      <div className={`flex-1 min-w-0 overflow-y-auto${isTeams ? '' : ' hidden'}`}>
        <Activity mode={isTeams ? 'visible' : 'hidden'}>
          <main className="flex-1 min-w-0 overflow-y-auto">
            <TeamsContent initialTeams={pagesData.initialTeams} />
          </main>
        </Activity>
      </div>

      {/* Plugins */}
      <div className={`flex-1 min-w-0 overflow-y-auto${isPlugins ? '' : ' hidden'}`}>
        <Activity mode={isPlugins ? 'visible' : 'hidden'}>
          <main className="flex-1 min-w-0 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-6 py-8">
              <PluginsContent initialPlugins={pagesData.initialMarketplacePlugins} />
            </div>
          </main>
        </Activity>
      </div>

      {/* Settings */}
      <div className={`flex-1 min-w-0 overflow-y-auto${isSettings ? '' : ' hidden'}`}>
        <Activity mode={isSettings ? 'visible' : 'hidden'}>
          <SettingsContent
            initial={settingsData.initial}
            initialMemories={settingsData.initialMemories}
            initialPlugins={settingsData.initialPlugins}
            initialProfile={settingsData.initialProfile}
          />
        </Activity>
      </div>

      {/* Dynamic routes: /chat/[id], /teams/[teamId], /plugins/[slug], etc. */}
      <div className={`flex-1 min-w-0 flex flex-col overflow-hidden${isDynamic ? '' : ' hidden'}`}>
        <Activity mode={isDynamic ? 'visible' : 'hidden'}>
          {children}
        </Activity>
      </div>
    </SWRConfig>
  )
}
