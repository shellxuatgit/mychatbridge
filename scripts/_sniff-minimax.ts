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
    let capturedReq: any = null

    page.on('request', (req) => {
      if (req.url().includes('/chat/') || req.url().includes('/matrix/') || req.url().includes('/api/')) {
        console.log('REQ:', req.method(), req.url())
        if (req.method() === 'POST') {
          console.log('  HEADERS:', JSON.stringify(req.headers()))
        }
      }
    })

    await page.goto('https://agent.minimaxi.com/chat', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(3000)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
