import { getSession } from '@/lib/session'
import { getChatAccess } from '@/lib/chat-access'
import {
  dockerAvailable,
  materializeProject,
  runInProject,
} from '@/lib/terminal'

export const maxDuration = 300

/**
 * Настоящий терминал проекта (первый срез глобальной обновы).
 *
 * POST { chatId, command } → chunked-поток текста: маркер backend'а, stdout и
 * stderr по мере выполнения, код завершения. Файлы проекта материализуются
 * на диск перед запуском; предпочтительный backend — Docker-контейнер
 * проекта, fallback — host-шелл (локальный инструмент, только владелец).
 */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const { chatId, command } = (await req.json()) as {
    chatId?: string
    command?: string
  }
  if (!chatId || !command?.trim()) {
    return new Response('chatId and command are required', { status: 400 })
  }
  // Только владелец/редактор проекта может исполнять команды.
  const access = await getChatAccess(chatId, session.user.id)
  if (!access || access.level === 'read') {
    return new Response('Forbidden', { status: 403 })
  }

  const dir = await materializeProject(chatId)
  const cmd = command.trim().slice(0, 2000)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          /* client gone */
        }
      }

      let run: ReturnType<typeof runInProject>
      try {
        const docker = dockerAvailable()
        send(
          docker
            ? '[aura] backend: docker (контейнер проекта)\n'
            : '[aura] backend: host — Docker не найден, команда выполняется прямо на вашей машине\n',
        )
        run = runInProject(chatId, dir, cmd)
      } catch (err) {
        send(`[aura] не удалось запустить команду: ${err instanceof Error ? err.message : 'unknown error'}\n`)
        controller.close()
        return
      }

      const { child } = run
      child.stdout?.on('data', (d: Buffer) => send(d.toString('utf8')))
      child.stderr?.on('data', (d: Buffer) => send(d.toString('utf8')))
      child.on('error', (err) => {
        send(`[aura] ошибка: ${err.message}\n`)
        try {
          controller.close()
        } catch {}
      })
      child.on('close', (code) => {
        send(`\n[aura] exit code: ${code ?? 0}\n`)
        try {
          controller.close()
        } catch {}
      })

      // Жёсткий предохранитель: не держим процесс дольше 4 минут.
      const killer = setTimeout(() => {
        try {
          child.kill()
        } catch {}
      }, 240_000)
      child.on('close', () => clearTimeout(killer))
    },
    cancel() {
      /* поток закрыт клиентом — процесс добьёт таймер */
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
