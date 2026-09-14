import { join } from 'path'
import { homedir } from 'os'
import Module from 'module'

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
  let cookies = ''
  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    token = (await page.evaluate(() => window.localStorage.getItem('token') || '')) || ''
    const cks = await ctx.cookies()
    cookies = cks.map((c) => `${c.name}=${c.value}`).join('; ')
  } finally {
    await ctx.close().catch(() => {})
  }

  const { QwenAiAdapter } = await import('../src/main/proxy/adapters/qwen-ai.ts')
  const provider = { id: 'qwen-ai', name: 'Qwen AI', type: 'builtin', authType: 'jwt', apiEndpoint: 'https://chat.qwen.ai', headers: {}, enabled: true } as any
  const account = { id: 'probe', providerId: 'qwen-ai', name: 'Qwen AI', credentials: { token, cookies }, status: 'active' } as any
  const adapter = new QwenAiAdapter(provider, account)

  const { response } = await adapter.chatCompletion({
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: '请回复数字 42' }],
    stream: true,
  } as any)

  const stream = response.data as NodeJS.ReadableStream
  let buf = ''
  await new Promise<void>((resolve) => {
    stream.on('data', (d: Buffer) => {
      buf += d.toString()
      if (buf.length > 3000) resolve()
    })
    stream.on('end', () => resolve())
    stream.on('error', () => resolve())
    setTimeout(resolve, 40000)
  })
  console.log('=== RAW UPSTREAM SSE (head) ===')
  console.log(buf.slice(0, 3000))
}

main().catch(console.error)
