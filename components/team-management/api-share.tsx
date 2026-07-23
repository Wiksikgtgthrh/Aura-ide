'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { getSharedApis, shareApiWithTeam, revokeApiShare, updateApiShareLevel } from '@/app/actions/teams'
import { getApiKeys } from '@/app/actions/api-keys'
import type { TeamApiShareItem } from '@/app/actions/teams'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { KeyRound, Plus, Trash2, Eye, EyeOff, ChevronDown, Loader2 } from 'lucide-react'

function AccessBadge({ level }: { level: string }) {
  if (level === 'full') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 text-xs font-medium">
        <Eye className="size-3" />
        Полный
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
      <EyeOff className="size-3" />
      Только модели
    </span>
  )
}

export function ApiShareManager({
  teamId,
  canShare,
  canRevoke,
}: {
  teamId: string
  canShare: boolean
  canRevoke: boolean
}) {
  const { data: shared, mutate } = useSWR(
    `team-api-shares-${teamId}`,
    () => getSharedApis(teamId),
    { revalidateOnFocus: false },
  )

  const [addOpen, setAddOpen] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)

  const handleRevoke = async (shareId: string) => {
    setRevoking(shareId)
    try {
      await revokeApiShare(shareId)
      mutate()
    } finally {
      setRevoking(null)
    }
  }

  const handleUpdateLevel = async (shareId: string, level: 'readonly' | 'full') => {
    setUpdating(shareId)
    try {
      await updateApiShareLevel(shareId, level)
      mutate()
    } finally {
      setUpdating(null)
    }
  }

  if (!shared) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          Общие API <span className="text-muted-foreground font-normal ml-1">{shared.length}</span>
        </h3>
        {canShare && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1.5">
            <Plus className="size-3.5" />
            Поделиться
          </Button>
        )}
      </div>

      {shared.length === 0 ? (
        <div className="text-center py-8 flex flex-col items-center gap-2">
          <KeyRound className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Нет общих API</p>
          {canShare && (
            <p className="text-xs text-muted-foreground">
              Поделитесь своими API-ключами с командой.<br />
              Выберите уровень доступа — только модели или полный доступ.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {shared.map((item) => (
            <ShareRow
              key={item.id}
              item={item}
              canRevoke={canRevoke}
              canShare={canShare}
              revoking={revoking === item.id}
              updating={updating === item.id}
              onRevoke={() => handleRevoke(item.id)}
              onUpdateLevel={(level) => handleUpdateLevel(item.id, level)}
            />
          ))}
        </div>
      )}

      <AddApiShareDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        teamId={teamId}
        onDone={() => mutate()}
      />
    </div>
  )
}

function ShareRow({
  item,
  canRevoke,
  canShare,
  revoking,
  updating,
  onRevoke,
  onUpdateLevel,
}: {
  item: TeamApiShareItem
  canRevoke: boolean
  canShare: boolean
  revoking: boolean
  updating: boolean
  onRevoke: () => void
  onUpdateLevel: (level: 'readonly' | 'full') => void
}) {
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:bg-muted/30 transition-colors">
      <KeyRound className="size-4 text-muted-foreground shrink-0" />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{item.keyName}</span>
        <span className="text-xs text-muted-foreground">{item.modelId}</span>
        {item.accessLevel === 'full' && item.baseUrl && (
          <span className="text-xs text-muted-foreground">{item.baseUrl}</span>
        )}
      </div>
      <AccessBadge level={item.accessLevel} />
      {canShare && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Уровень доступа"
            disabled={updating}
            className="size-7 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent hover:text-foreground"
          >
            {updating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onUpdateLevel('readonly')} className="gap-2.5 text-sm">
                <EyeOff className="size-4" />
                Только модели
                {item.accessLevel === 'readonly' && <span className="ml-auto text-xs text-muted-foreground">текущий</span>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateLevel('full')} className="gap-2.5 text-sm">
                <Eye className="size-4" />
                Полный доступ
                {item.accessLevel === 'full' && <span className="ml-auto text-xs text-muted-foreground">текущий</span>}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canRevoke && (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onRevoke}
          disabled={revoking}
          aria-label="Отозвать"
          className="text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {revoking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      )}
    </div>
  )
}

function AddApiShareDialog({
  open,
  onOpenChange,
  teamId,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  teamId: string
  onDone: () => void
}) {
  const { data: myKeys } = useSWR('api-keys', getApiKeys, { revalidateOnFocus: false })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [accessLevel, setAccessLevel] = useState<'readonly' | 'full'>('readonly')
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleShare = async () => {
    if (!selectedId) return
    setSharing(true)
    setError(null)
    try {
      await shareApiWithTeam(selectedId, teamId, accessLevel)
      onDone()
      onOpenChange(false)
      setSelectedId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setSharing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Поделиться API с командой</DialogTitle>
          <DialogDescription>
            Выберите ключ и уровень доступа. При выборе «Только модели» ключ и Base URL будут скрыты.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">API ключ</label>
            {!myKeys || myKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">У вас пока нет API ключей</p>
            ) : (
              <div className="flex flex-col gap-1">
                {myKeys.map((key) => (
                  <label
                    key={key.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                      selectedId === key.id
                        ? 'border-foreground bg-muted'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="api-key"
                      checked={selectedId === key.id}
                      onChange={() => setSelectedId(key.id)}
                      className="sr-only"
                    />
                    <KeyRound className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium">{key.name}</span>
                      <span className="text-xs text-muted-foreground">{key.modelId}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Уровень доступа</label>
            <div className="flex flex-col gap-1">
              <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-md border cursor-pointer transition-colors ${accessLevel === 'readonly' ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/50'}`}>
                <input type="radio" name="access" checked={accessLevel === 'readonly'} onChange={() => setAccessLevel('readonly')} className="sr-only" />
                <EyeOff className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Только модели</p>
                  <p className="text-xs text-muted-foreground">Участники видят доступные модели, но не ключ и Base URL</p>
                </div>
              </label>
              <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-md border cursor-pointer transition-colors ${accessLevel === 'full' ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/50'}`}>
                <input type="radio" name="access" checked={accessLevel === 'full'} onChange={() => setAccessLevel('full')} className="sr-only" />
                <Eye className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Полный доступ</p>
                  <p className="text-xs text-muted-foreground">Ключ и Base URL видны участникам с правом share_api_full</p>
                </div>
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleShare} disabled={!selectedId || sharing}>
            {sharing ? <Loader2 className="size-4 animate-spin" /> : 'Поделиться'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
