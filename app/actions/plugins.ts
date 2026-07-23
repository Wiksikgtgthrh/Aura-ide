'use server'

import { db } from '@/lib/db'
import { plugins, userPlugins } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'

export type PluginManifest = {
  sidebarIcon?: string
  dialogComponent?: string
  rules?: string[]
  uiMods?: { hideSidebar?: boolean; hideTerminal?: boolean }
  whereItAppears?: string
  docs?: string
  changelog?: { version: string; date: string; notes: string }[]
  recommendations?: string[]
}

export type Plugin = {
  id: string
  slug: string
  name: string
  description: string
  author: string
  version: string
  type: 'utility' | 'skill' | 'system-mod'
  scope: 'ide-component' | 'ai-skill' | 'system-ui'
  icon: string
  manifest: PluginManifest
  publishedAt: Date
  updatedAt: Date
}

export type InstalledPlugin = Plugin & {
  userPluginId: string
  enabled: boolean
  installedAt: Date
}

export type MarketplacePlugin = Plugin & {
  isInstalled: boolean
  enabled: boolean
  userPluginId: string | null
}

async function requireUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function doFetchMarketplacePlugins(userId: string): Promise<MarketplacePlugin[]> {
  const rows = await db
    .select({
      id: plugins.id,
      slug: plugins.slug,
      name: plugins.name,
      description: plugins.description,
      author: plugins.author,
      version: plugins.version,
      type: plugins.type,
      scope: plugins.scope,
      icon: plugins.icon,
      manifest: plugins.manifest,
      publishedAt: plugins.publishedAt,
      updatedAt: plugins.updatedAt,
      userPluginId: userPlugins.id,
      enabled: userPlugins.enabled,
    })
    .from(plugins)
    .leftJoin(
      userPlugins,
      and(eq(userPlugins.pluginId, plugins.id), eq(userPlugins.userId, userId))
    )

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    author: r.author,
    version: r.version,
    type: r.type as Plugin['type'],
    scope: r.scope as Plugin['scope'],
    icon: r.icon,
    manifest: r.manifest as PluginManifest,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    isInstalled: r.userPluginId !== null,
    enabled: r.enabled ?? false,
    userPluginId: r.userPluginId ?? null,
  }))
}

const fetchMarketplacePlugins = (userId: string) =>
  unstable_cache(
    () => doFetchMarketplacePlugins(userId),
    ['marketplace-plugins', userId],
    { tags: ['marketplace-plugins'], revalidate: 120 },
  )()

export async function getMarketplacePlugins(): Promise<MarketplacePlugin[]> {
  const userId = await requireUserId()
  return fetchMarketplacePlugins(userId)
}

/** Use in server components when userId is already known to skip an extra getSession call. */
export async function getMarketplacePluginsForUser(userId: string): Promise<MarketplacePlugin[]> {
  return fetchMarketplacePlugins(userId)
}

async function doFetchInstalledPlugins(userId: string): Promise<InstalledPlugin[]> {
  const rows = await db
    .select({
      id: plugins.id,
      slug: plugins.slug,
      name: plugins.name,
      description: plugins.description,
      author: plugins.author,
      version: plugins.version,
      type: plugins.type,
      scope: plugins.scope,
      icon: plugins.icon,
      manifest: plugins.manifest,
      publishedAt: plugins.publishedAt,
      updatedAt: plugins.updatedAt,
      userPluginId: userPlugins.id,
      enabled: userPlugins.enabled,
      installedAt: userPlugins.installedAt,
    })
    .from(userPlugins)
    .innerJoin(plugins, eq(userPlugins.pluginId, plugins.id))
    .where(eq(userPlugins.userId, userId))

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    author: r.author,
    version: r.version,
    type: r.type as Plugin['type'],
    scope: r.scope as Plugin['scope'],
    icon: r.icon,
    manifest: r.manifest as PluginManifest,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    userPluginId: r.userPluginId,
    enabled: r.enabled,
    installedAt: r.installedAt,
  }))
}

const fetchInstalledPlugins = (userId: string) =>
  unstable_cache(
    () => doFetchInstalledPlugins(userId),
    ['installed-plugins', userId],
    { tags: ['installed-plugins'], revalidate: 120 },
  )()

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  const userId = await requireUserId()
  return fetchInstalledPlugins(userId)
}

/** Direct version — use when userId is already known (e.g. in layout). */
export async function getInstalledPluginsForUser(userId: string): Promise<InstalledPlugin[]> {
  return fetchInstalledPlugins(userId)
}


export async function getPluginBySlug(slug: string): Promise<MarketplacePlugin | null> {
  const userId = await requireUserId()

  const rows = await db
    .select({
      id: plugins.id,
      slug: plugins.slug,
      name: plugins.name,
      description: plugins.description,
      author: plugins.author,
      version: plugins.version,
      type: plugins.type,
      scope: plugins.scope,
      icon: plugins.icon,
      manifest: plugins.manifest,
      publishedAt: plugins.publishedAt,
      updatedAt: plugins.updatedAt,
      userPluginId: userPlugins.id,
      enabled: userPlugins.enabled,
    })
    .from(plugins)
    .leftJoin(
      userPlugins,
      and(eq(userPlugins.pluginId, plugins.id), eq(userPlugins.userId, userId))
    )
    .where(eq(plugins.slug, slug))
    .limit(1)

  if (!rows[0]) return null

  const r = rows[0]
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    author: r.author,
    version: r.version,
    type: r.type as Plugin['type'],
    scope: r.scope as Plugin['scope'],
    icon: r.icon,
    manifest: r.manifest as PluginManifest,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    isInstalled: r.userPluginId !== null,
    enabled: r.enabled ?? false,
    userPluginId: r.userPluginId ?? null,
  }
}

export async function installPlugin(pluginId: string): Promise<void> {
  const userId = await requireUserId()
  await db
    .insert(userPlugins)
    .values({ userId, pluginId, enabled: true })
    .onConflictDoNothing()
  revalidateTag('installed-plugins', 'max')
  revalidateTag('marketplace-plugins', 'max')
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const userId = await requireUserId()
  await db
    .delete(userPlugins)
    .where(and(eq(userPlugins.userId, userId), eq(userPlugins.pluginId, pluginId)))
  revalidateTag('installed-plugins', 'max')
  revalidateTag('marketplace-plugins', 'max')
}

export async function togglePlugin(pluginId: string, enabled: boolean): Promise<void> {
  const userId = await requireUserId()
  await db
    .update(userPlugins)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(userPlugins.userId, userId), eq(userPlugins.pluginId, pluginId)))
  revalidateTag('installed-plugins', 'max')
  revalidateTag('marketplace-plugins', 'max')
}

/** Called from /api/chat/route.ts — returns rules from enabled skill plugins */
export async function getActivePluginContext(userId: string): Promise<string[]> {
  const rows = await db
    .select({
      manifest: plugins.manifest,
    })
    .from(userPlugins)
    .innerJoin(plugins, eq(userPlugins.pluginId, plugins.id))
    .where(
      and(
        eq(userPlugins.userId, userId),
        eq(userPlugins.enabled, true),
        eq(plugins.type, 'skill')
      )
    )

  const rules: string[] = []
  for (const row of rows) {
    const manifest = row.manifest as PluginManifest
    if (manifest.rules?.length) {
      rules.push(...manifest.rules)
    }
  }
  return rules
}
