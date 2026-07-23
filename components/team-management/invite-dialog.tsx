'use client'

import { useState, useEffect, useRef } from 'react'
import { inviteByUsername } from '@/app/actions/teams'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserPlus, Search, Check, Copy, Loader2, User } from 'lucide-react'

type SearchUser = {
  id: string
  name: string
  username: string | null
  image: string | null
}

export function InviteDialog({
  open,
  onOpenChange,
  teamId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchUser[]>([])
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setInviteLink(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/teams/search?q=${encodeURIComponent(query)}&teamId=${teamId}`,
        )
        const data = await res.json()
        setResults(data.users ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [query, teamId])

  const handleInvite = async (username: string) => {
    setInviting(username)
    setError(null)
    try {
      const result = await inviteByUsername(teamId, username)
      if (result) {
        const link = `${window.location.origin}/teams/invite/${result.token}`
        setInviteLink(link)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setInviting(null)
    }
  }

  const handleCopy = async () => {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4" />
            Пригласить участника
          </DialogTitle>
          <DialogDescription>
            Найдите пользователя по нику или тегу (@username)
          </DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Приглашение создано. Отправьте ссылку пользователю — она действует 7 дней.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 h-9 px-3 rounded-md bg-muted text-xs text-foreground border border-border outline-none"
              />
              <Button
                size="icon-sm"
                variant="outline"
                onClick={handleCopy}
                aria-label="Скопировать"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button variant="outline" onClick={() => setInviteLink(null)} className="self-start">
              Пригласить ещё
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по нику..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {results.length > 0 && (
              <ul className="flex flex-col gap-1 max-h-52 overflow-y-auto">
                {results.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-muted transition-colors"
                  >
                    {u.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.image} alt="" className="size-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="size-7 rounded-full bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center shrink-0">
                        <span className="text-background text-[10px] font-semibold">
                          {u.name.charAt(0).toUpperCase()}
                        </span>
                      </span>
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">{u.name}</span>
                      {u.username && (
                        <span className="text-xs text-muted-foreground">@{u.username}</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={inviting === u.username}
                      onClick={() => u.username && handleInvite(u.username)}
                    >
                      {inviting === u.username ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        'Пригласить'
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {query.length >= 2 && !searching && results.length === 0 && (
              <p className="text-sm text-muted-foreground px-1">Пользователи не найдены</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
