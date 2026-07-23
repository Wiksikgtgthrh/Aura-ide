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
  // Any prior assistant turn in a fileless project was the interview question
  // — the user's current message answers it: generate, never loop.
  if (alreadyAskedDesign || input.assistantTexts.length > 0) return 'GENERATE_NOW'
  return 'ASK_DESIGN'
}
