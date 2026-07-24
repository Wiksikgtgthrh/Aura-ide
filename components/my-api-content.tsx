'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  ArrowLeft,
  KeyRound,
  Plus,
  Trash2,
  Upload,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Circle,
  Pencil,
  Folder,
  FolderPlus,
  Check,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getApiKeysGrouped,
  createApiKey,
  deleteApiKey,
  checkApiKey,
  checkAllApiKeys,
  updateApiKey,
  moveApiKeyToGroup,
  createApiKeyGroup,
  renameApiKeyGroup,
  deleteApiKeyGroup,
  importKeysWithModelProbe,
  type ModelProbeImportResult,
  type ApiKeysGrouped,
  type ApiKeyGroup,
  type ApiKeyItem,
  type ApiKeyStatus,
} from '@/app/actions/api-keys'
import { useLanguage } from '@/lib/language'

function StatusBadge({ status, checking }: { status: ApiKeyStatus; checking?: boolean }) {
  const { t } = useLanguage()
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" />
        {t('checking')}
      </span>
    )
  }
  // 'active' is written by the settings checker (/api/check-keys),
  // 'valid' by the actions here — both mean the key works.
  if (status === 'valid' || (status as string) === 'active') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" />
        {t('statusValid')}
      </span>
    )
  }
  if (status === 'invalid' || status === 'error' || status === 'timeout') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <XCircle className="size-3.5" />
        {t('statusInvalid')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <Circle className="size-3.5" />
      {t('statusUnknown')}
    </span>
  )
}

function KeyRow({
  item,
  groups,
  refresh,
  pendingCheck,
}: {
  item: ApiKeyItem
  groups: ApiKeyGroup[]
  refresh: () => Promise<unknown>
  /** id of a key whose background verification is still running */
  pendingCheck: number | null
}) {
  const { t } = useLanguage()
  const [checking, setChecking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [modelId, setModelId] = useState(item.modelId)
  const [baseUrl, setBaseUrl] = useState(item.baseUrl)
  const [groupId, setGroupId] = useState(item.groupId ?? '')

  const handleCheck = async () => {
    setChecking(true)
    try {
      await checkApiKey(item.id)
      await refresh()
    } finally {
      setChecking(false)
    }
  }

  const handleSave = async () => {
    await updateApiKey(item.id, { modelId, baseUrl })
    const nextGroup = groupId || null
    if (nextGroup !== (item.groupId ?? null)) {
      await moveApiKeyToGroup(item.id, nextGroup)
    }
    setEditing(false)
    await refresh()
  }

  const handleDelete = async () => {
    await deleteApiKey(item.id)
    await refresh()
  }

  return (
    <li className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-accent shrink-0">
          <KeyRound className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {item.name}
            </p>
            <StatusBadge
              status={item.status}
              checking={checking || pendingCheck === item.id}
            />
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {item.maskedKey} · {item.modelId}
          </p>
          {item.failReason && (
            <p
              className={`text-xs truncate mt-0.5 ${
                item.status === 'invalid' || item.status === 'error' || item.status === 'timeout'
                  ? 'text-destructive/80'
                  : 'text-amber-600 dark:text-amber-400/90'
              }`}
              title={item.failReason}
            >
              {item.failReason}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('checkKey')}
            disabled={checking}
            className="text-muted-foreground hover:text-foreground"
            onClick={handleCheck}
          >
            <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('editKey')}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('deleteKey')}
            className="text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`model-${item.id}`}>{t('keyModelLabel')}</Label>
            <Input
              id={`model-${item.id}`}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder={t('keyModelPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`base-${item.id}`}>{t('keyBaseUrlLabel')}</Label>
            <Input
              id={`base-${item.id}`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t('keyBaseUrlPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`group-${item.id}`}>{t('keyGroupLabel')}</Label>
            <select
              id={`group-${item.id}`}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t('noGroup')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleSave}>
              {t('saveKey')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setModelId(item.modelId)
                setBaseUrl(item.baseUrl)
                setGroupId(item.groupId ?? '')
                setEditing(false)
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Collapsible-free group block: header (rename/delete) + its keys. */
function GroupSection({
  group,
  groups,
  refresh,
  pendingCheck,
}: {
  group: ApiKeyGroup
  groups: ApiKeyGroup[]
  refresh: () => Promise<unknown>
  pendingCheck: number | null
}) {
  const { t } = useLanguage()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(group.name)

  const commitRename = async () => {
    const trimmed = name.trim()
    setRenaming(false)
    if (trimmed && trimmed !== group.name) {
      await renameApiKeyGroup(group.id, trimmed)
      await refresh()
    } else {
      setName(group.name)
    }
  }

  const handleDeleteGroup = async () => {
    await deleteApiKeyGroup(group.id)
    await refresh()
  }

  return (
    <section className="mt-6">
      <div className="flex items-center gap-2 px-1">
        <Folder className="size-4 text-muted-foreground shrink-0" />
        {renaming ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                if (e.key === 'Escape') {
                  setName(group.name)
                  setRenaming(false)
                }
              }}
              className="h-7 text-sm"
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('saveKey')}
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={commitRename}
            >
              <Check className="size-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-foreground truncate">
              {group.name}
            </h2>
            <span className="text-[11px] text-muted-foreground/60">
              {t('keysCount').replace('{n}', String(group.keys.length))}
            </span>
            <span className="ml-auto flex items-center">
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('renameGroup')}
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={() => setRenaming(true)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('deleteGroup')}
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={handleDeleteGroup}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </span>
          </>
        )}
      </div>
      {group.keys.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-border px-4 py-4 text-xs text-muted-foreground">
          {t('groupEmpty')}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {group.keys.map((k) => (
            <KeyRow
              key={k.id}
              item={k}
              groups={groups}
              refresh={refresh}
              pendingCheck={pendingCheck}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

export function MyApiContent({
  initialData,
}: {
  initialData?: ApiKeysGrouped | null
}) {
  const { t } = useLanguage()
  // SAME SWR key as the settings → both views share one cache, so a key or
  // group added here is instantly visible in Settings → API-ключи and back.
  const { data, mutate } = useSWR<ApiKeysGrouped | null>(
    'api-keys-grouped',
    () => getApiKeysGrouped(),
    initialData
      ? { fallbackData: initialData, revalidateOnFocus: false }
      : { revalidateOnFocus: false },
  )
  const groups = data?.groups ?? []
  const ungrouped = data?.ungrouped ?? []
  const totalKeys =
    groups.reduce((acc, g) => acc + g.keys.length, 0) + ungrouped.length

  const [showForm, setShowForm] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [formGroupId, setFormGroupId] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingCheck, setPendingCheck] = useState<number | null>(null)
  // Bulk import (name + base URL + candidate models + list of keys)
  const [bulkName, setBulkName] = useState('')
  const [bulkBaseUrl, setBulkBaseUrl] = useState('')
  const [bulkModels, setBulkModels] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [probeResult, setProbeResult] = useState<ModelProbeImportResult | null>(null)
  const [checkingAll, setCheckingAll] = useState(false)

  // Revalidate BOTH caches: the grouped one (this page + settings) and the
  // flat 'api-keys' one (model switcher, prompt box). This is what keeps the
  // main page and the settings in sync.
  const refresh = () => Promise.all([mutate(), globalMutate('api-keys')])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !key.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const item = await createApiKey({ name, key, modelId, baseUrl })
      if (!item) throw new Error('not created')
      const targetGroup = formGroupId || null
      if (targetGroup) await moveApiKeyToGroup(item.id, targetGroup)

      // Optimistic: show the new key immediately, without waiting for a
      // server round-trip or verification.
      const optimistic: ApiKeyItem = { ...item, groupId: targetGroup }
      await mutate(
        (cur) => {
          const base: ApiKeysGrouped = cur ?? { groups: [], ungrouped: [] }
          if (!targetGroup) {
            return { ...base, ungrouped: [...base.ungrouped, optimistic] }
          }
          return {
            ...base,
            groups: base.groups.map((g) =>
              g.id === targetGroup ? { ...g, keys: [...g.keys, optimistic] } : g,
            ),
          }
        },
        { revalidate: false },
      )
      void globalMutate('api-keys')

      setName('')
      setKey('')
      setModelId('')
      setBaseUrl('')
      setFormGroupId('')
      setShowForm(false)

      // Verify in the background — the badge switches from «Не проверен»
      // to the real status once the check completes.
      setPendingCheck(item.id)
      void checkApiKey(item.id)
        .then(() => refresh())
        .finally(() => setPendingCheck(null))
    } catch {
      setError(t('genericError'))
    } finally {
      setSaving(false)
    }
  }

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newGroupName.trim()
    if (!trimmed) return
    await createApiKeyGroup(trimmed)
    setNewGroupName('')
    setShowAddGroup(false)
    await refresh()
  }

  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bulkText.trim() || importing) return
    setImporting(true)
    setImportMsg(null)
    setProbeResult(null)
    try {
      const res = await importKeysWithModelProbe({
        name: bulkName.trim(),
        baseUrl: bulkBaseUrl.trim(),
        models: bulkModels.split(/[,;\n]/),
        keysText: bulkText,
      })
      await refresh()
      if (res) {
        setProbeResult(res)
        setImportMsg(
          t('importDone')
            .replace('{created}', String(res.created))
            .replace('{failed}', String(res.failed)),
        )
        setBulkText('')
      }
    } catch {
      setImportMsg(t('genericError'))
    } finally {
      setImporting(false)
    }
  }

  const handleCheckAll = async () => {
    setCheckingAll(true)
    try {
      await checkAllApiKeys()
      await refresh()
    } finally {
      setCheckingAll(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 animate-in fade-in duration-150">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 mb-6"
      >
        <ArrowLeft className="size-4" />
        {t('backHome')}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('myApi')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 text-pretty">
            {t('myApiDescription')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {totalKeys > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={checkingAll}
              onClick={handleCheckAll}
            >
              <RefreshCw
                className={`size-4 ${checkingAll ? 'animate-spin' : ''}`}
              />
              {t('checkAll')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setShowBulk((v) => !v)
              setShowForm(false)
              setShowAddGroup(false)
            }}
          >
            <Upload className="size-4" />
            {t('bulkImport')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setShowAddGroup((v) => !v)
              setShowForm(false)
              setShowBulk(false)
            }}
          >
            <FolderPlus className="size-4" />
            {t('newGroup')}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setShowForm((v) => !v)
              setShowBulk(false)
              setShowAddGroup(false)
            }}
          >
            <Plus className="size-4" />
            {t('newKey')}
          </Button>
        </div>
      </div>

      {showAddGroup && (
        <form
          onSubmit={handleAddGroup}
          className="mt-6 rounded-xl border border-border bg-card p-4 flex items-center gap-2 animate-in fade-in duration-150"
        >
          <Folder className="size-4 text-muted-foreground shrink-0" />
          <Input
            value={newGroupName}
            autoFocus
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={t('groupNamePlaceholder')}
            maxLength={80}
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={!newGroupName.trim()}>
            {t('createGroup')}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('cancel')}
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => setShowAddGroup(false)}
          >
            <X className="size-4" />
          </Button>
        </form>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mt-6 rounded-xl border border-border bg-card p-5 flex flex-col gap-4 animate-in fade-in duration-150"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-name">{t('keyNameLabel')}</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('keyNamePlaceholder')}
              maxLength={100}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-value">{t('keyValueLabel')}</Label>
            <Input
              id="key-value"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t('keyValuePlaceholder')}
              maxLength={500}
              required
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-model">{t('keyModelLabel')}</Label>
            <Input
              id="key-model"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder={t('keyModelPlaceholder')}
            />
          </div>
          {groups.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-group">{t('keyGroupLabel')}</Label>
              <select
                id="key-group"
                value={formGroupId}
                onChange={(e) => setFormGroupId(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t('noGroup')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-base" className="text-muted-foreground">
              {t('keyBaseUrlLabel')} · {t('advancedOptional')}
            </Label>
            <Input
              id="key-base"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t('keyBaseUrlPlaceholder')}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? t('checking') : t('createKey')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowForm(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      {showBulk && (
        <form
          onSubmit={handleBulkImport}
          className="mt-6 rounded-xl border border-border bg-card p-5 flex flex-col gap-4 animate-in fade-in duration-150"
        >
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {t('bulkImportTitle')}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 text-pretty">
              {t('bulkImportHelp')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-name">{t('keyNameLabel')}</Label>
              <Input
                id="bulk-name"
                value={bulkName}
                onChange={(e) => setBulkName(e.target.value)}
                placeholder="Groq"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-base-url">{t('keyBaseUrlLabel')}</Label>
              <Input
                id="bulk-base-url"
                value={bulkBaseUrl}
                onChange={(e) => setBulkBaseUrl(e.target.value)}
                placeholder={t('keyBaseUrlPlaceholder')}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-models">
              {t('bulkModelsLabel')}&nbsp;
              <span className="text-muted-foreground font-normal">
                — {t('bulkModelsHelp')}
              </span>
            </Label>
            <Input
              id="bulk-models"
              value={bulkModels}
              onChange={(e) => setBulkModels(e.target.value)}
              placeholder="llama-3.3-70b-versatile, llama-3.1-8b-instant"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-keys">
              {t('bulkKeysLabel')}&nbsp;
              <span className="text-muted-foreground font-normal">
                — {t('bulkKeysHelp')}
              </span>
            </Label>
            <textarea
              id="bulk-keys"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'sk-...\ngsk-...\nsk-...'}
              rows={6}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>

          {importMsg && (
            <p className="text-sm text-muted-foreground">{importMsg}</p>
          )}

          {/* Per-key probe summary */}
          {probeResult && probeResult.perKey.length > 0 && (
            <div className="rounded-lg border border-border bg-background/60 divide-y divide-border text-xs">
              {probeResult.perKey.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2">
                  {r.workingModel ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="size-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="font-mono text-muted-foreground">{r.maskedKey}</span>
                  <span className="ml-auto truncate text-right">
                    {r.workingModel ? (
                      <span className="text-foreground">{r.workingModel}</span>
                    ) : (
                      <span className="text-destructive">
                        {t('bulkNoWorkingModel').replace('{n}', String(r.testedModels))}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={importing}>
              {importing ? t('bulkProbing') : t('importKeys')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowBulk(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      {/* Groups */}
      {groups.map((g) => (
        <GroupSection
          key={g.id}
          group={g}
          groups={groups}
          refresh={refresh}
          pendingCheck={pendingCheck}
        />
      ))}

      {/* Ungrouped keys */}
      {ungrouped.length > 0 && (
        <section className="mt-6">
          {groups.length > 0 && (
            <div className="flex items-center gap-2 px-1">
              <KeyRound className="size-4 text-muted-foreground shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">
                {t('noGroup')}
              </h2>
              <span className="text-[11px] text-muted-foreground/60">
                {t('keysCount').replace('{n}', String(ungrouped.length))}
              </span>
            </div>
          )}
          <ul className={`flex flex-col gap-2 ${groups.length > 0 ? 'mt-2' : ''}`}>
            {ungrouped.map((k) => (
              <KeyRow
                key={k.id}
                item={k}
                groups={groups}
                refresh={refresh}
                pendingCheck={pendingCheck}
              />
            ))}
          </ul>
        </section>
      )}

      {totalKeys === 0 && groups.length === 0 && !showForm && !showBulk && !showAddGroup && (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card px-6 py-14 flex flex-col items-center justify-center text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-accent">
            <KeyRound className="size-5 text-muted-foreground" />
          </span>
          <p className="mt-4 text-sm font-medium text-foreground">
            {t('noKeysTitle')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs text-pretty">
            {t('noKeysHelp')}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-5 gap-1.5"
            onClick={() => setShowForm(true)}
          >
            <Plus className="size-4" />
            {t('createKey')}
          </Button>
        </div>
      )}
    </div>
  )
}
