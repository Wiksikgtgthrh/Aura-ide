import 'server-only'
import { db } from '@/lib/db'
import { tokenUsage } from '@/lib/db/schema'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'

/**
 * Daily limits apply ONLY to the built-in Aura models (AI Gateway — the
 * owner pays for those). Requests running on the user's OWN API key are
 * never limited: every account (guests included) brings its own keys, so
 * their usage costs the platform nothing.
 */
export const DAILY_LIMIT_GUEST = 20
export const DAILY_LIMIT_USER = 100

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export type LimitCheck =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; used: number; limit: number }

/**
 * Count today's BUILT-IN model requests for the user (rows with apiKeyId NULL
 * — own-key usage is recorded with the key id and doesn't count here).
 */
export async function checkDailyBuiltinLimit(
  userId: string,
  isAnonymous: boolean,
): Promise<LimitCheck> {
  const limit = isAnonymous ? DAILY_LIMIT_GUEST : DAILY_LIMIT_USER
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tokenUsage)
    .where(
      and(
        eq(tokenUsage.userId, userId),
        isNull(tokenUsage.apiKeyId),
        gte(tokenUsage.createdAt, startOfToday()),
      ),
    )
  const used = row?.count ?? 0
  return { allowed: used < limit, used, limit }
}

/** Fire-and-forget usage record. Never throws into the caller. */
export async function recordTokenUsage(input: {
  userId: string
  chatId?: string
  apiKeyId?: number | null
  modelId: string
  promptTokens: number
  completionTokens: number
}): Promise<void> {
  try {
    await db.insert(tokenUsage).values({
      userId: input.userId,
      chatId: input.chatId ?? null,
      apiKeyId: input.apiKeyId ?? null,
      modelId: input.modelId.slice(0, 200),
      promptTokens: Math.max(0, Math.round(input.promptTokens || 0)),
      completionTokens: Math.max(0, Math.round(input.completionTokens || 0)),
    })
  } catch {
    // usage accounting must never break the chat stream
  }
}
