'use server'

import { db } from '@/lib/db'
import {
  user,
  userBalance,
  apiKeys,
  chats,
  projects,
  adminAudit,
} from '@/lib/db/schema'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { decryptSecret, isEncrypted } from '@/lib/crypto'
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
