/**
 * GeminiBrowserAdapter — drives the managed Playwright browser (gemini.google.com)
 * to send a chat message through the live web UI.
 *
 * The Gemini web protocol uses `batchexecute` RPC with obfuscated nested-array
 * payloads, which is not practical to reverse-engineer or maintain. Driving the
 * real UI means the browser itself handles whatever protocol Google uses today.
 *
 * The adapter only reads the final assistant text; it never persists cookies,
 * auth headers, or raw request bodies.
 */

const APP_URL = 'https://gemini.google.com/app'
const COMPOSER_SELECTOR = 'div.ql-editor[contenteditable="true"]'
const REPLY_SELECTOR = 'model-response, .model-response-text, message-content'
const NAV_TIMEOUT_MS = 60_000
const LOGIN_TIMEOUT_MS = 180_000
const REPLY_TIMEOUT_MS = 120_000

export interface GeminiBrowserResult {
  ok: boolean
  content: string
  finishReason: string
  error?: string
}

export interface ChatMessageLike {
  role: string
  content: unknown
}

export class GeminiBrowserAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private context: any, private model: string) {}

  async chatCompletion(messages: ChatMessageLike[]): Promise<GeminiBrowserResult> {
    const page = (this.context.pages()[0] ??
      (this.context.newPage ? await this.context.newPage() : null)) as any
    if (!page) {
      return { ok: false, content: '', finishReason: 'stop', error: 'no browser page available' }
    }

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

    // Wait for the composer to be interactive (logged-in state)
    try {
      await page.waitForSelector(COMPOSER_SELECTOR, { timeout: LOGIN_TIMEOUT_MS })
    } catch {
      return {
        ok: false,
        content: '',
        finishReason: 'stop',
        error: 'Gemini composer not visible; are you logged in?',
      }
    }

    const composer = page.locator(COMPOSER_SELECTOR).first()
    const composerVisible = await composer.isVisible().catch(() => false)
    if (!composerVisible) {
      return {
        ok: false,
        content: '',
        finishReason: 'stop',
        error: 'Gemini composer not visible; are you logged in?',
      }
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const message = typeof lastUser?.content === 'string' ? lastUser.content : ''

    // Count reply elements before sending
    const before = await page.locator(REPLY_SELECTOR).count().catch(() => 0)

    await composer.click({ timeout: 15_000 }).catch(() => {})
    await page.keyboard.type(message, { delay: 20 })
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')

    // Gemini streams the reply into the DOM. Wait for content to appear and
    // stabilize — don't rely on specific element selectors which may change.
    const replyDeadline = Date.now() + REPLY_TIMEOUT_MS
    let content = ''
    let lastContent = ''
    let stableSince = 0
    let found = false

    // Initial wait for generation to start (composer disables, response appears)
    await page.waitForTimeout(5000)

    while (Date.now() < replyDeadline) {
      const text = await page.evaluate(() => {
        // Try multiple selectors for the assistant reply
        const selectors = [
          'model-response .model-response-text',
          'model-response message-content',
          '.model-response-text',
          'message-content',
          'model-response',
        ]
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel)
          if (els.length > 0) {
            const last = els[els.length - 1]
            const text = last.textContent?.trim()
            if (text) return text
          }
        }
        // Fallback: look for any large text block that appeared after the user message
        const all = document.querySelectorAll('[data-message-id] , [data-message-author-role]')
        if (all.length > 0) {
          const last = all[all.length - 1]
          return last.textContent?.trim() || ''
        }
        return ''
      }).catch(() => '')

      if (text && text.length > 0) {
        found = true
        if (text === lastContent) {
          if (Date.now() - stableSince > 2000) {
            content = text
            break
          }
        } else {
          stableSince = Date.now()
        }
        lastContent = text
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    if (!found && !content) {
      return {
        ok: false,
        content: '',
        finishReason: 'stop',
        error: `Gemini reply not detected within ${REPLY_TIMEOUT_MS}ms`,
      }
    }

    content = content || lastContent
    void this.model // the web UI picks its own model
    return { ok: true, content, finishReason: 'stop' }
  }
}
