import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { getProfileForUser } from '@/app/actions/profile'
import { getPreferencesForUser } from '@/app/actions/preferences'
import { getMemoriesForUser } from '@/app/actions/memories'
import { getMarketplacePluginsForUser, getInstalledPluginsForUser } from '@/app/actions/plugins'
import { getProjectsForUser } from '@/app/actions/projects'
import { getApiKeysForUser, getApiKeysGroupedForUser } from '@/app/actions/api-keys'
import { getTeamsForUser } from '@/app/actions/teams'
import { listChatsForUser } from '@/lib/chat-store'
import { getSession } from '@/lib/session'
import { NavigationProvider } from '@/lib/navigation-context'
import { SettingsProvider } from '@/components/settings-context'
import { AppContentArea, type PreloadedSettingsData, type PreloadedPagesData } from '@/components/app-content-area'

async function AppShellLoader({
  children,
}: {
  children: React.ReactNode
}) {
  // getSession() is called HERE — inside the Suspense boundary — so cookies()
  // and the DB round-trip never block the streamed shell (and cacheComponents
  // prerender doesn't flag uncached IO outside Suspense).
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')

  const userId = session.user.id
  const sessionName = session.user.name
  const sessionEmail = session.user.email
  // All data fetches run in parallel — sidebar + settings all in one Promise.all.
  // Every function uses userId directly (no extra getSession() call).
  // On warm unstable_cache these are all sub-5ms; on cold they run concurrently.
  const [
    profile,
    initialChats,
    prefs,
    memories,
    initialMarketplacePlugins,
    initialProjects,
    initialApiKeys,
    initialApiKeysGrouped,
    initialInstalledPlugins,
    initialTeams,
  ] = await Promise.all([
    getProfileForUser(userId),
    listChatsForUser(userId),
    getPreferencesForUser(userId),
    getMemoriesForUser(userId),
    getMarketplacePluginsForUser(userId),
    getProjectsForUser(userId),
    getApiKeysForUser(userId),
    getApiKeysGroupedForUser(userId),
    getInstalledPluginsForUser(userId),
    getTeamsForUser(userId),
  ])

  const displayName = profile.isAnonymous ? 'Anonymous' : (profile.name || sessionName)

  const settingsData: PreloadedSettingsData = {
    initial: prefs,
    initialMemories: memories,
    initialPlugins: initialMarketplacePlugins,
    initialProfile: profile,
  }

  const pagesData: PreloadedPagesData = {
    initialProjects,
    initialTeams,
    initialMarketplacePlugins,
    initialChats,
    initialApiKeys,
    initialApiKeysGrouped,
    initialInstalledPlugins,
  }

  return (
    <>
      <AppSidebar
        userId={userId}
        userName={displayName}
        userEmail={profile.email || sessionEmail}
        userImage={profile.image}
        userTag={profile.tag}
        isAnonymous={profile.isAnonymous}
        initialChats={initialChats}
      />
      <AppContentArea
        settingsData={settingsData}
        pagesData={pagesData}
        swrFallback={{
          'api-keys': initialApiKeys,
          'api-keys-grouped': initialApiKeysGrouped,
          'installed-plugins': initialInstalledPlugins,
          'projects': initialProjects,
          'teams': initialTeams,
          'marketplace-plugins': initialMarketplacePlugins,
          'chats': initialChats,
        }}
      >
        {children}
      </AppContentArea>
    </>
  )
}

/**
 * Shell skeleton shown while AppShellLoader resolves.
 * Renders both sidebar and content area so there is no layout shift.
 * Uses session name (available instantly) so there is no anonymous placeholder.
 */
function ShellSkeleton({ userName }: { userName: string }) {
  return (
    <>
      <aside
        aria-hidden="true"
        className="w-64 shrink-0 h-svh flex flex-col bg-sidebar border-r border-sidebar-border"
      >
        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="size-5 rounded-full bg-muted animate-pulse" />
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {userName}&apos;s Aura
            </span>
          </div>
        </div>
        <div className="px-3 pt-3">
          <div className="h-9 rounded-md bg-muted animate-pulse" />
        </div>
        <div className="px-3 pt-4 flex flex-col gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="size-4 rounded bg-muted animate-pulse" />
              <div className="h-4 rounded bg-muted animate-pulse" style={{ width: `${60 + i * 8}px` }} />
            </div>
          ))}
        </div>
        <div className="mt-auto px-3 pb-3 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-2 py-1.5 min-w-0">
            <div className="size-6 rounded-full bg-muted animate-pulse shrink-0" />
            <span className="truncate text-sm text-sidebar-foreground">{userName}</span>
          </div>
        </div>
      </aside>
      {/* Content area placeholder — prevents layout shift */}
      <div className="flex-1 min-w-0" aria-hidden="true" />
    </>
  )
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <NavigationProvider>
      <div className="flex h-svh bg-background overflow-hidden">
        {/*
          Everything that touches request data lives INSIDE Suspense:
          - AppShellLoader → cookies()/DB (session + sidebar + settings data)
          - SettingsProvider → usePathname() (request-bound on dynamic routes,
            e.g. /chat/[id]; outside Suspense it breaks cacheComponents
            prerendering of those routes)
          Next.js streams the skeleton immediately without blocking on any of it.
        */}
        <Suspense fallback={<ShellSkeleton userName="" />}>
          <SettingsProvider initialSection="preferences">
            <AppShellLoader>{children}</AppShellLoader>
          </SettingsProvider>
        </Suspense>
      </div>
    </NavigationProvider>
  )
}
