'use client'

import { useState } from 'react'
import { createTeam } from '@/app/actions/teams'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated?: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const team = await createTeam(name.trim(), description.trim())
      if (team) {
        onOpenChange(false)
        setName('')
        setDescription('')
        onCreated?.()
        router.push(`/teams/${team.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания команды')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая команда</DialogTitle>
          <DialogDescription>
            Создайте команду, чтобы приглашать участников и делиться проектами и API.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="team-name" className="text-sm font-medium">Название</label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Моя команда"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') handleCreate()
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="team-desc" className="text-sm font-medium text-muted-foreground">Описание <span className="font-normal">(необязательно)</span></label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое описание команды"
              rows={3}
              maxLength={500}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
