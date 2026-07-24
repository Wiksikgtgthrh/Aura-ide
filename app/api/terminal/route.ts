import { getSession } from '@/lib/session'
import { getChatAccess } from '@/lib/chat-access'
import {
  dockerStatus,
  ensureIdleSweeper,
  importProjectFromDisk,
  materializeProject,
  runInProject,
  touchProject,
} from '@/lib/terminal'

export const maxDuration = 300

/**
 * Настоящий терминал проекта.
 *
 * POST { chatId, command } → chunked-поток: маркер backend'а, stdout/stderr по
 * мере выполнения, код завершения, затем строка `[aura:files]{json}` — карта
 * исходников проекта после команды (обратный синк с диска в БД/редактор, без
 * node_modules). Ctrl+C на клиенте = abort запроса → процесс убивается.
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
  const access = await getChatAccess(chatId, session.user.id)
  if (!access || access.level === 'read') {
    return new Response('Forbidden', { status: 403 })
  }

  ensureIdleSweeper()
  touchProject(chatId)
  const dir = await materializeProject(chatId)
  const cmd = command.trim().slice(0, 2000)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          closed = true
        }
      }
      const finish = async () => {
        if (closed) return
        // Обратный синк: подтянуть изменения (новые файлы, package.json…).
        try {
          const files = await importProjectFromDisk(chatId)
          send(`\n[aura:files]${JSON.stringify(files)}\n`)
        } catch {
          /* синк не критичен для вывода */
        }
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {}
        }
      }

      let child: ReturnType<typeof runInProject>['child']
      try {
        const docker = dockerStatus()
        if (docker === 'ready') {
          send('\x1b[2m[aura] backend: docker (контейнер проекта)\x1b[0m\n')
        } else if (docker === 'daemon-down') {
          send(
            '\x1b[33m[aura] Docker установлен, но движок не запущен — запусти Docker Desktop и дождись зелёного значка (в Settings → Resources → WSL Integration движок должен быть включён). Пока команда выполняется на твоей машине (host).\x1b[0m\n',
          )
        } else {
          send(
            '\x1b[33m[aura] backend: host — Docker не найден, команда выполняется на твоей машине\x1b[0m\n',
          )
        }
        child = runInProject(chatId, dir, cmd).child
      } catch (err) {
        send(`[aura] не удалось запустить: ${err instanceof Error ? err.message : 'unknown'}\n`)
        void finish()
        return
      }

      child.stdout?.on('data', (d: Buffer) => send(d.toString('utf8')))
      child.stderr?.on('data', (d: Buffer) => send(d.toString('utf8')))
      child.on('error', (err) => {
        send(`[aura] ошибка: ${err.message}\n`)
        void finish()
      })
      child.on('close', (code) => {
        send(`\n\x1b[2m[aura] exit code: ${code ?? 0}\x1b[0m\n`)
        void finish()
      })

      // Ctrl+C / уход клиента → убить процесс.
      req.signal.addEventListener('abort', () => {
        try {
          child.kill()
        } catch {}
        closed = true
        try {
          controller.close()
        } catch {}
      })

      // Предохранитель на зависшую команду.
      const killer = setTimeout(() => {
        try {
          child.kill()
        } catch {}
      }, 240_000)
      child.on('close', () => clearTimeout(killer))
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
