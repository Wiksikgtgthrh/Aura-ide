'use server'

import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { db } from '@/lib/db'
import { apiKeys, platformApiKeys, userBalance } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/session'
import { tryDecryptSecret, isEncrypted } from '@/lib/crypto'
import { isSafeFetchUrl } from '@/lib/ssrf'
import { AURA_MODEL_MAP, pickPlanKeyForTier } from '@/lib/aura-models'

/**
 * «Улучшить промпт»: короткий запрос («сделай лендинг кофейни») превращается
 * в плотный бриф — цель, секции, стиль, контент. Модель: первый ключ
 * пользователя → ключ тарифа (aura-mini) → Gateway, тот же приоритет, что в чате.
 */

const IMPROVER_SYSTEM = `Ты — редактор продуктовых брифов для ИИ-генератора сайтов и интерфейсов.
Пользователь присылает короткий запрос — разверни его в чёткий бриф, с которым генератор сделает сайт с первого раза.

Структура (маркированные строки, плотно, без воды):
- Цель и аудитория — одна строка.
- Секции/экраны — конкретный список того, что должно быть на странице.
- Стиль и настроение — палитра, типографика, характер (выбери сам, если не задано).
- Контент — какие тексты/данные использовать (реалистичные примеры, не lorem ipsum).

Правила: пиши НА ЯЗЫКЕ запроса; сохрани все конкретные требования пользователя дословно; не задавай вопросов; не добавляй пояснений и приветствий; максимум 120 слов. Верни ТОЛЬКО текст брифа.`

export async function improvePrompt(
  raw: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const session = await getSession()
  const userId = session?.user?.id
  if (!userId) return { ok: false, error: 'Не авторизован' }
  const prompt = raw.trim().slice(0, 2000)
  if (!prompt) return { ok: false, error: 'Пустой запрос' }

  // Модель: свой первый ключ → ключ тарифа (не для гостей) → Gateway.
  let model: Parameters<typeof generateText>[0]['model'] | null = null

  const [own] = await db
    .select({ key: apiKeys.key, baseUrl: apiKeys.baseUrl, modelId: apiKeys.modelId })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt)
    .limit(1)
  if (own && (!own.baseUrl || (await isSafeFetchUrl(own.baseUrl)))) {
    const rawKey = tryDecryptSecret(own.key)
    if (rawKey) {
      const openai = createOpenAI({ apiKey: rawKey, baseURL: own.baseUrl || undefined })
      model = openai.chat(own.modelId || 'gpt-4o-mini')
    }
  }

  const isAnonymous = (session.user as { isAnonymous?: boolean | null }).isAnonymous === true
  if (!model && !isAnonymous) {
    try {
      const [bal] = await db
        .select({ plan: userBalance.plan, planExpiresAt: userBalance.planExpiresAt })
        .from(userBalance)
        .where(eq(userBalance.userId, userId))
        .limit(1)
      const plan =
        bal && !(bal.planExpiresAt && bal.planExpiresAt.getTime() < Date.now())
          ? bal.plan || 'free'
          : 'free'
      const rows = await db
        .select({
          label: platformApiKeys.label,
          key: platformApiKeys.key,
          baseUrl: platformApiKeys.baseUrl,
          modelId: platformApiKeys.modelId,
        })
        .from(platformApiKeys)
        .where(eq(platformApiKeys.planKey, plan))
      const picked = pickPlanKeyForTier(rows, 'aura-mini') ?? pickPlanKeyForTier(rows, 'aura-pro')
      if (picked && (!picked.baseUrl || (await isSafeFetchUrl(picked.baseUrl)))) {
        const rawKey = isEncrypted(picked.key) ? tryDecryptSecret(picked.key) : picked.key
        if (rawKey) {
          const openai = createOpenAI({ apiKey: rawKey, baseURL: picked.baseUrl || undefined })
          model = openai.chat(picked.modelId || 'gpt-4o-mini')
        }
      }
    } catch {
      /* немигрированная БД — дальше по цепочке */
    }
  }

  if (!model) {
    if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
      model = AURA_MODEL_MAP['aura-mini']
    } else {
      return { ok: false, error: 'Нет доступной модели — добавьте API-ключ в «Мои API»' }
    }
  }

  try {
    const { text } = await generateText({
      model,
      system: IMPROVER_SYSTEM,
      prompt,
      maxOutputTokens: 500,
      temperature: 0.4,
    })
    const improved = text.trim()
    if (!improved) return { ok: false, error: 'Модель вернула пустой ответ' }
    return { ok: true, text: improved.slice(0, 2500) }
  } catch {
    return { ok: false, error: 'Не удалось улучшить промпт — попробуйте ещё раз' }
  }
}
