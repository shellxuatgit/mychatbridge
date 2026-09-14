/**
 * YuanbaoBrowserAdapter — drives the managed Playwright browser
 * (yuanbao.tencent.com) to send a chat message and intercept the live
 * `/api/chat/<conversationId>` SSE response.
 *
 * The Yuanbao web protocol requires per-session X-Uskey/HY92/HY93 signature
 * headers minted inside the logged-in page, so driving the real UI is the only
 * stable approach. The SSE `meta` event carries authoritative token usage.
 */

const CHAT_URL = 'https://yuanbao.tencent.com/chat'
const NAV_TIMEOUT_MS = 60_000
const INPUT_TIMEOUT_MS = 30_000
const REPLY_TIMEOUT_MS = 120_000

export interface YuanbaoBrowserResult {
  ok: boolean
  content: string
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

interface YuanbaoTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export class YuanbaoBrowserAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private context: any) {}

  async chatCompletion(messages: ChatMessageLike[]): Promise<YuanbaoBrowserResult> {
    const page = (this.context.pages()[0] ??
      (this.context.newPage ? await this.context.newPage() : null)) as any
    if (!page) {
      return { ok: false, content: '', finishReason: 'error', error: 'no browser page available' }
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const promptText = typeof lastUser?.content === 'string' ? lastUser.content : ''
    if (!promptText) {
      return { ok: false, content: '', finishReason: 'error', error: 'no user message content' }
    }

    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

    const responsePromise = new Promise<{ ok: boolean; sse: string }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Yuanbao completion timed out after ${REPLY_TIMEOUT_MS}ms`)),
        REPLY_TIMEOUT_MS
      )
      const handler = async (res: any) => {
        if (res.request().method() === 'POST' && /\/api\/chat\//.test(res.url())) {
          try {
            const body = await res.text()
            clearTimeout(timer)
            resolve({ ok: res.status() === 200, sse: body })
          } catch (err) {
            clearTimeout(timer)
            reject(err)
          }
        }
      }
      page.on('response', handler)
    })

    const editor = page.locator('div[contenteditable="true"], textarea').first()
    await editor.waitFor({ timeout: INPUT_TIMEOUT_MS })
    await editor.click()
    await page.keyboard.type(promptText)
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')

    try {
      const { ok, sse } = await responsePromise
      if (!ok) {
        return { ok: false, content: '', finishReason: 'error', error: 'Yuanbao upstream returned non-200' }
      }

      const parsed = this.parseSse(sse)
      if (!parsed.content) {
        return { ok: false, content: '', finishReason: 'error', error: 'no assistant text in Yuanbao stream' }
      }

      return {
        ok: true,
        content: parsed.content,
        finishReason: parsed.finishReason,
        usage: parsed.usage,
      }
    } catch (err) {
      return {
        ok: false,
        content: '',
        finishReason: 'error',
        error: (err as Error).message,
      }
    }
  }

  private parseSse(sse: string): {
    content: string
    finishReason: string
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  } {
    let content = ''
    let finishReason = 'stop'
    let usage: YuanbaoBrowserResult['usage']

    for (const line of sse.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data || data === '[DONE]') continue
      if (data.startsWith('[plugin') || data.startsWith('[MSGINDEX') || data.startsWith('[TRACEID')) continue

      let evt: Record<string, unknown>
      try {
        evt = JSON.parse(data)
      } catch {
        continue
      }

      const type = evt.type
      if (type === 'deepSearchAgent') {
        const contents = evt.contents
        if (Array.isArray(contents)) {
          for (const item of contents as Array<Record<string, unknown>>) {
            if (item.type === 'text' && item.cat !== 'think' && typeof item.text === 'string') {
              content += item.text
            }
          }
        }
      } else if (type === 'meta') {
        if (typeof evt.stopReason === 'string' && evt.stopReason) finishReason = evt.stopReason
        const t = evt.tokenUsageInfo as YuanbaoTokenUsage | undefined
        if (t && typeof t.totalTokens === 'number') {
          usage = {
            promptTokens: t.promptTokens ?? 0,
            completionTokens: t.completionTokens ?? 0,
            totalTokens: t.totalTokens,
          }
        }
      }
    }

    return { content, finishReason, usage }
  }
}
