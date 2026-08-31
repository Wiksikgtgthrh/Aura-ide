'use server'

import { db } from '@/lib/db'
import { teams, teamMembers, teamRoles } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import type { Permission } from '@/lib/team-types'
import { OWNER_PERMISSIONS } from '@/lib/team-types'
import { getSession } from '@/lib/session'

export { getSession }

export async function getMemberPermissions(
  teamId: string,
  userId: string,
): Promise<Permission[]> {
  const [team] = await db
    .select({ ownerId: teams.ownerId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)
  if (!team) return []
  if (team.ownerId === userId) return OWNER_PERMISSIONS

  const [member] = await db
    .select({ roleId: teamMembers.roleId, status: teamMembers.status })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
  if (!member || member.status !== 'active') return []
  if (!member.roleId) return ['view_team', 'view_members']

  const [role] = await db
    .select({ permissions: teamRoles.permissions })
    .from(teamRoles)
    .where(eq(teamRoles.id, member.roleId))
    .limit(1)
  return ((role?.permissions as Permission[]) ?? [])
}

export async function assertPermission(teamId: string, userId: string, perm: Permission) {
  const perms = await getMemberPermissions(teamId, userId)
  if (!perms.includes(perm)) throw new Error('Недостаточно прав')
}
