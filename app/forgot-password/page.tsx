'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLanguage } from '@/lib/language'

export default function ForgotPasswordPage() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: '/reset-password',
      })
      // Always report success — do not leak which emails are registered.
      setSent(true)
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
            {t('forgotTitle')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 text-center text-pretty">
            {t('forgotSubtitle')}
          </p>
        </div>

        {sent ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
            <Check className="size-4 shrink-0 text-emerald-500 mt-0.5" />
            {t('resetLinkSent')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                className="h-10"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading || !email.trim()} className="w-full h-10 mt-2">
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                t('sendResetLink')
              )}
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
