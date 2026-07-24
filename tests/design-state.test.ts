import { describe, expect, it } from 'vitest'
import { deriveDesignState } from '../lib/design-state'

describe('deriveDesignState — интервью не зацикливается', () => {
  it('первое сообщение нового проекта → ASK_DESIGN', () => {
    expect(
      deriveDesignState({ hasProjectFiles: false, assistantTexts: [] }),
    ).toBe('ASK_DESIGN')
  })

  it('после вопроса о дизайне ответ пользователя → GENERATE_NOW', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: ['Какой стиль?\n<design-choices>А|Б</design-choices>'],
      }),
    ).toBe('GENERATE_NOW')
  })

  it('ассистент говорил, но без чипов (small talk) → снова ASK_DESIGN, а не принудительная генерация', () => {
    // Раньше здесь был GENERATE_NOW: после «привет» следующее сообщение
    // пользователя ОБЯЗАНО было породить проект. Теперь интервью остаётся
    // невыполненным (чипов не было) — промпт сам решает по намерению.
    expect(
      deriveDesignState({ hasProjectFiles: false, assistantTexts: ['Привет!'] }),
    ).toBe('ASK_DESIGN')
  })

  it('чипы были два сообщения назад → всё равно GENERATE_NOW (не переспрашивает)', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: [
          'Какой стиль?\n<design-choices>А|Б</design-choices>',
          'Отвечаю на вопрос не по теме.',
        ],
      }),
    ).toBe('GENERATE_NOW')
  })

  it('есть file-блок в истории → EXISTING', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: ['Готово!\n```file:src/App.tsx\ncode\n```'],
      }),
    ).toBe('EXISTING')
  })

  it('файлы в БД без сообщений (импорт) → EXISTING', () => {
    expect(
      deriveDesignState({ hasProjectFiles: true, assistantTexts: [] }),
    ).toBe('EXISTING')
  })
})
