'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Crown,
  FolderKanban,
  Link2,
  Loader2,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getTeamMembers,
  getTeamRoles,
  inviteByUsername,
  removeMember,
  updateMemberRole,
} from '@/app/actions/teams/members'
import { grantProjectAccess, revokeProjectAccess } from '@/app/actions/teams/api-share'
import {
  ensurePersonalTeam,
  getWorkspaceProjectShares,
  type WorkspaceProjectShare,
} from '@/app/actions/workspace'
import type { TeamMemberItem, TeamRoleItem } from '@/lib/team-types'
import { AccountAvatar } from '@/components/sidebar/account-avatar'

type FoundUser = { id: string; name: string; username: string | null; image: string | null }

/**
 * Settings → Members: REAL member management for the user's personal
 * workspace (a lazily-created team). Invite site users by @username, assign
 * roles (Admin / Editor / Viewer), and share your projects with the
 * workspace — members then open project chats with edit or read access.
 */
export function MembersForm() {
  const [teamId, setTeamId] = useState<string | null>(null)
  const [members, setMembers] = useState<TeamMemberItem[]>([])
  const [roles, setRoles] = useState<TeamRoleItem[]>([])
  const [shares, setShares] = useState<WorkspaceProjectShare[]>([])
  const [loading, setLoading] = useState(true)

  // Invite flow
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoundUser[]>([])
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async (tid: string) => {
    const [m, r, s] = await Promise.all([
      getTeamMembers(tid),
      getTeamRoles(tid),
      getWorkspaceProjectShares(tid),
    ])
    setMembers(m ?? [])
    setRoles(r ?? [])
    setShares(s)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await ensurePersonalTeam()
      if (cancelled || !res) {
        setLoading(false)
        return
      }
      setTeamId(res.teamId)
      await reload(res.teamId)
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  // Debounced user search over the site's user base
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = query.trim()
    if (q.length < 3 || !teamId) {
      setResults([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/teams/search?q=${encodeURIComponent(q)}&teamId=${teamId}`,
        )
        const data = (await res.json()) as { users?: FoundUser[] }
        setResults(data.users ?? [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [query, teamId])

  const handleInvite = async (u: FoundUser) => {
    if (!teamId || !u.username || inviting) return
    setInviting(u.id)
    setInviteError(null)
    setInviteLink(null)
    try {
      const res = await inviteByUsername(teamId, u.username)
      if (res?.token) {
        setInviteLink(`${window.location.origin}/teams/invite/${res.token}`)
        setQuery('')
        setResults([])
      }
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Не удалось пригласить')
    } finally {
      setInviting(null)
    }
  }

  const handleRoleChange = async (member: TeamMemberItem, roleId: string) => {
    if (!teamId) return
    setMembers((prev) =>
      prev.map((m) =>
        m.id === member.id
          ? { ...m, roleId, roleName: roles.find((r) => r.id === roleId)?.name ?? null }
          : m,
      ),
    )
    await updateMemberRole(teamId, member.id, roleId)
  }

  const handleRemove = async (member: TeamMemberItem) => {
    if (!teamId) return
    setMembers((prev) => prev.filter((m) => m.id !== member.id))
    await removeMember(teamId, member.id)
  }

  const handleShareChange = async (share: WorkspaceProjectShare, value: string) => {
    if (!teamId) return
    const level = value === 'none' ? null : (value as 'read' | 'edit')
    setShares((prev) =>
      prev.map((s) => (s.projectId === share.projectId ? { ...s, accessLevel: level } : s)),
    )
    if (level === null) await revokeProjectAccess(share.projectId, teamId)
    else await grantProjectAccess(share.projectId, teamId, level)
  }

  const copyInvite = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ---- Invite ---- */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <UserPlus className="size-3.5" />
          Пригласить пользователя
        </h2>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по имени или @логину…"
              className="pl-9"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {results.length > 0 && (
            <div className="mt-2 divide-y divide-border rounded-lg border border-border">
              {results.map((u) => (
                <div key={u.id} className="flex items-center gap-2.5 px-3 py-2">
                  <AccountAvatar image={u.image} name={u.name} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{u.name}</p>
                    {u.username && (
                      <p className="truncate text-xs text-muted-foreground">@{u.username}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleInvite(u)}
                    disabled={inviting !== null || !u.username}
                  >
                    {inviting === u.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      'Пригласить'
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {inviteError && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {inviteError}
            </p>
          )}

          {inviteLink && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <Link2 className="size-3.5 shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {inviteLink}
              </span>
              <button
                type="button"
                onClick={copyInvite}
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Копировать ссылку"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground text-pretty">
            Отправьте ссылку приглашённому — после принятия он появится в списке
            участников и получит доступ к проектам, которыми вы поделились ниже.
          </p>
        </div>
      </section>

      {/* ---- Members ---- */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Users className="size-3.5" />
          Участники ({members.length})
        </h2>
        <div className="rounded-xl border border-border bg-card">
          {members.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Пока нет участников — пригласите первого через поиск выше.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <AccountAvatar image={m.image} name={m.name} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                      {m.name}
                      {m.isOwner && <Crown className="size-3.5 text-amber-500" />}
                      {m.status === 'pending' && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          ожидает
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.username ? `@${m.username}` : m.email}
                    </p>
                  </div>
                  {m.isOwner ? (
                    <span className="text-xs text-muted-foreground">Владелец</span>
                  ) : (
                    <>
                      <Select
                        value={m.roleId ?? ''}
                        onValueChange={(v) => v && handleRoleChange(m, v)}
                      >
                        <SelectTrigger className="w-32" aria-label="Роль">
                          <SelectValue placeholder="Роль" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        onClick={() => handleRemove(m)}
                        className="rounded p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Удалить участника"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground text-pretty">
          Роль <b>Viewer</b> даёт только просмотр проектов, <b>Editor</b> и{' '}
          <b>Admin</b> — редактирование (если проект расшарен с уровнем
          «Редактирование»).
        </p>
      </section>

      {/* ---- Project access ---- */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <FolderKanban className="size-3.5" />
          Доступ к проектам
        </h2>
        <div className="rounded-xl border border-border bg-card">
          {shares.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              У вас пока нет проектов. Создайте проект на странице «Проекты» —
              и настройте доступ участников здесь.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {shares.map((s) => (
                <div key={s.projectId} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {s.name}
                  </span>
                  <Select
                    value={s.accessLevel ?? 'none'}
                    onValueChange={(v) => v && handleShareChange(s, v)}
                  >
                    <SelectTrigger className="w-40" aria-label="Уровень доступа">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Нет доступа</SelectItem>
                      <SelectItem value="read">Просмотр</SelectItem>
                      <SelectItem value="edit">Редактирование</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground text-pretty">
          Участники видят чаты расшаренных проектов по прямой ссылке: «Просмотр» —
          только чтение кода и превью, «Редактирование» — полноценная работа с
          ИИ и файлами.
        </p>
      </section>
    </div>
  )
}
