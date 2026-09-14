import axios from 'axios'

export interface OpenAiApiProbeOptions {
  host: string
  port: number
  model: string
  apiKey?: string
  timeoutMs?: number
}

export interface OpenAiApiProbeResult {
  ok: boolean
  endpoint: string
  model?: string
  models?: string[]
  reply?: string
  latencyMs: number
  error?: string
}

function endpointFor(host: string, port: number): string {
  const normalizedHost = host === '0.0.0.0' ? '127.0.0.1' : host
  return `http://${normalizedHost}:${port}/v1`
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response) return `HTTP ${error.response.status}`
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export async function probeOpenAiApi(options: OpenAiApiProbeOptions): Promise<OpenAiApiProbeResult> {
  const endpoint = endpointFor(options.host, options.port)
  const startedAt = Date.now()
  const headers = options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined

  try {
    const modelsResponse = await axios.get(`${endpoint}/models`, {
      headers,
      timeout: options.timeoutMs ?? 10000,
      validateStatus: () => true,
    })
    if (modelsResponse.status < 200 || modelsResponse.status >= 300) {
      return { ok: false, endpoint, latencyMs: Date.now() - startedAt, error: `GET /v1/models returned HTTP ${modelsResponse.status}` }
    }

    const modelsBody = modelsResponse.data
    if (!modelsBody || modelsBody.object !== 'list' || !Array.isArray(modelsBody.data)) {
      return { ok: false, endpoint, latencyMs: Date.now() - startedAt, error: 'Invalid OpenAI /v1/models response structure' }
    }
    const models = modelsBody.data
      .map((item: unknown) => (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : null))
      .filter((id: string | null): id is string => id !== null)
    if (models.length !== modelsBody.data.length) {
      return { ok: false, endpoint, models, latencyMs: Date.now() - startedAt, error: 'Invalid OpenAI /v1/models data item structure' }
    }

    if (models.length === 0) {
      return { ok: false, endpoint, models, latencyMs: Date.now() - startedAt, error: 'No available models: configure and enable a provider account first' }
    }

    const chatModel = models[0] || options.model
    const chatResponse = await axios.post(`${endpoint}/chat/completions`, {
      model: chatModel,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 8,
      stream: false,
    }, {
      headers,
      timeout: options.timeoutMs ?? 30000,
      validateStatus: () => true,
    })
    if (chatResponse.status < 200 || chatResponse.status >= 300) {
      return { ok: false, endpoint, models, latencyMs: Date.now() - startedAt, error: `POST /v1/chat/completions returned HTTP ${chatResponse.status}` }
    }

    const body = chatResponse.data
    const choice = body?.choices?.[0]
    if (!body || body.object !== 'chat.completion' || !Array.isArray(body.choices) || !choice || choice.message?.role !== 'assistant' || typeof choice.message.content !== 'string') {
      return { ok: false, endpoint, models, latencyMs: Date.now() - startedAt, error: 'Invalid OpenAI /v1/chat/completions response structure: choices[0].message.content is required' }
    }

    return {
      ok: true,
      endpoint,
      model: body.model || chatModel,
      models,
      reply: choice.message.content,
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return { ok: false, endpoint, latencyMs: Date.now() - startedAt, error: errorMessage(error) }
  }
}
