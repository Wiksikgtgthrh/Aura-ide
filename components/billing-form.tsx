'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { BillingData } from '@/app/actions/billing'
import { getBillingData, changePlan } from '@/app/actions/billing'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Copy,
  Check,
  Users,
  Gift,
  TrendingUp,
  CreditCard,
  Zap,
  Crown,
  Building2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  ArrowDownLeft,
  Lock,
} from 'lucide-react'

// ---- countUp hook --------------------------------------------------------
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])
  return value
}

// ---- Pricing plans -------------------------------------------------------

type Plan = {
  id: 'free' | 'pro' | 'team'
  name: string
  price: number
  period: string
  description: string
  icon: React.ReactNode
  color: string
  glow: string
  badge?: string
  features: { text: string; included: boolean }[]
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: '',
    description: 'Начните бесплатно — без карты',
    icon: <Zap className="size-5" />,
    color: 'border-border',
    glow: '',
    features: [
      { text: '100 сообщений в месяц', included: true },
      { text: '1 рабочее пространство', included: true },
      { text: 'Базовые плагины', included: true },
      { text: 'HTML-режим', included: true },
      { text: 'IDE-режим', included: false },
      { text: 'Приоритетные модели', included: false },
      { text: 'Хранилище 1 ГБ', included: false },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 990,
    period: '/мес',
    description: 'Полные возможности для разработчиков',
    icon: <Crown className="size-5" />,
    color: 'border-violet-500/40',
    glow: 'shadow-[0_0_40px_rgba(139,92,246,0.15)]',
    badge: 'Популярный',
    features: [
      { text: 'Безлимит сообщений', included: true },
      { text: '5 рабочих пространств', included: true },
      { text: 'Все плагины и навыки', included: true },
      { text: 'HTML + IDE режимы', included: true },
      { text: 'Приоритетные модели (GPT-4o, Claude)', included: true },
      { text: 'Хранилище 5 ГБ', included: true },
      { text: 'Командная работа', included: false },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    price: 2490,
    period: '/мес',
    description: 'Для команд и корпоративных проектов',
    icon: <Building2 className="size-5" />,
    color: 'border-amber-500/40',
    glow: 'shadow-[0_0_40px_rgba(245,158,11,0.12)]',
    features: [
      { text: 'Всё из Pro', included: true },
      { text: 'Неограниченные пространства', included: true },
      { text: 'Командная работа и роли', included: true },
      { text: 'Общие API-ключи', included: true },
      { text: 'Аналитика использования', included: true },
      { text: 'Хранилище 50 ГБ', included: true },
      { text: 'Приоритетная поддержка', included: true },
    ],
  },
]

// ---- Balance card --------------------------------------------------------

function BalanceCard({ data }: { data: BillingData }) {
  const plan = data.balance.plan
  const planMeta = PLANS.find((p) => p.id === plan) ?? PLANS[0]
  const animatedBalance = useCountUp(data.balance.balance)

  const gradients: Record<string, string> = {
    free: 'from-slate-800 via-slate-700 to-slate-900',
    pro: 'from-violet-950 via-violet-900 to-slate-900',
    team: 'from-amber-950 via-amber-900 to-slate-900',
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradients[plan]} p-6 text-white`}
      style={{ minHeight: 180 }}
    >
      {/* Decorative circles */}
      <div className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -bottom-8 -right-8 size-32 rounded-full bg-white/5" />

      <div className="relative flex flex-col gap-6">
        {/* Top row */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-white/50">
              Aura Balance
            </p>
            <p className="mt-1.5 text-4xl font-bold tracking-tight tabular-nums">
              {animatedBalance.toLocaleString('ru-RU')}
            </p>
            <p className="mt-0.5 text-sm text-white/50">токенов доступно</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium">
              {planMeta.icon}
              {planMeta.name}
            </div>
            {data.balance.planExpiresAt && (
              <p className="text-[11px] text-white/40">
                до {new Date(data.balance.planExpiresAt).toLocaleDateString('ru-RU')}
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-6">
          <div>
            <p className="text-xs text-white/40">Рефералов</p>
            <p className="mt-0.5 text-lg font-semibold">{data.referralCount}</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Заработано</p>
            <p className="mt-0.5 text-lg font-semibold">{data.totalEarned} токенов</p>
          </div>
          <div>
            <p className="text-xs text-white/40">Транзакций</p>
            <p className="mt-0.5 text-lg font-semibold">{data.transactions.length}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Referral block -------------------------------------------------------

function ReferralBlock({ data }: { data: BillingData }) {
  const [copied, setCopied] = useState(false)
  const referralUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/sign-up?ref=${data.balance.referralCode}`
    : `https://aura.app/sign-up?ref=${data.balance.referralCode}`

  function handleCopy() {
    navigator.clipboard.writeText(referralUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Реферальная программа
      </h2>
      <div className="rounded-xl border border-border bg-background p-5 flex flex-col gap-5">
        {/* Честный статус: программа ещё не начисляет бонусы */}
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-foreground">
          <span aria-hidden="true">⚠️</span>
          <p className="text-pretty">
            Реферальная программа находится в разработке: приглашения и статистика
            учитываются, но <b>бонусы пока не начисляются</b>. Когда программа
            запустится, накопленные приглашения будут засчитаны.
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: <Users className="size-4 text-muted-foreground" />, label: 'Приглашено', value: data.referralCount },
            { icon: <TrendingUp className="size-4 text-emerald-400" />, label: 'Активных', value: data.activeReferralCount },
            { icon: <Gift className="size-4 text-violet-400" />, label: 'Заработано', value: `${data.totalEarned} токенов` },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-1.5 rounded-lg bg-muted/40 p-3 text-center">
              {stat.icon}
              <p className="text-lg font-bold text-foreground">{stat.value}</p>
              <p className="text-[11px] text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Referral link */}
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Ваша реферальная ссылка</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground truncate">
              {referralUrl}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0 gap-1.5 text-xs"
              onClick={handleCopy}
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              {copied ? 'Скопировано' : 'Копировать'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            За каждого приглашённого друга вы и он получаете по <strong className="text-foreground">100 токенов</strong> после его регистрации.
          </p>
        </div>

        {/* Referral history */}
        {data.referrals.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              История рефералов
            </p>
            <div className="flex flex-col gap-1">
              {data.referrals.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="size-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                      {r.referredName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-sm text-foreground">{r.referredName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        r.bonusCredited
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {r.bonusCredited ? `+${r.bonusAmount}` : 'Ожидание'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ---- Card attach ---------------------------------------------------------

function CardAttach() {
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function formatCardNumber(v: string) {
    return v.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})/g, '$1 ').trim()
  }
  function formatExpiry(v: string) {
    const d = v.replace(/\D/g, '').slice(0, 4)
    return d.length >= 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
  }

  function handleSave() {
    if (!cardNumber.trim() || !expiry.trim() || !cvc.trim()) return
    setSaving(true)
    setTimeout(() => { setSaving(false); setSaved(true) }, 1000)
  }

  if (saved) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
        <CheckCircle2 className="size-4 text-emerald-400" />
        <p className="text-sm text-emerald-300">Карта •••• {cardNumber.replace(/\s/g, '').slice(-4)} привязана</p>
        <button onClick={() => setSaved(false)} className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors">Изменить</button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-background p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Привязать карту</p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="size-3" />
          Защищено SSL
        </div>
      </div>

      {/* Visual card preview */}
      <div className="relative h-28 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 p-4 overflow-hidden">
        <div className="pointer-events-none absolute -right-6 -top-6 size-32 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-4 -left-4 size-24 rounded-full bg-white/5" />
        <div className="relative flex flex-col h-full justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40 uppercase tracking-widest">Aura Pay</span>
            <CreditCard className="size-5 text-white/30" />
          </div>
          <div>
            <p className="font-mono text-sm text-white/80 tracking-widest">
              {cardNumber || '•••• •••• •••• ••••'}
            </p>
            <div className="flex items-end justify-between mt-1">
              <p className="text-[10px] text-white/40 uppercase">{name || 'CARD HOLDER'}</p>
              <p className="text-[10px] text-white/40">{expiry || 'MM/YY'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Номер карты</label>
          <Input
            placeholder="1234 5678 9012 3456"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            className="h-9 text-sm font-mono"
            maxLength={19}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Срок действия</label>
          <Input
            placeholder="MM/YY"
            value={expiry}
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            className="h-9 text-sm font-mono"
            maxLength={5}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">CVV</label>
          <Input
            type="password"
            placeholder="•••"
            value={cvc}
            onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="h-9 text-sm font-mono"
            maxLength={4}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Имя держателя карты</label>
          <Input
            placeholder="IVAN IVANOV"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
            className="h-9 text-sm font-mono tracking-widest"
          />
        </div>
      </div>
      <Button
        className="w-full"
        onClick={handleSave}
        disabled={saving || !cardNumber.trim() || !expiry.trim() || !cvc.trim()}
      >
        {saving ? 'Привязываем...' : 'Привязать карту'}
      </Button>
    </div>
  )
}

// ---- Plan card ------------------------------------------------------------

function PlanCard({
  plan,
  currentPlan,
  onSelect,
  pending,
}: {
  plan: Plan
  currentPlan: string
  onSelect: (id: Plan['id']) => void
  pending: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const isCurrent = plan.id === currentPlan
  const isPopular = plan.badge === 'Популярный'

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-5 transition-all duration-300 cursor-pointer select-none ${plan.color} ${
        isCurrent
          ? `bg-muted/40 ring-2 ring-offset-1 ring-offset-background ${
              plan.id === 'pro'
                ? 'ring-violet-500/50'
                : plan.id === 'team'
                ? 'ring-amber-500/50'
                : 'ring-border'
            }`
          : 'bg-background hover:bg-muted/20'
      } ${plan.glow}`}
      style={{
        transform: hovered && !isCurrent ? 'translateY(-4px)' : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !isCurrent && !pending && onSelect(plan.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(plan.id) }}
      aria-pressed={isCurrent}
    >
      {/* Popular badge — always top-right corner */}
      {plan.badge && (
        <div className="absolute top-3 right-3">
          <span className="rounded-full bg-violet-500 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-lg">
            {plan.badge}
          </span>
        </div>
      )}

      {/* Current badge — top-left, only when current */}
      {isCurrent && (
        <div className="absolute -top-3 left-4">
          <span className="rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
            Текущий
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`flex size-10 items-center justify-center rounded-xl ${
            plan.id === 'pro'
              ? 'bg-violet-500/10 text-violet-400'
              : plan.id === 'team'
              ? 'bg-amber-500/10 text-amber-400'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {plan.icon}
        </div>
        <div>
          <p className="text-base font-bold text-foreground">{plan.name}</p>
          <p className="text-[11px] text-muted-foreground">{plan.description}</p>
        </div>
      </div>

      {/* Price */}
      <div className="mb-5">
        <div className="flex items-end gap-1">
          <span className="text-3xl font-bold tracking-tight text-foreground">
            {plan.price === 0 ? 'Бесплатно' : `${plan.price.toLocaleString('ru-RU')}₽`}
          </span>
          {plan.period && (
            <span className="mb-1 text-sm text-muted-foreground">{plan.period}</span>
          )}
        </div>
      </div>

      {/* Features */}
      <ul className="flex flex-col gap-2 flex-1 mb-5">
        {plan.features.map((f) => (
          <li key={f.text} className="flex items-center gap-2 text-xs">
            {f.included ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="size-3.5 shrink-0 text-muted-foreground/30" />
            )}
            <span className={f.included ? 'text-foreground' : 'text-muted-foreground/50'}>
              {f.text}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {isCurrent ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs cursor-default text-muted-foreground"
          disabled
          onClick={(e) => e.stopPropagation()}
        >
          Текущий план
        </Button>
      ) : (
        <Button
          size="sm"
          className={`w-full text-xs transition-all duration-200 ${
            plan.id === 'pro'
              ? 'bg-violet-500 hover:bg-violet-600 text-white'
              : plan.id === 'team'
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-muted hover:bg-muted/80 text-foreground border border-border'
          }`}
          disabled={pending}
          onClick={(e) => { e.stopPropagation(); onSelect(plan.id) }}
          variant="ghost"
        >
          {plan.id === 'free' ? 'Перейти на Free' : `Перейти на ${plan.name}`}
        </Button>
      )}
    </div>
  )
}

// ---- Transaction history -------------------------------------------------

const TX_TYPE_LABELS: Record<string, string> = {
  topup: 'Пополнение',
  usage: 'Использование',
  referral_bonus: 'Бонус реферала',
  plan_purchase: 'Покупка плана',
}

function TransactionHistory({ transactions }: { transactions: BillingData['transactions'] }) {
  const [expanded, setExpanded] = useState(false)

  if (transactions.length === 0) return null

  const visible = expanded ? transactions : transactions.slice(0, 5)

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          История транзакций
        </h2>
        {transactions.length > 5 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? 'Скрыть' : `Показать все (${transactions.length})`}
          </button>
        )}
      </div>
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        {visible.map((tx, i) => (
          <div
            key={tx.id}
            className={`flex items-center gap-3 px-4 py-3 ${
              i !== visible.length - 1 ? 'border-b border-border' : ''
            }`}
          >
            <div
              className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                tx.amount > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
              }`}
            >
              {tx.amount > 0 ? (
                <ArrowDownLeft className="size-3.5 text-emerald-400" />
              ) : (
                <ArrowUpRight className="size-3.5 text-red-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {TX_TYPE_LABELS[tx.type] ?? tx.type}
              </p>
              {tx.description && (
                <p className="text-xs text-muted-foreground truncate">{tx.description}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p
                className={`text-sm font-semibold ${
                  tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString('ru-RU')}₽
              </p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(tx.createdAt).toLocaleDateString('ru-RU')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- Main component -------------------------------------------------------

export function BillingForm({ initialData }: { initialData?: BillingData }) {
  const { data: swrData, isLoading } = useSWR<BillingData>(
    'billing',
    () => getBillingData(),
    { fallbackData: initialData, revalidateOnFocus: false },
  )
  const [data, setData] = useState<BillingData | undefined>(swrData ?? initialData)
  const [pending, startTransition] = useTransition()

  // Sync when SWR first resolves
  const [synced, setSynced] = useState(!!initialData)
  if (!synced && swrData !== undefined) {
    setSynced(true)
    setData(swrData)
  }

  if (isLoading && !initialData) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  function handleSelectPlan(planId: 'free' | 'pro' | 'team') {
    setData((d) => ({
      ...d,
      balance: { ...d.balance, plan: planId },
    }))
    startTransition(async () => {
      await changePlan(planId)
    })
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Balance card */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Баланс
        </h2>
        <BalanceCard data={data} />
      </section>

      {/* Referral */}
      <ReferralBlock data={data} />

      {/* Plans */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Тарифные планы
        </h2>
        <div className="grid grid-cols-3 gap-4 pt-3">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currentPlan={data.balance.plan}
              onSelect={handleSelectPlan}
              pending={pending}
            />
          ))}
        </div>
      </section>

      {/* Payment method */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Способ оплаты
        </h2>
        <CardAttach />
      </section>

      {/* Transaction history */}
      <TransactionHistory transactions={data.transactions} />
    </div>
  )
}
