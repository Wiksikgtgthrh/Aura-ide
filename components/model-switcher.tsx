'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Sparkles, ChevronDown, Check, KeyRound, Plus } from 'lucide-react'
import { getApiKeys } from '@/app/actions/api-keys'
import { useLanguage } from '@/lib/language'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const AURA_MODELS = [
  { id: 'aura-mini', name: 'Aura Mini' },
  { id: 'aura-pro', name: 'Aura Pro' },
  { id: 'aura-max', name: 'Aura Max' },
  { id: 'aura-max-fast', name: 'Aura Max Fast' },
] as const

export type SelectedModel = { id: string; name: string }

export function ModelSwitcher({
  value,
  onChange,
}: {
  value?: SelectedModel
  onChange?: (model: SelectedModel) => void
}) {
  const { t } = useLanguage()
  const { data: keys } = useSWR('api-keys', () => getApiKeys(), {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })
  const [internal, setInternal] = useState<SelectedModel>({
    id: 'aura-max',
    name: 'Aura Max',
  })
  const [mounted, setMounted] = useState(false)
  const selected = value ?? internal
  const setSelected = (m: SelectedModel) => {
    setInternal(m)
    onChange?.(m)
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  // Auto-select the first user key as default when keys are loaded and no user key is selected yet
  useEffect(() => {
    if (!keys || keys.length === 0) return
    const current = value ?? internal
    if (current.id.startsWith('aura-')) {
      const firstKey = keys[0]
      const m = { id: `api-${firstKey.id}`, name: firstKey.name }
      setInternal(m)
      onChange?.(m)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('selectModel')}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-sm text-foreground hover:bg-accent transition-colors duration-200 data-[state=open]:bg-accent"
      >
        <Sparkles className="size-3.5" />
        <span suppressHydrationWarning>
          {mounted ? selected.name : 'Aura Max'}
        </span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-60 animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('myApi')}
          </DropdownMenuLabel>
          {keys && keys.length > 0 ? (
            keys.map((k) => {
              const id = `api-${k.id}`
              return (
                <DropdownMenuItem
                  key={id}
                  className="gap-2.5"
                  onClick={() => setSelected({ id, name: k.name })}
                >
                  <KeyRound className="size-4" />
                  <span className="truncate">{k.name}</span>
                  {selected.id === id && (
                    <Check className="ml-auto size-4 shrink-0" />
                  )}
                </DropdownMenuItem>
              )
            })
          ) : (
            <DropdownMenuItem className="gap-2.5" render={<Link href="/my-api" />}>
              <Plus className="size-4" />
              {t('addApiKey')}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {AURA_MODELS.map((m) => (
            <DropdownMenuItem
              key={m.id}
              className="gap-2.5"
              onClick={() => setSelected({ id: m.id, name: m.name })}
            >
              <Sparkles className="size-4" />
              {m.name}
              {selected.id === m.id && (
                <Check className="ml-auto size-4 shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
