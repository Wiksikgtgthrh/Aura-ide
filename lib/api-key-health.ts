import 'server-only'

/**
 * Здоровье API-ключей: запись истории проверок + сводки для UI.
 *
 * Каждая проверка (ручная кнопкой, автопроверка при старте, периодическая
 * фоновая) пишет точку в api_key_health: статус, пинг, TTFT. По истории
 * строится «пульс» ключа (последние N проверок) и средняя скорость —
 * это показывается на карточке ключа в «Мои API».
 */

import { db } from '@/lib/db'
import { apiKeyHealth } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'

export type HealthPoint = {
  status: string
  ping: number | null
  ttft: number | null
  failReason: string | null
  checkedAt: string
}

/** Записать результат одной проверки. Никогда не бросает — метрика вторична. */
export async function recordKeyHealth(
  apiKeyId: number,
  entry: { status: string; ping: number | null; ttft?: number | null; failReason: string | null },
): Promise<void> {
  try {
    await db.insert(apiKeyHealth).values({
      apiKeyId,
      status: entry.status,
      ping: entry.ping,
      ttft: entry.ttft ?? null,
      failReason: entry.failReason,
    })
  } catch {
    /* таблица может быть ещё не мигрирована — не ломаем проверку */
  }
}

export type KeyHealthSummary = {
  /** Последние проверки (свежие первыми) — для «пульса» на карточке. */
  points: HealthPoint[]
  /** Средний TTFT активных проверок за сутки — сравнение скорости моделей. */
  avgTtftMs: number | null
  /** Средний пинг активных проверок за сутки. */
  avgPingMs: number | null
  /** Доля успешных проверок (0..1) за сутки. */
  uptime: number | null
  /** Сколько раз подряд ключ падал до последней успешной проверки. */
  consecutiveFailures: number
}

/** Сводка здоровья ключа: последние 20 проверок + агрегаты за 24 часа. */
export async function getKeyHealthSummary(apiKeyId: number): Promise<KeyHealthSummary> {
  const empty: KeyHealthSummary = {
    points: [],
    avgTtftMs: null,
    avgPingMs: null,
    uptime: null,
    consecutiveFailures: 0,
  }
  try {
    const rows = await db
      .select({
        status: apiKeyHealth.status,
        ping: apiKeyHealth.ping,
        ttft: apiKeyHealth.ttft,
        failReason: apiKeyHealth.failReason,
        checkedAt: apiKeyHealth.checkedAt,
      })
      .from(apiKeyHealth)
      .where(eq(apiKeyHealth.apiKeyId, apiKeyId))
      .orderBy(desc(apiKeyHealth.checkedAt))
      .limit(50)

    const points: HealthPoint[] = rows.slice(0, 20).map((r) => ({
      status: r.status,
      ping: r.ping,
      ttft: r.ttft,
      failReason: r.failReason,
      checkedAt: r.checkedAt.toISOString(),
    }))

    // Подряд идущие падения от самой свежей проверки.
    let consecutiveFailures = 0
    for (const r of rows) {
      if (r.status === 'active' || r.status === 'valid') break
      consecutiveFailures++
    }

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const day = rows.filter((r) => r.checkedAt.getTime() >= dayAgo)
    const ok = day.filter((r) => r.status === 'active' || r.status === 'valid')
    const avg = (vals: Array<number | null>) => {
      const nums = vals.filter((v): v is number => typeof v === 'number')
      return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null
    }

    return {
      points,
      avgTtftMs: avg(ok.map((r) => r.ttft)),
      avgPingMs: avg(ok.map((r) => r.ping)),
      uptime: day.length ? ok.length / day.length : null,
      consecutiveFailures,
    }
  } catch {
    return empty
  }
}
