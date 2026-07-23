'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Eye, EyeOff, Check, UserRound } from 'lucide-react'
import { useLanguage } from '@/lib/language'

export function AuthForm({ mode: initialMode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const { t } = useLanguage()
  // Held in local state so toggling sign-in ↔ sign-up is instant (no navigation)
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(initialMode)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const isSignUp = mode === 'sign-up'

  // Instant mode switch — update local state + URL bar, no server round-trip
  const switchMode = useCallback(() => {
    const next = mode === 'sign-in' ? 'sign-up' : 'sign-in'
    setMode(next)
    setError(null)
    setPassword('')
    window.history.pushState(null, '', `/${next}`)
  }, [mode])

  useEffect(() => {
    setSuccess(false)
    // Warm the app shell while the user is typing credentials:
    // compiles/prefetches "/" so the post-login navigation is fast.
    router.prefetch('/')
  }, [router])

  const finish = () => {
    setSuccess(true)
    // Navigate immediately — the success checkmark stays visible while the
    // app shell streams in. No router.refresh(): "/" is a dynamic route and
    // is always rendered fresh; refreshing doubled the server work.
    router.push('/')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    let result
    if (isSignUp) {
      result = await authClient.signUp.email({
        email,
        password,
        name,
        username: username.trim().toLowerCase(),
        displayUsername: username.trim(),
      })
    } else {
      const id = identifier.trim()
      result = id.includes('@')
        ? await authClient.signIn.email({ email: id, password })
        : await authClient.signIn.username({
            username: id.toLowerCase(),
            password,
          })
    }

    setLoading(false)

    if (result.error) {
      setError(result.error.message ?? t('genericError'))
      return
    }

    finish()
  }

  const handleGuest = async () => {
    setError(null)
    setGuestLoading(true)

    try {
      // Attempt anonymous sign-in directly — the common case (no session)
      // succeeds in a single round-trip instead of signOut + signIn.
      let { data, error } = await authClient.signIn.anonymous()

      if (error || !data) {
        // A stale or already-anonymous session blocks anonymous sign-in.
        // Clear it and retry once automatically (this used to require the
        // user to click the button a second time).
        await authClient.signOut().catch(() => {})
        const retry = await authClient.signIn.anonymous()
        data = retry.data
        error = retry.error
      }

      setGuestLoading(false)

      if (error || !data) {
        setError(error?.message ?? t('genericError'))
        return
      }

      finish()
    } catch {
      setGuestLoading(false)
      setError(t('genericError'))
    }
  }

  return (
    <main className="min-h-svh bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="flex flex-col items-center mb-8">
          <div className="size-10 rounded-lg bg-foreground flex items-center justify-center mb-4 transition-transform duration-300 hover:scale-105">
            <span className="text-background font-semibold text-lg">A</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground text-balance">
            {isSignUp ? t('createAccount') : t('welcomeBack')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 text-center text-pretty">
            {isSignUp ? t('signupSubtitle') : t('signinSubtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="text-sm text-foreground">
                  {t('name')}
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  placeholder={t('namePlaceholder')}
                  className="h-10 transition-shadow duration-200 focus-visible:shadow-sm"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="username" className="text-sm text-foreground">
                  {t('username')}
                </Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="[a-zA-Z0-9_.\-]+"
                  title={t('lettersOnly')}
                  autoComplete="username"
                  placeholder="your_login"
                  className="h-10 transition-shadow duration-200 focus-visible:shadow-sm"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-sm text-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="h-10 transition-shadow duration-200 focus-visible:shadow-sm"
                />
              </div>
            </>
          )}

          {!isSignUp && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="identifier" className="text-sm text-foreground">
                {t('emailOrUsername')}
              </Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
                placeholder={t('identifierPlaceholder')}
                className="h-10 transition-shadow duration-200 focus-visible:shadow-sm"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className="text-sm text-foreground">
              {t('password')}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                className="h-10 pr-10 transition-shadow duration-200 focus-visible:shadow-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                className="absolute right-0 top-0 h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {!isSignUp && (
              <Link
                href="/forgot-password"
                className="self-end text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
              >
                {t('forgotPassword')}
              </Link>
            )}
          </div>

          {error && (
            <p
              className="text-sm text-destructive animate-in fade-in duration-300"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || guestLoading || success}
            className="group relative w-full h-10 mt-2 overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-foreground/20 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out bg-gradient-to-r from-transparent via-background/25 to-transparent"
            />
            {success ? (
              <span className="flex items-center gap-2 animate-in zoom-in duration-300">
                <Check className="size-4" aria-hidden="true" />
                {isSignUp ? t('accountCreated') : t('signedIn')}
              </span>
            ) : loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : isSignUp ? (
              t('signUp')
            ) : (
              t('signIn')
            )}
          </Button>
        </form>

        {!isSignUp && (
          <>
            <div className="flex items-center gap-3 my-5" aria-hidden="true">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t('or')}</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGuest}
              disabled={loading || guestLoading || success}
              className="group relative w-full h-10 overflow-hidden bg-transparent transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out bg-gradient-to-r from-transparent via-foreground/10 to-transparent"
              />
              {guestLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <span className="flex items-center gap-2">
                  <UserRound className="size-4" aria-hidden="true" />
                  {t('continueAsGuest')}
                </span>
              )}
            </Button>
          </>
        )}

        <p className="text-sm text-muted-foreground text-center mt-6">
          {isSignUp ? `${t('haveAccount')} ` : `${t('noAccount')} `}
          <button
            type="button"
            onClick={switchMode}
            className="text-foreground font-medium underline-offset-4 hover:underline transition-colors duration-200"
          >
            {isSignUp ? t('signIn') : t('signUp')}
          </button>
        </p>
      </div>
    </main>
  )
}
