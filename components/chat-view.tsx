'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import { PromptBox, type PromptBoxSubmitPayload } from '@/components/prompt-box'
import { PreviewPanel } from '@/components/preview-panel'
import type { IdeFiles } from '@/components/ide-panel'
import type { SelectedElement } from '@/lib/preview-runtime'
import { useLanguage } from '@/lib/language'
import { getPreferences } from '@/app/actions/preferences'
import { getApiKeys } from '@/app/actions/api-keys'
import { useNotificationSound } from '@/lib/use-notification-sound'

const IdePanel = dynamic(() => import('@/components/ide-panel').then((m) => m.IdePanel), {
  ssr: false,
})
import type { ChatMode } from '@/lib/chat-store'
import { CheckCircle2, Code2, Eye, History, Loader2, MessageSquare, Pencil, Play, RotateCcw } from 'lucide-react'
import { rollbackToMessage, truncateChatFromMessage } from '@/app/actions/checkpoints'

// --- HTML extraction -------------------------------------------------------

const HTML_BLOCK_RE = /```html\r?\n([\s\S]*?)```/g

/** Extract the last complete ```html block from all messages. */
function extractHtml(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j]
      if (part.type !== 'text') continue
      const matches = [...part.text.matchAll(HTML_BLOCK_RE)]
      if (matches.length > 0) {
        return matches[matches.length - 1][1]
      }
    }
  }
  return null
}

/**
 * Extract a partial (in-progress) HTML block from the currently streaming text.
 * Returns everything after the last ```html marker even if the block isn't closed yet.
 */
function extractPartialHtml(streamingText: string): string | null {
  const marker = '```html\n'
  const idx = streamingText.lastIndexOf(marker)
  if (idx === -1) return null
  const after = streamingText.slice(idx + marker.length)
  // Strip trailing closing fence if present
  return after.replace(/```\s*$/, '')
}

// --- Work status helpers ----------------------------------------------------

/** Stats for the per-reply work summary: ```file: blocks and their lines. */
function messageWorkStats(text: string): { files: number; lines: number } {
  const blocks = [...text.matchAll(/```file:[^\n]*\r?\n([\s\S]*?)```/g)]
  return {
    files: blocks.length,
    lines: blocks.reduce((acc, b) => acc + b[1].split('\n').length, 0),
  }
}

/** The file currently being streamed (last unclosed ```file: block), if any. */
function currentStreamingFile(streamingText: string): string | null {
  const matches = [...streamingText.matchAll(/```file:([^\n`]+)/g)]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]
  const after = streamingText.slice((last.index ?? 0) + last[0].length)
  // A closing fence after the last opening means the block is finished.
  return /\r?\n\s*```/.test(after) ? null : last[1].trim()
}

// --- TSX/IDE extraction ----------------------------------------------------

const FILE_BLOCK_RE = /```file:([\w./\-]+)\r?\n([\s\S]*?)```/g
const TSX_BLOCK_RE = /```tsx\r?\n([\s\S]*?)```/g

/** Extract all ```file:path ... ``` blocks from all messages. */
function extractFiles(messages: UIMessage[]): IdeFiles {
  const map: IdeFiles = new Map()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      if (part.type !== 'text') continue
      for (const match of part.text.matchAll(FILE_BLOCK_RE)) {
        map.set(match[1], match[2])
      }
      // Fallback: bare ```tsx block → App.tsx
      for (const match of part.text.matchAll(TSX_BLOCK_RE)) {
        if (!map.has('src/App.tsx')) {
          map.set('src/App.tsx', match[1])
        }
      }
    }
  }
  return map
}

/**
 * Partial extraction during streaming: parse any completed ```file:... ``` blocks
 * plus the currently-open (incomplete) one.
 */
function extractPartialFiles(streamingText: string): IdeFiles {
  const map: IdeFiles = new Map()

  // Completed blocks
  for (const match of streamingText.matchAll(FILE_BLOCK_RE)) {
    map.set(match[1], match[2])
  }

  // In-progress block
  const lastFileMarker = streamingText.lastIndexOf('```file:')
  if (lastFileMarker !== -1) {
    const afterMarker = streamingText.slice(lastFileMarker + 8)
    const nlIdx = afterMarker.indexOf('\n')
    if (nlIdx !== -1) {
      const path = afterMarker.slice(0, nlIdx)
      const code = afterMarker.slice(nlIdx + 1).replace(/```\s*$/, '')
      if (!map.has(path) && code.trim()) {
        map.set(path, code)
      }
    }
  }

  // Bare tsx fallback
  if (map.size === 0) {
    const tsxMarker = streamingText.lastIndexOf('```tsx\n')
    if (tsxMarker !== -1) {
      const code = streamingText.slice(tsxMarker + 7).replace(/```\s*$/, '')
      if (code.trim()) map.set('src/App.tsx', code)
    }
  }

  return map
}

// --- Design choices (interview chips) ---------------------------------------

const DESIGN_CHOICES_RE = /<design-choices>([\s\S]*?)<\/design-choices>/
// Strips complete AND partially-streamed design-choices tags from display text
const DESIGN_CHOICES_STRIP_RE = /<design-choices>[\s\S]*?(?:<\/design-choices>|$)/g

/** Extract design options from the LAST message when it's an assistant turn. */
function extractDesignChoices(messages: UIMessage[]): string[] | null {
  if (messages.length === 0) return null
  const last = messages[messages.length - 1]
  if (last.role !== 'assistant') return null
  let text = ''
  for (const part of last.parts) {
    if (part.type === 'text') text += part.text
  }
  const match = text.match(DESIGN_CHOICES_RE)
  if (!match) return null
  const options = match[1]
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8)
  return options.length > 0 ? options : null
}

// Model-suggested next improvements — rendered as chips under the last reply.
const NEXT_STEPS_RE = /<next-steps>([\s\S]*?)<\/next-steps>/
const NEXT_STEPS_STRIP_RE = /<next-steps>[\s\S]*?(?:<\/next-steps>|$)/g

function extractNextSteps(messages: UIMessage[]): string[] | null {
  if (messages.length === 0) return null
  const last = messages[messages.length - 1]
  if (last.role !== 'assistant') return null
  let text = ''
  for (const part of last.parts) {
    if (part.type === 'text') text += part.text
  }
  const match = text.match(NEXT_STEPS_RE)
  if (!match) return null
  const options = match[1]
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4)
  return options.length > 0 ? options : null
}

// --- Message renderer ------------------------------------------------------

function MessageText({
  text: rawText,
  label,
  onOpenFile,
}: {
  text: string
  label: string
  /** Open a file pill in the editor (IDE mode). */
  onOpenFile?: (path: string) => void
}) {
  // Hide the machine-readable blocks — they render as chips instead.
  const text = useMemo(
    () =>
      rawText
        .replace(DESIGN_CHOICES_STRIP_RE, '')
        .replace(NEXT_STEPS_STRIP_RE, '')
        .trimEnd(),
    [rawText],
  )
  const segments = useMemo(() => {
    const out: { type: 'text' | 'code'; value: string; isFile: boolean }[] = []

    // Collapse ANY fenced code block into a pill — including bare ``` fences
    // with no language and file:path blocks. A closed block ends at the next
    // ``` ; an unterminated one (still streaming) runs to end-of-text. This is
    // deliberately broad so raw code never leaks into the chat bubble.
    const CODE_RE = /```[^\n]*\r?\n[\s\S]*?(?:```|$)/g

    let last = 0
    for (const match of text.matchAll(CODE_RE)) {
      const index = match.index ?? 0
      if (index > last) {
        const chunk = text.slice(last, index)
        if (chunk.trim()) out.push({ type: 'text', value: chunk, isFile: false })
      }
      // Label the pill with the file path when present, else the generic label.
      const fileMatch = match[0].match(/```file:([\w./\-]+)/)
      out.push({
        type: 'code',
        value: fileMatch ? fileMatch[1] : label,
        isFile: !!fileMatch,
      })
      last = index + match[0].length
    }
    if (last < text.length) {
      const chunk = text.slice(last)
      if (chunk.trim()) out.push({ type: 'text', value: chunk, isFile: false })
    }
    return out
  }, [text, label])

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : segment.isFile ? (
          // Clickable file pill — opens the file in the editor (v0-style rows)
          <button
            key={index}
            type="button"
            onClick={() => onOpenFile?.(segment.value)}
            className="my-2 flex w-full items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-left font-mono text-xs text-muted-foreground transition-colors hover:border-ring/40 hover:bg-accent hover:text-foreground"
            title={segment.value}
          >
            <Code2 className="size-3.5 shrink-0" />
            <span className="truncate">{segment.value}</span>
          </button>
        ) : (
          <span
            key={index}
            className="my-2 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
          >
            <Code2 className="size-3.5 shrink-0" />
            {label}
          </span>
        ),
      )}
    </>
  )
}

// --- ChatView --------------------------------------------------------------

export function ChatView({
  chatId,
  initialMessages,
  initialFiles,
  mode = 'html',
  title = 'aura-project',
  readOnly = false,
}: {
  chatId: string
  initialMessages: UIMessage[]
  /** Persistent virtual FS from the DB (includes the user's manual edits). */
  initialFiles?: Record<string, string>
  mode?: ChatMode
  title?: string
  /** Shared-project viewer: can browse chat/code/preview but not modify. */
  readOnly?: boolean
}) {
  const { t } = useLanguage()
  const { data: prefs } = useSWR('preferences', getPreferences, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const { data: apiKeysList } = useSWR('api-keys', getApiKeys, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const playSound = useNotificationSound(prefs?.soundNotifications ?? true)
  const modelRef = useRef<string>('aura-max')
  const extrasRef = useRef<Omit<PromptBoxSubmitPayload, 'text' | 'modelId'>>({
    files: [],
    generateImages: true,
    activeSkills: [],
    autoPermissions: 'ask',
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const sentPendingRef = useRef(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  // Design mode: element picked in the preview — attached to the next message
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  // Track whether the right panel has appeared at least once for the entry animation
  const [panelVisible, setPanelVisible] = useState(false)
  // File pill clicked in chat → open in the editor (epoch forces re-trigger)
  const [openFileReq, setOpenFileReq] = useState<{ path: string; epoch: number } | null>(null)
  // Inline editing of a user message (edit-and-resend)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  // Generation was stopped by the user → offer «Продолжить»
  const [wasStopped, setWasStopped] = useState(false)
  const [rollingBack, setRollingBack] = useState<string | null>(null)

  const { messages, sendMessage, regenerate, status, stop, error, setMessages } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: {
          id,
          message: messages[messages.length - 1],
          modelId: modelRef.current,
          ...extrasRef.current,
        },
      }),
    }),
  })

  // Send the pending first message handed off from the home page.
  useEffect(() => {
    if (sentPendingRef.current) return
    sentPendingRef.current = true
    const raw = sessionStorage.getItem(`aura-pending-${chatId}`)
    if (raw && initialMessages.length === 0) {
      sessionStorage.removeItem(`aura-pending-${chatId}`)
      try {
        const { text, modelId } = JSON.parse(raw) as {
          text: string
          modelId: string
        }
        modelRef.current = modelId
        sendMessage({ text })
      } catch {
        // ignore malformed payload
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Play notification sound when streaming finishes
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const wasStreaming =
      prevStatusRef.current === 'streaming' || prevStatusRef.current === 'submitted'
    const isDone = status === 'ready' || status === 'error'
    if (wasStreaming && isDone) playSound()
    prevStatusRef.current = status
  }, [status, playSound])

  const busy = status === 'submitted' || status === 'streaming'

  // ---- Live work status + per-reply summary (v0-style) ---------------------
  // Track how long each generation took. Client-side wall clock: started when
  // the request is submitted, attributed to the last assistant message id
  // when the stream finishes.
  const workStartRef = useRef<number | null>(null)
  const [workDurations, setWorkDurations] = useState<Map<string, number>>(
    () => new Map(),
  )
  useEffect(() => {
    if (status === 'submitted' && workStartRef.current === null) {
      workStartRef.current = Date.now()
      // A new request started via any path — the «Продолжить» offer is stale.
      setWasStopped(false)
    }
    if ((status === 'ready' || status === 'error') && workStartRef.current !== null) {
      const seconds = Math.max(1, Math.round((Date.now() - workStartRef.current) / 1000))
      workStartRef.current = null
      if (status === 'ready') {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            const id = messages[i].id
            setWorkDurations((prev) => new Map(prev).set(id, seconds))
            break
          }
        }
      }
    }
  }, [status, messages])

  // Get the last streaming assistant text (for partial extraction)
  const streamingText = useMemo((): string | null => {
    if (status !== 'streaming') return null
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== 'assistant') continue
      for (let j = msg.parts.length - 1; j >= 0; j--) {
        const part = msg.parts[j]
        if (part.type === 'text' && part.text) return part.text
      }
    }
    return null
  }, [messages, status])

  // The file currently being written by the model (live status line)
  const currentFile = useMemo(
    () => (streamingText ? currentStreamingFile(streamingText) : null),
    [streamingText],
  )

  // HTML mode: use partial during streaming, full otherwise
  const previewHtml = useMemo(() => {
    if (mode !== 'html') return null
    if (streamingText) {
      return extractPartialHtml(streamingText) ?? extractHtml(messages)
    }
    return extractHtml(messages)
  }, [messages, mode, streamingText])

  // IDE mode: merge committed files + partial streaming files
  const ideFiles = useMemo((): IdeFiles => {
    if (mode !== 'ide') return new Map()
    const committed = extractFiles(messages)
    if (streamingText) {
      const partial = extractPartialFiles(streamingText)
      // Merge: partial overrides if the key doesn't exist in committed
      const merged: IdeFiles = new Map(committed)
      for (const [path, code] of partial) {
        merged.set(path, code)
      }
      return merged
    }
    return committed
  }, [messages, mode, streamingText])

  // The right panel is visible from the very start — its toolbar and the
  // «превью появится здесь» empty state are part of the first impression.
  // The flag now only drives the entry animation on mount (previously the
  // panel stayed at opacity-0 until the first generated content, so the
  // right side looked broken-empty in a fresh chat).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPanelVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Auto-fallback: if Gateway billing error and user has their own keys, switch to first key.
  // NOTE: no bare '402' check — a provider-side 402 on the user's OWN key also
  // mentions «402» and must NOT trigger the gateway fallback.
  const isGatewayBillingError =
    error &&
    (error.message?.includes('customer_verification_required') ||
      error.message?.includes('credit card') ||
      error.message?.includes('gateway_billing'))
  const firstApiKeyId = apiKeysList?.[0]?.id

  useEffect(() => {
    if (isGatewayBillingError && firstApiKeyId && modelRef.current.startsWith('aura-')) {
      modelRef.current = `api-${firstApiKeyId}`
    }
  }, [isGatewayBillingError, firstApiKeyId])

  const handleSubmit = (payload: PromptBoxSubmitPayload) => {
    // If gateway is unavailable and user has their own key, use it automatically
    const resolvedModelId =
      payload.modelId.startsWith('aura-') && isGatewayBillingError && firstApiKeyId
        ? `api-${firstApiKeyId}`
        : payload.modelId
    modelRef.current = resolvedModelId
    extrasRef.current = {
      files: payload.files,
      generateImages: payload.generateImages,
      activeSkills: payload.activeSkills,
      autoPermissions: payload.autoPermissions,
    }
    // Attach the design-mode element context so the model knows exactly
    // WHICH element the user is talking about.
    let text = payload.text
    if (selectedElement) {
      const el = selectedElement
      text = `[Выбранный элемент в превью: <${el.tag}${el.id ? ` id="${el.id}"` : ''}${el.classes ? ` class="${el.classes}"` : ''}>${el.text ? ` с текстом «${el.text}»` : ''}; CSS-путь: ${el.path}]\n\n${payload.text}`
      setSelectedElement(null)
    }
    sendMessage({ text })
  }

  const chatPosition = prefs?.chatPosition ?? 'left'
  const isRight = chatPosition === 'right'

  // Design interview: chips shown while the assistant awaits a style choice
  const designChoices = useMemo(
    () => (busy ? null : extractDesignChoices(messages)),
    [messages, busy],
  )

  // Model-suggested next improvements (chips under the last reply)
  const nextSteps = useMemo(
    () => (busy || readOnly ? null : extractNextSteps(messages)),
    [messages, busy, readOnly],
  )

  // Open a file pill from the chat in the editor (mobile: reveal the panel)
  const handleOpenFile = (path: string) => {
    setOpenFileReq((prev) => ({ path, epoch: (prev?.epoch ?? 0) + 1 }))
    if (window.innerWidth < 768) setChatCollapsed(true)
  }

  // Roll the project back to the state of a specific assistant reply
  const handleRollback = async (messageId: string) => {
    if (rollingBack || busy) return
    if (!window.confirm(t('rollbackConfirm'))) return
    setRollingBack(messageId)
    try {
      const ok = await rollbackToMessage(chatId, messageId)
      if (ok) window.location.reload()
    } finally {
      setRollingBack(null)
    }
  }

  // Edit-and-resend a user message: server truncates history from that
  // message, the client mirrors it and sends the edited text as a new turn.
  const handleEditSubmit = async () => {
    if (!editingId || editBusy) return
    const text = editDraft.trim()
    if (!text) return
    setEditBusy(true)
    try {
      const idx = messages.findIndex((m) => m.id === editingId)
      const ok = await truncateChatFromMessage(chatId, editingId)
      if (!ok) return
      if (idx >= 0) setMessages(messages.slice(0, idx))
      setEditingId(null)
      setEditDraft('')
      setWasStopped(false)
      sendMessage({ text })
    } finally {
      setEditBusy(false)
    }
  }

  const handleDesignChoice = (choice: string) => {
    sendMessage({ text: choice })
  }

  return (
    <main className={`flex min-w-0 flex-1 h-svh ${isRight ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Chat column */}
      <div
        className={`flex flex-col transition-[width] duration-200 ${isRight ? 'border-l border-border' : 'border-r border-border'} ${
          chatCollapsed
            ? 'w-0 overflow-hidden border-0'
            : 'w-full md:w-[420px] md:shrink-0'
        }`}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
            {messages.map((message) => {
              const isUser = message.role === 'user'
              const isEditing = editingId === message.id
              return (
                <div
                  key={message.id}
                  className={`group flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {/* Edit-and-resend (pencil appears on hover) */}
                  {isUser && !isEditing && !readOnly && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(message.id)
                        setEditDraft(
                          message.parts
                            .filter((p) => p.type === 'text')
                            .map((p) => (p as { text: string }).text)
                            .join('\n'),
                        )
                      }}
                      aria-label={t('editMessage')}
                      className="mr-2 mt-1.5 self-start rounded-md p-1.5 text-transparent transition-colors hover:bg-accent hover:!text-foreground group-hover:text-muted-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}

                  {isEditing ? (
                    <div className="flex w-full max-w-[85%] flex-col gap-2">
                      <textarea
                        value={editDraft}
                        autoFocus
                        rows={3}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void handleEditSubmit()
                          }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={editBusy || !editDraft.trim()}
                          onClick={() => void handleEditSubmit()}
                          className="flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-all active:scale-95 disabled:opacity-50"
                        >
                          {editBusy && <Loader2 className="size-3 animate-spin" />}
                          {t('sendEdited')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${
                        isUser
                          ? 'rounded-2xl rounded-br-md bg-foreground text-background px-4 py-2.5'
                          : 'text-foreground'
                      }`}
                    >
                      {message.parts.map((part, index) =>
                        part.type === 'text' ? (
                          <MessageText
                            key={index}
                            text={part.text}
                            label={t('previewUpdated')}
                            onOpenFile={mode === 'ide' ? handleOpenFile : undefined}
                          />
                        ) : null,
                      )}
                      {/* Per-reply work summary: duration · files · lines · tokens */}
                      {message.role === 'assistant' &&
                        (() => {
                          const text = message.parts
                            .filter((p) => p.type === 'text')
                            .map((p) => (p as { text: string }).text)
                            .join('\n')
                          const { files, lines } = messageWorkStats(text)
                          const secs = workDurations.get(message.id)
                          const meta = message.metadata as
                            | { totalTokens?: number }
                            | undefined
                          const usagePart = (
                            message.parts as Array<{
                              type: string
                              data?: { totalTokens?: number }
                            }>
                          ).find((p) => p.type === 'data-usage')
                          const tokens =
                            meta?.totalTokens ?? usagePart?.data?.totalTokens
                          const isStreamingThis =
                            busy && message.id === messages[messages.length - 1]?.id
                          if (
                            (files === 0 && secs === undefined && !tokens) ||
                            isStreamingThis
                          )
                            return null
                          const bits: string[] = []
                          if (secs !== undefined) {
                            bits.push(
                              t('doneIn').replace(
                                '{t}',
                                secs < 60
                                  ? t('durSec').replace('{s}', String(secs))
                                  : t('durMin')
                                      .replace('{m}', String(Math.floor(secs / 60)))
                                      .replace('{s}', String(secs % 60)),
                              ),
                            )
                          }
                          if (files > 0) {
                            bits.push(t('filesChanged').replace('{n}', String(files)))
                            bits.push(t('linesWritten').replace('{n}', String(lines)))
                          }
                          if (tokens) {
                            bits.push(
                              t('tokensUsed').replace(
                                '{n}',
                                tokens >= 1000
                                  ? `${(tokens / 1000).toFixed(1)}k`
                                  : String(tokens),
                              ),
                            )
                          }
                          return (
                            <>
                              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                                <CheckCircle2 className="size-3.5 shrink-0" />
                                {bits.join(' · ')}
                              </p>
                              {files > 0 && mode === 'ide' && !readOnly && (
                                <button
                                  type="button"
                                  disabled={busy || rollingBack !== null}
                                  onClick={() => void handleRollback(message.id)}
                                  className="mt-1.5 flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95 disabled:opacity-50"
                                >
                                  {rollingBack === message.id ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <History className="size-3" />
                                  )}
                                  {t('rollbackToHere')}
                                </button>
                              )}
                            </>
                          )
                        })()}
                    </div>
                  )}
                </div>
              )
            })}

            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-in fade-in duration-300">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                {status === 'submitted' ? (
                  t('thinking')
                ) : currentFile ? (
                  <span className="min-w-0 truncate">
                    {t('writingFile')}{' '}
                    <code className="font-mono text-xs text-foreground/80">
                      {currentFile}
                    </code>
                  </span>
                ) : (
                  t('generating')
                )}
              </div>
            )}

            {/* Design interview chips */}
            {designChoices && (
              <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                {designChoices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => handleDesignChoice(choice)}
                    className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:border-ring/40 active:scale-[0.97] transition-all"
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}

            {/* Regenerate / continue the last assistant answer */}
            {!busy && !error && messages.length > 0 &&
              messages[messages.length - 1].role === 'assistant' && !designChoices && (
              <div className="-mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => regenerate()}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent active:scale-95 transition-all"
                >
                  <RotateCcw className="size-3" />
                  {t('regenerate')}
                </button>
                {wasStopped && !readOnly && (
                  <button
                    type="button"
                    onClick={() => sendMessage({ text: t('continuePrompt') })}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent active:scale-95 transition-all"
                  >
                    <Play className="size-3" />
                    {t('continueGen')}
                  </button>
                )}
              </div>
            )}

            {/* Model-suggested next steps (chips) */}
            {nextSteps && !designChoices && !busy && !error && (
              <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                {nextSteps.map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => sendMessage({ text: step })}
                    className="rounded-full border border-dashed border-border bg-background px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent hover:border-ring/40 active:scale-[0.97] transition-all"
                  >
                    {step}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                {(() => {
                  const msg = error?.message ?? ''
                  // Structured JSON error from a pre-stream response
                  // (daily built-in limit, read-only access, gateway billing).
                  let parsed: { error?: string; message?: string } | null = null
                  try {
                    parsed = JSON.parse(msg) as { error?: string; message?: string }
                  } catch {
                    /* not JSON */
                  }
                  if (parsed?.error === 'rate_limit') {
                    return (
                      <span>
                        {parsed.message ?? t('rateLimited')}{' '}
                        <a href="/my-api" className="underline font-medium">
                          {t('rateLimitedCta')}
                        </a>
                      </span>
                    )
                  }
                  if (parsed?.message) {
                    return <span>{parsed.message}</span>
                  }
                  if (
                    msg.includes('gateway_billing') ||
                    msg.includes('credit card') ||
                    msg.includes('customer_verification_required')
                  ) {
                    return (
                      <span>
                        Встроенные модели Aura требуют привязанную карту в Vercel AI Gateway.{' '}
                        <a href="/my-api" className="underline font-medium">
                          Добавьте свой API-ключ
                        </a>{' '}
                        и выберите его в селекторе модели.
                      </span>
                    )
                  }
                  // Friendly server-generated stream error (Russian text from
                  // the route's onError mapper, e.g. provider 429/401/5xx) —
                  // show it verbatim instead of a generic message.
                  if (/[а-яё]/i.test(msg)) {
                    return <span>{msg}</span>
                  }
                  if (msg.includes('rate_limit') || msg.includes('429')) {
                    return (
                      <span>
                        {t('rateLimited')}{' '}
                        <a href="/my-api" className="underline font-medium">
                          {t('rateLimitedCta')}
                        </a>
                      </span>
                    )
                  }
                  return t('chatError')
                })()}
                {/* Retry the failed request without retyping */}
                {!(error?.message ?? '').includes('rate_limit') && (
                  <button
                    type="button"
                    onClick={() => regenerate()}
                    className="mt-2 flex items-center gap-1.5 rounded-md border border-destructive/40 bg-background px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 active:scale-95 transition-all"
                  >
                    <RotateCcw className="size-3" />
                    {t('retry')}
                  </button>
                )}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto w-full max-w-2xl">
            {readOnly && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <Eye className="size-3.5 shrink-0" />
                {t('viewerModeNotice')}
              </div>
            )}
            {selectedElement && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs animate-in fade-in slide-in-from-bottom-1 duration-200">
                <span aria-hidden="true">🎯</span>
                <span className="truncate font-mono text-foreground">
                  {'<'}{selectedElement.tag}
                  {selectedElement.classes ? `.${selectedElement.classes.split(/\s+/)[0]}` : ''}{'>'}
                  {selectedElement.text ? ` «${selectedElement.text.slice(0, 40)}»` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedElement(null)}
                  className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Убрать элемент"
                >
                  ×
                </button>
              </div>
            )}
            {!readOnly && (
              <PromptBox
                onSubmit={handleSubmit}
                busy={busy}
                onStop={() => {
                  setWasStopped(true)
                  void stop()
                }}
                chatId={chatId}
              />
            )}
          </div>
        </div>
      </div>

      {/* Right panel — animated entry */}
      <div
        className={`min-w-0 flex-1 transition-all duration-500 ease-out ${
          chatCollapsed ? 'flex' : 'hidden md:flex'
        } ${
          panelVisible || chatCollapsed
            ? 'opacity-100 translate-x-0'
            : 'opacity-0 translate-x-8'
        }`}
      >
        {mode === 'ide' ? (
          <IdePanel
            chatId={chatId}
            files={ideFiles}
            initialFiles={initialFiles}
            busy={busy}
            openFileRequest={openFileReq}
            chatCollapsed={chatCollapsed}
            onToggleChat={() => setChatCollapsed((c) => !c)}
            onFixError={(errorText) => {
              if (busy) return
              setChatCollapsed(false)
              sendMessage({
                text: `Исправь эту ошибку из превью:\n\`\`\`\n${errorText.slice(0, 2000)}\n\`\`\``,
              })
            }}
            onElementSelect={(el) => {
              setSelectedElement(el)
              // On mobile bring the chat back so the user can type the request
              setChatCollapsed(false)
            }}
            projectName={title}
          />
        ) : (
          <PreviewPanel
            html={previewHtml}
            busy={busy}
            chatCollapsed={chatCollapsed}
            onToggleChat={() => setChatCollapsed((c) => !c)}
            projectName={title}
          />
        )}
      </div>

      {/* Mobile chat/preview switcher — the panel is otherwise unreachable on
          phones (the collapse toggle lives inside the hidden panel). */}
      <div className="md:hidden fixed bottom-20 left-1/2 z-40 -translate-x-1/2">
        <div className="flex items-center rounded-full border border-border bg-background/95 p-0.5 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setChatCollapsed(false)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all active:scale-95 ${
              !chatCollapsed ? 'bg-foreground text-background' : 'text-muted-foreground'
            }`}
          >
            <MessageSquare className="size-3.5" />
            {t('mobileChatTab')}
          </button>
          <button
            type="button"
            onClick={() => setChatCollapsed(true)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all active:scale-95 ${
              chatCollapsed ? 'bg-foreground text-background' : 'text-muted-foreground'
            }`}
          >
            <Eye className="size-3.5" />
            {t('mobilePreviewTab')}
          </button>
        </div>
      </div>
    </main>
  )
}
