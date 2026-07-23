import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiKeys } from '@/lib/db/schema'
import { decryptSecret, isEncrypted } from '@/lib/crypto'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/session'

const PING_TIMEOUT_MS = 1500
const HIGH_PING_THRESHOLD_MS = 1000

type CheckResult = {
  id: number
  status: 'active' | 'error' | 'timeout'
  ping: number | null
  failReason: string | null
}

async function pingKey(id: number, rawKey: string, baseUrl: string, modelId: string): Promise<CheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  const start = Date.now()

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rawKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: '.' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    })

    const ping = Date.now() - start
    clearTimeout(timer)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        id,
        status: 'error',
        ping: null,
        failReason: `HTTP ${res.status}: ${body.slice(0, 120)}`,
      }
    }

    const highPingWarning = ping > HIGH_PING_THRESHOLD_MS ? ' (высокий пинг)' : ''
    return { id, status: 'active', ping, failReason: highPingWarning || null }
  } catch (err: unknown) {
    clearTimeout(timer)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      id,
      status: isAbort ? 'timeout' : 'error',
      ping: null,
      failReason: isAbort
        ? `Timeout ${PING_TIMEOUT_MS}ms — ключ деактивирован`
        : err instanceof Error ? err.message.slice(0, 120) : 'Неизвестная ошибка',
    }
  }
}

// POST /api/check-keys
// Body: { keyId?: number } — если не передан, проверяет все ключи пользователя
export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let targetId: number | undefined
  try {
    const body = await req.json()
    targetId = typeof body.keyId === 'number' ? body.keyId : undefined
  } catch {
    // no body — check all
  }

  const rows = await db
    .select({
      id: apiKeys.id,
      key: apiKeys.key,
      baseUrl: apiKeys.baseUrl,
      modelId: apiKeys.modelId,
    })
    .from(apiKeys)
    .where(
      targetId !== undefined
        ? eq(apiKeys.id, targetId)
        : eq(apiKeys.userId, userId),
    )

  const results: CheckResult[] = await Promise.all(
    rows.map((r) => {
      const rawKey = isEncrypted(r.key) ? decryptSecret(r.key) : r.key
      return pingKey(r.id, rawKey, r.baseUrl, r.modelId)
    }),
  )

  // Persist results
  await Promise.all(
    results.map((res) =>
      db
        .update(apiKeys)
        .set({
          status: res.status,
          ping: res.ping,
          failReason: res.failReason,
          lastCheckedAt: new Date(),
        })
        .where(eq(apiKeys.id, res.id)),
    ),
  )

  return NextResponse.json({ results })
}
