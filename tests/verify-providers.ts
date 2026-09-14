/**
 * Verify every builtin provider by extracting credentials from the local
 * Chrome profile and probing the upstream API. Run with:
 *
 *   npx.tsx tests/verify-providers.ts
 *
 * Reuses the production CookieImporter + LocalStorageReader so behaviour
 * matches what the app sees on auto-connect.
 *
 * Status legend (one line per provider):
 *   PASS    token/cookie exchange accepted by the upstream API
 *   FAIL    credential was found but the upstream rejected it (HTTP != 2xx)
 *   SKIP    provider has no token-check / models endpoint and no adapter
 *   NO_CRED no usable credential was found in Chrome for this provider
 *   ERR     unexpected exception while probing
 */
import axios, { AxiosError } from 'axios'
import { builtinProviders } from '../src/main/providers/builtin/index.ts'
import { CookieImporter } from '../src/main/webRuntime/cookieImporter.ts'
import { CREDENTIAL_SOURCES } from '../src/main/webRuntime/credentialSources.ts'
import { LocalStorageReader } from '../src/main/webRuntime/localStorageReader.ts'
import type { BuiltinProviderConfig } from '../src/main/store/types.ts'

type Status = 'PASS' | 'FAIL' | 'SKIP' | 'NO_CRED' | 'ERR'

interface Row {
  id: string
  name: string
  status: Status
  detail: string
  latencyMs: number
}

const CHECK_TIMEOUT = 15000

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function logHeader(title: string): void {
  console.log('\n' + '='.repeat(72))
  console.log(' ' + title)
  console.log('='.repeat(72))
}

function summarize(rows: Row[]): void {
  const counts: Record<Status, number> = { PASS: 0, FAIL: 0, SKIP: 0, NO_CRED: 0, ERR: 0 }
  for (const r of rows) counts[r.status]++
  console.log('')
  console.log('Summary: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  '))
  const ok = rows.filter((r) => r.status === 'PASS').length
  console.log(`Total: ${rows.length}, ready-to-chat: ${ok}`)
}

// -------------------------------------------------------------------
// Credential extraction
// -------------------------------------------------------------------

interface CredentialPick {
  headers: Record<string, string>
  cookie?: string
}

// Maps builtin provider ID → the storageKey used in CREDENTIAL_SOURCES
// and the cookie names that constitute a valid session.
const COOKIE_PROVIDER_MAP: Record<string, {
  storageKey: string
  cookieNames: string[]
  extractTokenFromCookie?: (cookieValue: string) => string
}> = {
  deepseek: {
    storageKey: 'deepseek',
    cookieNames: ['authorization'],
    extractTokenFromCookie: (v) => v.replace(/^Bearer\s+/i, ''),
  },
  chatgpt: {
    storageKey: 'chatgpt',
    cookieNames: ['__Secure-next-auth.session-token'],
  },
  'doubao-web': {
    storageKey: 'doubao',
    cookieNames: ['sessionid'],
  },
}

// Providers whose tokens live in Chrome localStorage LevelDB.
// Keys are (origin, localStorageKey).
const LS_TOKEN_MAP: Record<string, { originPart: string; key: string; asHeader?: string }> = {
  deepseek: { originPart: 'chat.deepseek.com', key: 'userToken' },
  qwen:     { originPart: 'qianwen.com', key: 'tongyi_sso_ticket', asHeader: 'cookie:tongyi_sso_ticket' },
  'qwen-ai':{ originPart: 'chat.qwen.ai', key: 'token' },
  kimi:     { originPart: 'kimi.com', key: 'kimi-auth' },
  zai:      { originPart: 'chat.z.ai', key: 'token' },
  glm:      { originPart: 'chatglm.cn', key: 'chatglm_refresh_token' },
}

async function extractCredentials(config: BuiltinProviderConfig): Promise<CredentialPick | null> {
  // --- Strategy 1: Chrome cookies via CookieImporter ---
  const cookieMap = COOKIE_PROVIDER_MAP[config.id]
  if (cookieMap) {
    try {
      const importer = new CookieImporter()
      const entries = await importer.scan('chrome')
      for (const entry of entries) {
        if (entry.provider !== cookieMap.storageKey) continue
        for (const name of cookieMap.cookieNames) {
          const c = entry.cookies.find((ck: any) => ck.name === name)
          if (c?.value) {
            if (cookieMap.extractTokenFromCookie) {
              const token = cookieMap.extractTokenFromCookie(c.value)
              if (token) return { headers: { Authorization: `Bearer ${token}` } }
            } else {
              return { headers: {}, cookie: `${c.name}=${c.value}` }
            }
          }
        }
      }
    } catch { /* scan failed — fall through */ }
  }

  // --- Strategy 2: Chrome localStorage LevelDB ---
  const lsMap = LS_TOKEN_MAP[config.id]
  if (lsMap) {
    try {
      const reader = new LocalStorageReader()
      for (const browser of ['chrome', 'edge'] as const) {
        const token = await reader.findToken(browser, lsMap.key, lsMap.originPart)
        if (token) {
          if (lsMap.asHeader?.startsWith('cookie:')) {
            const cookieName = lsMap.asHeader.split(':')[1]
            return { headers: {}, cookie: `${cookieName}=${token}` }
          }
          return { headers: { Authorization: `Bearer ${token}` } }
        }
      }
    } catch { /* read failed — fall through */ }
  }

  return null
}

// -------------------------------------------------------------------
// Probing
// -------------------------------------------------------------------

async function checkBuiltin(config: BuiltinProviderConfig): Promise<Row> {
  const start = Date.now()

  // claude / gemini / yuanbao: scaffold, no adapter yet
  if (['claude', 'gemini', 'yuanbao'].includes(config.id)) {
    return {
      id: config.id,
      name: config.name,
      status: 'SKIP',
      detail: 'scaffold (adapter not implemented)',
      latencyMs: Date.now() - start,
    }
  }

  const cred = await extractCredentials(config)
  if (!cred) {
    return {
      id: config.id,
      name: config.name,
      status: 'NO_CRED',
      detail: 'no Chrome cookie/localStorage credential found',
      latencyMs: Date.now() - start,
    }
  }

  if (!config.tokenCheckEndpoint && !config.modelsApiEndpoint) {
    return {
      id: config.id,
      name: config.name,
      status: 'SKIP',
      detail: 'no tokenCheckEndpoint or modelsApiEndpoint configured',
      latencyMs: Date.now() - start,
    }
  }

  try {
    const headers: Record<string, string> = { ...(config.headers ?? {}) }
    for (const [k, v] of Object.entries(cred.headers)) headers[k] = v
    if (cred.cookie) headers['Cookie'] = cred.cookie

    const isPost = (config.tokenCheckMethod ?? 'GET') === 'POST'
    const target = config.tokenCheckEndpoint
      ? `${config.apiEndpoint.replace(/\/api$/, '')}${config.tokenCheckEndpoint}`
      : config.modelsApiEndpoint!

    const res = await axios({
      method: isPost ? 'POST' : 'GET',
      url: target,
      headers,
      timeout: CHECK_TIMEOUT,
      validateStatus: () => true,
    })

    const elapsed = Date.now() - start
    if (res.status >= 200 && res.status < 300) {
      return {
        id: config.id,
        name: config.name,
        status: 'PASS',
        detail: `HTTP ${res.status} on ${target}`,
        latencyMs: elapsed,
      }
    }
    return {
      id: config.id,
      name: config.name,
      status: 'FAIL',
      detail: `HTTP ${res.status} on ${target}`,
      latencyMs: elapsed,
    }
  } catch (err) {
    return {
      id: config.id,
      name: config.name,
      status: 'ERR',
      detail: err instanceof AxiosError ? err.message : String(err),
      latencyMs: Date.now() - start,
    }
  }
}

// -------------------------------------------------------------------
// Web-session providers (CREDENTIAL_SOURCES entries not in builtinProviders)
// -------------------------------------------------------------------

async function checkWebSessionProvider(
  id: string,
  source: ReturnType<typeof Object.values>[number],
): Promise<Row> {
  const start = Date.now()
  const cookieMap = COOKIE_PROVIDER_MAP[id]
  if (!cookieMap) {
    return {
      id,
      name: source.accountName,
      status: 'SKIP',
      detail: 'no cookie extraction config',
      latencyMs: 0,
    }
  }

  try {
    const importer = new CookieImporter()
    const entries = await importer.scan('chrome')
    let cookieStr = ''
    for (const entry of entries) {
      if (entry.provider !== cookieMap.storageKey) continue
      const c = entry.cookies.find((ck: any) => cookieMap.cookieNames.includes(ck.name))
      if (c?.value) {
        cookieStr = `${c.name}=${c.value}`
        break
      }
    }
    if (!cookieStr) {
      return {
        id,
        name: source.accountName,
        status: 'NO_CRED',
        detail: `no Chrome cookie found (expected: ${cookieMap.cookieNames.join(', ')})`,
        latencyMs: Date.now() - start,
      }
    }

    // Probe: GET the provider's web page with cookies
    const probeUrl = source.domains[0].startsWith('http')
      ? source.domains[0]
      : `https://${source.domains[0]}`
    // Sanitize cookie value: strip control characters that break HTTP headers
    // Chrome v20 encryption format not supported — decrypted values are binary garbage
    const isBinary = /[\x00-\x08\x0e-\x1f\x7f]/.test(cookieStr)
    if (isBinary) {
      return {
        id,
        name: source.accountName,
        status: 'NO_CRED',
        detail: 'cookie decryption failed (Chrome v20 format unsupported)',
        latencyMs: Date.now() - start,
      }
    }
    const safeCookie = cookieStr.replace(
      /=([^;]*)/,
      (_, v) => '=' + v.replace(/[\x00-\x1f\x7f]/g, ''),
    )
    const res = await axios.get(probeUrl, {
      headers: {
        Cookie: cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: CHECK_TIMEOUT,
      validateStatus: () => true,
      maxRedirects: 0,
    })

    const elapsed = Date.now() - start
    if (res.status >= 200 && res.status < 400) {
      return {
        id,
        name: source.accountName,
        status: 'PASS',
        detail: `HTTP ${res.status} on ${probeUrl}`,
        latencyMs: elapsed,
      }
    }
    return {
      id,
      name: source.accountName,
      status: 'FAIL',
      detail: `HTTP ${res.status} on ${probeUrl}`,
      latencyMs: elapsed,
    }
  } catch (err) {
    return {
      id,
      name: source.accountName,
      status: 'ERR',
      detail: err instanceof AxiosError ? err.message : String(err),
      latencyMs: Date.now() - start,
    }
  }
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main(): Promise<void> {
  logHeader('MyChatBridge builtin provider availability check')
  console.log('Source: Chrome Cookies + LocalStorage on this machine')

  const builtinIds = new Set(builtinProviders.map((p) => p.id))
  console.log('Builtin providers: ' + builtinProviders.map((p) => p.id).join(', '))

  const rows: Row[] = []

  // --- Phase 1: builtin providers ---
  for (const config of builtinProviders) {
    process.stdout.write(`  probing ${pad(config.id, 12)} ... `)
    const row = await checkBuiltin(config)
    rows.push(row)
    const tag = pad(`[${row.status}]`, 9)
    console.log(`${tag} ${row.latencyMs}ms  ${row.detail}`)
  }

  // --- Phase 2: CREDENTIAL_SOURCES providers not in builtinProviders ---
  const extraIds = Object.keys(CREDENTIAL_SOURCES).filter((id) => !builtinIds.has(id))
  if (extraIds.length > 0) {
    console.log(`\n  (also checking ${extraIds.length} web-session providers: ${extraIds.join(', ')})`)
    for (const id of extraIds) {
      const source = CREDENTIAL_SOURCES[id]
      process.stdout.write(`  probing ${pad(id, 12)} ... `)
      const row = await checkWebSessionProvider(id, source)
      rows.push(row)
      const tag = pad(`[${row.status}]`, 9)
      console.log(`${tag} ${row.latencyMs}ms  ${row.detail}`)
    }
  }

  logHeader('Results table')
  console.log(pad('STATUS', 9) + pad('PROVIDER', 14) + pad('NAME', 22) + 'DETAIL')
  console.log('-'.repeat(72))
  for (const r of rows) {
    console.log(pad(`[${r.status}]`, 9) + pad(r.id, 14) + pad(r.name, 22) + r.detail)
  }
  summarize(rows)

  const hardFails = rows.filter((r) => r.status === 'ERR').length
  process.exit(hardFails > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('verify-providers crashed:', err)
  process.exit(2)
})
