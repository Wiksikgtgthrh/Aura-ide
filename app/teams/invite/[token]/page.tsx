import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getSession } from '@/lib/session'
import { getInviteInfo } from '@/app/actions/teams'
import { InviteAcceptContent } from '@/components/team-management/invite-accept-content'

async function InviteLoader({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const session = await getSession()
  if (!session?.user) redirect(`/sign-in?redirect=/teams/invite/${token}`)

  const info = await getInviteInfo(token)

  return <InviteAcceptContent token={token} info={info} />
}

// Uncached data streams inside Suspense (required by cacheComponents).
export default function InviteAcceptPage(props: {
  params: Promise<{ token: string }>
}) {
  return (
    <div className="min-h-svh bg-background flex items-center justify-center px-4">
      <Suspense
        fallback={<Loader2 className="size-5 animate-spin text-muted-foreground" />}
      >
        <InviteLoader params={props.params} />
      </Suspense>
    </div>
  )
}
