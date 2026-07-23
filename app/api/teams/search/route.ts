import { db } from '@/lib/db'
import { user, teamMembers } from '@/lib/db/schema'
import { and, eq, ilike, or, notInArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

// Tiny in-memory throttle to blunt user-directory enumeration. Per user id,
// sliding 10s window. Good enough for a single instance; swap for the shared
// better-auth rate limiter store if you run multiple replicas.
const HITS = new Map<string, number[]>()
const WINDOW_MS = 10_000
const MAX_HITS = 20
function throttled(userId: string): boolean {
  const now = Date.now()
  const arr = (HITS.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  arr.push(now)
  HITS.set(userId, arr)
  if (HITS.size > 5000) HITS.clear() // crude memory cap
  return arr.length > MAX_HITS
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Anonymous guests may browse/build but not enumerate the user directory.
  if ((session.user as { isAnonymous?: boolean | null }).isAnonymous) {
    return NextResponse.json({ users: [] })
  }
  if (throttled(session.user.id)) {
    return NextResponse.json({ users: [], error: 'rate_limited' }, { status: 429 })
  }

  const { searchParams } = new URL(req.url)
  const query = (searchParams.get('q') ?? '').trim()
  const teamId = searchParams.get('teamId') ?? ''

  // Require ≥3 chars so a single letter can't dump the directory.
  if (!query || query.length < 3) {
    return NextResponse.json({ users: [] })
  }

  // Get existing member userIds to exclude them
  let excludeIds: string[] = [session.user.id]
  if (teamId) {
    const existing = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId))
    excludeIds = [...excludeIds, ...existing.map((r) => r.userId)]
  }

  const cleanQuery = query.replace(/^@/, '')

  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      image: user.image,
    })
    .from(user)
    .where(
      and(
        or(
          ilike(user.username, `%${cleanQuery}%`),
          ilike(user.name, `%${cleanQuery}%`),
        ),
        excludeIds.length ? notInArray(user.id, excludeIds) : undefined,
      ),
    )
    .limit(10)

  return NextResponse.json({ users: rows })
}
