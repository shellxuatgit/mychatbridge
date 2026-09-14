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
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  try {
    const { YuanbaoBrowserAdapter } = await import('../src/main/proxy/adapters/yuanbaoBrowser.ts')
    const adapter = new YuanbaoBrowserAdapter(ctx)

    console.log('Sending message to Yuanbao via YuanbaoBrowserAdapter...')
    const result = await adapter.chatCompletion([
      { role: 'user', content: '请只回复数字 42，不要其他内容' },
    ])

    console.log('\n--- Yuanbao Browser Result ---')
    console.log('OK:', result.ok)
    console.log('Content:', JSON.stringify(result.content))
    console.log('Finish Reason:', result.finishReason)
    console.log('Usage:', result.usage)
    if (result.error) console.log('Error:', result.error)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
