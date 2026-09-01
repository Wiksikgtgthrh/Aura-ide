'use client'

/**
 * Панель «Problems» — маркеры Monaco по всем открытым моделям.
 *
 * Ошибки/warning'и приходят от встроенного Monaco TS-сервиса (для .ts/.tsx),
 * а также от json/css валидаторов. Без внешнего LSP это уже даёт большую
 * часть пользы: подсветка синтаксиса, undefined variables, missing types,
 * incorrect props.
 */

import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'

// Тип Monaco — импортируем как any, чтобы не тянуть отдельный пакет `monaco-editor`
// (у нас в зависимостях только @monaco-editor/react, который сам подтягивает
// runtime по CDN). Функционально это ничего не ограничивает.

export type ProblemsMarker = {
  file: string
  line: number
  column: number
  message: string
  severity: 'error' | 'warning' | 'info'
  source?: string
}

export function subscribeMonacoMarkers(
  monaco: any,
  onUpdate: (markers: ProblemsMarker[]) => void,
): () => void {
  const collect = () => {
    const all: ProblemsMarker[] = []
    for (const m of monaco.editor.getModels()) {
      const uri = m.uri.toString()
      const file = m.uri.fsPath || uri.replace(/^file:\/\//, '')
      const list = monaco.editor.getModelMarkers({ resource: m.uri })
      for (const mk of list as any[]) {
        all.push({
          file,
          line: mk.startLineNumber,
          column: mk.startColumn,
          message: mk.message,
          severity:
            mk.severity === monaco.MarkerSeverity.Error
              ? 'error'
              : mk.severity === monaco.MarkerSeverity.Warning
                ? 'warning'
                : 'info',
          source: mk.source,
        })
      }
    }
    onUpdate(all)
  }
  const dispose = monaco.editor.onDidChangeMarkers(collect)
  collect()
  return () => dispose.dispose()
}

export function ProblemsPanel({
  markers,
  onOpen,
}: {
  markers: ProblemsMarker[]
  onOpen: (file: string, line: number, column: number) => void
}) {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning'>('all')
  const filtered =
    severityFilter === 'all' ? markers : markers.filter((m) => m.severity === severityFilter)

  const groups = new Map<string, ProblemsMarker[]>()
  for (const m of filtered) {
    const arr = groups.get(m.file)
    if (arr) arr.push(m)
    else groups.set(m.file, [m])
  }

  return (
    <div className="flex h-full flex-col text-xs">
      <header className="flex h-8 items-center gap-2 border-b border-border px-3">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">Проблемы</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {markers.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {(['all', 'error', 'warning'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSeverityFilter(k)}
              className={`rounded px-2 py-0.5 text-[10px] ${
                severityFilter === k ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
              }`}
            >
              {k === 'all' ? 'все' : k === 'error' ? 'ошибки' : 'варнинги'}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-3 text-muted-foreground">Проблем не найдено</div>
        )}
        {Array.from(groups.entries()).map(([file, list]) => (
          <div key={file} className="border-b border-border/50">
            <div className="bg-muted/40 px-3 py-1 text-[10px] text-muted-foreground">
              {file.split(/[\\/]/).pop()}
              <span className="ml-2 opacity-70">{file}</span>
            </div>
            {list.map((m, i) => {
              const Icon =
                m.severity === 'error' ? AlertCircle : m.severity === 'warning' ? AlertTriangle : Info
              const color =
                m.severity === 'error'
                  ? 'text-red-500'
                  : m.severity === 'warning'
                    ? 'text-amber-400'
                    : 'text-sky-400'
              return (
                <button
                  key={`${file}:${m.line}:${m.column}:${i}`}
                  type="button"
                  onClick={() => onOpen(m.file, m.line, m.column)}
                  className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-accent/50"
                >
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
                  <span className="flex-1 text-[11px] leading-4">{m.message}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {m.line}:{m.column}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
