'use server'

import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'

async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type Profile = {
  name: string
  email: string
  image: string | null
  tag: string
  tagChanged: boolean
  bio: string
  isAnonymous: boolean
  emailVerified: boolean
}

async function fetchProfileById(userId: string): Promise<Profile> {
  const rows = await db.select().from(user).where(eq(user.id, userId))
  if (rows.length === 0) throw new Error('User not found')
  const u = rows[0]
  return {
    name: u.name,
    email: u.email,
    image: u.image,
    tag: u.displayUsername ?? u.username ?? '',
    tagChanged: u.tagChanged,
    bio: u.bio,
    isAnonymous: u.isAnonymous ?? false,
    emailVerified: u.emailVerified ?? false,
  }
}

export async function getProfile(): Promise<Profile> {
  const userId = await getUserId()
  return fetchProfileById(userId)
}

/** Use in layouts when you already have the userId from session. Avoids a second getSession() call. */
export async function getProfileForUser(userId: string): Promise<Profile> {
  return unstable_cache(
    () => fetchProfileById(userId),
    ['profile', userId],
    { tags: ['profile'], revalidate: 300 },
  )()
}

export async function updateName(name: string) {
  const userId = await getUserId()
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 50) {
    return { error: 'Name must be 1-50 characters' }
  }
  await db
    .update(user)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(user.id, userId))
  revalidateTag('profile', 'max')
  revalidatePath('/profile')
  revalidatePath('/')
  return { success: true }
}

export async function updateBio(bio: string) {
  const userId = await getUserId()
  if (bio.length > 500) {
    return { error: 'Bio must be at most 500 characters' }
  }
  await db
    .update(user)
    .set({ bio, updatedAt: new Date() })
    .where(eq(user.id, userId))
  revalidateTag('profile', 'max')
  revalidatePath('/profile')
  return { success: true }
}

export async function updateTag(tag: string) {
  const userId = await getUserId()
  const trimmed = tag.trim()

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(trimmed)) {
    return {
      error:
        'Tag must be 3-30 characters: letters, numbers, underscores, dots, dashes',
    }
  }

  const rows = await db.select().from(user).where(eq(user.id, userId))
  if (rows.length === 0) return { error: 'User not found' }
  if (rows[0].tagChanged) {
    return { error: 'Tag can only be changed once' }
  }
  if (rows[0].username === trimmed.toLowerCase()) {
    return { error: 'This is already your tag' }
  }

  // Uniqueness check
  const taken = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.username, trimmed.toLowerCase()))
  if (taken.length > 0) {
    return { error: 'This tag is already taken' }
  }

  await db
    .update(user)
    .set({
      username: trimmed.toLowerCase(),
      displayUsername: trimmed,
      tagChanged: true,
      updatedAt: new Date(),
    })
    .where(eq(user.id, userId))
  revalidateTag('profile', 'max')
  revalidatePath('/profile')
  revalidatePath('/')
  return { success: true }
}

const MAX_AVATAR_BYTES = 400 * 1024 // ~400KB after base64

export async function updateAvatar(dataUrl: string) {
  const userId = await getUserId()
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) {
    return { error: 'Invalid image format' }
  }
  if (dataUrl.length > MAX_AVATAR_BYTES * 1.4) {
    return { error: 'Image is too large' }
  }
  await db
    .update(user)
    .set({ image: dataUrl, updatedAt: new Date() })
    .where(eq(user.id, userId))
  revalidateTag('profile', 'max')
  revalidatePath('/profile')
  revalidatePath('/')
  return { success: true }
}
