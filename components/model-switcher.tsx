'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  Sparkles,
  ChevronDown,
  Check,
  KeyRound,
  Plus,
  Boxes,
  Loader2,
  Sprout,
} from 'lucide-react'
import { getApiKeys, listKeyModels, updateApiKey } from '@/app/actions/api-keys'
import { getFarmModelsForUser, getMyFarmAccess } from '@/app/actions/farm'
import { getAuraTiersInfo, type AuraTierInfo } from '@/app/actions/aura-info'
import { AURA_MODELS } from '@/lib/aura-models'
import { useLanguage } from '@/lib/language'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type SelectedModel = { id: string; name: string }

export function ModelSwitcher({
  value,
  onChange,
}: {
  value?: SelectedModel
  onChange?: (model: SelectedModel) => void
}) {
  const { t } = useLanguage()
  const { data: keys, mutate: mutateKeys } = useSWR('api-keys', () => getApiKeys(), {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })
  // «Что внутри тира»: ключи тарифа пользователя или встроенная модель.
  const { data: tiersInfo } = useSWR<AuraTierInfo[]>(
    'aura-tiers-info',
    () => getAuraTiersInfo(),
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  )
  // V0 Farm: доступ (выданные админом группы ключей) и модели из админки.
  const { data: farmAccess } = useSWR('farm-access', () => getMyFarmAccess(), {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const { data: farmModels } = useSWR('farm-models', () => getFarmModelsForUser(), {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const [internal, setInternal] = useState<SelectedModel>({
    id: 'aura-max',
    name: 'Aura Max',
  })
  const [mounted, setMounted] = useState(false)
  const [switchingModel, setSwitchingModel] = useState<string | null>(null)
  const selected = value ?? internal
  const setSelected = (m: SelectedModel) => {
    setInternal(m)
    onChange?.(m)
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  // ВАЖНО: авто-подмена выбора «первым ключом» отсюда убрана — она затирала
  // явный выбор тира Aura при каждой загрузке. Сброс залипшего/удалённого
  // ключа и дефолт «первый ключ, если выбора не было» живут в PromptBox.

  // Выбранный пользовательский ключ (для сабменю «Сменить модель»).
  const selectedKey =
    selected.id.startsWith('api-') && keys
      ? keys.find((k) => `api-${k.id}` === selected.id) ?? null
      : null

  // Модели, которые поддерживает выбранный ключ (GET /models провайдера).
  const { data: keyModels } = useSWR(
    selectedKey ? `key-models-${selectedKey.id}` : null,
    () => listKeyModels(selectedKey!.id),
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  )

  const changeKeyModel = async (modelId: string) => {
    if (!selectedKey || switchingModel) return
    setSwitchingModel(modelId)
    try {
      await updateApiKey(selectedKey.id, { modelId })
      await mutateKeys()
    } finally {
      setSwitchingModel(null)
    }
  }

  const tierInfo = (id: string): AuraTierInfo | undefined =>
    tiersInfo?.find((ti) => ti.id === id)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('selectModel')}
        className="flex h-8 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm text-foreground transition-colors duration-200 hover:bg-accent data-[state=open]:bg-accent"
      >
        <Sparkles className="size-3.5 shrink-0" />
        <span suppressHydrationWarning className="max-w-28 truncate">
          {mounted ? selected.name : 'Aura Max'}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 animate-in fade-in slide-in-from-bottom-2 duration-200"
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
                  title={`${k.modelId} · ${k.baseUrl}`}
                  onClick={() => setSelected({ id, name: k.name })}
                >
                  <KeyRound className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{k.name}</span>
                    <span className="truncate text-[10px] leading-tight text-muted-foreground">
                      {k.modelId}
                    </span>
                  </span>
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

          {/* Смена модели у выбранного ключа: один ключ (OpenRouter, Groq…)
              часто поддерживает много моделей — выбираем без захода в «Мои API». */}
          {selectedKey && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2.5 text-muted-foreground data-[state=open]:text-foreground">
                <Boxes className="size-4 shrink-0" />
                <span className="truncate text-xs">Сменить модель ключа…</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-64 overflow-y-auto">
                {!keyModels ? (
                  <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Загружаем модели…
                  </div>
                ) : keyModels.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    Провайдер не отдал список моделей
                  </div>
                ) : (
                  keyModels.map((m) => (
                    <DropdownMenuItem
                      key={m}
                      className="gap-2"
                      onClick={(e) => {
                        e.preventDefault() // не закрывать меню — можно пробовать подряд
                        void changeKeyModel(m)
                      }}
                    >
                      {switchingModel === m ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin" />
                      ) : (
                        <span className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate font-mono text-xs">{m}</span>
                      {selectedKey.modelId === m && (
                        <Check className="ml-auto size-3.5 shrink-0 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuGroup>

        {/* V0 Farm — модели из админки (доступ: выданные администратором группы ключей) */}
        {farmAccess?.hasAccess && farmModels && farmModels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                V0 Farm
              </DropdownMenuLabel>
              {farmModels.map((m) => (
                <DropdownMenuItem
                  key={`farm-${m.id}`}
                  className="gap-2.5"
                  onClick={() => setSelected({ id: `farm-${m.id}`, name: m.name })}
                >
                  <Sprout className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{m.name}</span>
                    <span className="truncate text-[10px] leading-tight text-muted-foreground">
                      {m.v0ModelId}
                    </span>
                  </span>
                  {selected.id === `farm-${m.id}` && <Check className="ml-auto size-4 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {AURA_MODELS.map((m) => {
            const info = tierInfo(m.id)
            return (
              <DropdownMenuItem
                key={m.id}
                className="gap-2.5"
                title={info?.tooltip}
                onClick={() => setSelected({ id: m.id, name: m.name })}
              >
                <Sparkles
                  className={`size-4 shrink-0 ${info?.source === 'plan' ? 'text-primary' : ''}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{m.name}</span>
                  {info && (
                    <span className="truncate text-[10px] leading-tight text-muted-foreground">
                      {info.source === 'plan' ? '★ ' : ''}
                      {info.subtitle}
                    </span>
                  )}
                </span>
                {selected.id === m.id && (
                  <Check className="ml-auto size-4 shrink-0" />
                )}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
