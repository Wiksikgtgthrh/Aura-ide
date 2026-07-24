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
  // Short first delays: the common race (client navigated ~100-300ms before
  // createChat committed) resolves on the 1st-2nd retry, so a brand-new chat
  // opens ~100ms sooner than with a flat 200ms interval. Later delays grow so
  // the total budget (~1.9s) still covers a slow DB commit.
  const delays = [100, 150, 200, 250, 300, 400, 500]
  for (let i = 0; i <= delays.length; i++) {
    const access = await getChatAccess(id, userId)
    if (access) return access
    if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]))
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
