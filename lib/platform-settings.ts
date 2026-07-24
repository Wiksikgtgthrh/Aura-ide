import 'server-only'
import { db } from '@/lib/db'
import { platformSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Platform-wide limits/config, editable from the admin panel (Limits tab) and
 * stored in the platform_settings k/v table. Read with getLimits() — falls
 * back to defaults when unmigrated or unset.
 */
export type PlatformLimits = {
  /** Docker memory cap per user container, in MB. */
  dockerMemoryMb: number
  /** Docker CPU cap per user container. */
  dockerCpus: number
  /** Max projects a free-plan user may create (0 = unlimited). */
  maxProjectsFree: number
}

export const DEFAULT_LIMITS: PlatformLimits = {
  dockerMemoryMb: 1024,
  dockerCpus: 1,
  maxProjectsFree: 0,
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
