'use client'

/**
 * Настройки конкретного проекта (`.aura/settings.json` в корне).
 *
 * Хранит per-project overrides — отступы, форматтер, команды. Файл лежит
 * прямо в проекте, чтобы шарился через git и работал одинаково у всех
 * членов команды.
 */

import { fsRead, fsWrite } from '@/lib/tauri'

export type WorkspaceSettings = {
  editor?: {
    tabSize?: number
    insertSpaces?: boolean
    wordWrap?: 'on' | 'off'
    fontSize?: number
    /** Одна из зарегистрированных Monaco-тем. */
    theme?: 'aura-dark' | 'aura-light' | 'vs-dark' | 'vs' | 'hc-black'
  }
  ai?: {
    /** Ghost text при вводе (Copilot-подобный). Default: включено. */
    inlineCompletions?: boolean
  }
  lsp?: {
    /** Настоящий typescript-language-server для TS/JS (нужен `npm i -g …`). */
    enabled?: boolean
    /** Кастомная команда, если по имени не находится. */
    command?: string
  }
  format?: {
    /** Запускать форматтер по Ctrl+S. */
    onSave?: boolean
    /** Команда форматтера: `{file}` подставится в текущий путь. */
    command?: string
    /** Фильтр по расширениям файла — например ['ts','tsx']. Пусто = все. */
    extensions?: string[]
  }
  tasks?: {
    /** Ярлыки, показываются в Command Palette. */
    label: string
    command: string
  }[]
}

const PATH = '.aura/settings.json'

function joinPath(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + sep + rel.replace(/\//g, sep)
}

const DEFAULTS: WorkspaceSettings = {
  editor: { tabSize: 2, insertSpaces: true, wordWrap: 'off', fontSize: 13 },
  format: { onSave: false },
}

export async function loadWorkspaceSettings(root: string): Promise<WorkspaceSettings> {
  try {
    const raw = await fsRead(joinPath(root, PATH))
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed, editor: { ...DEFAULTS.editor, ...parsed.editor } }
  } catch {
    return DEFAULTS
  }
}

export async function saveWorkspaceSettings(root: string, s: WorkspaceSettings) {
  const text = JSON.stringify(s, null, 2)
  await fsWrite(joinPath(root, PATH), text)
}

export function settingsPath(root: string): string {
  return joinPath(root, PATH)
}
