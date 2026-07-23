'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { generateId } from 'ai'
import dynamic from 'next/dynamic'
import { PromptBox, type PromptBoxSubmitPayload } from '@/components/prompt-box'
import { createChat } from '@/app/actions/chats'
import { useLanguage } from '@/lib/language'

// Loaded only on the client to avoid hydration mismatch caused by
// SWR + language context differing between SSR and first client render.
const SuggestionChips = dynamic(
  () => import('@/components/suggestion-chips').then((m) => m.SuggestionChips),
  { ssr: false },
)

export function HomeContent() {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const [creating, setCreating] = useState(false)

  // HomeContent is mounted permanently inside an <Activity> shell, so it is
  // NEVER unmounted when navigating away to a chat. That means `creating`
  // would stay true forever and silently block every future submit
  // ("can't start a new chat"). Reset it every time home becomes active.
  useEffect(() => {
    if (pathname === '/') setCreating(false)
  }, [pathname])

  const startChat = (text: string, modelId: string) => {
    const id = generateId()
    sessionStorage.setItem(
      `aura-pending-${id}`,
      JSON.stringify({ text, modelId }),
    )
    // Always create in IDE mode (Monaco editor + file system).
    // Fire-and-forget: the chat page retries getChatOwned() while this
    // server action persists the row, so we can navigate instantly instead
    // of blocking the click on a server round-trip.
    void createChat(text, 'ide', id).catch(() => {})
    router.push(`/chat/${id}`)
  }

  const handleSubmit = (payload: PromptBoxSubmitPayload) => {
    if (creating) return
    setCreating(true)
    startChat(payload.text, payload.modelId)
  }

  const handleSuggestion = (text: string) => {
    if (creating) return
    setCreating(true)
    startChat(text, 'aura-max')
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 animate-in fade-in duration-150">
      <h1 className="mb-8 text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl">
        {t('homeTitle')}
      </h1>
      <PromptBox onSubmit={handleSubmit} busy={creating} />
      <SuggestionChips onSelect={handleSuggestion} disabled={creating} />
    </main>
  )
}
