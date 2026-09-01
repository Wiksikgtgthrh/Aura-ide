'use client'

/**
 * Локальная персистентность IDE-сессии.
 *
 * Живёт целиком в localStorage — этого достаточно для «открыть последний
 * проект + вернуть табы». Ничего лишнего в базу не пишем: в desktop-режиме
 * приложение вообще может работать без БД.
 */

const KEY = 'aura-ide:workspace-session:v1'
const RECENT_KEY = 'aura-ide:recent-folders:v1'
const MAX_RECENT = 12

export type WorkspaceSession = {
  root: string
  openTabs: string[]
  activeFile: string | null
  expandedDirs: string[]
  updatedAt: number
}

function safeLocal(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

export function saveSession(session: WorkspaceSession) {
  const s = safeLocal()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify(session))
    pushRecent(session.root)
  } catch {
    // квота или отсутствие доступа — просто игнорируем, это лучший-случай
  }
}

export function loadSession(): WorkspaceSession | null {
  const s = safeLocal()
  if (!s) return null
  try {
    const raw = s.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.root !== 'string') return null
    return {
      root: parsed.root,
      openTabs: Array.isArray(parsed.openTabs) ? parsed.openTabs.filter((x: unknown) => typeof x === 'string') : [],
      activeFile: typeof parsed.activeFile === 'string' ? parsed.activeFile : null,
      expandedDirs: Array.isArray(parsed.expandedDirs)
        ? parsed.expandedDirs.filter((x: unknown) => typeof x === 'string')
        : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function clearSession() {
  const s = safeLocal()
  if (!s) return
  try {
    s.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function pushRecent(root: string) {
  const s = safeLocal()
  if (!s || !root) return
  try {
    const raw = s.getItem(RECENT_KEY)
    const list: string[] = raw ? JSON.parse(raw) : []
    const next = [root, ...list.filter((x) => x !== root)].slice(0, MAX_RECENT)
    s.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

export function loadRecent(): string[] {
  const s = safeLocal()
  if (!s) return []
  try {
    const raw = s.getItem(RECENT_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
