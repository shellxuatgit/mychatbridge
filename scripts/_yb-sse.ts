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
      const u = res.url()
      if (/\/api\/chat\//.test(u)) {
        console.log('[YB CHAT SSE]', res.status(), u)
        try {
          const body = await res.text()
          console.log('[YB SSE BODY head]:', body.slice(0, 1200))
        } catch (e) {
          console.log('body read err:', (e as Error).message)
        }
      }
    })

    await page.goto('https://yuanbao.tencent.com/chat', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(5000)

    const input = page.locator('div[contenteditable="true"], textarea').first()
    await input.click()
    await page.keyboard.type('请回复数字 42')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    console.log('Sent. Waiting for SSE...')
    await page.waitForTimeout(15000)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
