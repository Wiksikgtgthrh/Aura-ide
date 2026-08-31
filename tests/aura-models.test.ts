import { describe, expect, it } from 'vitest'
import {
  AURA_MODELS,
  AURA_MODEL_MAP,
  labelMatchesTier,
  normalizeKeyLabel,
  pickPlanKeyForTier,
} from '../lib/aura-models'

describe('normalizeKeyLabel', () => {
  it('нижний регистр, разделители, хвостовые номера отбрасываются', () => {
    expect(normalizeKeyLabel('Aura Max 2')).toBe('aura max')
    expect(normalizeKeyLabel('AURA-MAX-FAST')).toBe('aura max fast')
    expect(normalizeKeyLabel('  AuraMini 10 ')).toBe('auramini')
    expect(normalizeKeyLabel('Aura Pro 1 2')).toBe('aura pro')
  })
})

describe('labelMatchesTier', () => {
  it('матчит метки bulk-импорта («Aura Max 1», «Aura Max 2») к aura-max', () => {
    expect(labelMatchesTier('Aura Max 1', 'aura-max')).toBe(true)
    expect(labelMatchesTier('aura max', 'aura-max')).toBe(true)
    expect(labelMatchesTier('AURA-MAX', 'aura-max')).toBe(true)
  })

  it('не путает Max и Max Fast', () => {
    expect(labelMatchesTier('Aura Max Fast 3', 'aura-max')).toBe(false)
    expect(labelMatchesTier('Aura Max Fast 3', 'aura-max-fast')).toBe(true)
    expect(labelMatchesTier('Aura Max 2', 'aura-max-fast')).toBe(false)
  })

  it('чужие метки и пустота — не матчатся', () => {
    expect(labelMatchesTier('Groq batch', 'aura-max')).toBe(false)
    expect(labelMatchesTier('', 'aura-max')).toBe(false)
    expect(labelMatchesTier('Aura Max', 'nonexistent-tier')).toBe(false)
  })
})

describe('pickPlanKeyForTier', () => {
  const keys = [
    { label: 'Aura Max 1', status: 'valid' },
    { label: 'Aura Max 2', status: 'invalid' },
    { label: 'Aura Max 3', status: 'unknown' },
    { label: 'Aura Mini 1', status: 'valid' },
  ]

  it('выбирает только подходящие и не-invalid ключи', () => {
    const picked = pickPlanKeyForTier(keys, 'aura-max', () => 0)
    expect(picked?.label).toBe('Aura Max 1')
    const picked2 = pickPlanKeyForTier(keys, 'aura-max', () => 0.99)
    expect(picked2?.label).toBe('Aura Max 3') // invalid №2 пропущен
  })

  it('пустой пул → null (фолбэк на Gateway)', () => {
    expect(pickPlanKeyForTier(keys, 'aura-pro')).toBeNull()
    expect(pickPlanKeyForTier([], 'aura-max')).toBeNull()
  })

  it('status отсутствует (немигрированная БД) → ключ участвует', () => {
    expect(pickPlanKeyForTier([{ label: 'Aura Pro' }], 'aura-pro', () => 0)?.label).toBe('Aura Pro')
  })
})

describe('каталог тиров', () => {
  it('у каждого тира есть Gateway-фолбэк', () => {
    for (const m of AURA_MODELS) {
      expect(AURA_MODEL_MAP[m.id]).toBeTruthy()
    }
  })
})
