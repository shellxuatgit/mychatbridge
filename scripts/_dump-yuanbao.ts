import { join } from 'path'
import { homedir } from 'os'
import Module from 'module'

// stub electron
const mod = Module as any
const originalLoad = mod._load
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') {
    return {
      app: { getPath: () => join(homedir(), '.mychatbridge'), isPackaged: false, on: () => {} },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s: string) => Buffer.from(s, 'utf8'),
        decryptString: (b: Buffer) => b.toString(),
      },
      BrowserWindow: class {},
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright')
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: true, channel: 'chrome' })

  try {
    const cookies = await ctx.cookies()
    const ybCookies = cookies.filter((c) => c.domain.includes('yuanbao.tencent.com') || c.domain.includes('tencent.com'))
    console.log('Yuanbao cookie count:', ybCookies.length)
    console.log('Yuanbao cookie names:', ybCookies.map((c) => c.name).join(', '))
    const hy = ybCookies.find((c) => c.name === 'hy_user')
    console.log('Has hy_user:', Boolean(hy?.value), 'len:', hy?.value?.length)

    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://yuanbao.tencent.com/chat', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(3000)
    console.log('Current URL:', page.url())
    console.log('Is logged in:', !page.url().includes('login'))
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
