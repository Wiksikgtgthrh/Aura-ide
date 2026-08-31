import { NextResponse } from 'next/server'
import { headers as getHeaders } from 'next/headers'
import { auth } from '@/lib/auth'
import { getSession } from '@/lib/session'
import { isLocalMode } from '@/lib/desktop-auth'

/**
 * Локальный вход без регистрации.
 *
 * Вызывается из (app)/layout.tsx, когда сессии нет: создаёт анонимную
 * сессию better-auth, проставляет Set-Cookie в ответ и редиректит в IDE.
 * Роль superadmin выдаётся хуками в lib/auth.ts автоматически.
 *
 * Вне локального режима (AURA_LOCAL_MODE=0) роут отключён.
 */
async function doLogin(request: Request): Promise<NextResponse> {
  if (!isLocalMode()) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  // Уже залогинен — просто в IDE.
  const existing = await getSession()
  if (existing?.user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const hdrs = await getHeaders()
  const res = await auth.api.signInAnonymous({
    headers: hdrs,
    asResponse: true,
  })

  const redirect = NextResponse.redirect(new URL('/', request.url))
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    // Анонимный вход ставит session-cookie — переносим его в ответ-редирект.
    for (const cookie of setCookie.split(/,(?=\s*\w+=)/)) {
      redirect.headers.append('set-cookie', cookie.trim())
    }
  }
  return redirect
}

export async function GET(request: Request) {
  return doLogin(request)
}

export async function POST(request: Request) {
  return doLogin(request)
}
