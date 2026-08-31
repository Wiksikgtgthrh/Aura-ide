'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createProject } from '@/app/actions/projects'
import { useLanguage } from '@/lib/language'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
  onBack,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  onBack?: () => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      await createProject(trimmed)
      onOpenChange(false)
      setName('')
      onCreated?.()
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setName('')
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('createBlankProject')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="project-name"
            className="text-sm font-medium text-foreground"
          >
            {t('projectNameLabel')}
          </label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') handleCreate()
            }}
            placeholder={t('createProjectPlaceholder')}
          />
          <p className="text-sm text-muted-foreground">
            {t('blankProjectHelp')}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false)
              onBack?.()
            }}
            className="sm:mr-auto"
          >
            {t('back')}
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || creating}>
            {creating && <Loader2 className="size-4 animate-spin" />}
            {t('createProjectAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
