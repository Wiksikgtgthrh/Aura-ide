'use client'

/**
 * Тонкий клиент к IDE-AI-эндпоинтам.
 * inlineComplete — короткий non-streaming ответ для ghost text.
 * streamAction   — SSE-стрим для code-actions/терминала/ревью.
 */

export async function inlineComplete(input: {
  prefix: string
  suffix?: string
  language?: string
  path?: string
  maxTokens?: number
  signal?: AbortSignal
}): Promise<{ completion: string; reason?: string }> {
  const { signal, ...body } = input
  try {
    const res = await fetch('/api/ai/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) return { completion: '', reason: `http_${res.status}` }
    return (await res.json()) as { completion: string; reason?: string }
  } catch (e) {
    return { completion: '', reason: (e as Error).name === 'AbortError' ? 'abort' : 'error' }
  }
}

export type AiActionType =
  | 'explain'
  | 'refactor'
  | 'tests'
  | 'fix'
  | 'docs'
  | 'terminal'
  | 'diff-review'
  | 'commit-message'
  | 'custom'

export type StreamActionArgs = {
  action: AiActionType
  input: string
  language?: string
  path?: string
  os?: string
  instruction?: string
  onChunk: (piece: string) => void
  signal?: AbortSignal
}

/** SSE-стрим action-эндпоинта. Возвращает финальный текст. */
export async function streamAction(args: StreamActionArgs): Promise<string> {
  const { onChunk, signal, ...body } = args
  const res = await fetch('/api/ai/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const raw of parts) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      try {
        const j = JSON.parse(line.slice(5).trim()) as {
          chunk?: string
          done?: boolean
          error?: string
        }
        if (j.error) throw new Error(j.error)
        if (j.chunk) {
          full += j.chunk
          onChunk(j.chunk)
        }
      } catch {
        /* пропускаем битые кадры */
      }
    }
  }
  return full
}

/** Вытащить содержимое ПЕРВОГО fenced-блока — для «замени выделение результатом». */
export function extractCode(text: string): string {
  const m = /```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/.exec(text)
  return m ? m[1] : text.trim()
}
