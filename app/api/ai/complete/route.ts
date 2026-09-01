import { getSession } from '@/lib/session'
import { pickOpenAiKey } from '@/lib/ai-key-pick'

/**
 * Inline completions (Copilot-like ghost text).
 *
 * Контракт максимально узкий, потому что вызывается на КАЖДУЮ паузу
 * пользователя в редакторе:
 *   • non-streaming, `max_tokens ≈ 80`, `stop: ["\n\n","```"]` — короткие,
 *     дешёвые, быстро уходят с провайдера,
 *   • cancellable из клиента (AbortController → fetch abort),
 *   • без БД-побочек, без промпт-плагинов, без телеметрии — только payload
 *     туда, текст обратно.
 *
 * В теле:
 *   { prefix, suffix, language, path? }
 * prefix/suffix — ±30 строк вокруг курсора, отрезаются на клиенте.
 * Ответ: { completion: string } — только продолжение (без префикса).
 */

export const runtime = 'nodejs'
export const maxDuration = 20

type Payload = {
  prefix: string
  suffix?: string
  language?: string
  path?: string
  maxTokens?: number
}

const SYSTEM = `Ты — inline-ассистент программиста в редакторе Monaco.
Задача: продолжить код от позиции курсора между <PREFIX> и <SUFFIX>.
Верни ТОЛЬКО код, БЕЗ markdown-обёрток и БЕЗ пояснений.
Не повторяй ни префикс, ни суффикс. Заверши текущую логическую единицу
(строку/выражение/блок). Соблюдай стиль окружения (отступы, кавычки).`

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
  const prefix = (body.prefix ?? '').slice(-4000)
  const suffix = (body.suffix ?? '').slice(0, 2000)
  if (!prefix.trim()) return Response.json({ completion: '' })

  const picked = await pickOpenAiKey(userId)
  if (!picked) return Response.json({ completion: '', reason: 'no_key' })

  // OpenAI-совместимый chat.completions. Работает и с Groq/OpenRouter/vLLM.
  const url = `${picked.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const controller = new AbortController()
  // Кэп клиента 20 секунд — inline на такую задержку никто не подпишется.
  const kill = setTimeout(() => controller.abort(), 15_000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${picked.apiKey}`,
      },
      body: JSON.stringify({
        model: picked.modelId,
        max_tokens: Math.max(16, Math.min(body.maxTokens ?? 80, 200)),
        temperature: 0.2,
        stream: false,
        stop: ['\n\n', '```'],
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Язык: ${body.language ?? 'text'}${body.path ? `\nФайл: ${body.path}` : ''}\n<PREFIX>\n${prefix}\n</PREFIX>\n<SUFFIX>\n${suffix}\n</SUFFIX>\nПродолжение:`,
          },
        ],
      }),
    })
    if (!res.ok) {
      return Response.json({ completion: '', reason: `http_${res.status}` })
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    let out = j.choices?.[0]?.message?.content ?? ''
    // Модели любят возвращать ```<lang>\n...\n``` — снимем обёртку.
    out = stripFence(out)
    // Иногда модель повторяет последнюю строку префикса — обрежем перекрытие.
    out = stripPrefixOverlap(prefix, out)
    return Response.json({ completion: out })
  } catch (e) {
    return Response.json({
      completion: '',
      reason: (e as Error).name === 'AbortError' ? 'timeout' : 'error',
    })
  } finally {
    clearTimeout(kill)
  }
}

function stripFence(s: string): string {
  const t = s.trim()
  const m = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(t)
  return m ? m[1] : s
}

function stripPrefixOverlap(prefix: string, out: string): string {
  const tail = prefix.slice(-120)
  for (let k = Math.min(tail.length, out.length); k > 8; k--) {
    if (out.startsWith(tail.slice(-k))) return out.slice(k)
  }
  return out
}
