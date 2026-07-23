import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { ChatView } from '@/components/chat-view'
import { loadChatMessages, loadProjectFiles } from '@/lib/chat-store'
import { getChatAccess, type ChatAccess } from '@/lib/chat-access'
import { getSession } from '@/lib/session'
import ChatLoading from './loading'

/**
 * Single access resolution (owner OR shared-project member) with a bounded
 * retry that only covers the brand-new-chat create race — the optimistic
 * client navigates before the background createChat has committed the row.
 * Shared chats always exist, so this loop effectively runs once for them.
 */
async function resolveAccessWithRetry(
  id: string,
  userId: string,
): Promise<ChatAccess | null> {
  const attempts = 8
  for (let i = 0; i < attempts; i++) {
    const access = await getChatAccess(id, userId)
    if (access) return access
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

async function ChatLoader({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')

  const { id } = await params
  const access = await resolveAccessWithRetry(id, session.user.id)
  if (!access) notFound()
  const { chat, level: accessLevel } = access

  const [initialMessages, initialFiles] = await Promise.all([
    loadChatMessages(id),
    // Persistent virtual FS — includes the user's manual edits (message
    // history alone would resurrect stale code on reload).
    loadProjectFiles(id),
  ])

  return (
    // key={id} forces a fresh ChatView per chat: without it React reuses the
    // instance across chatId changes and stale refs (sentPendingRef, modelRef)
    // survive — so the first message of a SECOND new chat never gets sent.
    <ChatView
      key={id}
      chatId={id}
      initialMessages={initialMessages}
      initialFiles={initialFiles}
      mode={(chat.mode as 'html' | 'ide') ?? 'html'}
      title={chat.title}
      readOnly={accessLevel === 'read'}
    />
  )
}

/**
 * All uncached data access (session, chat row, messages) lives inside
 * Suspense: the skeleton streams instantly while the DB round-trips resolve.
 * Required by cacheComponents and makes opening a chat feel immediate.
 */
export default function ChatPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatLoader params={props.params} />
    </Suspense>
  )
}
