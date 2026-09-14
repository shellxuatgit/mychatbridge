import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'kimi')
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: 'chrome',
  })

  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(3000)

    const cookies = await ctx.cookies()
    console.log('All cookies:', cookies.map((c) => ({ name: c.name, domain: c.domain })))

    const ls = await page.evaluate(() => {
      const items: Record<string, string> = {}
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k) items[k] = window.localStorage.getItem(k)?.slice(0, 50) || ''
      }
      return items
    }).catch(() => ({}))
    console.log('LocalStorage keys & preview:', ls)

    const ss = await page.evaluate(() => {
      const items: Record<string, string> = {}
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i)
        if (k) items[k] = window.sessionStorage.getItem(k)?.slice(0, 50) || ''
      }
      return items
    }).catch(() => ({}))
    console.log('SessionStorage keys & preview:', ss)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
