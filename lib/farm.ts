/**
 * V0 Farm — пул v0-ключей с ротацией и кулдауном.
 *
 * Админ заводит группы ключей («Bearer vcp_...» из v0.app/settings/keys),
 * назначает группы пользователям / тарифам / админам / всем. Генерация идёт
 * через официальный HTTP API v0 (https://api.v0.dev/v1, синхронный POST
 * /chats — ждёт завершения 1-10 минут). При исчерпании баланса ключа
 * (402/429/409/5xx) ключ уходит в кулдаун на FARM_COOLDOWN_MS (31 день),
 * а тот же промпт автоматически уходит на следующий готовый ключ — сессия
 * IDE (чат + файлы + превью) не прерывается. Ключ с 401/403 помечается
 * как недействительный (disabled).
 */

import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  farmAssignments,
  farmKeys,
  farmUsageLog,
  projectFiles,
  user,
  userBalance,
} from '@/lib/db/schema'
import { decryptSecret } from '@/lib/crypto'

export const FARM_COOLDOWN_MS = 31 * 24 * 60 * 60 * 1000
const V0_BASE = 'https://api.v0.dev/v1'
const V0_CREATE_TIMEOUT_MS = 600_000

export type FarmKeyStatus = 'ready' | 'cooldown' | 'disabled'

export class V0FarmError extends Error {
  status: number
  type: string
  retryable: boolean

  constructor(message: string, { status = 0, type = '', retryable = false } = {}) {
    super(message)
    this.name = 'V0FarmError'
    this.status = status
    this.type = type
    this.retryable = retryable
  }
}

async function v0Fetch(
  token: string,
  urlPath: string,
  init?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<any> {
  const { method = 'GET', body, timeoutMs = 90_000 } = init ?? {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${V0_BASE}${urlPath}`, {
      method,
      headers: {
        Authorization: token, // полное значение заголовка: "Bearer vcp_..."
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      let type = ''
      try {
        const data = (await res.json()) as { error?: { message?: string; type?: string } }
        msg = data?.error?.message || msg
        type = data?.error?.type || ''
      } catch {
        // тело не JSON — оставляем HTTP-статус
      }
      throw new V0FarmError(msg, {
        status: res.status,
        type,
        retryable:
          res.status === 402 || res.status === 429 || res.status === 409 || res.status >= 500,
      })
    }
    return (await res.json()) as any
  } catch (e) {
    if (e instanceof V0FarmError) throw e
    const aborted = e instanceof Error && e.name === 'AbortError'
    throw new V0FarmError(
      aborted ? `Таймаут api.v0.dev (${Math.round(timeoutMs / 1000)}с)` : 'Сетевая ошибка api.v0.dev',
      { retryable: true },
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Создать чат в v0 (синхронно — ждёт генерацию до 10 минут). */
export async function v0CreateChat(
  token: string,
  message: string,
  systemPrompt?: string,
): Promise<any> {
  const body: Record<string, string> = { message }
  if (systemPrompt) body.systemPrompt = systemPrompt
  return v0Fetch(token, '/chats', { method: 'POST', body, timeoutMs: V0_CREATE_TIMEOUT_MS })
}

/** Лёгкий запрос для проверки ключа: 200 = рабочий, 401/403 = мёртвый. */
export async function v0Probe(token: string): Promise<'ok' | 'dead' | 'error'> {
  try {
    await v0Fetch(token, '/chats?limit=1', { timeoutMs: 30_000 })
    return 'ok'
  } catch (e) {
    if (e instanceof V0FarmError) return e.status === 401 || e.status === 403 ? 'dead' : 'error'
    return 'error'
  }
}

/**
 * Достать файлы из ответа v0: предпочитаем chat.files [{meta.file, source}],
 * fallback — latestVersion.files [{name, content}].
 */
export function extractV0Files(chat: any): { path: string; content: string }[] {
  const fromFiles = (chat?.files ?? [])
    .filter((f: any) => f?.meta?.file)
    .map((f: any) => ({ path: String(f.meta.file), content: String(f.source ?? '') }))
  if (fromFiles.length > 0) return fromFiles
  return (chat?.latestVersion?.files ?? [])
    .filter((f: any) => f?.name)
    .map((f: any) => ({ path: String(f.name), content: String(f.content ?? '') }))
}

/** Какие группы ключей доступны пользователю (выдачи: user/plan/admin/all). */
export async function getAssignedGroupIdsForUser(userId: string): Promise<string[]> {
  const [rows, me] = await Promise.all([
    db
      .select({
        groupId: farmAssignments.groupId,
        targetType: farmAssignments.targetType,
        targetId: farmAssignments.targetId,
      })
      .from(farmAssignments),
    db
      .select({ role: user.role, plan: userBalance.plan })
      .from(user)
      .leftJoin(userBalance, eq(userBalance.userId, user.id))
      .where(eq(user.id, userId)),
  ])
  const role = me[0]?.role ?? 'user'
  const plan = me[0]?.plan ?? 'free'

  const ids = new Set<string>()
  for (const r of rows) {
    if (r.targetType === 'all') ids.add(r.groupId)
    else if (r.targetType === 'admin' && role !== 'user') ids.add(r.groupId)
    else if (r.targetType === 'user' && r.targetId === userId) ids.add(r.groupId)
    else if (r.targetType === 'plan' && r.targetId === plan) ids.add(r.groupId)
  }
  return [...ids]
}

/** Ленивое восстановление: ключи, чей кулдаун истёк, снова готовы. */
export async function restoreReadyKeys(): Promise<number> {
  const res = await db
    .update(farmKeys)
    .set({ status: 'ready', cooldownUntil: null, cooldownReason: '', updatedAt: new Date() })
    .where(and(eq(farmKeys.status, 'cooldown'), lte(farmKeys.cooldownUntil, new Date())))
  return res.rowCount ?? 0
}

export type ReadyKey = { id: string; groupId: string; label: string; token: string }

/** Готовые ключи пользователя (round-robin: менее использованные первыми). */
export async function getReadyKeysForUser(userId: string): Promise<ReadyKey[]> {
  const groupIds = await getAssignedGroupIdsForUser(userId)
  if (groupIds.length === 0) return []
  await restoreReadyKeys()
  const rows = await db
    .select({
      id: farmKeys.id,
      groupId: farmKeys.groupId,
      label: farmKeys.label,
      key: farmKeys.key,
    })
    .from(farmKeys)
    .where(and(eq(farmKeys.status, 'ready'), inArray(farmKeys.groupId, groupIds)))
    .orderBy(farmKeys.usageCount, farmKeys.lastUsedAt)
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    label: r.label,
    token: decryptSecret(r.key),
  }))
}

export async function markKeyCooldown(keyId: string, reason: string): Promise<void> {
  await db
    .update(farmKeys)
    .set({
      status: 'cooldown',
      cooldownUntil: new Date(Date.now() + FARM_COOLDOWN_MS),
      cooldownReason: reason.slice(0, 300),
      lastError: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(farmKeys.id, keyId))
}

export async function markKeyDisabled(keyId: string, reason: string): Promise<void> {
  await db
    .update(farmKeys)
    .set({
      status: 'disabled',
      cooldownUntil: null,
      cooldownReason: reason.slice(0, 300),
      lastError: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(farmKeys.id, keyId))
}

export async function markKeySuccess(keyId: string): Promise<void> {
  await db
    .update(farmKeys)
    .set({
      usageCount: sql`${farmKeys.usageCount} + 1`,
      lastUsedAt: new Date(),
      lastError: '',
      updatedAt: new Date(),
    })
    .where(eq(farmKeys.id, keyId))
}

export type FarmGenerationInput = {
  userId: string
  prompt: string
  systemPrompt?: string
  chatId?: string
}

export type FarmGenerationResult =
  | {
      ok: true
      keyId: string
      groupId: string
      v0ChatId: string
      webUrl: string
      files: { path: string; content: string }[]
      assistantText: string
    }
  | { ok: false; errors: string[] }

/**
 * Основной цикл генерации: пробует готовые ключи по очереди, при
 * исчерпании (retryable) отправляет ключ в кулдаун 31 день и продолжает
 * тем же промптом на следующем ключе. Возвращает файлы + текст для чата.
 */
export async function generateWithFarm(
  input: FarmGenerationInput,
): Promise<FarmGenerationResult> {
  let keys: ReadyKey[]
  try {
    keys = await getReadyKeysForUser(input.userId)
  } catch {
    return {
      ok: false,
      errors: ['Таблицы V0 Farm не найдены — выполните `pnpm migrate:farm`.'],
    }
  }
  if (keys.length === 0) {
    return {
      ok: false,
      errors: [
        'Нет доступных ключей v0: администратор не выдал вам группу ключей, либо все ключи в кулдауне/отключены.',
      ],
    }
  }

  const errors: string[] = []
  for (const key of keys) {
    const tag = key.label || key.id.slice(0, 8)
    try {
      const chat = await v0CreateChat(key.token, input.prompt, input.systemPrompt)
      const files = extractV0Files(chat).slice(0, 200)
      await markKeySuccess(key.id)
      await db
        .insert(farmUsageLog)
        .values({
          userId: input.userId,
          chatId: input.chatId ?? '',
          groupId: key.groupId,
          keyId: key.id,
          prompt: input.prompt.slice(0, 2000),
          status: 'ok',
        })
        .catch(() => {}) // лог не должен ронять генерацию
      const v0ChatId = chat?.id ? String(chat.id) : ''
      return {
        ok: true,
        keyId: key.id,
        groupId: key.groupId,
        v0ChatId,
        webUrl: v0ChatId ? `https://v0.app/chat/${v0ChatId}` : '',
        files,
        assistantText: buildAssistantText(files, v0ChatId),
      }
    } catch (e) {
      const err = e instanceof V0FarmError ? e : new V0FarmError(String(e))
      const reason = `[${tag}] ${err.message}`
      errors.push(reason)
      try {
        if (err.status === 401 || err.status === 403) {
          await markKeyDisabled(key.id, reason)
        } else if (err.retryable) {
          await markKeyCooldown(key.id, reason)
        } else {
          await db
            .update(farmKeys)
            .set({ lastError: reason.slice(0, 500), updatedAt: new Date() })
            .where(eq(farmKeys.id, key.id))
        }
        await db
          .insert(farmUsageLog)
          .values({
            userId: input.userId,
            chatId: input.chatId ?? '',
            groupId: key.groupId,
            keyId: key.id,
            prompt: input.prompt.slice(0, 2000),
            status: 'exhausted',
            error: reason.slice(0, 500),
          })
          .catch(() => {})
      } catch {
        // БД недоступна — не останавливаем ротацию
      }
    }
  }
  return { ok: false, errors }
}

function buildAssistantText(files: { path: string; content: string }[], v0ChatId: string): string {
  const lines = files.map((f) => `- \`${f.path}\``).join('\n')
  const link = v0ChatId ? `\n\n[Открыть в v0](https://v0.app/chat/${v0ChatId})` : ''
  return `V0 сгенерировал ${files.length} файлов:\n\n${lines}${link}`
}

function sanitizePath(p: string): string {
  const cleaned = p.replace(/\\/g, '/').replace(/^[a-zA-Z]:\//, '').replace(/^(\.\.\/)+/, '')
  return cleaned.startsWith('/') ? cleaned.slice(1) : cleaned
}

/** Пишет файлы v0 прямо в project_files (тот же источник, что читает превью). */
export async function saveFarmFilesToProject(
  chatId: string,
  files: { path: string; content: string }[],
): Promise<number> {
  if (files.length === 0) return 0
  const entries = files.slice(0, 200).map((f) => ({
    chatId,
    path: sanitizePath(f.path),
    content: f.content.slice(0, 200_000),
    updatedAt: new Date(),
  }))
  await db
    .insert(projectFiles)
    .values(entries)
    .onConflictDoUpdate({
      target: [projectFiles.chatId, projectFiles.path],
      set: { content: sql`excluded."content"`, updatedAt: new Date() },
    })
  return entries.length
}
