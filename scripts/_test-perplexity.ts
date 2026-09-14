import { join } from 'path'
import { homedir } from 'os'
import Module from 'module'
import http from 'http'
import https from 'https'
import { EventEmitter } from 'events'

// stub electron with net.request
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
      net: {
        request: (opts: any) => {
          const emitter = new EventEmitter() as any
          const reqHeaders: Record<string, string> = {}
          emitter.setHeader = (k: string, v: string) => { reqHeaders[k] = v }
          emitter.write = (data: any) => { emitter._body = (emitter._body || '') + data }
          emitter.end = () => {
            const parsedUrl = new URL(opts.url)
            const req = https.request({
              hostname: parsedUrl.hostname,
              port: 443,
              path: parsedUrl.pathname + parsedUrl.search,
              method: opts.method,
              headers: reqHeaders,
            }, (res) => {
              const resEmitter = new EventEmitter() as any
              resEmitter.statusCode = res.statusCode
              resEmitter.headers = res.headers
              emitter.emit('response', resEmitter)
              res.on('data', (d) => resEmitter.emit('data', d))
              res.on('end', () => resEmitter.emit('end'))
              res.on('error', (e) => resEmitter.emit('error', e))
            })
            req.on('error', (e) => emitter.emit('error', e))
            if (emitter._body) req.write(emitter._body)
            req.end()
          }
          return emitter
        }
      }
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright')
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: true, channel: 'chrome' })

  let sessionToken = ''
  let cookiesMap: Record<string, string> = {}
  try {
    const cookies = await ctx.cookies()
    const pCookies = cookies.filter((c) => c.domain.includes('perplexity.ai'))
    for (const c of pCookies) {
      cookiesMap[c.name] = c.value
    }
    sessionToken = cookiesMap['__Secure-next-auth.session-token'] || ''
  } finally {
    await ctx.close().catch(() => {})
  }

  console.log('Perplexity sessionToken len:', sessionToken.length)
  if (!sessionToken) throw new Error('Perplexity sessionToken not found')

  const { PerplexityAdapter } = await import('../src/main/proxy/adapters/perplexity.ts')
  const provider = {
    id: 'perplexity',
    name: 'Perplexity',
    type: 'builtin',
    authType: 'cookie',
    apiEndpoint: 'https://www.perplexity.ai',
    headers: {},
    enabled: true,
  } as any

  const account = {
    id: 'test-perplexity',
    providerId: 'perplexity',
    name: 'Perplexity',
    credentials: {
      sessionToken,
      cookies: cookiesMap as any,
    },
    status: 'active',
  } as any

  const adapter = new PerplexityAdapter(provider, account)
  console.log('Testing Perplexity adapter chatCompletion...')
  const res = await adapter.chatCompletion({
    model: 'sonar',
    messages: [{ role: 'user', content: 'Say OK' }],
    stream: false,
  } as any)

  console.log('Perplexity response status:', res.response.statusCode)
  console.log('Success! Perplexity adapter chatCompletion completed.')
}

main().catch((err) => {
  console.error('Perplexity Test error:', err)
  process.exit(1)
})
