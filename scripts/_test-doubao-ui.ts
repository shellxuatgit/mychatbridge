import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  console.log('Opening Doubao in Chrome...')
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
      if (res.url().includes('completion') || res.url().includes('chat') || res.url().includes('conversation')) {
        if (res.request().method() === 'POST') {
          console.log('[DOUBAO POST RES]:', res.status(), res.url())
        }
      }
    })

    await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(4000)

    const input = page.locator('textarea, div[contenteditable="true"]').first()
    console.log('Doubao input visible:', await input.isVisible().catch(() => false))

    if (await input.isVisible().catch(() => false)) {
      await input.click()
      await page.keyboard.type('你好，请回复数字 88')
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      console.log('Sent message to Doubao! Waiting for response...')
      await page.waitForTimeout(8000)

      const bodyText = await page.evaluate(() => document.body.innerText)
      console.log('Includes 88:', bodyText.includes('88'))
    }
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
