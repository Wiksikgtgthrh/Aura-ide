import 'server-only'

/**
 * Общий helper для быстрых AI-эндпоинтов (inline-completions, code-actions,
 * AI-в-терминале, AI-ревью diff'а). Берёт первый живой OpenAI-совместимый
 * ключ пользователя, расшифровывает его и возвращает готовые baseURL/model.
 *
 * Мы намеренно НЕ трогаем платформенные Aura-тиры и тарифные ключи —
 * IDE-фичи должны работать в local-first режиме на BYOK-ключах.
 */

import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { apiKeys } from '@/lib/db/schema'
import { tryDecryptSecret } from '@/lib/crypto'
import { isSafeFetchUrl } from '@/lib/ssrf'

export type PickedKey = {
  keyId: number
  apiKey: string
  baseUrl: string
  modelId: string
}

export async function pickOpenAiKey(userId: string): Promise<PickedKey | null> {
  const [row] = await db
    .select({
      id: apiKeys.id,
      key: apiKeys.key,
      baseUrl: apiKeys.baseUrl,
      modelId: apiKeys.modelId,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), ne(apiKeys.status, 'error'), ne(apiKeys.status, 'timeout')))
    .orderBy(
      sql`case when ${apiKeys.status} = 'active' then 0 when ${apiKeys.status} = 'unknown' then 1 else 2 end`,
      apiKeys.createdAt,
    )
    .limit(1)
  if (!row) return null
  const baseUrl = row.baseUrl || 'https://api.openai.com/v1'
  if (baseUrl && !(await isSafeFetchUrl(baseUrl))) return null
  const raw = tryDecryptSecret(row.key)
  if (raw === null) return null
  return {
    keyId: row.id,
    apiKey: raw,
    baseUrl,
    modelId: row.modelId || 'gpt-4o-mini',
  }
}
