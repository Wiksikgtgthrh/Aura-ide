'use server'

import { db } from '@/lib/db'
import { teams, teamMembers, teamRoles } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidateTag, unstable_cache } from 'next/cache'
import { getSession, assertPermission, getMemberPermissions } from './_shared'
import type { TeamItem } from '@/lib/team-types'
import { BUILT_IN_ROLES } from '@/lib/team-types'

export type { TeamItem } from '@/lib/team-types'

async function fetchTeamsForUser(userId: string): Promise<TeamItem[]> {
  const owned = await db.select().from(teams).where(eq(teams.ownerId, userId))

  const memberRows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'active')))

  const memberTeamIds = memberRows.map((r) => r.teamId).filter((id) => !owned.find((t) => t.id === id))
  const memberTeams = memberTeamIds.length
    ? await db.select().from(teams).where(inArray(teams.id, memberTeamIds))
    : []

  const allTeams = [...owned, ...memberTeams]
  if (!allTeams.length) return []

  const allTeamIds = allTeams.map((t) => t.id)
  const memberCounts = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(inArray(teamMembers.teamId, allTeamIds), eq(teamMembers.status, 'active')))

  const countMap: Record<string, number> = {}
  for (const r of memberCounts) countMap[r.teamId] = (countMap[r.teamId] ?? 0) + 1

  const myRoleRows = memberTeamIds.length
    ? await db
        .select({ teamId: teamMembers.teamId, roleId: teamMembers.roleId })
        .from(teamMembers)
        .where(and(eq(teamMembers.userId, userId), inArray(teamMembers.teamId, memberTeamIds)))
    : []

  const roleIdSet = [...new Set(myRoleRows.map((r) => r.roleId).filter(Boolean) as string[])]
  const roleNames: Record<string, string> = {}
  if (roleIdSet.length) {
    const roleRows = await db.select({ id: teamRoles.id, name: teamRoles.name }).from(teamRoles).where(inArray(teamRoles.id, roleIdSet))
    for (const r of roleRows) roleNames[r.id] = r.name
  }

  const myRoleMap: Record<string, string> = {}
  for (const r of myRoleRows) myRoleMap[r.teamId] = r.roleId ? (roleNames[r.roleId] ?? 'Member') : 'Member'

  return allTeams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    ownerId: t.ownerId,
    memberCount: countMap[t.id] ?? 0,
    myRole: t.ownerId === userId ? 'owner' : (myRoleMap[t.id] ?? 'Member'),
    createdAt: t.createdAt.toISOString(),
  }))
}

export async function getTeams(): Promise<TeamItem[] | null> {
  const session = await getSession()
  if (!session) return null
  const userId = session.user.id
  return unstable_cache(
    () => fetchTeamsForUser(userId),
    ['teams', userId],
    { tags: ['teams'], revalidate: 120 },
  )()
}

/** Use when userId is already known (e.g. in a server page). */
export async function getTeamsForUser(userId: string): Promise<TeamItem[]> {
  return unstable_cache(
    () => fetchTeamsForUser(userId),
    ['teams', userId],
    { tags: ['teams'], revalidate: 120 },
  )()
}

export async function createTeam(name: string, description?: string): Promise<TeamItem | null> {
  const session = await getSession()
  if (!session) return null
  const userId = session.user.id
  const trimName = name.trim().slice(0, 100)
  if (!trimName) throw new Error('Название обязательно')

  const [team] = await db
    .insert(teams)
    .values({ ownerId: userId, name: trimName, description: (description ?? '').trim().slice(0, 500) })
    .returning()

  await db.insert(teamRoles).values(
    BUILT_IN_ROLES.map((r) => ({ teamId: team.id, name: r.name, permissions: r.permissions, isBuiltIn: true })),
  )

  revalidateTag('teams', 'max')
  return { id: team.id, name: team.name, description: team.description, icon: team.icon, ownerId: team.ownerId, memberCount: 0, myRole: 'owner', createdAt: team.createdAt.toISOString() }
}

export async function updateTeam(teamId: string, data: { name?: string; description?: string; icon?: string | null }): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  await assertPermission(teamId, session.user.id, 'edit_team')
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) set.name = data.name.trim().slice(0, 100)
  if (data.description !== undefined) set.description = data.description.trim().slice(0, 500)
  if (data.icon !== undefined) set.icon = data.icon
  await db.update(teams).set(set).where(eq(teams.id, teamId))
  revalidateTag('teams', 'max')
  return true
}

export async function deleteTeam(teamId: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  await assertPermission(teamId, session.user.id, 'delete_team')
  await db.delete(teams).where(eq(teams.id, teamId))
  revalidateTag('teams', 'max')
  return true
}

export async function getTeamDetail(teamId: string): Promise<TeamItem | null> {
  const session = await getSession()
  if (!session) return null
  const userId = session.user.id
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
  if (!team) return null
  const perms = await getMemberPermissions(teamId, userId)
  if (!perms.includes('view_team')) return null
  const memberRows = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, 'active')))
  return { id: team.id, name: team.name, description: team.description, icon: team.icon, ownerId: team.ownerId, memberCount: memberRows.length, myRole: team.ownerId === userId ? 'owner' : 'member', createdAt: team.createdAt.toISOString() }
}
