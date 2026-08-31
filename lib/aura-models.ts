/**
 * Встроенные модели Aura (тиры) и их сопоставление с API-ключами тарифов.
 *
 * Как работает выбор модели для тира (aura-mini/pro/max/max-fast):
 *  1. Ищем среди platform_api_keys ТАРИФА пользователя ключ, чья метка
 *     соответствует тиру («Aura Max», «aura max 2», «AuraMax» — всё матчится);
 *  2. если такого ключа нет — используем встроенный AI Gateway (env-биллинг).
 *
 * Метки нумеруются bulk-импортом («Aura Max 1», «Aura Max 2», …) — хвостовые
 * числа игнорируются при сопоставлении, а среди подходящих ключей выбирается
 * случайный (размазывает нагрузку по пулу ключей).
 */

export const AURA_MODELS = [
  { id: 'aura-mini', name: 'Aura Mini' },
  { id: 'aura-pro', name: 'Aura Pro' },
  { id: 'aura-max', name: 'Aura Max' },
  { id: 'aura-max-fast', name: 'Aura Max Fast' },
] as const

export type AuraTierId = (typeof AURA_MODELS)[number]['id']

// Aura model ids -> AI Gateway model strings (фолбэк, когда у тарифа нет ключей).
export const AURA_MODEL_MAP: Record<string, string> = {
  'aura-mini': 'google/gemini-2.5-flash-lite',
  'aura-pro': 'google/gemini-2.5-flash',
  'aura-max': 'anthropic/claude-sonnet-4.5',
  'aura-max-fast': 'anthropic/claude-haiku-4.5',
}

/** Нормализация метки: нижний регистр, только буквы/цифры, без хвостовых номеров. */
export function normalizeKeyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim()
    .replace(/(?:\s+\d+)+$/, '') // «aura max 2» → «aura max»
    .replace(/\s+/g, ' ')
}

/**
 * Метка ключа соответствует тиру? Сравниваем нормализованные строки:
 * точное совпадение с названием тира («aura max») или с его id без префикса
 * дефисов («aura-max-fast» → «aura max fast»).
 */
export function labelMatchesTier(label: string, tierId: string): boolean {
  const norm = normalizeKeyLabel(label)
  if (!norm) return false
  const tier = AURA_MODELS.find((m) => m.id === tierId)
  if (!tier) return false
  const tierNorm = normalizeKeyLabel(tier.name)
  return norm === tierNorm
}

export type PlanKeyLike = {
  label: string
  /** 'unknown' | 'valid' | 'invalid' — invalid-ключи не участвуют в выборе. */
  status?: string | null
}

/**
 * Выбор ключа тарифа под тир: фильтруем по метке и статусу, из подходящих
 * берём случайный. Возвращает null, когда пул пуст (→ фолбэк на Gateway).
 */
export function pickPlanKeyForTier<T extends PlanKeyLike>(
  keys: T[],
  tierId: string,
  random: () => number = Math.random,
): T | null {
  const pool = keys.filter(
    (k) => labelMatchesTier(k.label, tierId) && (k.status ?? 'unknown') !== 'invalid',
  )
  if (pool.length === 0) return null
  return pool[Math.floor(random() * pool.length)] ?? null
}
