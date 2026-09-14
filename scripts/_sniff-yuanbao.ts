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
      const u = req.url()
      if (req.method() === 'POST' && (u.includes('yuanbao.tencent.com') || u.includes('hunyuan'))) {
        console.log('[YB REQ POST]:', u.slice(0, 160))
        try {
          console.log('  BODY:', req.postData()?.slice(0, 400))
        } catch {}
      }
    })

    page.on('response', async (res) => {
      const u = res.url()
      if (res.request().method() === 'POST' && (u.includes('chat') || u.includes('conversation') || u.includes('completion'))) {
        console.log('[YB RES]:', res.status(), u.slice(0, 160))
      }
    })

    await page.goto('https://yuanbao.tencent.com/chat', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(4000)

    const input = page.locator('textarea, div[contenteditable="true"]').first()
    console.log('Input visible:', await input.isVisible().catch(() => false))

    if (await input.isVisible().catch(() => false)) {
      await input.click()
      await page.keyboard.type('请只回复数字 42')
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      console.log('Sent to Yuanbao, waiting...')
      await page.waitForTimeout(12000)

      const bodyText = await page.evaluate(() => document.body.innerText)
      console.log('Includes 42:', bodyText.includes('42'))
    }
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
