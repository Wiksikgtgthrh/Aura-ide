import { NextResponse } from 'next/server'
import type { UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { chats } from '@/lib/db/schema'
import { getSession } from '@/lib/session'
import { generateWithFarm, getFarmModels, saveFarmFilesToProject } from '@/lib/farm'
import { createChatForUser, loadChatMessagesFresh, saveChatMessages } from '@/lib/chat-store'

// v0 генерирует синхронно (до 10 минут). 300s — потолок Fluid Compute;
// на Hobby Vercel значение ужмётся до лимита плана, локально не влияет.
export const maxDuration = 300

/**
 * POST /api/farm/generate
 * { prompt, systemPrompt?, chatId? } → { ok, chatId, savedFiles, files, webUrl }
 * Генерация через пул ключей V0 Farm: при исчерпании ключ уходит в кулдаун,
 * промпт продолжается на следующем готовом ключе; файлы пишутся в
 * project_files чата IDE — превью и редактор подхватывают их автоматически.
 */
export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const prompt = String(body?.prompt ?? '').trim().slice(0, 8000)
  if (!prompt) {
    return NextResponse.json({ ok: false, error: 'Пустой промпт' }, { status: 400 })
  }
  const systemPrompt = body?.systemPrompt ? String(body.systemPrompt).slice(0, 4000) : undefined
  const chatIdIn = body?.chatId ? String(body.chatId) : undefined
  const modelIdIn = body?.modelId ? String(body.modelId) : undefined

  // Продолжение возможно только в свой чат
  if (chatIdIn) {
    const owner = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, chatIdIn), eq(chats.userId, session.user.id)))
    if (owner.length === 0) {
      return NextResponse.json({ ok: false, error: 'Чат не найден' }, { status: 404 })
    }
  }

  // Модель выбирается из настроек админки (farm_models) и передаётся в API v0
  let v0ModelId: string | undefined
  if (modelIdIn) {
    const models = await getFarmModels()
    const model = models.find((m) => m.id === modelIdIn && m.enabled)
    if (!model) {
      return NextResponse.json({ ok: false, error: 'Модель не найдена' }, { status: 400 })
    }
    v0ModelId = model.v0ModelId
  }

  const result = await generateWithFarm({
    userId: session.user.id,
    prompt,
    systemPrompt,
    chatId: chatIdIn,
    modelId: v0ModelId,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 502 })
  }

  // Чат IDE: создаём новый или продолжаем существующий, файлы — в проект.
  const chatId = chatIdIn ?? (await createChatForUser(session.user.id, prompt.slice(0, 60), 'ide'))
  const saved = await saveFarmFilesToProject(chatId, result.files)

  const userMsg: UIMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: prompt }],
  }
  const assistantMsg: UIMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [{ type: 'text', text: result.assistantText }],
  }
  const existing = await loadChatMessagesFresh(chatId)
  await saveChatMessages(chatId, [...existing, userMsg, assistantMsg])

  return NextResponse.json({
    ok: true,
    chatId,
    savedFiles: saved,
    files: result.files.map((f) => f.path),
    webUrl: result.webUrl,
  })
}
