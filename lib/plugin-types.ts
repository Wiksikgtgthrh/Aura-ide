/**
 * Общие типы магазина плагинов — используются и в админке
 * (app/actions/admin), и на публичной странице плагина (app/actions/plugins,
 * components/plugins/*). Обычный модуль (не 'use server'), чтобы типы и
 * хелперы-валидаторы можно было импортировать откуда угодно.
 */

export type PluginAuthor = {
  nick: string
  /** Реквизиты для доната: карта/крипта/ссылка — произвольный текст. */
  requisites: string
}

export type PluginMediaItem = {
  type: 'image' | 'video'
  url: string
  caption: string
}

export type PluginVersionEntry = {
  id: string
  version: string
  changelog: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// IDE-манифест: как плагин расширяет саму IDE (кнопки, команды, completions).
// Живёт в `plugins.manifest.ide` — обычный JSON, никаких выполняемых
// зависимостей, всё оценивается в frontend-песочнице (Function-конструктор
// с явным API-объектом; никакого доступа к window/document напрямую).
// ---------------------------------------------------------------------------

/** Одна кнопка в верхнем тулбаре IDE. */
export type IdeToolbarButton = {
  id: string
  title: string
  /** Название иконки из lucide-react. Если не найдено — рисуем букву. */
  icon?: string
  /** Тело функции, вызывается как new Function('ctx', body). */
  onClick: string
}

/** Команда в Command Palette (Ctrl+Shift+P). */
export type IdePaletteCommand = {
  id: string
  title: string
  hint?: string
  keywords?: string
  /** Тело функции — `ctx` содержит openFile/showMessage/getActiveFile/... */
  run: string
}

/** Провайдер inline completions (ghost text). */
export type IdeCompletionProvider = {
  id: string
  /** Языки Monaco: ['typescript','javascript',...] или ['*']. */
  languages: string[]
  /** Тело async-функции, `ctx` содержит prefix/suffix/language/path. */
  provide: string
}

export type IdeManifest = {
  toolbarButtons?: IdeToolbarButton[]
  paletteCommands?: IdePaletteCommand[]
  completions?: IdeCompletionProvider[]
}

/** Санитизация: обрезаем строки, убираем всё, что не строка/массив. */
export function sanitizeIdeManifest(input: unknown): IdeManifest {
  const src = (input ?? {}) as Record<string, unknown>
  const out: IdeManifest = {}
  const asArr = <T,>(x: unknown, map: (o: any) => T | null, cap = 20): T[] =>
    Array.isArray(x)
      ? x
          .map(map)
          .filter((v): v is T => v != null)
          .slice(0, cap)
      : []
  const trim = (s: unknown, cap = 200) => String(s ?? '').trim().slice(0, cap)
  out.toolbarButtons = asArr(src.toolbarButtons, (o) => {
    const id = trim(o?.id, 60)
    const title = trim(o?.title, 80)
    const onClick = trim(o?.onClick, 4000)
    if (!id || !title || !onClick) return null
    return { id, title, icon: trim(o?.icon, 40), onClick }
  })
  out.paletteCommands = asArr(src.paletteCommands, (o) => {
    const id = trim(o?.id, 60)
    const title = trim(o?.title, 120)
    const run = trim(o?.run, 4000)
    if (!id || !title || !run) return null
    return { id, title, hint: trim(o?.hint, 30), keywords: trim(o?.keywords, 200), run }
  })
  out.completions = asArr(src.completions, (o) => {
    const id = trim(o?.id, 60)
    const provide = trim(o?.provide, 4000)
    if (!id || !provide) return null
    const langs = Array.isArray(o?.languages)
      ? (o.languages as unknown[]).map((l) => trim(l, 30)).filter(Boolean).slice(0, 10)
      : ['*']
    return { id, languages: langs, provide }
  })
  return out
}

/** Санитизация списка авторов из формы/БД (обрезка, лимиты, отбрасывание пустых). */
export function sanitizeAuthors(input: unknown): PluginAuthor[] {
  if (!Array.isArray(input)) return []
  return input
    .map((a) => ({
      nick: String((a as PluginAuthor)?.nick ?? '').trim().slice(0, 60),
      requisites: String((a as PluginAuthor)?.requisites ?? '').trim().slice(0, 300),
    }))
    .filter((a) => a.nick.length > 0)
    .slice(0, 10)
}

/** Санитизация медиа-списка: только image|video, только http(s)-ссылки. */
export function sanitizeMedia(input: unknown): PluginMediaItem[] {
  if (!Array.isArray(input)) return []
  return input
    .map((m) => {
      const raw = m as PluginMediaItem
      const type = raw?.type === 'video' ? 'video' : 'image'
      const url = String(raw?.url ?? '').trim().slice(0, 500)
      const caption = String(raw?.caption ?? '').trim().slice(0, 160)
      return { type: type as PluginMediaItem['type'], url, caption }
    })
    .filter((m) => /^https?:\/\//i.test(m.url))
    .slice(0, 12)
}

/** Версия вида «1.2.3» (допускаем суффиксы -beta и т.п., максимум 20 симв.). */
export function normalizeVersion(v: string): string | null {
  const t = v.trim().replace(/^v/i, '').slice(0, 20)
  if (!/^\d+(\.\d+){0,3}([-+][\w.]{1,12})?$/.test(t)) return null
  return t
}

/** youtube/vimeo → embed-URL для iframe; иначе null (рендерим <video>). */
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v')
      if (id) return `https://www.youtube.com/embed/${id}`
      const short = u.pathname.match(/^\/(shorts|embed)\/([\w-]{6,20})/)
      if (short) return `https://www.youtube.com/embed/${short[2]}`
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0]
      if (id) return `https://www.youtube.com/embed/${id}`
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.slice(1).split('/')[0]
      if (/^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`
    }
    if (host === 'rutube.ru') {
      const m = u.pathname.match(/^\/video\/([\w]+)/)
      if (m) return `https://rutube.ru/play/embed/${m[1]}`
    }
  } catch {
    /* not a URL */
  }
  return null
}
