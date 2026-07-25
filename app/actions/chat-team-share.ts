'use server'

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { chats, projects, projectTeamAccess, teams } from '@/lib/db/schema'
import { getSession } from '@/lib/session'
import { grantProjectAccess, revokeProjectAccess } from '@/app/actions/teams/api-share'

/**
 * Прямой командный доступ к чат-проекту со страницы «Проекты».
 *
 * Механика доступа существовала и раньше, но была спрятана за цепочкой:
 * чат → привязка к «папке» (projects) → шара папки команде
 * (project_team_access) → роль участника в команде каппит уровень
 * (см. lib/chat-access.ts). Эти экшены сворачивают цепочку в один клик:
 * если у чата ещё нет папки — создаём скрытую папку с именем чата и
 * привязываем автоматически.
 */

export type ChatTeamShare = {
  teamId: string
  teamName: string
  accessLevel: 'read' | 'edit' | 'admin'
}

async function getOwnedChat(chatId: string, userId: string) {
  const [chat] = await db
    .select({ id: chats.id, title: chats.title, projectId: chats.projectId })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1)
  return chat ?? null
}

/** Текущие командные шары чат-проекта (пусто, если папки ещё нет). */
export async function getChatTeamShares(chatId: string): Promise<ChatTeamShare[]> {
  const session = await getSession()
  if (!session?.user) return []
  const chat = await getOwnedChat(chatId, session.user.id)
  if (!chat?.projectId) return []
  const rows = await db
    .select({
      teamId: projectTeamAccess.teamId,
      teamName: teams.name,
      accessLevel: projectTeamAccess.accessLevel,
    })
    .from(projectTeamAccess)
    .innerJoin(teams, eq(teams.id, projectTeamAccess.teamId))
    .where(eq(projectTeamAccess.projectId, chat.projectId))
  return rows.map((r) => ({
    teamId: r.teamId,
    teamName: r.teamName,
    accessLevel: (r.accessLevel as ChatTeamShare['accessLevel']) ?? 'read',
  }))
}

/**
 * Дать команде доступ к чат-проекту с уровнем read/edit/admin.
 * Папка-контейнер создаётся автоматически (прямым insert — админский лимит
 * проектов не блокирует техническую папку шаринга).
 */
export async function shareChatWithTeam(
  chatId: string,
  teamId: string,
  accessLevel: 'read' | 'edit' | 'admin',
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession()
  if (!session?.user) return { ok: false, error: 'Unauthorized' }
  const chat = await getOwnedChat(chatId, session.user.id)
  if (!chat) return { ok: false, error: 'Проект не найден' }

  let projectId = chat.projectId
  if (!projectId) {
    const [created] = await db
      .insert(projects)
      .values({ userId: session.user.id, name: chat.title.slice(0, 100) || 'Проект' })
      .returning({ id: projects.id })
    if (!created) return { ok: false, error: 'Не удалось создать контейнер проекта' }
    projectId = created.id
    await db.update(chats).set({ projectId }).where(eq(chats.id, chatId))
  }

  // grantProjectAccess проверяет право 'grant_project_access' в команде
  // (и бросает «Недостаточно прав» — превращаем в понятный ответ).
  try {
    const ok = await grantProjectAccess(projectId, teamId, accessLevel)
    return ok
      ? { ok: true }
      : { ok: false, error: 'Нет права выдавать доступ в этой команде' }
  } catch {
    return { ok: false, error: 'Нет права выдавать доступ в этой команде' }
  }
}

/** Забрать у команды доступ к чат-проекту. */
export async function revokeChatTeamShare(
  chatId: string,
  teamId: string,
): Promise<boolean> {
  const session = await getSession()
  if (!session?.user) return false
  const chat = await getOwnedChat(chatId, session.user.id)
  if (!chat?.projectId) return false
  try {
    return await revokeProjectAccess(chat.projectId, teamId)
  } catch {
    return false
  }
}
