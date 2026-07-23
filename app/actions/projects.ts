'use server'

import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'

async function getUserIdOrNull() {
  const session = await getSession()
  return session?.user?.id ?? null
}

export type ProjectItem = {
  id: number
  name: string
  createdAt: string
}

const fetchProjects = unstable_cache(
  async (userId: string): Promise<ProjectItem[]> => {
    const rows = await db
      .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.createdAt))
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  },
  ['projects'],
  { tags: ['projects'], revalidate: 120 },
)

export async function getProjects(): Promise<ProjectItem[] | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  return fetchProjects(userId)
}

/** Direct version that skips getSession() — use when userId is already known (e.g. in layout). */
export async function getProjectsForUser(userId: string): Promise<ProjectItem[]> {
  return fetchProjects(userId)
}

export async function renameProject(id: number, name: string): Promise<boolean> {
  const userId = await getUserIdOrNull()
  if (!userId) return false
  const trimmed = name.trim().slice(0, 100)
  if (!trimmed) return false
  await db
    .update(projects)
    .set({ name: trimmed })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
  revalidateTag('projects', 'max')
  return true
}

export async function deleteProject(id: number): Promise<boolean> {
  const userId = await getUserIdOrNull()
  if (!userId) return false
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
  revalidateTag('projects', 'max')
  return true
}

export async function createProject(name: string): Promise<ProjectItem | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const trimmed = name.trim().slice(0, 100)
  if (!trimmed) throw new Error('Project name is required')
  const [row] = await db
    .insert(projects)
    .values({ userId, name: trimmed })
    .returning({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
  revalidateTag('projects', 'max')
  return { ...row, createdAt: row.createdAt.toISOString() }
}
