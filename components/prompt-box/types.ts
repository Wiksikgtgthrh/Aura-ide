export type AttachedFile = {
  name: string
  type: string
  dataUrl: string
  size: number
}

export type PromptBoxSubmitPayload = {
  text: string
  modelId: string
  files: AttachedFile[]
  generateImages: boolean
  activeSkills: string[]
  autoPermissions: string
}

export const SKILL_IDS = ['web-search', 'code-interpreter', 'diagrams'] as const
export type SkillId = typeof SKILL_IDS[number]
