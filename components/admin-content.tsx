'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  LayoutDashboard,
  Users,
  Shield,
  CreditCard,
  Puzzle,
  SlidersHorizontal,
  Search,
  RefreshCw,
  KeyRound,
  Cpu,
  MemoryStick,
  Loader2,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react'
import { Farm } from 'lucide-react'
import {
  getAdminOverview,
  listUsers,
  getUserDetail,
  setUserRole,
  sendUserPasswordReset,
  getAdminLimits,
  updateAdminLimits,
  listPlans,
  upsertPlan,
  deletePlan,
  listPlanApiKeys,
  addPlanApiKey,
  deletePlanApiKey,
  importPlanKeysWithModelProbe,
  getAuditLog,
  muteUser,
  banUser,
  purgeGuests,
  listAllPlugins,
  deletePlugin,
  type AdminOverview,
  type AdminUserRow,
  type AdminUserDetail,
  type AdminPlan,
  type AdminPlanKey,
  type PlanKeysImportResult,
  type AuditRow,
  type AdminPlugin,
} from '@/app/actions/admin'
import { PluginEditor } from '@/components/admin-plugin-editor'
import { FarmAdminTab } from '@/components/farm/farm-admin-tab'
import type { Role } from '@/lib/admin'
import type { PlatformLimits } from '@/lib/platform-settings'

type Tab = 'overview' | 'users' | 'admins' | 'plans' | 'plugins' | 'limits' | 'farm'

export function AdminContent({ isSuperadmin }: { isSuperadmin: boolean }) {
  const [tab, setTab] = useState<Tab>('overview')

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Обзор', icon: <LayoutDashboard className="size-4" /> },
    { key: 'users', label: 'Пользователи', icon: <Users className="size-4" /> },
    { key: 'admins', label: 'Админы', icon: <Shield className="size-4" /> },
    { key: 'plans', label: 'Тарифы', icon: <CreditCard className="size-4" /> },
    { key: 'plugins', label: 'Плагины', icon: <Puzzle className="size-4" /> },
    { key: 'farm', label: 'V0 Farm', icon: <Farm className="size-4" /> },
    { key: 'limits', label: 'Лимиты', icon: <SlidersHorizontal className="size-4" /> },
  ]

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        На главную
      </Link>

      <div className="flex items-center gap-2">
        <Shield className="size-5 text-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Админка</h1>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {isSuperadmin ? 'Суперадмин' : 'Админ'}
        </span>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tt) => (
          <button
            key={tt.key}
            type="button"
            onClick={() => setTab(tt.key)}
            className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm transition-colors ${
              tab === tt.key
                ? 'border-b-2 border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tt.icon}
            {tt.label}
          </button>
        ))}
      </div>

      <div key={tab} className="mt-6 animate-in fade-in slide-in-from-bottom-1 duration-200">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab isSuperadmin={isSuperadmin} />}
        {tab === 'admins' && (
          <div className="flex flex-col gap-8">
            <UsersTab isSuperadmin={isSuperadmin} adminsOnly />
            <AuditLog />
          </div>
        )}
        {tab === 'plans' && <PlansTab />}
        {tab === 'plugins' && <PluginsTab />}
        {tab === 'farm' && <FarmAdminTab />}
        {tab === 'limits' && <LimitsTab />}
      </div>
    </div>
  )
}

/**
 * Ступенчатое появление строк/карточек: каждый следующий элемент появляется
 * чуть позже (потолок — 20 шагов, чтобы длинные списки не «ждали»).
 * fillMode backwards держит элемент невидимым до старта его анимации.
 */
function stagger(i: number): React.CSSProperties {
  return { animationDelay: `${Math.min(i, 20) * 30}ms`, animationFillMode: 'backwards' }
}

const STAGGER_ROW = 'animate-in fade-in slide-in-from-bottom-1 duration-300'

/** Плавный count-up чисел (Обзор): анимирует изменение значения через rAF. */
function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)
  useEffect(() => {
    const from = prevRef.current
    const to = value
    if (from === to) return
    prevRef.current = to
    const started = performance.now()
    const duration = 600
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / duration)
      const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{display.toLocaleString('ru-RU')}</>
}

function ComingTab({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground text-pretty">{note}</p>
    </div>
  )
}

const EMPTY_PLUGIN: AdminPlugin = {
  id: '', slug: '', name: '', description: '', author: 'Aura Team', version: '1.0.0',
  type: 'utility', scope: 'ide-component', icon: 'Puzzle', priceRub: 0, hidden: false,
  docs: '', longDescription: '', donateAuthors: [], media: [], manifest: '{}', installs: 0,
}

function PluginsTab() {
  const [list, setList] = useState<AdminPlugin[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AdminPlugin | null>(null)
  const load = async () => {
    setLoading(true)
    setList(await listAllPlugins())
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  const onSaved = () => {
    setEditing(null)
    void load()
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  if (!list) return <p className="text-sm text-destructive">Нет доступа.</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground text-pretty">
        <p className="font-medium text-foreground">Стандарт плагина</p>
        Плагин описывается манифестом (JSON). Поддерживаемые поля: <code className="font-mono">rules</code> (правила/промпты для ИИ), <code className="font-mono">components</code> (компоненты интерфейса), <code className="font-mono">skills</code> (наборы навыков). Тип задаёт роль: «Навык ИИ» — промпты/оркестрация, «Интерфейс IDE» — UI-компоненты, «Системный мод» — системные изменения. Скрытые плагины видны только пользователям, которым выдан доступ.
      </div>

      {editing ? (
        <PluginEditor plugin={editing} onSaved={onSaved} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" onClick={() => setEditing(EMPTY_PLUGIN)} className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">+ Новый плагин</button>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((p, i) => (
          <div key={p.id} className={`rounded-xl border border-border bg-card p-4 ${STAGGER_ROW}`} style={stagger(i)}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">{p.name}</h3>
                  {p.hidden && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">скрытый</span>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.author} · v{p.version} · {p.priceRub === 0 ? 'бесплатно' : `${p.priceRub} ₽`} · установок: {p.installs}
                </p>
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{p.description}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setEditing(p)} className="rounded p-1.5 text-muted-foreground hover:text-foreground"><Pencil className="size-4" /></button>
                <button type="button" onClick={async () => { await deletePlugin(p.id); await load() }} className="rounded p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AuditLog() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  useEffect(() => {
    void (async () => setRows(await getAuditLog()))()
  }, [])
  if (!rows) return null
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-foreground">Журнал действий админов</h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">Пока пусто.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Когда</th>
                <th className="px-3 py-2 text-left font-medium">Админ</th>
                <th className="px-3 py-2 text-left font-medium">Действие</th>
                <th className="px-3 py-2 text-left font-medium">Объект</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={r.id} className={STAGGER_ROW} style={stagger(i)}>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString('ru-RU')}</td>
                  <td className="px-3 py-2 text-xs text-foreground">{r.actor}</td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{r.action}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{r.targetId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Точка-индикатор статуса платформенного ключа (проба при импорте). */
function KeyStatusDot({ status, ping }: { status: string; ping: number | null }) {
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400" title={ping ? `Рабочий · ${ping} мс` : 'Рабочий'}>
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {ping ? `${ping} мс` : 'ок'}
      </span>
    )
  }
  if (status === 'invalid') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-destructive" title="Проба не прошла">
        <span className="size-1.5 rounded-full bg-destructive" />
        не работает
      </span>
    )
  }
  return <span className="size-1.5 rounded-full bg-muted-foreground/40" title="Не проверялся" />
}

function PlanKeysManager({ planKey }: { planKey: string }) {
  const [keys, setKeys] = useState<AdminPlanKey[] | null>(null)
  const [mode, setMode] = useState<'single' | 'bulk' | null>(null)
  const [form, setForm] = useState({ label: '', key: '', modelId: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' })
  const [bulk, setBulk] = useState({ label: '', baseUrl: 'https://api.openai.com/v1', models: '', keysText: '' })
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<PlanKeysImportResult | null>(null)
  const load = async () => setKeys(await listPlanApiKeys(planKey))
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey])

  const add = async () => {
    if (!form.key.trim()) return
    await addPlanApiKey({ planKey, ...form })
    setForm({ label: '', key: '', modelId: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' })
    setMode(null)
    await load()
  }
  const runImport = async () => {
    if (!bulk.keysText.trim() || importing) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await importPlanKeysWithModelProbe({ planKey, ...bulk })
      if (res) {
        setImportResult(res)
        setBulk((b) => ({ ...b, keysText: '' }))
      }
      await load()
    } finally {
      setImporting(false)
    }
  }
  const remove = async (id: string) => {
    await deletePlanApiKey(id)
    await load()
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <KeyRound className="size-3.5" />
        API-ключи тарифа {keys ? `(${keys.length})` : ''}
      </div>
      {keys && keys.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {keys.map((k, i) => (
            <li key={k.id} className={`flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs ${STAGGER_ROW}`} style={stagger(i)}>
              <KeyStatusDot status={k.status} ping={k.ping} />
              <span className="font-medium text-foreground">{k.label || k.modelId}</span>
              <span className="font-mono text-muted-foreground">{k.maskedKey}</span>
              <span className="truncate text-muted-foreground/70">{k.modelId}</span>
              <button type="button" onClick={() => remove(k.id)} className="ml-auto shrink-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {mode === 'single' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Название (Aura Max)" className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none" />
            <input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="ID модели" className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none" />
          </div>
          <input
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            onPaste={(e) => {
              // Вставили СПИСОК ключей в одиночное поле (в <input> переносы
              // строк теряются) — переключаемся в «Импорт списком» с этим текстом.
              const text = e.clipboardData.getData('text')
              if (text.includes('\n')) {
                e.preventDefault()
                setBulk((b) => ({ ...b, keysText: text, baseUrl: form.baseUrl || b.baseUrl }))
                setMode('bulk')
              }
            }}
            placeholder="API-ключ (sk-…)"
            className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none"
          />
          <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="Base URL" className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none" />
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={!form.key.trim()} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Добавить</button>
            <button type="button" onClick={() => setMode(null)} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">Отмена</button>
          </div>
        </div>
      )}

      {mode === 'bulk' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input value={bulk.label} onChange={(e) => setBulk({ ...bulk, label: e.target.value })} placeholder="Название партии (Aura Max)" className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none" />
            <input value={bulk.baseUrl} onChange={(e) => setBulk({ ...bulk, baseUrl: e.target.value })} placeholder="Общий Base URL" className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none" />
          </div>
          <input
            value={bulk.models}
            onChange={(e) => setBulk({ ...bulk, models: e.target.value })}
            placeholder="Модели-кандидаты через запятую (gpt-4o, gpt-4o-mini) — первая рабочая закрепится"
            className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none"
          />
          <textarea
            value={bulk.keysText}
            onChange={(e) => setBulk({ ...bulk, keysText: e.target.value })}
            placeholder={'Ключи — по одному на строку:\nsk-…\nsk-…'}
            rows={5}
            className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={runImport} disabled={!bulk.keysText.trim() || importing} className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {importing && <Loader2 className="size-3 animate-spin" />}
              {importing ? 'Проверяем модели…' : 'Импортировать и проверить'}
            </button>
            <button type="button" onClick={() => { setMode(null); setImportResult(null) }} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">Закрыть</button>
          </div>
          {importResult && (
            <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]">
              <p className="font-medium text-foreground">
                Готово: рабочих {importResult.created}, нерабочих {importResult.failed}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {importResult.perKey.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-muted-foreground">{r.maskedKey}</span>
                    {r.workingModel ? (
                      <span className="text-emerald-600 dark:text-emerald-400">→ {r.workingModel}</span>
                    ) : (
                      <span className="text-destructive">{r.failReason ?? 'не работает'}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {mode === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode('single')} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
            <KeyRound className="size-3.5" /> Добавить ключ
          </button>
          <button type="button" onClick={() => setMode('bulk')} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
            <Upload className="size-3.5" /> Импорт списком
          </button>
        </div>
      )}
    </div>
  )
}

function PlanCard({ plan, onChanged }: { plan: AdminPlan; onChanged: () => void }) {
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(plan)
  const save = async () => {
    await upsertPlan({
      id: plan.id,
      key: draft.key,
      title: draft.title,
      priceRub: draft.priceRub,
      features: draft.features,
      copy: draft.copy,
      visible: draft.visible,
      position: draft.position,
    })
    setEdit(false)
    onChanged()
  }
  const del = async () => {
    await deletePlan(plan.id)
    onChanged()
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{plan.title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{plan.key}</span>
            {!plan.visible && <span className="text-[11px] text-muted-foreground">скрыт</span>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {plan.priceRub === 0 ? 'Бесплатно' : `${plan.priceRub} ₽`} · покупок: {plan.purchases}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => { setDraft(plan); setEdit((v) => !v) }} className="rounded p-1.5 text-muted-foreground hover:text-foreground"><Pencil className="size-4" /></button>
          <button type="button" onClick={del} className="rounded p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
        </div>
      </div>

      {plan.features.length > 0 && !edit && (
        <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted-foreground">
          {plan.features.map((f, i) => <li key={i}>• {f}</li>)}
        </ul>
      )}

      {edit && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Название" className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none" />
            <input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="ключ (free)" className="h-9 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none" />
            <input type="number" value={draft.priceRub} onChange={(e) => setDraft({ ...draft, priceRub: Number(e.target.value) })} placeholder="Цена ₽" className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none" />
            <input type="number" value={draft.position} onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })} placeholder="Порядок" className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none" />
          </div>
          <textarea value={draft.features.join('\n')} onChange={(e) => setDraft({ ...draft, features: e.target.value.split('\n') })} placeholder="Фичи, по одной на строку" rows={3} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none" />
          <textarea value={draft.copy} onChange={(e) => setDraft({ ...draft, copy: e.target.value })} placeholder="Описание тарифа" rows={2} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none" />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={draft.visible} onChange={(e) => setDraft({ ...draft, visible: e.target.checked })} />
            Показывать пользователям
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={save} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Сохранить</button>
            <button type="button" onClick={() => setEdit(false)} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">Отмена</button>
          </div>
        </div>
      )}

      <PlanKeysManager planKey={plan.key} />
    </div>
  )
}

function PlansTab() {
  const [list, setList] = useState<AdminPlan[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState('')

  const load = async () => {
    setLoading(true)
    setList(await listPlans())
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    const key = newKey.trim().toLowerCase()
    if (!key) return
    await upsertPlan({ key, title: key, priceRub: 0, features: [], copy: '', visible: true, position: (list?.length ?? 0) })
    setNewKey('')
    setCreating(false)
    await load()
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }
  if (!list) return <p className="text-sm text-destructive">Нет доступа.</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Тарифы, цены и их API-ключи (модели Aura и кастомные).</p>
        {creating ? (
          <div className="flex items-center gap-2">
            <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="ключ (special)" className="h-8 w-32 rounded-md border border-border bg-background px-2 text-sm outline-none" />
            <button type="button" onClick={create} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Создать</button>
            <button type="button" onClick={() => setCreating(false)} className="text-xs text-muted-foreground">Отмена</button>
          </div>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">+ Тариф</button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((p, i) => (
          <div key={p.id} className={STAGGER_ROW} style={stagger(i)}>
            <PlanCard plan={p} onChanged={load} />
          </div>
        ))}
      </div>
    </div>
  )
}

function LimitsTab() {
  const [limits, setLimits] = useState<PlatformLimits | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      setLimits(await getAdminLimits())
      setLoading(false)
    })()
  }, [])

  const save = async () => {
    if (!limits) return
    setSaving(true)
    setSaved(false)
    const ok = await updateAdminLimits(limits)
    setSaving(false)
    setSaved(ok)
    if (ok) setTimeout(() => setSaved(false), 2000)
  }

  if (loading || !limits) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const field = (
    label: string,
    hint: string,
    key: 'dockerMemoryMb' | 'dockerCpus' | 'maxProjectsFree',
    step = 1,
  ) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <input
        type="number"
        step={step}
        value={limits[key]}
        onChange={(e) => setLimits({ ...limits, [key]: Number(e.target.value) })}
        className="h-10 w-40 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )

  const AURA_TIERS: { id: string; name: string }[] = [
    { id: 'aura-mini', name: 'Aura Mini' },
    { id: 'aura-pro', name: 'Aura Pro' },
    { id: 'aura-max', name: 'Aura Max' },
    { id: 'aura-max-fast', name: 'Aura Max Fast' },
  ]
  const tierValue = (id: string) => limits.auraTiers?.[id] ?? {}
  const setTier = (id: string, patch: { label?: string; costMultiplier?: number }) =>
    setLimits({
      ...limits,
      auraTiers: { ...(limits.auraTiers ?? {}), [id]: { ...tierValue(id), ...patch } },
    })

  return (
    <div className="flex max-w-lg flex-col gap-5">
      {field('Память контейнера (МБ)', 'Лимит ОЗУ на контейнер обычного пользователя (Docker --memory).', 'dockerMemoryMb', 128)}
      {field('CPU контейнера', 'Лимит ядер CPU на контейнер (Docker --cpus).', 'dockerCpus', 0.25)}
      {field('Лимит проектов (free)', 'Максимум проектов для пользователя на бесплатном тарифе. 0 = без лимита.', 'maxProjectsFree', 1)}

      {/* Модели Aura: подпись в селекторе + множитель затрат токенов */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-medium text-foreground">Модели Aura</p>
        <p className="text-xs text-muted-foreground text-pretty">
          Подпись показывается под названием тира в селекторе моделей (пусто —
          автоматически: ключ тарифа или встроенная модель). Множитель — во
          сколько раз умножать списание токенов за запросы на этом тире.
        </p>
        <div className="mt-1 flex flex-col gap-1.5">
          {AURA_TIERS.map((tier) => (
            <div key={tier.id} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs font-medium text-foreground">{tier.name}</span>
              <input
                value={tierValue(tier.id).label ?? ''}
                onChange={(e) => setTier(tier.id, { label: e.target.value })}
                placeholder="Подпись (авто)"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="number"
                step={0.1}
                min={0.1}
                value={tierValue(tier.id).costMultiplier ?? 1}
                onChange={(e) => setTier(tier.id, { costMultiplier: Number(e.target.value) })}
                title="Множитель затрат токенов"
                className="h-8 w-20 shrink-0 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="shrink-0 text-[10px] text-muted-foreground">× токены</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-60"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Сохранить
        </button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Сохранено ✓</span>}
      </div>
      <p className="text-xs text-muted-foreground text-pretty">
        Новые лимиты применяются к контейнерам, которые создаются после сохранения (уже запущенные — после перезапуска/простоя).
      </p>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold text-foreground">
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </p>
    </div>
  )
}

function OverviewTab() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true)
    setData(await getAdminOverview())
    setLoading(false)
  }
  useEffect(() => {
    void load()
    const t = setInterval(load, 10_000) // live-ish refresh
    return () => clearInterval(t)
  }, [])

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!data) return <p className="text-sm text-destructive">Нет доступа.</p>

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            { label: 'Пользователи', value: data.totals.users, icon: <Users className="size-3.5" /> },
            { label: 'Гости', value: data.totals.guests, icon: <Users className="size-3.5" /> },
            { label: 'Проекты', value: data.totals.projects },
            { label: 'Сообщения', value: data.totals.messages },
          ] as { label: string; value: number; icon?: React.ReactNode }[]
        ).map((s, i) => (
          <div key={s.label} className={STAGGER_ROW} style={stagger(i)}>
            <StatCard label={s.label} value={s.value} icon={s.icon} />
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Контейнеры (ресурсы)</h2>
          <button
            type="button"
            onClick={load}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            title="Обновить"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {data.containers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Активных контейнеров нет. Они появляются, когда пользователи открывают терминал или Live-превью (нужен запущенный Docker).
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Контейнер</th>
                  <th className="px-3 py-2 text-left font-medium">chatId</th>
                  <th className="px-3 py-2 text-left font-medium"><span className="inline-flex items-center gap-1"><Cpu className="size-3" />CPU</span></th>
                  <th className="px-3 py-2 text-left font-medium"><span className="inline-flex items-center gap-1"><MemoryStick className="size-3" />ОЗУ</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.containers.map((c, i) => (
                  <tr key={c.name} className={STAGGER_ROW} style={stagger(i)}>
                    <td className="px-3 py-2 font-mono text-xs text-foreground">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{c.chatId ?? '—'}</td>
                    <td className="px-3 py-2 text-foreground">{c.cpuPerc}</td>
                    <td className="px-3 py-2 text-foreground">{c.memUsage} <span className="text-muted-foreground">({c.memPerc})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function roleBadge(role: Role) {
  if (role === 'superadmin') return 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400'
  if (role === 'admin') return 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
  return 'bg-muted text-muted-foreground'
}

const DURATIONS: { label: string; ms: number | null }[] = [
  { label: '1 час', ms: 60 * 60_000 },
  { label: '1 день', ms: 24 * 60 * 60_000 },
  { label: '7 дней', ms: 7 * 24 * 60 * 60_000 },
  { label: 'Навсегда', ms: null },
]

function ModerationControls({
  userId,
  status,
  onDone,
}: {
  userId: string
  status: string
  onDone: () => Promise<void>
}) {
  const [mode, setMode] = useState<'mute' | 'ban' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = async (ms: number | null) => {
    setBusy(true)
    if (mode === 'ban') await banUser(userId, ms, reason)
    else await muteUser(userId, ms)
    setBusy(false)
    setMode(null)
    setReason('')
    await onDone()
  }
  const lift = async (kind: 'mute' | 'ban') => {
    setBusy(true)
    if (kind === 'ban') await banUser(userId, 0)
    else await muteUser(userId, 0)
    setBusy(false)
    await onDone()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => setMode(mode === 'mute' ? null : 'mute')} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
          {status === 'muted' ? 'Изменить мут' : 'Замутить'}
        </button>
        {status === 'muted' && (
          <button type="button" disabled={busy} onClick={() => lift('mute')} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">Снять мут</button>
        )}
        <button type="button" disabled={busy} onClick={() => setMode(mode === 'ban' ? null : 'ban')} className="rounded-md border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10">
          {status === 'banned' ? 'Изменить бан' : 'Забанить'}
        </button>
        {status === 'banned' && (
          <button type="button" disabled={busy} onClick={() => lift('ban')} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">Разбанить</button>
        )}
      </div>
      {mode && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2">
          {mode === 'ban' && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (необязательно)" className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none" />
          )}
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button key={d.label} type="button" disabled={busy} onClick={() => apply(d.ms)} className={`rounded-md px-2.5 py-1 text-xs ${mode === 'ban' ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'} disabled:opacity-60`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function UsersTab({ isSuperadmin, adminsOnly }: { isSuperadmin: boolean; adminsOnly?: boolean }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AdminUserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = async (q: string) => {
    setLoading(true)
    const list = await listUsers(q)
    setRows(adminsOnly ? list.filter((u) => u.role !== 'user') : list)
    setLoading(false)
  }
  useEffect(() => {
    void load(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminsOnly])

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setSelected(await getUserDetail(id))
    setDetailLoading(false)
  }

  const changeRole = async (id: string, role: Role) => {
    const ok = await setUserRole(id, role)
    if (ok) {
      await load(query)
      if (selected?.id === id) setSelected({ ...selected, role })
    }
  }

  const resetPw = async (id: string) => {
    const ok = await sendUserPasswordReset(id)
    alert(ok ? 'Письмо для сброса пароля отправлено пользователю.' : 'Не удалось отправить письмо.')
  }

  const purge = async () => {
    if (!window.confirm('Удалить всех гостей без чатов и проектов? Действие необратимо.')) return
    const n = await purgeGuests('empty')
    alert(`Удалено гостей: ${n}`)
    await load(query)
  }

  return (
    <div className="flex flex-col gap-4">
      {!adminsOnly && (
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void load(query)
            }}
            className="relative flex-1"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени, тегу или почте…"
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </form>
          <button
            type="button"
            onClick={purge}
            title="Удалить гостей без данных"
            className="h-10 shrink-0 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Очистить гостей
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {adminsOnly ? 'Админов пока нет.' : 'Пользователи не найдены.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Пользователь</th>
                <th className="px-3 py-2 text-left font-medium">Тег / почта</th>
                <th className="px-3 py-2 text-left font-medium">Тариф</th>
                <th className="px-3 py-2 text-left font-medium">Роль</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((u, i) => (
                <tr key={u.id} className={`hover:bg-accent/40 ${STAGGER_ROW}`} style={stagger(i)}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{u.name}</span>
                    {u.isAnonymous && <span className="ml-1.5 text-[11px] text-muted-foreground">(гость)</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <div className="text-xs">{u.username ? `@${u.username}` : '—'}</div>
                    <div className="text-[11px]">{u.email}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.plan}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${roleBadge(u.role)}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openDetail(u.id)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Подробнее
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {(selected || detailLoading) && (
        <div
          className="fixed inset-0 z-[90] flex justify-end bg-foreground/30 animate-in fade-in duration-200"
          onClick={() => setSelected(null)}
        >
          <div
            className="drawer-in h-full w-full max-w-md overflow-y-auto bg-background p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading || !selected ? (
              <div className="flex justify-center py-16">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{selected.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selected.username ? `@${selected.username} · ` : ''}{selected.email}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${roleBadge(selected.role)}`}>
                      {selected.role}
                    </span>
                    <span className="text-xs text-muted-foreground">Тариф: {selected.plan}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Проекты" value={selected.projects} />
                  <StatCard label="Чаты" value={selected.chats} />
                </div>

                {/* Moderation status */}
                {(selected.status === 'banned' || selected.status === 'muted') && (
                  <div className={`rounded-lg border px-3 py-2 text-xs ${selected.status === 'banned' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                    {selected.status === 'banned' ? 'Забанен' : 'Мут'}
                    {(() => {
                      const u = selected.status === 'banned' ? selected.bannedUntil : selected.mutedUntil
                      if (!u) return ' (навсегда)'
                      const d = new Date(u)
                      return d.getFullYear() >= 9999 ? ' (навсегда)' : ` до ${d.toLocaleString('ru-RU')}`
                    })()}
                    {selected.banReason ? ` · ${selected.banReason}` : ''}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  {!selected.isAnonymous && (
                    <button
                      type="button"
                      onClick={() => resetPw(selected.id)}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent"
                    >
                      <RefreshCw className="size-4" />
                      Отправить сброс пароля
                    </button>
                  )}

                  {/* Mute / Ban (admins). Superadmins can't be banned by the action. */}
                  {selected.role !== 'superadmin' && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
                      <ModerationControls
                        userId={selected.id}
                        status={selected.status}
                        onDone={async () => {
                          await load(query)
                          setSelected(await getUserDetail(selected.id))
                        }}
                      />
                    </div>
                  )}
                  {isSuperadmin && !selected.isAnonymous && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Роль:</span>
                      {(['user', 'admin', 'superadmin'] as Role[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => changeRole(selected.id, r)}
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                            selected.role === r
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* API keys — superadmin only */}
                {isSuperadmin && (
                  <div className="border-t border-border pt-3">
                    <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <KeyRound className="size-4" />
                      API-ключи {selected.apiKeys ? `(${selected.apiKeys.length})` : ''}
                    </div>
                    {!selected.apiKeys || selected.apiKeys.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Ключей нет.</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {selected.apiKeys.map((k) => (
                          <li key={k.id} className="rounded-lg border border-border bg-card px-3 py-2">
                            <div className="text-xs font-medium text-foreground">{k.name} · {k.modelId}</div>
                            <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{k.key}</div>
                            <div className="break-all font-mono text-[10px] text-muted-foreground/70">{k.baseUrl}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
