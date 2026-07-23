'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { UsageData } from '@/app/actions/usage'
import { getUsageData } from '@/app/actions/usage'
import { Loader2 } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Cpu, CalendarDays, TrendingUp, Info, DollarSign, HelpCircle } from 'lucide-react'

// ---- Stat card ------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="text-muted-foreground/40">{icon}</span>
      </div>
      <p className="text-2xl font-bold tracking-tight text-foreground">
        {typeof value === 'number' ? value.toLocaleString('ru-RU') : value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ---- Recharts custom tooltip -----------------------------------------------

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; fill: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  const date = label ? new Date(label).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''
  return (
    <div className="rounded-lg border border-border bg-background shadow-lg px-3 py-2.5 text-xs">
      <p className="font-medium text-foreground mb-1.5">{date}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full shrink-0" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name === 'promptTokens' ? 'Промпт' : 'Ответ'}:</span>
          <span className="font-semibold text-foreground ml-auto pl-3">{p.value.toLocaleString('ru-RU')}</span>
        </div>
      ))}
    </div>
  )
}

// ---- Heatmap calendar ------------------------------------------------------

function HeatmapCalendar({ dailyUsage }: { dailyUsage: UsageData['dailyUsage'] }) {
  const usageMap = new Map(dailyUsage.map((d) => [d.date, d.total]))
  const maxVal = Math.max(...Array.from(usageMap.values()), 1)

  // Build last 365 days grid
  const today = new Date()
  const days: { date: string; value: number }[] = []
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({ date: key, value: usageMap.get(key) ?? 0 })
  }

  // Group into weeks (columns)
  const weeks: typeof days[] = []
  let week: typeof days = []
  for (const day of days) {
    week.push(day)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length) weeks.push(week)

  function intensity(val: number): string {
    if (val === 0) return 'bg-muted/40'
    const pct = val / maxVal
    if (pct < 0.25) return 'bg-violet-500/25'
    if (pct < 0.5)  return 'bg-violet-500/50'
    if (pct < 0.75) return 'bg-violet-500/75'
    return 'bg-violet-500'
  }

  const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
  const weekdays = ['', 'Пн', '', 'Ср', '', 'Пт', '']

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {/* Weekday labels */}
        <div className="flex flex-col gap-[3px] mr-1 justify-end pb-0.5">
          {weekdays.map((d, i) => (
            <div key={i} className="h-[10px] text-[9px] text-muted-foreground/40 leading-none flex items-center">
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {/* Month label on first week of each month */}
            <div className="h-[12px] text-[9px] text-muted-foreground/40 leading-none">
              {wi > 0 && week[0] && new Date(week[0].date).getDate() <= 7
                ? months[new Date(week[0].date).getMonth()]
                : ''}
            </div>
            {week.map((day, di) => (
              <div
                key={di}
                title={`${day.date}: ${day.value.toLocaleString('ru-RU')} токенов`}
                className={`size-[10px] rounded-[2px] ${intensity(day.value)} transition-opacity hover:opacity-80`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Model breakdown -------------------------------------------------------

function ModelBreakdown({ models }: { models: UsageData['modelBreakdown'] }) {
  if (models.length === 0) return null

  const COLORS = [
    'bg-violet-500',
    'bg-blue-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-rose-500',
  ]

  const anyKnownCost = models.some((m) => m.costUsd !== null)

  function formatCost(usd: number | null): string {
    if (usd === null) return '—'
    if (usd < 0.001) return '<$0.001'
    return `$${usd.toFixed(4)}`
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Топ моделей
      </h2>
      <div className="rounded-xl border border-border bg-background p-4 flex flex-col gap-4">
        {models.map((m, i) => (
          <div key={m.modelId} className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs text-foreground leading-tight">{m.modelId}</span>
              <div className="flex items-center gap-3 shrink-0">
                {anyKnownCost && (
                  <span className={`text-xs font-medium ${m.costUsd !== null ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                    {formatCost(m.costUsd)}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {m.total.toLocaleString('ru-RU')} ток.
                </span>
                <span className="text-xs font-semibold text-foreground w-8 text-right">{m.percent}%</span>
              </div>
            </div>
            <div className="flex gap-1">
              <div
                className="h-1 rounded-full bg-violet-500 opacity-70"
                style={{ width: `${m.total > 0 ? (m.promptTokens / m.total) * m.percent : 0}%` }}
                title={`Промпт: ${m.promptTokens.toLocaleString('ru-RU')}`}
              />
              <div
                className={`h-1 rounded-full ${COLORS[i % COLORS.length]}`}
                style={{ width: `${m.total > 0 ? (m.completionTokens / m.total) * m.percent : 0}%` }}
                title={`Ответ: ${m.completionTokens.toLocaleString('ru-RU')}`}
              />
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
              <span>промпт: {m.promptTokens.toLocaleString('ru-RU')}</span>
              <span>ответ: {m.completionTokens.toLocaleString('ru-RU')}</span>
              {m.costUsd === null && (
                <span className="flex items-center gap-0.5">
                  <HelpCircle className="size-2.5" />
                  нет прайса
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---- Range selector --------------------------------------------------------

const RANGES = [
  { label: '7 дней', value: 7 },
  { label: '30 дней', value: 30 },
  { label: '3 месяца', value: 90 },
]

// ---- Main component --------------------------------------------------------

const EMPTY_USAGE_DATA: UsageData = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  dailyBuiltinUsed: 0,
  dailyBuiltinLimit: 100,
  totalCostUsd: null,
  totalChats: 0,
  activeDays: 0,
  avgTokensPerChat: 0,
  dailyUsage: [],
  modelBreakdown: [],
}

export function UsageForm({ initialData }: { initialData?: UsageData }) {
  const { data: swrData, isLoading } = useSWR<UsageData>(
    'usage-data',
    () => getUsageData(),
    { fallbackData: initialData ?? EMPTY_USAGE_DATA, revalidateOnFocus: false },
  )
  const data = swrData ?? initialData ?? EMPTY_USAGE_DATA
  const [range, setRange] = useState(30)

  if (isLoading && !initialData) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const chartData = data.dailyUsage.slice(-range)
  const hasData = data.totalTokens > 0

  function formatCostValue(usd: number | null): string {
    if (usd === null) return '—'
    if (usd < 0.001) return '<$0.001'
    return `$${usd.toFixed(3)}`
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Hero stats */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          За последние 30 дней
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Cpu className="size-4" />}
            label="Всего токенов"
            value={data.totalTokens}
            sub={`${data.totalPromptTokens.toLocaleString('ru-RU')} промпт + ${data.totalCompletionTokens.toLocaleString('ru-RU')} ответ`}
          />
          <StatCard
            icon={<DollarSign className="size-4" />}
            label="Примерная стоимость"
            value={formatCostValue(data.totalCostUsd)}
            sub={data.totalCostUsd !== null ? 'по известным моделям' : 'нет данных о ценах'}
          />
          <StatCard
            icon={<CalendarDays className="size-4" />}
            label="Активных дней"
            value={data.activeDays}
            sub="из 30"
          />
          <StatCard
            icon={<TrendingUp className="size-4" />}
            label="Ср. токенов на чат"
            value={data.avgTokensPerChat}
            sub={`${data.totalChats} чатов всего`}
          />
        </div>
      </section>

      {/* Daily built-in limit */}
      <section>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                Дневной лимит встроенных моделей
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                Ограничение действует только на встроенные Aura-модели. Запросы
                через ваши собственные API-ключи не лимитируются.
              </p>
            </div>
            <p className="shrink-0 text-lg font-semibold text-foreground">
              {data.dailyBuiltinUsed}
              <span className="text-sm font-normal text-muted-foreground">
                {' '}/ {data.dailyBuiltinLimit}
              </span>
            </p>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                data.dailyBuiltinUsed >= data.dailyBuiltinLimit
                  ? 'bg-destructive'
                  : 'bg-emerald-500'
              }`}
              style={{
                width: `${Math.min(100, Math.round((data.dailyBuiltinUsed / Math.max(1, data.dailyBuiltinLimit)) * 100))}%`,
              }}
            />
          </div>
        </div>
      </section>

      {/* Usage chart */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Использование по дням
          </h2>
          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  range === r.value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background p-4">
          {!hasData ? (
            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground/50">
              Данных пока нет — начните диалог с Aura
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradPrompt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCompletion" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v) => {
                    const d = new Date(v)
                    return `${d.getDate()} ${['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'][d.getMonth()]}`
                  }}
                  interval={range === 7 ? 0 : range === 30 ? 4 : 12}
                />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="promptTokens"
                  name="promptTokens"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  fill="url(#gradPrompt)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="completionTokens"
                  name="completionTokens"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  fill="url(#gradCompletion)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
          <div className="flex items-center gap-4 mt-3 justify-center">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-2 rounded-full bg-violet-500" />
              Промпт токены
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-2 rounded-full bg-cyan-500" />
              Токены ответа
            </div>
          </div>
        </div>
      </section>

      {/* Heatmap */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Активность за год
        </h2>
        <div className="rounded-xl border border-border bg-background p-4">
          <HeatmapCalendar dailyUsage={data.dailyUsage} />
          <div className="flex items-center gap-2 mt-3 justify-end">
            <span className="text-[10px] text-muted-foreground/50">Меньше</span>
            {['bg-muted/40', 'bg-violet-500/25', 'bg-violet-500/50', 'bg-violet-500/75', 'bg-violet-500'].map((c, i) => (
              <span key={i} className={`size-[10px] rounded-[2px] ${c}`} />
            ))}
            <span className="text-[10px] text-muted-foreground/50">Больше</span>
          </div>
        </div>
      </section>

      {/* Model breakdown */}
      <ModelBreakdown models={data.modelBreakdown} />
    </div>
  )
}
