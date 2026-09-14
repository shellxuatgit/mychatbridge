import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  try {
    const page = ctx.pages()[0] || (await ctx.newPage())

    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/completion')) {
        console.log('[COMPLETION REQ]:', req.url())
        try {
          console.log('  POST DATA:', req.postData()?.slice(0, 300))
        } catch {}
      }
    })

    page.on('response', async (res) => {
      if (res.url().includes('/completion')) {
        console.log('[COMPLETION RES STATUS]:', res.status())
      }
    })

    await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3000)

    const editor = page.locator('div.ProseMirror, div[contenteditable="true"]').first()
    await editor.fill('Say OK')
    await page.waitForTimeout(500)

    // Click send
    const sendBtn = page.locator('button[aria-label*="Send"], button[aria-label*="发送"], button:has(svg)').last()
    await sendBtn.click()

    console.log('Message sent! Waiting for response to stream...')
    await page.waitForTimeout(10000)

    // Inspect rendered message elements
    const messages = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.font-claude-message, [data-is-streaming], div[class*="message"]'))
      return all.map((el) => ({ class: el.className, text: (el.textContent || '').slice(0, 100) }))
    })
    console.log('Messages in page:', JSON.stringify(messages.slice(-4), null, 2))
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
