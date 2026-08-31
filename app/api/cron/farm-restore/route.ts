import { NextResponse } from 'next/server'
import { restoreReadyKeys } from '@/lib/farm'

export const maxDuration = 60

// Verify this is called by Vercel Cron (or internally)
function verifyCronSecret(req: Request): boolean {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true // dev: allow without secret
  return authHeader === `Bearer ${cronSecret}`
}

/**
 * Cron: возвращает в пул готовых ключи, чей 31-дневный кулдаун истёк.
 * Вызывается по расписанию (например, раз в час) и/или вручную.
 */
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const restored = await restoreReadyKeys()
    return NextResponse.json({ ok: true, restored })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
