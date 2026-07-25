'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  Check,
  Copy,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  UsersRound,
} from 'lucide-react'
import {
  getProjects,
  renameProject,
  deleteProject,
  type ProjectItem,
} from '@/app/actions/projects'
import {
  getChats,
  renameChat,
  deleteChat,
  duplicateChat,
  toggleFavoriteChat,
} from '@/app/actions/chats'
import { getTeams, type TeamItem } from '@/app/actions/teams/crud'
import {
  getChatTeamShares,
  shareChatWithTeam,
  revokeChatTeamShare,
  type ChatTeamShare,
} from '@/app/actions/chat-team-share'
import type { ChatListItem } from '@/lib/chat-store'
import { useLanguage } from '@/lib/language'
import dynamic from 'next/dynamic'

const CreateProjectDialog = dynamic(
  () => import('@/components/create-project-dialog').then((m) => m.CreateProjectDialog),
  { ssr: false },
)
const GithubIconImportDialog = dynamic(
  () => import('@/components/github-import-dialog').then((m) => m.GithubIconImportDialog),
  { ssr: false },
)
import { GithubLogo } from '@/components/icons/github-logo'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function useRelativeTime() {
  const { t } = useLanguage()
  return (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime()
    const hours = Math.floor(diffMs / 3_600_000)
    if (hours < 1) return t('justNow')
    if (hours < 24) return t('hoursAgo').replace('{n}', String(hours))
    return t('daysAgo').replace('{n}', String(Math.floor(hours / 24)))
  }
}

function ProjectCard({
  project,
  onMutate,
  onDeleted,
}: {
  project: ProjectItem
  onMutate: () => void
  /** Optimistically remove THIS project by id (fixes wrong-card removal). */
  onDeleted: (id: number) => void
}) {
  const { t } = useLanguage()
  const router = useRouter()
  const relativeTime = useRelativeTime()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  const [copied, setCopied] = useState(false)

  const commitRename = async () => {
    setRenaming(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === project.name) {
      setName(project.name)
      return
    }
    await renameProject(project.id, trimmed)
    onMutate()
  }

  const handleCopyId = async () => {
    await navigator.clipboard.writeText(String(project.id))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDelete = async () => {
    // Optimistic removal by id — the previous mutate()-only flow could leave
    // the wrong (bottom) card removed until revalidation settled.
    onDeleted(project.id)
    await deleteProject(project.id)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex aspect-[16/9] items-center justify-center rounded-lg border border-border bg-muted">
        <span className="select-none font-mono text-2xl font-bold tracking-tight text-muted-foreground/30">
          Aura
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
          A
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          {renaming ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setName(project.name)
                  setRenaming(false)
                }
              }}
              aria-label={t('renameProject')}
              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-sm text-foreground focus:outline-none"
            />
          ) : (
            <span className="truncate text-sm font-medium text-foreground">
              {project.name}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {relativeTime(project.createdAt)}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('projectOptions')}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className="gap-2.5" onClick={() => setRenaming(true)}>
              <Pencil className="size-4" />
              {t('renameProject')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5" onClick={handleCopyId}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? t('projectIdCopied') : t('copyProjectId')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5" onClick={() => router.push('/chats')}>
              <MessagesSquare className="size-4" />
              {t('viewAllChats')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2.5"
              variant="destructive"
              onClick={handleDelete}
            >
              <Trash2 className="size-4" />
              {t('deleteProject')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/** Диалог «Команда»: выдать командам доступ к чат-проекту с уровнем. */
function TeamShareDialog({
  chat,
  onClose,
}: {
  chat: { id: string; title: string }
  onClose: () => void
}) {
  const { data: teams } = useSWR<TeamItem[] | null>('teams', () => getTeams(), {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const [shares, setShares] = useState<ChatTeamShare[] | null>(null)
  const [busyTeam, setBusyTeam] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void getChatTeamShares(chat.id).then(setShares)
  }, [chat.id])

  const levelOf = (teamId: string) =>
    shares?.find((sh) => sh.teamId === teamId)?.accessLevel ?? 'none'

  const setLevel = async (teamId: string, level: string) => {
    setBusyTeam(teamId)
    setError('')
    try {
      if (level === 'none') {
        await revokeChatTeamShare(chat.id, teamId)
      } else {
        const res = await shareChatWithTeam(chat.id, teamId, level as 'read' | 'edit' | 'admin')
        if (!res.ok) setError(res.error ?? 'Ошибка')
      }
      setShares(await getChatTeamShares(chat.id))
    } finally {
      setBusyTeam(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <UsersRound className="size-4 text-primary" />
            Доступ команды
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground text-pretty">
          Проект «{chat.title}». Уровень доступа ограничивается ролью участника в
          команде: например, роль «Viewer» видит проект только для чтения даже при
          уровне «Редактирование».
        </p>
        {!teams ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : teams.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            У вас пока нет команд — создайте её на странице «Команда», затем
            вернитесь сюда.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {teams.map((team) => (
              <div
                key={team.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{team.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Участников: {team.memberCount}
                  </p>
                </div>
                {busyTeam === team.id && (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                )}
                <select
                  value={levelOf(team.id)}
                  disabled={busyTeam !== null}
                  onChange={(e) => void setLevel(team.id, e.target.value)}
                  className="h-8 shrink-0 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="none">Нет доступа</option>
                  <option value="read">Чтение</option>
                  <option value="edit">Редактирование</option>
                  <option value="admin">Админ</option>
                </select>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}

export function ProjectsContent({
  initialProjects,
  initialChats,
}: {
  initialProjects?: ProjectItem[]
  initialChats?: ChatListItem[]
}) {
  const { t } = useLanguage()
  const relativeTime = useRelativeTime()
  const [query, setQuery] = useState('')
  const [chooserOpen, setChooserOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const router = useRouter()
  // Действия над чат-проектами: переименование / удаление / команда
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [teamTarget, setTeamTarget] = useState<{ id: string; title: string } | null>(null)
  const [cardBusy, setCardBusy] = useState<string | null>(null)
  const commitChatRename = async () => {
    if (!renameTarget) return
    const title = renameDraft.trim()
    setRenameTarget(null)
    if (!title || title === renameTarget.title) return
    await renameChat(renameTarget.id, title)
    await mutateChats()
  }
  const commitChatDelete = async () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    await mutateChats((prev) => (prev ?? []).filter((c) => c.id !== id), { revalidate: false })
    await deleteChat(id)
    await mutateChats()
  }
  const handleDuplicate = async (id: string) => {
    if (cardBusy) return
    setCardBusy(id)
    const newId = await duplicateChat(id)
    setCardBusy(null)
    await mutateChats()
    if (newId) router.push(`/chat/${newId}`)
  }
  const handleFavorite = async (id: string, favorite: boolean) => {
    await mutateChats(
      (prev) => (prev ?? []).map((c) => (c.id === id ? { ...c, favorite } : c)),
      { revalidate: false },
    )
    await toggleFavoriteChat(id, favorite)
    await mutateChats()
  }

  const { data: projects, mutate: mutateProjects } = useSWR(
    'projects',
    () => getProjects(),
    {
      fallbackData: initialProjects,
      revalidateOnMount: false,
      revalidateOnFocus: false,
    },
  )
  const { data: chats, mutate: mutateChats } = useSWR('chats', () => getChats(), {
    fallbackData: initialChats,
    revalidateOnMount: false,
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, query])

  // Проекты пользователя = его чаты-проекты (IDE): раньше страница показывала
  // только «папки» (таблица projects) и выглядела пустой при куче проектов.
  const filteredChats = useMemo(() => {
    if (!chats) return []
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((c) => c.title.toLowerCase().includes(q))
  }, [chats, query])

  const recentChats = chats?.slice(0, 4) ?? []

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-8">
      <h1 className="text-3xl font-bold text-foreground">{t('projects')}</h1>

      {/* Search + create */}
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-center gap-2 h-10 rounded-md border border-border bg-background px-3 shadow-xs">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchProjects')}
            aria-label={t('searchProjects')}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setChooserOpen(true)}
          className="flex items-center gap-1.5 h-10 px-4 rounded-md border border-border bg-background text-sm font-medium text-foreground shadow-xs hover:bg-accent transition-colors duration-200"
        >
          <Plus className="size-4" />
          {t('project')}
        </button>
      </div>

      {/* Папки-проекты (группы) — секция видна, только когда они есть */}
      {filteredProjects.length > 0 && (
        <section
          aria-label={t('projects')}
          className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onMutate={() => mutateProjects()}
              onDeleted={(id) =>
                mutateProjects(
                  (prev) => (prev ?? []).filter((p) => p.id !== id),
                  { revalidate: true },
                )
              }
            />
          ))}
        </section>
      )}

      {/* Все проекты-чаты пользователя */}
      <section aria-label="Все проекты" className="flex flex-col gap-3">
        {filteredChats.length > 0 && filteredProjects.length > 0 && (
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Все проекты
          </h2>
        )}
        {filteredChats.length === 0 && filteredProjects.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-1">
            <p className="text-sm font-medium text-foreground">
              {t('noProjectsFound')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('blankProjectHelp')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredChats.map((chat, i) => (
              <div
                key={chat.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/chat/${chat.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(`/chat/${chat.id}`)
                }}
                className="group flex cursor-pointer flex-col gap-2.5 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-300"
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms`, animationFillMode: 'backwards' }}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                    {(chat.title || 'A').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {chat.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{relativeTime(chat.updatedAt)}</p>
                  </div>
                  {chat.favorite && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                  {cardBusy === chat.id ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label="Действия с проектом"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-52"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenuItem
                          className="gap-2.5"
                          onClick={() => {
                            setRenameDraft(chat.title)
                            setRenameTarget({ id: chat.id, title: chat.title })
                          }}
                        >
                          <Pencil className="size-4" />
                          Переименовать
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2.5"
                          onClick={() => void handleFavorite(chat.id, !chat.favorite)}
                        >
                          <Star className={`size-4 ${chat.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                          {chat.favorite ? 'Убрать из избранного' : 'В избранное'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2.5"
                          onClick={() => void handleDuplicate(chat.id)}
                        >
                          <Copy className="size-4" />
                          Дублировать
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2.5"
                          onClick={() => setTeamTarget({ id: chat.id, title: chat.title })}
                        >
                          <UsersRound className="size-4" />
                          Доступ команды…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2.5"
                          variant="destructive"
                          onClick={() => setDeleteTarget({ id: chat.id, title: chat.title })}
                        >
                          <Trash2 className="size-4" />
                          Удалить
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">{t('newProject')}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setChooserOpen(false)
                setCreateOpen(true)
              }}
              className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background p-5 text-center shadow-xs transition-colors duration-200 hover:bg-accent"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary">
                <Plus className="size-5 text-primary-foreground" />
              </span>
              <span className="text-sm font-medium text-foreground">{t('blankProject')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setChooserOpen(false)
                setGithubOpen(true)
              }}
              className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background p-5 text-center shadow-xs transition-colors duration-200 hover:bg-accent"
            >
              <GithubLogo className="size-9 text-foreground" />
              <span className="text-sm font-medium text-foreground">{t('importGithub')}</span>
            </button>
          </div>

          {recentChats.length > 0 && (
            <section aria-label={t('jumpBackIn')} className="flex flex-col gap-1 pt-2">
              <h2 className="pb-1 text-sm font-medium text-muted-foreground">{t('jumpBackIn')}</h2>
              {recentChats.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/chat/${chat.id}`}
                  onClick={() => setChooserOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-200 hover:bg-accent"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    A
                  </span>
                  <span className="flex-1 truncate text-sm text-foreground">{chat.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(chat.updatedAt)}
                  </span>
                </Link>
              ))}
            </section>
          )}
        </DialogContent>
      </Dialog>

      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onBack={() => setChooserOpen(true)}
        onCreated={() => mutateProjects()}
      />
      <GithubIconImportDialog open={githubOpen} onOpenChange={setGithubOpen} />

      {/* Переименование чат-проекта */}
      {renameTarget && (
        <Dialog open onOpenChange={(open) => !open && setRenameTarget(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Переименовать проект</DialogTitle>
            </DialogHeader>
            <input
              value={renameDraft}
              autoFocus
              maxLength={100}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitChatRename()
                if (e.key === 'Escape') setRenameTarget(null)
              }}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={!renameDraft.trim()}
                onClick={() => void commitChatRename()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Сохранить
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Удаление чат-проекта (с подтверждением) */}
      {deleteTarget && (
        <Dialog open onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">Удалить проект?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground text-pretty">
              «{deleteTarget.title}» будет удалён вместе с сообщениями, файлами и
              историей версий. Это действие необратимо.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void commitChatDelete()}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90"
              >
                Удалить
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Командный доступ к чат-проекту */}
      {teamTarget && <TeamShareDialog chat={teamTarget} onClose={() => setTeamTarget(null)} />}
    </div>
  )
}
