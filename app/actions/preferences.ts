'use server'

import { db } from '@/lib/db'
import { preferences } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/session'
import { THEME_COOKIE } from '@/lib/theme-cookie'

async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type Preferences = {
  suggestions: boolean
  soundNotifications: boolean
  chatPosition: string
  customInstructions: string
  theme: string
  autoPermissions: string
  // IDE settings
  defaultMode: string
  editorFontSize: number
  editorTabSize: number
  editorWordWrap: boolean
  autoPreview: boolean
  // Memory settings
  memoriesEnabled: boolean
  memoriesAutoExtract: boolean
  memoriesMaxCount: number
}

const defaults: Preferences = {
  suggestions: true,
  soundNotifications: true,
  chatPosition: 'left',
  customInstructions: '',
  theme: 'system',
  autoPermissions: 'ask',
  defaultMode: 'ide',
  editorFontSize: 14,
  editorTabSize: 2,
  editorWordWrap: false,
  autoPreview: false,
  memoriesEnabled: true,
  memoriesAutoExtract: false,
  memoriesMaxCount: 25,
}

/** Cached DB fetch — revalidated when savePreferences is called */
const fetchPreferences = unstable_cache(
  async (userId: string): Promise<Preferences> => {
    const rows = await db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, userId))
    if (rows.length === 0) return defaults
    const row = rows[0]
    return {
      suggestions: row.suggestions,
      soundNotifications: row.soundNotifications,
      chatPosition: row.chatPosition,
      customInstructions: row.customInstructions,
      theme: row.theme,
      autoPermissions: row.autoPermissions ?? 'ask',
      defaultMode: row.defaultMode ?? 'ide',
      editorFontSize: row.editorFontSize ?? 14,
      editorTabSize: row.editorTabSize ?? 2,
      editorWordWrap: row.editorWordWrap ?? false,
      autoPreview: row.autoPreview ?? false,
      memoriesEnabled: row.memoriesEnabled ?? true,
      memoriesAutoExtract: row.memoriesAutoExtract ?? false,
      memoriesMaxCount: row.memoriesMaxCount ?? 25,
    }
  },
  ['preferences'],
  { tags: ['preferences'], revalidate: 300 },
)

export async function getPreferences(): Promise<Preferences> {
  const userId = await getUserId()
  return fetchPreferences(userId)
}

/** Use in layouts when userId is already known to skip an extra getSession() call. */
export async function getPreferencesForUser(userId: string): Promise<Preferences> {
  return fetchPreferences(userId)
}

export async function savePreferences(partial: Partial<Preferences>) {
  const userId = await getUserId()

  // Merge with defaults — avoids an extra SELECT before the upsert
  const next = { ...defaults, ...partial }

  await db
    .insert(preferences)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preferences.userId,
      set: {
        ...Object.fromEntries(
          Object.entries(partial).filter(([, v]) => v !== undefined)
        ),
        updatedAt: new Date(),
      },
    })

  // Keep cookie in sync so the root layout skips the DB on next request
  if (partial.theme !== undefined) {
    const jar = await cookies()
    jar.set(THEME_COOKIE, next.theme, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
  }

  revalidateTag('preferences', 'max')
  revalidatePath('/settings')
}
