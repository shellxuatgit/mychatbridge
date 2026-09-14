import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: 'chrome',
  })

  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://agent.minimaxi.com/chat', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(3000)

    const cookies = await ctx.cookies()
    const minimaxCookies = cookies.filter((c) => c.domain.includes('minimaxi.com') || c.domain.includes('minimax'))
    console.log('MiniMax cookies:', minimaxCookies.map((c) => ({ name: c.name, domain: c.domain })))

    const ls = await page.evaluate(() => {
      const items: Record<string, string> = {}
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k) items[k] = window.localStorage.getItem(k)?.slice(0, 80) || ''
      }
      return items
    }).catch(() => ({}))
    console.log('LocalStorage keys & preview:', ls)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
