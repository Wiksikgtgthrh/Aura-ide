import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getPluginBySlug, getMarketplacePlugins } from '@/app/actions/plugins'
import { PluginDetailTabs } from '@/components/plugins/plugin-tabs'
import { cookies } from 'next/headers'
import type { LanguageCode } from '@/lib/language'

async function PluginLoader({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')

  const { slug } = await params

  const [plugin, allPlugins, cookieStore] = await Promise.all([
    getPluginBySlug(slug),
    getMarketplacePlugins(),
    cookies(),
  ])

  if (!plugin) notFound()

  const lang = (cookieStore.get('aura-language')?.value ?? 'ru') as LanguageCode

  return <PluginDetailTabs plugin={plugin} allPlugins={allPlugins} lang={lang} />
}

function PluginSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-64 rounded-md bg-muted" />
      <div className="mt-2 h-4 w-96 max-w-full rounded-md bg-muted" />
      <div className="mt-8 h-48 rounded-xl bg-muted" />
    </div>
  )
}

// Uncached data streams inside Suspense (required by cacheComponents).
export default function PluginDetailPage(props: {
  params: Promise<{ slug: string }>
}) {
  return (
    <main className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <Suspense fallback={<PluginSkeleton />}>
          <PluginLoader params={props.params} />
        </Suspense>
      </div>
    </main>
  )
}
