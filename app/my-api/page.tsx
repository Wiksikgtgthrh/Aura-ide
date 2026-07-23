import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getApiKeysForUser, type ApiKeyItem } from '@/app/actions/api-keys'
import { MyApiContent } from '@/components/my-api-content'

// Auth + keys load inside Suspense — the page shell renders instantly and the
// keys are handed to the client as fallbackData (no empty flash after nav).
async function MyApiLoader() {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')
  const initialKeys: ApiKeyItem[] = await getApiKeysForUser(session.user.id)
  return <MyApiContent initialKeys={initialKeys} />
}

function MyApiSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 animate-pulse">
      <div className="h-8 w-40 rounded-md bg-muted" />
      <div className="mt-2 h-4 w-72 rounded-md bg-muted" />
      <div className="mt-8 flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  )
}

export default function MyApiPage() {
  return (
    <main className="min-h-svh bg-background">
      <Suspense fallback={<MyApiSkeleton />}>
        <MyApiLoader />
      </Suspense>
    </main>
  )
}
