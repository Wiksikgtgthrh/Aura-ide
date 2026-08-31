'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { getTeamMembers, getTeamRoles, removeMember, updateMemberRole } from '@/app/actions/teams'
import type { TeamMemberItem, TeamRoleItem } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { InviteDialog } from '@/components/team-management/invite-dialog'
import { UserPlus, MoreHorizontal, Trash2, Shield, Crown, Loader2 } from 'lucide-react'

function MemberAvatar({ image, name }: { image: string | null; name: string }) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt="" className="size-8 rounded-full object-cover shrink-0" />
    )
  }
  return (
    <span className="size-8 rounded-full bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center shrink-0">
      <span className="text-background text-xs font-semibold">{name.charAt(0).toUpperCase()}</span>
    </span>
  )
}

function RoleBadge({ name, isOwner }: { name: string | null; isOwner: boolean }) {
  if (isOwner) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-medium shrink-0">
        <Crown className="size-3" />
        Владелец
      </span>
    )
  }
  if (!name) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium shrink-0">
      <Shield className="size-3" />
      {name}
    </span>
  )
}

export function MembersList({
  teamId,
  canManage,
}: {
  teamId: string
  canManage: boolean
}) {
  const { data: members, mutate: mutateMembers } = useSWR(
    `team-members-${teamId}`,
    () => getTeamMembers(teamId),
    { revalidateOnFocus: false },
  )
  const { data: roles } = useSWR(
    `team-roles-${teamId}`,
    () => getTeamRoles(teamId),
    { revalidateOnFocus: false },
  )

  const [inviteOpen, setInviteOpen] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [changingRole, setChangingRole] = useState<string | null>(null)

  const handleRemove = async (memberId: string) => {
    setRemoving(memberId)
    try {
      await removeMember(teamId, memberId)
      mutateMembers()
    } finally {
      setRemoving(null)
    }
  }

  const handleRoleChange = async (memberId: string, roleId: string | null) => {
    setChangingRole(memberId)
    try {
      await updateMemberRole(teamId, memberId, roleId)
      mutateMembers()
    } finally {
      setChangingRole(null)
    }
  }

  if (!members) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const activeMembers = members.filter((m) => m.status === 'active')
  const pendingMembers = members.filter((m) => m.status === 'pending')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Участники <span className="text-muted-foreground font-normal ml-1">{activeMembers.length}</span>
        </h3>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)} className="gap-1.5">
            <UserPlus className="size-3.5" />
            Пригласить
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {activeMembers.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            roles={roles ?? []}
            canManage={canManage && !member.isOwner}
            removing={removing === member.id}
            changingRole={changingRole === member.id}
            onRemove={() => handleRemove(member.id)}
            onRoleChange={(roleId) => handleRoleChange(member.id, roleId)}
          />
        ))}
      </div>

      {pendingMembers.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-muted-foreground mt-2">
            Ожидают принятия <span className="ml-1">{pendingMembers.length}</span>
          </h3>
          <div className="flex flex-col gap-1">
            {pendingMembers.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                roles={roles ?? []}
                canManage={canManage}
                removing={removing === member.id}
                changingRole={changingRole === member.id}
                onRemove={() => handleRemove(member.id)}
                onRoleChange={(roleId) => handleRoleChange(member.id, roleId)}
              />
            ))}
          </div>
        </>
      )}

      {activeMembers.length === 0 && pendingMembers.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          В команде пока нет участников
        </p>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} teamId={teamId} />
    </div>
  )
}

function MemberRow({
  member,
  roles,
  canManage,
  removing,
  changingRole,
  onRemove,
  onRoleChange,
}: {
  member: TeamMemberItem
  roles: TeamRoleItem[]
  canManage: boolean
  removing: boolean
  changingRole: boolean
  onRemove: () => void
  onRoleChange: (roleId: string | null) => void
}) {
  return (
    <div className="group flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted/50 transition-colors">
      <div className="relative">
        <MemberAvatar image={member.image} name={member.name} />
        {member.status === 'pending' && (
          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-amber-400 border-2 border-background" />
        )}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{member.name}</span>
        <span className="text-xs text-muted-foreground truncate">
          {member.username ? `@${member.username}` : member.email}
        </span>
      </div>
      <RoleBadge name={member.roleName} isOwner={member.isOwner} />
      {canManage && !member.isOwner && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Действия"
            className="size-7 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent hover:text-foreground"
          >
            {removing || changingRole ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-48">
            <DropdownMenuGroup>
              {roles.map((role) => (
                <DropdownMenuItem
                  key={role.id}
                  onClick={() => onRoleChange(role.id)}
                  className="gap-2.5 text-sm"
                >
                  <Shield className="size-4" />
                  {role.name}
                  {member.roleId === role.id && <span className="ml-auto text-xs text-muted-foreground">текущая</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRemove} className="gap-2.5 text-destructive">
              <Trash2 className="size-4" />
              Исключить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
