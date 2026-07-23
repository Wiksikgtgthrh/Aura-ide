'use server'

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { projects, projectTeamAccess, teams, teamRoles } from '@/lib/db/schema'
import { BUILT_IN_ROLES } from '@/lib/team-types'
import { getSession } from '@/lib/session'

const PERSONAL_TEAM_NAME = 'Личный воркспейс'

/**
 * The Settings → Members page manages the user's PERSONAL workspace — a
 * lazily-created team owned by the user. Members invited here get access to
 * the projects the user shares with this workspace (roles → access level).
 */
export async function ensurePersonalTeam(): Promise<{ teamId: string } | null> {
  const session = await getSession()
  if (!session?.user) return null
  const userId = session.user.id

  const [existing] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.ownerId, userId), eq(teams.name, PERSONAL_TEAM_NAME)))
    .limit(1)
  if (existing) return { teamId: existing.id }

  const [team] = await db
    .insert(teams)
    .values({
      ownerId: userId,
      name: PERSONAL_TEAM_NAME,
      description: 'Участники ваших проектов',
      icon: '👥',
    })
    .returning({ id: teams.id })

  await db.insert(teamRoles).values(
    BUILT_IN_ROLES.map((r) => ({
      teamId: team.id,
      name: r.name,
      permissions: r.permissions,
      isBuiltIn: true,
    })),
  )

  return { teamId: team.id }
}

export type WorkspaceProjectShare = {
  projectId: number
  name: string
  accessLevel: 'read' | 'edit' | 'admin' | null
}

/**
 * The user's own projects together with the access level currently granted
 * to the personal workspace (null = not shared).
 */
export async function getWorkspaceProjectShares(
  teamId: string,
): Promise<WorkspaceProjectShare[]> {
  const session = await getSession()
  if (!session?.user) return []
  const userId = session.user.id

  const [own, shares] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.userId, userId)),
    db
      .select({
        projectId: projectTeamAccess.projectId,
        accessLevel: projectTeamAccess.accessLevel,
      })
      .from(projectTeamAccess)
      .where(eq(projectTeamAccess.teamId, teamId)),
  ])

  const levelByProject = new Map(shares.map((s) => [s.projectId, s.accessLevel]))
  return own.map((p) => ({
    projectId: p.id,
    name: p.name,
    accessLevel: (levelByProject.get(p.id) as WorkspaceProjectShare['accessLevel']) ?? null,
  }))
}
