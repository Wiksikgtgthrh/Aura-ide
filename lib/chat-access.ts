import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { chats, projectTeamAccess, teamMembers, teamRoles, teams } from '@/lib/db/schema'

export type ChatAccessLevel = 'owner' | 'edit' | 'read'

export type ChatAccess = {
  level: ChatAccessLevel
  chat: {
    id: string
    title: string
    mode: string
    userId: string
    projectId: number | null
  }
}

/**
 * Resolve what a user may do with a chat.
 *
 * - The chat's creator is 'owner'.
 * - Otherwise, if the chat belongs to a project that was shared with a team
 *   (project_team_access) and the user is an ACTIVE member of that team (or
 *   the team's owner), access flows from the share level:
 *     'read'          → read  (open the chat, browse code/preview)
 *     'edit' | 'admin' → edit (send messages, edit files, restore versions)
 *
 * Returns null when the user has no access at all.
 */
export async function getChatAccess(
  chatId: string,
  userId: string,
): Promise<ChatAccess | null> {
  const [chat] = await db
    .select({
      id: chats.id,
      title: chats.title,
      mode: chats.mode,
      userId: chats.userId,
      projectId: chats.projectId,
    })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1)
  if (!chat) return null

  if (chat.userId === userId) return { level: 'owner', chat }
  if (!chat.projectId) return null

  // Shares of this project → teams where the user is an active member.
  // The member's team ROLE caps the effective level: a "Viewer" role is
  // read-only even when the project share itself allows editing.
  const memberRows = await db
    .select({
      accessLevel: projectTeamAccess.accessLevel,
      roleName: teamRoles.name,
    })
    .from(projectTeamAccess)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projectTeamAccess.teamId))
    .leftJoin(teamRoles, eq(teamRoles.id, teamMembers.roleId))
    .where(
      and(
        eq(projectTeamAccess.projectId, chat.projectId),
        eq(teamMembers.userId, userId),
        eq(teamMembers.status, 'active'),
      ),
    )

  // Team OWNERS are not listed in team_members — check owned teams too.
  const ownerRows = await db
    .select({ accessLevel: projectTeamAccess.accessLevel })
    .from(projectTeamAccess)
    .innerJoin(teams, eq(teams.id, projectTeamAccess.teamId))
    .where(
      and(
        eq(projectTeamAccess.projectId, chat.projectId),
        eq(teams.ownerId, userId),
      ),
    )

  if (memberRows.length === 0 && ownerRows.length === 0) return null

  const canEdit =
    ownerRows.some((r) => r.accessLevel === 'edit' || r.accessLevel === 'admin') ||
    memberRows.some(
      (r) =>
        (r.accessLevel === 'edit' || r.accessLevel === 'admin') &&
        r.roleName !== 'Viewer',
    )
  return { level: canEdit ? 'edit' : 'read', chat }
}
