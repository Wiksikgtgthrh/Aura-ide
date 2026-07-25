import 'server-only'
import { db } from '@/lib/db'
import { platformSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Platform-wide limits/config, editable from the admin panel (Limits tab) and
 * stored in the platform_settings k/v table. Read with getLimits() — falls
 * back to defaults when unmigrated or unset.
 */
/** Настройки одного тира Aura из админки. */
export type AuraTierSettings = {
  /** Подпись под названием тира в селекторе (пусто = автоматическая). */
  label?: string
  /** Множитель затрат токенов (1 = как есть; 2 = списывается вдвое больше). */
  costMultiplier?: number
}

export type PlatformLimits = {
  /** Docker memory cap per user container, in MB. */
  dockerMemoryMb: number
  /** Docker CPU cap per user container. */
  dockerCpus: number
  /** Max projects a free-plan user may create (0 = unlimited). */
  maxProjectsFree: number
  /** Пер-тировые настройки Aura: подпись в селекторе + множитель токенов. */
  auraTiers: Record<string, AuraTierSettings>
}

export const DEFAULT_LIMITS: PlatformLimits = {
  dockerMemoryMb: 1024,
  dockerCpus: 1,
  maxProjectsFree: 0,
  auraTiers: {},
}

const AURA_TIER_IDS = new Set(['aura-mini', 'aura-pro', 'aura-max', 'aura-max-fast'])

function sanitizeAuraTiers(v: unknown): Record<string, AuraTierSettings> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, AuraTierSettings> = {}
  for (const [tierId, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!AURA_TIER_IDS.has(tierId) || !raw || typeof raw !== 'object') continue
    const r = raw as AuraTierSettings
    const entry: AuraTierSettings = {}
    if (typeof r.label === 'string' && r.label.trim()) entry.label = r.label.trim().slice(0, 60)
    if (typeof r.costMultiplier === 'number' && Number.isFinite(r.costMultiplier)) {
      entry.costMultiplier = Math.min(Math.max(r.costMultiplier, 0.1), 100)
    }
    if (entry.label !== undefined || entry.costMultiplier !== undefined) out[tierId] = entry
  }
  return out
}

const LIMITS_KEY = 'limits'

export async function getLimits(): Promise<PlatformLimits> {
  try {
    const [row] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, LIMITS_KEY))
      .limit(1)
    if (!row) return DEFAULT_LIMITS
    const v = (row.value ?? {}) as Partial<PlatformLimits>
    return {
      dockerMemoryMb: clampNum(v.dockerMemoryMb, DEFAULT_LIMITS.dockerMemoryMb, 256, 16384),
      dockerCpus: clampNum(v.dockerCpus, DEFAULT_LIMITS.dockerCpus, 0.25, 16),
      maxProjectsFree: clampNum(v.maxProjectsFree, DEFAULT_LIMITS.maxProjectsFree, 0, 100000),
      auraTiers: sanitizeAuraTiers(v.auraTiers),
    }
  } catch {
    return DEFAULT_LIMITS // unmigrated
  }
}

export async function setLimits(next: PlatformLimits): Promise<void> {
  const value = {
    dockerMemoryMb: clampNum(next.dockerMemoryMb, DEFAULT_LIMITS.dockerMemoryMb, 256, 16384),
    dockerCpus: clampNum(next.dockerCpus, DEFAULT_LIMITS.dockerCpus, 0.25, 16),
    maxProjectsFree: clampNum(next.maxProjectsFree, DEFAULT_LIMITS.maxProjectsFree, 0, 100000),
    auraTiers: sanitizeAuraTiers(next.auraTiers),
  }
  await db
    .insert(platformSettings)
    .values({ key: LIMITS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: new Date() },
    })
}

function clampNum(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt
  return Math.min(Math.max(n, min), max)
}
