'use server'

import { db } from '@/lib/db'
import { teams, teamMembers, teamRoles, teamInvites, user } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { getSession, assertPermission } from './_shared'
import type { TeamMemberItem, TeamRoleItem, InviteInfo, Permission } from '@/lib/team-types'
import { BUILT_IN_ROLES } from '@/lib/team-types'

export type { TeamMemberItem, TeamRoleItem, InviteInfo, Permission } from '@/lib/team-types'

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function getTeamMembers(teamId: string): Promise<TeamMemberItem[] | null> {
  const session = await getSession()
  if (!session) return null
  await assertPermission(teamId, session.user.id, 'view_members')

  const [team] = await db.select({ ownerId: teams.ownerId }).from(teams).where(eq(teams.id, teamId)).limit(1)
  if (!team) return null

  const rows = await db
    .select({ id: teamMembers.id, userId: teamMembers.userId, roleId: teamMembers.roleId, status: teamMembers.status, joinedAt: teamMembers.joinedAt })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
  if (!rows.length) return []

  const userIds = [...new Set(rows.map((r) => r.userId))]
  const userRows = await db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, username: user.username })
    .from(user)
    .where(inArray(user.id, userIds))
  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))

  const roleIds = [...new Set(rows.map((r) => r.roleId).filter(Boolean) as string[])]
  const roleRows = roleIds.length
    ? await db.select({ id: teamRoles.id, name: teamRoles.name }).from(teamRoles).where(inArray(teamRoles.id, roleIds))
    : []
  const roleMap = Object.fromEntries(roleRows.map((r) => [r.id, r.name]))

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: userMap[r.userId]?.name ?? '',
    email: userMap[r.userId]?.email ?? '',
    image: userMap[r.userId]?.image ?? null,
    username: userMap[r.userId]?.username ?? null,
    roleId: r.roleId,
    roleName: r.roleId ? (roleMap[r.roleId] ?? null) : null,
    status: r.status,
    joinedAt: r.joinedAt.toISOString(),
    isOwner: r.userId === team.ownerId,
  }))
}

export async function removeMember(teamId: string, memberId: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  await assertPermission(teamId, session.user.id, 'remove_members')
  const [team] = await db.select({ ownerId: teams.ownerId }).from(teams).where(eq(teams.id, teamId)).limit(1)
  const [member] = await db.select({ userId: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1)
  if (!member) return false
  if (member.userId === team?.ownerId) throw new Error('Нельзя удалить владельца')
  await db.delete(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)))
  revalidateTag('teams', 'max')
  return true
}

export async function updateMemberRole(teamId: string, memberId: string, roleId: string | null): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  await assertPermission(teamId, session.user.id, 'change_member_role')
  await db.update(teamMembers).set({ roleId }).where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)))
  return true
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function inviteByUsername(teamId: string, username: string): Promise<{ token: string } | null> {
  const session = await getSession()
  if (!session) return null
  await assertPermission(teamId, session.user.id, 'invite_members')

  const [targetUser] = await db.select({ id: user.id }).from(user).where(eq(user.username, username.replace(/^@/, ''))).limit(1)
  if (!targetUser) throw new Error('Пользователь не найден')

  const [existing] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUser.id))).limit(1)
  if (existing) throw new Error('Пользователь уже состоит в команде')

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const [invite] = await db.insert(teamInvites).values({ teamId, invitedUserId: targetUser.id, invitedByUserId: session.user.id, expiresAt }).returning({ token: teamInvites.token })
  return { token: invite.token }
}

export async function acceptInvite(token: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  const userId = session.user.id

  const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.token, token)).limit(1)
  if (!invite) throw new Error('Приглашение не найдено')
  if (invite.expiresAt < new Date()) throw new Error('Приглашение истекло')
  if (invite.invitedUserId && invite.invitedUserId !== userId) throw new Error('Приглашение предназначено другому пользователю')

  const [viewerRole] = await db.select({ id: teamRoles.id }).from(teamRoles).where(and(eq(teamRoles.teamId, invite.teamId), eq(teamRoles.name, 'Viewer'))).limit(1)
  const [existingMember] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, userId))).limit(1)

  if (!existingMember) {
    await db.insert(teamMembers).values({ teamId: invite.teamId, userId, roleId: viewerRole?.id ?? null, status: 'active' })
  } else {
    await db.update(teamMembers).set({ status: 'active' }).where(eq(teamMembers.id, existingMember.id))
  }
  await db.delete(teamInvites).where(eq(teamInvites.token, token))
  revalidateTag('teams', 'max')
  return true
}

export async function declineInvite(token: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  await db.delete(teamInvites).where(eq(teamInvites.token, token))
  return true
}

export async function getInviteInfo(token: string): Promise<InviteInfo | null> {
  const [invite] = await db.select().from(teamInvites).where(eq(teamInvites.token, token)).limit(1)
  if (!invite || invite.expiresAt < new Date()) return null
  const [team] = await db.select().from(teams).where(eq(teams.id, invite.teamId)).limit(1)
  const [inviter] = await db.select({ name: user.name }).from(user).where(eq(user.id, invite.invitedByUserId)).limit(1)
  if (!team) return null
  return { teamName: team.name, teamIcon: team.icon, invitedByName: inviter?.name ?? '', expiresAt: invite.expiresAt.toISOString(), teamId: team.id }
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function getTeamRoles(teamId: string): Promise<TeamRoleItem[] | null> {
  const session = await getSession()
  if (!session) return null
  const perms = await (await import('./_shared')).getMemberPermissions(teamId, session.user.id)
  if (!perms.includes('view_team')) return null
  const rows = await db.select().from(teamRoles).where(eq(teamRoles.teamId, teamId))
  return rows.map((r) => ({ id: r.id, teamId: r.teamId, name: r.name, permissions: (r.permissions as Permission[]) ?? [], isBuiltIn: r.isBuiltIn }))
}

export async function createCustomRole(teamId: string, name: string, permissions: Permission[]): Promise<TeamRoleItem | null> {
  const session = await getSession()
  if (!session) return null
  await assertPermission(teamId, session.user.id, 'manage_roles')
  const [row] = await db.insert(teamRoles).values({ teamId, name: name.trim().slice(0, 50), permissions, isBuiltIn: false }).returning()
  return { id: row.id, teamId: row.teamId, name: row.name, permissions: (row.permissions as Permission[]) ?? [], isBuiltIn: row.isBuiltIn }
}

export async function updateRole(roleId: string, data: { name?: string; permissions?: Permission[] }): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  const [role] = await db.select().from(teamRoles).where(eq(teamRoles.id, roleId)).limit(1)
  if (!role) return false
  if (role.isBuiltIn) throw new Error('Встроенные роли нельзя изменить')
  await assertPermission(role.teamId, session.user.id, 'manage_roles')
  const set: Record<string, unknown> = {}
  if (data.name !== undefined) set.name = data.name.trim().slice(0, 50)
  if (data.permissions !== undefined) set.permissions = data.permissions
  await db.update(teamRoles).set(set).where(eq(teamRoles.id, roleId))
  return true
}

export async function deleteRole(roleId: string): Promise<boolean> {
  const session = await getSession()
  if (!session) return false
  const [role] = await db.select().from(teamRoles).where(eq(teamRoles.id, roleId)).limit(1)
  if (!role) return false
  if (role.isBuiltIn) throw new Error('Встроенные роли нельзя удалить')
  await assertPermission(role.teamId, session.user.id, 'manage_roles')
  await db.update(teamMembers).set({ roleId: null }).where(eq(teamMembers.roleId, roleId))
  await db.delete(teamRoles).where(eq(teamRoles.id, roleId))
  return true
}


