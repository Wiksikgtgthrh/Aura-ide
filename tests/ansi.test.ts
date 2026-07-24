import { describe, expect, it } from 'vitest'
import { parseAnsi, stripAnsi } from '../lib/ansi'

describe('parseAnsi', () => {
  it('plain text → single segment, no class', () => {
    expect(parseAnsi('hello')).toEqual([{ text: 'hello', className: '' }])
  })

  it('colours a red segment and resets', () => {
    const segs = parseAnsi('a\x1b[31mred\x1b[0mb')
    expect(segs).toEqual([
      { text: 'a', className: '' },
      { text: 'red', className: 'text-red-400' },
      { text: 'b', className: '' },
    ])
  })

  it('combines bold + colour', () => {
    const segs = parseAnsi('\x1b[1;32mok\x1b[0m')
    expect(segs[0].text).toBe('ok')
    expect(segs[0].className).toContain('text-emerald-400')
    expect(segs[0].className).toContain('font-semibold')
  })

  it('ignores unknown codes without crashing', () => {
    expect(parseAnsi('\x1b[38;5;200mx\x1b[0m').map((s) => s.text).join('')).toBe('x')
  })
})

describe('stripAnsi', () => {
  it('removes escape sequences', () => {
    expect(stripAnsi('a\x1b[31mb\x1b[0mc')).toBe('abc')
  })
})
