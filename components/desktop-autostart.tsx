'use client'

/**
 * Автозапуск и фоновое здоровье «интернет-зависимых» компонентов IDE.
 *
 * 1. При заходе в приложение сразу проверяет все API-ключи.
 * 2. Дальше проверяет их ПЕРИОДИЧЕСКИ (каждые RECHECK_INTERVAL_MS) в фоне:
 *    мёртвые и медленные отключаются автоматически, восстановившиеся —
 *    автоматически возвращаются (авто-реанимация на стороне /api/check-keys).
 * 3. Каждая проверка пишет точку в историю здоровья (пинг/TTFT по времени).
 *
 * Desktop-режим: проба через нативное Rust-ядро (apiKeyProbe, меряет TTFT
 * стрима без CORS). Веб: серверный /api/check-keys сам прогоняет проверку.
 *
 * Никакого UI — работает в фоне. При закрытии/уходе со страницы таймер
 * останавливается.
 */

import { useEffect, useRef } from 'react'
import { isDesktop, apiKeyProbe } from '@/lib/tauri'

/** Период фоновой проверки всех ключей (5 минут). */
const RECHECK_INTERVAL_MS = 5 * 60 * 1000

export function DesktopAutostart() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const running = useRef(false)

  useEffect(() => {
    const checkOnce = async () => {
      // Не запускаем новую проверку, пока идёт предыдущая.
      if (running.current) return
      running.current = true
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
          // Веб: сервер сам прогонит проверку, сохранит статусы и историю.
          await fetch('/api/check-keys', { method: 'POST' }).catch(() => {})
        }
      } catch {
        /* фоновая проверка не должна ломать IDE */
      } finally {
        running.current = false
      }
    }

    // Первый прогон — сразу после первого рендера (небольшая задержка,
    // чтобы не конкурировать с загрузкой оболочки).
    const first = setTimeout(() => {
      void checkOnce()
      // Периодическая проверка здоровья ключей.
      timer.current = setInterval(() => void checkOnce(), RECHECK_INTERVAL_MS)
    }, 1200)

    return () => {
      clearTimeout(first)
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  return null
}
