'use server'

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { userSecrets } from '@/lib/db/schema'
import { encryptSecret } from '@/lib/crypto'
import { getSession } from '@/lib/session'

/**
 * Encrypted per-user integration secrets (Settings → Integrations).
 * Currently: the GitHub Personal Access Token used by Publish — stored
 * server-side (AES-256-GCM) instead of the browser's localStorage.
 */

export type GithubTokenStatus = { connected: boolean; updatedAt: string | null }

export async function getGithubTokenStatus(): Promise<GithubTokenStatus> {
  const session = await getSession()
  if (!session?.user) return { connected: false, updatedAt: null }
  const [row] = await db
    .select({ updatedAt: userSecrets.updatedAt })
    .from(userSecrets)
    .where(
      and(eq(userSecrets.userId, session.user.id), eq(userSecrets.provider, 'github')),
    )
    .limit(1)
  return {
    connected: !!row,
    updatedAt: row ? row.updatedAt.toISOString() : null,
  }
}

export async function saveGithubToken(token: string): Promise<{ ok: boolean }> {
  const session = await getSession()
  if (!session?.user) return { ok: false }
  const trimmed = token.trim()
  if (!trimmed || trimmed.length < 10 || trimmed.length > 300) return { ok: false }

  await db
    .insert(userSecrets)
    .values({
      userId: session.user.id,
      provider: 'github',
      secret: encryptSecret(trimmed),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userSecrets.userId, userSecrets.provider],
      set: { secret: sql`excluded."secret"`, updatedAt: new Date() },
    })
  return { ok: true }
}

export async function deleteGithubToken(): Promise<{ ok: boolean }> {
  const session = await getSession()
  if (!session?.user) return { ok: false }
  await db
    .delete(userSecrets)
    .where(
      and(eq(userSecrets.userId, session.user.id), eq(userSecrets.provider, 'github')),
    )
  return { ok: true }
}
