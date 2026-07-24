'use server'

import { db } from '@/lib/db'
import {
  user,
  userBalance,
  apiKeys,
  chats,
  projects,
  adminAudit,
  plans,
  platformApiKeys,
  transactions,
} from '@/lib/db/schema'
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { decryptSecret, encryptSecret, isEncrypted } from '@/lib/crypto'
import { auth } from '@/lib/auth'
import { requireAdmin, type Role } from '@/lib/admin'
import { dockerContainerStats, type ContainerStat } from '@/lib/terminal'
import { getLimits, setLimits, type PlatformLimits } from '@/lib/platform-settings'

export type AdminOverview = {
  totals: { users: number; guests: number; projects: number; chats: number }
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

  const [[users], [guests], [projCount], [chatCount]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.isAnonymous, false)),
    db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.isAnonymous, true)),
    db.select({ n: sql<number>`count(*)::int` }).from(projects),
    db.select({ n: sql<number>`count(*)::int` }).from(chats),
  ])

  const containers = dockerContainerStats()
  return {
    totals: {
      users: users?.n ?? 0,
      guests: guests?.n ?? 0,
      projects: projCount?.n ?? 0,
      chats: chatCount?.n ?? 0,
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
      key: isEncrypted(k.key) ? decryptSecret(k.key) : k.key,
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
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export async function listPlanApiKeys(planKey: string): Promise<AdminPlanKey[] | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  const rows = await db
    .select()
    .from(platformApiKeys)
    .where(eq(platformApiKeys.planKey, planKey))
    .orderBy(desc(platformApiKeys.createdAt))
  return rows.map((r) => ({
    id: r.id,
    planKey: r.planKey,
    label: r.label,
    maskedKey: maskKey(isEncrypted(r.key) ? decryptSecret(r.key) : r.key),
    modelId: r.modelId,
    baseUrl: r.baseUrl,
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
