'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  Database,
  ExternalLink,
  FileCode2,
  Loader2,
  Plug,
  RefreshCw,
  Server,
} from 'lucide-react'
import { getMcpServers, type McpServer } from '@/app/actions/mcp'
import { McpDialog } from '@/components/mcp-dialog'
import { Button } from '@/components/ui/button'

/**
 * Вкладка «БД» в панели IDE (v0-стиль): показывает либо локальную базу
 * проекта (schema/миграции/sqlite из файлов), либо базы, подключённые по MCP
 * (Neon, Supabase, Upstash, …) со статусом доступности. Если ничего нет —
 * аккуратный empty-state с кнопкой подключения.
 */

type HealthResult = {
  id: string
  status: 'ok' | 'error' | 'timeout'
  latencyMs: number | null
  message: string | null
}

/** Файлы проекта, похожие на локальную БД/схему данных. */
const LOCAL_DB_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /(^|\/)drizzle\.config\.(ts|js|mjs)$/i, kind: 'Drizzle config' },
  { re: /(^|\/)schema\.prisma$/i, kind: 'Prisma schema' },
  { re: /(^|\/)(lib|src)\/db(\/|\.|-)/i, kind: 'DB-модуль' },
  { re: /(^|\/)migrations?\//i, kind: 'Миграция' },
  { re: /\.sql$/i, kind: 'SQL' },
  { re: /\.(sqlite3?|db)$/i, kind: 'SQLite' },
  { re: /(^|\/)supabase\//i, kind: 'Supabase' },
]

function detectLocalDbFiles(paths: string[]): { path: string; kind: string }[] {
  const out: { path: string; kind: string }[] = []
  for (const p of paths) {
    const hit = LOCAL_DB_PATTERNS.find((pat) => pat.re.test(p))
    if (hit) out.push({ path: p, kind: hit.kind })
    if (out.length >= 20) break
  }
  return out
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Провайдер по URL — для красивой подписи (neon.tech → Neon). */
function providerOf(url: string): string | null {
  const h = hostOf(url).toLowerCase()
  if (h.includes('neon')) return 'Neon'
  if (h.includes('supabase')) return 'Supabase'
  if (h.includes('upstash')) return 'Upstash'
  if (h.includes('vercel') && h.includes('blob')) return 'Vercel Blob'
  if (h.includes('blob')) return 'Blob'
  if (h.includes('planetscale')) return 'PlanetScale'
  if (h.includes('turso')) return 'Turso'
  if (h.includes('mongo')) return 'MongoDB'
  return null
}

function StatusBadge({ health, checking }: { health?: HealthResult; checking: boolean }) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> проверяем…
      </span>
    )
  }
  if (!health) return <span className="size-1.5 rounded-full bg-muted-foreground/40" title="Не проверялся" />
  if (health.status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        доступен{health.latencyMs != null ? ` · ${health.latencyMs} мс` : ''}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-destructive"
      title={health.message ?? undefined}
    >
      <span className="size-1.5 rounded-full bg-destructive" />
      {health.status === 'timeout' ? 'таймаут' : 'недоступен'}
    </span>
  )
}

export function IdeDbTab({
  filePaths,
  onOpenFile,
}: {
  filePaths: string[]
  onOpenFile: (path: string) => void
}) {
  const [mcpOpen, setMcpOpen] = useState(false)
  const [health, setHealth] = useState<Map<string, HealthResult>>(new Map())
  const [checking, setChecking] = useState(false)

  const { data: servers, mutate } = useSWR<McpServer[]>('mcp-servers', () => getMcpServers(), {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  const localDb = useMemo(() => detectLocalDbFiles(filePaths), [filePaths])
  const enabledServers = (servers ?? []).filter((s) => s.enabled)

  const checkHealth = async () => {
    if (checking) return
    setChecking(true)
    try {
      const res = await fetch('/api/mcp/health', { method: 'POST' })
      if (res.ok) {
        const data = (await res.json()) as { results?: HealthResult[] } | HealthResult[]
        const list = Array.isArray(data) ? data : (data.results ?? [])
        setHealth(new Map(list.map((r) => [r.id, r])))
      }
    } catch {
      /* сеть — просто не обновим статусы */
    } finally {
      setChecking(false)
    }
  }

  const hasAnything = localDb.length > 0 || enabledServers.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {!hasAnything ? (
        /* Empty-state в духе v0: «No Database Connected» */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center animate-in fade-in duration-300">
          <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-card shadow-xs">
            <Database className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-foreground">База данных не подключена</p>
          <p className="max-w-sm text-pretty text-sm text-muted-foreground">
            Подключите Neon, Supabase, Upstash или другую базу по MCP — Aura увидит её
            и сможет работать с данными. Локальная схема проекта (Drizzle/Prisma/SQL)
            появится здесь автоматически.
          </p>
          <Button size="sm" className="mt-1 gap-1.5" onClick={() => setMcpOpen(true)}>
            <Plug className="size-3.5" />
            Подключить БД
          </Button>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-5 py-5">
          {/* Локальная БД проекта */}
          <section>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Database className="size-3.5" />
              Локальная — файлы проекта
            </div>
            {localDb.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                В проекте пока нет схемы БД (drizzle.config, schema.prisma, *.sql, миграции).
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                {localDb.map((f, i) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => onOpenFile(f.path)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent ${i > 0 ? 'border-t border-border' : ''}`}
                    title="Открыть в редакторе"
                  >
                    <FileCode2 className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{f.path}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{f.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Подключено по MCP */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Server className="size-3.5" />
                Подключено по MCP
              </div>
              {enabledServers.length > 0 && (
                <button
                  type="button"
                  onClick={() => void checkHealth()}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className={`size-3 ${checking ? 'animate-spin' : ''}`} />
                  Проверить
                </button>
              )}
            </div>
            {enabledServers.length === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  MCP-серверы не подключены. Подключите Neon/Supabase/Blob — база появится здесь.
                </p>
                <Button size="xs" variant="outline" className="gap-1" onClick={() => setMcpOpen(true)}>
                  <Plug className="size-3" /> Подключить
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {enabledServers.map((s, i) => {
                  const provider = providerOf(s.url)
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300"
                      style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'backwards' }}
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Database className="size-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                          {provider && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              {provider}
                            </span>
                          )}
                        </div>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{hostOf(s.url)}</p>
                      </div>
                      <StatusBadge health={health.get(s.id)} checking={checking} />
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setMcpOpen(true)}
                  className="flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <ExternalLink className="size-3" />
                  Управлять подключениями
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      <McpDialog
        open={mcpOpen}
        onClose={() => {
          setMcpOpen(false)
          void mutate()
        }}
      />
    </div>
  )
}
