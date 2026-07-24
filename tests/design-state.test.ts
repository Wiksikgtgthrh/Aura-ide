import { describe, expect, it } from 'vitest'
import { deriveDesignState, hasBuildIntent } from '../lib/design-state'

describe('hasBuildIntent — детектор намерения создать', () => {
  it('просьбы создать → true', () => {
    expect(hasBuildIntent('Создай сайт-портфолио')).toBe(true)
    expect(hasBuildIntent('сделай тёмный дашборд')).toBe(true)
    expect(hasBuildIntent('build a landing page')).toBe(true)
    expect(hasBuildIntent('калькулятор')).toBe(true)
  })
  it('приветствия и болтовня → false', () => {
    expect(hasBuildIntent('привет')).toBe(false)
    expect(hasBuildIntent('как дела?')).toBe(false)
    expect(hasBuildIntent('hello')).toBe(false)
    expect(hasBuildIntent('что ты умеешь?')).toBe(false)
  })
})

describe('deriveDesignState — интервью не зацикливается и не пристаёт', () => {
  it('первое сообщение-просьба создать → ASK_DESIGN', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: [],
        latestUserText: 'Создай сайт кафе',
      }),
    ).toBe('ASK_DESIGN')
  })

  it('первое сообщение «привет» → CHAT (никаких вопросов о стиле)', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: [],
        latestUserText: 'привет',
      }),
    ).toBe('CHAT')
  })

  it('после вопроса о дизайне ответ пользователя → GENERATE_NOW', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: ['Какой стиль?\n<design-choices>А|Б</design-choices>'],
        latestUserText: 'Минимализм',
      }),
    ).toBe('GENERATE_NOW')
  })

  it('болтовня в истории, новое сообщение-просьба → ASK_DESIGN', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: ['Привет! Чем помочь?'],
        latestUserText: 'сделай лендинг',
      }),
    ).toBe('ASK_DESIGN')
  })

  it('болтовня в истории, снова болтовня → CHAT (генерация не навязывается)', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: ['Привет! Чем помочь?'],
        latestUserText: 'как дела?',
      }),
    ).toBe('CHAT')
  })

  it('чипы были два сообщения назад → всё равно GENERATE_NOW (не переспрашивает)', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: [
          'Какой стиль?\n<design-choices>А|Б</design-choices>',
          'Отвечаю на вопрос не по теме.',
        ],
        latestUserText: 'давай минимализм',
      }),
    ).toBe('GENERATE_NOW')
  })

  it('есть file-блок в истории → EXISTING', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: false,
        assistantTexts: ['Готово!\n```file:src/App.tsx\ncode\n```'],
        latestUserText: 'поменяй цвет',
      }),
    ).toBe('EXISTING')
  })

  it('файлы в БД без сообщений (импорт) → EXISTING', () => {
    expect(
      deriveDesignState({
        hasProjectFiles: true,
        assistantTexts: [],
        latestUserText: 'привет',
      }),
    ).toBe('EXISTING')
  })
})
