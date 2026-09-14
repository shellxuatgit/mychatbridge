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
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    token = (await page.evaluate(() => window.localStorage.getItem('token') || '')) || ''
  } finally {
    await ctx.close().catch(() => {})
  }

  console.log('Qwen-AI Token obtained, len:', token.length)
  if (!token) throw new Error('Token not found in localStorage')

  const { QwenAiAdapter } = await import('../src/main/proxy/adapters/qwen-ai.ts')
  const provider = {
    id: 'qwen-ai',
    name: 'Qwen AI',
    type: 'builtin',
    authType: 'jwt',
    apiEndpoint: 'https://chat.qwen.ai',
    headers: {},
    enabled: true,
  } as any

  const account = {
    id: 'test-qwen',
    providerId: 'qwen-ai',
    name: 'Qwen AI',
    credentials: { token },
    status: 'active',
  } as any

  const adapter = new QwenAiAdapter(provider, account)
  console.log('Sending chat request to Qwen-AI...')
  const res = await adapter.chatCompletion({
    model: 'qwen-max',
    messages: [{ role: 'user', content: 'Say OK' }],
    stream: false,
  } as any)

  console.log('Response status:', res.response.status)
  console.log('Success! Qwen-AI is fully working.')
}

main().catch((err) => {
  console.error('Test error:', err)
  process.exit(1)
})
