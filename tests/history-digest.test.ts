import { describe, expect, it } from 'vitest'
import { buildHistoryDigest } from '../lib/history-digest'
import type { UIMessage } from 'ai'

function msg(role: 'user' | 'assistant', text: string, id = Math.random().toString(36)): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage
}

describe('buildHistoryDigest — резюме свёрнутой истории', () => {
  it('пустой ввод → пустая строка', () => {
    expect(buildHistoryDigest([])).toBe('')
  })

  it('собирает запросы пользователя и файлы из ответов', () => {
    const digest = buildHistoryDigest([
      msg('user', 'Сделай лендинг кофейни'),
      msg('assistant', 'Готово!\n```file:src/App.tsx\ncode\n```\n```file:src/components/Hero.tsx\ncode\n```'),
      msg('user', 'Добавь тёмную тему'),
    ])
    expect(digest).toContain('Сделай лендинг кофейни')
    expect(digest).toContain('Добавь тёмную тему')
    expect(digest).toContain('src/App.tsx')
    expect(digest).toContain('src/components/Hero.tsx')
    expect(digest).toContain('РАНЕЕ В ПРОЕКТЕ')
  })

  it('обрезает длинные запросы и убирает служебные вставки про элемент превью', () => {
    const long = 'а'.repeat(300)
    const digest = buildHistoryDigest([
      msg('user', `[Выбранный элемент в превью: <div>] ${long}`),
    ])
    expect(digest).not.toContain('Выбранный элемент')
    expect(digest).toContain('а'.repeat(140) + '…')
  })

  it('берёт только последние 12 запросов', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => msg('user', `запрос номер ${i}`))
    const digest = buildHistoryDigest(msgs)
    expect(digest).not.toContain('запрос номер 7')
    expect(digest).toContain('запрос номер 8')
    expect(digest).toContain('запрос номер 19')
  })

  it('без текста и файлов → пустая строка', () => {
    const digest = buildHistoryDigest([
      { id: 'x', role: 'assistant', parts: [] } as unknown as UIMessage,
    ])
    expect(digest).toBe('')
  })
})
