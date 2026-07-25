import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  maskKey,
  normalizeBaseUrl,
  parseKeyLines,
  parseModelList,
  probeFailReason,
} from '../lib/model-probe'

describe('parseKeyLines — «один ключ на строку»', () => {
  it('разбивает по строкам, чистит пробелы и пустые строки', () => {
    expect(parseKeyLines('  sk-aaa  \n\nsk-bbb\r\n   \n sk-ccc')).toEqual([
      'sk-aaa',
      'sk-bbb',
      'sk-ccc',
    ])
  })

  it('пустой ввод → пустой список', () => {
    expect(parseKeyLines('')).toEqual([])
    expect(parseKeyLines('   \n \n')).toEqual([])
  })

  it('ограничивает количество ключей (защита от гигантских вставок)', () => {
    const text = Array.from({ length: 150 }, (_, i) => `sk-${i}`).join('\n')
    expect(parseKeyLines(text)).toHaveLength(100)
    expect(parseKeyLines(text, 5)).toHaveLength(5)
  })
})

describe('parseModelList — модели через запятую/;/переносы', () => {
  it('принимает строку с любыми разделителями', () => {
    expect(parseModelList('gpt-4o, gpt-4o-mini; llama-3\ndeepseek')).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
      'llama-3',
      'deepseek',
    ])
  })

  it('принимает массив строк (как в «Мои API»)', () => {
    expect(parseModelList(['gpt-4o', ' mini , nano '])).toEqual(['gpt-4o', 'mini', 'nano'])
  })

  it('пустое → пустой список (наверху подставится модель по умолчанию)', () => {
    expect(parseModelList('')).toEqual([])
  })

  it('ограничивает длину списка', () => {
    expect(parseModelList(Array.from({ length: 30 }, (_, i) => `m${i}`))).toHaveLength(20)
  })
})

describe('normalizeBaseUrl', () => {
  it('пустое значение → базовый URL OpenAI', () => {
    expect(normalizeBaseUrl('')).toBe(DEFAULT_BASE_URL)
    expect(normalizeBaseUrl(null)).toBe(DEFAULT_BASE_URL)
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_BASE_URL)
  })

  it('срезает хвостовые слэши', () => {
    expect(normalizeBaseUrl('https://api.groq.com/openai/v1///')).toBe(
      'https://api.groq.com/openai/v1',
    )
  })
})

describe('maskKey', () => {
  it('короткие ключи полностью маскируются', () => {
    expect(maskKey('short')).toBe('••••••••')
  })
  it('длинные — первые и последние 4 символа', () => {
    expect(maskKey('sk-abcdefghijklmnop')).toBe('sk-a••••mnop')
  })
})

describe('probeFailReason', () => {
  it('включает HTTP-статус и сообщение провайдера', () => {
    expect(
      probeFailReason('gpt-4o', { httpStatus: 401, providerMessage: 'Invalid API key' }),
    ).toBe('Модель gpt-4o: HTTP 401 — Invalid API key')
  })
  it('без статуса — «сеть/таймаут»', () => {
    expect(probeFailReason('gpt-4o', {})).toBe('Модель gpt-4o: сеть/таймаут')
  })
})
