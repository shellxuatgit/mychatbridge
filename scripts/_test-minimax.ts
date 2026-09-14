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
  let realUserID = ''
  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://agent.minimaxi.com/chat', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    const cookies = await ctx.cookies()
    const tokenCookie = cookies.find((c) => c.name === '_token' || c.name === 'token')
    token = tokenCookie?.value || ''
    
    const ls = await page.evaluate(() => {
      return {
        token: window.localStorage.getItem('_token') || window.localStorage.getItem('token') || '',
        userId: window.localStorage.getItem('ANONYMOUS_REAL_USER_ID') || window.localStorage.getItem('USER_HARD_WARE_INFO') || '',
      }
    }).catch(() => ({ token: '', userId: '' }))

    if (!token) token = ls.token
    realUserID = ls.userId
  } finally {
    await ctx.close().catch(() => {})
  }

  console.log('MiniMax Token len:', token.length, 'realUserID:', realUserID)
  if (!token) throw new Error('MiniMax token not found')

  const { MiniMaxAdapter } = await import('../src/main/proxy/adapters/minimax.ts')
  const provider = {
    id: 'minimax',
    name: 'MiniMax',
    type: 'builtin',
    authType: 'jwt',
    apiEndpoint: 'https://agent.minimaxi.com',
    headers: {},
    enabled: true,
  } as any

  const account = {
    id: 'test-minimax',
    providerId: 'minimax',
    name: 'MiniMax',
    credentials: { token, realUserID },
    status: 'active',
  } as any

  const adapter = new MiniMaxAdapter(provider, account)
  console.log('Testing MiniMax adapter...')
  const res = await adapter.chatCompletion({
    model: 'abab6.5s-chat',
    messages: [{ role: 'user', content: 'Say OK' }],
    stream: false,
  } as any)

  console.log('MiniMax HTTP status:', res.response.status)
  console.log('Success! MiniMax is working.')
}

main().catch((err) => {
  console.error('Test error:', err)
  process.exit(1)
})
