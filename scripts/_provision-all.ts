/**
 * Provision accounts for every verified web provider from its Playwright profile
 * (per-provider dirs for legacy providers, the `shared` dir for the rest).
 *
 *   npx tsx scripts/_provision-all.ts [providerId]
 */
import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'

const SECRET_FILE = join(homedir(), '.mychatbridge', 'management-secret.txt')
const DATA_FILE = join(homedir(), '.mychatbridge', 'data.json')
const PORT = process.env.MCB_PORT || '8080'
const BASE = `http://127.0.0.1:${PORT}`
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

/** The app periodically rewrites config; re-enable the management API just-in-time. */
function ensureManagementApi(): void {
  const secret = readSecret()
  const store = JSON.parse(decryptConf(readFileSync(DATA_FILE)))
  store.config = {
    ...store.config,
    managementApi: { ...(store.config.managementApi ?? {}), enableManagementApi: true, managementApiSecret: secret },
  }
  writeFileSync(DATA_FILE, encryptConf(JSON.stringify(store, undefined, '\t')))
}

interface ProfileData {
  cookies: Record<string, string>
  ls: Record<string, string>
}

interface ProviderSpec {
  providerId: string
  profileDir: string
  origin: string
  build: (d: ProfileData) => Record<string, string> | null
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

const SPECS: ProviderSpec[] = [
  {
    providerId: 'glm',
    profileDir: 'glm',
    origin: 'https://chatglm.cn/',
    build: ({ cookies }) =>
      cookies['chatglm_refresh_token'] ? { refresh_token: cookies['chatglm_refresh_token'] } : null,
  },
  {
    providerId: 'chatgpt',
    profileDir: 'chatgpt',
    origin: 'https://chatgpt.com/',
    build: ({ cookies }) => {
      const sessionToken = cookies['__Secure-next-auth.session-token']
      if (!sessionToken) return null
      return { cookie: cookieHeader(cookies), sessionToken }
    },
  },
  {
    providerId: 'gemini',
    profileDir: 'gemini',
    origin: 'https://gemini.google.com/app',
    build: ({ cookies }) => {
      const token = cookies['__Secure-1PSID']
      return token ? { token } : null
    },
  },
  {
    providerId: 'kimi',
    profileDir: 'shared',
    origin: 'https://www.kimi.com/',
    build: ({ cookies, ls }) => {
      const token = ls['access_token'] || ls['refresh_token'] || cookies['kimi-auth']
      return token ? { token } : null
    },
  },
  {
    providerId: 'qwen-ai',
    profileDir: 'shared',
    origin: 'https://chat.qwen.ai/',
    build: ({ cookies, ls }) => {
      const token = ls['token'] || cookies['token']
      return token ? { token } : null
    },
  },
  {
    providerId: 'zai',
    profileDir: 'shared',
    origin: 'https://chat.z.ai/',
    build: ({ cookies, ls }) => {
      const token = ls['token'] || cookies['token']
      return token ? { token } : null
    },
  },
  {
    providerId: 'qwen',
    profileDir: 'shared',
    origin: 'https://www.qianwen.com/',
    build: ({ cookies }) => (cookies['tongyi_sso_ticket'] ? { ticket: cookies['tongyi_sso_ticket'] } : null),
  },
  {
    providerId: 'perplexity',
    profileDir: 'shared',
    origin: 'https://www.perplexity.ai/',
    build: ({ cookies }) => {
      const sessionToken = cookies['__Secure-next-auth.session-token']
      return sessionToken ? { sessionToken, cookies: JSON.stringify(cookies) } : null
    },
  },
  {
    providerId: 'claude',
    profileDir: 'shared',
    origin: 'https://claude.ai/',
    build: ({ cookies }) => {
      const sessionKey = cookies['sessionKey']
      return sessionKey ? { token: sessionKey, cookie: sessionKey } : null
    },
  },
  {
    providerId: 'yuanbao',
    profileDir: 'shared',
    origin: 'https://yuanbao.tencent.com/chat',
    build: ({ cookies }) => {
      const hy = cookies['hy_user']
      return hy ? { token: hy, cookie: `hy_user=${hy}` } : null
    },
  },
  {
    providerId: 'minimax',
    profileDir: 'shared',
    origin: 'https://agent.minimaxi.com/chat',
    build: ({ cookies, ls }) => {
      const token = cookies['_token'] || ls['_token']
      if (!token) return null
      const realUserID = ls['ANONYMOUS_REAL_USER_ID'] || ls['USER_HARD_WARE_INFO'] || ''
      return realUserID ? { token, realUserID } : { token }
    },
  },
]

function readSecret(): string {
  return readFileSync(SECRET_FILE, 'utf8').trim()
}

async function readProfile(ctx: any, origin: string): Promise<ProfileData> {
  const cookies: Record<string, string> = {}
  for (const ck of await ctx.cookies()) cookies[ck.name] = ck.value
  const page = ctx.pages()[0] || (await ctx.newPage())
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(2500)
  } catch {
    /* ignore */
  }
  const ls = (await page
    .evaluate(() => {
      const out: Record<string, string> = {}
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k) out[k] = window.localStorage.getItem(k) || ''
      }
      return out
    })
    .catch(() => ({}))) as Record<string, string>
  return { cookies, ls }
}

async function upsertAccount(providerId: string, credentials: Record<string, string>): Promise<void> {
  const secret = readSecret()

  const listOnce = async () => {
    ensureManagementApi()
    const res = await fetch(`${BASE}/v0/management/accounts`, { headers: { 'X-Management-Secret': secret } })
    const text = await res.text()
    try {
      return JSON.parse(text) as { data?: Array<{ id: string; providerId: string }> }
    } catch {
      return null
    }
  }

  let list = await listOnce()
  if (!list) list = await listOnce()
  const existing = list?.data?.find((a) => a.providerId === providerId)

  const body = JSON.stringify(existing ? { credentials } : { providerId, name: providerId, credentials })
  const url = existing ? `${BASE}/v0/management/accounts/${existing.id}` : `${BASE}/v0/management/accounts`
  const method = existing ? 'PUT' : 'POST'

  for (let attempt = 0; attempt < 3; attempt++) {
    ensureManagementApi()
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Management-Secret': secret },
      body,
    })
    if (res.ok) {
      console.log(`  ${existing ? 'UPDATE' : 'CREATE'} ${providerId} → ${res.status}`)
      return
    }
    if (res.status !== 404 || attempt === 2) {
      console.log(`  FAIL ${providerId} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}

async function main(): Promise<void> {
  const only = process.argv[2]
  const byDir = new Map<string, ProviderSpec[]>()
  for (const spec of SPECS) {
    if (only && spec.providerId !== only) continue
    const arr = byDir.get(spec.profileDir) || []
    arr.push(spec)
    byDir.set(spec.profileDir, arr)
  }

  for (const [profileDir, specs] of byDir) {
    const dir = join(USERS_ROOT, profileDir)
    if (!existsSync(dir)) {
      console.log(`\n[${profileDir}] profile dir missing — skip`)
      continue
    }
    const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chrome' })
    try {
      for (const spec of specs) {
        const data = await readProfile(ctx, spec.origin)
        const credentials = spec.build(data)
        console.log(
          `\n=== ${spec.providerId} (dir=${profileDir}, cookies=${Object.keys(data.cookies).length}, ls=${Object.keys(data.ls).length}) ===`
        )
        if (!credentials) {
          console.log('  SKIP — could not extract credentials')
          continue
        }
        console.log('  fields:', Object.entries(credentials).map(([k, v]) => `${k}=${String(v).length}`).join(', '))
        await upsertAccount(spec.providerId, credentials)
      }
    } finally {
      await ctx.close().catch(() => {})
    }
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
