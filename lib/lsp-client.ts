'use client'

/**
 * Тонкий LSP-клиент поверх нативного прокси в Rust (`lsp_start`/`lsp_send`).
 *
 * Реализует ровно то, что реально работает в Monaco без официального
 * monaco-languageclient: hover, definition, references, completion,
 * signature help, документные символы, plus diagnostics (маркеры).
 *
 * didOpen/didChange/didClose синхронизируем с Monaco моделями — сервер видит
 * то же, что и пользователь. Файлы вне открытых табов не отправляем: LSP
 * читает их сам с диска (rootUri задан).
 */

import { isDesktop, lspSend, lspStart, lspStop, onLsp } from '@/lib/tauri'

type Pending = {
  resolve: (v: any) => void
  reject: (e: any) => void
}

export class LspClient {
  private id: string
  private cwd: string
  private nextId = 1
  private pending = new Map<number | string, Pending>()
  private notifHandlers = new Map<string, (params: any) => void>()
  private unlisten: (() => void) | null = null
  private ready = false
  private openDocs = new Set<string>()
  private serverCaps: any = null
  private starting: Promise<void> | null = null
  private disposed = false

  constructor(cwd: string, id?: string) {
    this.cwd = cwd
    this.id = id ?? `ts:${cwd}`
  }

  onNotification(method: string, handler: (params: any) => void) {
    this.notifHandlers.set(method, handler)
  }

  /** Ленивая инициализация — spawn LSP + LSP initialize handshake. */
  async start(command?: string): Promise<void> {
    if (!isDesktop()) throw new Error('LSP доступен только в desktop-режиме')
    if (this.starting) return this.starting
    if (this.ready) return
    this.starting = (async () => {
      this.unlisten = await onLsp(this.id, (ev) => this.onEvent(ev.message, ev.exited))
      await lspStart({
        id: this.id,
        cwd: this.cwd,
        command,
      })
      // LSP handshake.
      const result = await this.request('initialize', {
        processId: null,
        rootUri: pathToUri(this.cwd),
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            completion: {
              completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] },
            },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: false },
            references: {},
            signatureHelp: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            publishDiagnostics: { versionSupport: false },
          },
          workspace: { workspaceFolders: true, configuration: true },
        },
        workspaceFolders: [{ uri: pathToUri(this.cwd), name: 'workspace' }],
      })
      this.serverCaps = (result as any)?.capabilities
      await this.notify('initialized', {})
      this.ready = true
    })()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  async shutdown() {
    this.disposed = true
    try {
      if (this.ready) {
        await this.request('shutdown', null).catch(() => {})
        await this.notify('exit', null).catch(() => {})
      }
    } finally {
      this.unlisten?.()
      await lspStop(this.id).catch(() => {})
      this.ready = false
    }
  }

  // --- Текстовая синхронизация ---------------------------------------------

  async didOpen(path: string, text: string, languageId: string) {
    if (!this.ready || this.disposed) return
    const uri = pathToUri(path)
    if (this.openDocs.has(uri)) {
      await this.didChange(path, text)
      return
    }
    this.openDocs.add(uri)
    await this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    })
  }

  async didChange(path: string, text: string) {
    if (!this.ready || this.disposed) return
    const uri = pathToUri(path)
    if (!this.openDocs.has(uri)) return
    // Полный ретекст — надёжнее, чем инкрементальные патчи.
    await this.notify('textDocument/didChange', {
      textDocument: { uri, version: Date.now() & 0x7fffffff },
      contentChanges: [{ text }],
    })
  }

  async didClose(path: string) {
    if (!this.ready || this.disposed) return
    const uri = pathToUri(path)
    if (!this.openDocs.has(uri)) return
    this.openDocs.delete(uri)
    await this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  // --- Запросы --------------------------------------------------------------

  async hover(path: string, line: number, character: number) {
    return this.request('textDocument/hover', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
    })
  }

  async definition(path: string, line: number, character: number) {
    return this.request('textDocument/definition', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
    })
  }

  async references(path: string, line: number, character: number) {
    return this.request('textDocument/references', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
      context: { includeDeclaration: true },
    })
  }

  async completion(path: string, line: number, character: number, triggerChar?: string) {
    return this.request('textDocument/completion', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
      context: triggerChar
        ? { triggerKind: 2, triggerCharacter: triggerChar }
        : { triggerKind: 1 },
    })
  }

  async signatureHelp(path: string, line: number, character: number) {
    return this.request('textDocument/signatureHelp', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
    })
  }

  async documentSymbol(path: string) {
    return this.request('textDocument/documentSymbol', {
      textDocument: { uri: pathToUri(path) },
    })
  }

  async rename(path: string, line: number, character: number, newName: string) {
    return this.request('textDocument/rename', {
      textDocument: { uri: pathToUri(path) },
      position: { line, character },
      newName,
    })
  }

  // --- JSON-RPC низкоуровневое ---------------------------------------------

  private async request<T = any>(method: string, params: any): Promise<T> {
    const id = this.nextId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      lspSend(this.id, message).catch((e) => {
        this.pending.delete(id)
        reject(e)
      })
    })
  }

  private async notify(method: string, params: any) {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params })
    await lspSend(this.id, message)
  }

  private onEvent(raw: string, exited: boolean) {
    if (exited) {
      // Освобождаем всех висящих.
      for (const p of this.pending.values()) p.reject(new Error('LSP завершён'))
      this.pending.clear()
      this.ready = false
      return
    }
    if (!raw) return
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    // Ответ на запрос.
    if (msg?.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error?.message ?? 'LSP error'))
        else p.resolve(msg.result)
      }
      return
    }
    // Запрос от сервера — обычно `workspace/configuration`, `window/showMessage`,
    // `client/registerCapability`. На большинство ждём хотя бы null-ответ,
    // иначе сервер зависнет.
    if (msg?.id != null && msg.method) {
      const method = msg.method as string
      let result: any = null
      if (method === 'workspace/configuration') {
        // typescript-language-server дёргает нашу конфигурацию — отдаём массив null'ов
        // (длиной = params.items.length) — это стандартный «без переопределений» ответ.
        const items = Array.isArray(msg.params?.items) ? msg.params.items.length : 1
        result = new Array(items).fill(null)
      }
      const reply = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })
      lspSend(this.id, reply).catch(() => {})
      return
    }
    // Нотификация от сервера (публикация диагностики, лог).
    if (msg?.method) {
      const h = this.notifHandlers.get(msg.method as string)
      if (h) h(msg.params)
    }
  }
}

export function pathToUri(path: string): string {
  const normalised = path.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalised)) return `file:///${normalised}`
  return `file://${normalised}`
}

export function uriToPath(uri: string): string {
  if (uri.startsWith('file:///') && /^file:\/\/\/[a-zA-Z]:/.test(uri)) {
    return uri.slice(8) // Windows drive
  }
  return uri.replace(/^file:\/\//, '')
}
