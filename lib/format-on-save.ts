'use client'

/**
 * Форматирование при сохранении.
 *
 * Запускаем `termRun` в директории проекта, подставляем путь к файлу
 * в шаблон вроде `prettier --write {file}`. После завершения перечитываем
 * файл с диска — Monaco получит отформатированное содержимое.
 */

import { termRun, onTermOutput } from '@/lib/tauri'
import type { WorkspaceSettings } from '@/lib/workspace-settings'

export function shouldFormat(settings: WorkspaceSettings, filePath: string): boolean {
  if (!settings.format?.onSave) return false
  if (!settings.format?.command?.trim()) return false
  const exts = settings.format?.extensions ?? []
  if (!exts.length) return true
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
  return exts.map((e) => e.replace(/^\./, '').toLowerCase()).includes(ext)
}

export async function runFormatter(cwd: string, template: string, filePath: string): Promise<void> {
  const cmd = template.replaceAll('{file}', `"${filePath}"`)
  const id = `fmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  await new Promise<void>((resolve, reject) => {
    let done = false
    onTermOutput(id, (chunk) => {
      if (chunk.done) {
        done = true
        if (chunk.code === 0 || chunk.code === null) resolve()
        else reject(new Error(`formatter exited ${chunk.code}`))
      }
    })
      .then(() => termRun(id, cwd, cmd))
      .catch((e) => {
        if (!done) reject(e as Error)
      })
  })
}
