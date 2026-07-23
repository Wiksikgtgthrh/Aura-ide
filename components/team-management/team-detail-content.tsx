'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { deleteTeam, updateTeam } from '@/app/actions/teams'
import type { TeamItem } from '@/app/actions/teams'
import { MembersList } from '@/components/team-management/members-list'
import { RolesManager } from '@/components/team-management/roles-manager'
import { ApiShareManager } from '@/components/team-management/api-share'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Users,
  Shield,
  KeyRound,
  ChevronLeft,
  Settings,
  Trash2,
  Loader2,
  Crown,
} from 'lucide-react'

type Tab = 'members' | 'roles' | 'api' | 'settings'

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'members', label: 'Участники', icon: Users },
  { key: 'roles', label: 'Роли', icon: Shield },
  { key: 'api', label: 'API', icon: KeyRound },
  { key: 'settings', label: 'Настройки', icon: Settings },
]

export function TeamDetailContent({
  team,
  currentUserId,
}: {
  team: TeamItem
  currentUserId: string
}) {
  const [tab, setTab] = useState<Tab>('members')
  const isOwner = team.ownerId === currentUserId

  // Derive permissions from role name (simplified — owner has all)
  const canManageMembers = isOwner || ['owner', 'Admin'].includes(team.myRole)
  const canManageRoles = isOwner || ['owner', 'Admin'].includes(team.myRole)
  const canShareApi = isOwner || ['owner', 'Admin', 'Editor'].includes(team.myRole)
  const canRevokeApi = isOwner || ['owner', 'Admin'].includes(team.myRole)
  const canEditTeam = isOwner || ['owner', 'Admin'].includes(team.myRole)

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        <Link
          href="/teams"
          className="mt-0.5 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Назад к командам"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="size-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
            {team.icon ? (
              <span className="text-xl">{team.icon}</span>
            ) : (
              <Users className="size-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground truncate">{team.name}</h1>
              {isOwner && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-medium shrink-0">
                  <Crown className="size-3" />
                  Владелец
                </span>
              )}
            </div>
            {team.description && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{team.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {team.memberCount}{' '}
              {team.memberCount === 1 ? 'участник' : team.memberCount < 5 ? 'участника' : 'участников'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border mb-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
              tab === key
                ? 'text-foreground border-foreground'
                : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {tab === 'members' && (
          <MembersList teamId={team.id} canManage={canManageMembers} />
        )}
        {tab === 'roles' && (
          <RolesManager teamId={team.id} canManage={canManageRoles} />
        )}
        {tab === 'api' && (
          <ApiShareManager
            teamId={team.id}
            canShare={canShareApi}
            canRevoke={canRevokeApi}
          />
        )}
        {tab === 'settings' && canEditTeam && (
          <TeamSettings team={team} isOwner={isOwner} />
        )}
        {tab === 'settings' && !canEditTeam && (
          <p className="text-sm text-muted-foreground">Нет доступа к настройкам</p>
        )}
      </div>
    </div>
  )
}

function TeamSettings({ team, isOwner }: { team: TeamItem; isOwner: boolean }) {
  const router = useRouter()
  const [name, setName] = useState(team.name)
  const [description, setDescription] = useState(team.description)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState('')

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTeam(team.id, { name, description })
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteTeam(team.id)
      router.push('/teams')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-medium">Основное</h3>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-name" className="text-sm font-medium">Название</label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-desc" className="text-sm text-muted-foreground">Описание</label>
            <Textarea
              id="edit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
          <Button onClick={handleSave} disabled={saving || !name.trim()} className="self-start">
            {saving ? <Loader2 className="size-4 animate-spin" /> : 'Сохранить'}
          </Button>
        </div>
      </div>

      {isOwner && (
        <div className="flex flex-col gap-3 pt-4 border-t border-border">
          <div>
            <h3 className="text-sm font-medium text-destructive">Опасная зона</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Удаление команды необратимо. Все данные команды будут удалены.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            className="self-start gap-2 text-destructive border-destructive/30 hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="size-4" />
            Удалить команду
          </Button>
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить команду</DialogTitle>
            <DialogDescription>
              Это действие необратимо. Введите название команды <strong>{team.name}</strong> для подтверждения.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={team.name}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Отмена</Button>
            <Button
              variant="destructive"
              disabled={confirmName !== team.name || deleting}
              onClick={handleDelete}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : 'Удалить навсегда'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
