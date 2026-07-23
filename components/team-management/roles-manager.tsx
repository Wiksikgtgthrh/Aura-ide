'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { getTeamRoles, createCustomRole, updateRole, deleteRole } from '@/app/actions/teams'
import type { Permission } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Plus, Trash2, Shield, Lock, Loader2 } from 'lucide-react'

const ALL_PERMISSIONS: { key: Permission; label: string; group: string }[] = [
  { key: 'view_team', label: 'Просмотр команды', group: 'Просмотр' },
  { key: 'view_members', label: 'Просмотр участников', group: 'Просмотр' },
  { key: 'view_api', label: 'Просмотр API', group: 'Просмотр' },
  { key: 'invite_members', label: 'Приглашать участников', group: 'Участники' },
  { key: 'remove_members', label: 'Исключать участников', group: 'Участники' },
  { key: 'change_member_role', label: 'Менять роли', group: 'Участники' },
  { key: 'manage_roles', label: 'Управлять ролями', group: 'Роли' },
  { key: 'share_api_readonly', label: 'Делиться API (только модели)', group: 'API' },
  { key: 'share_api_full', label: 'Делиться API (полный доступ)', group: 'API' },
  { key: 'revoke_api', label: 'Отзывать API', group: 'API' },
  { key: 'grant_project_access', label: 'Давать доступ к проектам', group: 'Проекты' },
  { key: 'revoke_project_access', label: 'Отзывать доступ к проектам', group: 'Проекты' },
  { key: 'edit_team', label: 'Редактировать команду', group: 'Команда' },
]

const PERMISSION_GROUPS = [...new Set(ALL_PERMISSIONS.map((p) => p.group))]

function PermissionsEditor({
  permissions,
  onChange,
}: {
  permissions: Permission[]
  onChange: (perms: Permission[]) => void
}) {
  const toggle = (key: Permission) => {
    if (permissions.includes(key)) {
      onChange(permissions.filter((p) => p !== key))
    } else {
      onChange([...permissions, key])
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{group}</span>
          <div className="flex flex-col gap-1">
            {ALL_PERMISSIONS.filter((p) => p.group === group).map((perm) => (
              <label
                key={perm.key}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={permissions.includes(perm.key)}
                  onChange={() => toggle(perm.key)}
                  className="size-4 rounded border-border accent-foreground"
                />
                <span className="text-sm">{perm.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function RolesManager({
  teamId,
  canManage,
}: {
  teamId: string
  canManage: boolean
}) {
  const { data: roles, mutate } = useSWR(
    `team-roles-${teamId}`,
    () => getTeamRoles(teamId),
    { revalidateOnFocus: false },
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [roleName, setRoleName] = useState('')
  const [rolePerms, setRolePerms] = useState<Permission[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const openCreate = () => {
    setRoleName('')
    setRolePerms(['view_team', 'view_members'])
    setCreateOpen(true)
    setEditingId(null)
  }

  const openEdit = (role: { id: string; name: string; permissions: Permission[] }) => {
    setRoleName(role.name)
    setRolePerms(role.permissions)
    setEditingId(role.id)
    setCreateOpen(true)
  }

  const handleSave = async () => {
    if (!roleName.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        await updateRole(editingId, { name: roleName, permissions: rolePerms })
      } else {
        await createCustomRole(teamId, roleName, rolePerms)
      }
      mutate()
      setCreateOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (roleId: string) => {
    setDeleting(roleId)
    try {
      await deleteRole(roleId)
      mutate()
    } finally {
      setDeleting(null)
    }
  }

  if (!roles) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Роли <span className="text-muted-foreground font-normal ml-1">{roles.length}</span>
        </h3>
        {canManage && (
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
            <Plus className="size-3.5" />
            Новая роль
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {roles.map((role) => (
          <div
            key={role.id}
            className="group flex items-start gap-3 px-3 py-2.5 rounded-md border border-border hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {role.isBuiltIn ? (
                <Lock className="size-4 text-muted-foreground shrink-0" />
              ) : (
                <Shield className="size-4 text-muted-foreground shrink-0" />
              )}
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium">{role.name}</span>
                <span className="text-xs text-muted-foreground">
                  {role.permissions.length} {role.permissions.length === 1 ? 'право' : role.permissions.length < 5 ? 'права' : 'прав'}
                  {role.isBuiltIn && ' · встроенная'}
                </span>
              </div>
            </div>
            {canManage && !role.isBuiltIn && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <Button size="sm" variant="ghost" onClick={() => openEdit(role)} className="h-7 px-2 text-xs">
                  Изменить
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(role.id)}
                  disabled={deleting === role.id}
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  aria-label="Удалить роль"
                >
                  {deleting === role.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Изменить роль' : 'Новая роль'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="role-name" className="text-sm font-medium">Название</label>
              <Input
                id="role-name"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="Например: Разработчик"
                maxLength={50}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Права</span>
              <div className="max-h-72 overflow-y-auto -mx-1 px-1">
                <PermissionsEditor permissions={rolePerms} onChange={setRolePerms} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={handleSave} disabled={saving || !roleName.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : (editingId ? 'Сохранить' : 'Создать')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
