import 'server-only'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/session'

export type Role = 'user' | 'admin' | 'superadmin'

/**
 * Usernames auto-promoted to superadmin on sight (case-insensitive). The owner
 * asked for Wiks / tag Wiks7500 to be superadmin — so whichever they register
 * becomes superadmin automatically on first admin check, no manual seeding.
 */
const SUPERADMIN_USERNAMES = new Set(['wiks7500', 'wiks'])

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
    | { role: string | null; username: string | null; isAnonymous: boolean | null }
    | undefined
  try {
    ;[row] = await db
      .select({
        role: user.role,
        username: user.username,
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
  if (role !== 'superadmin' && SUPERADMIN_USERNAMES.has(uname) && !row.isAnonymous) {
    role = 'superadmin'
    // Persist the promotion (best-effort).
    await db.update(user).set({ role }).where(eq(user.id, uid)).catch(() => {})
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
