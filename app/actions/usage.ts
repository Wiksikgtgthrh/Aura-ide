'use server'

import { db } from '@/lib/db'
import { tokenUsage, apiKeys, chats } from '@/lib/db/schema'
import { and, eq, gte, sql, desc } from 'drizzle-orm'
import { getSession } from '@/lib/session'
import { checkDailyBuiltinLimit } from '@/lib/limits'
import { estimateCost } from '@/lib/usage-utils'

async function requireUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type DayUsage = {
  date: string // YYYY-MM-DD
  promptTokens: number
  completionTokens: number
  total: number
}

export type ModelUsage = {
  modelId: string
  total: number
  promptTokens: number
  completionTokens: number
  percent: number
  costUsd: number | null
}

export type UsageData = {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  /** Built-in (gateway) requests today vs the account's daily limit. */
  dailyBuiltinUsed: number
  dailyBuiltinLimit: number
  totalCostUsd: number | null
  totalChats: number
  activeDays: number
  avgTokensPerChat: number
  dailyUsage: DayUsage[]
  modelBreakdown: ModelUsage[]
}

export async function getUsageData(days = 30): Promise<UsageData> {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const userId = session.user.id
  const isAnonymous =
    (session.user as { isAnonymous?: boolean | null }).isAnonymous === true
  const since = new Date()
  since.setDate(since.getDate() - days)

  const [usageRows, chatCount] = await Promise.all([
    db
      .select()
      .from(tokenUsage)
      .where(and(eq(tokenUsage.userId, userId), gte(tokenUsage.createdAt, since)))
      .orderBy(desc(tokenUsage.createdAt)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(chats)
      .where(eq(chats.userId, userId)),
  ])

  // Aggregate daily
  const dayMap = new Map<string, DayUsage>()
  for (const row of usageRows) {
    const d = row.createdAt.toISOString().slice(0, 10)
    const existing = dayMap.get(d) ?? { date: d, promptTokens: 0, completionTokens: 0, total: 0 }
    existing.promptTokens += row.promptTokens
    existing.completionTokens += row.completionTokens
    existing.total += row.promptTokens + row.completionTokens
    dayMap.set(d, existing)
  }

  // Fill gaps so chart is continuous
  const dailyUsage: DayUsage[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dailyUsage.push(dayMap.get(key) ?? { date: key, promptTokens: 0, completionTokens: 0, total: 0 })
  }

  // Model breakdown
  const modelMap = new Map<string, { prompt: number; completion: number }>()
  let grandTotal = 0
  for (const row of usageRows) {
    const existing = modelMap.get(row.modelId) ?? { prompt: 0, completion: 0 }
    existing.prompt += row.promptTokens
    existing.completion += row.completionTokens
    modelMap.set(row.modelId, existing)
    grandTotal += row.promptTokens + row.completionTokens
  }
  const modelBreakdown: ModelUsage[] = Array.from(modelMap.entries())
    .sort((a, b) => (b[1].prompt + b[1].completion) - (a[1].prompt + a[1].completion))
    .slice(0, 5)
    .map(([modelId, { prompt, completion }]) => ({
      modelId,
      total: prompt + completion,
      promptTokens: prompt,
      completionTokens: completion,
      percent: grandTotal > 0 ? Math.round(((prompt + completion) / grandTotal) * 100) : 0,
      costUsd: estimateCost(modelId, prompt, completion),
    }))

  const limitCheck = await checkDailyBuiltinLimit(userId, isAnonymous)

  const totalPromptTokens = usageRows.reduce((s, r) => s + r.promptTokens, 0)
  const totalCompletionTokens = usageRows.reduce((s, r) => s + r.completionTokens, 0)
  const activeDays = dayMap.size
  const totalChats = chatCount[0]?.count ?? 0

  // Total cost — sum only models where we have pricing data
  const knownCosts = modelBreakdown.map((m) => m.costUsd).filter((c): c is number => c !== null)
  const totalCostUsd = knownCosts.length > 0 ? knownCosts.reduce((s, c) => s + c, 0) : null

  return {
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    dailyBuiltinUsed: limitCheck.used,
    dailyBuiltinLimit: limitCheck.limit,
    totalCostUsd,
    totalChats,
    activeDays,
    avgTokensPerChat: totalChats > 0 ? Math.round((totalPromptTokens + totalCompletionTokens) / totalChats) : 0,
    dailyUsage,
    modelBreakdown,
  }
}

/** Record token usage — call from the chat API route's onFinish */
export async function recordTokenUsage(data: {
  userId: string
  chatId: string
  apiKeyId?: number
  modelId: string
  promptTokens: number
  completionTokens: number
}): Promise<void> {
  await db.insert(tokenUsage).values({
    id: crypto.randomUUID(),
    userId: data.userId,
    chatId: data.chatId,
    apiKeyId: data.apiKeyId ?? null,
    modelId: data.modelId,
    promptTokens: data.promptTokens,
    completionTokens: data.completionTokens,
  })
}
