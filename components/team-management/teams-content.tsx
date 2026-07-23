'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { getTeams } from '@/app/actions/teams'
import type { TeamItem } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import { CreateTeamDialog } from '@/components/team-management/create-team-dialog'
import { Users, Plus, Crown, Shield, Loader2 } from 'lucide-react'

function TeamCard({ team }: { team: TeamItem }) {
  const roleLabelMap: Record<string, string> = {
    owner: 'Владелец',
    Admin: 'Администратор',
    Editor: 'Редактор',
    Viewer: 'Наблюдатель',
  }

  return (
    <Link
      href={`/teams/${team.id}`}
      className="group flex flex-col gap-3 p-4 rounded-xl border border-border bg-card hover:border-foreground/20 hover:shadow-sm transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {team.icon ? (
              <span className="text-lg">{team.icon}</span>
            ) : (
              <Users className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-sm text-foreground group-hover:text-foreground truncate">
              {team.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {team.memberCount}{' '}
              {team.memberCount === 1 ? 'участник' : team.memberCount < 5 ? 'участника' : 'участников'}
            </span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium shrink-0">
          {team.myRole === 'owner' ? (
            <Crown className="size-3" />
          ) : (
            <Shield className="size-3" />
          )}
          {roleLabelMap[team.myRole] ?? team.myRole}
        </span>
      </div>
      {team.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{team.description}</p>
      )}
    </Link>
  )
}

export function TeamsContent({ initialTeams }: { initialTeams?: TeamItem[] }) {
  const { data: teams, mutate } = useSWR('teams', () => getTeams(), {
    fallbackData: initialTeams,
    revalidateOnMount: false,
    revalidateOnFocus: false,
  })
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Команда</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Управляйте командами, участниками и доступом к проектам
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" />
          Новая команда
        </Button>
      </div>

      {!teams ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : teams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="size-14 rounded-2xl bg-muted flex items-center justify-center">
            <Users className="size-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-foreground">Нет команд</p>
            <p className="text-sm text-muted-foreground mt-1">
              Создайте команду, чтобы совместно работать с другими пользователями
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} variant="outline" className="gap-2">
            <Plus className="size-4" />
            Создать первую команду
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      )}

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => mutate()}
      />
    </div>
  )
}
