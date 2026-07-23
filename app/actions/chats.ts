'use server'

import { db } from '@/lib/db'
import { chats } from '@/lib/db/schema'
import {
  createChatForUser,
  listChatsForUser,
  type ChatListItem,
  type ChatMode,
} from '@/lib/chat-store'

// ChatListItem is intentionally not re-exported here — Server Actions files
// cannot re-export types in Turbopack. Import it directly from @/lib/chat-store.

import { and, eq } from 'drizzle-orm'
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
