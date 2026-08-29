'use client'

/**
 * Автозапуск «интернет-зависимых» компонентов при открытии IDE.
 *
 * При заходе в приложение автоматически проверяет все сохранённые
 * API-ключи: пингует их, меряет скорость (время до первого токена стрима)
 * и помечает мёртвые / слишком медленные ключи как неактивные, чтобы чат
 * не спотыкался о них. В desktop-режиме проба идёт через нативное
 * Rust-ядро (быстрее и точнее), в вебе — через серверный /api/check-keys.
 *
 * Никакого UI — работает в фоне, один раз за сессию.
 */

import { useEffect, useRef } from 'react'
import { isDesktop, apiKeyProbe } from '@/lib/tauri'

export function DesktopAutostart() {
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const run = async () => {
      try {
        if (isDesktop()) {
          // Нативная проба: берём ключи и гоняем проверку через Rust.
          const res = await fetch('/api/check-keys', { method: 'GET' })
          const data = (await res.json().catch(() => ({}))) as {
            keys?: Array<{ id: number; key: string; baseUrl: string; modelId: string }>
          }
          const keys = data.keys ?? []
          if (keys.length > 0) {
            const results = await Promise.all(
              keys.map(async (k) => {
                const r = await apiKeyProbe(k.key, k.baseUrl, k.modelId).catch(() => null)
                return r ? { id: k.id, ...r } : null
              }),
            )
            await fetch('/api/check-keys', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ results: results.filter(Boolean) }),
            }).catch(() => {})
          }
        } else {
          // Веб: сервер сам прогонит проверку и сохранит статусы.
          await fetch('/api/check-keys', { method: 'POST' }).catch(() => {})
        }
      } catch {
        /* автозапуск не должен ломать открытие IDE */
      }
    }

    // Небольшая задержка, чтобы не конкурировать с первым рендером.
    const t = setTimeout(run, 1200)
    return () => clearTimeout(t)
  }, [])

  return null
}
