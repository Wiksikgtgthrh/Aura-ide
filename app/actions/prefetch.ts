'use server'

import { getSession } from '@/lib/session'
import { getPreferences } from '@/app/actions/preferences'
import { getProfileForUser } from '@/app/actions/profile'
import { getMemories } from '@/app/actions/memories'
import { getMarketplacePlugins } from '@/app/actions/plugins'

/**
 * Warms the Next.js unstable_cache for the settings page.
 * Called on hover of the Settings button — by the time the user clicks,
 * all data is already in the cache and the page resolves near-instantly.
 *
 * Both getPreferences() and getProfileForUser() use unstable_cache, so
 * subsequent server renders within the revalidate window (300s) are free.
 */
export async function prefetchSettingsData() {
  const session = await getSession()
  if (!session?.user) return

  // Fire all queries in parallel — each one populates its own cache tag
  await Promise.all([
    getPreferences(),
    getProfileForUser(session.user.id),
    getMemories(),
    getMarketplacePlugins(),
  ])
}
