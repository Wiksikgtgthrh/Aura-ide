'use client'

import { useEffect, useState } from 'react'
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
} from 'lucide-react'
import {
  getAdminOverview,
  listUsers,
  getUserDetail,
  setUserRole,
  sendUserPasswordReset,
  getAdminLimits,
  updateAdminLimits,
  type AdminOverview,
  type AdminUserRow,
  type AdminUserDetail,
} from '@/app/actions/admin'
import type { Role } from '@/lib/admin'
import type { PlatformLimits } from '@/lib/platform-settings'

type Tab = 'overview' | 'users' | 'admins' | 'plans' | 'plugins' | 'limits'

export function AdminContent({ isSuperadmin }: { isSuperadmin: boolean }) {
  const [tab, setTab] = useState<Tab>('overview')

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Обзор', icon: <LayoutDashboard className="size-4" /> },
    { key: 'users', label: 'Пользователи', icon: <Users className="size-4" /> },
    { key: 'admins', label: 'Админы', icon: <Shield className="size-4" /> },
    { key: 'plans', label: 'Тарифы', icon: <CreditCard className="size-4" /> },
    { key: 'plugins', label: 'Плагины', icon: <Puzzle className="size-4" /> },
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
                ? 'border-b-2 border-foreground font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tt.icon}
            {tt.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab isSuperadmin={isSuperadmin} />}
        {tab === 'admins' && <UsersTab isSuperadmin={isSuperadmin} adminsOnly />}
        {tab === 'plans' && <ComingTab title="Тарифы" note="Управление тарифами, ценами, API-ключами тарифов и статистикой продаж — в следующей фазе." />}
        {tab === 'plugins' && <ComingTab title="Плагины" note="Загрузка плагинов, цены, авторы, документация и скрытые плагины — в следующей фазе." />}
        {tab === 'limits' && <LimitsTab />}
      </div>
    </div>
  )
}

function ComingTab({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground text-pretty">{note}</p>
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
    key: keyof PlatformLimits,
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

  return (
    <div className="flex max-w-lg flex-col gap-5">
      {field('Память контейнера (МБ)', 'Лимит ОЗУ на контейнер обычного пользователя (Docker --memory).', 'dockerMemoryMb', 128)}
      {field('CPU контейнера', 'Лимит ядер CPU на контейнер (Docker --cpus).', 'dockerCpus', 0.25)}
      {field('Лимит проектов (free)', 'Максимум проектов для пользователя на бесплатном тарифе. 0 = без лимита.', 'maxProjectsFree', 1)}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-all active:scale-95 disabled:opacity-60"
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
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
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
        <StatCard label="Пользователи" value={data.totals.users} icon={<Users className="size-3.5" />} />
        <StatCard label="Гости" value={data.totals.guests} icon={<Users className="size-3.5" />} />
        <StatCard label="Проекты" value={data.totals.projects} />
        <StatCard label="Чаты" value={data.totals.chats} />
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
                {data.containers.map((c) => (
                  <tr key={c.name}>
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

  return (
    <div className="flex flex-col gap-4">
      {!adminsOnly && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void load(query)
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по имени, тегу или почте…"
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </form>
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
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-accent/40">
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
          className="fixed inset-0 z-[90] flex justify-end bg-foreground/30"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-md overflow-y-auto bg-background p-5 shadow-2xl"
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
                              ? 'border-foreground bg-foreground text-background'
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
