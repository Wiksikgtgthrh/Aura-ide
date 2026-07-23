'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check, Eye, EyeOff, Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLanguage } from '@/lib/language'

function ResetPasswordForm() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  // better-auth appends ?token=… to the redirectTo URL from the email link
  const token = searchParams.get('token')
  const errorParam = searchParams.get('error')

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalidLink = !token || errorParam === 'INVALID_TOKEN'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || !token) return
    setError(null)
    setLoading(true)
    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (resetError) {
        setError(
          resetError.code === 'INVALID_TOKEN'
            ? t('invalidResetToken')
            : (resetError.message ?? t('genericError')),
        )
        return
      }
      setDone(true)
      setTimeout(() => router.push('/sign-in'), 1200)
    } catch {
      setError(t('genericError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-svh bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
        <div className="flex flex-col items-center mb-8">
          <div className="size-10 rounded-lg bg-foreground flex items-center justify-center mb-4">
            <span className="text-background font-semibold text-lg">A</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground text-balance">
            {t('resetTitle')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 text-center text-pretty">
            {t('resetSubtitle')}
          </p>
        </div>

        {invalidLink ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive text-pretty" role="alert">
            {t('invalidResetToken')}
          </p>
        ) : done ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
            <Check className="size-4 shrink-0 text-emerald-500" />
            {t('passwordUpdated')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password" className="text-sm text-foreground">
                {t('newPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  className="absolute right-0 top-0 h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading || password.length < 8} className="w-full h-10 mt-2">
              {loading ? <Loader2 className="size-4 animate-spin" /> : t('updatePassword')}
            </Button>
          </form>
        )}

        <p className="text-sm text-center mt-6">
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            {t('backToSignIn')}
          </Link>
        </p>
      </div>
    </main>
  )
}

// useSearchParams requires a Suspense boundary for prerender
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
