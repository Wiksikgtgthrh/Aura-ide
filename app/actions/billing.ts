'use server'

import { db } from '@/lib/db'
import { userBalance, referrals, transactions, user, plans } from '@/lib/db/schema'
import { asc, eq, desc } from 'drizzle-orm'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { getSession } from '@/lib/session'

async function requireUserId(): Promise<string> {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type UserBalance = {
  balance: number
  plan: string
  planExpiresAt: string | null
  referralCode: string
}

export type ReferralEntry = {
  id: string
  referredName: string
  bonusAmount: number
  bonusCredited: boolean
  createdAt: string
}

export type Transaction = {
  id: string
  type: string
  amount: number
  description: string
  createdAt: string
}

export type BillingData = {
  balance: UserBalance
  referrals: ReferralEntry[]
  referralCount: number
  activeReferralCount: number
  totalEarned: number
  transactions: Transaction[]
}

// Upsert a user_balance row (one query, no sequential SELECT+INSERT)
async function upsertBalance(userId: string) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase()
  const [row] = await db
    .insert(userBalance)
    .values({ userId, balance: 0, plan: 'free', referralCode: code })
    .onConflictDoNothing()
    .returning()
  // If row was not inserted (conflict), fetch existing
  if (row) return row
  const [existing] = await db
    .select()
    .from(userBalance)
    .where(eq(userBalance.userId, userId))
    .limit(1)
  return existing
}

async function fetchBillingData(userId: string): Promise<BillingData> {
  const [balanceRow, referralRows, txRows] = await Promise.all([
    upsertBalance(userId),
    db
      .select({
        id: referrals.id,
        referredId: referrals.referredId,
        referredName: user.name,
        bonusAmount: referrals.bonusAmount,
        bonusCredited: referrals.bonusCredited,
        createdAt: referrals.createdAt,
      })
      .from(referrals)
      .leftJoin(user, eq(referrals.referredId, user.id))
      .where(eq(referrals.referrerId, userId))
      .orderBy(desc(referrals.createdAt))
      .limit(50),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(50),
  ])

  const totalEarned = referralRows
    .filter((r) => r.bonusCredited)
    .reduce((sum, r) => sum + r.bonusAmount, 0)

  return {
    balance: {
      balance: balanceRow.balance,
      plan: balanceRow.plan as UserBalance['plan'],
      planExpiresAt: balanceRow.planExpiresAt?.toISOString() ?? null,
      referralCode: balanceRow.referralCode,
    },
    referrals: referralRows.map((r) => ({
      id: r.id,
      referredName: r.referredName ?? 'Unknown',
      bonusAmount: r.bonusAmount,
      bonusCredited: r.bonusCredited,
      createdAt: r.createdAt.toISOString(),
    })),
    referralCount: referralRows.length,
    activeReferralCount: referralRows.filter((r) => r.bonusCredited).length,
    totalEarned,
    transactions: txRows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  }
}

export async function getBillingData(): Promise<BillingData> {
  const userId = await requireUserId()
  return unstable_cache(
    () => fetchBillingData(userId),
    ['billing', userId],
    { tags: ['billing'], revalidate: 120 },
  )()
}

/** Публичный список тарифов из админки (видимые, по порядку). */
export type PublicPlan = {
  key: string
  title: string
  priceRub: number
  features: string[]
  copy: string
}

export async function getVisiblePlans(): Promise<PublicPlan[] | null> {
  try {
    const rows = await db
      .select({
        key: plans.key,
        title: plans.title,
        priceRub: plans.priceRub,
        features: plans.features,
        copy: plans.copy,
        visible: plans.visible,
      })
      .from(plans)
      .orderBy(asc(plans.position))
    const visible = rows.filter((r) => r.visible)
    if (visible.length === 0) return null
    return visible.map((r) => ({
      key: r.key,
      title: r.title || r.key,
      priceRub: r.priceRub ?? 0,
      features: Array.isArray(r.features) ? (r.features as string[]).filter(Boolean) : [],
      copy: r.copy ?? '',
    }))
  } catch {
    return null // таблицы plans нет (немигрированная БД) — хардкод-фолбэк в UI
  }
}

export async function changePlan(plan: string): Promise<void> {
  const userId = await requireUserId()
  await upsertBalance(userId)

  const key = plan.trim().toLowerCase().slice(0, 40)
  // Разрешаем только реальные тарифы: из админки (plans) или базовую тройку.
  let priceRub = 0
  let title = key
  const dbPlans = await getVisiblePlans()
  if (dbPlans) {
    const found = dbPlans.find((p) => p.key === key)
    if (!found) throw new Error('Unknown plan')
    priceRub = found.priceRub
    title = found.title
  } else {
    const fallback: Record<string, { price: number; title: string }> = {
      free: { price: 0, title: 'Free' },
      pro: { price: 990, title: 'Pro' },
      team: { price: 2490, title: 'Team' },
    }
    const found = fallback[key]
    if (!found) throw new Error('Unknown plan')
    priceRub = found.price
    title = found.title
  }

  const planExpiresAt = key === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await db
    .update(userBalance)
    .set({ plan: key, planExpiresAt, updatedAt: new Date() })
    .where(eq(userBalance.userId, userId))

  // Record transaction
  if (key !== 'free' && priceRub > 0) {
    await db.insert(transactions).values({
      userId,
      type: 'plan_purchase',
      amount: -priceRub,
      description: `Подписка ${title} — 1 месяц`,
    })
  }

  revalidateTag('billing', 'max')
  revalidatePath('/settings')
}
