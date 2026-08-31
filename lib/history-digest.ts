import type { UIMessage } from 'ai'

/**
 * Резюме свёрнутой истории чата. Длинные проекты не влезают в окно модели
 * (route отправляет только хвост истории) — из-за этого «контекст терялся»:
 * модель забывала, что уже сделано. Этот дайджест строится ДЕТЕРМИНИРОВАННО
 * (без лишнего вызова модели): последние запросы пользователя + список файлов,
 * которые уже создавались, — и подмешивается в системный промпт.
 */

const FILE_MARKER_RE = /```file:([\w./\-]+)/g

function textOf(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text?: string }).text ?? '')
    .join(' ')
}

export function buildHistoryDigest(trimmed: UIMessage[]): string {
  if (trimmed.length === 0) return ''

  // Последние запросы пользователя из свёрнутой части (без служебных вставок).
  const userAsks = trimmed
    .filter((m) => m.role === 'user')
    .map((m) =>
      textOf(m)
        .replace(/\[Выбранный элемент в превью:[\s\S]*?\]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .slice(-12)
    .map((t) => `- ${t.slice(0, 140)}${t.length > 140 ? '…' : ''}`)

  // Файлы, которые уже создавались/менялись в свёрнутой части.
  const files = new Set<string>()
  for (const m of trimmed) {
    if (m.role !== 'assistant') continue
    for (const match of textOf(m).matchAll(FILE_MARKER_RE)) {
      files.add(match[1])
      if (files.size >= 30) break
    }
  }

  if (userAsks.length === 0 && files.size === 0) return ''

  const parts: string[] = [
    '\n\nРАНЕЕ В ПРОЕКТЕ (старые сообщения свёрнуты — краткое резюме):',
  ]
  if (userAsks.length > 0) {
    parts.push(`Прошлые запросы пользователя:\n${userAsks.join('\n')}`)
  }
  if (files.size > 0) {
    parts.push(`Файлы, уже создававшиеся ранее: ${Array.from(files).join(', ')}`)
  }
  parts.push(
    'Учитывай это как контекст: не переспрашивай уже решённое и не пересоздавай существующие файлы без необходимости (их актуальные версии — в CURRENT PROJECT FILES).',
  )
  return parts.join('\n')
}
