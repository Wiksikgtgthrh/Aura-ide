'use client'

import { useState, useTransition, useMemo } from 'react'
import type { MarketplacePlugin } from '@/app/actions/plugins'
import {
  installPlugin,
  uninstallPlugin,
  togglePlugin,
} from '@/app/actions/plugins'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  Zap,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Info,
  Code2,
  Pencil,
  Database,
  FileText,
} from 'lucide-react'

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  development: <Code2 className="size-4" />,
  design: <Pencil className="size-4" />,
  data: <Database className="size-4" />,
  documentation: <FileText className="size-4" />,
}

const CATEGORY_LABELS: Record<string, string> = {
  development: 'Разработка',
  design: 'Дизайн',
  data: 'Данные',
  documentation: 'Документация',
}

function detectCategory(skill: MarketplacePlugin): string {
  const name = (skill.name + ' ' + skill.description).toLowerCase()
  if (name.includes('design') || name.includes('дизайн') || name.includes('figma') || name.includes('ui')) return 'design'
  if (name.includes('data') || name.includes('данны') || name.includes('chart') || name.includes('sql')) return 'data'
  if (name.includes('doc') || name.includes('document') || name.includes('readme') || name.includes('markdown')) return 'documentation'
  return 'development'
}

function ActiveSkillCard({
  skill,
  onToggle,
  onUninstall,
  pending,
}: {
  skill: MarketplacePlugin
  onToggle: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
  pending: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const rules = (skill.manifest?.rules ?? []) as string[]

  return (
    <div
      className={`rounded-xl border transition-all duration-200 ${
        skill.enabled
          ? 'border-border bg-muted/20'
          : 'border-border/50 bg-muted/5 opacity-60'
      }`}
    >
      <div className="flex items-center gap-3 p-4">
        {/* Status dot */}
        <span
          className={`size-2 rounded-full shrink-0 transition-colors ${
            skill.enabled ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-muted-foreground/30'
          }`}
        />

        {/* Icon */}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Zap className="size-4 text-violet-400" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{skill.name}</p>
          <p className="text-xs text-muted-foreground line-clamp-1">{skill.description}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {rules.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {rules.length} правил
            </button>
          )}
          <Switch
            checked={skill.enabled}
            onCheckedChange={(v) => onToggle(skill.id, v)}
            disabled={pending}
            aria-label="Включить навык"
          />
          <button
            onClick={() => onUninstall(skill.id)}
            disabled={pending}
            className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Удалить навык"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded rules */}
      {expanded && rules.length > 0 && (
        <div className="border-t border-border mx-4 pb-4 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Правила инструкций
          </p>
          <ul className="flex flex-col gap-1.5">
            {rules.map((rule, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="mt-0.5 size-1.5 rounded-full bg-violet-400/60 shrink-0" />
                {rule}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SkillLibraryCard({
  skill,
  onInstall,
  pending,
}: {
  skill: MarketplacePlugin
  onInstall: (id: string) => void
  pending: boolean
}) {
  const category = detectCategory(skill)
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-4 hover:border-muted-foreground/30 hover:bg-muted/20 transition-all duration-200">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        {CATEGORY_ICONS[category] ?? <Zap className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{skill.name}</p>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {CATEGORY_LABELS[category]}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0 gap-1.5 text-xs"
        onClick={() => onInstall(skill.id)}
        disabled={pending}
      >
        <Plus className="size-3.5" />
        Добавить
      </Button>
    </div>
  )
}

export function SkillsForm({
  initialPlugins,
}: {
  initialPlugins: MarketplacePlugin[]
}) {
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>(initialPlugins)
  const [pending, startTransition] = useTransition()

  const skills = useMemo(() => plugins.filter((p) => p.type === 'skill'), [plugins])
  const activeSkills = useMemo(() => skills.filter((p) => p.isInstalled), [skills])
  const librarySkills = useMemo(() => skills.filter((p) => !p.isInstalled), [skills])

  function optimisticInstall(id: string) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isInstalled: true, enabled: true } : p))
    )
    startTransition(async () => {
      await installPlugin(id)
    })
  }

  function optimisticUninstall(id: string) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isInstalled: false, enabled: false } : p))
    )
    startTransition(async () => {
      await uninstallPlugin(id)
    })
  }

  function optimisticToggle(id: string, enabled: boolean) {
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)))
    startTransition(async () => {
      await togglePlugin(id, enabled)
    })
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
        <Info className="size-4 shrink-0 mt-0.5 text-violet-400" />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Навыки расширяют возможности Aura — каждый активный навык добавляет специализированные инструкции в системный промпт. Чем точнее навыки соответствуют вашей задаче, тем лучше результат.
        </p>
      </div>

      {/* Active skills */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Активные навыки
            {activeSkills.length > 0 && (
              <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400 normal-case tracking-normal font-medium">
                {activeSkills.length} активных
              </span>
            )}
          </h2>
        </div>

        {activeSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
            <Zap className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Нет активных навыков</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Добавьте навыки из библиотеки ниже
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeSkills.map((skill) => (
              <ActiveSkillCard
                key={skill.id}
                skill={skill}
                onToggle={optimisticToggle}
                onUninstall={optimisticUninstall}
                pending={pending}
              />
            ))}
          </div>
        )}
      </section>

      {/* Library */}
      {librarySkills.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Библиотека навыков
          </h2>
          <div className="flex flex-col gap-2">
            {librarySkills.map((skill) => (
              <SkillLibraryCard
                key={skill.id}
                skill={skill}
                onInstall={optimisticInstall}
                pending={pending}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
