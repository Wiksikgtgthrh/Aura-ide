import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  simulateStreamingMiddleware,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type UIMessage,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { getSession } from '@/lib/session'
import { apiKeys, chats, preferences } from '@/lib/db/schema'
import { decryptSecret } from '@/lib/crypto'
import { getChatAccess } from '@/lib/chat-access'
import {
  createCheckpoint,
  loadChatMessagesFresh,
  loadProjectFiles,
  saveChatMessages,
  upsertProjectFilesFromMessages,
} from '@/lib/chat-store'
import { checkDailyBuiltinLimit, recordTokenUsage } from '@/lib/limits'
import { isSafeFetchUrl } from '@/lib/ssrf'
import { deriveDesignState } from '@/lib/design-state'
import { extractMemoriesFromExchange } from '@/lib/memory-extract'
import { getActivePluginContext } from '@/app/actions/plugins'
import { getActiveMcpServers } from '@/app/actions/mcp'
import { getActiveMemoriesForPrompt } from '@/app/actions/memories'
import { and, eq } from 'drizzle-orm'

export const maxDuration = 60

// Aura model ids -> AI Gateway model strings
const AURA_MODEL_MAP: Record<string, string> = {
  'aura-mini': 'google/gemini-2.5-flash-lite',
  'aura-pro': 'google/gemini-2.5-flash',
  'aura-max': 'anthropic/claude-sonnet-4.5',
  'aura-max-fast': 'anthropic/claude-haiku-4.5',
}

// ---- Provider error → human-readable chat message --------------------------

/**
 * Pull statusCode / provider message / retry-after out of an AI SDK error.
 * Works for both AI_APICallError and AI_RetryError (which wraps the
 * per-attempt errors in .errors/.lastError) without importing error classes.
 */
function extractApiError(err: unknown): {
  statusCode?: number
  providerMessage?: string
  retryAfterSec?: number
} {
  const wrapper = err as {
    lastError?: unknown
    errors?: unknown[]
  }
  const candidate = (wrapper?.lastError ??
    (Array.isArray(wrapper?.errors)
      ? wrapper.errors[wrapper.errors.length - 1]
      : undefined) ??
    err) as {
    statusCode?: number
    responseBody?: string
    responseHeaders?: Record<string, string>
    message?: string
  }

  const statusCode =
    typeof candidate?.statusCode === 'number' ? candidate.statusCode : undefined

  // Provider JSON body: {"error":{"message":"...","type":"...","code":"..."}}
  let providerMessage: string | undefined
  if (typeof candidate?.responseBody === 'string') {
    try {
      const parsed = JSON.parse(candidate.responseBody) as {
        error?: { message?: string } | string
        message?: string
      }
      providerMessage =
        typeof parsed.error === 'object' && parsed.error?.message
          ? parsed.error.message
          : typeof parsed.error === 'string'
            ? parsed.error
            : parsed.message
    } catch {
      /* not JSON */
    }
  }
  if (!providerMessage && typeof candidate?.message === 'string') {
    providerMessage = candidate.message
  }
  providerMessage = providerMessage?.slice(0, 300)

  const retryAfterRaw =
    candidate?.responseHeaders?.['retry-after'] ??
    candidate?.responseHeaders?.['Retry-After']
  const retryAfterSec = retryAfterRaw
    ? Number.parseInt(retryAfterRaw, 10)
    : undefined

  return {
    statusCode,
    providerMessage,
    retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
  }
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} сек`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} мин`
  return `${Math.round(minutes / 60)} ч`
}

/**
 * Map a model/provider error to a short, actionable message in the user's
 * language. This string is what the chat UI shows instead of a raw
 * AI_RetryError dump.
 */
function friendlyModelError(err: unknown, modelName: string): string {
  const { statusCode, providerMessage, retryAfterSec } = extractApiError(err)
  const provider = providerMessage ? ` Ответ провайдера: «${providerMessage}»` : ''

  if (statusCode === 429) {
    const wait =
      retryAfterSec && retryAfterSec > 0
        ? ` Провайдер просит подождать ~${formatWait(retryAfterSec)}.`
        : ''
    return `Провайдер модели «${modelName}» перегружен или лимит запросов исчерпан (429).${provider}.${wait} Попробуйте позже, выберите другую модель или другой API-ключ в селекторе модели.`
  }
  if (statusCode === 401 || statusCode === 403) {
    return `Провайдер отклонил API-ключ (${statusCode}).${provider}. Проверьте ключ и Base URL на странице «Мои API».`
  }
  if (statusCode === 402) {
    return `У провайдера закончился баланс (402).${provider}. Пополните счёт или используйте другой ключ.`
  }
  if (statusCode === 404) {
    return `Модель «${modelName}» не найдена у провайдера (404).${provider}. Проверьте ID модели на странице «Мои API».`
  }
  if (statusCode && statusCode >= 500) {
    return `Провайдер модели «${modelName}» временно недоступен (${statusCode}).${provider}. Повторите попытку позже.`
  }
  if (providerMessage) {
    return `Ошибка провайдера модели «${modelName}»: ${providerMessage}`
  }
  return 'Не удалось получить ответ от модели. Повторите попытку.'
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }
  const userId = session.user.id

  const {
    message,
    id,
    modelId,
    files,
    generateImages,
    activeSkills,
    autoPermissions,
  }: {
    message: UIMessage
    id: string
    modelId?: string
    files?: Array<{ name: string; type: string; dataUrl: string }>
    generateImages?: boolean
    activeSkills?: string[]
    autoPermissions?: string
  } = await req.json()

  // Owner or shared-project member. Viewers can read the chat page but may
  // not generate — only 'owner'/'edit' pass here.
  const access = await getChatAccess(id, userId)
  if (!access) {
    return new Response('Chat not found', { status: 404 })
  }
  if (access.level === 'read') {
    return new Response(
      JSON.stringify({
        error: 'read_only',
        message: 'У вас доступ только на просмотр этого проекта.',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const chat = access.chat

  // Helper: build an SDK model from a stored api key row.
  // IMPORTANT: use the Chat Completions interface (openai.chat) — the default
  // openai(...) call targets OpenAI's Responses API, which third-party
  // OpenAI-compatible endpoints (Groq, OpenRouter, LM Studio, …) don't serve.
  // With a custom baseUrl the request failed with a stream-format mismatch.
  // API keys are strictly PER-ACCOUNT (every query filters by userId — guests
  // included, a guest is a full account with its own keys).
  async function resolveUserKeyModel(keyId: number) {
    const [row] = await db
      .select({
        id: apiKeys.id,
        key: apiKeys.key,
        baseUrl: apiKeys.baseUrl,
        modelId: apiKeys.modelId,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
      .limit(1)
    if (!row) return null
    // SSRF guard: a custom baseUrl pointing at an internal address would let
    // the streamed response read the internal network. Reject unsafe targets.
    if (row.baseUrl && !(await isSafeFetchUrl(row.baseUrl))) return null
    const openai = createOpenAI({
      apiKey: decryptSecret(row.key),
      baseURL: row.baseUrl || undefined,
    })
    return { model: openai.chat(row.modelId || 'gpt-4o-mini'), keyId: row.id, modelName: row.modelId || 'gpt-4o-mini' }
  }

  // Helper: get the first user key as fallback
  async function getFirstUserKeyModel() {
    const [row] = await db
      .select({
        id: apiKeys.id,
        key: apiKeys.key,
        baseUrl: apiKeys.baseUrl,
        modelId: apiKeys.modelId,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(apiKeys.createdAt)
      .limit(1)
    if (!row) return null
    if (row.baseUrl && !(await isSafeFetchUrl(row.baseUrl))) return null
    const openai = createOpenAI({
      apiKey: decryptSecret(row.key),
      baseURL: row.baseUrl || undefined,
    })
    // Chat Completions interface — see resolveUserKeyModel note above.
    return { model: openai.chat(row.modelId || 'gpt-4o-mini'), keyId: row.id, modelName: row.modelId || 'gpt-4o-mini' }
  }

  // Resolve model: explicit user key > built-in Aura (Gateway) > first user key fallback.
  // usedApiKeyId tracks WHOSE credit is burned: a number = the account's own
  // key (never rate-limited), null = built-in Gateway model (daily limits).
  let model: Parameters<typeof streamText>[0]['model'] | null = null
  let usedApiKeyId: number | null = null
  let usedModelName = 'unknown'

  if (modelId?.startsWith('api-')) {
    // Explicit user key selected
    const keyId = Number.parseInt(modelId.slice(4), 10)
    if (Number.isFinite(keyId)) {
      const resolved = await resolveUserKeyModel(keyId)
      if (resolved) {
        model = resolved.model
        usedApiKeyId = resolved.keyId
        usedModelName = resolved.modelName
      }
    }
  }

  if (!model) {
    // Try to use a user key first (avoids Gateway billing requirement)
    const resolved = await getFirstUserKeyModel()
    if (resolved) {
      model = resolved.model
      usedApiKeyId = resolved.keyId
      usedModelName = resolved.modelName
    } else {
      // Fall back to AI Gateway built-in models
      const gatewayModelId = (modelId && AURA_MODEL_MAP[modelId])
        ? AURA_MODEL_MAP[modelId]
        : AURA_MODEL_MAP['aura-max']
      model = gatewayModelId
      usedModelName = gatewayModelId
    }
  }

  // Daily limit — ONLY for built-in Gateway models. Requests on the account's
  // own key are free for the platform and never limited.
  if (usedApiKeyId === null) {
    const isAnonymous =
      (session.user as { isAnonymous?: boolean | null }).isAnonymous === true
    const check = await checkDailyBuiltinLimit(userId, isAnonymous)
    if (!check.allowed) {
      return new Response(
        JSON.stringify({
          error: 'rate_limit',
          message: `Дневной лимит встроенных моделей исчерпан (${check.used}/${check.limit}). Добавьте свой API-ключ на странице «Мои API» — собственные ключи не ограничиваются.`,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }

  // Custom instructions, plugin rules, MCP servers and memories — fetched in parallel
  const [prefsRows, pluginRules, activeMcps, activeMemories] = await Promise.all([
    db
      .select({ customInstructions: preferences.customInstructions })
      .from(preferences)
      .where(eq(preferences.userId, userId))
      .limit(1),
    getActivePluginContext(userId),
    getActiveMcpServers(),
    getActiveMemoriesForPrompt(),
  ])
  const prefs = prefsRows[0]

  const isIde = chat.mode === 'ide'

  const HTML_PROMPT =
    'When the user asks you to build, create, or modify a website, page, UI, app, or any visual interface, respond with a SINGLE complete self-contained HTML document (inline <style> and <script>, no external files) inside one ```html code block. Keep any explanation outside the code block brief. When modifying, always return the full updated document.'

  const IDE_PROMPT = `You are Aura, a web IDE AI. You generate modular React 18 + TypeScript + Tailwind CSS + Lucide React projects.

## TECHNOLOGY STACK
- React 18 (TypeScript) — component-based, split into isolated files
- Tailwind CSS — utility classes only, no CSS files
- Lucide React — icons via \`import { IconName } from "lucide-react"\`
- Recharts — for charts/graphs via \`import { BarChart, ... } from "recharts"\`

## VIRTUAL FILE SYSTEM STRUCTURE
Follow this strict hierarchy for every project:

\`\`\`
src/
  main.tsx              ← DO NOT emit, handled by runtime
  App.tsx               ← Root component, imports everything
  index.css             ← DO NOT emit, handled by runtime
  mockData.ts           ← ALL static/demo data lives here
  components/
    ui/
      Button.tsx        ← Reusable primitives
      Card.tsx
    Sidebar.tsx         ← Layout structural elements
    MetricsChart.tsx    ← Complex isolated widgets
  hooks/
    useLocalStorage.ts  ← Custom hooks (only if needed)
\`\`\`

## CRITICAL OUTPUT RULES — follow exactly:
1. ALWAYS output every file using the EXACT format: \`\`\`file:src/App.tsx\n<code here>\n\`\`\`
2. NEVER output raw code blocks like \`\`\`tsx or \`\`\`jsx — ONLY \`\`\`file:path\`\`\` format.
3. NEVER put source code, imports, JSX, or file contents directly in the chat
   text. Code lives ONLY inside \`\`\`file: blocks (they are hidden from the chat and
   shown in the editor). Any code outside a file block is a BUG the user will see
   as noise. Your chat prose must be at most one short sentence.
4. The entry point MUST be \`src/App.tsx\` exporting \`export default function App()\`.
5. Use bare specifiers for external libs: \`"react"\`, \`"lucide-react"\`, \`"recharts"\`.
6. Use RELATIVE paths for your own files: \`"./mockData"\`, \`"./components/ui/Card"\`.
7. When modifying, re-emit ONLY the changed files in \`\`\`file:path\`\`\` format.

## GENERATION ALGORITHM (always follow these steps):

### Step 1 — mockData.ts (if any demo data needed)
Extract ALL static data (arrays, objects, constants) into \`src/mockData.ts\`.
\`\`\`file:src/mockData.ts
export interface SaleData { month: string; sales: number; }
export const monthlySales: SaleData[] = [
  { month: 'Jan', sales: 4000 },
  { month: 'Feb', sales: 3000 },
];
\`\`\`

### Step 2 — Atomic UI components (src/components/)
Create small, reusable UI primitives first:
\`\`\`file:src/components/ui/Card.tsx
import React from "react";
interface CardProps { title: string; value: string; icon: React.ReactNode; }
export function Card({ title, value, icon }: CardProps) {
  return (
    <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-400">{title}</p>
        <h3 className="text-2xl font-bold text-white mt-1">{value}</h3>
      </div>
      <div className="p-3 bg-slate-800 rounded-lg text-blue-400">{icon}</div>
    </div>
  );
}
\`\`\`

### Step 3 — Compose in App.tsx
Import from your own files using relative paths:
\`\`\`file:src/App.tsx
import React, { useState } from "react";
import { DollarSign, Users } from "lucide-react";
import { Card } from "./components/ui/Card";
import { monthlySales } from "./mockData";
export default function App() {
  const [view, setView] = useState("overview");
  return (
    <div className="min-h-screen bg-black text-white flex">
      <aside className="w-64 border-r border-slate-800 p-4">
        <button onClick={() => setView("overview")} className="w-full p-2 text-left rounded-lg hover:bg-slate-900">Overview</button>
      </aside>
      <main className="flex-1 p-8 grid grid-cols-2 gap-6">
        <Card title="Revenue" value="$24,500" icon={<DollarSign size={20} />} />
        <Card title="Users" value="1,240" icon={<Users size={20} />} />
      </main>
    </div>
  );
}
\`\`\`

## COMPONENT ISOLATION RULE
- If the user says "fix the chart" — re-emit ONLY \`src/components/MetricsChart.tsx\`
- If the user says "update the sidebar" — re-emit ONLY \`src/components/Sidebar.tsx\`
- Never re-emit unchanged files

## DESIGN INTERVIEW — STRICT STATE MACHINE
A "PROJECT STATE" line is appended to these instructions on every request. It is
AUTHORITATIVE — obey it exactly. There are three states:

### STATE = ASK_DESIGN
No project files exist and the design interview has not happened yet. FIRST
classify the user's latest message, then follow exactly ONE branch:

A) The message asks to BUILD or CREATE something (site, app, UI, dashboard,
   component, game, …):
   - If it ALREADY describes the desired style/look («в стиле минимализм»,
     «тёмный», «как у Apple», …) — do NOT ask anything. Act as GENERATE_NOW
     below: emit the complete project immediately.
   - Otherwise: do NOT generate files yet. In ONE short sentence (user's
     language) ask ONLY which visual style they prefer — never ask what to
     build, you already know. End the reply with EXACTLY this machine-readable
     block on its own line (renders as clickable chips), labels localized,
     last one "Другой"/"Other":
<design-choices>Минимализм|Тёмный дашборд|Яркий и игривый|Корпоративный|Glassmorphism|Другой</design-choices>

B) The message is NOT a build request (greeting like «привет», small talk, a
   general question): just respond naturally and helpfully in the user's
   language. NO design question, NO <design-choices> block, NO \`\`\`file:
   blocks. You may close with one short sentence inviting them to describe
   what they want to build.

### STATE = GENERATE_NOW
The design question was already asked. If the user's latest message answers it
(a chip label, any style description, or "surprise me") or is a build
instruction — you MUST generate the COMPLETE project immediately — full file
hierarchy (mockData.ts → components → App.tsx) per the rules above. In that
case it is FORBIDDEN to ask any question or reply with prose only: the reply
MUST contain \`\`\`file: blocks. Emit at most one short sentence of intro, then
the files. NEVER re-ask what to build or which style — the decision is made.
Exception: if the latest message clearly changed the topic (unrelated question
or chat), answer it briefly, then repeat the style question ending with the
same <design-choices> block.

### STATE = EXISTING
Files already exist. Never run the interview again. Apply the requested change
per the COMPONENT ISOLATION RULE, re-emitting only the changed \`\`\`file: blocks.
A "CURRENT PROJECT FILES" section is appended below — it is the LIVE state of
the project including the user's manual edits in the editor. Base every change
on those contents, never on older versions from this conversation.

## NEXT-STEP SUGGESTIONS
Whenever your reply emits \`\`\`file: blocks (GENERATE_NOW or EXISTING), END the
reply with EXACTLY one machine-readable block on its own line containing 2-3
SHORT concrete next improvements for THIS project, in the user's language
(each ≤ 4 words, rendered as clickable chips):
<next-steps>Добавь тёмную тему|Сделай адаптивную вёрстку|Наполни реальными данными</next-steps>
Tailor the suggestions to the actual project — never repeat ones already done.
Do NOT emit this block when you did not emit files.`

  // Skills → extra instructions
  const skillInstructions: string[] = []
  if (activeSkills?.includes('web-search')) {
    skillInstructions.push('Web Search skill: when the user asks for current information, embed a search intent marker <search>query</search> in your response and answer as if you searched the web.')
  }
  if (activeSkills?.includes('code-interpreter')) {
    skillInstructions.push('Code Interpreter skill: when asked to analyse data, write Python code inside ```python blocks and simulate the execution result below it.')
  }
  if (activeSkills?.includes('diagrams')) {
    skillInstructions.push('Diagrams skill: when asked for diagrams or charts, use Mermaid.js syntax inside ```mermaid blocks.')
  }

  // generateImages flag
  const imageInstruction = generateImages === false
    ? 'Do NOT generate or suggest image URLs. Avoid <img> tags unless absolutely necessary.'
    : 'You may include <img> tags with descriptive alt text and placeholder src when relevant.'

  // autoPermissions
  const permissionInstruction = autoPermissions === 'allow-all'
    ? 'AutoPermissions: ALLOW_ALL — proceed with all tool calls and side effects without asking the user for confirmation.'
    : 'AutoPermissions: ASK — always ask the user before executing irreversible actions or tool calls.'

  const instructions = [
    'You are Aura, a helpful AI assistant. Answer in the language the user writes in.',
    isIde ? IDE_PROMPT : HTML_PROMPT,
    imageInstruction,
    permissionInstruction,
    skillInstructions.length > 0 ? skillInstructions.join('\n') : undefined,
    activeMemories.length > 0
      ? `User memories (facts about the user, their preferences, and coding style):\n${activeMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
      : undefined,
    prefs?.customInstructions?.trim(),
    pluginRules.length > 0
      ? `Active plugin rules:\n${pluginRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : undefined,
    activeMcps.length > 0
      ? `Active MCP servers (external tools the user has connected):\n${activeMcps.map((s) => `- ${s.name}: ${s.url}`).join('\n')}\nYou may reference these servers when the user asks to use external tools or data.`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n')

  // Attach uploaded files: images as vision content, text files injected as text parts
  let enrichedMessage = message
  if (files && files.length > 0) {
    const textFiles = files.filter((f) => !f.type.startsWith('image/'))
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))

    const extraParts: Array<Record<string, unknown>> = []

    for (const tf of textFiles) {
      // Decode base64 data URL to text
      const base64 = tf.dataUrl.split(',')[1] ?? ''
      const decoded = Buffer.from(base64, 'base64').toString('utf-8').slice(0, 8000)
      extraParts.push({ type: 'text', text: `[Attached file: ${tf.name}]\n\`\`\`\n${decoded}\n\`\`\`` })
    }

    for (const img of imageFiles) {
      // Pass image as base64 image part (AI SDK multimodal)
      const base64 = img.dataUrl.split(',')[1] ?? ''
      extraParts.push({ type: 'image', image: base64, mimeType: img.type })
    }

    if (extraParts.length > 0) {
      enrichedMessage = {
        ...message,
        parts: [...(message.parts ?? []), ...extraParts],
      } as UIMessage
    }
  }

  const storedMessages = await loadChatMessagesFresh(id)

  // Regenerate/retry dedupe: when the client re-sends a message that already
  // exists in history (useChat regenerate re-posts the last user message),
  // drop the stored copy AND everything after it — otherwise the model sees
  // the old assistant answer plus a duplicated user turn.
  const dupIdx = storedMessages.findIndex((m) => m.id === enrichedMessage.id)
  const previousMessages =
    dupIdx >= 0 ? storedMessages.slice(0, dupIdx) : storedMessages
  const allMessages = [...previousMessages, enrichedMessage]

  // ---- Deterministic design-interview state machine (server-authoritative) ----
  // The model is unreliable at tracking interview state on its own (it re-asked
  // "what to build / which style" in a loop). We compute the state from history:
  const assistantMessages = previousMessages.filter((m) => m.role === 'assistant')
  const assistantText = (m: UIMessage) =>
    (m.parts ?? [])
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('\n')

  // The persistent FS is loaded up front: it both detects EXISTING projects
  // (e.g. a chat that got files via import/seed without any messages) and
  // feeds the live file contents into the model context below.
  const projectFs = isIde ? await loadProjectFiles(id) : {}

  const designState = deriveDesignState({
    hasProjectFiles: Object.keys(projectFs).length > 0,
    assistantTexts: assistantMessages.map(assistantText),
  })

  // ---- Current project files → model context -------------------------------
  // The DB is the source of truth for the virtual FS (it includes the user's
  // MANUAL edits from Monaco, which message history does not). Give the model
  // the live state so it never overwrites user edits with stale code.
  let filesContext = ''
  if (isIde && designState === 'EXISTING') {
    const entries = Object.entries(projectFs)
    if (entries.length > 0) {
      const MAX_TOTAL = 48_000
      const MAX_PER_FILE = 8_000
      let budget = MAX_TOTAL
      const sections: string[] = []
      for (const [path, content] of entries) {
        if (budget <= 0) {
          sections.push(`// …${entries.length - sections.length} more files omitted`)
          break
        }
        const slice = content.slice(0, Math.min(MAX_PER_FILE, budget))
        const truncated = slice.length < content.length ? '\n// …truncated' : ''
        sections.push(`--- ${path} ---\n${slice}${truncated}`)
        budget -= slice.length
      }
      filesContext = `\n\nCURRENT PROJECT FILES (ground truth — includes the user's manual edits made in the editor; treat these as the latest code, NOT your own older messages):\n${sections.join('\n\n')}`
    }
  }

  const finalInstructions = isIde
    ? `${instructions}\n\nPROJECT STATE: ${designState}${filesContext}`
    : instructions

  const isFirstExchange = previousMessages.length === 0
  const firstUserText = (enrichedMessage.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join(' ')
    .slice(0, 300)

  // Bound the history sent to the model: on long chats the full transcript is
  // needless cost/latency (design state + live files already come from the DB
  // and are injected above). Keep the trailing window + the new message.
  const MODEL_HISTORY_WINDOW = 24
  const windowedMessages =
    allMessages.length > MODEL_HISTORY_WINDOW
      ? allMessages.slice(-MODEL_HISTORY_WINDOW)
      : allMessages

  try {
    // Strip UI-only data parts (e.g. the persisted data-usage token summary)
    // before converting to model messages — the converter must only see
    // standard text/file parts.
    const modelMessages = await convertToModelMessages(
      windowedMessages.map((m) => ({
        ...m,
        parts: (m.parts ?? []).filter(
          (p) => !String((p as { type: string }).type).startsWith('data-'),
        ),
      })) as typeof windowedMessages,
    )

    // Total tokens of THIS reply — filled by streamText onFinish, streamed to
    // the client via messageMetadata and persisted as a data-usage part.
    const usageHolder: { totalTokens: number | null } = { totalTokens: null }

    const startStream = (
      m: Parameters<typeof streamText>[0]['model'],
      retries: number,
    ) =>
      streamText({
        model: m,
        // One retry only. The SDK default (2 retries with backoff) blindly
        // re-sent requests even on a 429 whose retry-after was ~5 HOURS —
        // the user just stared at a spinner for ~10s before the same error.
        maxRetries: retries,
        // Compact one-line server log instead of the SDK's default multi-page
        // AI_RetryError/AI_APICallError dump. The user-facing message is built
        // separately in toUIMessageStream({ onError }) below.
        onError: ({ error }) => {
          const { statusCode, providerMessage, retryAfterSec } = extractApiError(error)
          console.error(
            `[chat] provider error: model=${usedModelName} status=${statusCode ?? 'n/a'}` +
              (retryAfterSec ? ` retry-after=${retryAfterSec}s` : '') +
              (providerMessage ? ` message=${JSON.stringify(providerMessage)}` : ''),
          )
        },
        instructions: finalInstructions,
        messages: modelMessages,
        onFinish: ({ usage }) => {
          // Token accounting — per account (guests too). Own-key usage carries
          // the key id; built-in Gateway usage has apiKeyId NULL (rate-limited).
          const u = usage as unknown as {
            inputTokens?: number
            outputTokens?: number
            promptTokens?: number
            completionTokens?: number
          }
          const promptTokens = u?.inputTokens ?? u?.promptTokens ?? 0
          const completionTokens = u?.outputTokens ?? u?.completionTokens ?? 0
          usageHolder.totalTokens = promptTokens + completionTokens || null
          void recordTokenUsage({
            userId,
            chatId: id,
            apiKeyId: usedApiKeyId,
            modelId: usedModelName,
            promptTokens,
            completionTokens,
          })
        },
      })

    const primary = startStream(model, 1)

    // ---- Streaming → non-streaming fallback ---------------------------------
    // Some OpenAI-compatible proxies (codex.sale и др.) serve stream:true and
    // stream:false from DIFFERENT upstream pools: the non-streaming path works
    // while the streaming one returns 429/503. The key checker sends a
    // non-streaming request, so keys show «работает», while the chat
    // (stream:true) fails — both observations are real. Peek at the head of
    // the stream: if the request died with a retriable provider error on the
    // user's own key, retry ONCE with simulateStreamingMiddleware — a plain
    // non-streaming HTTP call whose result is streamed to the client.
    const stream = await (async () => {
      const reader = primary.stream.getReader()
      type Part = NonNullable<Awaited<ReturnType<typeof reader.read>>['value']>
      const buffered: Part[] = []
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffered.push(value)
          const part = value as { type: string; error?: unknown }
          if (part.type === 'error') {
            const { statusCode } = extractApiError(part.error)
            const retriable =
              statusCode === 429 ||
              (typeof statusCode === 'number' && statusCode >= 500)
            if (retriable && usedApiKeyId !== null && typeof model !== 'string') {
              console.error(
                `[chat] streaming call failed (${statusCode}) — retrying via non-streaming fallback`,
              )
              void reader.cancel().catch(() => {})
              const fallback = startStream(
                wrapLanguageModel({
                  model,
                  middleware: simulateStreamingMiddleware(),
                }),
                0,
              )
              return fallback.stream
            }
            break // non-retriable — pass the error part through to the client
          }
          // 'start' / 'start-step' are pre-request bookkeeping; any other part
          // means the provider is answering — stop peeking, pass through.
          if (part.type !== 'start' && part.type !== 'start-step') break
        }
      } catch {
        /* stream threw synchronously — pass through whatever is buffered */
      }
      return new ReadableStream<Part>({
        start(controller) {
          for (const p of buffered) controller.enqueue(p)
        },
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) controller.close()
          else controller.enqueue(value)
        },
        cancel(reason) {
          return reader.cancel(reason)
        },
      })
    })()

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream,
        originalMessages: allMessages,
        // Errors thrown mid-stream (the route already returned 200 by then)
        // become an error part in the UI stream. Without this mapper the
        // client showed a raw technical dump / generic text.
        onError: (error: unknown) => friendlyModelError(error, usedModelName),
        // Live token count for the reply summary in the chat (v0-style).
        messageMetadata: ({ part }) => {
          const p = part as {
            type: string
            totalUsage?: {
              totalTokens?: number
              inputTokens?: number
              outputTokens?: number
            }
          }
          if (p.type === 'finish') {
            const u = p.totalUsage
            const total =
              u?.totalTokens ?? (u ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0) : 0)
            if (total > 0) return { totalTokens: total }
          }
          return undefined
        },
        onEnd: ({ messages: savedMessages }) => {
          // Persist the token count inside the message parts (the metadata
          // itself is not stored) so the summary survives a reload.
          const last = savedMessages[savedMessages.length - 1]
          if (last?.role === 'assistant' && usageHolder.totalTokens) {
            const parts = last.parts as unknown as Array<Record<string, unknown>>
            if (!parts.some((p) => p.type === 'data-usage')) {
              parts.push({
                type: 'data-usage',
                data: { totalTokens: usageHolder.totalTokens },
              })
            }
          }
          void saveChatMessages(id, savedMessages)
          // Keep the persistent virtual FS in sync with what the model just
          // generated — even if the user closes the tab mid-stream. When the
          // reply changed files, snapshot a version checkpoint (history/rollback).
          const lastAssistant = savedMessages[savedMessages.length - 1]
          const emittedFiles =
            lastAssistant?.role === 'assistant' &&
            (lastAssistant.parts ?? []).some(
              (p) => p.type === 'text' && (p as { text: string }).text.includes('```file:'),
            )
          void upsertProjectFilesFromMessages(id, savedMessages)
            .then(() => {
              if (emittedFiles) {
                return createCheckpoint(id, firstUserText.slice(0, 80) || 'AI changes')
              }
            })
            .catch(() => {})

          // Memory auto-extraction (opt-in via Settings → Memory)
          const assistantReplyText =
            lastAssistant?.role === 'assistant'
              ? (lastAssistant.parts ?? [])
                  .filter((p) => p.type === 'text')
                  .map((p) => (p as { text: string }).text)
                  .join('\n')
              : ''
          if (firstUserText && assistantReplyText) {
            void extractMemoriesFromExchange({
              userId,
              model,
              userText: firstUserText,
              assistantText: assistantReplyText,
            })
          }

          // Auto-title after the FIRST exchange: short, human-readable name
          // instead of the raw truncated prompt. Best-effort — any failure
          // (billing, network) silently keeps the old title.
          if (isFirstExchange && firstUserText) {
            void (async () => {
              try {
                const { text } = await generateText({
                  model,
                  // Best-effort side task — never burn retries on it (a
                  // rate-limited provider would otherwise be hit 3 more times).
                  maxRetries: 0,
                  prompt: `Придумай короткое название проекта (2–4 слова, без кавычек, без точки в конце) по запросу пользователя: "${firstUserText}". Ответь ТОЛЬКО названием, на языке запроса.`,
                })
                const title = text.trim().replace(/^["'«]+|["'»]+$/g, '').slice(0, 60)
                if (title && title.length >= 3) {
                  await db.update(chats).set({ title }).where(eq(chats.id, id))
                  revalidateTag('chats', 'max')
                }
              } catch {
                /* keep default title */
              }
            })()
          }
        },
      }),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isGatewayBilling =
      msg.includes('credit card') || msg.includes('customer_verification_required')
    if (isGatewayBilling) {
      return new Response(
        JSON.stringify({
          error: 'gateway_billing',
          message:
            'Для использования встроенных моделей Aura необходимо привязать карту в Vercel AI Gateway. Перейдите на страницу «Мои API», добавьте свой API-ключ и выберите его в селекторе модели.',
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw err
  }
}
