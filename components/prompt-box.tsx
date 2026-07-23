'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { ArrowUp, Square } from 'lucide-react'
import { ProjectSwitcher } from '@/components/project-switcher'
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
import { getApiKeys } from '@/app/actions/api-keys'
import { getProjects } from '@/app/actions/projects'
import { getInstalledPlugins } from '@/app/actions/plugins'
import type { ProjectItem } from '@/app/actions/projects'
import type { InstalledPlugin } from '@/app/actions/plugins'

// Re-export types so existing imports keep working
export type { AttachedFile, PromptBoxSubmitPayload } from '@/components/prompt-box/types'
import type { AttachedFile, PromptBoxSubmitPayload, SkillId } from '@/components/prompt-box/types'

// localStorage helper — safe for SSR
function readStoredModel(): { id: string; name: string } {
  try {
    const raw = localStorage.getItem('aura-selected-model')
    if (raw) {
      const saved = JSON.parse(raw) as { id?: string; name?: string }
      if (typeof saved.id === 'string' && typeof saved.name === 'string') return { id: saved.id, name: saved.name }
    }
  } catch { /* ignore */ }
  return { id: 'aura-max', name: 'Aura Max' }
}

export function PromptBox({
  onSubmit,
  busy = false,
  onStop,
  chatId,
}: {
  onSubmit?: (payload: PromptBoxSubmitPayload) => void
  busy?: boolean
  onStop?: () => void
  chatId?: string
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
  const [generateImages, setGenerateImages] = useState(true)
  const [activeSkills, setActiveSkills] = useState<Set<SkillId>>(new Set())
  const [autoPermissions, setAutoPermissions] = useState<'ask' | 'allow-all'>(() => (prefs?.autoPermissions as 'ask' | 'allow-all') ?? 'ask')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [model, setModel] = useState<{ id: string; name: string }>(readStoredModel)
  const [newFolderName, setNewFolderName] = useState('')
  const [attachedProjectId, setAttachedProjectId] = useState<number | null>(null)

  // Dialog visibility
  const [githubOpen, setGithubOpen] = useState(false)
  const [figmaOpen, setFigmaOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // If user has API keys and current model is a built-in Aura model (no user preference stored),
  // automatically switch to the first user key as the default.
  useEffect(() => {
    if (!apiKeys || apiKeys.length === 0) return
    const firstKey = apiKeys[0]
    const firstKeyModel = { id: `api-${firstKey.id}`, name: firstKey.name }
    // Only override if still on a built-in Aura model — don't override an explicit user choice
    if (model.id.startsWith('aura-')) {
      changeModel(firstKeyModel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeys])

  // Sync autoPermissions from SWR data once loaded
  const syncedAutoPermissions = (prefs?.autoPermissions as 'ask' | 'allow-all') ?? autoPermissions

  const changeModel = (m: { id: string; name: string }) => {
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

        <div className="flex items-center gap-2 px-3 pb-3">
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

          <div className="ml-auto flex items-center gap-2">
            <ProjectSwitcher />
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                aria-label={t('stop')}
                className="size-8 flex items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90 active:scale-95 transition-all duration-200"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : value.trim() && !isRecording ? (
              <button
                type="button"
                onClick={submit}
                aria-label={t('send')}
                className="size-8 flex items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90 active:scale-95 transition-all duration-200"
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
