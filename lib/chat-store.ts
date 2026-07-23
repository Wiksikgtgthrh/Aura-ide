import 'server-only'
import type { UIMessage } from 'ai'
import { generateId } from 'ai'
import { db } from '@/lib/db'
import { chats, messages, projectFiles, projectCheckpoints } from '@/lib/db/schema'
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm'
import { unstable_cache, revalidateTag } from 'next/cache'

export type ChatMode = 'html' | 'ide'

export type ChatListItem = {
  id: string
  title: string
  favorite: boolean
  updatedAt: string
}

export async function createChatForUser(
  userId: string,
  title: string,
  mode: ChatMode = 'html',
  externalId?: string,
): Promise<string> {
  const id = externalId ?? generateId()
  await db.insert(chats).values({
    id,
    userId,
    title: title.trim().slice(0, 100) || 'New chat',
    mode,
  })
  return id
}

export async function getChatOwned(chatId: string, userId: string) {
  const [chat] = await db
    .select({
      id: chats.id,
      title: chats.title,
      favorite: chats.favorite,
      mode: chats.mode,
      userId: chats.userId,
      projectId: chats.projectId,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
    })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1)
  return chat ?? null
}

export function loadChatMessages(chatId: string): Promise<UIMessage[]> {
  return unstable_cache(
    async () => {
      const rows = await db
        .select({ id: messages.id, role: messages.role, parts: messages.parts })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt))
      return rows.map((r) => ({
        id: r.id,
        role: r.role as UIMessage['role'],
        parts: r.parts as UIMessage['parts'],
      }))
    },
    ['messages', chatId],
    { tags: [`messages-${chatId}`, 'messages'], revalidate: false },
  )()
}

/**
 * Uncached read of a chat's messages. Use inside the /api/chat route: the
 * cached loadChatMessages() is invalidated via revalidateTag() from the
 * stream's onEnd callback, which does NOT reliably run in that background
 * context — so a cached read there returns STALE history (the model loses
 * prior turns and the design-interview state detection misfires). This always
 * hits the DB.
 */
export async function loadChatMessagesFresh(chatId: string): Promise<UIMessage[]> {
  const rows = await db
    .select({ id: messages.id, role: messages.role, parts: messages.parts })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt))
  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage['role'],
    parts: r.parts as UIMessage['parts'],
  }))
}

export async function saveChatMessages(
  chatId: string,
  uiMessages: UIMessage[],
): Promise<void> {
  // Replace all messages for the chat (simple + always consistent).
  await db.delete(messages).where(eq(messages.chatId, chatId))
  if (uiMessages.length > 0) {
    await db.insert(messages).values(
      uiMessages.map((m, i) => ({
        id: m.id || generateId(),
        chatId,
        role: m.role,
        parts: m.parts,
        createdAt: new Date(Date.now() + i),
      })),
    )
  }
  await db
    .update(chats)
    .set({ updatedAt: new Date() })
    .where(eq(chats.id, chatId))
  // Invalidate per-chat message cache so next SSR page load gets fresh messages
  revalidateTag(`messages-${chatId}`, 'max')
}

// ---- Project files (persistent virtual FS of an IDE chat) ------------------

/** All files of a chat's project as a path→content record. Uncached. */
export async function loadProjectFiles(
  chatId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ path: projectFiles.path, content: projectFiles.content })
    .from(projectFiles)
    .where(eq(projectFiles.chatId, chatId))
    .orderBy(asc(projectFiles.path))
  const out: Record<string, string> = {}
  for (const r of rows) out[r.path] = r.content
  return out
}

/**
 * Full sync of the project FS: upserts every provided file and deletes rows
 * whose path is no longer present (i.e. the user deleted the file locally).
 */
export async function syncProjectFiles(
  chatId: string,
  files: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(files)
    .filter(([p, c]) => p && typeof c === 'string' && p.length <= 300)
    .slice(0, 200)

  if (entries.length === 0) {
    await db.delete(projectFiles).where(eq(projectFiles.chatId, chatId))
    return
  }

  const keepPaths = entries.map(([p]) => p)
  await db
    .delete(projectFiles)
    .where(
      and(eq(projectFiles.chatId, chatId), notInArray(projectFiles.path, keepPaths)),
    )
  await db
    .insert(projectFiles)
    .values(
      entries.map(([path, content]) => ({
        chatId,
        path,
        content: content.slice(0, 200_000),
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [projectFiles.chatId, projectFiles.path],
      set: {
        content: sql`excluded."content"`,
        updatedAt: new Date(),
      },
    })
}

const FILE_BLOCK_SERVER_RE = /```file:([\w./\-]+)\r?\n([\s\S]*?)```/g

/**
 * Upsert the ```file: blocks emitted in an assistant reply into project_files.
 * Called from the chat stream's onEnd so the DB stays authoritative even if
 * the user closes the tab mid-generation. Never deletes files.
 */
export async function upsertProjectFilesFromMessages(
  chatId: string,
  uiMessages: UIMessage[],
): Promise<void> {
  const files: Record<string, string> = {}
  for (const m of uiMessages) {
    if (m.role !== 'assistant') continue
    for (const part of m.parts ?? []) {
      if (part.type !== 'text') continue
      for (const match of (part as { text: string }).text.matchAll(FILE_BLOCK_SERVER_RE)) {
        files[match[1]] = match[2]
      }
    }
  }
  const entries = Object.entries(files).slice(0, 200)
  if (entries.length === 0) return

  await db
    .insert(projectFiles)
    .values(
      entries.map(([path, content]) => ({
        chatId,
        path,
        content: content.slice(0, 200_000),
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [projectFiles.chatId, projectFiles.path],
      set: {
        content: sql`excluded."content"`,
        updatedAt: new Date(),
      },
    })
}

// ---- Version checkpoints ----------------------------------------------------

export type CheckpointListItem = {
  id: string
  label: string
  fileCount: number
  createdAt: string
}

/**
 * Snapshot the CURRENT persistent FS as a checkpoint (called after each AI
 * reply that changed files). Keeps the last 20 snapshots per chat.
 */
export async function createCheckpoint(
  chatId: string,
  label: string,
): Promise<void> {
  const files = await loadProjectFiles(chatId)
  if (Object.keys(files).length === 0) return

  await db.insert(projectCheckpoints).values({
    chatId,
    label: label.slice(0, 100),
    files,
  })

  // Prune: keep the newest 20
  await db.execute(sql`
    DELETE FROM "project_checkpoints"
    WHERE "chatId" = ${chatId}
      AND "id" NOT IN (
        SELECT "id" FROM "project_checkpoints"
        WHERE "chatId" = ${chatId}
        ORDER BY "createdAt" DESC
        LIMIT 20
      )
  `)
}

export async function listCheckpoints(
  chatId: string,
): Promise<CheckpointListItem[]> {
  const rows = await db
    .select({
      id: projectCheckpoints.id,
      label: projectCheckpoints.label,
      files: projectCheckpoints.files,
      createdAt: projectCheckpoints.createdAt,
    })
    .from(projectCheckpoints)
    .where(eq(projectCheckpoints.chatId, chatId))
    .orderBy(desc(projectCheckpoints.createdAt))
    .limit(20)
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    fileCount: Object.keys((r.files as Record<string, string>) ?? {}).length,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function getCheckpointFiles(
  chatId: string,
  checkpointId: string,
): Promise<Record<string, string> | null> {
  const [row] = await db
    .select({ files: projectCheckpoints.files })
    .from(projectCheckpoints)
    .where(
      and(
        eq(projectCheckpoints.id, checkpointId),
        eq(projectCheckpoints.chatId, chatId),
      ),
    )
    .limit(1)
  return (row?.files as Record<string, string>) ?? null
}

export function listChatsForUser(userId: string): Promise<ChatListItem[]> {
  return unstable_cache(
    async () => {
      const rows = await db
        .select({
          id: chats.id,
          title: chats.title,
          favorite: chats.favorite,
          updatedAt: chats.updatedAt,
        })
        .from(chats)
        .where(eq(chats.userId, userId))
        .orderBy(desc(chats.updatedAt))
        .limit(50)
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        favorite: r.favorite,
        updatedAt: r.updatedAt.toISOString(),
      }))
    },
    ['chats', userId],
    { tags: ['chats'], revalidate: 300 },
  )()
}
