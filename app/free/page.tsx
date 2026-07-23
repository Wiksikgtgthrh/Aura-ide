import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import Link from 'next/link'
import { ArrowLeft, Gift, Sparkles, Image as ImageIcon, Zap } from 'lucide-react'

const perks = [
  {
    icon: Sparkles,
    title: '100 бесплатных сообщений',
    description: 'Ежедневный лимит запросов к Aura Max без подписки.',
    badge: 'Активно',
  },
  {
    icon: ImageIcon,
    title: 'Генерация изображений',
    description: 'До 20 изображений в день в бесплатном тарифе.',
    badge: 'Активно',
  },
  {
    icon: Zap,
    title: 'Базовые Skills',
    description: 'Web-поиск и интерпретатор кода доступны бесплатно.',
    badge: 'Активно',
  },
]

// Auth check streams inside Suspense — the static page shell renders
// instantly (required by cacheComponents; getSession is uncached IO).
async function AuthGate() {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')
  return null
}

export default function FreePage() {
  return (
    <main className="min-h-svh bg-background">
      <Suspense fallback={null}>
        <AuthGate />
      </Suspense>
      <div className="max-w-2xl mx-auto px-6 py-10 animate-in fade-in duration-150">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 mb-6"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <div className="flex items-center gap-2.5">
          <Gift className="size-6 text-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Халява
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1.5 mb-8">
          Всё, что доступно бесплатно на вашем тарифе.
        </p>

        <div className="flex flex-col gap-3">
          {perks.map((perk) => (
            <div
              key={perk.title}
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-shadow duration-200 hover:shadow-xs"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent shrink-0">
                <perk.icon className="size-5 text-foreground" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-foreground">
                    {perk.title}
                  </h2>
                  <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
                    {perk.badge}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground text-pretty">
                  {perk.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
