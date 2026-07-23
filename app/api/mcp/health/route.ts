import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { db } from '@/lib/db'
import { mcpServers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const HEALTH_TIMEOUT_MS = 5000

type HealthResult = {
  id: string
  status: 'ok' | 'error' | 'timeout'
  latencyMs: number | null
  message: string | null
}

async function checkMcpServer(
  id: string,
  url: string,
  authType: string,
  token: string | null,
): Promise<HealthResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  const start = Date.now()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (authType === 'bearer' && token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    // Try MCP initialize endpoint first (standard MCP protocol)
    const initUrl = url.replace(/\/+$/, '') + '/initialize'
    const res = await fetch(initUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'aura-health-check', version: '1.0' },
        },
      }),
      signal: controller.signal,
    })

    const latencyMs = Date.now() - start
    clearTimeout(timer)

    if (res.ok || res.status === 405) {
      // 405 Method Not Allowed still means server is reachable
      return { id, status: 'ok', latencyMs, message: null }
    }

    // Fall back to a simple GET /health
    const healthRes = await fetch(url.replace(/\/+$/, '') + '/health', {
      headers,
      signal: AbortSignal.timeout(2000),
    })
    const lat2 = Date.now() - start
    if (healthRes.ok) return { id, status: 'ok', latencyMs: lat2, message: null }

    return {
      id,
      status: 'error',
      latencyMs,
      message: `HTTP ${res.status}`,
    }
  } catch (err: unknown) {
    clearTimeout(timer)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return {
      id,
      status: isAbort ? 'timeout' : 'error',
      latencyMs: null,
      message: isAbort
        ? `Timeout ${HEALTH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message.slice(0, 100)
          : 'Неизвестная ошибка',
    }
  }
}

// POST /api/mcp/health
// Body: { serverId?: string } — checks one or all servers for the user
export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  let targetId: string | undefined
  try {
    const body = await req.json()
    targetId = typeof body.serverId === 'string' ? body.serverId : undefined
  } catch {
    // no body
  }

  const rows = await db
    .select({
      id: mcpServers.id,
      url: mcpServers.url,
      authType: mcpServers.authType,
      token: mcpServers.token,
    })
    .from(mcpServers)
    .where(
      targetId
        ? and(eq(mcpServers.id, targetId), eq(mcpServers.userId, userId))
        : eq(mcpServers.userId, userId),
    )

  const results: HealthResult[] = await Promise.all(
    rows.map((r) => checkMcpServer(r.id, r.url, r.authType, r.token)),
  )

  return NextResponse.json({ results })
}
