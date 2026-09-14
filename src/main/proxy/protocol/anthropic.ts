/**
 * Anthropic Messages protocol adapter.
 * Translates Anthropic Messages requests/responses to the internal
 * OpenAI-compatible chat completion protocol used by the proxy router.
 */
import { Transform } from 'stream'

export interface ProtocolState {
  anthropic: boolean
  model?: string
}

function toOpenAIContent(content: any): any {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content

  return content.map((block: any) => {
    if (block.type === 'text') return { type: 'text', text: block.text || '' }
    if (block.type === 'image') {
      const source = block.source || {}
      if (source.type === 'base64') {
        return {
          type: 'image_url',
          image_url: { url: `data:${source.media_type || 'image/jpeg'};base64,${source.data || ''}` },
        }
      }
      if (source.type === 'url') {
        return { type: 'image_url', image_url: { url: source.url } }
      }
    }
    if (block.type === 'tool_result') {
      return {
        type: 'text',
        text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
      }
    }
    if (block.type === 'tool_use') {
      return { type: 'text', text: JSON.stringify(block) }
    }
    return block
  })
}

function normalizeAnthropicTools(tools: any[] | undefined): any[] | undefined {
  if (!Array.isArray(tools)) return undefined
  return tools
    .filter(tool => tool?.name)
    .map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema || { type: 'object', properties: {} },
      },
    }))
}

export function anthropicRequestToOpenAI(body: any): any {
  const messages: any[] = []

  if (body.system) {
    const systemText = Array.isArray(body.system)
      ? body.system.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '').join('\n')
      : String(body.system)
    if (systemText) messages.push({ role: 'system', content: systemText })
  }

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    messages.push({
      role,
      content: toOpenAIContent(message.content),
    })
  }

  const request: any = {
    model: body.model,
    messages,
    stream: body.stream === true,
  }

  if (body.max_tokens !== undefined) request.max_tokens = body.max_tokens
  if (body.temperature !== undefined) request.temperature = body.temperature
  if (body.top_p !== undefined) request.top_p = body.top_p
  if (body.stop_sequences !== undefined) request.stop = body.stop_sequences

  const tools = normalizeAnthropicTools(body.tools)
  if (tools) request.tools = tools
  if (body.tool_choice) {
    if (body.tool_choice.type === 'auto') request.tool_choice = 'auto'
    else if (body.tool_choice.type === 'any') request.tool_choice = 'required'
    else if (body.tool_choice.type === 'tool' && body.tool_choice.name) {
      request.tool_choice = { type: 'function', function: { name: body.tool_choice.name } }
    }
  }

  // Preserve proxy-specific options when clients send them through metadata.
  if (body.metadata?.user_id) request.user = body.metadata.user_id
  return request
}

function extractText(message: any): string {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => block.text || '')
    .join('')
}

function usageFromOpenAI(usage: any): any {
  return {
    input_tokens: usage?.prompt_tokens || 0,
    output_tokens: usage?.completion_tokens || 0,
  }
}

export function openAIResponseToAnthropic(body: any, model?: string): any {
  const choice = body?.choices?.[0]
  const message = choice?.message || {}
  const content: any[] = []
  const text = extractText(message)
  if (text) content.push({ type: 'text', text })

  for (const tool of message.tool_calls || []) {
    let input: any = {}
    try { input = JSON.parse(tool.function?.arguments || '{}') } catch { input = {} }
    content.push({
      type: 'tool_use',
      id: tool.id || `toolu_${Date.now()}`,
      name: tool.function?.name || '',
      input,
    })
  }

  const stopReason = message.tool_calls?.length
    ? 'tool_use'
    : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn'

  return {
    id: body?.id || `msg_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: model || body?.model || 'unknown',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: usageFromOpenAI(body?.usage),
  }
}

/**
 * Convert an OpenAI SSE stream into Anthropic Messages SSE events.
 * This intentionally keeps the adapter protocol-level; provider routing and
 * provider-specific translation remain unchanged.
 */
export function createAnthropicStreamTransform(model?: string): Transform {
  let buffer = ''
  let messageStarted = false
  let textBlockStarted = false
  let blockIndex = 0

  const emit = (event: string, data: any) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

  return new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString()
      const parts = buffer.split(/\n\n/)
      buffer = parts.pop() || ''

      let output = ''
      for (const part of parts) {
        const dataLine = part.split(/\r?\n/).find(line => line.startsWith('data:'))
        if (!dataLine) continue
        const raw = dataLine.slice(5).trim()
        if (!raw || raw === '[DONE]') continue

        let chunkData: any
        try { chunkData = JSON.parse(raw) } catch { continue }

        if (!messageStarted) {
          messageStarted = true
          output += emit('message_start', {
            type: 'message_start',
            message: {
              id: chunkData.id || `msg_${Date.now().toString(36)}`,
              type: 'message',
              role: 'assistant',
              model: model || chunkData.model || 'unknown',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          })
        }

        const delta = chunkData.choices?.[0]?.delta || {}
        if (delta.content) {
          if (!textBlockStarted) {
            textBlockStarted = true
            output += emit('content_block_start', {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'text', text: '' },
            })
          }
          output += emit('content_block_delta', {
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'text_delta', text: delta.content },
          })
        }

        const finishReason = chunkData.choices?.[0]?.finish_reason
        if (finishReason) {
          if (textBlockStarted) {
            output += emit('content_block_stop', { type: 'content_block_stop', index: blockIndex })
            blockIndex += 1
          }
          output += emit('message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: finishReason === 'length' ? 'max_tokens' : finishReason === 'tool_calls' ? 'tool_use' : 'end_turn',
              stop_sequence: null,
            },
            usage: usageFromOpenAI(chunkData.usage),
          })
          output += emit('message_stop', { type: 'message_stop' })
        }
      }

      callback(null, output)
    },
    flush(callback) {
      buffer = ''
      callback()
    },
  })
}
