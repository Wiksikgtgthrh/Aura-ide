'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { ArrowUp, Loader2, MessageCircle, Square, WandSparkles } from 'lucide-react'
import { ModelSwitcher } from '@/components/model-switcher'
import { GithubIconImportDialog } from '@/components/github-import-dialog'
import { InstructionsPopover } from '@/components/instructions-popover'
import { McpDialog } from '@/components/mcp-dialog'
import { FigmaDialog } from '@/components/figma-dialog'
import { MicButton } from '@/components/prompt-box/mic-button'
import { FileChip } from '@/components/prompt-box/file-chip'
import { AddContentMenu } from '@/components/prompt-box/add-content-menu'
import { useLanguage } from '@/lib/language'
import { getPreferences } from '@/app/actions/preferences'
import { improvePrompt } from '@/app/actions/prompt-improver'
import { getApiKeys } from '@/app/actions/api-keys'
import { getProjects } from '@/app/actions/projects'
import { getInstalledPlugins } from '@/app/actions/plugins'
import type { ProjectItem } from '@/app/actions/projects'
import type { InstalledPlugin } from '@/app/actions/plugins'

// Re-export types so existing imports keep working
export type { AttachedFile, PromptBoxSubmitPayload } from '@/components/prompt-box/types'
import type { AttachedFile, PromptBoxSubmitPayload, SkillId } from '@/components/prompt-box/types'

// localStorage helper — safe for SSR. null = пользователь ещё НЕ выбирал
// модель (важно: только тогда можно автоподставить первый ключ).
function readStoredModelChoice(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem('aura-selected-model')
    if (raw) {
      const saved = JSON.parse(raw) as { id?: string; name?: string }
      if (typeof saved.id === 'string' && typeof saved.name === 'string') return { id: saved.id, name: saved.name }
    }
  } catch { /* ignore */ }
  return null
}

export function PromptBox({
  onSubmit,
  busy = false,
  onStop,
  chatId,
  planMode: planModeProp,
  onPlanModeChange,
}: {
  onSubmit?: (payload: PromptBoxSubmitPayload) => void
  busy?: boolean
  onStop?: () => void
  chatId?: string
  /** Controlled plan mode (the model can auto-exit it via <exit-plan/>). */
  planMode?: boolean
  /** Live notification when the plan-mode toggle flips (element picking etc). */
  onPlanModeChange?: (on: boolean) => void
}) {
  const { t } = useLanguage()

  // SWR-powered data fetching — cached, deduplicated, no loading flicker on re-mount
  const { data: prefs } = useSWR('preferences', getPreferences, { revalidateOnFocus: false, revalidateOnMount: false, dedupingInterval: 60_000 })
  const { data: apiKeys } = useSWR('api-keys', getApiKeys, { revalidateOnFocus: false, revalidateOnMount: false, dedupingInterval: 60_000 })
  const { data: projectList, mutate: mutateProjects } = useSWR<ProjectItem[]>('projects', () => getProjects().then((r) => r ?? []), { revalidateOnFocus: false, revalidateOnMount: false, dedupingInterval: 60_000 })
  const { data: pluginList } = useSWR<InstalledPlugin[]>('installed-plugins', () => getInstalledPlugins(), { revalidateOnFocus: false, revalidateOnMount: false, dedupingInterval: 60_000 })

  // UI state
  const [value, setValue] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  // Plan mode: the model discusses/plans instead of writing code.
  // Controlled when the parent passes planMode (chat view auto-exits it).
  const [planModeInternal, setPlanModeInternal] = useState(false)
  const planMode = planModeProp ?? planModeInternal
  const togglePlanMode = () => {
    const next = !planMode
    if (planModeProp === undefined) setPlanModeInternal(next)
    onPlanModeChange?.(next)
  }
  const [generateImages, setGenerateImages] = useState(true)
  // «Улучшить промпт»: короткий запрос разворачивается моделью в детальный бриф.
  const [improving, setImproving] = useState(false)
  const [improveError, setImproveError] = useState<string | null>(null)
  const handleImprove = async () => {
    if (improving || !value.trim()) return
    setImproving(true)
    setImproveError(null)
    try {
      const res = await improvePrompt(value)
      if (res.ok) setValue(res.text)
      else {
        setImproveError(res.error)
        setTimeout(() => setImproveError(null), 4000)
      }
    } catch {
      setImproveError('Не удалось улучшить промпт')
      setTimeout(() => setImproveError(null), 4000)
    } finally {
      setImproving(false)
    }
  }
  const [activeSkills, setActiveSkills] = useState<Set<SkillId>>(new Set())
  const [autoPermissions, setAutoPermissions] = useState<'ask' | 'allow-all'>(() => (prefs?.autoPermissions as 'ask' | 'allow-all') ?? 'ask')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  // hasModelChoice: выбирал ли пользователь модель хоть раз (localStorage).
  const hasModelChoice = useRef(false)
  const [model, setModel] = useState<{ id: string; name: string }>(() => {
    const stored = readStoredModelChoice()
    if (stored) hasModelChoice.current = true
    return stored ?? { id: 'aura-max', name: 'Aura Max' }
  })
  const [newFolderName, setNewFolderName] = useState('')
  const [attachedProjectId, setAttachedProjectId] = useState<number | null>(null)

  // Dialog visibility
  const [githubOpen, setGithubOpen] = useState(false)
  const [figmaOpen, setFigmaOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Синхронизация выбранной модели со списком ключей:
  //  1) выбранный ключ удалён → сбрасываем на первый живой ключ или Aura Max
  //     (фикс «названия прошлого ключа на главной, хотя ключей нет»);
  //  2) ключ переименован → обновляем подпись;
  //  3) автоподстановка первого ключа — ТОЛЬКО если пользователь ещё ни разу
  //     не выбирал модель (иначе явный выбор тира Aura затирался при загрузке).
  useEffect(() => {
    if (!apiKeys) return
    if (model.id.startsWith('api-')) {
      const found = apiKeys.find((k) => `api-${k.id}` === model.id)
      if (!found) {
        const first = apiKeys[0]
        changeModel(first ? { id: `api-${first.id}`, name: first.name } : { id: 'aura-max', name: 'Aura Max' })
      } else if (found.name !== model.name) {
        changeModel({ id: model.id, name: found.name })
      }
      return
    }
    if (!hasModelChoice.current && model.id.startsWith('aura-') && apiKeys.length > 0) {
      const first = apiKeys[0]
      changeModel({ id: `api-${first.id}`, name: first.name })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeys])

  // Sync autoPermissions from SWR data once loaded
  const syncedAutoPermissions = (prefs?.autoPermissions as 'ask' | 'allow-all') ?? autoPermissions

  const changeModel = (m: { id: string; name: string }) => {
    hasModelChoice.current = true
    setModel(m)
    try { localStorage.setItem('aura-selected-model', JSON.stringify(m)) } catch { /* ignore */ }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        setAttachedFiles((prev) => [...prev, { name: file.name, type: file.type, dataUrl, size: file.size }])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removeFile = (index: number) => setAttachedFiles((prev) => prev.filter((_, i) => i !== index))

  const toggleSkill = useCallback((id: SkillId) => {
    setActiveSkills((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleTranscript = useCallback((text: string) => { setValue(text) }, [])

  const insertContext = (ctx: string) => {
    setValue((prev) => (prev ? `${prev}\n\n${ctx}` : ctx))
  }

  const handleGithubInsert = (repoUrl: string) => {
    setValue((prev) => (prev ? `${prev}\n\n${repoUrl}` : repoUrl))
  }

  const submit = () => {
    const text = value.trim()
    if (!text || busy) return
    onSubmit?.({
      text,
      modelId: model.id,
      files: attachedFiles,
      generateImages,
      activeSkills: Array.from(activeSkills),
      autoPermissions: syncedAutoPermissions,
      planMode,
    })
    setValue('')
    setAttachedFiles([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      e.preventDefault()
      submit()
    }
  }

  const skillLabels = {
    'web-search': t('webSearch'),
    'code-interpreter': t('codeInterpreter'),
    'diagrams': t('diagrams'),
  } as Record<SkillId, string>

  return (
    <>
      <GithubIconImportDialog open={githubOpen} onOpenChange={setGithubOpen} onInsert={handleGithubInsert} />
      <FigmaDialog open={figmaOpen} onClose={() => setFigmaOpen(false)} onInsert={insertContext} />
      <McpDialog open={mcpOpen} onClose={() => setMcpOpen(false)} />

      <div
        ref={wrapperRef}
        className="relative w-full max-w-2xl rounded-xl border border-border bg-card shadow-xs transition-shadow duration-300 focus-within:shadow-md"
      >
        <InstructionsPopover open={instructionsOpen} onClose={() => setInstructionsOpen(false)} />

        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {attachedFiles.map((f, i) => (
              <FileChip key={i} file={f} onRemove={() => removeFile(i)} />
            ))}
          </div>
        )}

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('promptPlaceholder')}
          rows={2}
          aria-label={t('promptLabel')}
          className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        {improveError && (
          <p className="px-4 pb-1 text-xs text-destructive animate-in fade-in duration-200">
            {improveError}
          </p>
        )}

        {/* flex-nowrap + min-w-0: в узкой панели чата строка не переносится,
            имя модели обрезается, микрофон/отправка не съезжают. */}
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 px-3 pb-3">
          <AddContentMenu
            generateImages={generateImages}
            onGenerateImagesChange={setGenerateImages}
            activeSkills={activeSkills}
            onToggleSkill={toggleSkill}
            installedPlugins={pluginList ?? []}
            projects={projectList ?? []}
            onProjectsChange={(updated) => mutateProjects(updated, false)}
            attachedProjectId={attachedProjectId}
            onAttachedProjectIdChange={setAttachedProjectId}
            autoPermissions={syncedAutoPermissions}
            onAutoPermissionsChange={setAutoPermissions}
            chatId={chatId}
            newFolderName={newFolderName}
            onNewFolderNameChange={setNewFolderName}
            onOpenGithub={() => setGithubOpen(true)}
            onOpenFigma={() => setFigmaOpen(true)}
            onOpenFile={() => fileRef.current?.click()}
            onOpenInstructions={() => setInstructionsOpen(true)}
            onOpenMcp={() => setMcpOpen(true)}
            skillLabels={skillLabels}
          />

          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleFileChange}
          />

          <ModelSwitcher value={model} onChange={changeModel} />

          {/* Plan mode toggle — glows blue with a smooth transition when on */}
          <button
            type="button"
            onClick={togglePlanMode}
            aria-pressed={planMode}
            title={t('planModeHint')}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-all duration-300 active:scale-95 ${
              planMode
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-600 shadow-[0_0_14px_-2px_rgba(59,130,246,0.55)] dark:text-blue-400'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <MessageCircle
              className={`size-3.5 transition-transform duration-300 ${planMode ? 'scale-110' : ''}`}
            />
            <span className="hidden sm:inline">{t('planMode')}</span>
          </button>

          {/* Улучшить промпт: короткий запрос → детальный бриф */}
          {value.trim().length > 3 && !busy && (
            <button
              type="button"
              onClick={handleImprove}
              disabled={improving}
              title="Улучшить промпт: развернуть запрос в детальный бриф"
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-all duration-300 active:scale-95 ${
                improving
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              {improving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <WandSparkles className="size-3.5" />
              )}
              <span className="hidden lg:inline">{improving ? 'Улучшаем…' : 'Улучшить'}</span>
            </button>
          )}

          {/* «Черновик» (ProjectSwitcher) убран — не нужен и ломал строку
              в узкой панели чата (микрофон съезжал). */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                aria-label={t('stop')}
                className="size-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all duration-200"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : value.trim() && !isRecording ? (
              <button
                type="button"
                onClick={submit}
                aria-label={t('send')}
                className="size-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all duration-200"
              >
                <ArrowUp className="size-4" />
              </button>
            ) : (
              <MicButton
                onTranscript={handleTranscript}
                disabled={busy}
                onListeningChange={setIsRecording}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
