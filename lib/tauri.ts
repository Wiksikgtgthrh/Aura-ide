'use client'

/**
 * Тонкий клиент к нативному ядру Tauri.
 *
 * В браузере (веб-режим) все функции мягко деградируют и возвращают null,
 * поэтому весь существующий код можно вызывать без условий, проверяя
 * `isDesktop()` / результат. В desktop-режиме всё идёт через нативный
 * Rust-бэкенд: терминал, файловая система, live-превью, проверка API.
 */

type InvokeFn = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>

let _invoke: InvokeFn | null = null
let _listen: ((event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>) | null =
  null

/** true, когда код исполняется внутри desktop-оболочки Tauri. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function ensure(): Promise<boolean> {
  if (!isDesktop()) return false
  if (_invoke && _listen) return true
  try {
    const core = await import('@tauri-apps/api/core')
    const ev = await import('@tauri-apps/api/event')
    _invoke = core.invoke as InvokeFn
    _listen = ev.listen as never
    return true
  } catch {
    return false
  }
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!(await ensure())) throw new Error('нативное ядро недоступно (не desktop)')
  return _invoke!<T>(cmd, args)
}

export async function listenNative<T = unknown>(
  event: string,
  cb: (payload: T) => void,
): Promise<() => void> {
  if (!(await ensure())) return () => {}
  return _listen!(event, (e) => cb(e.payload as T))
}

// --- Терминал ---------------------------------------------------------------

export type TermChunk = { id: string; data: string; done: boolean; code: number | null }

/** Подписка на вывод нативного терминала. Возвращает функцию отписки. */
export async function onTermOutput(id: string, cb: (chunk: TermChunk) => void) {
  return listenNative<TermChunk>(`term://${id}`, cb)
}

export async function termRun(id: string, cwd: string, command: string) {
  return invoke<void>('term_run', { id, cwd, command })
}

export async function termKill(id: string) {
  return invoke<void>('term_kill', { id })
}

// --- Файловая система -------------------------------------------------------

export type FsNode = { name: string; path: string; is_dir: boolean; children: FsNode[] }

export async function fsTree(root: string) {
  return invoke<FsNode[]>('fs_tree', { root })
}
export async function fsRead(path: string) {
  return invoke<string>('fs_read', { path })
}
export async function fsWrite(path: string, content: string) {
  return invoke<void>('fs_write', { path, content })
}

// --- Live-превью ------------------------------------------------------------

export type PreviewEvent = {
  id: string
  url: string | null
  log: string | null
  exited: boolean
}

export async function onPreview(id: string, cb: (ev: PreviewEvent) => void) {
  return listenNative<PreviewEvent>(`preview://${id}`, cb)
}
export async function previewStart(id: string, cwd: string) {
  return invoke<number>('preview_start', { id, cwd })
}
export async function previewStop(id: string) {
  return invoke<void>('preview_stop', { id })
}

// --- Проверка API-ключей ----------------------------------------------------

export type KeyProbeResult = {
  status: 'active' | 'slow' | 'error' | 'timeout'
  pingMs: number | null
  ttftMs: number | null
  failReason: string | null
}

export async function apiKeyProbe(key: string, baseUrl?: string, modelId?: string) {
  return invoke<KeyProbeResult>('api_key_probe', {
    input: { key, baseUrl: baseUrl ?? null, modelId: modelId ?? null },
  })
}

// --- Сеть -------------------------------------------------------------------

export async function localIpv4(): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    return await invoke<string>('local_ipv4')
  } catch {
    return null
  }
}
