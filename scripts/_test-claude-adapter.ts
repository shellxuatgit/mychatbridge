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
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  try {
    const { ClaudeBrowserAdapter } = await import('../src/main/proxy/adapters/claudeBrowser.ts')
    const adapter = new ClaudeBrowserAdapter(ctx, 'claude-3-5-sonnet-20241022')

    console.log('Sending message to Claude via ClaudeBrowserAdapter...')
    const result = await adapter.chatCompletion(
      [{ role: 'user', content: 'What is 15 + 27? Reply only with the number.' }],
      false
    )

    console.log('\n--- Claude Browser Result ---')
    console.log('OK:', result.ok)
    console.log('Observed Model:', result.model)
    console.log('Content:', JSON.stringify(result.content))
    console.log('Usage Tokens:', result.usage)
    console.log('Finish Reason:', result.finishReason)
    if (result.error) console.log('Error:', result.error)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
