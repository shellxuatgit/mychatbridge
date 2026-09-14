/**
 * Verify a Playwright-captured provider credential against the live upstream
 * API, using the SAME request shape as the production adapter.
 *
 *   npx tsx scripts/_verify-cred.ts <providerId>
 *
 * Prints only status codes, booleans and short error strings — never the
 * credential value itself.
 */
import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { getCredentialSource, cookiesToPayload } from '../src/main/webRuntime/credentialSources.ts'
import { glmConfig } from '../src/main/providers/builtin/glm.ts'

async function readProfileCookies(providerId: string): Promise<Array<Record<string, unknown>>> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', providerId)
  if (!existsSync(profileDir)) throw new Error(`no profile dir for ${providerId}`)

  let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null
  for (const opts of [
    { headless: true, channel: 'chrome' as const },
    { headless: true, channel: 'msedge' as const },
  ]) {
    try {
      ctx = await chromium.launchPersistentContext(profileDir, opts)
      break
    } catch {
      /* try next channel */
    }
  }
  if (!ctx) throw new Error('could not launch a browser for the profile')
  try {
    const cookies = (await ctx.cookies()) as unknown as Array<Record<string, unknown>>
    const source = getCredentialSource(providerId)!
    return cookies.filter((c) => source.domains.some((d) => String(c.domain).includes(d)))
  } finally {
    await ctx.close().catch(() => {})
  }
}

function generateSign(): { timestamp: string; nonce: string; sign: string } {
  const crypto = require('crypto') as typeof import('crypto')
  const e = Date.now()
  const A = e.toString()
  const t = A.length
  const o = A.split('').map((c) => Number(c))
  const i = o.reduce((acc, val) => acc + val, 0) - o[t - 2]
  const a = i % 10
  const timestamp = A.substring(0, t - 2) + a + A.substring(t - 1, t)
  const nonce = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
  const sign = crypto.createHash('md5').update(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`).digest('hex')
  return { timestamp, nonce, sign }
}

async function main(): Promise<void> {
  const providerId = process.argv[2]
  if (!providerId) {
    console.error('usage: npx tsx scripts/_verify-cred.ts <providerId>')
    process.exit(1)
  }

  console.log(`=== verify ${providerId} ===`)
  const cookies = await readProfileCookies(providerId)
  console.log('domain cookies:', cookies.length)

  const source = getCredentialSource(providerId)!
  const payload = cookiesToPayload(cookies, source)

  // Per-provider override: the shared cookiesToPayload() only knows about the
  // DeepSeek `authorization` cookie, so probe the real credential directly to
  // find out whether the captured session itself is valid upstream.
  const OVERRIDES: Record<string, { cookie: string; field: string }> = {
    glm: { cookie: 'chatglm_refresh_token', field: 'refresh_token' },
    kimi: { cookie: 'kimi-auth', field: 'token' },
    qwen: { cookie: 'tongyi_sso_ticket', field: 'ticket' },
    zai: { cookie: 'token', field: 'token' },
  }
  const override = OVERRIDES[providerId]

  if (!payload && !override) {
    console.log('EXTRACT: FAILED — cookiesToPayload returned null')
    console.log('  cookie names present:', cookies.map((c) => c.name).join(', '))
    process.exit(1)
  }

  let credentials: Record<string, string>
  if (payload) {
    console.log('EXTRACT: OK  credentials:', Object.keys(payload.credentials).join(', '))
    credentials = payload.credentials
  } else {
    const raw = cookies.find((c) => c.name === override.cookie)?.value
    if (typeof raw !== 'string' || !raw) {
      console.log(`EXTRACT: FAILED — override cookie "${override.cookie}" not present`)
      console.log('  cookie names present:', cookies.map((c) => c.name).join(', '))
      process.exit(1)
    }
    credentials = { [override.field]: raw }
    console.log(`EXTRACT: shared helper returned null; probing "${override.cookie}" directly`)
    console.log('EXTRACT: OK  credentials:', Object.keys(credentials).join(', '))
  }
  for (const [k, v] of Object.entries(credentials)) {
    console.log(`  ${k}: len=${String(v).length}`)
  }

  if (providerId === 'glm') {
    const axios = (await import('axios')).default
    const refreshToken = credentials.refresh_token || credentials.token
    const sign = generateSign()
    const res = await axios.post(
      `${glmConfig.apiEndpoint.replace('/api', '')}/chatglm/user-api/user/refresh`,
      {},
      {
        headers: {
          Authorization: `Bearer ${refreshToken}`,
          'Content-Type': 'application/json',
          Origin: 'https://chatglm.cn',
          Referer: 'https://chatglm.cn/',
          'App-Name': 'chatglm',
          'X-App-Platform': 'pc',
          'X-App-Version': '0.0.1',
          'X-Device-Id': sign.nonce,
          'X-Nonce': sign.nonce,
          'X-Request-Id': sign.nonce,
          'X-Sign': sign.sign,
          'X-Timestamp': sign.timestamp,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        },
        timeout: 20000,
        validateStatus: () => true,
      },
    )
    const d = (res.data || {}) as Record<string, unknown>
    const result = (d.result || {}) as Record<string, unknown>
    console.log('\nUPSTREAM /user-api/user/refresh')
    console.log('  http        :', res.status)
    console.log('  code        :', d.code ?? '(none)')
    console.log('  status      :', d.status ?? '(none)')
    console.log('  message     :', typeof d.message === 'string' ? d.message.slice(0, 120) : '(none)')
    console.log('  has access  :', Boolean(result.access_token))
    console.log('  has refresh :', Boolean(result.refresh_token))
    console.log('\nVERDICT:', res.status === 200 && Boolean(result.access_token) ? 'PASS' : 'FAIL')
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
