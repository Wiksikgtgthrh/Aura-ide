'use client'

/**
 * Symbol outline — структура текущего файла по данным Monaco.
 *
 * Monaco под капотом дёргает встроенный DocumentSymbolProvider (для TS/JS/JSON
 * — из TS-worker'а). Мы просим его отдать символы и рисуем плоское дерево.
 */

import { useEffect, useState } from 'react'
import {
  Box,
  Braces,
  ChevronRight,
  Code2,
  SquareFunction as FnIcon,
  Type,
  Variable,
} from 'lucide-react'

type FlatSymbol = {
  name: string
  kind: number
  line: number
  column: number
  depth: number
}

export function SymbolOutline({
  monaco,
  activeFile,
  onGoto,
}: {
  monaco: any | null
  activeFile: string | null
  onGoto: (line: number, column: number) => void
}) {
  const [symbols, setSymbols] = useState<FlatSymbol[]>([])

  useEffect(() => {
    if (!monaco || !activeFile) {
      setSymbols([])
      return
    }
    let cancelled = false
    const update = async () => {
      const model = monaco.editor.getModels().find((m: any) => {
        const fs = m.uri?.fsPath ?? ''
        return fs === activeFile || m.uri?.path === activeFile || m.uri?.toString?.().endsWith(activeFile)
      })
      if (!model) {
        setSymbols([])
        return
      }
      // Monaco 0.x — использует providerFactoryRegistry, но публичный API —
      // `monaco.languages.getLanguages().*` не даёт напрямую вызвать провайдер.
      // Кросс-версионно достаём через приватную service — редко ломается.
      const service =
        (monaco.editor as any)?._codeEditorService ??
        (monaco.editor as any)?.getEditors?.()?.[0]?.getContribution?.('editor.contrib.documentSymbols')
      let outline: any[] = []
      try {
        const model2 = model
        const providers =
          monaco.languages?.getDocumentSymbolProviders?.(model2) ??
          (monaco.languages as any)?.DocumentSymbolProviderRegistry?.all?.(model2) ??
          []
        if (providers.length) {
          const out = await providers[0].provideDocumentSymbols(model2, {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose: () => {} }),
          })
          if (Array.isArray(out)) outline = out
        }
      } catch {
        outline = []
      }
      if (cancelled) return
      const flat: FlatSymbol[] = []
      const walk = (items: any[], depth: number) => {
        for (const s of items ?? []) {
          const pos = s.range ?? s.location?.range
          if (!pos) continue
          flat.push({
            name: s.name,
            kind: s.kind ?? 0,
            line: pos.startLineNumber,
            column: pos.startColumn,
            depth,
          })
          if (Array.isArray(s.children) && s.children.length) walk(s.children, depth + 1)
        }
      }
      walk(outline, 0)
      setSymbols(flat)
    }
    void update()
    // Пере-запрашиваем при изменении модели (typing).
    const model = monaco.editor.getModels().find((m: any) => (m.uri?.fsPath ?? '') === activeFile)
    const sub = model?.onDidChangeContent?.(() => {
      // debounce ручной — символы дороже пересчитывать на каждый keystroke.
      window.setTimeout(update, 500)
    })
    return () => {
      cancelled = true
      sub?.dispose?.()
    }
  }, [monaco, activeFile])

  return (
    <div className="flex h-full flex-col text-xs">
      <header className="flex h-8 items-center gap-2 border-b border-border px-3">
        <Code2 className="size-3.5" />
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">
          Структура
        </span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {symbols.length}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!activeFile && (
          <div className="p-3 text-muted-foreground">Откройте файл, чтобы увидеть структуру</div>
        )}
        {activeFile && symbols.length === 0 && (
          <div className="p-3 text-muted-foreground">Символы не найдены</div>
        )}
        {symbols.map((s, i) => {
          const Icon = kindIcon(s.kind)
          return (
            <button
              key={i}
              type="button"
              onClick={() => onGoto(s.line, s.column)}
              className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left hover:bg-accent/50"
              style={{ paddingLeft: 8 + s.depth * 10 }}
              title={`${s.name} (line ${s.line})`}
            >
              {s.depth > 0 && <ChevronRight className="size-3 shrink-0 opacity-40" />}
              <Icon className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{s.line}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function kindIcon(kind: number): any {
  // monaco.languages.SymbolKind — числовой enum, значения фиксированы.
  // 4=Class, 5=Method, 6=Property, 7=Field, 9=Constructor, 11=Function,
  // 12=Variable, 13=Constant, 14=String, 22=Struct, 25=Type.
  switch (kind) {
    case 11: // Function
    case 5: // Method
    case 8: // Constructor
    case 9:
      return FnIcon
    case 4: // Class
    case 22:
    case 23:
      return Box
    case 25: // Type
    case 10: // Enum
      return Type
    case 12: // Variable
    case 13: // Constant
    case 6:
    case 7:
      return Variable
    default:
      return Braces
  }
}
