import 'server-only'
import { assertSafeFetchUrl } from '@/lib/ssrf'

/**
 * Общая логика проверки OpenAI-совместимых API-ключей.
 *
 * Используется и в «Моих API» (пользовательские ключи, app/actions/api-keys),
 * и в админке при массовой загрузке ключей в тарифы (app/actions/admin →
 * platform_api_keys). Держим её в одном месте, чтобы поведение пробы
 * (таймауты, разбор ошибок провайдера) не расходилось.
 */

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_MODEL_ID = 'gpt-4o-mini'

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export function normalizeBaseUrl(input: string | undefined | null): string {
  const v = (input ?? '').trim()
  if (!v) return DEFAULT_BASE_URL
  // strip trailing slash
  return v.replace(/\/+$/, '')
}

/** «Один ключ на строку» → чистый список (без пустых строк и пробелов). */
export function parseKeyLines(text: string, max = 100): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max)
}

/** Список моделей из строк/строки: разделители — запятая, «;», перенос строки. */
export function parseModelList(models: string[] | string, max = 20): string[] {
  const arr = Array.isArray(models) ? models : [models]
  return arr
    .flatMap((m) => m.split(/[,;\n]/))
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, max)
}

export type ModelProbeResult = {
  ok: boolean
  ping: number | null
  httpStatus?: number
  providerMessage?: string
}

/**
 * Проба КОНКРЕТНОЙ модели однотокеновым chat completion. Ключ может отдавать
 * /models, но не иметь доступа к нужной модели — поэтому проверяем именно её.
 */
export async function probeModel(
  rawKey: string,
  baseUrl: string,
  modelId: string,
): Promise<ModelProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  const started = Date.now()
  try {
    const safe = await assertSafeFetchUrl(normalizeBaseUrl(baseUrl))
    const res = await fetch(`${safe}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rawKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    })
    const ping = Date.now() - started
    if (res.ok) return { ok: true, ping }
    // Показываем СОБСТВЕННОЕ сообщение провайдера («Invalid API key»,
    // «insufficient quota», …) — чтобы было видно, ПОЧЕМУ ключ не работает.
    let providerMessage: string | undefined
    const bodyText = await res.text().catch(() => '')
    try {
      const parsed = JSON.parse(bodyText) as {
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
    if (!providerMessage && bodyText) providerMessage = bodyText
    return {
      ok: false,
      ping: null,
      httpStatus: res.status,
      providerMessage: providerMessage?.slice(0, 140),
    }
  } catch {
    return { ok: false, ping: null }
  } finally {
    clearTimeout(timeout)
  }
}

/** Человекочитаемая причина провала пробы, включая слова провайдера. */
export function probeFailReason(
  modelId: string,
  probe: { httpStatus?: number; providerMessage?: string },
): string {
  const status = probe.httpStatus ? `HTTP ${probe.httpStatus}` : 'сеть/таймаут'
  const detail = probe.providerMessage ? ` — ${probe.providerMessage}` : ''
  return `Модель ${modelId}: ${status}${detail}`
}

/**
 * Прогоняет ключ по списку моделей-кандидатов, возвращает первую рабочую.
 * failReason — причина последнего провала (для диагностики).
 */
export async function findWorkingModel(
  rawKey: string,
  baseUrl: string,
  models: string[],
): Promise<{ workingModel: string | null; ping: number | null; failReason: string | null }> {
  let failReason: string | null = null
  for (const model of models) {
    const r = await probeModel(rawKey, baseUrl, model)
    if (r.ok) return { workingModel: model, ping: r.ping, failReason: null }
    failReason = probeFailReason(model, r)
  }
  return { workingModel: null, ping: null, failReason }
}
