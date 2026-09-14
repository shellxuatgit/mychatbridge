/**
 * Reproduce the GLM adapter call in isolation, with a full stack trace.
 *
 *   npx tsx scripts/_glm-adapter-repro.ts [headers]
 *
 * Imports the REAL GLMAdapter the proxy uses. Electron modules are stubbed so
 * the adapter's storeManager import resolves outside an Electron runtime.
 */
import { join } from 'path'
import { homedir } from 'os'
import Module from 'module'

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- stub electron before anything imports it -------------------------------
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

async function readRefreshToken(): Promise<string> {
  const { chromium } = await import('playwright')
  const dir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'glm')
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chrome' })
  try {
    const c = (await ctx.cookies()).find((x) => x.name === 'chatglm_refresh_token')
    if (!c) throw new Error('chatglm_refresh_token not found')
    return c.value
  } finally {
    await ctx.close().catch(() => {})
  }
}

async function main(): Promise<void> {
  const refreshToken = await readRefreshToken()
  console.log('refresh_token len:', refreshToken.length)

  const { GLMAdapter } = await import('../src/main/proxy/adapters/glm.ts')

  const provider = {
    id: 'glm',
    name: 'GLM',
    type: 'builtin',
    authType: 'refresh_token',
    apiEndpoint: 'https://chatglm.cn/api',
    headers: {},
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  } as any

  const account = {
    id: 'repro',
    providerId: 'glm',
    name: 'GLM',
    credentials: { refresh_token: refreshToken },
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
    requestCount: 0,
    todayUsed: 0,
    lastStatusCheck: 0,
    lastUsed: 0,
  } as any

  const adapter = new GLMAdapter(provider, account)

  console.log('\n--- calling GLMAdapter.chatCompletion ---')
  try {
    const res = await adapter.chatCompletion({
      model: 'glm-5.1',
      originalModel: 'GLM-5.1',
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: false,
    } as any)
    console.log('returned ok. upstream status:', res.response.status)
  } catch (e) {
    console.log('\n=== THREW ===')
    console.log('  instanceof Error :', e instanceof Error)
    console.log('  typeof           :', typeof e)
    console.log('  constructor      :', (e as any)?.constructor?.name)
    console.log('  message (JSON)   :', JSON.stringify((e as any)?.message))
    console.log('  String(e)        :', String(e))
    if (e && typeof e === 'object') {
      console.log('  own keys         :', Object.keys(e as object).join(', '))
      try {
        console.log('  JSON.stringify   :', JSON.stringify(e).slice(0, 900))
      } catch {
        console.log('  JSON.stringify   : <circular>')
      }
    }
    if (e instanceof Error && e.stack) {
      console.log('\n  stack:')
      for (const line of e.stack.split('\n').slice(0, 14)) console.log('    ' + line)
    }
  }
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
