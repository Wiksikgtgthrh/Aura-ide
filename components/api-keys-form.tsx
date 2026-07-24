'use client'

import { useState, useTransition, useCallback } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { Loader2 as SWRLoader } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ApiKeyItem, ApiKeyGroup, ApiKeysGrouped } from '@/app/actions/api-keys'
import {
  getApiKeysGrouped,
  createApiKey,
  deleteApiKey,
  createApiKeyGroup,
  renameApiKeyGroup,
  deleteApiKeyGroup,
  moveApiKeyToGroup,
} from '@/app/actions/api-keys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  GripVertical,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  FolderPlus,
  Pencil,
  ChevronDown,
  ChevronRight,
  Zap,
  Key,
  Loader2,
  Settings2,
  X,
} from 'lucide-react'

// Default ping threshold in ms — keys above this are treated as high-latency
const DEFAULT_PING_THRESHOLD = 1500

// ---- Status helpers -------------------------------------------------------

type KeyStatus = 'active' | 'error' | 'timeout' | 'unknown' | 'valid' | 'invalid'

function PingBadge({ ping, threshold = DEFAULT_PING_THRESHOLD }: { ping: number | null; threshold?: number }) {
  if (ping === null) return null
  const color =
    ping < 500 ? 'text-emerald-400 bg-emerald-500/10' :
    ping < 1000 ? 'text-amber-400 bg-amber-500/10' :
    ping < threshold ? 'text-orange-400 bg-orange-500/10' :
    'text-red-400 bg-red-500/10'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-mono font-medium ${color}`} title={ping >= threshold ? `Выше порога ${threshold}ms` : undefined}>
      {ping}ms
    </span>
  )
}

function StatusIcon({ status }: { status: KeyStatus }) {
  if (status === 'active' || status === 'valid')
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
  if (status === 'error' || status === 'invalid')
    return <AlertCircle className="size-4 shrink-0 text-red-400" />
  if (status === 'timeout')
    return <Clock className="size-4 shrink-0 text-amber-400" />
  return <HelpCircle className="size-4 shrink-0 text-muted-foreground/40" />
}

function statusLabel(status: KeyStatus): string {
  if (status === 'active' || status === 'valid') return 'Активен'
  if (status === 'error' || status === 'invalid') return 'Ошибка'
  if (status === 'timeout') return 'Таймаут'
  return 'Не проверен'
}

// ---- Key card (sortable) --------------------------------------------------

function KeyCard({
  item,
  onDelete,
  onCheck,
  checking,
  pingThreshold = DEFAULT_PING_THRESHOLD,
  overlay = false,
}: {
  item: ApiKeyItem
  onDelete: (id: number) => void
  onCheck: (id: number) => void
  checking: boolean
  pingThreshold?: number
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `key-${item.id}`,
  })
  const [revealed, setRevealed] = useState(false)
  const [showFailReason, setShowFailReason] = useState(false)
  const status = item.status as KeyStatus
  const isActive = status === 'active' || status === 'valid'
  const isError = status === 'error' || status === 'invalid' || status === 'timeout'
  // Key must pass a fresh check before it can be used — can't manually re-enable
  const isBlocked = isError

  const style = overlay
    ? undefined
    : { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }

  // Format last checked time
  const lastChecked = item.lastCheckedAt
    ? (() => {
        const d = new Date(item.lastCheckedAt)
        const now = new Date()
        const diffMins = Math.round((now.getTime() - d.getTime()) / 60000)
        if (diffMins < 1) return 'только что'
        if (diffMins < 60) return `${diffMins} мин назад`
        const diffHours = Math.round(diffMins / 60)
        if (diffHours < 24) return `${diffHours} ч назад`
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
      })()
    : null

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      className={`group flex flex-col gap-0 rounded-xl border bg-background transition-colors ${
        isBlocked ? 'border-red-500/30 bg-red-500/[0.02]' : 'border-border'
      } ${overlay ? 'shadow-2xl' : ''}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Drag handle */}
        <button
          {...(overlay ? {} : { ...attributes, ...listeners })}
          className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 hover:text-muted-foreground transition-colors"
          aria-label="Перетащить ключ"
        >
          <GripVertical className="size-4" />
        </button>

        {/* Status icon */}
        <StatusIcon status={status} />

        {/* Info */}
        <div className="min-w-0 flex-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-center">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[180px]">
                {revealed ? item.maskedKey.replace(/•/g, '*') : item.maskedKey}
              </span>
              <button
                onClick={() => setRevealed((v) => !v)}
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                aria-label={revealed ? 'Скрыть ключ' : 'Показать ключ'}
              >
                {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </button>
            </div>
          </div>

          {/* Model */}
          <span className="hidden md:block rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {item.modelId}
          </span>

          {/* Ping */}
          <PingBadge ping={item.ping} threshold={pingThreshold} />

          {/* Status text */}
          <button
            onClick={() => isBlocked && item.failReason && setShowFailReason((v) => !v)}
            className={`hidden sm:flex items-center gap-1 text-[11px] font-medium min-w-[72px] justify-end ${
              isActive ? 'text-emerald-400 cursor-default' :
              isBlocked ? 'text-red-400 cursor-pointer hover:text-red-300' :
              'text-muted-foreground/50 cursor-default'
            }`}
          >
            {statusLabel(status)}
            {item.failReason && isBlocked && (
              <AlertCircle className="size-3 text-red-400/70" />
            )}
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onCheck(item.id)}
            disabled={checking}
            className={`rounded-md p-1.5 transition-colors ${
              isBlocked
                ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            aria-label={isBlocked ? 'Перепроверить ключ' : 'Проверить ключ'}
            title={isBlocked ? 'Нажмите для повторной проверки — ключ включится автоматически при успехе' : 'Проверить ключ'}
          >
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Удалить ключ"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Fail reason banner — shown when user clicks status */}
      {isBlocked && item.failReason && showFailReason && (
        <div className="flex items-start gap-2 border-t border-red-500/20 bg-red-500/5 px-4 py-2.5 rounded-b-xl">
          <AlertCircle className="size-3.5 shrink-0 text-red-400 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-red-300/80 font-mono break-all">{item.failReason}</p>
            {lastChecked && (
              <p className="text-[10px] text-muted-foreground/40 mt-0.5">Проверено: {lastChecked}</p>
            )}
          </div>
          <p className="text-[10px] text-amber-400/70 shrink-0">
            Нажмите <RefreshCw className="inline size-2.5" /> для повторной проверки
          </p>
        </div>
      )}

      {/* Last checked time (passive) */}
      {!isBlocked && lastChecked && (
        <div className="px-4 pb-2 flex justify-end">
          <span className="text-[10px] text-muted-foreground/30">Проверено: {lastChecked}</span>
        </div>
      )}
    </div>
  )
}

// ---- Group block (sortable) -----------------------------------------------

function GroupBlock({
  group,
  onDeleteKey,
  onCheckKey,
  onDeleteGroup,
  checkingId,
  pingThreshold = DEFAULT_PING_THRESHOLD,
  overlay = false,
}: {
  group: ApiKeyGroup
  onDeleteKey: (id: number) => void
  onCheckKey: (id: number) => void
  onDeleteGroup: (id: string) => void
  checkingId: number | null
  pingThreshold?: number
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `group-${group.id}`,
  })
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(group.name)
  const [, startTransition] = useTransition()

  const style = overlay
    ? undefined
    : { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }

  function handleRename() {
    setEditing(false)
    if (name.trim() && name.trim() !== group.name) {
      startTransition(async () => {
        const { renameApiKeyGroup } = await import('@/app/actions/api-keys')
        await renameApiKeyGroup(group.id, name.trim())
        void globalMutate('api-keys')
        void globalMutate('api-keys-grouped')
      })
    }
  }

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      className={`rounded-xl border border-border ${overlay ? 'shadow-2xl bg-background' : 'bg-muted/10'}`}
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
        <button
          {...(overlay ? {} : { ...attributes, ...listeners })}
          className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground/30 hover:text-muted-foreground transition-colors"
          aria-label="Перетащить группу"
        >
          <GripVertical className="size-4" />
        </button>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            className="flex-1 bg-transparent border-b border-border text-sm font-medium text-foreground outline-none py-0.5"
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-foreground">{group.name}</span>
        )}

        <span className="text-[11px] text-muted-foreground/50">{group.keys.length} ключей</span>

        <button
          onClick={() => setEditing((v) => !v)}
          className="rounded-md p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          onClick={() => onDeleteGroup(group.id)}
          className="rounded-md p-1 text-muted-foreground/40 hover:text-destructive transition-colors"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Keys in group */}
      {!collapsed && (
        <div className="flex flex-col gap-2 p-3">
          <SortableContext
            items={group.keys.map((k) => `key-${k.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {group.keys.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground/40">
                Перетащите ключи сюда
              </p>
            ) : (
              group.keys.map((k) => (
                <KeyCard
                  key={k.id}
                  item={k}
                  onDelete={onDeleteKey}
                  onCheck={onCheckKey}
                  checking={checkingId === k.id}
                  pingThreshold={pingThreshold}
                />
              ))
            )}
          </SortableContext>
        </div>
      )}
    </div>
  )
}

// ---- Add key form ---------------------------------------------------------

function AddKeyForm({
  groups,
  onAdd,
}: {
  groups: ApiKeyGroup[]
  onAdd: (key: ApiKeyItem, groupId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', key: '', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini', groupId: '',
  })

  async function handleSubmit() {
    if (!form.name.trim() || !form.key.trim()) return
    setSaving(true)
    try {
      const item = await createApiKey({
        name: form.name,
        key: form.key,
        baseUrl: form.baseUrl,
        modelId: form.modelId,
      })
      if (item) {
        if (form.groupId) await moveApiKeyToGroup(item.id, form.groupId)
        onAdd({ ...item, groupId: form.groupId || null }, form.groupId || null)
        setForm({ name: '', key: '', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini', groupId: '' })
        setOpen(false)
        // Creation no longer blocks on verification — kick off a background
        // check so the status badge fills in shortly after the row appears.
        void (async () => {
          const { checkApiKey } = await import('@/app/actions/api-keys')
          await checkApiKey(item.id)
          void globalMutate('api-keys')
          void globalMutate('api-keys-grouped')
        })()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setOpen((v) => !v)}>
        <Plus className="size-3.5" />
        Добавить ключ
      </Button>

      {open && (
        <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Название</label>
              <Input placeholder="OpenAI Production" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">API-ключ</label>
              <Input type="password" placeholder="sk-..." value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} className="h-8 text-sm font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Base URL</label>
              <Input placeholder="https://api.openai.com/v1" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} className="h-8 text-sm font-mono" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Model ID</label>
              <Input placeholder="gpt-4o-mini" value={form.modelId} onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))} className="h-8 text-sm font-mono" />
            </div>
          </div>
          {groups.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Группа (необязательно)</label>
              <select
                value={form.groupId}
                onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
                className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Без группы</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOpen(false)}>Отмена</Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSubmit} disabled={saving || !form.name.trim() || !form.key.trim()}>
              {saving ? <><Loader2 className="size-3.5 mr-1.5 animate-spin" />Проверка...</> : 'Добавить'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Main component -------------------------------------------------------

export function ApiKeysForm({ initialData }: { initialData?: ApiKeysGrouped | null }) {
  const { data: swrData, isLoading } = useSWR<ApiKeysGrouped | null>(
    'api-keys-grouped',
    () => getApiKeysGrouped(),
    // NOTE: no `fallbackData: null` — an explicit null used to count as
    // "data present", which closed the one-shot sync latch below with an
    // EMPTY list before the real fetch resolved.
    initialData
      ? { fallbackData: initialData, revalidateOnFocus: false }
      : { revalidateOnFocus: false },
  )
  const resolved = swrData ?? initialData ?? null
  const [groups, setGroups] = useState<ApiKeyGroup[]>(resolved?.groups ?? [])
  const [ungrouped, setUngrouped] = useState<ApiKeyItem[]>(resolved?.ungrouped ?? [])

  // Re-sync local state EVERY time fresh SWR data arrives — revalidation
  // after our own mutations, cross-page mutations from /my-api (shared
  // 'api-keys-grouped' cache key), or an Activity show/hide cycle. The old
  // one-shot `synced` latch synced exactly once, so keys added on /my-api
  // never showed up here until a full page reload.
  const [lastSynced, setLastSynced] = useState<ApiKeysGrouped | null | undefined>(
    initialData ?? undefined,
  )
  if (swrData !== undefined && swrData !== lastSynced) {
    setLastSynced(swrData)
    setGroups(swrData?.groups ?? [])
    setUngrouped(swrData?.ungrouped ?? [])
  }

  // Revalidate both shared caches (grouped: this form + /my-api; flat:
  // model switcher, prompt box) after any mutation made from this form.
  const syncCaches = useCallback(() => {
    void globalMutate('api-keys')
    void globalMutate('api-keys-grouped')
  }, [])

  // All hooks must be declared before any conditional returns
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [checkingAll, setCheckingAll] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pingThreshold, setPingThreshold] = useState<number>(DEFAULT_PING_THRESHOLD)
  const [showSettings, setShowSettings] = useState(false)
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_PING_THRESHOLD))
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleCheckKey = useCallback(async (id: number) => {
    setCheckingId(id)
    try {
      const res = await fetch('/api/check-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId: id }),
      })
      const data = await res.json()
      const result = data.results?.[0]
      if (result) {
        const now = new Date().toISOString()
        const update = (k: ApiKeyItem) =>
          k.id === id
            ? { ...k, status: result.status, ping: result.ping, failReason: result.failReason, lastCheckedAt: now }
            : k
        setUngrouped((prev) => prev.map(update))
        setGroups((prev) => prev.map((g) => ({ ...g, keys: g.keys.map(update) })))
        syncCaches()
      }
    } finally {
      setCheckingId(null)
    }
  }, [syncCaches])

  if (isLoading && !initialData) {
    return (
      <div className="flex items-center justify-center py-16">
        <SWRLoader className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Find item being dragged for overlay
  const activeDragItem = activeId?.startsWith('key-')
    ? [...ungrouped, ...groups.flatMap((g) => g.keys)].find((k) => `key-${k.id}` === activeId)
    : null
  const activeDragGroup = activeId?.startsWith('group-')
    ? groups.find((g) => `group-${g.id}` === activeId)
    : null

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return

    const activeStr = String(active.id)
    const overStr = String(over.id)

    // Moving a key to a group container
    if (activeStr.startsWith('key-') && overStr.startsWith('group-')) {
      const keyId = parseInt(activeStr.replace('key-', ''), 10)
      const groupId = overStr.replace('group-', '')
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id === groupId && !g.keys.find((k) => k.id === keyId)) {
            const key =
              ungrouped.find((k) => k.id === keyId) ??
              prev.flatMap((gr) => gr.keys).find((k) => k.id === keyId)
            if (!key) return g
            return { ...g, keys: [...g.keys, { ...key, groupId }] }
          }
          return { ...g, keys: g.keys.filter((k) => k.id !== keyId) }
        }),
      )
      setUngrouped((prev) => prev.filter((k) => k.id !== keyId))
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return

    const activeStr = String(active.id)
    const overStr = String(over.id)

    // Persist key moved to group
    if (activeStr.startsWith('key-')) {
      const keyId = parseInt(activeStr.replace('key-', ''), 10)
      let targetGroup: string | null = null
      if (overStr.startsWith('group-')) {
        targetGroup = overStr.replace('group-', '')
      } else if (overStr.startsWith('key-')) {
        const targetKeyId = parseInt(overStr.replace('key-', ''), 10)
        const foundGroup = groups.find((g) => g.keys.some((k) => k.id === targetKeyId))
        targetGroup = foundGroup?.id ?? null
      }
      startTransition(async () => {
        await moveApiKeyToGroup(keyId, targetGroup)
        syncCaches()
      })
    }
  }

  function handleAddGroup() {
    setShowAddGroup(true)
    setNewGroupName('')
  }

  function handleConfirmAddGroup() {
    const name = newGroupName.trim()
    if (!name) return
    setShowAddGroup(false)
    setNewGroupName('')
    startTransition(async () => {
      const g = await createApiKeyGroup(name)
      if (g) setGroups((prev) => [...prev, g])
      syncCaches()
    })
  }

  function handleSaveThreshold() {
    const val = parseInt(thresholdInput, 10)
    if (!isNaN(val) && val > 0) {
      setPingThreshold(val)
      setShowSettings(false)
    }
  }

  function handleDeleteGroup(id: string) {
    const group = groups.find((g) => g.id === id)
    if (!group) return
    // Move keys back to ungrouped
    setUngrouped((prev) => [...prev, ...group.keys.map((k) => ({ ...k, groupId: null }))])
    setGroups((prev) => prev.filter((g) => g.id !== id))
    startTransition(async () => {
      await deleteApiKeyGroup(id)
      syncCaches()
    })
  }

  function handleDeleteKey(id: number) {
    setUngrouped((prev) => prev.filter((k) => k.id !== id))
    setGroups((prev) => prev.map((g) => ({ ...g, keys: g.keys.filter((k) => k.id !== id) })))
    startTransition(async () => {
      await deleteApiKey(id)
      syncCaches()
    })
  }

  async function handleCheckAll() {
    setCheckingAll(true)
    try {
      const res = await fetch('/api/check-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      for (const result of data.results ?? []) {
        const update = (k: ApiKeyItem) =>
          k.id === result.id ? { ...k, status: result.status, ping: result.ping, failReason: result.failReason } : k
        setUngrouped((prev) => prev.map(update))
        setGroups((prev) => prev.map((g) => ({ ...g, keys: g.keys.map(update) })))
      }
      syncCaches()
    } finally {
      setCheckingAll(false)
    }
  }

  const allKeys = [...ungrouped, ...groups.flatMap((g) => g.keys)]
  const activeCount = allKeys.filter((k) => k.status === 'active' || k.status === 'valid').length
  const errorCount = allKeys.filter((k) => k.status === 'error' || k.status === 'invalid' || k.status === 'timeout').length

  return (
    <div className="flex flex-col gap-6">
      {/* Stats row */}
      {allKeys.length > 0 && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-emerald-400" />
            <span><strong className="text-foreground">{activeCount}</strong> активных</span>
          </div>
          {errorCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertCircle className="size-3.5 text-red-400" />
              <span><strong className="text-foreground">{errorCount}</strong> с ошибкой</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Key className="size-3.5" />
            <span><strong className="text-foreground">{allKeys.length}</strong> всего</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <AddKeyForm groups={groups} onAdd={(key, groupId) => {
          if (groupId) {
            setGroups((prev) => prev.map((g) => g.id === groupId ? { ...g, keys: [...g.keys, key] } : g))
          } else {
            setUngrouped((prev) => [...prev, key])
          }
          syncCaches()
        }} />
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleAddGroup}>
          <FolderPlus className="size-3.5" />
          Добавить группу
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => { setShowSettings((v) => !v); setThresholdInput(String(pingThreshold)) }}
            title="Настройки пинга"
          >
            <Settings2 className="size-3.5" />
          </Button>
          {allKeys.length > 0 && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleCheckAll} disabled={checkingAll}>
              {checkingAll
                ? <><Loader2 className="size-3.5 animate-spin" />Проверка...</>
                : <><RefreshCw className="size-3.5" />Проверить все</>
              }
            </Button>
          )}
        </div>
      </div>

      {/* Inline add group form */}
      {showAddGroup && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
          <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Название группы"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') handleConfirmAddGroup()
              if (e.key === 'Escape') { setShowAddGroup(false); setNewGroupName('') }
            }}
            className="h-8 text-sm flex-1"
          />
          <Button size="sm" className="h-8 text-xs" onClick={handleConfirmAddGroup} disabled={!newGroupName.trim()}>
            Создать
          </Button>
          <button
            onClick={() => { setShowAddGroup(false); setNewGroupName('') }}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Ping threshold settings panel */}
      {showSettings && (
        <div className="rounded-xl border border-border bg-muted/20 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <Settings2 className="size-4 text-muted-foreground" />
              Настройки API-чекера
            </p>
            <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Порог пинга (мс) — ключи выше этого порога не используются
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={100}
                max={10000}
                step={100}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                className="h-8 text-sm w-28 font-mono"
              />
              <span className="text-xs text-muted-foreground">мс</span>
              <div className="flex gap-1 ml-auto">
                {[500, 1000, 1500, 2000, 3000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setThresholdInput(String(v))}
                    className={`rounded-md px-2 py-1 text-[11px] border transition-colors ${
                      thresholdInput === String(v)
                        ? 'bg-foreground text-background border-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/60">
              Текущий порог: <strong className="text-foreground">{pingThreshold}ms</strong>. Ключи с пингом выше {pingThreshold}ms автоматически деактивируются при проверке.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowSettings(false)}>Отмена</Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSaveThreshold}>Сохранить</Button>
          </div>
        </div>
      )}

      {/* High-ping warning */}
      {allKeys.some((k) => k.ping !== null && k.ping > pingThreshold) && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <Zap className="size-4 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-xs text-amber-200/80">
            Некоторые ключи имеют пинг выше {pingThreshold}ms — порога, настроенного для вашего воркспейса. Ключи с высоким пингом имеют малый импакт на скорость генерации.
          </p>
        </div>
      )}

      {/* DnD area */}
      {allKeys.length === 0 && groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-14 text-center">
          <Key className="size-8 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground">Нет API-ключей</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Добавьте ключ, чтобы начать</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-col gap-4">
            {/* Groups */}
            <SortableContext
              items={groups.map((g) => `group-${g.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {groups.map((group) => (
                <GroupBlock
                  key={group.id}
                  group={group}
                  onDeleteKey={handleDeleteKey}
                  onCheckKey={handleCheckKey}
                  onDeleteGroup={handleDeleteGroup}
                  checkingId={checkingId}
                  pingThreshold={pingThreshold}
                />
              ))}
            </SortableContext>

            {/* Ungrouped */}
            {ungrouped.length > 0 && (
              <div className="flex flex-col gap-2">
                {groups.length > 0 && (
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1">
                    Без группы
                  </p>
                )}
                <SortableContext
                  items={ungrouped.map((k) => `key-${k.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {ungrouped.map((k) => (
                    <KeyCard
                      key={k.id}
                      item={k}
                      onDelete={handleDeleteKey}
                      onCheck={handleCheckKey}
                      checking={checkingId === k.id}
                      pingThreshold={pingThreshold}
                    />
                  ))}
                </SortableContext>
              </div>
            )}
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {activeDragItem && (
              <KeyCard
                item={activeDragItem}
                onDelete={() => {}}
                onCheck={() => {}}
                checking={false}
                overlay
              />
            )}
            {activeDragGroup && (
              <GroupBlock
                group={activeDragGroup}
                onDeleteKey={() => {}}
                onCheckKey={() => {}}
                onDeleteGroup={() => {}}
                checkingId={null}
                overlay
              />
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}
