/**
 * Capture a provider credential from its Playwright profile via the production
 * extraction path, then create the account through the Management API.
 *
 *   npx tsx scripts/_provision-account.ts <providerId> [accountName]
 *
 * Never prints credential values.
 */
import { chromium } from 'playwright'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { getCredentialSource, cookiesToPayload } from '../src/main/webRuntime/credentialSources.ts'

const STORAGE_DIR = join(homedir(), '.mychatbridge')

function readSecret(): string {
  const fromFile = join(STORAGE_DIR, 'management-secret.txt')
  if (existsSync(fromFile)) return readFileSync(fromFile, 'utf8').trim()
  throw new Error('management secret not found — run scripts/_enable-management-api.mjs first')
}

/** Probe origins for providers whose credential lives in localStorage. */
const LOCAL_STORAGE_ORIGINS: Record<string, string> = {
  glm: 'https://chatglm.cn/',
  'qwen-ai': 'https://chat.qwen.ai/',
  zai: 'https://chat.z.ai/',
  kimi: 'https://www.kimi.com/',
  minimax: 'https://agent.minimaxi.com/chat',
  qwen: 'https://chat2.qianwen.com/',
  mimo: 'https://aistudio.xiaomimimo.com/',
  perplexity: 'https://www.perplexity.ai/',
  claude: 'https://claude.ai/',
  gemini: 'https://gemini.google.com/app',
  yuanbao: 'https://yuanbao.tencent.com/chat',
}

async function main(): Promise<void> {
  const providerId = process.argv[2]
  const accountName = process.argv[3] || providerId.toUpperCase()
  if (!providerId) {
    console.error('usage: npx tsx scripts/_provision-account.ts <providerId> [accountName]')
    process.exit(1)
  }

  const source = getCredentialSource(providerId)
  if (!source) throw new Error(`no CREDENTIAL_SOURCES entry for ${providerId}`)

  const profileDir = join(STORAGE_DIR, 'web-runtime', 'playwright-users', providerId)
  if (!existsSync(profileDir)) throw new Error(`no playwright profile for ${providerId}`)

  console.log(`=== provision ${providerId} ===`)
  let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null
  for (const opts of [
    { headless: true, channel: 'chrome' as const },
    { headless: true, channel: 'msedge' as const },
  ]) {
    try {
      ctx = await chromium.launchPersistentContext(profileDir, opts)
      console.log('launched profile via', opts.channel)
      break
    } catch (e) {
      console.log('launch failed:', opts.channel, String((e as Error).message).split('\n')[0])
    }
  }
  if (!ctx) throw new Error('could not launch the profile')

  let payload = null as ReturnType<typeof cookiesToPayload>

  try {
    const all = (await ctx.cookies()) as unknown as Array<Record<string, unknown>>
    const domainCookies = all.filter((c) =>
      source.domains.some((d) => String(c.domain).includes(d))
    )
    console.log('domain cookies:', domainCookies.length)
    payload = cookiesToPayload(domainCookies, source)

    if (!payload) {
      // Fall back to localStorage for providers that keep the token there.
      const origin = LOCAL_STORAGE_ORIGINS[providerId]
      if (origin) {
        const page = ctx.pages()[0] || (await ctx.newPage())
        try {
          await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 })
          await page.waitForTimeout(3000)
        } catch (e) {
          console.log('nav warn:', String((e as Error).message).split('\n')[0])
        }
        const lsCookies = await page
          .evaluate(() => {
            const out: Array<{ name: string; value: string }> = []
            for (let i = 0; i < window.localStorage.length; i++) {
              const k = window.localStorage.key(i) as string
              out.push({ name: k, value: window.localStorage.getItem(k) || '' })
            }
            return out
          })
          .catch(() => [] as Array<{ name: string; value: string }>)
        const merged = [...domainCookies, ...lsCookies]
        console.log('localStorage entries:', lsCookies.length)
        payload = cookiesToPayload(merged, source)
      }
    }
  } finally {
    await ctx.close().catch(() => {})
  }

  if (!payload) {
    console.log('RESULT: EXTRACT_FAILED — no usable credential from cookies or localStorage')
    process.exit(1)
  }

  console.log('extracted credentials:', Object.keys(payload.credentials).join(', '))
  for (const [k, v] of Object.entries(payload.credentials)) {
    console.log(`  ${k}: len=${String(v).length}`)
  }

  const secret = readSecret()
  const res = await fetch('http://127.0.0.1:8082/v0/management/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Management-Secret': secret },
    body: JSON.stringify({
      providerId: source.storageKey,
      name: accountName,
      credentials: payload.credentials,
    }),
  })
  const bodyText = await res.text()
  console.log('\nPOST /v0/management/accounts →', res.status)
  if (!res.ok) {
    console.log('body:', bodyText.slice(0, 500))
    process.exit(1)
  }
  const parsed = JSON.parse(bodyText) as { data?: { id?: string; providerId?: string; status?: string } }
  console.log('account id  :', parsed.data?.id)
  console.log('provider    :', parsed.data?.providerId)
  console.log('status      :', parsed.data?.status)
  writeFileSync(join(tmpdir(), `mcb-account-${providerId}.json`), JSON.stringify(parsed.data, null, 2))
  console.log('RESULT: ACCOUNT_CREATED')
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
