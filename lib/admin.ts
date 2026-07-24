import 'server-only'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getSession } from '@/lib/session'

export type Role = 'user' | 'admin' | 'superadmin'

/**
 * Owner bootstrap identity. Auto-promotion to superadmin is a ONE-TIME
 * bootstrap: it fires only when (a) the signed-in user matches the owner
 * username/email AND (b) there is NOT yet ANY superadmin in the DB. Once the
 * owner is superadmin, this path is permanently closed for everyone — so a
 * later registration with a similar/free username (e.g. wiks7500) can NEVER
 * grant admin. Override via env if needed.
 */
const OWNER_USERNAMES = new Set(
  (process.env.SUPERADMIN_USERNAMES ?? 'wiks')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)
const OWNER_EMAILS = new Set(
  (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

export type AdminActor = {
  id: string
  role: Role
  isSuperadmin: boolean
  isAnonymous: boolean
  username: string | null
}

/**
 * Resolve the effective role for the current session. Auto-heals: a matching
 * superadmin username is persisted as role='superadmin' the first time.
 * Returns null when not signed in.
 */
export async function getActor(): Promise<AdminActor | null> {
  const session = await getSession()
  const uid = session?.user?.id
  if (!uid) return null

  // RESILIENT: if the migration hasn't run yet, the `role` column is missing
  // and this query throws. getActor() runs in the app layout on EVERY page, so
  // a throw here would break the WHOLE app. Fall back to role 'user' (no admin)
  // until the user runs `pnpm migrate:admin`.
  let row:
    | {
        role: string | null
        username: string | null
        email: string | null
        isAnonymous: boolean | null
      }
    | undefined
  try {
    ;[row] = await db
      .select({
        role: user.role,
        username: user.username,
        email: user.email,
        isAnonymous: user.isAnonymous,
      })
      .from(user)
      .where(eq(user.id, uid))
      .limit(1)
  } catch {
    return null // schema not migrated yet — treat as a normal (non-admin) user
  }
  if (!row) return null

  let role = (row.role as Role) ?? 'user'
  const uname = (row.username ?? '').toLowerCase()
  const email = (row.email ?? '').toLowerCase()
  const isOwnerCandidate =
    !row.isAnonymous && (OWNER_USERNAMES.has(uname) || OWNER_EMAILS.has(email))

  // ONE-TIME bootstrap: promote the owner only while NO superadmin exists yet.
  // Once someone is superadmin (persisted below), this never fires again — so
  // grabbing a similar/free username later can't yield admin.
  if (role !== 'superadmin' && isOwnerCandidate) {
    try {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(user)
        .where(eq(user.role, 'superadmin'))
      if ((n ?? 0) === 0) {
        role = 'superadmin'
        await db.update(user).set({ role }).where(eq(user.id, uid)).catch(() => {})
      }
    } catch {
      /* count failed (unmigrated) — leave as-is */
    }
  }

  return {
    id: uid,
    role,
    isSuperadmin: role === 'superadmin',
    isAnonymous: !!row.isAnonymous,
    username: row.username ?? null,
  }
}

/** Guard for admin server actions. Returns the actor or null if not allowed. */
export async function requireAdmin(
  min: 'admin' | 'superadmin' = 'admin',
): Promise<AdminActor | null> {
  const actor = await getActor()
  if (!actor || actor.isAnonymous) return null
  if (actor.role === 'superadmin') return actor
  if (min === 'admin' && actor.role === 'admin') return actor
  return null
}
