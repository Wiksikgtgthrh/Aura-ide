import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { isLocalMode } from '@/lib/desktop-auth'
import { AuthForm } from '@/components/auth-form'

/**
 * Session check runs INSIDE Suspense so the form paints immediately —
 * the DB round-trip no longer blocks first paint of the auth screen.
 * If a session exists, redirect() streams a client-side redirect.
 */
async function RedirectIfAuthed({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>
}) {
  const { add } = await searchParams
  // When adding another account (multi-session), skip the redirect
  if (add !== '1') {
    const session = await getSession()
    if (session?.user) redirect('/')
  }
  return null
}

export default function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>
}) {
  // Локальный режим: регистрация скрыта — все сразу попадают в IDE
  // под локальным админом (авто-логин через /api/local-login).
  if (isLocalMode()) redirect('/')
  return (
    <>
      <AuthForm mode="sign-up" />
      <Suspense fallback={null}>
        <RedirectIfAuthed searchParams={searchParams} />
      </Suspense>
    </>
  )
}
