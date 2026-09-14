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

    page.on('request', (req) => {
      console.log('REQ:', req.method(), req.url().slice(0, 100))
    })

    page.on('response', async (res) => {
      if (res.url().includes('claude.ai')) {
        console.log('RES:', res.status(), res.url().slice(0, 100))
      }
    })

    await page.goto('https://claude.ai/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('goto err:', e.message))
    await page.waitForTimeout(5000)
    console.log('Current URL:', page.url())
    console.log('Page Title:', await page.title())
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
