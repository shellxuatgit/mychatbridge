/**
 * Offline recovery: read provider credentials from their Playwright profiles and
 * write accounts directly into ~/.mychatbridge/data.json (plaintext credentials
 * decrypt-fallback to raw values in the store). Run with the app STOPPED.
 *
 *   npx tsx scripts/_write-accounts.ts [providerId]
 */
import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import { getCredentialSource, cookiesToPayload } from '../src/main/webRuntime/credentialSources.ts'

const DATA_FILE = join(homedir(), '.mychatbridge', 'data.json')
const USERS_ROOT = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users')
const ENCRYPTION_KEY = 'chat2api-fixed-encryption-key-v1'
const ALGORITHM = 'aes-256-cbc'

function derivePassword(iv: Buffer): Buffer {
  return crypto.pbkdf2Sync(ENCRYPTION_KEY, iv.toString(), 10_000, 32, 'sha512')
}
function decryptConf(buffer: Buffer): string {
  const iv = buffer.subarray(0, 16)
  const body = buffer.subarray(17)
  const decipher = crypto.createDecipheriv(ALGORITHM, derivePassword(iv), iv)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
function encryptConf(text: string): Buffer {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, derivePassword(iv), iv)
  return Buffer.concat([iv, Buffer.from(':'), cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
}

interface Spec {
  providerId: string
  origin: string
  build?: (cookies: Array<Record<string, unknown>>, ls: Record<string, string>) => Record<string, string> | null
}

function cookieMap(cookies: Array<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of cookies) {
    const name = c.name as string
    const value = c.value as string
    if (name && value) out[name] = value
  }
  return out
}

const SPECS: Spec[] = [
  { providerId: 'glm', origin: 'https://chatglm.cn/' },
  { providerId: 'kimi', origin: 'https://www.kimi.com/' },
  { providerId: 'qwen-ai', origin: 'https://chat.qwen.ai/' },
  { providerId: 'zai', origin: 'https://chat.z.ai/' },
  { providerId: 'qwen', origin: 'https://www.qianwen.com/' },
  { providerId: 'perplexity', origin: 'https://www.perplexity.ai/' },
  { providerId: 'claude', origin: 'https://claude.ai/' },
  { providerId: 'yuanbao', origin: 'https://yuanbao.tencent.com/chat' },
  { providerId: 'minimax', origin: 'https://agent.minimaxi.com/chat' },
  { providerId: 'gemini', origin: 'https://gemini.google.com/app' },
  { providerId: 'chatgpt', origin: 'https://chatgpt.com/' },
]

const PROFILE_DIRS: Record<string, string> = {
  glm: 'glm',
  chatgpt: 'chatgpt',
  gemini: 'gemini',
}

function readLs(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k) out[k] = window.localStorage.getItem(k) || ''
  }
  return out
}

async function main(): Promise<void> {
  const only = process.argv[2]
  const store = JSON.parse(decryptConf(readFileSync(DATA_FILE)))
  const accounts: Array<Record<string, unknown>> = store.accounts || []

  for (const spec of SPECS) {
    if (only && spec.providerId !== only) continue
    const profileDir = join(USERS_ROOT, PROFILE_DIRS[spec.providerId] || 'shared')
    if (!existsSync(profileDir)) {
      console.log(`${spec.providerId}: profile dir missing`)
      continue
    }
    const ctx = await chromium.launchPersistentContext(profileDir, { headless: true, channel: 'chrome' })
    let cookies: Array<Record<string, unknown>> = []
    let ls: Record<string, string> = {}
    try {
      cookies = (await ctx.cookies()) as unknown as Array<Record<string, unknown>>
      const page = ctx.pages()[0] || (await ctx.newPage())
      await page.goto(spec.origin, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
      await page.waitForTimeout(2500)
      ls = (await page.evaluate(readLs).catch(() => ({}))) as Record<string, string>
    } finally {
      await ctx.close().catch(() => {})
    }

    const source = getCredentialSource(spec.providerId)
    let credentials: Record<string, string> | null = null

    // Provider-specific extraction (mirrors what each adapter reads).
    const cm = cookieMap(cookies)
    if (spec.providerId === 'glm') credentials = cm['chatglm_refresh_token'] ? { refresh_token: cm['chatglm_refresh_token'] } : null
    else if (spec.providerId === 'kimi') credentials = ls['access_token'] || ls['refresh_token'] || cm['kimi-auth'] ? { token: ls['access_token'] || ls['refresh_token'] || cm['kimi-auth'] } : null
    else if (spec.providerId === 'qwen-ai') credentials = ls['token'] ? { token: ls['token'] } : null
    else if (spec.providerId === 'zai') credentials = ls['token'] || cm['token'] ? { token: ls['token'] || cm['token'] } : null
    else if (spec.providerId === 'qwen') credentials = cm['tongyi_sso_ticket'] ? { ticket: cm['tongyi_sso_ticket'] } : null
    else if (spec.providerId === 'perplexity') credentials = cm['__Secure-next-auth.session-token'] ? { sessionToken: cm['__Secure-next-auth.session-token'], cookies: JSON.stringify(cm) } : null
    else if (spec.providerId === 'claude') credentials = cm['sessionKey'] ? { token: cm['sessionKey'], cookie: cm['sessionKey'] } : null
    else if (spec.providerId === 'yuanbao') credentials = cm['hy_user'] ? { token: cm['hy_user'], cookie: `hy_user=${cm['hy_user']}` } : null
    else if (spec.providerId === 'minimax') credentials = cm['_token'] || ls['_token'] ? { token: cm['_token'] || ls['_token'], ...(ls['ANONYMOUS_REAL_USER_ID'] ? { realUserID: ls['ANONYMOUS_REAL_USER_ID'] } : {}) } : null
    else if (spec.providerId === 'gemini') credentials = cm['__Secure-1PSID'] ? { token: cm['__Secure-1PSID'] } : null
    else if (spec.providerId === 'chatgpt' && source) {
      const payload = cookiesToPayload(cookies, source)
      credentials = (payload?.credentials as Record<string, string>) || null
    }

    if (!credentials) {
      console.log(`${spec.providerId}: SKIP (no credential) — cookies=${Object.keys(cm).length}, ls=${Object.keys(ls).length}`)
      continue
    }

    const existing = accounts.find((a) => a.providerId === spec.providerId)
    if (existing) {
      existing.credentials = credentials
      existing.status = 'active'
      console.log(`${spec.providerId}: UPDATED (${Object.keys(credentials).join(', ')})`)
    } else {
      accounts.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        providerId: spec.providerId,
        name: spec.providerId,
        credentials,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        requestCount: 0,
        todayUsed: 0,
        lastStatusCheck: 0,
        lastUsed: 0,
      })
      console.log(`${spec.providerId}: CREATED (${Object.keys(credentials).join(', ')})`)
    }
  }

  store.accounts = accounts
  writeFileSync(DATA_FILE, encryptConf(JSON.stringify(store, undefined, '\t')))
  console.log('\nwrote data.json with', accounts.length, 'accounts')
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
