import { CookieImporter } from './cookieImporter.ts'
import { cookiesToPayload, getCredentialSource, type SessionPayload } from './credentialSources.ts'

export type { SessionPayload }

export type AutoConnectResult =
  | { status: 'imported'; payload: SessionPayload }
  | { status: 'opened' }
  | { status: 'unsupported'; reason: string }

export type CheckSessionResult =
  | { status: 'imported'; payload: SessionPayload }
  | { status: 'pending' }

export interface AutoConnectDeps {
  opener: (url: string) => Promise<void>
  importer: CookieImporter
  localStorageReader?: (browser: 'chrome' | 'edge', tokenKey: string) => Promise<string | null>
}

const BROWSERS = ['chrome', 'edge'] as const

async function findCookieSession(providerId: string, deps: AutoConnectDeps): Promise<SessionPayload | null> {
  const source = getCredentialSource(providerId)
  if (!source || source.kind !== 'cookies') return null

  for (const browser of BROWSERS) {
    // scan() already determines whether a valid session exists, so do not call
    // hasSession() first. That previously scanned the same locked DB twice.
    const entries = await deps.importer.scan(browser)
    const entry = entries.find((e) => e.provider === source.storageKey)
    if (!entry) continue
    const payload = cookiesToPayload(entry.cookies, source)
    if (payload) return payload
  }
  return null
}

async function findTokenSession(providerId: string, deps: AutoConnectDeps): Promise<SessionPayload | null> {
  const source = getCredentialSource(providerId)
  if (!source || source.kind !== 'localStorage' || !source.tokenKey || !deps.localStorageReader) return null
  for (const browser of BROWSERS) {
    const token = await deps.localStorageReader(browser, source.tokenKey)
    if (token) return { providerId: source.storageKey, credentials: { token }, accountName: source.accountName }
  }
  return null
}

export async function handleAutoConnect(providerId: string, deps: AutoConnectDeps): Promise<AutoConnectResult> {
  const source = getCredentialSource(providerId)
  if (!source) return { status: 'unsupported', reason: 'unknown provider' }
  if (source.kind === 'cookies') {
    const session = await findCookieSession(providerId, deps)
    if (session) return { status: 'imported', payload: session }
  } else {
    if (!deps.localStorageReader) return { status: 'unsupported', reason: 'localStorage reader not available' }
    const session = await findTokenSession(providerId, deps)
    if (session) return { status: 'imported', payload: session }
  }
  const domain = source.domains[0].replace(/^https?:\/\//, '')
  await deps.opener(`https://${domain}`)
  return { status: 'opened' }
}

export async function handleCheckSession(providerId: string, deps: AutoConnectDeps): Promise<CheckSessionResult> {
  const source = getCredentialSource(providerId)
  if (!source) return { status: 'pending' }
  const session = source.kind === 'cookies'
    ? await findCookieSession(providerId, deps)
    : await findTokenSession(providerId, deps)
  return session ? { status: 'imported', payload: session } : { status: 'pending' }
}
