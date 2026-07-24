/**
 * Server-authoritative design-interview state machine (pure function — unit
 * tested). The model proved unreliable at tracking this itself: it re-asked
 * "what to build / which style" in a loop, and weaker models asked the style
 * question even for greetings — so build-intent detection is deterministic.
 */
export type DesignState = 'ASK_DESIGN' | 'GENERATE_NOW' | 'EXISTING' | 'CHAT'

/**
 * Deterministic build-intent detector (RU/EN). Deliberately generous: verbs
 * of creation + typical artifact nouns. False positives only cause one extra
 * style question; false negatives fall back to the model's own judgement
 * (the CHAT prompt still allows generation when explicitly asked).
 */
export function hasBuildIntent(text: string): boolean {
  const t = text.toLowerCase()
  return /(созда|сдела|сгенер|построй|разработ|сверста|собери|запили|добав|измени|исправ|обнови|перепиш|перекрас|улучши|build|create|make|generate|scaffold|implement|redesign|fix|add |сайт|лендинг|страниц|приложени|дашборд|dashboard|интерфейс|компонент|виджет|форм[ауы]|игр[ауы]|портфолио|магазин|каталог|калькулятор|галере|таблиц|график|чарт|website|landing|page|app\b|ui\b|todo|form\b|game\b|store\b)/i.test(
    t,
  )
}

export function deriveDesignState(input: {
  /** The persistent FS already has files (import/seed counts too). */
  hasProjectFiles: boolean
  /** Prior assistant texts (joined per message). */
  assistantTexts: string[]
  /** The user's latest message text (build-intent gate for fresh chats). */
  latestUserText: string
}): DesignState {
  const hasGeneratedFiles =
    input.hasProjectFiles ||
    input.assistantTexts.some((t) => t.includes('```file:'))
  const alreadyAskedDesign = input.assistantTexts.some((t) =>
    t.includes('<design-choices'),
  )

  if (hasGeneratedFiles) return 'EXISTING'
  // The interview question was asked (chips emitted) — the user's message
  // answers it: generate, never re-ask in a loop.
  if (alreadyAskedDesign) return 'GENERATE_NOW'
  // Fresh project, no interview yet. Deterministic gate: only a message that
  // actually asks to build something triggers the style question. Greetings
  // and small talk («привет») get a plain conversational reply — weaker
  // models ignored a prompt-only gate, so it now lives in code.
  return hasBuildIntent(input.latestUserText) ? 'ASK_DESIGN' : 'CHAT'
}
