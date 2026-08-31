'use server'

import { getSession } from '@/lib/session'
import { getChatAccess, type ChatAccessLevel } from '@/lib/chat-access'
import {
  createCheckpoint,
  extractFilesFromUiMessages,
  getCheckpointFiles,
  listCheckpoints,
  loadChatMessagesFresh,
  saveChatMessages,
  syncProjectFiles,
  type CheckpointListItem,
} from '@/lib/chat-store'

async function requireAccess(
  chatId: string,
  minimum: 'read' | 'edit',
): Promise<ChatAccessLevel | null> {
  const session = await getSession()
  if (!session?.user) return null
  const access = await getChatAccess(chatId, session.user.id)
  if (!access) return null
  if (minimum === 'edit' && access.level === 'read') return null
  return access.level
}

export async function getCheckpoints(
  chatId: string,
): Promise<CheckpointListItem[]> {
  const level = await requireAccess(chatId, 'read')
  if (!level) return []
  return listCheckpoints(chatId)
}

/** Files of a specific checkpoint — used by the diff viewer. */
export async function getCheckpointSnapshot(
  chatId: string,
  checkpointId: string,
): Promise<Record<string, string> | null> {
  const level = await requireAccess(chatId, 'read')
  if (!level) return null
  return getCheckpointFiles(chatId, checkpointId)
}

/**
 * Roll the project back to a checkpoint: the snapshot becomes the persistent
 * FS (full sync — files added after the checkpoint are removed). Returns the
 * restored file map so the editor can update instantly.
 */
export async function restoreCheckpoint(
  chatId: string,
  checkpointId: string,
): Promise<Record<string, string> | null> {
  const level = await requireAccess(chatId, 'edit')
  if (!level) return null
  const files = await getCheckpointFiles(chatId, checkpointId)
  if (!files) return null
  await syncProjectFiles(chatId, files)
  return files
}

/**
 * Roll the CHAT and the project back to the state right after a given
 * assistant reply: messages after it are deleted and the FS is rebuilt from
 * the kept history. The current state is checkpointed first (reversible via
 * «История версий»).
 */
export async function rollbackToMessage(
  chatId: string,
  messageId: string,
): Promise<boolean> {
  const level = await requireAccess(chatId, 'edit')
  if (!level) return false
  const all = await loadChatMessagesFresh(chatId)
  const idx = all.findIndex((m) => m.id === messageId)
  if (idx === -1) return false
  const keep = all.slice(0, idx + 1)
  await createCheckpoint(chatId, 'Перед откатом')
  await saveChatMessages(chatId, keep)
  await syncProjectFiles(chatId, extractFilesFromUiMessages(keep))
  return true
}

/**
 * Remove a user message and everything after it (edit-and-resend flow). The
 * FS is rebuilt from the kept history; current state is checkpointed first.
 */
export async function truncateChatFromMessage(
  chatId: string,
  messageId: string,
): Promise<boolean> {
  const level = await requireAccess(chatId, 'edit')
  if (!level) return false
  const all = await loadChatMessagesFresh(chatId)
  const idx = all.findIndex((m) => m.id === messageId)
  if (idx === -1) return false
  const keep = all.slice(0, idx)
  await createCheckpoint(chatId, 'Перед редактированием сообщения')
  await saveChatMessages(chatId, keep)
  await syncProjectFiles(chatId, extractFilesFromUiMessages(keep))
  return true
}
