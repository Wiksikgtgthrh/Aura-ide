'use server'

import { generateId } from 'ai'
import { db } from '@/lib/db'
import { chats, messages, projectFiles } from '@/lib/db/schema'
import {
  createChatForUser,
  listChatsForUser,
  type ChatListItem,
  type ChatMode,
} from '@/lib/chat-store'

// ChatListItem is intentionally not re-exported here — Server Actions files
// cannot re-export types in Turbopack. Import it directly from @/lib/chat-store.

import { and, asc, eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { getSession } from '@/lib/session'

async function getUserIdOrNull() {
  const session = await getSession()
  return session?.user?.id ?? null
}

export async function createChat(title: string, mode: ChatMode = 'html', externalId?: string): Promise<string | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const id = await createChatForUser(userId, title, mode, externalId)
  revalidateTag('chats', 'max')
  return id
}

/**
 * Full copy of a chat: new chat row + copies of all messages and project
 * files. Returns the new chat id (navigate to /chat/{id}).
 */
export async function duplicateChat(id: string): Promise<string | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const [src] = await db
    .select({ title: chats.title, mode: chats.mode })
    .from(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
    .limit(1)
  if (!src) return null

  const newId = await createChatForUser(
    userId,
    `${src.title} (копия)`.slice(0, 100),
    (src.mode as ChatMode) ?? 'html',
  )
  if (!newId) return null

  const msgRows = await db
    .select({ role: messages.role, parts: messages.parts })
    .from(messages)
    .where(eq(messages.chatId, id))
    .orderBy(asc(messages.createdAt))
  if (msgRows.length > 0) {
    await db.insert(messages).values(
      msgRows.map((m, i) => ({
        id: generateId(),
        chatId: newId,
        role: m.role,
        parts: m.parts,
        createdAt: new Date(Date.now() + i),
      })),
    )
  }

  const fileRows = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.chatId, id))
  if (fileRows.length > 0) {
    await db.insert(projectFiles).values(
      fileRows.map((f) => ({
        chatId: newId,
        path: f.path,
        content: f.content,
        updatedAt: new Date(),
      })),
    )
  }

  revalidateTag('chats', 'max')
  return newId
}

export async function getChats(): Promise<ChatListItem[]> {
  const userId = await getUserIdOrNull()
  if (!userId) return []
  return listChatsForUser(userId)
}

/** Direct version that skips getSession() — use when userId is already known. */
export async function getChatsForUser(userId: string): Promise<ChatListItem[]> {
  return listChatsForUser(userId)
}

export async function renameChat(id: string, title: string): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  const trimmed = title.trim().slice(0, 100)
  if (!trimmed) return
  await db
    .update(chats)
    .set({ title: trimmed })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
  revalidateTag('chats', 'max')
}

export async function toggleFavoriteChat(
  id: string,
  favorite: boolean,
): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  await db
    .update(chats)
    .set({ favorite })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
  revalidateTag('chats', 'max')
}

export async function deleteChat(id: string): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  await db
    .delete(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
  revalidateTag('chats', 'max')
}

export async function attachChatToProject(
  chatId: string,
  projectId: number | null,
): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  await db
    .update(chats)
    .set({ projectId })
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
  revalidateTag('chats', 'max')
}
