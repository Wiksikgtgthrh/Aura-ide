'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Check, ChevronDown, FileText, Plus, Search } from 'lucide-react'
import { createProject, getProjects } from '@/app/actions/projects'
import { useLanguage } from '@/lib/language'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

type Project = {
  id: string
  name: string
}

export function ProjectSwitcher() {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('draft')
  const [creating, setCreating] = useState(false)

  const { data: remote, mutate } = useSWR('projects', () => getProjects(), {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })

  const projects = useMemo<Project[]>(() => {
    const draft: Project = { id: 'draft', name: t('draft') }
    if (!remote) return [draft]
    return [
      draft,
      ...remote.map((p) => ({ id: String(p.id), name: p.name })),
    ]
  }, [remote, t])

  const selected =
    projects.find((p) => p.id === selectedId) ?? projects[0]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.name.toLowerCase().includes(q))
  }, [projects, query])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setOpen(false)
    setQuery('')
  }

  const handleCreate = async () => {
    if (creating) return
    const name = query.trim() || `${t('newProject')} ${projects.length}`
    setCreating(true)
    try {
      const created = await createProject(name)
      if (created) {
        await mutate()
        setSelectedId(String(created.id))
      }
      setOpen(false)
      setQuery('')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger className="flex items-center gap-1 h-8 px-2.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-200 data-[popup-open]:bg-accent data-[popup-open]:text-foreground">
        <span className="max-w-32 truncate">
          {selected?.name ?? t('project')}
        </span>
        <ChevronDown className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-64 gap-0 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchProjects')}
            aria-label={t('searchProjects')}
            className="h-9 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div
          className="max-h-52 overflow-y-auto p-1"
          role="listbox"
          aria-label={t('projects')}
        >
          {filtered.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {t('noProjectsFound')}
            </p>
          ) : (
            filtered.map((project) => (
              <button
                key={project.id}
                type="button"
                role="option"
                aria-selected={project.id === selected?.id}
                onClick={() => handleSelect(project.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent transition-colors duration-150',
                  project.id === selected?.id && 'bg-accent',
                )}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{project.name}</span>
                {project.id === selected?.id && (
                  <Check className="ml-auto size-4 shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border p-1.5">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors duration-150 disabled:opacity-50"
          >
            <Plus className="size-4" />
            {t('newProject')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
