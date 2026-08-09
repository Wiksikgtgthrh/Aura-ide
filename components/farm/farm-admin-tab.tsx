'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCw, Search, Timer, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  addFarmAssignment,
  addFarmKey,
  createFarmGroup,
  createFarmModel,
  deleteFarmModel,
  deleteFarmGroup,
  deleteFarmKey,
  getFarmOverview,
  getFarmPlans,
  probeFarmKey,
  removeFarmAssignment,
  searchFarmUsers,
  setFarmKeyStatus,
  setFarmModelDefault,
  updateFarmModel,
  type FarmOverview,
} from '@/app/actions/farm'

const STATUS_BADGE: Record<string, string> = {
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  cooldown: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  disabled: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Готов',
  cooldown: 'Кулдаун',
  disabled: 'Отключён',
}

const TARGET_LABEL: Record<string, string> = {
  user: 'Пользователь',
  plan: 'Тариф',
  admin: 'Все админы',
  all: 'Все пользователи',
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'готов'
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d}д ${pad(h)}:${pad(m)}:${pad(s)}`
}

export function FarmAdminTab() {
  const [overview, setOverview] = useState<FarmOverview | null>(null)
  const [plans, setPlans] = useState<{ key: string; title: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // формы
  const [groupName, setGroupName] = useState('')
  const [groupDesc, setGroupDesc] = useState('')
  const [keyGroupId, setKeyGroupId] = useState('')
  const [keyLabel, setKeyLabel] = useState('')
  const [keyRaw, setKeyRaw] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelV0Id, setModelV0Id] = useState('')
  const [modelDesc, setModelDesc] = useState('')
  const [modelDefault, setModelDefault] = useState(false)
  const [editingModel, setEditingModel] = useState<string | null>(null)
  const [editModelName, setEditModelName] = useState('')
  const [editModelV0Id, setEditModelV0Id] = useState('')
  const [editModelDesc, setEditModelDesc] = useState('')
  const [assignGroupId, setAssignGroupId] = useState('')
  const [assignType, setAssignType] = useState('user')
  const [assignPlan, setAssignPlan] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<{ id: string; name: string; email: string }[]>([])
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null)

  const refresh = useCallback(async () => {
    const data = await getFarmOverview()
    setOverview(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    getFarmPlans().then(setPlans).catch(() => {})
  }, [refresh])

  // тик для обратного отсчёта кулдаунов
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // дефолтные значения select'ов
  useEffect(() => {
    if (!keyGroupId && overview?.groups.length) setKeyGroupId(overview.groups[0].id)
  }, [overview, keyGroupId])
  useEffect(() => {
    if (!assignGroupId && overview?.groups.length) setAssignGroupId(overview.groups[0].id)
  }, [overview, assignGroupId])

  // поиск пользователей для выдачи (с задержкой)
  useEffect(() => {
    if (assignType !== 'user') return
    if (!userQuery.trim()) {
      setUserResults([])
      return
    }
    const t = setTimeout(async () => {
      const rows = await searchFarmUsers(userQuery).catch(() => [])
      setUserResults(rows)
    }, 300)
    return () => clearTimeout(t)
  }, [userQuery, assignType])

  const cooldownKeys = useMemo(
    () => (overview?.keys ?? []).filter((k) => k.status === 'cooldown'),
    [overview],
  )
  const readyKeys = useMemo(
    () => (overview?.keys ?? []).filter((k) => k.status === 'ready'),
    [overview],
  )

  async function run(action: () => Promise<unknown>, okMsg: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await action()
      if (res === false) {
        setError('Действие не выполнено (нет прав или ошибка БД)')
        return
      }
      if (res && typeof res === 'object' && 'ok' in res && !(res as { ok: boolean }).ok) {
        setError(String((res as { error?: string }).error ?? 'Ошибка'))
        return
      }
      setNotice(okMsg)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Загрузка V0 Farm…
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
        Не удалось загрузить V0 Farm. Проверьте, что выполнена миграция:{' '}
        <code className="rounded bg-background px-1.5 py-0.5 border border-border">pnpm migrate:farm</code>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">V0 Farm — пул ключей v0</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ключи вида «Bearer vcp_…» из v0.app/settings/keys. При исчерпании баланса ключ уходит в
            кулдаун на 31 день и возвращается в пул готовых автоматически.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => run(refresh, 'Обновлено')} disabled={busy}>
          <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} /> Обновить
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      )}

      {/* Группы */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Группы ключей</h3>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-40">
            <Input
              placeholder="Название группы (например: V0 основная)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-40">
            <Input
              placeholder="Описание (необязательно)"
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !groupName.trim()}
            onClick={() => {
              run(() => createFarmGroup(groupName, groupDesc), 'Группа создана')
              setGroupName('')
              setGroupDesc('')
            }}
          >
            <Plus className="size-3.5" /> Создать
          </Button>
        </div>
        {overview.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Групп пока нет — создайте первую.</p>
        ) : (
          <div className="space-y-2">
            {overview.groups.map((g) => (
              <div key={g.id} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{g.name}</span>
                  {g.description && (
                    <span className="text-muted-foreground text-xs ml-2">{g.description}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  ключей: {g.keyCount} · готово: {g.readyCount} · кулдаун: {g.cooldownCount}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => run(() => deleteFarmGroup(g.id), 'Группа удалена')}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ключи */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Ключи</h3>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={keyGroupId}
            onChange={(e) => setKeyGroupId(e.target.value)}
          >
            {overview.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="w-36">
            <Input placeholder="Метка" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
          </div>
          <div className="flex-1 min-w-52">
            <Textarea
              rows={1}
              placeholder="Bearer vcp_…  (полный Authorization-заголовок)"
              value={keyRaw}
              onChange={(e) => setKeyRaw(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !keyRaw.trim() || !keyGroupId}
            onClick={() => {
              run(() => addFarmKey(keyGroupId, keyLabel, keyRaw), 'Ключ добавлен')
              setKeyRaw('')
              setKeyLabel('')
            }}
          >
            <Plus className="size-3.5" /> Добавить
          </Button>
        </div>

        {overview.keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ключей пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Группа</th>
                  <th className="py-1.5 pr-3 font-medium">Метка</th>
                  <th className="py-1.5 pr-3 font-medium">Ключ</th>
                  <th className="py-1.5 pr-3 font-medium">Статус</th>
                  <th className="py-1.5 pr-3 font-medium">Использован</th>
                  <th className="py-1.5 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {overview.keys.map((k) => {
                  const remaining = k.cooldownUntil ? new Date(k.cooldownUntil).getTime() - now : 0
                  return (
                    <tr key={k.id} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-3">{k.groupName}</td>
                      <td className="py-2 pr-3">{k.label || '—'}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{k.masked}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[k.status]}`}>
                          {k.status === 'cooldown' && <Timer className="size-3" />}
                          {STATUS_LABEL[k.status]}
                        </span>
                        {k.status === 'cooldown' && k.cooldownUntil && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            осталось {formatCountdown(remaining)}
                            {k.cooldownReason && <span className="block text-[11px]">{k.cooldownReason}</span>}
                          </div>
                        )}
                        {k.lastError && k.status !== 'cooldown' && (
                          <div className="mt-1 text-[11px] text-muted-foreground">{k.lastError}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{k.usageCount}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => run(() => probeFarmKey(k.id), 'Проверка завершена')}
                            title="Реальный запрос к API v0 (GET /chats)"
                          >
                            Проверить
                          </Button>
                          {k.status !== 'ready' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => run(() => setFarmKeyStatus(k.id, 'ready'), 'Ключ готов')}
                            >
                              В пул
                            </Button>
                          )}
                          {k.status !== 'cooldown' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => run(() => setFarmKeyStatus(k.id, 'cooldown'), 'Ключ в кулдауне 31 день')}
                            >
                              В кулдаун
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={busy}
                            onClick={() => run(() => deleteFarmKey(k.id), 'Ключ удалён')}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Модели */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-1">Модели v0</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Доступны при генерации. Тиры API: v0-mini, v0-pro, v0-max, v0-max-fast (v0-auto устарел
          → v0-pro). Конкретные модели v0.app — в формате creator/model, проверены на боевом API:
          anthropic/claude-opus-5, anthropic/claude-opus-5-fast, openai/gpt-5.6-sol,
          anthropic/claude-fable-5, moonshotai/kimi-k3. Если API отвергнет id, ошибка покажется
          при генерации — id можно поправить кнопкой «Изменить».
        </p>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="w-40">
            <Input
              placeholder="Название (V0 Pro)"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Input
              placeholder="v0 id (v0-pro)"
              value={modelV0Id}
              onChange={(e) => setModelV0Id(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-44">
            <Input
              placeholder="Описание (необязательно)"
              value={modelDesc}
              onChange={(e) => setModelDesc(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer pb-1.5 select-none">
            <input type="checkbox" checked={modelDefault} onChange={(e) => setModelDefault(e.target.checked)} />
            по умолчанию
          </label>
          <Button
            size="sm"
            disabled={busy || !modelName.trim() || !/^[a-z0-9][a-z0-9._\-\/]*$/i.test(modelV0Id.trim())}
            onClick={() => {
              run(() => createFarmModel(modelName, modelV0Id, modelDesc, modelDefault), 'Модель добавлена')
              setModelName('')
              setModelV0Id('')
              setModelDesc('')
              setModelDefault(false)
            }}
          >
            <Plus className="size-3.5" /> Добавить
          </Button>
        </div>
        {overview.models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Моделей нет — без выбора v0 использует v0-pro. Запустите{' '}
            <code className="rounded bg-background px-1.5 py-0.5 border border-border">pnpm seed:farm</code>.
          </p>
        ) : (
          <div className="space-y-2">
            {overview.models.map((m) =>
              editingModel === m.id ? (
                <div
                  key={m.id}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                  <div className="w-36">
                    <Input value={editModelName} onChange={(e) => setEditModelName(e.target.value)} />
                  </div>
                  <div className="w-40">
                    <Input value={editModelV0Id} onChange={(e) => setEditModelV0Id(e.target.value)} />
                  </div>
                  <div className="flex-1 min-w-40">
                    <Input value={editModelDesc} onChange={(e) => setEditModelDesc(e.target.value)} />
                  </div>
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      !editModelName.trim() ||
                      !/^[a-z0-9][a-z0-9._\-\/]*$/i.test(editModelV0Id.trim())
                    }
                    onClick={() => {
                      run(
                        () => updateFarmModel(m.id, editModelName, editModelV0Id, editModelDesc),
                        'Модель обновлена',
                      )
                      setEditingModel(null)
                    }}
                  >
                    Сохранить
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditingModel(null)}>
                    Отмена
                  </Button>
                </div>
              ) : (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                <span className="font-medium">{m.name}</span>
                <code className="rounded bg-background border border-border px-1.5 py-0.5 text-xs">
                  {m.v0ModelId}
                </code>
                {m.description && <span className="text-xs text-muted-foreground">{m.description}</span>}
                {m.isDefault && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                    по умолчанию
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {!m.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => setFarmModelDefault(m.id), 'Модель по умолчанию')}
                    >
                      По умолчанию
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setEditingModel(m.id)
                      setEditModelName(m.name)
                      setEditModelV0Id(m.v0ModelId)
                      setEditModelDesc(m.description)
                    }}
                  >
                    Изменить
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => run(() => deleteFarmModel(m.id), 'Модель удалена')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              )
            ))}
          </div>
        )}
      </section>

      {/* Выдачи */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Выдача групп ключей</h3>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={assignGroupId}
            onChange={(e) => setAssignGroupId(e.target.value)}
          >
            {overview.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={assignType}
            onChange={(e) => {
              setAssignType(e.target.value)
              setSelectedUser(null)
              setUserQuery('')
            }}
          >
            <option value="user">Конкретному пользователю</option>
            <option value="plan">Всем с тарифом</option>
            <option value="admin">Всем админам</option>
            <option value="all">Всем пользователям</option>
          </select>

          {assignType === 'user' && (
            <div className="relative flex-1 min-w-52">
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Поиск по имени/email"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
              </div>
              {userResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-lg">
                  {userResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setSelectedUser({ id: u.id, name: u.name })
                        setUserQuery('')
                        setUserResults([])
                      }}
                    >
                      <span className="font-medium">{u.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{u.email}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedUser && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Выбран: <span className="font-medium text-foreground">{selectedUser.name}</span>
                </div>
              )}
            </div>
          )}

          {assignType === 'plan' && (
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={assignPlan}
              onChange={(e) => setAssignPlan(e.target.value)}
            >
              <option value="">— выберите тариф —</option>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.title}
                </option>
              ))}
            </select>
          )}

          <Button
            size="sm"
            disabled={
              busy ||
              !assignGroupId ||
              (assignType === 'user' && !selectedUser) ||
              (assignType === 'plan' && !assignPlan)
            }
            onClick={() => {
              const targetId =
                assignType === 'user' ? selectedUser?.id ?? '' : assignType === 'plan' ? assignPlan : ''
              run(() => addFarmAssignment(assignGroupId, assignType, targetId), 'Выдача добавлена')
              setSelectedUser(null)
            }}
          >
            <Plus className="size-3.5" /> Выдать
          </Button>
        </div>

        {overview.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Выдач нет. Выдайте группу себе (Все админы), конкретному пользователю или всем с тарифом.
          </p>
        ) : (
          <div className="space-y-1.5">
            {overview.assignments.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm">
                <span className="font-medium">{a.groupName}</span>
                <span className="text-xs text-muted-foreground">→ {TARGET_LABEL[a.targetType] ?? a.targetType}</span>
                {a.targetType === 'user' && <span className="text-xs text-muted-foreground">id: {a.targetId}</span>}
                {a.targetType === 'plan' && <span className="text-xs text-muted-foreground">{a.targetId}</span>}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => run(() => removeFarmAssignment(a.id), 'Выдача удалена')}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Кулдауны */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">
          Кулдауны <span className="text-muted-foreground font-normal">(31 день, обратный отсчёт)</span>
        </h3>
        {cooldownKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ключей в кулдауне нет.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {cooldownKeys.map((k) => {
              const remaining = k.cooldownUntil ? new Date(k.cooldownUntil).getTime() - now : 0
              const total = 31 * 86_400_000
              const pct = Math.max(0, Math.min(100, (remaining / total) * 100))
              return (
                <div key={k.id} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs truncate">{k.masked}</span>
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      {formatCountdown(remaining)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-amber-500/70" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground truncate">
                    {k.cooldownReason || '—'} · {k.groupName}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Готовые */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Готовы к работе</h3>
        {readyKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Готовых ключей нет.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {readyKeys.map((k) => (
              <span
                key={k.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-400"
              >
                {k.masked} · {k.groupName}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Логи */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Последние генерации</h3>
        {overview.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Логов пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Когда</th>
                  <th className="py-1.5 pr-3 font-medium">Пользователь</th>
                  <th className="py-1.5 pr-3 font-medium">Статус</th>
                  <th className="py-1.5 font-medium">Ошибка / детали</th>
                </tr>
              </thead>
              <tbody>
                {overview.logs.map((l) => (
                  <tr key={l.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString('ru-RU')}
                    </td>
                    <td className="py-1.5 pr-3">{l.userName}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          l.status === 'ok'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {l.status === 'ok' ? 'ок' : 'исчерпан/ошибка'}
                      </span>
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground max-w-md truncate">{l.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
