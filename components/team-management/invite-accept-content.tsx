'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInvite, declineInvite } from '@/app/actions/teams'
import type { InviteInfo } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import { Users, Loader2, XCircle } from 'lucide-react'
import Link from 'next/link'

export function InviteAcceptContent({
  token,
  info,
}: {
  token: string
  info: InviteInfo | null
}) {
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAccept = async () => {
    setAccepting(true)
    setError(null)
    try {
      await acceptInvite(token)
      router.push(info ? `/teams/${info.teamId}` : '/teams')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setAccepting(false)
    }
  }

  const handleDecline = async () => {
    setDeclining(true)
    try {
      await declineInvite(token)
      router.push('/teams')
    } finally {
      setDeclining(false)
    }
  }

  if (!info) {
    return (
      <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
        <div className="size-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <XCircle className="size-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Приглашение недействительно</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ссылка устарела или уже была использована.
          </p>
        </div>
        <Button variant="outline" render={<Link href="/teams" />}>
          К командам
        </Button>
      </div>
    )
  }

  const expiresDate = new Date(info.expiresAt)
  const daysLeft = Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  return (
    <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
      <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
        {info.teamIcon ? (
          <span className="text-2xl">{info.teamIcon}</span>
        ) : (
          <Users className="size-8 text-muted-foreground" />
        )}
      </div>

      <div>
        <h1 className="text-lg font-semibold">Приглашение в команду</h1>
        <p className="text-sm text-muted-foreground mt-1">
          <strong className="text-foreground">{info.invitedByName}</strong> приглашает вас в команду
        </p>
        <p className="text-xl font-semibold text-foreground mt-2">{info.teamName}</p>
        <p className="text-xs text-muted-foreground mt-2">
          Истекает через {daysLeft} {daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2 w-full">
        <Button onClick={handleAccept} disabled={accepting || declining} className="w-full">
          {accepting ? <Loader2 className="size-4 animate-spin" /> : 'Принять приглашение'}
        </Button>
        <Button
          variant="ghost"
          onClick={handleDecline}
          disabled={accepting || declining}
          className="w-full text-muted-foreground"
        >
          {declining ? <Loader2 className="size-4 animate-spin" /> : 'Отклонить'}
        </Button>
      </div>
    </div>
  )
}
