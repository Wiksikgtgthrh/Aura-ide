'use client'

import { useState, useTransition, useCallback } from 'react'
import useSWR from 'swr'
import type { McpServer } from '@/app/actions/mcp'
import {
  deleteGithubToken,
  getGithubTokenStatus,
  saveGithubToken,
} from '@/app/actions/integration-secrets'
import {
  getMcpServers,
  createMcpServer,
  deleteMcpServer,
  toggleMcpServer,
} from '@/app/actions/mcp'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Globe,
  Trash2,
  Plus,
  CheckCircle2,
  Server,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  Triangle,
  RefreshCw,
  Loader2,
  AlertCircle,
  Clock,
  Zap,
  BookOpen,
  Brain,
  Monitor,
  Database,
  Search,
  Code2,
} from 'lucide-react'

// ---- Static built-in integrations ----------------------------------------

type BuiltInIntegration = {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  connected: boolean
  comingSoon?: boolean
  docsUrl?: string
}

const BUILT_IN: BuiltInIntegration[] = [
  {
    id: 'figma',
    name: 'Figma',
    description: 'Извлекайте дизайны из Figma и превращайте их в код.',
    icon: <Triangle className="size-5" />,
    connected: false,
    comingSoon: false,
    docsUrl: '/settings?section=preferences',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Деплойте проекты прямо из чата без выхода из Aura.',
    icon: <Globe className="size-5" />,
    connected: false,
    comingSoon: true,
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Управляйте задачами и создавайте issues из диалога с Aura.',
    icon: (
      <svg viewBox="0 0 100 100" className="size-5 fill-current">
        <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857l37.0487 37.0487c.6889.6889.0915 1.8189-.857 1.5964C20.0045 94.4522 5.54779 79.9955 1.22541 61.5228zM.00189135 46.8891c-.01764375.2833.08887225.5599.28957775.7606L52.3503 99.7085c.2007.2007.4773.3073.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465958 2.2686-.779585 4.5932-.927193 6.9624zM4.21093 29.7054c-.16648.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5408L7.89501 24.5199c-.45408-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68434 5.1823zM12.9961 18.5349c-.3801-.3801-.3801-.9963 0-1.3763C21.5367 8.66032 33.3126 3.08447 46.3646 3.00011c.2707-.00176.5349.10316.7267.29492l49.9024 49.9024c.1918.1918.2967.4559.2949.7267-.0844 13.0519-5.6602 24.8279-14.1929 33.3685-.38.38-.9962.38-1.3763 0L12.9961 18.5349z" />
      </svg>
    ),
    connected: false,
    comingSoon: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Импортируйте контент из Notion в ваши проекты.',
    icon: (
      <svg viewBox="0 0 24 24" className="size-5 fill-current">
        <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
      </svg>
    ),
    connected: false,
    comingSoon: true,
  },
]

// ---- GitHub PAT (working integration) -------------------------------------

function GithubPatCard() {
  const { data: status, mutate } = useSWR('github-token-status', getGithubTokenStatus, {
    revalidateOnFocus: false,
  })
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  const save = async () => {
    if (!value.trim() || busy) return
    setBusy(true)
    const res = await saveGithubToken(value)
    setBusy(false)
    if (res.ok) {
      setValue('')
      setEditing(false)
      mutate()
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    await deleteGithubToken()
    setBusy(false)
    mutate()
  }

  const connected = status?.connected

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
          <GitBranch className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">GitHub</p>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            Personal Access Token (scope «repo») хранится в зашифрованном виде и
            автоматически используется кнопкой «Опубликовать».
          </p>
        </div>
        <div className="shrink-0">
          {connected ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                Подключено
              </span>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing((e) => !e)}>
                Изменить
              </Button>
              <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={remove} disabled={busy}>
                Отключить
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditing((e) => !e)}>
              Подключить
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ghp_… / github_pat_…"
            autoComplete="off"
            className="h-8 text-xs"
          />
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={busy || !value.trim()}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      )}
    </div>
  )
}

// ---- MCP preset catalog --------------------------------------------------

type McpPreset = {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  url: string
  authType: 'none' | 'bearer'
  docsUrl: string
  tags: string[]
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Загрузка веб-страниц и работа с HTTP-ресурсами из чата.',
    icon: <Globe className="size-4" />,
    url: 'https://mcp.run/fetch',
    authType: 'none',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    tags: ['web', 'http'],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Персистентная память модели между сессиями через граф знаний.',
    icon: <Brain className="size-4" />,
    url: 'https://mcp.run/memory',
    authType: 'none',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    tags: ['memory', 'knowledge'],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Управление браузером: скриншоты, клики, заполнение форм.',
    icon: <Monitor className="size-4" />,
    url: 'https://mcp.run/puppeteer',
    authType: 'none',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    tags: ['browser', 'automation'],
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Чтение и запись файлов на локальном диске (self-hosted).',
    icon: <Database className="size-4" />,
    url: 'https://mcp.run/filesystem',
    authType: 'none',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    tags: ['files', 'storage'],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Веб-поиск через Brave Search API прямо из разговора.',
    icon: <Search className="size-4" />,
    url: 'https://mcp.run/brave-search',
    authType: 'bearer',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    tags: ['search', 'web'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Пошаговое мышление и решение сложных задач с рефлексией.',
    icon: <Code2 className="size-4" />,
    url: 'https://mcp.run/sequential-thinking',
    authType: 'none',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    tags: ['reasoning', 'tools'],
  },
  {
    id: 'everything',
    name: 'Everything',
    description: 'Демонстрационный сервер с примерами всех возможностей MCP.',
    icon: <Zap className="size-4" />,
    url: 'https://mcp.run/everything',
    authType: 'none',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    tags: ['demo', 'all'],
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Актуальная документация по библиотекам и фреймворкам для LLM.',
    icon: <BookOpen className="size-4" />,
    url: 'https://mcp.context7.com',
    authType: 'none',
    docsUrl: 'https://context7.com',
    tags: ['docs', 'libraries'],
  },
]

// ---- Server health state -------------------------------------------------

type HealthStatus = 'unknown' | 'checking' | 'ok' | 'error' | 'timeout'

function HealthDot({ status, latencyMs }: { status: HealthStatus; latencyMs?: number | null }) {
  if (status === 'checking') {
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground/50" />
  }
  if (status === 'ok') {
    return (
      <span className="flex items-center gap-1">
        <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
        {latencyMs != null && (
          <span className="text-[10px] text-emerald-400/70 font-mono">{latencyMs}ms</span>
        )}
      </span>
    )
  }
  if (status === 'error') {
    return <span className="size-2 rounded-full bg-red-500 shrink-0" />
  }
  if (status === 'timeout') {
    return (
      <span className="flex items-center gap-1">
        <Clock className="size-3 text-amber-400" />
        <span className="text-[10px] text-amber-400/70">timeout</span>
      </span>
    )
  }
  return <span className="size-2 rounded-full bg-muted-foreground/20 shrink-0" />
}

// ---- Auth type options ---------------------------------------------------

const AUTH_TYPES = [
  { value: 'none', label: 'Без авторизации' },
  { value: 'bearer', label: 'Bearer токен' },
  { value: 'oauth', label: 'OAuth 2.0' },
]

// ---- Main component ------------------------------------------------------

export function IntegrationsForm({
  initialMcpServers,
}: {
  initialMcpServers?: McpServer[]
}) {
  const { data: swrData, isLoading } = useSWR<McpServer[]>(
    'mcp-servers',
    () => getMcpServers(),
    { fallbackData: initialMcpServers ?? [], revalidateOnFocus: false },
  )
  const [mcpServers, setMcpServers] = useState<McpServer[]>(swrData ?? initialMcpServers ?? [])

  // Sync when SWR first resolves
  const [synced, setSynced] = useState(!!initialMcpServers)
  if (!synced && swrData !== undefined) {
    setSynced(true)
    setMcpServers(swrData)
  }

  const [showAddForm, setShowAddForm] = useState(false)
  const [showCatalog, setShowCatalog] = useState(false)
  const [formData, setFormData] = useState({ name: '', url: '', authType: 'none', token: '' })
  const [pending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [healthMap, setHealthMap] = useState<
    Record<string, { status: HealthStatus; latencyMs?: number | null; message?: string | null }>
  >({})
  const [checkingAll, setCheckingAll] = useState(false)

  function handleAdd() {
    if (!formData.name.trim() || !formData.url.trim()) return
    setSaving(true)
    startTransition(async () => {
      const server = await createMcpServer(formData)
      setMcpServers((prev) => [...prev, server])
      setFormData({ name: '', url: '', authType: 'none', token: '' })
      setShowAddForm(false)
      setSaving(false)
    })
  }

  function handleAddPreset(preset: McpPreset) {
    if (mcpServers.some((s) => s.url === preset.url)) return
    setSaving(true)
    startTransition(async () => {
      const server = await createMcpServer({
        name: preset.name,
        url: preset.url,
        authType: preset.authType,
        token: '',
      })
      setMcpServers((prev) => [...prev, server])
      setSaving(false)
    })
  }

  function handleDelete(id: string) {
    setMcpServers((prev) => prev.filter((s) => s.id !== id))
    setHealthMap((prev) => { const next = { ...prev }; delete next[id]; return next })
    startTransition(async () => {
      await deleteMcpServer(id)
    })
  }

  function handleToggle(id: string, enabled: boolean) {
    setMcpServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)))
    startTransition(async () => {
      await toggleMcpServer(id, enabled)
    })
  }

  const handleCheckHealth = useCallback(async (serverId?: string) => {
    if (serverId) {
      setHealthMap((prev) => ({ ...prev, [serverId]: { status: 'checking' } }))
    } else {
      setCheckingAll(true)
      const checking: Record<string, { status: HealthStatus }> = {}
      mcpServers.forEach((s) => { checking[s.id] = { status: 'checking' } })
      setHealthMap(checking)
    }

    try {
      const res = await fetch('/api/mcp/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverId ? { serverId } : {}),
      })
      const data = await res.json()
      for (const result of data.results ?? []) {
        setHealthMap((prev) => ({
          ...prev,
          [result.id]: {
            status: result.status === 'ok' ? 'ok' : result.status === 'timeout' ? 'timeout' : 'error',
            latencyMs: result.latencyMs,
            message: result.message,
          },
        }))
      }
    } catch {
      if (serverId) {
        setHealthMap((prev) => ({ ...prev, [serverId]: { status: 'error', message: 'Ошибка запроса' } }))
      }
    } finally {
      setCheckingAll(false)
    }
  }, [mcpServers])

  const connectedPresetUrls = new Set(mcpServers.map((s) => s.url))

  // Loading guard is placed here — after all hooks — to satisfy Rules of Hooks.
  if (isLoading && !initialMcpServers) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Built-in integrations */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Встроенные интеграции
        </h2>
        <div className="flex flex-col gap-2">
          <GithubPatCard />
          {BUILT_IN.map((integration) => (
            <div
              key={integration.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-background p-4"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
                {integration.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{integration.name}</p>
                  {integration.comingSoon && (
                    <span className="rounded-full bg-muted border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      Скоро
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{integration.description}</p>
              </div>
              <div className="shrink-0">
                {integration.connected ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    Подключено
                  </div>
                ) : integration.comingSoon ? (
                  <span className="text-xs text-muted-foreground/50">—</span>
                ) : integration.docsUrl ? (
                  <a
                    href={integration.docsUrl}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-foreground hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    Настроить
                  </a>
                ) : (
                  <Button size="sm" variant="outline" className="h-8 text-xs" disabled>
                    Подключить
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* MCP Servers */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            MCP-серверы
            {mcpServers.length > 0 && (
              <span className="ml-2 normal-case tracking-normal font-medium text-[11px] text-muted-foreground">
                ({mcpServers.length})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {mcpServers.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleCheckHealth()}
                disabled={checkingAll}
              >
                {checkingAll
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <RefreshCw className="size-3.5" />
                }
                Проверить все
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setShowAddForm((v) => !v)}
            >
              {showAddForm ? <ChevronUp className="size-3.5" /> : <Plus className="size-3.5" />}
              Добавить сервер
            </Button>
          </div>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Название</label>
                <Input
                  placeholder="My MCP Server"
                  value={formData.name}
                  onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">URL</label>
                <Input
                  placeholder="https://mcp.example.com"
                  value={formData.url}
                  onChange={(e) => setFormData((d) => ({ ...d, url: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Тип авторизации</label>
                <select
                  value={formData.authType}
                  onChange={(e) => setFormData((d) => ({ ...d, authType: e.target.value }))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {AUTH_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {formData.authType !== 'none' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Токен</label>
                  <Input
                    type="password"
                    placeholder="Bearer токен..."
                    value={formData.token}
                    onChange={(e) => setFormData((d) => ({ ...d, token: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowAddForm(false)}>
                Отмена
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleAdd}
                disabled={saving || !formData.name.trim() || !formData.url.trim()}
              >
                {saving ? 'Сохранение...' : 'Добавить'}
              </Button>
            </div>
          </div>
        )}

        {mcpServers.length === 0 && !showAddForm ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
            <Server className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Нет добавленных MCP-серверов</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Добавьте сервер вручную или выберите из каталога ниже
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {mcpServers.map((server) => {
              const health = healthMap[server.id]
              return (
                <div
                  key={server.id}
                  className={`flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors ${
                    health?.status === 'error' ? 'border-red-500/30' :
                    health?.status === 'ok' ? 'border-emerald-500/20' :
                    'border-border'
                  }`}
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                    <Server className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{server.name}</p>
                      <HealthDot
                        status={health?.status ?? 'unknown'}
                        latencyMs={health?.latencyMs}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{server.url}</p>
                    {health?.message && (health.status === 'error' || health.status === 'timeout') && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-red-400/80">
                        <AlertCircle className="size-3 shrink-0" />
                        {health.message}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full bg-muted border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {AUTH_TYPES.find((t) => t.value === server.authType)?.label ?? server.authType}
                    </span>
                    <button
                      onClick={() => handleCheckHealth(server.id)}
                      disabled={health?.status === 'checking'}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Проверить сервер"
                      title="Проверить доступность"
                    >
                      {health?.status === 'checking'
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <RefreshCw className="size-3.5" />
                      }
                    </button>
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(v) => handleToggle(server.id, v)}
                      disabled={pending}
                      aria-label="Включить MCP-сервер"
                    />
                    <button
                      onClick={() => handleDelete(server.id)}
                      disabled={pending}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="Удалить MCP-сервер"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* MCP Preset Catalog */}
      <section>
        <button
          className="mb-3 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowCatalog((v) => !v)}
        >
          <span>Каталог MCP-серверов</span>
          <span className="flex items-center gap-1.5 normal-case tracking-normal font-medium text-muted-foreground/60">
            {MCP_PRESETS.length} пресетов
            {showCatalog ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        </button>

        {showCatalog && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MCP_PRESETS.map((preset) => {
              const alreadyAdded = connectedPresetUrls.has(preset.url)
              return (
                <div
                  key={preset.id}
                  className={`flex items-start gap-3 rounded-xl border p-4 transition-colors ${
                    alreadyAdded ? 'border-emerald-500/20 bg-emerald-500/[0.02]' : 'border-border bg-background'
                  }`}
                >
                  <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${
                    alreadyAdded ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-border bg-muted text-muted-foreground'
                  }`}>
                    {preset.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-foreground">{preset.name}</p>
                      {preset.authType === 'bearer' && (
                        <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                          Требует токен
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{preset.description}</p>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {preset.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {alreadyAdded ? (
                      <div className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="size-3.5" />
                        Добавлен
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleAddPreset(preset)}
                        disabled={saving}
                      >
                        <Plus className="size-3 mr-1" />
                        Добавить
                      </Button>
                    )}
                    <a
                      href={preset.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      <ExternalLink className="size-2.5" />
                      Docs
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
