import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '../lib/markdown'
import { sanitizeAuthors, sanitizeMedia, normalizeVersion, videoEmbedUrl } from '../lib/plugin-types'

describe('parseMarkdown — блоки', () => {
  it('заголовки #, ##, ###', () => {
    const blocks = parseMarkdown('# Раз\n## Два\n### Три')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 2 })
    expect(blocks[2]).toMatchObject({ kind: 'heading', level: 3 })
  })

  it('абзацы: соседние строки склеиваются, пустая строка разделяет', () => {
    const blocks = parseMarkdown('первая\nвторая\n\nтретья')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      inline: [{ kind: 'text', text: 'первая вторая' }],
    })
  })

  it('списки: маркированный и нумерованный', () => {
    const blocks = parseMarkdown('- a\n- b\n\n1. x\n2. y')
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false })
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(2)
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true })
  })

  it('fenced code block сохраняет содержимое как есть', () => {
    const blocks = parseMarkdown('```ts\nconst a = **не жирный**\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'code',
      lang: 'ts',
      code: 'const a = **не жирный**',
    })
  })

  it('цитата и разделитель', () => {
    const blocks = parseMarkdown('> мудрость\n> веков\n\n---')
    expect(blocks[0]).toMatchObject({ kind: 'quote' })
    expect(blocks[1]).toMatchObject({ kind: 'hr' })
  })

  it('пустой ввод → нет блоков', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('   \n \n')).toEqual([])
  })
})

describe('parseInline — инлайны', () => {
  it('жирный, курсив, код', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
    ])
  })

  it('ссылки: https ок, javascript: вырезается в текст', () => {
    expect(parseInline('[ok](https://aura.dev)')).toEqual([
      { kind: 'link', text: 'ok', href: 'https://aura.dev' },
    ])
    // Небезопасный href вырезается: остаётся текст ссылки (+ «хвост» скобки,
    // т.к. url-часть не может содержать ')').
    expect(parseInline('[evil](javascript:alert(1))')).toEqual([
      { kind: 'text', text: 'evil' },
      { kind: 'text', text: ')' },
    ])
  })

  it('внутри `кода` разметка не парсится', () => {
    expect(parseInline('`**raw**`')).toEqual([{ kind: 'code', text: '**raw**' }])
  })
})

describe('sanitizeAuthors / sanitizeMedia', () => {
  it('авторы: пустые ники выбрасываются, поля обрезаются', () => {
    expect(
      sanitizeAuthors([
        { nick: '  wiks  ', requisites: ' 2200 7000 0000 0000 ' },
        { nick: '', requisites: 'x' },
        null,
      ]),
    ).toEqual([{ nick: 'wiks', requisites: '2200 7000 0000 0000' }])
  })

  it('медиа: только http(s)-ссылки, тип по умолчанию image', () => {
    expect(
      sanitizeMedia([
        { type: 'video', url: 'https://youtu.be/abc12345', caption: 'демо' },
        { type: 'image', url: 'javascript:alert(1)', caption: 'зло' },
        { type: 'weird', url: 'https://x.io/s.png', caption: '' },
      ]),
    ).toEqual([
      { type: 'video', url: 'https://youtu.be/abc12345', caption: 'демо' },
      { type: 'image', url: 'https://x.io/s.png', caption: '' },
    ])
  })

  it('не-массивы → пустые списки', () => {
    expect(sanitizeAuthors('junk')).toEqual([])
    expect(sanitizeMedia({})).toEqual([])
  })
})

describe('normalizeVersion', () => {
  it('валидные версии', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('v2.0')).toBe('2.0')
    expect(normalizeVersion(' 1.0.0-beta ')).toBe('1.0.0-beta')
  })
  it('мусор отклоняется', () => {
    expect(normalizeVersion('abc')).toBeNull()
    expect(normalizeVersion('')).toBeNull()
    expect(normalizeVersion('1.2.3.4.5')).toBeNull()
  })
})

describe('videoEmbedUrl', () => {
  it('youtube / youtu.be / vimeo / rutube → embed', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
    expect(videoEmbedUrl('https://vimeo.com/12345')).toBe('https://player.vimeo.com/video/12345')
    expect(videoEmbedUrl('https://rutube.ru/video/abcdef/')).toBe(
      'https://rutube.ru/play/embed/abcdef',
    )
  })
  it('прямые mp4 и мусор → null (рендерим <video>)', () => {
    expect(videoEmbedUrl('https://cdn.x.io/demo.mp4')).toBeNull()
    expect(videoEmbedUrl('not a url')).toBeNull()
  })
})
