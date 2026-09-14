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

  let token = ''
  try {
    const cookies = await ctx.cookies()
    const tCookie = cookies.find((c) => c.name === 'token' && c.domain.includes('z.ai'))
    token = tCookie?.value || ''
    if (!token) {
      const page = ctx.pages()[0] || (await ctx.newPage())
      await page.goto('https://chat.z.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      token = (await page.evaluate(() => window.localStorage.getItem('token') || '')) || ''
    }
  } finally {
    await ctx.close().catch(() => {})
  }

  console.log('Z.ai token len:', token.length)
  if (!token) throw new Error('Z.ai token not found')

  const { ZaiAdapter } = await import('../src/main/proxy/adapters/zai.ts')
  const provider = {
    id: 'zai',
    name: 'Z.ai',
    type: 'builtin',
    authType: 'jwt',
    apiEndpoint: 'https://chat.z.ai',
    headers: {},
    enabled: true,
  } as any

  const account = {
    id: 'test-zai',
    providerId: 'zai',
    name: 'Z.ai',
    credentials: { token },
    status: 'active',
  } as any

  const adapter = new ZaiAdapter(provider, account)
  console.log('Testing Z.ai adapter chatCompletion...')
  const res = await adapter.chatCompletion({
    model: 'GLM-5-Turbo',
    messages: [{ role: 'user', content: 'Say OK' }],
    stream: false,
  } as any)

  console.log('Z.ai response status:', res.response.status)
  console.log('Success! Z.ai is fully working.')
}

main().catch((err) => {
  console.error('Z.ai Test error:', err)
  process.exit(1)
})
