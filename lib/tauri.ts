'use client'

/**
 * Тонкий клиент к нативному ядру Tauri.
 *
 * В браузере (веб-режим) все функции мягко деградируют: команды бросают
 * контролируемую ошибку, слушатели возвращают no-op unlisten. Так весь
 * IDE-код можно вызывать без ветвления, а проверку доступности делать
 * через `isDesktop()`.
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

// --- Интерактивный PTY (xterm.js во фронте) --------------------------------

export type PtyChunk = { id: string; data: number[]; exited: boolean; code: number | null }

export async function onPty(id: string, cb: (chunk: PtyChunk) => void) {
  return listenNative<PtyChunk>(`pty://${id}`, cb)
}
export async function ptyOpen(id: string, cwd: string, cols: number, rows: number, shell?: string) {
  return invoke<void>('pty_open', { args: { id, cwd, cols, rows, shell: shell ?? null } })
}
export async function ptyWrite(id: string, data: Uint8Array | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return invoke<void>('pty_write', { id, data: Array.from(bytes) })
}
export async function ptyResize(id: string, cols: number, rows: number) {
  return invoke<void>('pty_resize', { id, cols, rows })
}
export async function ptyClose(id: string) {
  return invoke<void>('pty_close', { id })
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
export async function fsCreateFile(path: string) {
  return invoke<void>('fs_create_file', { path })
}
export async function fsCreateDir(path: string) {
  return invoke<void>('fs_create_dir', { path })
}
export async function fsDelete(path: string) {
  return invoke<void>('fs_delete', { path })
}
export async function fsRename(from: string, to: string) {
  return invoke<void>('fs_rename', { from, to })
}

// --- Глобальный поиск / замена ---------------------------------------------

export type SearchMatch = {
  file: string
  line: number
  column: number
  preview: string
  matchText: string
}
export type SearchResult = { matches: SearchMatch[]; truncated: boolean; scannedFiles: number }

export async function fsSearch(input: {
  root: string
  query: string
  isRegex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  includeGlob?: string
  excludeGlob?: string
  maxMatches?: number
}) {
  return invoke<SearchResult>('fs_search', { input })
}

export async function fsReplaceAt(input: SearchMatch & { replacement: string }) {
  return invoke<void>('fs_replace_at', {
    input: {
      file: input.file,
      line: input.line,
      column: input.column,
      matchText: input.matchText,
      replacement: input.replacement,
    },
  })
}

// --- Watcher ---------------------------------------------------------------

export type FsChangeEvent = { root: string; paths: string[] }
export async function onFsChanged(cb: (ev: FsChangeEvent) => void) {
  return listenNative<FsChangeEvent>('fs://changed', cb)
}
export async function fsWatchStart(root: string) {
  return invoke<void>('fs_watch_start', { root })
}
export async function fsWatchStop(root: string) {
  return invoke<void>('fs_watch_stop', { root })
}

// --- Git -------------------------------------------------------------------

export type GitStatusEntry = { status: string; path: string }

export async function gitStatus(cwd: string) {
  return invoke<GitStatusEntry[]>('git_status', { cwd })
}

export type GitBranchInfo = {
  current: string | null
  ahead: number
  behind: number
  upstream: string | null
}
export async function gitBranch(cwd: string) {
  return invoke<GitBranchInfo>('git_branch', { cwd })
}

export type GitBranchListItem = { name: string; current: boolean; remote: boolean }
export async function gitBranchList(cwd: string) {
  return invoke<GitBranchListItem[]>('git_branch_list', { cwd })
}
export async function gitCheckout(cwd: string, branch: string) {
  return invoke<void>('git_checkout', { cwd, branch })
}
export async function gitCreateBranch(cwd: string, name: string, checkout = true) {
  return invoke<void>('git_create_branch', { cwd, name, checkout })
}
export async function gitStage(cwd: string, paths: string[]) {
  return invoke<void>('git_stage', { cwd, paths })
}
export async function gitUnstage(cwd: string, paths: string[]) {
  return invoke<void>('git_unstage', { cwd, paths })
}
export async function gitStageAll(cwd: string) {
  return invoke<void>('git_stage_all', { cwd })
}
export async function gitDiscard(cwd: string, paths: string[]) {
  return invoke<void>('git_discard', { cwd, paths })
}
export async function gitCommit(input: {
  cwd: string
  message: string
  amend?: boolean
  signOff?: boolean
}) {
  return invoke<string>('git_commit', { input })
}
export async function gitPush(cwd: string, setUpstream = false) {
  return invoke<string>('git_push', { cwd, setUpstream })
}
export async function gitPull(cwd: string) {
  return invoke<string>('git_pull', { cwd })
}
export async function gitFetch(cwd: string) {
  return invoke<string>('git_fetch', { cwd })
}
export async function gitDiff(cwd: string, path: string, staged = false) {
  return invoke<string>('git_diff', { cwd, path, staged })
}
export type GitLogEntry = {
  hash: string
  short: string
  author: string
  date: string
  subject: string
}
export async function gitLog(cwd: string, limit = 50) {
  return invoke<GitLogEntry[]>('git_log', { cwd, limit })
}
export async function gitInit(cwd: string) {
  return invoke<void>('git_init', { cwd })
}

// --- Диалог выбора папки ---------------------------------------------------

/** Нативный диалог «Открыть папку». В браузере → null (недоступно). */
export async function pickFolder(): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    const dialog = await import('@tauri-apps/plugin-dialog')
    const selected = await dialog.open({ directory: true, multiple: false })
    return typeof selected === 'string' ? selected : null
  } catch {
    return null
  }
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
