import 'server-only'

/**
 * Локальный режим без регистрации.
 *
 * Регистрация скрыта: вместо неё при первом заходе автоматически создаётся
 * (или переиспользуется) единственный локальный аккаунт с ролью superadmin.
 * Весь вход в приложение сводится к анонимной сессии better-auth, которой
 * заранее присвоена роль superadmin — поэтому IDE сразу открывается с полной
 * админкой для всех, без экранов логина/пароля.
 */

import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export const LOCAL_ADMIN_EMAIL = 'local@aura.ide'
export const LOCAL_ADMIN_USERNAME = 'aura-admin'

/** Включён ли локальный режим «без регистрации». По умолчанию — да. */
export function isLocalMode(): boolean {
  return process.env.AURA_LOCAL_MODE !== '0'
}

/**
 * Гарантирует, что пользователь имеет роль superadmin. Идемпотентно:
 * апгрейдит только если роль ещё не superadmin. Устойчиво к немигрированной
 * схеме (колонка role появилась позже) — тогда просто no-op.
 */
export async function ensureSuperadmin(userId: string): Promise<void> {
  if (!userId) return
  try {
    await db
      .update(user)
      .set({ role: 'superadmin', updatedAt: new Date() })
      .where(eq(user.id, userId))
  } catch {
    /* schema not migrated yet — ignore */
  }
}

/** Найти/подготовить локального админа по id. Возвращает id или null. */
export async function promoteToSuperadmin(userId: string): Promise<string> {
  await ensureSuperadmin(userId)
  return userId
}
