'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { generateId } from 'ai'
import { mutate as globalMutate } from 'swr'
import dynamic from 'next/dynamic'
import { PromptBox, type PromptBoxSubmitPayload } from '@/components/prompt-box'
import { createChat } from '@/app/actions/chats'
import { useLanguage } from '@/lib/language'
import { OpenFolderButton, LocalWorkspace } from '@/components/local-workspace'
import { loadRecent, loadSession, pushRecent } from '@/lib/session-store'
import { FolderOpen } from 'lucide-react'

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
  // Открытая локальная папка (desktop «Open Folder» как в VS Code).
  // null — обычная главная с промптом; path — workspace поверх неё.
  const [folder, setFolder] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])

  // Восстанавливаем последний открытый проект и список Recent.
  useEffect(() => {
    setRecent(loadRecent())
    const s = loadSession()
    if (s?.root) {
      // Не подставляем автоматически — только показываем как первый в Recent,
      // чтобы пользователь сам решил, продолжить или нет.
      setRecent((r) => (r.includes(s.root) ? r : [s.root, ...r]))
    }
  }, [])

  const openFolder = (path: string) => {
    pushRecent(path)
    setRecent((r) => [path, ...r.filter((x) => x !== path)].slice(0, 12))
    setFolder(path)
  }

  // HomeContent is mounted permanently inside an <Activity> shell, so it is
  // NEVER unmounted when navigating away to a chat. That means `creating`
  // would stay true forever and silently block every future submit
  // ("can't start a new chat"). Reset it every time home becomes active.
  useEffect(() => {
    if (pathname === '/') setCreating(false)
  }, [pathname])

  // Warm up everything the /chat/[id] project view needs BEFORE the user
  // submits a prompt, so entering chat+preview mode is fast:
  //  1. router.prefetch — compiles the route and downloads its client chunks
  //     (with cacheComponents only the static shell renders; the dynamic
  //     ChatLoader inside Suspense is deferred until real navigation).
  //  2. import('ide-panel') — pulls the heaviest client chunk (file tree,
  //     editors) that otherwise starts downloading only after hydration.
  //  3. Monaco loader.init() — starts the CDN download of the editor core.
  useEffect(() => {
    const t1 = window.setTimeout(() => {
      router.prefetch('/chat/warmup')
      void import('@/components/ide-panel').catch(() => {})
    }, 400)
    const t2 = window.setTimeout(() => {
      void import('@monaco-editor/react')
        .then((m) => m.loader.init())
        .catch(() => {})
    }, 1200)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [router])

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
    // /api/chat теперь и сам создаёт строку чата при гонке; после создания
    // обновляем список «Недавние чаты» в сайдбаре (SWR-ключ 'chats').
    void createChat(text, 'ide', id)
      .then(() => globalMutate('chats'))
      .catch(() => {})
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

  // Открыта локальная папка — показываем workspace вместо промпта.
  if (folder) {
    return (
      <main className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-150">
        <LocalWorkspace root={folder} onClose={() => setFolder(null)} />
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 animate-in fade-in duration-150">
      <h1 className="mb-8 text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl">
        {t('homeTitle')}
      </h1>
      <PromptBox onSubmit={handleSubmit} busy={creating} />
      <SuggestionChips onSelect={handleSuggestion} disabled={creating} />
      <div className="mt-6 flex w-full max-w-md flex-col items-center gap-3">
        <OpenFolderButton onOpen={openFolder} />
        {recent.length > 0 && (
          <div className="w-full">
            <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Недавние проекты
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30">
              {recent.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => openFolder(p)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <FolderOpen className="size-3 shrink-0" />
                  <span className="truncate">{p}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
