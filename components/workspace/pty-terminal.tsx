'use client'

/**
 * Настоящий интерактивный терминал: xterm.js во фронте + portable-pty в Rust.
 *
 * Работает всё: стрелка вверх / Ctrl+R history, vim / htop / less, цвета,
 * unicode, resize по ResizeObserver, копирование выделения. В браузере
 * (не desktop) деградирует до сообщения «доступно только в desktop».
 */

import { useEffect, useRef } from 'react'
import { isDesktop, onPty, ptyClose, ptyOpen, ptyResize, ptyWrite } from '@/lib/tauri'

// xterm.js подгружаем dynamic, чтобы не тащить его в SSR.
let xtermPromise: Promise<{ Terminal: any; FitAddon: any; WebLinksAddon: any }> | null = null
async function loadXterm() {
  if (!xtermPromise) {
    xtermPromise = Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-web-links'),
      import('@xterm/xterm/css/xterm.css'),
    ]).then(([core, fit, links]) => ({
      Terminal: core.Terminal,
      FitAddon: fit.FitAddon,
      WebLinksAddon: links.WebLinksAddon,
    }))
  }
  return xtermPromise
}

export function PtyTerminal({ id, cwd }: { id: string; cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    if (!isDesktop() || !hostRef.current) return
    const host = hostRef.current
    let term: any = null
    let fit: any = null
    let unlisten: (() => void) | null = null
    let resizeObs: ResizeObserver | null = null
    let disposeInput: any = null
    let opened = false

    ;(async () => {
      const { Terminal, FitAddon, WebLinksAddon } = await loadXterm()
      if (!alive.current) return
      term = new Terminal({
        cursorBlink: true,
        fontFamily:
          '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        theme: {
          background: '#0a0a0a',
          foreground: '#e4e4e7',
          cursor: '#a1a1aa',
          selectionBackground: '#3f3f46',
        },
        allowProposedApi: true,
        scrollback: 5000,
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon())
      term.open(host)
      fit.fit()
      const cols = term.cols
      const rows = term.rows

      try {
        await ptyOpen(id, cwd, cols, rows)
        opened = true
      } catch (e) {
        term.writeln(`\r\n\x1b[31mошибка открытия PTY: ${(e as Error).message}\x1b[0m`)
        return
      }

      unlisten = await onPty(id, (chunk) => {
        if (!alive.current || !term) return
        if (chunk.data.length) term.write(new Uint8Array(chunk.data))
        if (chunk.exited) {
          term.writeln(`\r\n\x1b[90m[shell завершён, код ${chunk.code ?? 0}]\x1b[0m`)
        }
      })
      disposeInput = term.onData((data: string) => {
        void ptyWrite(id, data)
      })

      resizeObs = new ResizeObserver(() => {
        if (!fit || !term) return
        try {
          fit.fit()
          void ptyResize(id, term.cols, term.rows)
        } catch {
          /* mount race */
        }
      })
      resizeObs.observe(host)
    })()

    return () => {
      alive.current = false
      try {
        disposeInput?.dispose?.()
        resizeObs?.disconnect()
        unlisten?.()
        term?.dispose()
      } catch {
        /* ignore */
      }
      if (opened) void ptyClose(id).catch(() => {})
    }
  }, [id, cwd])

  if (!isDesktop()) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-xs text-zinc-500">
        интерактивный терминал доступен только в desktop-режиме
      </div>
    )
  }
  return <div ref={hostRef} className="h-full w-full bg-black p-1" />
}
