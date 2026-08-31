import { cache } from 'react'
import { auth } from '@/lib/auth'
import { headers, cookies } from 'next/headers'
import { unstable_cache } from 'next/cache'

/**
 * Extract the session token from the cookie jar so we can use it as a
 * stable cache key without touching the DB every render.
 */
async function getSessionToken(): Promise<string | null> {
  const jar = await cookies()
  // Better Auth default session cookie names
  return (
    jar.get('better-auth.session_token')?.value ??
    jar.get('__Secure-better-auth.session_token')?.value ??
    null
  )
}

/**
 * Per-request memoised session.
 *
 * Two-layer caching:
 *  1. React.cache() — deduplicates within a single server render tree (free).
 *  2. unstable_cache() — caches the DB/auth hit for up to 10s across requests
 *     that share the same session token (dramatically reduces auth round-trips
 *     during rapid navigation).
 */
export const getSession = cache(async () => {
  const token = await getSessionToken()

  // No cookie → definitely unauthenticated, skip the DB entirely.
  if (!token) return null

  // headers() must be called OUTSIDE the unstable_cache callback —
  // dynamic data sources are not accessible inside a cache scope.
  const requestHeaders = await headers()

  const fetchSession = unstable_cache(
    async (hdrs: Headers) => auth.api.getSession({ headers: hdrs }),
    ['session', token],
    { revalidate: 60 }, // 60s TTL — sign-out calls revalidateTag('session') to purge
  )

  return fetchSession(requestHeaders)
})
