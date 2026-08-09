'use server'

import { and, asc, desc, eq, like, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  farmAssignments,
  farmKeyGroups,
  farmKeys,
  farmUsageLog,
  user,
} from '@/lib/db/schema'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { requireAdmin } from '@/lib/admin'
import { getSession } from '@/lib/session'
import { FARM_COOLDOWN_MS, restoreReadyKeys, v0Probe, type FarmKeyStatus } from '@/lib/farm'

export type FarmKeyRow = {
  id: string
  groupId: string
  groupName: string
  label: string
  masked: string
  status: FarmKeyStatus
  cooldownUntil: string | null
  cooldownReason: string
  lastUsedAt: string | null
  lastError: string
  usageCount: number
  createdAt: string
}

export type FarmGroupRow = {
  id: string
  name: string
  description: string
  keyCount: number
  readyCount: number
  cooldownCount: number
}

export type FarmAssignmentRow = {
  id: string
  groupId: string
  groupName: string
  targetType: string
  targetId: string
}

export type FarmLogRow = {
  id: string
  userName: string
  status: string
  error: string
  createdAt: string
}

export type FarmOverview = {
  groups: FarmGroupRow[]
  keys: FarmKeyRow[]
  assignments: FarmAssignmentRow[]
  logs: FarmLogRow[]
}

function maskV0Key(encrypted: string): string {
  try {
    const plain = decryptSecret(encrypted)
    if (!plain || plain.length <= 12) return '***'
    return `…${plain.slice(-10)}`
  } catch {
    return '(не расшифровывается)'
  }
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

// ---- Admin: обзор ----------------------------------------------------------

export async function getFarmOverview(): Promise<FarmOverview | null> {
  const actor = await requireAdmin('admin')
  if (!actor) return null
  try {
    await restoreReadyKeys()

    const [groups, keys, assignments, logs] = await Promise.all([
      db.select().from(farmKeyGroups).orderBy(asc(farmKeyGroups.createdAt)),
      db.select().from(farmKeys).orderBy(desc(farmKeys.createdAt)),
      db
        .select({
          id: farmAssignments.id,
          groupId: farmAssignments.groupId,
          groupName: farmKeyGroups.name,
          targetType: farmAssignments.targetType,
          targetId: farmAssignments.targetId,
        })
        .from(farmAssignments)
        .innerJoin(farmKeyGroups, eq(farmAssignments.groupId, farmKeyGroups.id))
        .orderBy(desc(farmAssignments.createdAt)),
      db
        .select({
          id: farmUsageLog.id,
          userName: user.name,
          status: farmUsageLog.status,
          error: farmUsageLog.error,
          createdAt: farmUsageLog.createdAt,
        })
        .from(farmUsageLog)
        .leftJoin(user, eq(farmUsageLog.userId, user.id))
        .orderBy(desc(farmUsageLog.createdAt))
        .limit(50),
    ])

    const groupName = new Map(groups.map((g) => [g.id, g.name]))

    return {
      groups: groups.map((g) => {
        const gk = keys.filter((k) => k.groupId === g.id)
        return {
          id: g.id,
          name: g.name,
          description: g.description,
          keyCount: gk.length,
          readyCount: gk.filter((k) => k.status === 'ready').length,
          cooldownCount: gk.filter((k) => k.status === 'cooldown').length,
        }
      }),
      keys: keys.map((k) => ({
        id: k.id,
        groupId: k.groupId,
        groupName: groupName.get(k.groupId) ?? '?',
        label: k.label,
        masked: maskV0Key(k.key),
        status: k.status as FarmKeyStatus,
        cooldownUntil: iso(k.cooldownUntil),
        cooldownReason: k.cooldownReason,
        lastUsedAt: iso(k.lastUsedAt),
        lastError: k.lastError,
        usageCount: k.usageCount,
        createdAt: iso(k.createdAt),
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        groupId: a.groupId,
        groupName: a.groupName,
        targetType: a.targetType,
        targetId: a.targetId,
      })),
      logs: logs.map((l) => ({
        id: l.id,
        userName: l.userName ?? '?',
        status: l.status,
        error: l.error,
        createdAt: iso(l.createdAt) ?? '',
      })),
    }
  } catch {
    return null
  }
}

// ---- Admin: группы ---------------------------------------------------------

export async function createFarmGroup(name: string, description = ''): Promise<boolean> {
  if (!(await requireAdmin('admin'))) return false
  const clean = name.trim().slice(0, 80)
  if (!clean) return false
  try {
    await db.insert(farmKeyGroups).values({
      name: clean,
      description: description.trim().slice(0, 300),
    })
    return true
  } catch {
    return false
  }
}

export async function updateFarmGroup(id: string, name: string, description = ''): Promise<boolean> {
  if (!(await requireAdmin('admin'))) return false
  const clean = name.trim().slice(0, 80)
  if (!clean) return false
  try {
    await db
      .update(farmKeyGroups)
      .set({ name: clean, description: description.trim().slice(0, 300), updatedAt: new Date() })
      .where(eq(farmKeyGroups.id, id))
    return true
  } catch {
    return false
  }
}

export async function deleteFarmGroup(id: string): Promise<boolean> {
  if (!(await requireAdmin('admin'))) return false
  try {
    await db.delete(farmKeyGroups).where(eq(farmKeyGroups.id, id))
    return true
  } catch {
    return false
  }
}

// ---- Admin: ключи ----------------------------------------------------------

export async function addFarmKey(
  groupId: string,
  label: string,
  rawKey: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin('admin'))) return { ok: false, error: 'Unauthorized' }
  const token = rawKey.trim()
  if (!/^Bearer\s+vcp_/i.test(token)) {
    return {
      ok: false,
      error: 'Ключ должен быть вида «Bearer vcp_…» (полный Authorization-заголовок v0).',
    }
  }
  try {
    const group = await db
      .select({ id: farmKeyGroups.id })
      .from(farmKeyGroups)
      .where(eq(farmKeyGroups.id, groupId))
    if (group.length === 0) return { ok: false, error: 'Группа не найдена' }
    await db.insert(farmKeys).values({
      groupId,
      label: label.trim().slice(0, 80),
      key: encryptSecret(token),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ошибка БД' }
  }
}

export async function deleteFarmKey(id: string): Promise<boolean> {
  if (!(await requireAdmin('admin'))) return false
  try {
    await db.delete(farmKeys).where(eq(farmKeys.id, id))
    return true
  } catch {
    return false
  }
}

export async function setFarmKeyStatus(
  id: string,
  status: FarmKeyStatus,
): Promise<boolean> {
  if (!(await requireAdmin('admin'))) return false
  try {
    const set: Partial<typeof farmKeys.$inferInsert> = { status, updatedAt: new Date() }
    if (status === 'cooldown') {
      set.cooldownUntil = new Date(Date.now() + FARM_COOLDOWN_MS)
      set.cooldownReason = 'Вручную администратором'
    } else if (status === 'ready') {
      set.cooldownUntil = null
      set.cooldownReason = ''
    }
    await db.update(farmKeys).set(set).where(eq(farmKeys.id, id))
    return true
  } catch {
    return false
  }
}

/** Реальная проверка ключа запросом к API v0 (GET /chats?limit=1). */
export async function probeFarmKey(id: string): Promise<{
  ok: boolean
  status: FarmKeyStatus
  detail: string
}> {
  if (!(await requireAdmin('admin'))) return { ok: false, status: 'disabled', detail: 'Unauthorized' }
  try {
    const rows = await db.select({ key: farmKeys.key }).from(farmKeys).where(eq(farmKeys.id, id))
    if (rows.length === 0) return { ok: false, status: 'disabled', detail: 'Ключ не найден' }
    const token = decryptSecret(rows[0].key)
    const result = await v0Probe(token)
    if (result === 'ok') {
      await db
        .update(farmKeys)
        .set({
          status: 'ready',
          cooldownUntil: null,
          cooldownReason: '',
          lastError: '',
          updatedAt: new Date(),
        })
        .where(eq(farmKeys.id, id))
      return { ok: true, status: 'ready', detail: 'API v0 ответил 200 — ключ рабочий' }
    }
    if (result === 'dead') {
      await db
        .update(farmKeys)
        .set({
          status: 'disabled',
          cooldownUntil: null,
          cooldownReason: 'Проверка: 401/403',
          lastError: 'v0 отклонил ключ (401/403)',
          updatedAt: new Date(),
        })
        .where(eq(farmKeys.id, id))
      return { ok: false, status: 'disabled', detail: 'v0 отклонил ключ (401/403) — отключён' }
    }
    return { ok: false, status: 'cooldown', detail: 'Сеть/таймаут — попробуйте ещё раз' }
  } catch {
    return { ok: false, status: 'cooldown', detail: 'Ошибка проверки' }
  }
}

// ---- Admin: выдачи ---------------------------------------------------------

export async function addFarmAssignment(
  groupId: string,
  targetType: string,
  targetId = '',
): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireAdmin('admin'))) return { ok: false, error: 'Unauthorized' }
  if (!['user', 'plan', 'admin', 'all'].includes(targetType)) {
    return { ok: false, error: 'Неверный тип выдачи' }
  }
  if (targetType === 'user' && !targetId.trim()) return { ok: false, error: 'Выберите пользователя' }
  if (targetType === 'plan' && !targetId.trim()) return { ok: false, error: 'Выберите тариф' }
  try {
    const group = await db
      .select({ id: farmKeyGroups.id })
      .from(farmKeyGroups)
      .where(eq(farmKeyGroups.id, groupId))
    if (group.length === 0) return { ok: false, error: 'Группа не найдена' }
    const dup = await db
      .select({ id: farmAssignments.id })
      .from(farmAssignments)
      .where(
        and(
          eq(farmAssignments.groupId, groupId),
          eq(farmAssignments.targetType, targetType),
          eq(farmAssignments.targetId, targetType === 'user' || targetType === 'plan' ? targetId.trim() : ''),
        ),
      )
    if (dup.length > 0) return { ok: false, error: 'Такая выдача уже существует' }
    await db.insert(farmAssignments).values({
      groupId,
      targetType,
      targetId: targetType === 'user' || targetType === 'plan' ? targetId.trim() : '',
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ошибка БД' }
  }
}

export async function removeFarmAssignment(id: string): Promise<boolean> {
  if (!(await requireAdmin('admin'))) return false
  try {
    await db.delete(farmAssignments).where(eq(farmAssignments.id, id))
    return true
  } catch {
    return false
  }
}

export async function searchFarmUsers(q: string): Promise<{ id: string; name: string; email: string }[]> {
  if (!(await requireAdmin('admin'))) return []
  const needle = q.trim()
  if (!needle) return []
  const escaped = needle.replace(/[%_\\]/g, (m) => `\\${m}`)
  try {
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(or(like(user.name, `%${escaped}%`), like(user.email, `%${escaped}%`)))
      .limit(20)
    return rows
  } catch {
    return []
  }
}

// ---- Пользователь: доступ и генерация ---------------------------------------

export async function getMyFarmAccess(): Promise<{
  hasAccess: boolean
  readyKeys: number
  groupCount: number
}> {
  const session = await getSession()
  if (!session?.user) return { hasAccess: false, readyKeys: 0, groupCount: 0 }
  try {
    const { getAssignedGroupIdsForUser, getReadyKeysForUser } = await import('@/lib/farm')
    const groupIds = await getAssignedGroupIdsForUser(session.user.id)
    if (groupIds.length === 0) return { hasAccess: false, readyKeys: 0, groupCount: 0 }
    const keys = await getReadyKeysForUser(session.user.id)
    return { hasAccess: keys.length > 0, readyKeys: keys.length, groupCount: groupIds.length }
  } catch {
    return { hasAccess: false, readyKeys: 0, groupCount: 0 }
  }
}

export async function getFarmPlans(): Promise<{ key: string; title: string }[]> {
  if (!(await requireAdmin('admin'))) return []
  try {
    const { plans } = await import('@/lib/db/schema')
    const rows = await db.select({ key: plans.key, title: plans.title }).from(plans)
    return rows
  } catch {
    return []
  }
}
