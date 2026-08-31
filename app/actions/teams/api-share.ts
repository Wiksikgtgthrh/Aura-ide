'use server'

import { db } from '@/lib/db'
import { teamApiShares, projectTeamAccess, apiKeys, projects } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getSession, assertPermission } from './_shared'
import { decryptSecret } from '@/lib/crypto'
import type { TeamApiShareItem, ProjectAccessItem, Permission } from '@/lib/team-types'

export type { TeamApiShareItem, ProjectAccessItem } from '@/lib/team-types'

// ---------------------------------------------------------------------------
// API sharing
// ---------------------------------------------------------------------------

export async function getSharedApis(teamId: string): Promise<TeamApiShareItem[] | null> {
  const session = await getSession()
  if (!session) return null
  const perms = await (await import('./_shared')).getMemberPermissions(teamId, session.user.id)
  if (!perms.includes('view_api')) return null
  const isOwnerOrFull = perms.includes('share_api_full')

  const rows = await db
    .select({ id: teamApiShares.id, apiKeyId: teamApiShares.apiKeyId, accessLevel: teamApiShares.accessLevel, sharedAt: teamApiShares.sharedAt, keyName: apiKeys.name, modelId: apiKeys.modelId, key: apiKeys.key, baseUrl: apiKeys.baseUrl })
    .from(teamApiShares)
    .innerJoin(apiKeys, eq(teamApiShares.apiKeyId, apiKeys.id))
    .where(eq(teamApiShares.teamId, teamId))

  return rows.map((r) => {
    const item: TeamApiShareItem = { id: r.id, apiKeyId: r.apiKeyId, keyName: r.keyName, modelId: r.modelId, accessLevel: r.accessLevel, sharedAt: r.sharedAt.toISOString() }
    if (r.accessLevel === 'full' && isOwnerOrFull) { item.maskedKey = `${decryptSecret(r.key).slice(0, 4)}••••`; item.baseUrl = r.baseUrl }
    return item
  })
}

export async function shareApiWithTeam(apiKeyId: number, teamId: string, accessLevel: 'readonly' | 'full'): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  const requiredPerm: Permission = accessLevel === 'full' ? 'share_api_full' : 'share_api_readonly'
  await assertPermission(teamId, session.user.id, requiredPerm)
  const [key] = await db.select({ userId: apiKeys.userId }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1)
  if (!key || key.userId !== session.user.id) throw new Error('API ключ не найден')
  const [existing] = await db.select({ id: teamApiShares.id }).from(teamApiShares).where(and(eq(teamApiShares.apiKeyId, apiKeyId), eq(teamApiShares.teamId, teamId))).limit(1)
  if (existing) { await db.update(teamApiShares).set({ accessLevel }).where(eq(teamApiShares.id, existing.id)) }
  else { await db.insert(teamApiShares).values({ teamId, apiKeyId, accessLevel, sharedByUserId: session.user.id }) }
  return true
}

export async function updateApiShareLevel(shareId: string, newLevel: 'readonly' | 'full'): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  const [share] = await db.select().from(teamApiShares).where(eq(teamApiShares.id, shareId)).limit(1)
  if (!share) return false
  const perm: Permission = newLevel === 'full' ? 'share_api_full' : 'share_api_readonly'
  await assertPermission(share.teamId, session.user.id, perm)
  await db.update(teamApiShares).set({ accessLevel: newLevel }).where(eq(teamApiShares.id, shareId))
  return true
}

export async function revokeApiShare(shareId: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  const [share] = await db.select().from(teamApiShares).where(eq(teamApiShares.id, shareId)).limit(1)
  if (!share) return false
  await assertPermission(share.teamId, session.user.id, 'revoke_api')
  await db.delete(teamApiShares).where(eq(teamApiShares.id, shareId))
  return true
}

// ---------------------------------------------------------------------------
// Project access
// ---------------------------------------------------------------------------

export async function grantProjectAccess(projectId: number, teamId: string, accessLevel: 'read' | 'edit' | 'admin'): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  await assertPermission(teamId, session.user.id, 'grant_project_access')
  const [existing] = await db.select({ id: projectTeamAccess.id }).from(projectTeamAccess).where(and(eq(projectTeamAccess.projectId, projectId), eq(projectTeamAccess.teamId, teamId))).limit(1)
  if (existing) { await db.update(projectTeamAccess).set({ accessLevel }).where(eq(projectTeamAccess.id, existing.id)) }
  else { await db.insert(projectTeamAccess).values({ projectId, teamId, accessLevel, grantedByUserId: session.user.id }) }
  return true
}

export async function revokeProjectAccess(projectId: number, teamId: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  await assertPermission(teamId, session.user.id, 'revoke_project_access')
  await db.delete(projectTeamAccess).where(and(eq(projectTeamAccess.projectId, projectId), eq(projectTeamAccess.teamId, teamId)))
  return true
}

export async function getProjectTeamAccess(teamId: string): Promise<ProjectAccessItem[] | null> {
  const session = await getSession()
  if (!session) return null
  const perms = await (await import('./_shared')).getMemberPermissions(teamId, session.user.id)
  if (!perms.includes('view_team')) return null
  const rows = await db
    .select({ id: projectTeamAccess.id, projectId: projectTeamAccess.projectId, accessLevel: projectTeamAccess.accessLevel, grantedAt: projectTeamAccess.grantedAt, projectName: projects.name })
    .from(projectTeamAccess)
    .innerJoin(projects, eq(projectTeamAccess.projectId, projects.id))
    .where(eq(projectTeamAccess.teamId, teamId))
  return rows.map((r) => ({ id: r.id, projectId: r.projectId, projectName: r.projectName, accessLevel: r.accessLevel, grantedAt: r.grantedAt.toISOString() }))
}
