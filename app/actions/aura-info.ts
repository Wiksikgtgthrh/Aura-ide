'use server'

import { db } from '@/lib/db'
import { apiKeys, platformApiKeys, userBalance } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/session'
import { AURA_MODELS, AURA_MODEL_MAP, labelMatchesTier } from '@/lib/aura-models'
import { getLimits } from '@/lib/platform-settings'

/**
 * «Что за апишка внутри тира» — инфа для селектора моделей: по каждому тиру
 * Aura показываем, что реально будет использовано у ТЕКУЩЕГО пользователя —
 * ключ(и) его тарифа или встроенная модель через шлюз.
 */

export type AuraTierInfo = {
  id: string
  name: string
  source: 'plan' | 'builtin'
  /** Короткая подпись под названием: id модели (+ размер пула ключей). */
  subtitle: string
  /** Полная подсказка при наведении. */
  tooltip: string
}

function pluralKeys(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ключ`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ключа`
  return `${n} ключей`
}

export async function getAuraTiersInfo(): Promise<AuraTierInfo[]> {
  const session = await getSession()
  const userId = session?.user?.id

  // План пользователя (истёкший → free).
  let plan = 'free'
  if (userId) {
    try {
      const [row] = await db
        .select({ plan: userBalance.plan, planExpiresAt: userBalance.planExpiresAt })
        .from(userBalance)
        .where(eq(userBalance.userId, userId))
        .limit(1)
      if (row && !(row.planExpiresAt && row.planExpiresAt.getTime() < Date.now())) {
        plan = row.plan || 'free'
      }
    } catch {
      /* нет таблицы/строки — free */
    }
  }

  // Ключи тарифа (устойчиво к немигрированной колонке status).
  type Row = { label: string; modelId: string; status?: string | null }
  let rows: Row[] = []
  try {
    rows = await db
      .select({
        label: platformApiKeys.label,
        modelId: platformApiKeys.modelId,
        status: platformApiKeys.status,
      })
      .from(platformApiKeys)
      .where(eq(platformApiKeys.planKey, plan))
  } catch {
    try {
      rows = await db
        .select({ label: platformApiKeys.label, modelId: platformApiKeys.modelId })
        .from(platformApiKeys)
        .where(eq(platformApiKeys.planKey, plan))
    } catch {
      rows = []
    }
  }

  // Фолбэк без ключей тарифа: настроен ли встроенный шлюз, а если нет —
  // какой СВОЙ ключ пользователя реально будет использован (self-host).
  const gatewayConfigured = !!(
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
  )
  let firstKeyName: string | null = null
  if (!gatewayConfigured && userId) {
    try {
      const [k] = await db
        .select({ name: apiKeys.name })
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId))
        .orderBy(apiKeys.createdAt)
        .limit(1)
      firstKeyName = k?.name ?? null
    } catch {
      /* ignore */
    }
  }

  // Кастомные подписи тиров из админки (Лимиты → «Модели Aura»).
  let customLabels: Record<string, string | undefined> = {}
  try {
    const limits = await getLimits()
    customLabels = Object.fromEntries(
      Object.entries(limits.auraTiers ?? {}).map(([k, v]) => [k, v.label]),
    )
  } catch {
    /* настройки недоступны */
  }
  const withCustom = (tierId: string, computed: string) => customLabels[tierId] || computed

  return AURA_MODELS.map((tier) => {
    const pool = rows.filter(
      (r) => labelMatchesTier(r.label, tier.id) && (r.status ?? 'unknown') !== 'invalid',
    )
    if (pool.length > 0) {
      const models = Array.from(new Set(pool.map((r) => r.modelId)))
      const subtitle = withCustom(
        tier.id,
        models[0] + (pool.length > 1 ? ` · ${pluralKeys(pool.length)}` : ''),
      )
      const tooltip =
        `Тариф «${plan}» — ${pluralKeys(pool.length)}: ` +
        pool.map((r) => `${r.label} → ${r.modelId}`).join(', ')
      return { id: tier.id, name: tier.name, source: 'plan' as const, subtitle, tooltip }
    }
    const gw = AURA_MODEL_MAP[tier.id]
    if (gatewayConfigured) {
      return {
        id: tier.id,
        name: tier.name,
        source: 'builtin' as const,
        subtitle: withCustom(tier.id, gw),
        tooltip: `Встроенная модель (шлюз Aura): ${gw}. Дневной лимит бесплатных запросов.`,
      }
    }
    if (firstKeyName) {
      return {
        id: tier.id,
        name: tier.name,
        source: 'builtin' as const,
        subtitle: withCustom(tier.id, `→ ваш ключ «${firstKeyName}»`),
        tooltip: `Встроенный шлюз не настроен — тир использует ваш API-ключ «${firstKeyName}».`,
      }
    }
    return {
      id: tier.id,
      name: tier.name,
      source: 'builtin' as const,
      subtitle: withCustom(tier.id, 'нужен API-ключ'),
      tooltip: 'Встроенный шлюз не настроен и своих ключей нет — добавьте ключ в «Мои API».',
    }
  })
}
