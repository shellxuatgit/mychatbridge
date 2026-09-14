import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { writeFileSync } from 'fs'

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
        try {
          const body = await res.text()
          writeFileSync('E:\\Projects\\MyChatbot\\MyChatBridge\\_yb-sse-dump.txt', body, 'utf8')
          console.log('[YB] saved SSE body, bytes:', body.length)
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
    await page.waitForTimeout(20000)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
