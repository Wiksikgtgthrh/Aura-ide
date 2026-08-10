'use client'

import { useEffect, useState } from 'react'
import {
  GitBranch,
  HandCoins,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  upsertPlugin,
  listPluginAccess,
  grantPluginAccess,
  revokePluginAccess,
  listPluginVersions,
  addPluginVersion,
  deletePluginVersion,
  type AdminPlugin,
  type PluginGrant,
} from '@/app/actions/admin'
import type { PluginAuthor, PluginMediaItem, PluginVersionEntry } from '@/lib/plugin-types'
import { MarkdownEditor } from '@/components/markdown-editor'
import { FarmAdminTab } from '@/components/farm/farm-admin-tab'

/**
 * Админ-редактор плагина (магазин): базовые поля, markdown-документация с
 * превью, лендинг-описание, история версий («Новая версия»), авторы с
 * реквизитами для доната и медиа-галерея.
 */

const inputCls =
  'h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring'

// ---- Авторы + донат ----------------------------------------------------------

function AuthorsEditor({
  value,
  onChange,
}: {
  value: PluginAuthor[]
  onChange: (next: PluginAuthor[]) => void
}) {
  const set = (i: number, patch: Partial<PluginAuthor>) =>
    onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <HandCoins className="size-3.5" />
        Авторы и донат
      </p>
      <div className="flex flex-col gap-1.5">
        {value.map((a, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={a.nick}
              onChange={(e) => set(i, { nick: e.target.value })}
              placeholder="Ник (wiks)"
              className={`${inputCls} h-8 w-36 text-xs`}
            />
            <input
              value={a.requisites}
              onChange={(e) => set(i, { requisites: e.target.value })}
              placeholder="Реквизиты: карта / крипта / ссылка"
              className={`${inputCls} h-8 flex-1 font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...value, { nick: '', requisites: '' }])}
        className="mt-1.5 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" /> Автор
      </button>
    </div>
  )
}

// ---- Медиа (скриншоты/видео) --------------------------------------------------

function MediaEditor({
  value,
  onChange,
}: {
  value: PluginMediaItem[]
  onChange: (next: PluginMediaItem[]) => void
}) {
  const set = (i: number, patch: Partial<PluginMediaItem>) =>
    onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <ImageIcon className="size-3.5" />
        Медиа — скриншоты и видео работы плагина
      </p>
      <div className="flex flex-col gap-1.5">
        {value.map((m, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={m.type}
              onChange={(e) => set(i, { type: e.target.value as PluginMediaItem['type'] })}
              className={`${inputCls} h-8 w-24 text-xs`}
            >
              <option value="image">Фото</option>
              <option value="video">Видео</option>
            </select>
            <input
              value={m.url}
              onChange={(e) => set(i, { url: e.target.value })}
              placeholder="https://… (картинка, mp4, YouTube/Vimeo/Rutube)"
              className={`${inputCls} h-8 flex-1 font-mono text-xs`}
            />
            <input
              value={m.caption}
              onChange={(e) => set(i, { caption: e.target.value })}
              placeholder="Подпись"
              className={`${inputCls} h-8 w-32 text-xs`}
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...value, { type: 'image', url: '', caption: '' }])}
        className="mt-1.5 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" /> Медиа
      </button>
    </div>
  )
}

// ---- Версии (история обновлений) ----------------------------------------------

function VersionsManager({
  pluginId,
  currentVersion,
  onVersionAdded,
}: {
  pluginId: string
  currentVersion: string
  onVersionAdded: (v: string) => void
}) {
  const [versions, setVersions] = useState<PluginVersionEntry[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [version, setVersion] = useState('')
  const [changelog, setChangelog] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => setVersions(await listPluginVersions(pluginId))
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId])

  const add = async () => {
    setBusy(true)
    setErr('')
    const res = await addPluginVersion({ pluginId, version, changelog })
    setBusy(false)
    if (!res.ok) {
      setErr(res.error ?? 'Ошибка')
      return
    }
    onVersionAdded(version.trim().replace(/^v/i, ''))
    setVersion('')
    setChangelog('')
    setAdding(false)
    await load()
  }

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <GitBranch className="size-3.5" />
          Обновления · текущая v{currentVersion}
        </p>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3" /> Новая версия
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-2 flex flex-col gap-1.5 rounded-md bg-muted/40 p-2">
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Версия (1.1.0)"
            className={`${inputCls} h-8 w-40 font-mono text-xs`}
          />
          <textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder={'Что нового:\n- добавили X\n- починили Y'}
            rows={3}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none"
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={add}
              disabled={busy || !version.trim()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              Выпустить
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {versions && versions.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-start gap-2 rounded-md bg-background px-2 py-1.5 text-xs">
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono font-medium text-primary">
                v{v.version}
              </span>
              <span className="flex-1 whitespace-pre-wrap text-muted-foreground">
                {v.changelog || '—'}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/70">
                {new Date(v.createdAt).toLocaleDateString('ru-RU')}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await deletePluginVersion(v.id)
                  await load()
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                title="Удалить запись"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Записей пока нет — выпустите первую версию.</p>
      )}
    </div>
  )
}

// ---- Доступ к скрытому плагину -------------------------------------------------

export function PluginHiddenAccess({ pluginId }: { pluginId: string }) {
  const [grants, setGrants] = useState<PluginGrant[] | null>(null)
  const [ident, setIdent] = useState('')
  const [err, setErr] = useState('')
  const load = async () => setGrants(await listPluginAccess(pluginId))
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId])
  const add = async () => {
    setErr('')
    const res = await grantPluginAccess(pluginId, ident)
    if (res.ok) {
      setIdent('')
      await load()
    } else setErr(res.error ?? 'Ошибка')
  }
  return (
    <div className="rounded-lg border border-dashed border-border p-2.5">
      <p className="mb-1.5 text-xs font-medium text-foreground">Доступ к скрытому плагину</p>
      <div className="flex flex-wrap gap-1.5">
        {grants?.map((g) => (
          <span key={g.id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
            {g.label}
            <button type="button" onClick={async () => { await revokePluginAccess(g.id); await load() }} className="text-muted-foreground hover:text-destructive"><X className="size-3" /></button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="@логин или почта" className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none" />
        <button type="button" onClick={add} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">Дать доступ</button>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  )
}

// ---- Главный редактор -----------------------------------------------------------

export function PluginEditor({
  plugin,
  onSaved,
  onCancel,
}: {
  plugin: AdminPlugin
  onSaved: () => void
  onCancel: () => void
}) {
  const [d, setD] = useState(plugin)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    setErr('')
    const res = await upsertPlugin(d)
    setSaving(false)
    if (res.ok) onSaved()
    else setErr(res.error ?? 'Ошибка')
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Базовые поля */}
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Название" className={inputCls} />
        <input value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value })} placeholder="slug" className={`${inputCls} font-mono`} />
        <input value={d.author} onChange={(e) => setD({ ...d, author: e.target.value })} placeholder="Автор(ы)" className={inputCls} />
        <input value={d.version} onChange={(e) => setD({ ...d, version: e.target.value })} placeholder="Версия" className={inputCls} disabled={!!d.id} title={d.id ? 'Версия меняется через «Новая версия» ниже' : undefined} />
        <select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })} className={inputCls}>
          <option value="utility">Утилита</option>
          <option value="skill">Навык ИИ</option>
          <option value="system-mod">Системный мод</option>
        </select>
        <select value={d.scope} onChange={(e) => setD({ ...d, scope: e.target.value })} className={inputCls}>
          <option value="ide-component">Интерфейс IDE</option>
          <option value="ai-skill">Скилл/промпт ИИ</option>
          <option value="system-ui">Системный UI</option>
        </select>
        <input value={d.icon} onChange={(e) => setD({ ...d, icon: e.target.value })} placeholder="Иконка (Puzzle)" className={inputCls} />
        <input type="number" value={d.priceRub} onChange={(e) => setD({ ...d, priceRub: Number(e.target.value) })} placeholder="Цена ₽ (0 = бесплатно)" className={inputCls} />
      </div>

      <textarea
        value={d.description}
        onChange={(e) => setD({ ...d, description: e.target.value })}
        placeholder="Краткое описание (карточка в маркетплейсе)"
        rows={2}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
      />

      {/* V0 Farm: управление ключами, группами, моделями и выдачами.
          Секция видна только для плагина v0-farm — это его основная админка:
          пул v0-ключей с ротацией и кулдауном, модели v0, назначения
          пользователям/тарифам/админам/всем. Ключи тестовые — показываются
          полностью (см. FarmKeyRow.token). */}
      {d.slug === 'v0-farm' && (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Управление V0 Farm</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
              пул v0-ключей
            </span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Ключи «Bearer vcp_…» шифруются на диске и показываются полностью — они тестовые.
            При исчерпании баланса ключ уходит в кулдаун на 31 день, генерация продолжается
            на следующем готовом ключе.
          </p>
          <FarmAdminTab embedded />
        </div>
      )}

      {/* Лендинг */}
      <div>
        <p className="mb-1 text-xs font-medium text-foreground">Описание для страницы плагина (лендинг)</p>
        <MarkdownEditor
          value={d.longDescription}
          onChange={(v) => setD({ ...d, longDescription: v })}
          rows={8}
          placeholder={'О чём плагин, кому нужен, что умеет.\n\n# Возможности\n- пункт…'}
        />
      </div>

      {/* Документация */}
      <div>
        <p className="mb-1 text-xs font-medium text-foreground">Документация</p>
        <MarkdownEditor
          value={d.docs}
          onChange={(v) => setD({ ...d, docs: v })}
          rows={12}
          placeholder={'# Установка\n1. …\n\n# Использование\n```\nпример\n```'}
        />
      </div>

      <AuthorsEditor value={d.donateAuthors} onChange={(v) => setD({ ...d, donateAuthors: v })} />
      <MediaEditor value={d.media} onChange={(v) => setD({ ...d, media: v })} />

      {d.id && (
        <VersionsManager
          pluginId={d.id}
          currentVersion={d.version}
          onVersionAdded={(v) => setD((prev) => ({ ...prev, version: v }))}
        />
      )}

      <details className="rounded-lg border border-border p-2.5">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Манифест (JSON) — правила ИИ, компоненты
        </summary>
        <textarea
          value={d.manifest}
          onChange={(e) => setD({ ...d, manifest: e.target.value })}
          placeholder='{ "rules": [...], "components": [...] }'
          rows={5}
          className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
        />
      </details>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={d.hidden} onChange={(e) => setD({ ...d, hidden: e.target.checked })} />
        Скрытый плагин (доступен только выбранным пользователям)
      </label>
      {d.hidden && d.id && <PluginHiddenAccess pluginId={d.id} />}

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          Отмена
        </button>
      </div>
    </div>
  )
}
