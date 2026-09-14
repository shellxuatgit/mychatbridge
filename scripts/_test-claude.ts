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

  let sessionKey = ''
  try {
    const cookies = await ctx.cookies()
    const sk = cookies.find((c) => c.name === 'sessionKey')
    sessionKey = sk?.value || ''
  } finally {
    await ctx.close().catch(() => {})
  }

  console.log('Claude sessionKey len:', sessionKey.length)
  if (!sessionKey) throw new Error('Claude sessionKey not found')

  const { ClaudeAdapter } = await import('../src/main/proxy/adapters/claude.ts')
  const provider = {
    id: 'claude',
    name: 'Claude',
    type: 'builtin',
    authType: 'cookie',
    apiEndpoint: 'https://claude.ai',
    headers: {},
    enabled: true,
  } as any

  const account = {
    id: 'test-claude',
    providerId: 'claude',
    name: 'Claude',
    credentials: { token: sessionKey, cookie: sessionKey },
    status: 'active',
  } as any

  const adapter = new ClaudeAdapter(provider, account)
  console.log('Sending chat request to Claude...')
  const res = await adapter.chatCompletion({
    model: 'claude-3-5-sonnet-20241022',
    messages: [{ role: 'user', content: 'Say OK' }],
    stream: false,
  } as any)

  console.log('Claude response status:', res.response.status)
  console.log('Success! Claude is fully working.')
}

main().catch((err) => {
  console.error('Claude Test error:', err)
  process.exit(1)
})
