/**
 * Minimal ANSI SGR → styled segments parser for the terminal renderer.
 * Handles the common colour/emphasis codes that npm/vite/eslint/git emit
 * (foreground 30-37 / 90-97, bold, dim, reset). Unknown codes are ignored.
 */
export type AnsiSegment = { text: string; className: string }

const FG: Record<number, string> = {
  30: 'text-zinc-500',
  31: 'text-red-400',
  32: 'text-emerald-400',
  33: 'text-amber-400',
  34: 'text-blue-400',
  35: 'text-fuchsia-400',
  36: 'text-cyan-400',
  37: 'text-zinc-200',
  90: 'text-zinc-500',
  91: 'text-red-300',
  92: 'text-emerald-300',
  93: 'text-amber-300',
  94: 'text-blue-300',
  95: 'text-fuchsia-300',
  96: 'text-cyan-300',
  97: 'text-white',
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[([0-9;]*)m/g

export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let fg = ''
  let bold = false
  let dim = false
  let last = 0
  let m: RegExpExecArray | null

  const classNameFor = () =>
    [fg, bold ? 'font-semibold' : '', dim ? 'opacity-60' : '']
      .filter(Boolean)
      .join(' ')

  const push = (text: string) => {
    if (text) segments.push({ text, className: classNameFor() })
  }

  ANSI_RE.lastIndex = 0
  while ((m = ANSI_RE.exec(input)) !== null) {
    push(input.slice(last, m.index))
    last = ANSI_RE.lastIndex
    const codes = m[1] === '' ? [0] : m[1].split(';').map((c) => Number(c) || 0)
    for (const code of codes) {
      if (code === 0) {
        fg = ''
        bold = false
        dim = false
      } else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 22) {
        bold = false
        dim = false
      } else if (FG[code]) fg = FG[code]
      else if (code === 39) fg = ''
    }
  }
  push(input.slice(last))
  return segments
}

/** Strip all ANSI escapes (for log filtering / plain contexts). */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, '')
}
