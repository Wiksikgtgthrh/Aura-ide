import { getSession } from '@/lib/session'
import { pickOpenAiKey } from '@/lib/ai-key-pick'

/**
 * AI-действия из IDE: code actions (объясни / рефактори / тесты / фикс /
 * docstring), AI-в-терминале (natural language → shell command),
 * AI-ревью git-diff. Общий стриминговый эндпоинт: SSE (text/event-stream)
 * с чанками `data: {chunk?, done?}\n\n`.
 *
 * Единственная авторизация — сессия пользователя; ключ выбирается тот же,
 * что и для inline-completions.
 */

export const runtime = 'nodejs'
export const maxDuration = 120

type Payload = {
  /** тип действия — задаёт системный промпт */
  action:
    | 'explain'
    | 'refactor'
    | 'tests'
    | 'fix'
    | 'docs'
    | 'terminal'
    | 'diff-review'
    | 'commit-message'
    | 'custom'
  /** основной вход (код/diff/natural language) */
  input: string
  /** дополнительный контекст: язык, путь, ОС, инструкция пользователя */
  language?: string
  path?: string
  os?: string
  instruction?: string
}

function systemFor(action: Payload['action'], p: Payload): string {
  switch (action) {
    case 'explain':
      return 'Ты помощник разработчика. Кратко и по делу объясни, что делает выделенный код и на что стоит обратить внимание. Отвечай на русском.'
    case 'refactor':
      return 'Отрефактори выделенный код: улучшить читаемость, устранить дубли, вынести константы, сохранив поведение. Верни ТОЛЬКО отрефакторенный код в fenced-блоке нужного языка, без пояснений.'
    case 'tests':
      return `Сгенерируй unit-тесты для выделенного кода (${p.language ?? 'auto'}). Выбери актуальный фреймворк по языку (vitest/jest для TS/JS, pytest для Python, cargo test для Rust, go test для Go). Верни ТОЛЬКО код тестов в одном fenced-блоке.`
    case 'fix':
      return 'Исправь баги в выделенном коде. Верни ТОЛЬКО исправленный код в fenced-блоке, БЕЗ пояснений. Если проблем нет — верни исходный код без изменений.'
    case 'docs':
      return 'Добавь к каждому public API (функция/класс/метод) doc-комментарий в стиле языка (JSDoc/rustdoc/docstring). Верни ТОЛЬКО итоговый код в fenced-блоке.'
    case 'terminal':
      return `Ты — генератор shell-команд для ${p.os ?? 'unix'}. По естественному описанию задачи верни ОДНУ команду, готовую к запуску. Ответ ТОЛЬКО код в fenced-блоке \`\`\`bash — без пояснений. Если задача опасна (rm -rf /), верни команду с предупредительным комментарием # ВНИМАНИЕ: ... на первой строке.`
    case 'diff-review':
      return 'Проведи code-review переданного git diff. Формат: краткое резюме (2-3 строки), затем маркированный список конкретных замечаний (баги, риски, стиль, тесты). На русском.'
    case 'commit-message':
      return 'Сгенерируй сообщение коммита в стиле Conventional Commits по переданному diff. Одна строка заголовка (≤ 72 символа) + пустая строка + короткий body с списком изменений. Только само сообщение, без обёрток.'
    default:
      return p.instruction ?? 'Помоги разработчику по запросу пользователя.'
  }
}

function userFor(action: Payload['action'], p: Payload): string {
  const lang = p.language ? `Язык: ${p.language}\n` : ''
  const path = p.path ? `Файл: ${p.path}\n` : ''
  const instr = p.instruction ? `Указания пользователя: ${p.instruction}\n\n` : ''
  const block = (label: string) => `${label}:\n\`\`\`${p.language ?? ''}\n${p.input}\n\`\`\``
  switch (action) {
    case 'terminal':
      return `${instr}Задача: ${p.input}`
    case 'diff-review':
    case 'commit-message':
      return `${block('Diff')}`
    default:
      return `${lang}${path}${instr}${block('Код')}`
  }
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })
  const userId = session.user.id

  let body: Payload
  try {
    body = (await req.json()) as Payload
  } catch {
    return new Response('bad json', { status: 400 })
  }
  if (!body?.input) return new Response('empty input', { status: 400 })

  const picked = await pickOpenAiKey(userId)
  if (!picked) {
    return new Response(JSON.stringify({ error: 'no_key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = `${picked.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${picked.apiKey}`,
    },
    body: JSON.stringify({
      model: picked.modelId,
      temperature: body.action === 'terminal' ? 0.1 : 0.3,
      stream: true,
      messages: [
        { role: 'system', content: systemFor(body.action, body) },
        { role: 'user', content: userFor(body.action, body) },
      ],
    }),
  }).catch((e) => ({ ok: false, status: 502, statusText: String(e), body: null }) as any)

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: `upstream_${upstream.status ?? 'error'}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Ретрансляция OpenAI SSE (data: {…}\n\n) в наш простой формат чанков:
  // клиент читает по строкам, ищет `data:` и добавляет `chunk` в UI.
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = upstream.body.getReader()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = ''
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n')
          buffer = parts.pop() ?? ''
          for (const line of parts) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const payload = trimmed.slice(5).trim()
            if (payload === '[DONE]') continue
            try {
              const j = JSON.parse(payload) as {
                choices?: { delta?: { content?: string } }[]
              }
              const piece = j.choices?.[0]?.delta?.content
              if (piece) send({ chunk: piece })
            } catch {
              /* пропускаем битые кадры */
            }
          }
        }
        send({ done: true })
      } catch (e) {
        send({ error: (e as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
