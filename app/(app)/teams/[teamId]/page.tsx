import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { getTeamDetail } from '@/app/actions/teams'
import { TeamDetailContent } from '@/components/team-management/team-detail-content'
import { getSession } from '@/lib/session'

async function TeamLoader({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')

  const team = await getTeamDetail(teamId)
  if (!team) notFound()

  return <TeamDetailContent team={team} currentUserId={session.user.id} />
}

function TeamSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 animate-pulse">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="mt-2 h-4 w-80 rounded-md bg-muted" />
      <div className="mt-8 flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  )
}

// Uncached data (session + team) is loaded inside Suspense so the route shell
// streams instantly (required by cacheComponents).
export default function TeamDetailPage(props: {
  params: Promise<{ teamId: string }>
}) {
  return (
    <main className="flex-1 min-w-0 overflow-y-auto">
      <Suspense fallback={<TeamSkeleton />}>
        <TeamLoader params={props.params} />
      </Suspense>
    </main>
  )
}
