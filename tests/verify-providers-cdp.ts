/**
 * Provider availability check via Playwright CDP.
 *
 * Flow:
 *   1. Copies the real Chrome profile to a temp directory (avoids profile lock)
 *   2. Launches Chrome with --remote-debugging-port=9222 using the copy
 *   3. Connects via Playwright CDP
 *   4. Navigates to each provider, extracts token via JS injection
 *   5. Probes the provider's API to verify the token works
 *
 * Usage:  npx tsx tests/verify-providers-cdp.ts
 *   (Chrome must NOT be running before execution)
 */

import { chromium, type BrowserContext, type Page } from 'playwright'
import { execSync, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CHROME_USER_DATA = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
const CDP_PORT = 9222
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`

// ---------------------------------------------------------------------------
// Provider extraction configs
// ---------------------------------------------------------------------------

interface ProviderExtract {
  id: string
  name: string
  loginUrl: string
  extract: (page: Page, ctx: BrowserContext) => Promise<string | null>
  probe: (token: string) => Promise<{ ok: boolean; status: number; detail: string }>
  skip?: boolean
}

function parseToken(raw: string | null): string | null {
  if (!raw || raw.length < 10) return null
  // DeepSeek wraps token in JSON: {"value":"..."}
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj.value === 'string' && obj.value.length > 10) return obj.value
  } catch { /* not JSON, use as-is */ }
  return raw
}

const PROVIDERS: ProviderExtract[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    loginUrl: 'https://chat.deepseek.com',
    extract: async (page) => {
      const raw = await page.evaluate(() => localStorage.getItem('userToken'))
      return parseToken(raw)
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://chat.deepseek.com/v0/users/current', {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Origin: 'https://chat.deepseek.com',
            Referer: 'https://chat.deepseek.com/',
          },
          timeout: 15000,
          validateStatus: () => true,
        })
        const hasToken = !!res.data?.data?.biz_data?.token
        return {
          ok: res.status === 200 && hasToken,
          status: res.status,
          detail: hasToken ? 'access token obtained' : `HTTP ${res.status}, no biz_data.token`,
        }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'glm',
    name: 'GLM',
    loginUrl: 'https://chatglm.cn',
    extract: async (page, ctx) => {
      const ls = await page.evaluate(() => localStorage.getItem('chatglm_refresh_token'))
      if (ls && ls.length > 10) return ls
      const cookies = await ctx.cookies('https://chatglm.cn')
      return cookies.find((c) => c.name === 'chatglm_refresh_token')?.value || null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.post(
          'https://chatglm.cn/chatglm/backendapi/user/parking/user/token',
          {},
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'User-Agent': 'Mozilla/5.0',
              Origin: 'https://chatglm.cn',
              Referer: 'https://chatglm.cn/',
              'Content-Type': 'application/json',
            },
            timeout: 15000,
            validateStatus: () => true,
          },
        )
        const hasToken = !!res.data?.result?.access_token
        return {
          ok: res.status === 200 && hasToken,
          status: res.status,
          detail: hasToken ? 'access token obtained' : `HTTP ${res.status}`,
        }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    loginUrl: 'https://www.kimi.com',
    extract: async (page) => {
      // Kimi: check localStorage for token-like keys
      const ls = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!
          if (k.includes('token') || k.includes('auth') || k.includes('access')) {
            const v = localStorage.getItem(k)!
            if (v && v.length > 20) return v
          }
        }
        return null
      })
      return parseToken(ls)
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://www.kimi.com/api/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200, status: res.status, detail: res.status === 200 ? 'user info obtained' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    loginUrl: 'https://agent.minimaxi.com',
    extract: async (page) => {
      const ls = await page.evaluate(() => localStorage.getItem('_token'))
      if (ls && ls.length > 10) return parseToken(ls)
      const detail = await page.evaluate(() => localStorage.getItem('user_detail_agent'))
      if (detail) {
        try {
          const parsed = JSON.parse(detail)
          return parsed?.token || parsed?.access_token || null
        } catch { /* ignore */ }
      }
      return null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://agent.minimaxi.com/api/user/info', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200, status: res.status, detail: res.status === 200 ? 'user info obtained' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'mimo',
    name: 'Mimo',
    loginUrl: 'https://aistudio.xiaomimimo.com',
    extract: async (_page, ctx) => {
      const cookies = await ctx.cookies('https://aistudio.xiaomimimo.com')
      return cookies.find((c) => c.name === 'serviceToken')?.value || null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://aistudio.xiaomimimo.com/api/user/info', {
          headers: { Cookie: `serviceToken=${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200, status: res.status, detail: res.status === 200 ? 'user info obtained' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    loginUrl: 'https://www.perplexity.ai',
    extract: async (_page, ctx) => {
      const cookies = await ctx.cookies('https://www.perplexity.ai')
      const session = cookies.find(
        (c) => c.name === '__Secure-next-auth.session-token' || c.name === 'next-auth.session-token',
      )
      return session?.value || null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://www.perplexity.ai/api/auth/session', {
          headers: { Cookie: `__Secure-next-auth.session-token=${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200 && !!res.data?.user, status: res.status, detail: res.status === 200 ? 'session valid' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'qwen',
    name: 'Qwen',
    loginUrl: 'https://www.qianwen.com',
    extract: async (_page, ctx) => {
      const cookies = await ctx.cookies('https://www.qianwen.com')
      return cookies.find((c) => c.name === 'tongyi_sso_ticket')?.value || null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://www.qianwen.com/api/user', {
          headers: { Cookie: `tongyi_sso_ticket=${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200, status: res.status, detail: res.status === 200 ? 'user info obtained' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'qwen-ai',
    name: 'Qwen AI (International)',
    loginUrl: 'https://chat.qwen.ai',
    extract: async (page, ctx) => {
      const ls = await page.evaluate(() => localStorage.getItem('token'))
      if (ls && ls.length > 10) return parseToken(ls)
      const cookies = await ctx.cookies('https://chat.qwen.ai')
      return cookies.find((c) => c.name === 'token')?.value || null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://chat.qwen.ai/api/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200, status: res.status, detail: res.status === 200 ? 'user info obtained' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'zai',
    name: 'Z.ai',
    loginUrl: 'https://chat.z.ai',
    extract: async (page, ctx) => {
      const ls = await page.evaluate(() => localStorage.getItem('token'))
      if (ls && ls.length > 10) return parseToken(ls)
      const cookies = await ctx.cookies('https://chat.z.ai')
      return cookies.find((c) => c.name === 'token')?.value || null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://chat.z.ai/api/user', {
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200, status: res.status, detail: res.status === 200 ? 'user info obtained' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    loginUrl: 'https://chatgpt.com',
    extract: async (_page, ctx) => {
      const cookies = await ctx.cookies('https://chatgpt.com')
      const session = cookies.find(
        (c) => c.name === '__Secure-next-auth.session-token' || c.name === 'next-auth.session-token',
      )
      return session?.value || null
    },
    probe: async (token) => {
      const axios = (await import('axios')).default
      try {
        const res = await axios.get('https://chatgpt.com/api/auth/session', {
          headers: { Cookie: `__Secure-next-auth.session-token=${token}`, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: () => true,
        })
        return { ok: res.status === 200 && !!res.data?.user, status: res.status, detail: res.status === 200 ? 'session valid' : `HTTP ${res.status}` }
      } catch (e: any) {
        return { ok: false, status: 0, detail: e.message }
      }
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    loginUrl: '',
    extract: async () => null,
    probe: async () => ({ ok: false, status: 0, detail: 'scaffold' }),
    skip: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    loginUrl: '',
    extract: async () => null,
    probe: async () => ({ ok: false, status: 0, detail: 'scaffold' }),
    skip: true,
  },
  {
    id: 'yuanbao',
    name: 'Yuanbao',
    loginUrl: '',
    extract: async () => null,
    probe: async () => ({ ok: false, status: 0, detail: 'scaffold' }),
    skip: true,
  },
]

// ---------------------------------------------------------------------------
// Chrome profile copy + CDP launch
// ---------------------------------------------------------------------------

function copyChromeProfile(): string {
  const dst = path.join(os.tmpdir(), 'mcb-cdp-profile')
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })

  // Copy Local State
  const localState = path.join(CHROME_USER_DATA, 'Local State')
  if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(dst, 'Local State'))

  // Copy Default profile (cookies, localStorage, etc.)
  const defaultDir = path.join(CHROME_USER_DATA, 'Default')
  if (fs.existsSync(defaultDir)) {
    fs.cpSync(defaultDir, path.join(dst, 'Default'), { recursive: true })
  }
  return dst
}

function launchChrome(profileDir: string): ReturnType<typeof spawn> {
  const child = spawn(CHROME_EXE, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  return child
}

function killChromeCopies(): void {
  try {
    execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' })
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Result {
  id: string
  name: string
  status: 'PASS' | 'FAIL' | 'SKIP' | 'NO_CRED' | 'ERR'
  detail: string
  latencyMs: number
}

async function testProvider(ctx: BrowserContext, p: ProviderExtract): Promise<Result> {
  const t0 = Date.now()
  if (p.skip) return { id: p.id, name: p.name, status: 'SKIP', detail: 'scaffold', latencyMs: 0 }

  let page: Page | null = null
  try {
    page = await ctx.newPage()
    await page.goto(p.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(3000)

    const token = await p.extract(page, ctx)
    if (!token) {
      return { id: p.id, name: p.name, status: 'NO_CRED', detail: 'no token found on page', latencyMs: Date.now() - t0 }
    }

    const probeResult = await p.probe(token)
    return {
      id: p.id,
      name: p.name,
      status: probeResult.ok ? 'PASS' : 'FAIL',
      detail: `${probeResult.detail} (token_len=${token.length})`,
      latencyMs: Date.now() - t0,
    }
  } catch (e: any) {
    return { id: p.id, name: p.name, status: 'ERR', detail: e.message?.slice(0, 120), latencyMs: Date.now() - t0 }
  } finally {
    if (page) await page.close().catch(() => {})
  }
}

async function main() {
  console.log('='.repeat(70))
  console.log(' MyChatBridge provider check via Playwright CDP')
  console.log('='.repeat(70))

  // Step 1: Kill any running Chrome
  console.log('\n[1/4] Stopping existing Chrome...')
  killChromeCopies()
  await new Promise((r) => setTimeout(r, 3000))

  // Step 2: Copy Chrome profile
  console.log('[2/4] Copying Chrome profile...')
  const profileDir = copyChromeProfile()
  console.log(`  Profile copied to: ${profileDir}`)

  // Step 3: Launch Chrome with CDP
  console.log(`[3/4] Launching Chrome with --remote-debugging-port=${CDP_PORT}...`)
  launchChrome(profileDir)
  // Wait for Chrome to start and bind the port
  let ready = false
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const resp = await fetch(`${CDP_URL}/json/version`)
      if (resp.ok) { ready = true; break }
    } catch { /* not ready */ }
  }
  if (!ready) {
    console.error('Chrome did not start with CDP in time.')
    process.exit(1)
  }
  console.log('  Chrome CDP ready.')

  // Step 4: Connect and test
  console.log('[4/4] Connecting via Playwright CDP...\n')
  const browser = await chromium.connectOverCDP(CDP_URL)
  const ctx = browser.contexts()[0]
  if (!ctx) {
    console.error('No browser context found.')
    await browser.close()
    process.exit(1)
  }

  const results: Result[] = []
  for (const p of PROVIDERS) {
    process.stdout.write(`  ${p.name.padEnd(28)}`)
    const r = await testProvider(ctx, p)
    results.push(r)
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'SKIP' ? '–' : '?'
    console.log(`[${r.status}]  ${icon}  ${r.detail}  (${r.latencyMs}ms)`)
  }

  // Summary
  console.log()
  console.log('='.repeat(70))
  console.log(' Results')
  console.log('='.repeat(70))
  console.log(`${'STATUS'.padEnd(10)}${'PROVIDER'.padEnd(28)}${'DETAIL'}`)
  console.log('-'.repeat(70))
  for (const r of results) {
    console.log(`${r.status.padEnd(10)}${r.name.padEnd(28)}${r.detail}`)
  }

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const skip = results.filter((r) => r.status === 'SKIP').length
  const noCred = results.filter((r) => r.status === 'NO_CRED').length
  const err = results.filter((r) => r.status === 'ERR').length
  console.log()
  console.log(`Summary: PASS=${pass}  FAIL=${fail}  SKIP=${skip}  NO_CRED=${noCred}  ERR=${err}`)
  console.log(`Total: ${results.length}, ready-to-chat: ${pass}`)

  await browser.close()
  // Clean up: kill the Chrome we launched
  killChromeCopies()
  // Clean up temp profile
  try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch { /* ignore */ }
}

main().catch((e) => {
  console.error('Fatal:', e)
  killChromeCopies()
  process.exit(1)
})
