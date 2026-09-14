/**
 * ClaudeBrowserAdapter — drives the managed Playwright browser (claude.ai)
 * to send chat requests and intercept the live SSE response.
 */

import { PassThrough, Readable } from 'stream'

const CHAT_URL = 'https://claude.ai/new'
const NAV_TIMEOUT_MS = 60_000
const SEND_TIMEOUT_MS = 15_000
const REPLY_TIMEOUT_MS = 120_000

export interface ClaudeBrowserResult {
  ok: boolean
  content: string
  model: string
  stream?: Readable
  finishReason: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  error?: string
}

export interface ChatMessageLike {
  role: string
  content: unknown
}

export class ClaudeBrowserAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private context: any, private targetModel: string) {}

  async chatCompletion(
    messages: ChatMessageLike[],
    isStream: boolean = false
  ): Promise<ClaudeBrowserResult> {
    const page = (this.context.pages()[0] ??
      (this.context.newPage ? await this.context.newPage() : null)) as any
    if (!page) {
      return { ok: false, content: '', model: this.targetModel, finishReason: 'error', error: 'no browser page available' }
    }

    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const promptText = typeof lastUser?.content === 'string' ? lastUser.content : ''

    const editor = page.locator('div.ProseMirror, div[contenteditable="true"]').first()
    await editor.waitFor({ timeout: 30_000 })
    await editor.click()

    let capturedSse = ''
    let capturedModel = this.targetModel
    const streamPass = new PassThrough()

    // Promise to await completion response
    const completionPromise = new Promise<{ ok: boolean; sse: string; model: string }>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        reject(new Error(`Claude completion timed out after ${REPLY_TIMEOUT_MS}ms`))
      }, REPLY_TIMEOUT_MS)

      page.on('response', async (res: any) => {
        if (res.url().includes('/completion') && res.request().method() === 'POST') {
          try {
            const body = await res.text()
            clearTimeout(timeoutTimer)
            resolve({ ok: res.status() === 200, sse: body, model: capturedModel })
          } catch (err) {
            clearTimeout(timeoutTimer)
            reject(err)
          }
        }
      })
    })

    // Type prompt and press Enter
    await page.keyboard.type(promptText)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')

    try {
      const { ok, sse } = await completionPromise
      if (!ok) {
        return {
          ok: false,
          content: '',
          model: this.targetModel,
          finishReason: 'error',
          error: 'Claude upstream completion returned non-200',
        }
      }

      // Parse SSE events
      let fullContent = ''
      let detectedModel = this.targetModel
      const lines = sse.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const dataStr = line.slice(6).trim()
        if (!dataStr || dataStr === '[DONE]') continue
        try {
          const evt = JSON.parse(dataStr)
          if (evt.type === 'message_start' && evt.message?.model) {
            detectedModel = evt.message.model
          } else if (evt.type === 'content_block_delta' && evt.delta?.text) {
            fullContent += evt.delta.text
          } else if (evt.type === 'completion' && evt.completion) {
            fullContent += evt.completion
          }
        } catch {
          // ignore parsing error
        }
      }

      // Calculate token estimation (rough 1 token ~ 3.5 chars / 0.75 words, standard heuristic)
      const promptTokens = Math.max(1, Math.ceil(promptText.length / 3.5))
      const completionTokens = Math.max(1, Math.ceil(fullContent.length / 3.5))
      const totalTokens = promptTokens + completionTokens

      if (isStream) {
        // Synthesize OpenAI chunk stream
        const created = Math.floor(Date.now() / 1000)
        const id = `chatcmpl-${Date.now().toString(36)}`

        streamPass.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: detectedModel,
          choices: [{ index: 0, delta: { role: 'assistant', content: fullContent }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
        })}\n\n`)
        streamPass.write('data: [DONE]\n\n')
        streamPass.end()

        return {
          ok: true,
          content: fullContent,
          model: detectedModel,
          stream: streamPass,
          finishReason: 'stop',
          usage: { promptTokens, completionTokens, totalTokens },
        }
      }

      return {
        ok: true,
        content: fullContent,
        model: detectedModel,
        finishReason: 'stop',
        usage: { promptTokens, completionTokens, totalTokens },
      }
    } catch (err) {
      return {
        ok: false,
        content: '',
        model: this.targetModel,
        finishReason: 'error',
        error: (err as Error).message,
      }
    }
  }
}
