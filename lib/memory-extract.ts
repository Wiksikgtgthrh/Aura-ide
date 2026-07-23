import 'server-only'
import { generateText } from 'ai'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories, preferences } from '@/lib/db/schema'

type ChatModel = Parameters<typeof generateText>[0]['model']

/**
 * Auto-extraction of memories (Settings → Memory → "Автоизвлечение").
 *
 * Called best-effort from the chat stream's onEnd: asks the SAME model that
 * served the chat to distill 0–2 durable facts about the user (preferences,
 * stack choices, style) from the latest exchange, dedupes against existing
 * memories and stores them with source='auto-extracted'.
 *
 * Never throws — memory extraction must not break or slow down the chat.
 */
export async function extractMemoriesFromExchange(input: {
  userId: string
  model: ChatModel
  userText: string
  assistantText: string
}): Promise<void> {
  try {
    const [prefsRow] = await db
      .select({
        enabled: preferences.memoriesEnabled,
        autoExtract: preferences.memoriesAutoExtract,
        maxCount: preferences.memoriesMaxCount,
      })
      .from(preferences)
      .where(eq(preferences.userId, input.userId))
      .limit(1)

    // Off by default — only run when the user explicitly enabled it.
    if (!prefsRow?.enabled || !prefsRow?.autoExtract) return

    // Respect the max active memories budget.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(memories)
      .where(and(eq(memories.userId, input.userId), eq(memories.enabled, true)))
    if (count >= (prefsRow.maxCount ?? 25)) return

    const { text } = await generateText({
      model: input.model,
      prompt: `Проанализируй обмен сообщениями и выдели ДОЛГОСРОЧНЫЕ факты о пользователе, полезные в будущих чатах: предпочтения по дизайну/стеку/стилю кода, контекст его проектов. НЕ выделяй разовые задачи и детали текущего запроса.

Сообщение пользователя: "${input.userText.slice(0, 600)}"
Суть ответа ассистента: "${input.assistantText.replace(/```[\s\S]*?```/g, '[код]').slice(0, 400)}"

Ответь СТРОГО JSON-массивом из 0–2 коротких фактов на языке пользователя, например: ["Предпочитает тёмные минималистичные интерфейсы"]. Если долгосрочных фактов нет — ответь [].`,
    })

    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return
    const facts = (JSON.parse(jsonMatch[0]) as unknown[])
      .filter((f): f is string => typeof f === 'string')
      .map((f) => f.trim())
      .filter((f) => f.length >= 8 && f.length <= 300)
      .slice(0, 2)
    if (facts.length === 0) return

    // Dedupe: skip facts that already exist (case-insensitive substring match)
    const existing = await db
      .select({ content: memories.content })
      .from(memories)
      .where(eq(memories.userId, input.userId))
    const known = existing.map((m) => m.content.toLowerCase())

    const fresh = facts.filter((f) => {
      const low = f.toLowerCase()
      return !known.some((k) => k.includes(low) || low.includes(k))
    })
    if (fresh.length === 0) return

    await db.insert(memories).values(
      fresh.map((content) => ({
        userId: input.userId,
        type: 'preference',
        content,
        source: 'auto-extracted',
      })),
    )
  } catch {
    // best-effort by design
  }
}
