import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getModeration } from '@/lib/admin'
import { Ban } from 'lucide-react'

/**
 * Ban screen — lives OUTSIDE the (app) group so the app layout's ban redirect
 * can't loop into it. All request-bound data access is inside Suspense
 * (required by cacheComponents).
 */
async function BannedInner() {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')
  const mod = await getModeration(session.user.id)
  if (!mod.banned) redirect('/')

  const until = mod.bannedUntil ? new Date(mod.bannedUntil) : null
  const permanent = until ? until.getFullYear() >= 9999 : true

  return (
    <div className="max-w-md text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10">
        <Ban className="size-7 text-destructive" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold text-foreground">Аккаунт заблокирован</h1>
      <p className="mt-2 text-sm text-muted-foreground text-pretty">
        {permanent
          ? 'Ваш аккаунт заблокирован без срока.'
          : `Блокировка действует до ${until?.toLocaleString('ru-RU')}.`}
      </p>
      {mod.banReason && (
        <p className="mt-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
          Причина: {mod.banReason}
        </p>
      )}
      <p className="mt-5 text-xs text-muted-foreground">
        Если считаете это ошибкой — обратитесь в поддержку.
      </p>
    </div>
  )
}

export default function BannedPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6">
      <Suspense fallback={<Ban className="size-7 animate-pulse text-muted-foreground" />}>
        <BannedInner />
      </Suspense>
    </main>
  )
}
