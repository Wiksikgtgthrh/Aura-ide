'use server'

/**
 * Server actions для нативного desktop-терминала.
 *
 * В веб-режиме терминал идёт через /api/terminal (Docker/host на сервере).
 * В desktop-режиме (Tauri) команды исполняет нативное Rust-ядро на машине
 * пользователя — но проекты хранятся в Postgres (виртуальная ФС), поэтому
 * перед запуском их нужно материализовать на диск, а после — вернуть
 * изменения обратно в редактор/БД. Этот модуль — та самая склейка.
 */

import { getSession } from '@/lib/session'
import { getChatAccess } from '@/lib/chat-access'
import {
  ensureIdleSweeper,
  materializeProject,
  importProjectFromDisk,
  touchProject,
} from '@/lib/terminal'

/**
 * Подготовить проект к нативной команде: материализует виртуальную ФС
 * (Postgres) на диск в .aura/projects/<chatId>/ и возвращает абсолютный путь
 * рабочей директории для нативного терминала.
 */
export async function prepareDesktopTerminal(chatId: string): Promise<string | null> {
  const session = await getSession()
  if (!session?.user) return null
  const access = await getChatAccess(chatId, session.user.id)
  if (!access || access.level === 'read') return null
  ensureIdleSweeper()
  touchProject(chatId)
  return materializeProject(chatId)
}

/**
 * Завершить нативную команду: подтянуть изменения с диска обратно в БД и
 * вернуть карту файлов для слияния в редакторе (новые файлы, package.json и
 * т.п.). Существующие файлы в редакторе не удаляются — только дополняются.
 */
export async function finishDesktopTerminal(chatId: string): Promise<Record<string, string>> {
  const session = await getSession()
  if (!session?.user) return {}
  const access = await getChatAccess(chatId, session.user.id)
  if (!access || access.level === 'read') return {}
  return importProjectFromDisk(chatId)
}
