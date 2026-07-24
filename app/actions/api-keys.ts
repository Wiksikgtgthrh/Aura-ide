'use server'

import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { apiKeys, apiKeyGroups } from '@/lib/db/schema'
import { encryptSecret, decryptSecret, isEncrypted } from '@/lib/crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'
import { assertSafeFetchUrl } from '@/lib/ssrf'

async function getUserIdOrNull() {
  const session = await getSession()
  return session?.user?.id ?? null
}

export type ApiKeyStatus = 'unknown' | 'valid' | 'invalid' | 'error' | 'timeout'

export type ApiKeyItem = {
  id: number
  name: string
  maskedKey: string
  baseUrl: string
  modelId: string
  status: ApiKeyStatus
  ping: number | null
  failReason: string | null
  groupId: string | null
  position: number
  lastCheckedAt: string | null
}

export type ApiKeyGroup = {
  id: string
  name: string
  position: number
  keys: ApiKeyItem[]
}

export type ApiKeysGrouped = {
  groups: ApiKeyGroup[]
  ungrouped: ApiKeyItem[]
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL_ID = 'gpt-4o-mini'

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function normalizeBaseUrl(input: string | undefined | null): string {
  const v = (input ?? '').trim()
  if (!v) return DEFAULT_BASE_URL
  // strip trailing slash
  return v.replace(/\/+$/, '')
}

/**
 * Verify an OpenAI-compatible API key by calling GET {baseUrl}/models.
 * Works for OpenAI, Groq, OpenRouter, Together, DeepInfra, Fireworks, local
 * servers, and most OpenAI-compatible gateways.
 */
async function verifyKey(
  rawKey: string,
  baseUrl: string,
): Promise<ApiKeyStatus> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    // SSRF guard: reject internal/private targets before fetching.
    const safe = await assertSafeFetchUrl(normalizeBaseUrl(baseUrl))
    const res = await fetch(`${safe}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${rawKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })
    if (res.ok) return 'valid'
    // 401/403 => bad key. Anything else we also treat as not working.
    return 'invalid'
  } catch {
    return 'invalid'
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Probe a SPECIFIC model with a 1-token chat completion. Returns whether the
 * key can actually call that model (a key may list /models fine yet lack access
 * to a given model, or a base URL may only serve certain models).
 */
async function probeModel(
  rawKey: string,
  baseUrl: string,
  modelId: string,
): Promise<{
  ok: boolean
  ping: number | null
  httpStatus?: number
  providerMessage?: string
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  const started = Date.now()
  try {
    const safe = await assertSafeFetchUrl(normalizeBaseUrl(baseUrl))
    const res = await fetch(`${safe}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rawKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    })
    const ping = Date.now() - started
    if (res.ok) return { ok: true, ping }
    // 400 with a model-related error still proves the key auths; but to be
    // strict about "this model works" we only accept 2xx.
    // Surface the provider's OWN error message — «Invalid API key»,
    // «подписка истекла», «insufficient quota» и т.п. — so the user sees WHY.
    let providerMessage: string | undefined
    const bodyText = await res.text().catch(() => '')
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: { message?: string } | string
        message?: string
      }
      providerMessage =
        typeof parsed.error === 'object' && parsed.error?.message
          ? parsed.error.message
          : typeof parsed.error === 'string'
            ? parsed.error
            : parsed.message
    } catch {
      /* not JSON */
    }
    if (!providerMessage && bodyText) providerMessage = bodyText
    return {
      ok: false,
      ping: null,
      httpStatus: res.status,
      providerMessage: providerMessage?.slice(0, 140),
    }
  } catch {
    return { ok: false, ping: null }
  } finally {
    clearTimeout(timeout)
  }
}

/** Human failReason for a failed model probe, including the provider's own words. */
function probeFailReason(
  modelId: string,
  probe: { httpStatus?: number; providerMessage?: string },
): string {
  const status = probe.httpStatus ? `HTTP ${probe.httpStatus}` : 'сеть/таймаут'
  const detail = probe.providerMessage ? ` — ${probe.providerMessage}` : ''
  return `Модель ${modelId}: ${status}${detail}`
}

export type ModelProbeImportResult = {
  created: number
  failed: number
  perKey: {
    name: string
    maskedKey: string
    workingModel: string | null
    testedModels: number
  }[]
}

/**
 * Import a batch of API keys that all share ONE base URL and a candidate list
 * of model IDs. Each key is probed against every model (until one works); the
 * first working model is stored with the key. Keys with no working model are
 * still saved (status invalid) so the user can inspect them.
 *
 * Input format:
 *   name      — provider/group label (e.g. "Groq")
 *   baseUrl   — shared base URL for all keys
 *   models    — candidate model IDs to probe (first that works is assigned)
 *   keysText  — one API key per line
 */
export async function importKeysWithModelProbe(input: {
  name: string
  baseUrl: string
  models: string[]
  keysText: string
}): Promise<ModelProbeImportResult | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null

  const baseUrl = normalizeBaseUrl(input.baseUrl).slice(0, 300)
  const models = input.models
    .flatMap((m) => m.split(/[,;\n]/))
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 20)
  const modelsToProbe = models.length > 0 ? models : [DEFAULT_MODEL_ID]

  const keys = input.keysText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 100)

  const baseName = (input.name || 'API').slice(0, 80)

  let created = 0
  let failed = 0
  const perKey: ModelProbeImportResult['perKey'] = []

  await Promise.all(
    keys.map(async (rawKey, index) => {
      // Probe models in order; keep the first that works.
      let workingModel: string | null = null
      let ping: number | null = null
      for (const model of modelsToProbe) {
        const r = await probeModel(rawKey, baseUrl, model)
        if (r.ok) {
          workingModel = model
          ping = r.ping
          break
        }
      }

      const name = keys.length > 1 ? `${baseName} ${index + 1}` : baseName
      try {
        await db.insert(apiKeys).values({
          userId,
          name,
          key: encryptSecret(rawKey),
          modelId: workingModel ?? modelsToProbe[0],
          baseUrl,
          status: workingModel ? 'valid' : 'invalid',
          ping: ping ?? undefined,
          lastCheckedAt: new Date(),
        })
        if (workingModel) created++
        else failed++
      } catch {
        failed++
      }

      perKey.push({
        name,
        maskedKey: maskKey(rawKey),
        workingModel,
        testedModels: modelsToProbe.length,
      })
    }),
  )

  revalidateTag('api-keys', 'max')
  revalidatePath('/settings')
  revalidatePath('/my-api')
  return { created, failed, perKey }
}

function toItem(r: {
  id: number
  name: string
  key: string
  baseUrl: string
  modelId: string
  status: string
  ping?: number | null
  failReason?: string | null
  groupId?: string | null
  position?: number
  lastCheckedAt: Date | null
}): ApiKeyItem {
  return {
    id: r.id,
    name: r.name,
    maskedKey: maskKey(decryptSecret(r.key)),
    baseUrl: r.baseUrl,
    modelId: r.modelId,
    status: (r.status as ApiKeyStatus) ?? 'unknown',
    ping: r.ping ?? null,
    failReason: r.failReason ?? null,
    groupId: r.groupId ?? null,
    position: r.position ?? 0,
    lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
  }
}

async function fetchApiKeysForUser(userId: string): Promise<ApiKeyItem[]> {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      key: apiKeys.key,
      baseUrl: apiKeys.baseUrl,
      modelId: apiKeys.modelId,
      status: apiKeys.status,
      ping: apiKeys.ping,
      failReason: apiKeys.failReason,
      groupId: apiKeys.groupId,
      position: apiKeys.position,
      lastCheckedAt: apiKeys.lastCheckedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(asc(apiKeys.position), desc(apiKeys.createdAt))

  // Lazily migrate legacy plaintext keys to encrypted storage.
  for (const r of rows) {
    if (!isEncrypted(r.key)) {
      const encrypted = encryptSecret(r.key)
      await db
        .update(apiKeys)
        .set({ key: encrypted })
        .where(and(eq(apiKeys.id, r.id), eq(apiKeys.userId, userId)))
      r.key = encrypted
    }
  }

  return rows.map(toItem)
}

export async function getApiKeys(): Promise<ApiKeyItem[] | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  return unstable_cache(
    () => fetchApiKeysForUser(userId),
    ['api-keys', userId],
    { tags: ['api-keys'], revalidate: 60 },
  )()
}

/** Direct version — use when userId is already known (e.g. in layout). */
export async function getApiKeysForUser(userId: string): Promise<ApiKeyItem[]> {
  return unstable_cache(
    () => fetchApiKeysForUser(userId),
    ['api-keys', userId],
    { tags: ['api-keys'], revalidate: 60 },
  )()
}

export async function createApiKey(input: {
  name: string
  key: string
  modelId?: string
  baseUrl?: string
}): Promise<ApiKeyItem | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const trimmedName = input.name.trim().slice(0, 100)
  const trimmedKey = input.key.trim().slice(0, 500)
  if (!trimmedName || !trimmedKey) throw new Error('Name and key are required')
  const modelId = (input.modelId?.trim() || DEFAULT_MODEL_ID).slice(0, 200)
  const baseUrl = normalizeBaseUrl(input.baseUrl).slice(0, 300)

  // Insert immediately with status 'unknown' — the key appears in the UI
  // right away. Verification used to run inline here (up to 12s before the
  // row even existed); the client now fires checkApiKey() in the background
  // once the row is visible.
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId,
      name: trimmedName,
      key: encryptSecret(trimmedKey),
      modelId,
      baseUrl,
      status: 'unknown',
      lastCheckedAt: null,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      key: apiKeys.key,
      baseUrl: apiKeys.baseUrl,
      modelId: apiKeys.modelId,
      status: apiKeys.status,
      lastCheckedAt: apiKeys.lastCheckedAt,
    })
  // Invalidate the 60s unstable_cache — without this getApiKeys() kept
  // serving a stale list and a just-added key "didn't show up".
  revalidateTag('api-keys', 'max')
  revalidatePath('/settings')
  return toItem(row)
}

export async function updateApiKey(
  id: number,
  patch: { modelId?: string; baseUrl?: string },
): Promise<ApiKeyItem | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const set: Record<string, string> = {}
  if (patch.modelId !== undefined)
    set.modelId = patch.modelId.trim().slice(0, 200) || DEFAULT_MODEL_ID
  if (patch.baseUrl !== undefined)
    set.baseUrl = normalizeBaseUrl(patch.baseUrl).slice(0, 300)
  if (Object.keys(set).length === 0) return null
  const [row] = await db
    .update(apiKeys)
    .set(set)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      key: apiKeys.key,
      baseUrl: apiKeys.baseUrl,
      modelId: apiKeys.modelId,
      status: apiKeys.status,
      lastCheckedAt: apiKeys.lastCheckedAt,
    })
  revalidateTag('api-keys', 'max')
  return row ? toItem(row) : null
}

/**
 * Re-verify a stored key and persist the resulting status.
 *
 * Probes the CONFIGURED MODEL with a real 1-token completion — the old
 * GET /models check only proved the key authenticates, which is why keys
 * showed «Работает» while the chat model was actually down at the provider.
 */
export async function checkApiKey(id: number): Promise<ApiKeyStatus | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const [row] = await db
    .select({ key: apiKeys.key, baseUrl: apiKeys.baseUrl, modelId: apiKeys.modelId })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .limit(1)
  if (!row) return null
  const modelId = row.modelId || DEFAULT_MODEL_ID
  const probe = await probeModel(decryptSecret(row.key), row.baseUrl, modelId)
  const status: ApiKeyStatus = probe.ok ? 'valid' : 'invalid'
  await db
    .update(apiKeys)
    .set({
      status,
      ping: probe.ok ? probe.ping : null,
      failReason: probe.ok ? null : probeFailReason(modelId, probe),
      lastCheckedAt: new Date(),
    })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
  revalidateTag('api-keys', 'max')
  return status
}

/** Re-verify all of the user's keys (real model probe). Returns the refreshed list. */
export async function checkAllApiKeys(): Promise<ApiKeyItem[] | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const rows = await db
    .select({ id: apiKeys.id, key: apiKeys.key, baseUrl: apiKeys.baseUrl, modelId: apiKeys.modelId })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))

  await Promise.all(
    rows.map(async (r) => {
      const modelId = r.modelId || DEFAULT_MODEL_ID
      const probe = await probeModel(decryptSecret(r.key), r.baseUrl, modelId)
      await db
        .update(apiKeys)
        .set({
          status: probe.ok ? 'valid' : 'invalid',
          ping: probe.ok ? probe.ping : null,
          failReason: probe.ok ? null : probeFailReason(modelId, probe),
          lastCheckedAt: new Date(),
        })
        .where(and(eq(apiKeys.id, r.id), eq(apiKeys.userId, userId)))
    }),
  )

  revalidateTag('api-keys', 'max')
  return getApiKeys()
}

export type BulkImportResult = { created: number; failed: number }

/**
 * Bulk import keys from pasted text. One key per line. Fields separated by
 * comma, semicolon, tab or pipe:
 *   name, apiKey, modelId(optional), baseUrl(optional)
 * If only a raw key is provided on a line, a name is generated automatically.
 * `defaultBaseUrl` is used when a line does not specify its own base URL.
 */
export async function createApiKeysBulk(
  text: string,
  defaultBaseUrl?: string,
): Promise<BulkImportResult | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200)

  const parsed: {
    name: string
    key: string
    modelId: string
    baseUrl: string
  }[] = []

  let autoIndex = 1
  for (const line of lines) {
    const parts = line
      .split(/[,;\t|]/)
      .map((p) => p.trim())
      .filter((_, i, arr) => i < arr.length)
    let name = ''
    let key = ''
    let modelId = ''
    let baseUrl = ''

    if (parts.length === 1) {
      key = parts[0]
      name = `Key ${autoIndex++}`
    } else {
      ;[name, key, modelId = '', baseUrl = ''] = parts
    }

    name = (name || `Key ${autoIndex++}`).slice(0, 100)
    key = (key || '').slice(0, 500)
    if (!key) continue
    // Per-line baseUrl wins; fall back to the provided default; then the global default.
    const resolvedBaseUrl = normalizeBaseUrl(baseUrl || defaultBaseUrl || '').slice(0, 300)
    parsed.push({
      name,
      key,
      modelId: (modelId || DEFAULT_MODEL_ID).slice(0, 200),
      baseUrl: resolvedBaseUrl,
    })
  }

  let created = 0
  let failed = 0

  await Promise.all(
    parsed.map(async (p) => {
      try {
        const status = await verifyKey(p.key, p.baseUrl)
        await db.insert(apiKeys).values({
          userId,
          name: p.name,
          key: encryptSecret(p.key),
          modelId: p.modelId,
          baseUrl: p.baseUrl,
          status,
          lastCheckedAt: new Date(),
        })
        created++
      } catch {
        failed++
      }
    }),
  )

  revalidateTag('api-keys', 'max')
  return { created, failed }
}

export async function deleteApiKey(id: number): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
  revalidateTag('api-keys', 'max')
  revalidatePath('/settings')
}

// ---- Group actions --------------------------------------------------------

export async function getApiKeysGrouped(): Promise<ApiKeysGrouped | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  return getApiKeysGroupedForUser(userId)
}

/** Direct version — use when userId is already known (e.g. in layout). */
export async function getApiKeysGroupedForUser(
  userId: string,
): Promise<ApiKeysGrouped> {
  const [groups, keys] = await Promise.all([
    db.select().from(apiKeyGroups).where(eq(apiKeyGroups.userId, userId)).orderBy(asc(apiKeyGroups.position)),
    db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(asc(apiKeys.position), desc(apiKeys.createdAt)),
  ])

  // Lazily migrate legacy plaintext keys
  for (const r of keys) {
    if (!isEncrypted(r.key)) {
      const encrypted = encryptSecret(r.key)
      await db.update(apiKeys).set({ key: encrypted }).where(and(eq(apiKeys.id, r.id), eq(apiKeys.userId, userId)))
      r.key = encrypted
    }
  }

  const result: ApiKeyGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    position: g.position,
    keys: keys.filter((k) => k.groupId === g.id).map(toItem),
  }))

  const ungrouped = keys.filter((k) => !k.groupId).map(toItem)

  return { groups: result, ungrouped }
}

export async function createApiKeyGroup(name: string): Promise<ApiKeyGroup | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const existing = await db.select().from(apiKeyGroups).where(eq(apiKeyGroups.userId, userId))
  const id = crypto.randomUUID()
  const [row] = await db
    .insert(apiKeyGroups)
    .values({ id, userId, name: name.trim(), position: existing.length })
    .returning()
  revalidateTag('api-keys', 'max')
  revalidatePath('/settings')
  return { id: row.id, name: row.name, position: row.position, keys: [] }
}

export async function renameApiKeyGroup(id: string, name: string): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  await db.update(apiKeyGroups).set({ name: name.trim() }).where(and(eq(apiKeyGroups.id, id), eq(apiKeyGroups.userId, userId)))
  revalidateTag('api-keys', 'max')
  revalidatePath('/settings')
}

export async function deleteApiKeyGroup(id: string): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  // Ungroup all keys in this group
  await db.update(apiKeys).set({ groupId: null }).where(and(eq(apiKeys.groupId, id), eq(apiKeys.userId, userId)))
  await db.delete(apiKeyGroups).where(and(eq(apiKeyGroups.id, id), eq(apiKeyGroups.userId, userId)))
  revalidateTag('api-keys', 'max')
  revalidatePath('/settings')
}

export async function moveApiKeyToGroup(keyId: number, targetGroupId: string | null): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  await db.update(apiKeys).set({ groupId: targetGroupId }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
  revalidateTag('api-keys', 'max')
  revalidatePath('/settings')
}

// ---- Per-key diagnostics ----------------------------------------------------

export type ApiKeyDiagCheck = {
  name: string
  status: number | null
  ok: boolean
  message: string | null
}

export type ApiKeyDiagnostics = {
  baseUrl: string
  modelId: string
  keyLength: number
  /** SHA-256 of the raw key, first 8 hex chars — compare with the key used in
   *  another IDE without ever exposing the key itself. */
  keyFingerprint: string
  checks: ApiKeyDiagCheck[]
}

async function diagFetch(
  name: string,
  url: string,
  init: RequestInit,
): Promise<ApiKeyDiagCheck> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    let message: string | null = null
    if (res.ok) {
      // Status is enough — don't wait for (possibly streaming) bodies.
      void res.body?.cancel().catch(() => {})
    } else {
      const text = await res.text().catch(() => '')
      try {
        const parsed = JSON.parse(text) as {
          error?: { message?: string } | string
          message?: string
          detail?: string
        }
        message =
          (typeof parsed.error === 'object'
            ? parsed.error?.message
            : typeof parsed.error === 'string'
              ? parsed.error
              : undefined) ??
          parsed.message ??
          parsed.detail ??
          null
      } catch {
        // Non-JSON (e.g. an HTML page) — a strong hint the base URL points at
        // a frontend, not an API.
        message = text.trimStart().startsWith('<')
          ? 'Ответ — HTML-страница, не API (проверьте Base URL)'
          : text.slice(0, 140) || null
      }
    }
    return {
      name,
      status: res.status,
      ok: res.ok,
      message: message ? message.slice(0, 140) : null,
    }
  } catch (err) {
    return {
      name,
      status: null,
      ok: false,
      message:
        err instanceof Error && err.name === 'AbortError'
          ? 'Таймаут 12с'
          : err instanceof Error
            ? err.message.slice(0, 140)
            : 'Сетевая ошибка',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run the full request matrix for ONE key — exactly the requests the app
 * makes (auth check, non-streaming completion, streaming completion) — and
 * report per-request status plus the provider's own error text. Also returns
 * the stored key's length and SHA-256 fingerprint so the user can verify the
 * stored key is byte-identical to the one that works in another IDE.
 */
export async function diagnoseApiKey(id: number): Promise<ApiKeyDiagnostics | null> {
  const userId = await getUserIdOrNull()
  if (!userId) return null
  const [row] = await db
    .select({ key: apiKeys.key, baseUrl: apiKeys.baseUrl, modelId: apiKeys.modelId })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .limit(1)
  if (!row) return null

  const rawKey = decryptSecret(row.key)
  const modelId = row.modelId || DEFAULT_MODEL_ID
  const base = normalizeBaseUrl(row.baseUrl)
  const keyLength = rawKey.length
  const keyFingerprint = createHash('sha256').update(rawKey).digest('hex').slice(0, 8)

  let safe: string
  try {
    safe = await assertSafeFetchUrl(base)
  } catch (err) {
    return {
      baseUrl: base,
      modelId,
      keyLength,
      keyFingerprint,
      checks: [
        {
          name: 'Проверка Base URL',
          status: null,
          ok: false,
          message: err instanceof Error ? err.message : 'URL отклонён',
        },
      ],
    }
  }

  const authHeaders = {
    Authorization: `Bearer ${rawKey}`,
    'Content-Type': 'application/json',
  }
  const completionBody = (stream: boolean) =>
    JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream,
    })

  const checks = await Promise.all([
    diagFetch('GET /models — авторизация ключа', `${safe}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${rawKey}` },
    }),
    diagFetch(
      'POST /chat/completions — обычный запрос (как кнопка «Проверить»)',
      `${safe}/chat/completions`,
      { method: 'POST', headers: authHeaders, body: completionBody(false) },
    ),
    diagFetch(
      'POST /chat/completions — стриминговый запрос (как чат)',
      `${safe}/chat/completions`,
      { method: 'POST', headers: authHeaders, body: completionBody(true) },
    ),
  ])

  return { baseUrl: safe, modelId, keyLength, keyFingerprint, checks }
}

/** Update ping + status after a background check */
export async function updateApiKeyPing(
  id: number,
  status: ApiKeyStatus,
  ping: number | null,
  failReason: string | null,
): Promise<void> {
  const userId = await getUserIdOrNull()
  if (!userId) return
  await db
    .update(apiKeys)
    .set({ status, ping, failReason, lastCheckedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
  revalidateTag('api-keys', 'max')
}
