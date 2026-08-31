// Model pricing table (cost per 1K tokens in USD)
// Sources: public pricing pages as of mid-2025
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o':                     { input: 0.005,    output: 0.015 },
  'gpt-4o-mini':                { input: 0.00015,  output: 0.0006 },
  'gpt-4-turbo':                { input: 0.01,     output: 0.03 },
  'gpt-4':                      { input: 0.03,     output: 0.06 },
  'gpt-3.5-turbo':              { input: 0.0005,   output: 0.0015 },
  'o1':                         { input: 0.015,    output: 0.06 },
  'o1-mini':                    { input: 0.003,    output: 0.012 },
  'o3-mini':                    { input: 0.0011,   output: 0.0044 },
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 0.003,    output: 0.015 },
  'claude-3-5-haiku-20241022':  { input: 0.0008,   output: 0.004 },
  'claude-3-opus-20240229':     { input: 0.015,    output: 0.075 },
  'claude-3-haiku-20240307':    { input: 0.00025,  output: 0.00125 },
  // Google
  'gemini-1.5-pro':             { input: 0.00125,  output: 0.005 },
  'gemini-1.5-flash':           { input: 0.000075, output: 0.0003 },
  'gemini-2.0-flash':           { input: 0.0001,   output: 0.0004 },
  // Meta (via OpenRouter/Together)
  'llama-3.3-70b-instruct':     { input: 0.00059,  output: 0.00079 },
  'llama-3.1-8b-instruct':      { input: 0.00006,  output: 0.00006 },
  // Mistral
  'mistral-large-latest':       { input: 0.002,    output: 0.006 },
  'mistral-small-latest':       { input: 0.0002,   output: 0.0006 },
  // DeepSeek
  'deepseek-chat':              { input: 0.00027,  output: 0.0011 },
  'deepseek-coder':             { input: 0.00014,  output: 0.00028 },
}

/** Returns cost in USD for given tokens and model. Returns null if model unknown. */
export function estimateCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  let pricing = MODEL_PRICING[modelId]
  if (!pricing) {
    const prefix = Object.keys(MODEL_PRICING).find((k) => modelId.startsWith(k))
    if (prefix) pricing = MODEL_PRICING[prefix]
  }
  if (!pricing) return null
  return (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output
}
