/**
 * ChatGPTBrowserAdapter — drives the managed Playwright browser (chatgpt.com)
 * to send a chat message through the live web UI.
 *
 * The direct `backend-api/conversation` HTTP endpoint retired along with the
 * old model slugs, and the current web protocol requires dynamic sentinel /
 * conduit tokens that only exist inside the logged-in browser session. Driving
 * the real UI means the browser itself supplies whatever protocol ChatGPT uses
 * today, so no reverse-engineered request format can go stale.
 *
 * The adapter only reads the final assistant text; it never persists cookies,
 * auth headers, or raw request bodies.
 */

const CHAT_URL = 'https://chatgpt.com'
const INPUT_SELECTOR = '#prompt-textarea'
const SEND_BUTTON_SELECTOR = 'button[data-testid="send-button"]'
const ASSISTANT_SELECTOR = 'div[data-message-author-role="assistant"]'

const NAV_TIMEOUT_MS = 60_000
const LOGIN_TIMEOUT_MS = 120_000
const SEND_TIMEOUT_MS = 15_000
const REPLY_TIMEOUT_MS = 120_000

export interface ChatGPTBrowserResult {
  ok: boolean
  content: string
  finishReason: string
  /** Real model slug observed in the outgoing conversation request (if captured) */
  model?: string
  error?: string
}

export interface ChatMessageLike {
  role: string
  content: unknown
}

export class ChatGPTBrowserAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private context: any, private model: string) {}

  async chatCompletion(messages: ChatMessageLike[]): Promise<ChatGPTBrowserResult> {
    const page = (this.context.pages()[0] ??
      (this.context.newPage ? await this.context.newPage() : null)) as any
    if (!page) {
      return { ok: false, content: '', finishReason: 'stop', error: 'no browser page available' }
    }

    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
    await page.waitForSelector(INPUT_SELECTOR, { timeout: LOGIN_TIMEOUT_MS })

    // Capture the real model slug from the outgoing conversation request: the
    // web UI picks the account's current model, which may differ from our
    // configured mapping.
    let usedModel: string | undefined
    const onRequest = (request: any) => {
      try {
        if (request.method() === 'POST' && /\/backend-api\/f\/conversation$/.test(request.url())) {
          const body = JSON.parse(request.postData() || '{}')
          if (typeof body.model === 'string' && body.model) usedModel = body.model
        }
      } catch { /* ignore non-JSON bodies */ }
    }
    page.on?.('request', onRequest)

    const input = page.locator(INPUT_SELECTOR)
    const visible = await input.isVisible().catch(() => false)
    if (!visible) {
      return {
        ok: false,
        content: '',
        finishReason: 'stop',
        error: 'composer not visible; are you logged in?',
      }
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const message = typeof lastUser?.content === 'string' ? lastUser.content : ''

    const assistant = page.locator(ASSISTANT_SELECTOR)
    const before = await assistant.count().catch(() => 0)

    await input.fill(message, { timeout: SEND_TIMEOUT_MS })
    await page.locator(SEND_BUTTON_SELECTOR).click({ timeout: SEND_TIMEOUT_MS })
    // Composer re-enables once the request is accepted.
    await page.waitForSelector(INPUT_SELECTOR, { timeout: SEND_TIMEOUT_MS })

    try {
      await page.waitForFunction(
        ({ selector, before }: { selector: string; before: number }) =>
          document.querySelectorAll(selector).length > before,
        { selector: ASSISTANT_SELECTOR, before },
        { timeout: REPLY_TIMEOUT_MS },
      )
    } catch {
      return {
        ok: false,
        content: '',
        finishReason: 'stop',
        error: `reply not detected within ${REPLY_TIMEOUT_MS}ms`,
      }
    }

    // The new assistant node appears before the stream starts writing text.
    // Poll until it has content AND has stopped changing (stable window).
    const deadline = Date.now() + REPLY_TIMEOUT_MS
    let content = ''
    let lastContent = ''
    let stableSince = 0
    while (Date.now() < deadline) {
      content = await page.locator(ASSISTANT_SELECTOR).last().innerText().catch(() => '')
      if (content && content === lastContent) {
        if (Date.now() - stableSince > 1000) break
      } else {
        stableSince = Date.now()
      }
      lastContent = content
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    void this.model // the web UI picks its own model; kept for logging parity
    page.off?.('request', onRequest)
    return { ok: true, content, finishReason: 'stop', model: usedModel }
  }
}
