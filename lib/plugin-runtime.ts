'use client'

/**
 * Плагин-раннтайм для IDE.
 *
 * Что делает:
 *   1) грузит установленные+включённые плагины пользователя (server action),
 *   2) для каждого — компилирует его hook-строки в функции через
 *      `new Function('ctx', body)`,
 *   3) выдаёт результат наружу тремя списками: toolbarButtons,
 *      paletteCommands, completionProviders.
 *
 * ВАЖНО — безопасность. Мы не даём хук-коду прямого доступа к window/eval.
 * Функции создаются с ЯВНЫМ параметром `ctx` — plugin-side API-объект;
 * global scope у Function-конструктора ссылается на window, поэтому этот
 * подход НЕ является песочницей от вредоносного кода. Плагины включаются
 * пользователем осознанно (в /plugins), так же как расширения VS Code —
 * доверяемся тому, что пользователь ставит только то, чему доверяет.
 */

import { getInstalledPlugins, type InstalledPlugin } from '@/app/actions/plugins'
import type {
  IdeCompletionProvider,
  IdePaletteCommand,
  IdeToolbarButton,
} from '@/lib/plugin-types'
import { inlineComplete } from '@/lib/ai-client'
import { fsRead, fsWrite } from '@/lib/tauri'

/** Контекст, который получает hook-код плагина. */
export type PluginCtx = {
  /** Активный файл (полный путь) или null. */
  activeFile: string | null
  /** Корень открытой папки. */
  root: string
  /** Открыть файл в редакторе (позиционировать в line/col — опц.). */
  openFile: (path: string, line?: number, column?: number) => void
  /** Прочитать файл с диска. */
  readFile: (path: string) => Promise<string>
  /** Записать файл на диск. */
  writeFile: (path: string, content: string) => Promise<void>
  /** Показать сообщение пользователю. */
  showMessage: (text: string, kind?: 'info' | 'warn' | 'error') => void
  /** Прочитать текущий буфер (может отличаться от диска, если dirty). */
  getActiveText: () => string
  /** Заменить содержимое активного буфера. */
  setActiveText: (text: string) => void
  /** Прямой доступ к LLM: короткий completion. */
  aiComplete: (input: {
    prefix: string
    suffix?: string
    language?: string
  }) => Promise<{ completion: string }>
}

export type CompiledToolbarButton = {
  pluginSlug: string
  id: string
  title: string
  icon?: string
  run: (ctx: PluginCtx) => void
}

export type CompiledPaletteCommand = {
  pluginSlug: string
  id: string
  title: string
  hint?: string
  keywords?: string
  run: (ctx: PluginCtx) => void
}

export type CompiledCompletionProvider = {
  pluginSlug: string
  id: string
  languages: string[]
  provide: (
    ctx: PluginCtx & { prefix: string; suffix: string; language: string; path: string },
  ) => Promise<string | null>
}

export type CompiledPlugins = {
  toolbarButtons: CompiledToolbarButton[]
  paletteCommands: CompiledPaletteCommand[]
  completions: CompiledCompletionProvider[]
}

/** Скомпилировать installed plugin manifest.ide. */
export function compilePlugin(p: InstalledPlugin): CompiledPlugins {
  const ide = p.manifest?.ide
  const out: CompiledPlugins = {
    toolbarButtons: [],
    paletteCommands: [],
    completions: [],
  }
  if (!ide) return out
  for (const b of ide.toolbarButtons ?? []) {
    const fn = safeCompile<(ctx: PluginCtx) => void>(b.onClick, ['ctx'])
    if (fn) out.toolbarButtons.push({ pluginSlug: p.slug, id: b.id, title: b.title, icon: b.icon, run: fn })
  }
  for (const c of ide.paletteCommands ?? []) {
    const fn = safeCompile<(ctx: PluginCtx) => void>(c.run, ['ctx'])
    if (fn)
      out.paletteCommands.push({
        pluginSlug: p.slug,
        id: c.id,
        title: c.title,
        hint: c.hint,
        keywords: c.keywords,
        run: fn,
      })
  }
  for (const c of ide.completions ?? []) {
    const fn = safeCompile<(ctx: any) => Promise<string | null>>(c.provide, ['ctx'])
    if (fn)
      out.completions.push({
        pluginSlug: p.slug,
        id: c.id,
        languages: c.languages,
        provide: async (ctx) => {
          try {
            const r = await fn(ctx)
            return typeof r === 'string' ? r : null
          } catch {
            return null
          }
        },
      })
  }
  return out
}

/** Собрать все установленные+включённые плагины пользователя. */
export async function loadUserIdePlugins(): Promise<CompiledPlugins> {
  const merged: CompiledPlugins = { toolbarButtons: [], paletteCommands: [], completions: [] }
  try {
    const installed = await getInstalledPlugins()
    for (const p of installed) {
      if (!p.enabled) continue
      const c = compilePlugin(p)
      merged.toolbarButtons.push(...c.toolbarButtons)
      merged.paletteCommands.push(...c.paletteCommands)
      merged.completions.push(...c.completions)
    }
  } catch {
    /* нет доступа к БД / гость — пусто */
  }
  return merged
}

/** Обёртка над new Function — ловим syntax errors, не роняем IDE. */
function safeCompile<T extends Function>(body: string, argNames: string[]): T | null {
  try {
    return new Function(...argNames, `"use strict";${body}`) as unknown as T
  } catch {
    return null
  }
}

/** Стандартный ctx (без активного файла). */
export function makeBaseCtx(root: string, cbs: {
  openFile: PluginCtx['openFile']
  showMessage: PluginCtx['showMessage']
  getActiveFile: () => string | null
  getActiveText: PluginCtx['getActiveText']
  setActiveText: PluginCtx['setActiveText']
}): PluginCtx {
  return {
    activeFile: cbs.getActiveFile(),
    root,
    openFile: cbs.openFile,
    readFile: (p) => fsRead(p),
    writeFile: (p, c) => fsWrite(p, c),
    showMessage: cbs.showMessage,
    getActiveText: cbs.getActiveText,
    setActiveText: cbs.setActiveText,
    aiComplete: (input) => inlineComplete(input),
  }
}
