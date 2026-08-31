import { getSession } from '@/lib/session'
import { getChatAccess } from '@/lib/chat-access'
import {
  ensureIdleSweeper,
  getDevServer,
  startDevServer,
  stopDevServer,
  touchProject,
} from '@/lib/terminal'

export const maxDuration = 60

/**
 * Live-превью: управление dev-сервером проекта (npm run dev в контейнере с
 * проброшенным портом, host-фолбэк). Actions: start | stop | status.
 * Возвращает { url } на localhost, который клиент грузит в iframe вкладки Live.
 */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const { chatId, action, script } = (await req.json()) as {
    chatId?: string
    action?: 'start' | 'stop' | 'status'
    script?: string
  }
  if (!chatId) return new Response('chatId is required', { status: 400 })

  const access = await getChatAccess(chatId, session.user.id)
  if (!access || access.level === 'read') {
    return new Response('Forbidden', { status: 403 })
  }

  ensureIdleSweeper()
  touchProject(chatId)

  try {
    if (action === 'stop') {
      stopDevServer(chatId)
      return Response.json({ ok: true, running: false })
    }
    if (action === 'status') {
      const s = getDevServer(chatId)
      return Response.json({ ok: true, running: !!s, url: s?.url ?? null })
    }
    // start (default)
    const { url } = await startDevServer(chatId, (script || 'dev').slice(0, 40))
    return Response.json({ ok: true, running: true, url })
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
