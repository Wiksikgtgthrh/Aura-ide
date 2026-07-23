'use client'

import { memo, useTransition } from 'react'
import {
  Plus,
  GitBranch,
  Frame,
  UploadCloud,
  Image as ImageIcon,
  Zap,
  Folder,
  BookOpen,
  Waypoints,
  ShieldCheck,
  Check,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLanguage } from '@/lib/language'
import { savePreferences } from '@/app/actions/preferences'
import { createProject, type ProjectItem } from '@/app/actions/projects'
import { attachChatToProject } from '@/app/actions/chats'
import type { InstalledPlugin } from '@/app/actions/plugins'
import { SKILL_IDS, type SkillId } from './types'

interface AddContentMenuProps {
  generateImages: boolean
  onGenerateImagesChange: (v: boolean) => void
  activeSkills: Set<SkillId>
  onToggleSkill: (id: SkillId) => void
  installedPlugins: InstalledPlugin[]
  projects: ProjectItem[]
  onProjectsChange: (projects: ProjectItem[]) => void
  attachedProjectId: number | null
  onAttachedProjectIdChange: (id: number | null) => void
  autoPermissions: 'ask' | 'allow-all'
  onAutoPermissionsChange: (v: 'ask' | 'allow-all') => void
  chatId?: string
  newFolderName: string
  onNewFolderNameChange: (v: string) => void
  onOpenGithub: () => void
  onOpenFigma: () => void
  onOpenFile: () => void
  onOpenInstructions: () => void
  onOpenMcp: () => void
  skillLabels: Record<SkillId, string>
}

export const AddContentMenu = memo(function AddContentMenu({
  generateImages,
  onGenerateImagesChange,
  activeSkills,
  onToggleSkill,
  installedPlugins,
  projects,
  onProjectsChange,
  attachedProjectId,
  onAttachedProjectIdChange,
  autoPermissions,
  onAutoPermissionsChange,
  chatId,
  newFolderName,
  onNewFolderNameChange,
  onOpenGithub,
  onOpenFigma,
  onOpenFile,
  onOpenInstructions,
  onOpenMcp,
  skillLabels,
}: AddContentMenuProps) {
  const { t } = useLanguage()
  const [, startTransition] = useTransition()

  const handleAttachProject = (projectId: number) => {
    onAttachedProjectIdChange(projectId)
    if (chatId) {
      startTransition(async () => { await attachChatToProject(chatId, projectId) })
    }
  }

  const handleCreateFolder = () => {
    const name = newFolderName.trim()
    if (!name) return
    startTransition(async () => {
      const created = await createProject(name)
      if (created) {
        onProjectsChange([created, ...projects])
        onAttachedProjectIdChange(created.id)
        if (chatId) await attachChatToProject(chatId, created.id)
      }
      onNewFolderNameChange('')
    })
  }

  const handleAutoPermissions = (value: 'ask' | 'allow-all') => {
    onAutoPermissionsChange(value)
    startTransition(async () => { await savePreferences({ autoPermissions: value }) })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('addContent')}
        className="size-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors duration-200 data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <Plus className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64 animate-in fade-in slide-in-from-bottom-2 duration-200">

        <DropdownMenuGroup>
          <DropdownMenuItem className="gap-2.5" onClick={onOpenGithub}>
            <GitBranch className="size-4" />
            {t('importGithub')}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onClick={onOpenFigma}>
            <Frame className="size-4" />
            {t('createFigma')}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onClick={onOpenFile}>
            <UploadCloud className="size-4" />
            {t('uploadComputer')}
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {/* Generate Images toggle */}
          <DropdownMenuItem
            className="gap-2.5"
            closeOnClick={false}
            onClick={(e) => { e.preventDefault(); onGenerateImagesChange(!generateImages) }}
          >
            <ImageIcon className="size-4" />
            {t('generateImages')}
            <Switch
              checked={generateImages}
              onCheckedChange={onGenerateImagesChange}
              onClick={(e) => e.stopPropagation()}
              className="ml-auto"
              aria-label={t('toggleImages')}
            />
          </DropdownMenuItem>

          {/* Plugins & Skills */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <Zap className="size-4" />
              {t('skills')}
              {activeSkills.size > 0 && (
                <span className="ml-auto flex size-4 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
                  {activeSkills.size}
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {installedPlugins.length > 0 && (
                <>
                  {installedPlugins.map((plugin) => (
                    <DropdownMenuItem
                      key={plugin.id}
                      closeOnClick={false}
                      onClick={() => onToggleSkill(plugin.slug as SkillId)}
                      className="gap-2.5"
                    >
                      {activeSkills.has(plugin.slug as SkillId)
                        ? <Check className="size-3.5 text-foreground" />
                        : <span className="size-3.5" />}
                      <span className="truncate">{plugin.name}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              {SKILL_IDS.map((id) => (
                <DropdownMenuItem
                  key={id}
                  closeOnClick={false}
                  onClick={() => onToggleSkill(id)}
                  className="gap-2.5"
                >
                  {activeSkills.has(id)
                    ? <Check className="size-3.5 text-foreground" />
                    : <span className="size-3.5" />}
                  {skillLabels[id]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Folder */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <Folder className="size-4" />
              {t('folder')}
              {attachedProjectId !== null && (
                <span className="ml-auto flex size-4 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
                  <Check className="size-2.5" />
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <input
                  value={newFolderName}
                  onChange={(e) => onNewFolderNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    if (e.key === 'Enter') { e.preventDefault(); handleCreateFolder() }
                  }}
                  placeholder={t('createProjectPlaceholder')}
                  className="h-7 flex-1 min-w-0 rounded-md border border-border bg-muted/40 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim()}
                  className="size-7 flex items-center justify-center rounded-md bg-foreground text-background hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
                  aria-label={t('create')}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              {projects.length > 0 && <DropdownMenuSeparator />}
              {projects.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  closeOnClick={false}
                  onClick={() => handleAttachProject(p.id)}
                  className="gap-2.5"
                >
                  {attachedProjectId === p.id
                    ? <Check className="size-3.5 text-foreground" />
                    : <Folder className="size-3.5 text-muted-foreground" />}
                  <span className="truncate">{p.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Instructions */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <BookOpen className="size-4" />
              {t('instructions')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={onOpenInstructions}>
                {t('editInstructions')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => startTransition(async () => { await savePreferences({ customInstructions: '' }) })}
              >
                {t('resetDefault')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* MCP */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <Waypoints className="size-4" />
              {t('mcps')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={onOpenMcp}>{t('manageMcps')}</DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenMcp}>{t('addServer')}</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Auto Permissions */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2.5">
              <ShieldCheck className="size-4" />
              {t('autoPermissions')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => handleAutoPermissions('ask')}
                className="gap-2.5"
              >
                {autoPermissions === 'ask' ? <Check className="size-3.5" /> : <span className="size-3.5" />}
                {t('askEveryTime')}
              </DropdownMenuItem>
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => handleAutoPermissions('allow-all')}
                className="gap-2.5"
              >
                {autoPermissions === 'allow-all' ? <Check className="size-3.5" /> : <span className="size-3.5" />}
                {t('allowAll')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
