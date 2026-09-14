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

    page.on('response', async (res) => {
      if (res.url().includes('/completion')) {
        try {
          const body = await res.text()
          console.log('[COMPLETION SSE BODY SAMPLE]:', body.slice(0, 500))
        } catch (e) {
          console.log('could not read body:', (e as Error).message)
        }
      }
    })

    await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3000)

    const editor = page.locator('div.ProseMirror, div[contenteditable="true"]').first()
    await editor.click()
    await page.keyboard.type('Test message, reply only "READY"')
    await page.keyboard.press('Enter')

    await page.waitForTimeout(10000)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
