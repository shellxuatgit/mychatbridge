/**
 * Core Gateway Module - ChatGPT SSE Parser
 *
 * Pure, chunk-safe parser for ChatGPT backend-api `/conversation` SSE stream.
 * The parser only sees upstream `data:` records; it never exposes raw
 * response bodies, tokens, or other credentials to the caller.
 *
 * Event payload shapes (from the ChatGPT web client):
 * - { message: { content: { parts: [ "text" ] }, conversation_id } }  (cumulative parts)
 * - { delta: { content: "suffix" } }
 * - { message: { content: { text: "..." } } }                         (some responses)
 * - { message: { content: { text: null }, ... }, done: true }
 * - data: [DONE]
 */

export interface ChatGptParseState {
  /** Residual buffer from the previous chunk */
  remainder: string
  /** Accumulated assistant text so far */
  accumulatedText: string
  /** Last observed conversation id (first non-null wins) */
  conversationId: string | null
  /** Whether a [DONE] marker was seen */
  done: boolean
}

export function createChatGptParseState(): ChatGptParseState {
  return {
    remainder: '',
    accumulatedText: '',
    conversationId: null,
    done: false,
  }
}

export interface ChatGptParseResult {
  /** Text deltas emitted by this chunk (non-empty suffixes) */
  deltas: string[]
  /** Updated parser state */
  state: ChatGptParseState
  /** True when the stream terminated cleanly via [DONE] or a done flag */
  completed: boolean
  /** Structured error when the upstream reported an error event */
  error?: string
}

function parseDataLine(line: string): unknown | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) {
    return null
  }
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') {
    return payload === '[DONE]' ? '[DONE]' : null
  }
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

/** Extract text from a parsed ChatGPT event payload. Returns '' when absent. */
function extractTextFromEvent(event: any): { text: string; done: boolean; conversationId: string | null } {
  let text = ''
  let done = false
  let conversationId: string | null = null

  if (event && typeof event === 'object') {
    if (event.message) {
      const content = event.message.content
      if (content && typeof content === 'object') {
        if (Array.isArray(content.parts)) {
          const partsText = content.parts
            .map((p: unknown) => (typeof p === 'string' ? p : ''))
            .join('')
          if (partsText) text = partsText
        } else if (typeof content.text === 'string') {
          text = content.text
        }
      }
      conversationId = event.message.conversation_id || null
      if (event.message.end_turn || event.done) done = true
      if (event.message.content && content?.text === null) {
        // Some events signal completion with null text
        if (event.message.end_turn) done = true
      }
    }
    if (event.delta && typeof event.delta.content === 'string') {
      text = event.delta.content
    }
    if (event.done) done = true
    if (event.error) {
      throw new Error(typeof event.error === 'string' ? event.error : 'ChatGPT upstream error')
    }
  }

  return { text, done, conversationId }
}

/**
 * Feed one chunk of the upstream stream into the parser.
 * Returns text deltas (suffixes relative to the accumulated text) plus the
 * updated state. Handles arbitrary UTF-8 chunk boundaries.
 */
export function parseChatGptChunk(
  chunk: Buffer | string,
  prev: ChatGptParseState
): ChatGptParseResult {
  const state: ChatGptParseState = {
    ...prev,
    remainder: prev.remainder + chunk.toString('utf8'),
  }

  const deltas: string[] = []
  let completed = false
  let error: string | undefined

  // Split into complete lines (keep the final partial line in remainder).
  const lines = state.remainder.split('\n')
  state.remainder = lines.pop() ?? ''

  for (const line of lines) {
    const parsed = parseDataLine(line)
    if (parsed === '[DONE]') {
      completed = true
      state.done = true
      continue
    }
    if (parsed == null) {
      continue
    }

    try {
      const { text, done, conversationId } = extractTextFromEvent(parsed)
      if (conversationId && !state.conversationId) {
        state.conversationId = conversationId
      }

      if (text) {
        // A delta event carries only the suffix, not a cumulative snapshot.
        const isDeltaEvent = Boolean(parsed && typeof parsed === 'object' && (parsed as any).delta)
        if (isDeltaEvent) {
          // Always append delta payloads; they are incremental by definition.
          if (text.startsWith(state.accumulatedText)) {
            const suffix = text.slice(state.accumulatedText.length)
            if (suffix) {
              deltas.push(suffix)
            }
          } else {
            deltas.push(text)
          }
          state.accumulatedText += text
        } else if (text.startsWith(state.accumulatedText)) {
          // Cumulative snapshot that extends the accumulated text: emit suffix.
          const suffix = text.slice(state.accumulatedText.length)
          if (suffix) {
            deltas.push(suffix)
            state.accumulatedText = text
          }
        } else if (text.length > state.accumulatedText.length) {
          // Replacement with a longer snapshot: emit the non-overlapping suffix.
          const suffix = text.slice(state.accumulatedText.length)
          if (suffix) {
            deltas.push(suffix)
            state.accumulatedText = text
          }
        }
      }

      if (done) {
        completed = true
        state.done = true
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'ChatGPT upstream error'
      break
    }
  }

  return { deltas, state, completed, error }
}
