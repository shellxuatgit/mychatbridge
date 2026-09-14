import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const providerId = process.argv[2]
  const dir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', providerId)
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chrome' })
  try {
    const cookies = await ctx.cookies()
    console.log(`[${providerId}] cookies:`, cookies.length)
    console.log(cookies.map((c) => `${c.name}@${c.domain}`).join(', '))
    const page = ctx.pages()[0] || (await ctx.newPage())
    const origin = process.argv[3]
    if (origin) {
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(3000)
      const ls = await page.evaluate(() => {
        const out: Record<string, string> = {}
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i)
          if (k) out[k] = (window.localStorage.getItem(k) || '').slice(0, 40)
        }
        return out
      }).catch(() => ({}))
      console.log(`[${providerId}] localStorage keys:`, Object.keys(ls).join(', '))
    }
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
