import { cookies } from 'next/headers'

export const THEME_COOKIE = 'aura-theme'

/**
 * Read theme from cookie — near-zero overhead (no DB hit).
 * Falls back to 'system' when cookie is absent (new users / unauthenticated).
 */
export async function getThemeCookie(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(THEME_COOKIE)?.value ?? null
}
