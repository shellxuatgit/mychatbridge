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
      if (req.method() === 'POST' && req.url().includes('completion')) {
        console.log('[COMPLETION URL]:', req.url())
      }
    })

    page.on('response', async (res) => {
      if (res.url().includes('completion')) {
        console.log('[COMPLETION STATUS]:', res.status())
      }
    })

    await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3000)

    const editor = page.locator('div.ProseMirror, div[contenteditable="true"]').first()
    await editor.click()
    await page.keyboard.type('Hello, please respond with OK')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')

    console.log('Pressed Enter to send. Waiting for reply stream...')
    await page.waitForTimeout(10000)

    const text = await page.evaluate(() => {
      const msg = document.querySelector('.font-claude-message, [data-is-streaming], div.grid-cols-1')
      return msg ? msg.textContent : document.body.innerText.slice(-500)
    })
    console.log('Result text sample:', text?.slice(0, 300))
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
