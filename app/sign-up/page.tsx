import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
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
  return (
    <>
      <AuthForm mode="sign-up" />
      <Suspense fallback={null}>
        <RedirectIfAuthed searchParams={searchParams} />
      </Suspense>
    </>
  )
}
