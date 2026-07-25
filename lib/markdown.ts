/**
 * Крошечный markdown-парсер для документации и лендингов плагинов.
 *
 * Никакого dangerouslySetInnerHTML: парсер возвращает СТРУКТУРУ (блоки и
 * инлайны), а components/markdown.tsx рендерит её React-элементами — весь
 * пользовательский текст автоматически экранируется Реактом.
 *
 * Поддержка: # ## ### заголовки, **жирный**, *курсив*, `код`, ```блоки кода```,
 * - / * / 1. списки, > цитаты, --- разделитель, [текст](https://ссылка),
 * пустая строка = новый абзац.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: MdInline[] }
  | { kind: 'paragraph'; inline: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; inline: MdInline[] }
  | { kind: 'hr' }

/** Только безопасные ссылки — никаких javascript:/data:. */
function safeHref(href: string): string | null {
  const t = href.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('/') && !t.startsWith('//')) return t
  return null
}

/** Разбор инлайн-разметки: `код`, **жирный**, *курсив*, [текст](url). */
export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = []
  let rest = text
  // Порядок важен: code → bold → italic → link (код не парсится внутри).
  const pattern =
    /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*\s][^*]*)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/
  while (rest.length > 0) {
    const m = rest.match(pattern)
    if (!m || m.index === undefined) {
      out.push({ kind: 'text', text: rest })
      break
    }
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) })
    if (m[1]) out.push({ kind: 'code', text: m[2] })
    else if (m[3]) out.push({ kind: 'bold', text: m[4] })
    else if (m[5]) out.push({ kind: 'italic', text: m[6] })
    else if (m[7]) {
      const href = safeHref(m[9])
      if (href) out.push({ kind: 'link', text: m[8], href })
      else out.push({ kind: 'text', text: m[8] })
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out.filter((t) => !(t.kind === 'text' && t.text.length === 0))
}

/** Разбор markdown-текста в блоки. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = (src ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push({
        kind: 'list',
        ordered: list.ordered,
        items: list.items.map(parseInline),
      })
      list = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Fenced code block.
    const fence = trimmed.match(/^```(\S*)\s*$/)
    if (fence) {
      flushParagraph()
      flushList()
      const lang = fence[1] ?? ''
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      blocks.push({ kind: 'code', lang, code: buf.join('\n') })
      continue
    }

    if (trimmed === '') {
      flushParagraph()
      flushList()
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        inline: parseInline(heading[2]),
      })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'hr' })
      continue
    }

    const quote = trimmed.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      // Склеиваем последовательные строки цитаты.
      const buf = [quote[1]]
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim().match(/^>\s?(.*)$/)
        if (!next) break
        buf.push(next[1])
        i++
      }
      blocks.push({ kind: 'quote', inline: parseInline(buf.join(' ')) })
      continue
    }

    const unordered = trimmed.match(/^[-*]\s+(.*)$/)
    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/)
    if (unordered || ordered) {
      flushParagraph()
      const isOrdered = !!ordered
      const text = (unordered?.[1] ?? ordered?.[1]) as string
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(text)
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  return blocks
}
