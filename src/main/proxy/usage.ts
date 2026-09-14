/**
 * Token usage normalization and extraction helpers.
 * Used to accumulate per-provider token statistics from proxy responses.
 */

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** True when approximated locally because the provider reported no usage */
  estimated?: boolean
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Normalize a provider/OpenAI usage object into TokenUsage.
 * Returns null when the usage is missing or a placeholder (all zeros).
 */
export function normalizeUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  const promptTokens = toCount(record.prompt_tokens)
  const completionTokens = toCount(record.completion_tokens)
  const totalRaw = toCount(record.total_tokens)
  const totalTokens = totalRaw > 0 ? totalRaw : promptTokens + completionTokens
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null
  }
  return { promptTokens, completionTokens, totalTokens }
}

/**
 * Extract the final usage from collected SSE stream content.
 * Scans data chunks from the end and returns the first real usage found.
 */
export function parseSseUsage(collected: string): TokenUsage | null {
  if (!collected) {
    return null
  }
  const lines = collected.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('data:')) {
      continue
    }
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      continue
    }
    try {
      const parsed = JSON.parse(payload)
      const usage = normalizeUsage(parsed?.usage)
      if (usage) {
        return usage
      }
    } catch {
      // ignore malformed chunks
    }
  }
  return null
}

/**
 * Extract and concatenate assistant delta content from collected SSE output.
 */
export function extractSseText(collected: string): string {
  if (!collected) return ''
  let out = ''
  for (const line of collected.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const parsed = JSON.parse(payload)
      const choices = parsed?.choices
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          const content = choice?.delta?.content ?? choice?.message?.content
          if (typeof content === 'string') out += content
        }
      }
    } catch {
      // ignore malformed chunks
    }
  }
  return out
}

/**
 * Approximate token count for a piece of text (~4 chars per token, min 1).
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/**
 * Build an estimated usage from request/response text when the provider
 * reported no real usage. Always yields a positive total.
 */
export function estimateUsage(promptText: string, completionText: string): TokenUsage {
  const promptTokens = estimateTokens(promptText)
  const completionTokens = estimateTokens(completionText)
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimated: true }
}

/**
 * Immutably accumulate usage for a provider into a stats map.
 */
export function addUsage(
  stats: Record<string, TokenUsage>,
  providerId: string,
  usage: TokenUsage
): Record<string, TokenUsage> {
  const current = stats[providerId] || EMPTY_TOKEN_USAGE
  return {
    ...stats,
    [providerId]: {
      promptTokens: current.promptTokens + usage.promptTokens,
      completionTokens: current.completionTokens + usage.completionTokens,
      totalTokens: current.totalTokens + usage.totalTokens,
    },
  }
}
