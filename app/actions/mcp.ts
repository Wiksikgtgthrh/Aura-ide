'use server'

import { db } from '@/lib/db'
import { mcpServers } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'

async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type McpServer = {
  id: string
  name: string
  url: string
  authType: string
  token: string
  enabled: boolean
  createdAt: string
}

async function fetchMcpServers(userId: string): Promise<McpServer[]> {
  const rows = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.userId, userId))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    authType: r.authType,
    token: r.token,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  }))
}

export async function getMcpServers(): Promise<McpServer[]> {
  const userId = await getUserId()
  return unstable_cache(
    () => fetchMcpServers(userId),
    ['mcp-servers', userId],
    { tags: ['mcp-servers'], revalidate: 60 },
  )()
}

export async function createMcpServer(data: {
  name: string
  url: string
  authType: string
  token: string
}): Promise<McpServer> {
  const userId = await getUserId()
  const id = crypto.randomUUID()
  const [row] = await db
    .insert(mcpServers)
    .values({
      id,
      userId,
      name: data.name.trim(),
      url: data.url.trim(),
      authType: data.authType,
      token: data.token.trim(),
    })
    .returning()
  revalidateTag('mcp-servers', 'max')
  revalidatePath('/')
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    authType: row.authType,
    token: row.token,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function toggleMcpServer(id: string, enabled: boolean) {
  const userId = await getUserId()
  await db
    .update(mcpServers)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(mcpServers.id, id), eq(mcpServers.userId, userId)))
  revalidateTag('mcp-servers', 'max')
  revalidatePath('/')
}

export async function deleteMcpServer(id: string) {
  const userId = await getUserId()
  await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.id, id), eq(mcpServers.userId, userId)))
  revalidateTag('mcp-servers', 'max')
  revalidatePath('/')
}

export async function getActiveMcpServers(): Promise<McpServer[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.userId, userId), eq(mcpServers.enabled, true)))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    authType: r.authType,
    token: r.token,
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  }))
}
