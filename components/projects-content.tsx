'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  Check,
  Copy,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import {
  getProjects,
  renameProject,
  deleteProject,
  type ProjectItem,
} from '@/app/actions/projects'
import { getChats } from '@/app/actions/chats'
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
}: {
  project: ProjectItem
  onMutate: () => void
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
    await deleteProject(project.id)
    onMutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex aspect-[16/9] items-center justify-center rounded-lg border border-border bg-muted">
        <span className="select-none font-mono text-2xl font-bold tracking-tight text-muted-foreground/30">
          Aura
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold">
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

  const { data: projects, mutate: mutateProjects } = useSWR(
    'projects',
    () => getProjects(),
    {
      fallbackData: initialProjects,
      revalidateOnMount: false,
      revalidateOnFocus: false,
    },
  )
  const { data: chats } = useSWR('chats', () => getChats(), {
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

      {/* Projects grid */}
      <section
        aria-label={t('projects')}
        className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3"
      >
        {projects && filteredProjects.length === 0 ? (
          <div className="col-span-full py-16 flex flex-col items-center gap-1">
            <p className="text-sm font-medium text-foreground">
              {t('noProjectsFound')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('blankProjectHelp')}
            </p>
          </div>
        ) : (
          filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onMutate={() => mutateProjects()}
            />
          ))
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
              <span className="flex size-9 items-center justify-center rounded-full bg-foreground">
                <Plus className="size-5 text-background" />
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
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">
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
    </div>
  )
}
