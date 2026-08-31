'use server'

import { db } from '@/lib/db'
import { memories, preferences } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'

export type MemoryType = 'coding-style' | 'project-context' | 'preference' | 'fact'
export type MemorySource = 'user-added' | 'auto-extracted'

export type Memory = {
  id: string
  type: MemoryType
  content: string
  source: MemorySource
  enabled: boolean
  createdAt: Date
}

async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function fetchMemories(userId: string): Promise<Memory[]> {
  const rows = await db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(memories.createdAt)
  return rows.map((r) => ({
    id: r.id,
    type: r.type as MemoryType,
    content: r.content,
    source: r.source as MemorySource,
    enabled: r.enabled,
    createdAt: r.createdAt,
  }))
}

const fetchMemoriesCached = (userId: string) =>
  unstable_cache(
    () => fetchMemories(userId),
    ['memories', userId],
    { tags: ['memories'], revalidate: 60 },
  )()

export async function getMemories(): Promise<Memory[]> {
  const userId = await getUserId()
  return fetchMemoriesCached(userId)
}

/** Use in layouts when userId is already known to skip an extra getSession() call. */
export async function getMemoriesForUser(userId: string): Promise<Memory[]> {
  return fetchMemoriesCached(userId)
}

export async function getActiveMemoriesForPrompt(): Promise<string[]> {
  const userId = await getUserId()

  const [prefRows, memRows] = await Promise.all([
    db
      .select({ memoriesEnabled: preferences.memoriesEnabled })
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .limit(1),
    db
      .select({ content: memories.content })
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.enabled, true)))
      .orderBy(memories.createdAt),
  ])

  const memoriesEnabled = prefRows[0]?.memoriesEnabled ?? true
  if (!memoriesEnabled) return []
  return memRows.map((r) => r.content)
}

export async function addMemory(data: {
  type: MemoryType
  content: string
  source?: MemorySource
}): Promise<Memory> {
  const userId = await getUserId()
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(memories).values({
    id,
    userId,
    type: data.type,
    content: data.content.slice(0, 300),
    source: data.source ?? 'user-added',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  })
  revalidateTag('memories', 'max')
  return {
    id,
    type: data.type,
    content: data.content.slice(0, 300),
    source: data.source ?? 'user-added',
    enabled: true,
    createdAt: now,
  }
}

export async function updateMemory(
  id: string,
  data: Partial<Pick<Memory, 'type' | 'content' | 'enabled'>>
) {
  const userId = await getUserId()
  await db
    .update(memories)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
  revalidateTag('memories', 'max')
}

export async function deleteMemory(id: string) {
  const userId = await getUserId()
  await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
  revalidateTag('memories', 'max')
}

export async function clearAllMemories() {
  const userId = await getUserId()
  await db.delete(memories).where(eq(memories.userId, userId))
  revalidateTag('memories', 'max')
}
