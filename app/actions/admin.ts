'use server'

import { db } from '@/lib/db'
import {
  user,
  userBalance,
  apiKeys,
  chats,
  messages,
  projects,
  adminAudit,
  plans,
  platformApiKeys,
  transactions,
  plugins,
  pluginAccess,
  pluginVersions,
  userPlugins,
} from '@/lib/db/schema'
import {
  sanitizeAuthors,
  sanitizeMedia,
  normalizeVersion,
  type PluginAuthor,
  type PluginMediaItem,
  type PluginVersionEntry,
} from '@/lib/plugin-types'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { encryptSecret, tryDecryptSecret } from '@/lib/crypto'
import { auth } from '@/lib/auth'
import { requireAdmin, PERMANENT_UNTIL, type Role } from '@/lib/admin'
import {
  DEFAULT_MODEL_ID,
  findWorkingModel,
  maskKey,
  normalizeBaseUrl,
  parseKeyLines,
  parseModelList,
} from '@/lib/model-probe'
import { dockerContainerStats, type ContainerStat } from '@/lib/terminal'
import { getLimits, setLimits, type PlatformLimits } from '@/lib/platform-settings'

export type AdminOverview = {
  // «Проекты» = чаты-проекты (IDE): раньше показывалась таблица projects
  // (папки-контейнеры), из-за чего в Обзоре были «неправильные» нули.
  totals: { users: number; guests: number; projects: number; messages: number }
  containers: ContainerStat[]
  docker: boolean
}

async function audit(actorId: string, action: string, targetId = '', detail: unknown = {}) {
  await db
    .insert(adminAudit)
    .values({ actorId, action, targetId, detail: detail as object })
    .catch(() => {})
}

export async function getAdminOverview(): Promise<AdminOverview | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null

  const [[users], [guests], [chatCount], [msgCount]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.isAnonymous, false)),
    db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.isAnonymous, true)),
    db.select({ n: sql<number>`count(*)::int` }).from(chats),
    db.select({ n: sql<number>`count(*)::int` }).from(messages),
  ])

  const containers = dockerContainerStats()
  return {
    totals: {
      users: users?.n ?? 0,
      guests: guests?.n ?? 0,
      projects: chatCount?.n ?? 0,
      messages: msgCount?.n ?? 0,
    },
    containers,
    docker: containers.length >= 0,
  }
}

export type AdminUserRow = {
  id: string
  name: string
  username: string | null
  email: string
  isAnonymous: boolean
  role: Role
  plan: string
  createdAt: string
}

export async function listUsers(query = ''): Promise<AdminUserRow[]> {
  const actor = await requireAdmin('admin')
  if (!actor) return []
  const q = query.trim()
  const where = q
    ? or(
        ilike(user.name, `%${q}%`),
        ilike(user.username, `%${q}%`),
        ilike(user.email, `%${q}%`),
      )
    : undefined

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      isAnonymous: user.isAnonymous,
      role: user.role,
      plan: userBalance.plan,
      createdAt: user.createdAt,
    })
    .from(user)
    .leftJoin(userBalance, eq(userBalance.userId, user.id))
    .where(where)
    .orderBy(desc(user.createdAt))
    .limit(200)

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    username: r.username,
    email: r.email,
    isAnonymous: !!r.isAnonymous,
    role: (r.role as Role) ?? 'user',
    plan: r.plan ?? 'free',
    createdAt: r.createdAt.toISOString(),
  }))
}

export type AdminUserDetail = AdminUserRow & {
  projects: number
  chats: number
  status: string
  mutedUntil: string | null
  bannedUntil: string | null
  banReason: string
  /** Decrypted API keys — SUPERADMIN only (null for regular admins). */
  apiKeys:
    | { id: number; name: string; key: string; modelId: string; baseUrl: string }[]
    | null
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null

  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      isAnonymous: user.isAnonymous,
      role: user.role,
      plan: userBalance.plan,
      createdAt: user.createdAt,
      status: user.status,
      mutedUntil: user.mutedUntil,
      bannedUntil: user.bannedUntil,
      banReason: user.banReason,
    })
    .from(user)
    .leftJoin(userBalance, eq(userBalance.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)
  if (!row) return null

  const [[projCount], [chatCount]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.userId, userId)),
    db.select({ n: sql<number>`count(*)::int` }).from(chats).where(eq(chats.userId, userId)),
  ])

  // API keys are decryptable (used to call providers). Only the SUPERADMIN may
  // view them; regular admins get null.
  let keys: AdminUserDetail['apiKeys'] = null
  if (actor.isSuperadmin) {
    const rows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        key: apiKeys.key,
        modelId: apiKeys.modelId,
        baseUrl: apiKeys.baseUrl,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
    keys = rows.map((k) => ({
      id: k.id,
      name: k.name,
      key: tryDecryptSecret(k.key) ?? '⚠ не расшифровывается (ключ зашифрован другим BETTER_AUTH_SECRET)',
      modelId: k.modelId,
      baseUrl: k.baseUrl,
    }))
    await audit(actor.id, 'view_api_keys', userId)
  }

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    isAnonymous: !!row.isAnonymous,
    role: (row.role as Role) ?? 'user',
    plan: row.plan ?? 'free',
    createdAt: row.createdAt.toISOString(),
    projects: projCount?.n ?? 0,
    chats: chatCount?.n ?? 0,
    status: row.status ?? 'active',
    mutedUntil: row.mutedUntil ? row.mutedUntil.toISOString() : null,
    bannedUntil: row.bannedUntil ? row.bannedUntil.toISOString() : null,
    banReason: row.banReason ?? '',
    apiKeys: keys,
  }
}

/** Promote/demote a user. Only the superadmin may change roles. */
export async function setUserRole(userId: string, role: Role): Promise<boolean> {
  const actor = await requireAdmin('superadmin')
  if (!actor) return false
  if (userId === actor.id) return false // no self-demote lockout
  const [target] = await db
    .select({ isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!target || target.isAnonymous) return false // guests can't be admins
  await db.update(user).set({ role }).where(eq(user.id, userId))
  await audit(actor.id, 'set_role', userId, { role })
  return true
}

// ---- Moderation: mute / ban / purge guests ---------------------------------

/** durationMs = null → permanent; >0 → temporary; 0 → lift. */
export async function muteUser(userId: string, durationMs: number | null): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  if (userId === actor.id) return false
  const until = durationMs === 0 ? null : durationMs == null ? PERMANENT_UNTIL : new Date(Date.now() + durationMs)
  await db
    .update(user)
    .set({ mutedUntil: until, status: until ? 'muted' : 'active' })
    .where(eq(user.id, userId))
  await audit(actor.id, until ? 'mute' : 'unmute', userId, { until: until?.toISOString() ?? null })
  return true
}

export async function banUser(
  userId: string,
  durationMs: number | null,
  reason = '',
): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  if (userId === actor.id) return false
  // Never ban another superadmin.
  const [t] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1)
  if (t?.role === 'superadmin') return false
  const until = durationMs === 0 ? null : durationMs == null ? PERMANENT_UNTIL : new Date(Date.now() + durationMs)
  await db
    .update(user)
    .set({
      bannedUntil: until,
      status: until ? 'banned' : 'active',
      banReason: until ? reason.slice(0, 300) : '',
    })
    .where(eq(user.id, userId))
  await audit(actor.id, until ? 'ban' : 'unban', userId, { until: until?.toISOString() ?? null, reason })
  return true
}

/**
 * Delete guest (anonymous) accounts. mode 'all' removes every guest; 'empty'
 * removes only guests with no chats and no projects (safe cleanup).
 */
export async function purgeGuests(mode: 'all' | 'empty' = 'empty'): Promise<number> {
  const actor = await requireAdmin('admin')
  if (!actor) return 0
  const guests = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.isAnonymous, true))
  let removed = 0
  for (const g of guests) {
    if (mode === 'empty') {
      const [[c], [p]] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(chats).where(eq(chats.userId, g.id)),
        db.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.userId, g.id)),
      ])
      if ((c?.n ?? 0) > 0 || (p?.n ?? 0) > 0) continue
    }
    await db.delete(user).where(eq(user.id, g.id)) // cascades to their data
    removed++
  }
  await audit(actor.id, 'purge_guests', '', { mode, removed })
  return removed
}

// ---- Audit log --------------------------------------------------------------

export type AuditRow = {
  id: string
  actor: string
  action: string
  targetId: string
  createdAt: string
}

export async function getAuditLog(): Promise<AuditRow[] | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  const rows = await db
    .select({
      id: adminAudit.id,
      actorId: adminAudit.actorId,
      action: adminAudit.action,
      targetId: adminAudit.targetId,
      createdAt: adminAudit.createdAt,
      actorName: user.name,
      actorUsername: user.username,
    })
    .from(adminAudit)
    .leftJoin(user, eq(user.id, adminAudit.actorId))
    .orderBy(desc(adminAudit.createdAt))
    .limit(100)
  return rows.map((r) => ({
    id: r.id,
    actor: r.actorUsername ? `@${r.actorUsername}` : r.actorName ?? r.actorId.slice(0, 8),
    action: r.action,
    targetId: r.targetId,
    createdAt: r.createdAt.toISOString(),
  }))
}

// ---- Plans / tariffs --------------------------------------------------------

export type AdminPlan = {
  id: string
  key: string
  title: string
  priceRub: number
  features: string[]
  copy: string
  visible: boolean
  position: number
  purchases: number
}

const DEFAULT_PLANS = [
  { key: 'free', title: 'Free', priceRub: 0, position: 0 },
  { key: 'pro', title: 'Pro', priceRub: 990, position: 1 },
  { key: 'team', title: 'Team', priceRub: 2990, position: 2 },
]

/** Ensure the base plans exist (idempotent) so the tab is never empty. */
async function ensureDefaultPlans() {
  const existing = await db.select({ key: plans.key }).from(plans)
  const have = new Set(existing.map((p) => p.key))
  const missing = DEFAULT_PLANS.filter((p) => !have.has(p.key))
  if (missing.length > 0) {
    await db.insert(plans).values(
      missing.map((p) => ({
        key: p.key,
        title: p.title,
        priceRub: p.priceRub,
        position: p.position,
        features: [] as unknown as object,
      })),
    )
  }
}

export async function listPlans(): Promise<AdminPlan[] | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  await ensureDefaultPlans()
  const rows = await db.select().from(plans).orderBy(asc(plans.position))

  // Purchase counts from transactions (type 'plan_purchase', description=plan key).
  const stats = await db
    .select({ plan: transactions.description, n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.type, 'plan_purchase'))
    .groupBy(transactions.description)
  const byPlan = new Map(stats.map((s) => [s.plan, s.n]))

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    title: r.title,
    priceRub: r.priceRub,
    features: Array.isArray(r.features) ? (r.features as string[]) : [],
    copy: r.copy,
    visible: r.visible,
    position: r.position,
    purchases: byPlan.get(r.key) ?? 0,
  }))
}

export async function upsertPlan(input: {
  id?: string
  key: string
  title: string
  priceRub: number
  features: string[]
  copy: string
  visible: boolean
  position: number
}): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  const key = input.key.trim().toLowerCase().slice(0, 40)
  if (!key) return false
  const values = {
    key,
    title: input.title.trim().slice(0, 80),
    priceRub: Math.max(0, Math.round(input.priceRub) || 0),
    features: input.features.slice(0, 20).map((f) => f.slice(0, 120)) as unknown as object,
    copy: input.copy.slice(0, 2000),
    visible: !!input.visible,
    position: Math.max(0, Math.round(input.position) || 0),
    updatedAt: new Date(),
  }
  if (input.id) {
    await db.update(plans).set(values).where(eq(plans.id, input.id))
  } else {
    await db.insert(plans).values(values).onConflictDoUpdate({ target: plans.key, set: values })
  }
  await audit(actor.id, 'upsert_plan', input.id ?? key)
  return true
}

export async function deletePlan(id: string): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  await db.delete(plans).where(eq(plans.id, id))
  await audit(actor.id, 'delete_plan', id)
  return true
}

export type AdminPlanKey = {
  id: string
  planKey: string
  label: string
  maskedKey: string
  modelId: string
  baseUrl: string
  status: string // 'unknown' | 'valid' | 'invalid'
  ping: number | null
}

export async function listPlanApiKeys(planKey: string): Promise<AdminPlanKey[] | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  type Row = {
    id: string
    planKey: string
    label: string
    key: string
    baseUrl: string
    modelId: string
    status?: string | null
    ping?: number | null
  }
  let rows: Row[]
  try {
    rows = await db
      .select()
      .from(platformApiKeys)
      .where(eq(platformApiKeys.planKey, planKey))
      .orderBy(desc(platformApiKeys.createdAt))
  } catch {
    // Колонок status/ping ещё нет (не запущен pnpm migrate:admin) —
    // выбираем базовый набор, чтобы вкладка не ломалась.
    rows = await db
      .select({
        id: platformApiKeys.id,
        planKey: platformApiKeys.planKey,
        label: platformApiKeys.label,
        key: platformApiKeys.key,
        baseUrl: platformApiKeys.baseUrl,
        modelId: platformApiKeys.modelId,
      })
      .from(platformApiKeys)
      .where(eq(platformApiKeys.planKey, planKey))
  }
  return rows.map((r) => ({
    id: r.id,
    planKey: r.planKey,
    label: r.label,
    maskedKey: maskKey(tryDecryptSecret(r.key) ?? '????????'),
    modelId: r.modelId,
    baseUrl: r.baseUrl,
    status: r.status ?? 'unknown',
    ping: r.ping ?? null,
  }))
}

export async function addPlanApiKey(input: {
  planKey: string
  label: string
  key: string
  modelId: string
  baseUrl: string
}): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  const key = input.key.trim()
  if (!key) return false
  await db.insert(platformApiKeys).values({
    planKey: input.planKey.trim().toLowerCase().slice(0, 40),
    label: input.label.trim().slice(0, 80),
    key: encryptSecret(key),
    modelId: (input.modelId.trim() || 'gpt-4o-mini').slice(0, 200),
    baseUrl: (input.baseUrl.trim() || 'https://api.openai.com/v1').slice(0, 300),
  })
  await audit(actor.id, 'add_plan_key', input.planKey)
  return true
}

export async function deletePlanApiKey(id: string): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  await db.delete(platformApiKeys).where(eq(platformApiKeys.id, id))
  await audit(actor.id, 'delete_plan_key', id)
  return true
}

export type PlanKeysImportResult = {
  created: number
  failed: number
  perKey: {
    label: string
    maskedKey: string
    workingModel: string | null
    failReason: string | null
  }[]
}

/**
 * Массовая загрузка API-ключей в тариф — как bulk-import в «Мои API», но
 * пишет в platform_api_keys с привязкой к planKey. Формат: один ключ на
 * строку + общий baseUrl + список моделей-кандидатов; каждому ключу
 * назначается первая рабочая модель (однотокеновая проба chat/completions).
 * Нерабочие ключи тоже сохраняются (status 'invalid') — их видно в списке
 * и легко удалить.
 */
export async function importPlanKeysWithModelProbe(input: {
  planKey: string
  label: string
  baseUrl: string
  models: string
  keysText: string
}): Promise<PlanKeysImportResult | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null

  const planKey = input.planKey.trim().toLowerCase().slice(0, 40)
  if (!planKey) return null
  const baseUrl = normalizeBaseUrl(input.baseUrl).slice(0, 300)
  const models = parseModelList(input.models)
  const modelsToProbe = models.length > 0 ? models : [DEFAULT_MODEL_ID]
  const keys = parseKeyLines(input.keysText)
  const baseLabel = (input.label.trim() || 'Aura').slice(0, 70)

  let created = 0
  let failed = 0
  const perKey: PlanKeysImportResult['perKey'] = []

  await Promise.all(
    keys.map(async (rawKey, index) => {
      const probe = await findWorkingModel(rawKey, baseUrl, modelsToProbe)
      const label = keys.length > 1 ? `${baseLabel} ${index + 1}` : baseLabel
      const base = {
        planKey,
        label,
        key: encryptSecret(rawKey),
        modelId: probe.workingModel ?? modelsToProbe[0],
        baseUrl,
      }
      let saved = false
      let saveError: string | null = null
      try {
        await db.insert(platformApiKeys).values({
          ...base,
          status: probe.workingModel ? 'valid' : 'invalid',
          ping: probe.ping ?? undefined,
        })
        saved = true
      } catch {
        // Колонок status/ping ещё нет (немигрированная БД) — сохраняем без них,
        // чтобы массовый импорт не «не работал» до pnpm migrate:admin.
        try {
          await db.insert(platformApiKeys).values(base)
          saved = true
        } catch {
          saveError = 'не удалось сохранить в БД'
        }
      }
      if (saved && probe.workingModel) created++
      else failed++
      perKey.push({
        label,
        maskedKey: maskKey(rawKey),
        workingModel: saved ? probe.workingModel : null,
        failReason: saveError ?? probe.failReason,
      })
    }),
  )

  await audit(actor.id, 'import_plan_keys', planKey, {
    created,
    failed,
    models: modelsToProbe,
  })
  return { created, failed, perKey }
}

// ---- Plugins ----------------------------------------------------------------

export type AdminPlugin = {
  id: string
  slug: string
  name: string
  description: string
  author: string
  version: string
  type: string
  scope: string
  icon: string
  priceRub: number
  hidden: boolean
  docs: string
  longDescription: string
  donateAuthors: PluginAuthor[]
  media: PluginMediaItem[]
  manifest: string // JSON stringified for editing
  installs: number
}

export async function listAllPlugins(): Promise<AdminPlugin[] | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  const rows = await db.select().from(plugins).orderBy(asc(plugins.name))
  const installStats = await db
    .select({ pluginId: userPlugins.pluginId, n: sql<number>`count(*)::int` })
    .from(userPlugins)
    .groupBy(userPlugins.pluginId)
  const byPlugin = new Map(installStats.map((s) => [s.pluginId, s.n]))
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    author: r.author,
    version: r.version,
    type: r.type,
    scope: r.scope,
    icon: r.icon,
    priceRub: r.priceRub ?? 0,
    hidden: !!r.hidden,
    docs: r.docs ?? '',
    longDescription: r.longDescription ?? '',
    donateAuthors: sanitizeAuthors(r.donateAuthors),
    media: sanitizeMedia(r.media),
    manifest: JSON.stringify(r.manifest ?? {}, null, 2),
    installs: byPlugin.get(r.id) ?? 0,
  }))
}

export async function upsertPlugin(input: {
  id?: string
  slug: string
  name: string
  description: string
  author: string
  version: string
  type: string
  scope: string
  icon: string
  priceRub: number
  hidden: boolean
  docs: string
  longDescription: string
  donateAuthors: PluginAuthor[]
  media: PluginMediaItem[]
  manifest: string
}): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin('admin')
  if (!actor) return { ok: false, error: 'forbidden' }
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)
  if (!slug || !input.name.trim()) return { ok: false, error: 'slug and name required' }
  let manifest: object = {}
  if (input.manifest.trim()) {
    try {
      manifest = JSON.parse(input.manifest)
    } catch {
      return { ok: false, error: 'Некорректный JSON в манифесте' }
    }
  }
  const values = {
    slug,
    name: input.name.trim().slice(0, 100),
    description: input.description.slice(0, 500),
    author: input.author.trim().slice(0, 100) || 'Aura Team',
    version: input.version.trim().slice(0, 20) || '1.0.0',
    type: input.type,
    scope: input.scope,
    icon: input.icon.trim().slice(0, 40) || 'Puzzle',
    priceRub: Math.max(0, Math.round(input.priceRub) || 0),
    hidden: !!input.hidden,
    docs: input.docs.slice(0, 20000),
    longDescription: input.longDescription.slice(0, 20000),
    donateAuthors: sanitizeAuthors(input.donateAuthors) as unknown as object,
    media: sanitizeMedia(input.media) as unknown as object,
    manifest: manifest as object,
    updatedAt: new Date(),
  }
  if (input.id) {
    await db.update(plugins).set(values).where(eq(plugins.id, input.id))
  } else {
    await db.insert(plugins).values(values).onConflictDoUpdate({ target: plugins.slug, set: values })
  }
  await audit(actor.id, 'upsert_plugin', input.id ?? slug)
  revalidateTag('marketplace-plugins', 'max')
  return { ok: true }
}

// ---- Версии плагина (история обновлений) -------------------------------------

export async function listPluginVersions(pluginId: string): Promise<PluginVersionEntry[] | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
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
    return [] // таблица ещё не создана (не запущен pnpm migrate:admin)
  }
}

/**
 * «Новая версия»: пишет запись в plugin_versions и обновляет plugins.version.
 * Версия валидируется (1.2.3, допускается суффикс -beta и т.п.).
 */
export async function addPluginVersion(input: {
  pluginId: string
  version: string
  changelog: string
}): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin('admin')
  if (!actor) return { ok: false, error: 'forbidden' }
  const version = normalizeVersion(input.version)
  if (!version) return { ok: false, error: 'Версия должна быть вида 1.2.3' }
  const changelog = input.changelog.trim().slice(0, 8000)
  await db.insert(pluginVersions).values({ pluginId: input.pluginId, version, changelog })
  await db
    .update(plugins)
    .set({ version, updatedAt: new Date() })
    .where(eq(plugins.id, input.pluginId))
  await audit(actor.id, 'add_plugin_version', input.pluginId, { version })
  revalidateTag('marketplace-plugins', 'max')
  return { ok: true }
}

export async function deletePluginVersion(versionId: string): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  await db.delete(pluginVersions).where(eq(pluginVersions.id, versionId))
  await audit(actor.id, 'delete_plugin_version', versionId)
  return true
}

export async function deletePlugin(id: string): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  await db.delete(plugins).where(eq(plugins.id, id))
  await audit(actor.id, 'delete_plugin', id)
  revalidateTag('marketplace-plugins', 'max')
  return true
}

export type PluginGrant = { id: string; userId: string; label: string }

export async function listPluginAccess(pluginId: string): Promise<PluginGrant[] | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  const rows = await db
    .select({
      id: pluginAccess.id,
      userId: pluginAccess.userId,
      name: user.name,
      username: user.username,
    })
    .from(pluginAccess)
    .leftJoin(user, eq(user.id, pluginAccess.userId))
    .where(eq(pluginAccess.pluginId, pluginId))
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    label: r.username ? `@${r.username}` : r.name ?? r.userId.slice(0, 8),
  }))
}

/** Grant a hidden plugin to a user, found by @username or email. */
export async function grantPluginAccess(
  pluginId: string,
  identifier: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await requireAdmin('admin')
  if (!actor) return { ok: false, error: 'forbidden' }
  const id = identifier.trim().replace(/^@/, '').toLowerCase()
  if (!id) return { ok: false, error: 'empty' }
  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(or(ilike(user.username, id), ilike(user.email, id)))
    .limit(1)
  if (!target) return { ok: false, error: 'Пользователь не найден' }
  await db
    .insert(pluginAccess)
    .values({ pluginId, userId: target.id })
    .onConflictDoNothing()
  await audit(actor.id, 'grant_plugin', pluginId, { userId: target.id })
  return { ok: true }
}

export async function revokePluginAccess(grantId: string): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  await db.delete(pluginAccess).where(eq(pluginAccess.id, grantId))
  await audit(actor.id, 'revoke_plugin', grantId)
  return true
}

// ---- Limits (platform settings) --------------------------------------------

export async function getAdminLimits(): Promise<PlatformLimits | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  return getLimits()
}

export async function updateAdminLimits(next: PlatformLimits): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  await setLimits(next)
  await audit(actor.id, 'update_limits', '', next)
  return true
}

/**
 * Admin-initiated password reset: sends the standard reset email to the user
 * (passwords are hashed — we never see or set plaintext here). Returns whether
 * the email flow was triggered.
 */
export async function sendUserPasswordReset(userId: string): Promise<boolean> {
  const actor = await requireAdmin('admin')
  if (!actor) return false
  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  if (!row?.email) return false
  try {
    await auth.api.requestPasswordReset({ body: { email: row.email } })
    await audit(actor.id, 'reset_password', userId)
    return true
  } catch {
    return false
  }
}
