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
