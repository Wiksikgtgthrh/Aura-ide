/**
 * Server-authoritative design-interview state machine (pure function — unit
 * tested). The model proved unreliable at tracking this itself: it re-asked
 * "what to build / which style" in a loop.
 */
export type DesignState = 'ASK_DESIGN' | 'GENERATE_NOW' | 'EXISTING'

export function deriveDesignState(input: {
  /** The persistent FS already has files (import/seed counts too). */
  hasProjectFiles: boolean
  /** Prior assistant texts (joined per message). */
  assistantTexts: string[]
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
  // No files and no design question yet — stay in ASK_DESIGN. The prompt
  // gates the question on intent: a build request triggers the style
  // question, while greetings/small talk («привет») get a normal reply.
  // Previously ANY prior assistant turn forced GENERATE_NOW here, so a chat
  // that started with small talk spawned an unwanted project on message #2.
  return 'ASK_DESIGN'
}
