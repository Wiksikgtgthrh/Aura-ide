'use server'

import { db } from '@/lib/db'
import { plugins, pluginAccess, pluginVersions, user, userPlugins } from '@/lib/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'
import {
  sanitizeAuthors,
  sanitizeMedia,
  type IdeManifest,
  type PluginAuthor,
  type PluginMediaItem,
  type PluginVersionEntry,
} from '@/lib/plugin-types'

export type PluginManifest = {
  sidebarIcon?: string
  dialogComponent?: string
  rules?: string[]
  uiMods?: { hideSidebar?: boolean; hideTerminal?: boolean }
  whereItAppears?: string
  docs?: string
  changelog?: { version: string; date: string; notes: string }[]
  recommendations?: string[]
  /** Расширения самой IDE — кнопки, палитра, completions. */
  ide?: IdeManifest
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
  // Магазин (лендинг): цена, документация и медиа. На немигрированной БД
  // приходят значениями по умолчанию (fallback-запрос).
  priceRub: number
  docs: string
  longDescription: string
  donateAuthors: PluginAuthor[]
  media: PluginMediaItem[]
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

type MarketplaceRow = {
  id: string
  slug: string
  name: string
  description: string
  author: string
  version: string
  type: string
  scope: string
  icon: string
  manifest: unknown
  publishedAt: Date
  updatedAt: Date
  userPluginId: string | null
  enabled: boolean | null
  hidden?: boolean | null
  priceRub?: number | null
  docs?: string | null
  longDescription?: string | null
  donateAuthors?: unknown
  media?: unknown
}

function toMarketplacePlugin(r: MarketplaceRow): MarketplacePlugin {
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
    priceRub: r.priceRub ?? 0,
    docs: r.docs ?? '',
    longDescription: r.longDescription ?? '',
    donateAuthors: sanitizeAuthors(r.donateAuthors),
    media: sanitizeMedia(r.media),
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    isInstalled: r.userPluginId !== null,
    enabled: r.enabled ?? false,
    userPluginId: r.userPluginId ?? null,
  }
}

const marketplaceBaseColumns = {
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
}

const marketplaceStoreColumns = {
  ...marketplaceBaseColumns,
  hidden: plugins.hidden,
  priceRub: plugins.priceRub,
  docs: plugins.docs,
  longDescription: plugins.longDescription,
  donateAuthors: plugins.donateAuthors,
  media: plugins.media,
}

/**
 * Скрытые плагины видят только пользователи с выдачей в plugin_access и
 * админы. На немигрированной схеме (нет колонок/таблиц) считаем «скрытых нет».
 */
async function getHiddenVisibility(userId: string): Promise<{
  isAdmin: boolean
  grantedIds: Set<string>
}> {
  let isAdmin = false
  const grantedIds = new Set<string>()
  try {
    const [me] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1)
    isAdmin = me?.role === 'admin' || me?.role === 'superadmin'
  } catch {
    /* role column missing — обычный пользователь */
  }
  try {
    const grants = await db
      .select({ pluginId: pluginAccess.pluginId })
      .from(pluginAccess)
      .where(eq(pluginAccess.userId, userId))
    for (const g of grants) grantedIds.add(g.pluginId)
  } catch {
    /* plugin_access missing */
  }
  return { isAdmin, grantedIds }
}

async function doFetchMarketplacePlugins(userId: string): Promise<MarketplacePlugin[]> {
  const join = and(eq(userPlugins.pluginId, plugins.id), eq(userPlugins.userId, userId))
  let rows: MarketplaceRow[]
  try {
    rows = await db.select(marketplaceStoreColumns).from(plugins).leftJoin(userPlugins, join)
  } catch {
    // Колонок магазина ещё нет (не запущен pnpm migrate:admin) — базовый набор.
    rows = await db.select(marketplaceBaseColumns).from(plugins).leftJoin(userPlugins, join)
  }

  const hasHidden = rows.some((r) => r.hidden)
  if (hasHidden) {
    const { isAdmin, grantedIds } = await getHiddenVisibility(userId)
    if (!isAdmin) rows = rows.filter((r) => !r.hidden || grantedIds.has(r.id))
  }
  return rows.map(toMarketplacePlugin)
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
    priceRub: 0,
    docs: '',
    longDescription: '',
    donateAuthors: [],
    media: [],
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
  const join = and(eq(userPlugins.pluginId, plugins.id), eq(userPlugins.userId, userId))

  let rows: MarketplaceRow[]
  try {
    rows = await db
      .select(marketplaceStoreColumns)
      .from(plugins)
      .leftJoin(userPlugins, join)
      .where(eq(plugins.slug, slug))
      .limit(1)
  } catch {
    rows = await db
      .select(marketplaceBaseColumns)
      .from(plugins)
      .leftJoin(userPlugins, join)
      .where(eq(plugins.slug, slug))
      .limit(1)
  }
  if (!rows[0]) return null

  // Скрытый плагин: доступ только по выдаче или админам.
  if (rows[0].hidden) {
    const { isAdmin, grantedIds } = await getHiddenVisibility(userId)
    if (!isAdmin && !grantedIds.has(rows[0].id)) return null
  }

  return toMarketplacePlugin(rows[0])
}

/** Публичная история версий плагина (вкладка «Обновления» на лендинге). */
export async function getPluginVersions(pluginId: string): Promise<PluginVersionEntry[]> {
  await requireUserId()
  try {
    const rows = await db
      .select()
      .from(pluginVersions)
      .where(eq(pluginVersions.pluginId, pluginId))
      .orderBy(desc(pluginVersions.createdAt))
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      changelog: r.changelog,
      createdAt: r.createdAt.toISOString(),
    }))
  } catch {
    return [] // таблица ещё не создана
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
