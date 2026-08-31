'use server'

import { getSession } from '@/lib/session'
import { getChatAccess } from '@/lib/chat-access'
import { syncProjectFiles } from '@/lib/chat-store'

/**
 * Autosave of the IDE's virtual file system (debounced on the client).
 * Full sync: files missing from the payload are deleted — so local deletes
 * persist too. Ownership enforced via getChatOwned.
 */
export async function saveProjectFiles(
  chatId: string,
  files: Record<string, string>,
): Promise<{ ok: boolean }> {
  const session = await getSession()
  if (!session?.user) return { ok: false }

  const access = await getChatAccess(chatId, session.user.id)
  if (!access || access.level === 'read') return { ok: false }

  await syncProjectFiles(chatId, files)
  return { ok: true }
}
