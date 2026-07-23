'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getApiKeys,
  createApiKey,
  deleteApiKey,
  checkApiKey,
  checkAllApiKeys,
  updateApiKey,
  importKeysWithModelProbe,
  type ModelProbeImportResult,
  type ApiKeyItem,
  type ApiKeyStatus,
} from '@/app/actions/api-keys'
import { useLanguage } from '@/lib/language'

function StatusBadge({ status }: { status: ApiKeyStatus }) {
  const { t } = useLanguage()
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" />
        {t('statusValid')}
      </span>
    )
  }
  if (status === 'invalid') {
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
  mutate,
}: {
  item: ApiKeyItem
  mutate: () => Promise<unknown>
}) {
  const { t } = useLanguage()
  const [checking, setChecking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [modelId, setModelId] = useState(item.modelId)
  const [baseUrl, setBaseUrl] = useState(item.baseUrl)

  const handleCheck = async () => {
    setChecking(true)
    try {
      await checkApiKey(item.id)
      await mutate()
    } finally {
      setChecking(false)
    }
  }

  const handleSave = async () => {
    await updateApiKey(item.id, { modelId, baseUrl })
    setEditing(false)
    await mutate()
  }

  const handleDelete = async () => {
    await deleteApiKey(item.id)
    await mutate()
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
            <StatusBadge status={item.status} />
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {item.maskedKey} · {item.modelId}
          </p>
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

export function MyApiContent({
  initialKeys,
}: {
  initialKeys?: ApiKeyItem[]
}) {
  const { t } = useLanguage()
  // fallbackData seeds the list from the server render so the page shows keys
  // instantly instead of flashing empty while a client fetch runs after nav.
  const { data: keys, mutate } = useSWR('api-keys', () => getApiKeys(), {
    fallbackData: initialKeys,
    revalidateOnFocus: false,
  })
  const [showForm, setShowForm] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bulk import (name + base URL + candidate models + list of keys)
  const [bulkName, setBulkName] = useState('')
  const [bulkBaseUrl, setBulkBaseUrl] = useState('')
  const [bulkModels, setBulkModels] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [probeResult, setProbeResult] = useState<ModelProbeImportResult | null>(null)
  const [checkingAll, setCheckingAll] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !key.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await createApiKey({ name, key, modelId, baseUrl })
      await mutate()
      setName('')
      setKey('')
      setModelId('')
      setBaseUrl('')
      setShowForm(false)
    } catch {
      setError(t('genericError'))
    } finally {
      setSaving(false)
    }
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
      await mutate()
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
      const refreshed = await checkAllApiKeys()
      await mutate(refreshed ?? undefined, { revalidate: false })
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
        <div className="flex items-center gap-2 shrink-0">
          {keys && keys.length > 0 && (
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
            }}
          >
            <Upload className="size-4" />
            {t('bulkImport')}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setShowForm((v) => !v)
              setShowBulk(false)
            }}
          >
            <Plus className="size-4" />
            {t('newKey')}
          </Button>
        </div>
      </div>

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

      {keys && keys.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-2">
          {keys.map((k) => (
            <KeyRow key={k.id} item={k} mutate={mutate} />
          ))}
        </ul>
      ) : (
        !showForm &&
        !showBulk && (
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
        )
      )}
    </div>
  )
}
