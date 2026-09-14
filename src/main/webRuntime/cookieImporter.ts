import { homedir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import * as crypto from 'crypto'
import { CREDENTIAL_SOURCES } from './credentialSources.ts'

export interface ImportedSession {
  providerId: string
  accountId: string
  cookies: Array<Record<string, unknown>>
}

/**
 * Whether a native SQLite driver failure is an ABI/Node-API mismatch rather
 * than a data problem. Such mismatches used to segfault the whole main process
 * before Electron's Node version and the prebuilt addon were aligned, so they
 * are surfaced with an explicit diagnostic instead of a generic scan error.
 */
export function isNativeAbiMismatch(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'ERR_DLOPEN_FAILED') return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && /NODE_MODULE_VERSION|was compiled against a different Node/i.test(message)
}

export class CookieImporter {
  private deps: { decrypt?: (encrypted: Buffer) => Buffer; dbOpen?: (path: string, options?: any) => any }

  constructor(deps: { decrypt?: (encrypted: Buffer) => Buffer; dbOpen?: (path: string, options?: any) => any } = {}) {
    this.deps = deps
  }

  browserPaths(browser: 'chrome' | 'edge') {
    const base = join(
      process.env.LOCALAPPDATA || '',
      browser === 'chrome' ? 'Google\\Chrome' : 'Microsoft\\Edge',
      'User Data'
    )
    return {
      localState: join(base, 'Local State'),
      cookiesDb: join(base, 'Default', 'Network', 'Cookies'),
    }
  }

  private cookieSources() {
    return Object.values(CREDENTIAL_SOURCES).filter((s) => s.kind === 'cookies')
  }

  readDecryptionKey(localStatePath: string): Buffer {
    console.error(`[diag] readDecryptionKey enter path=${localStatePath}`)
    const ls = JSON.parse(readFileSync(localStatePath, 'utf8'))
    const b64 = ls.os_crypt?.encrypted_key
    if (!b64) throw new Error('No os_crypt.encrypted_key')
    const raw = Buffer.from(b64, 'base64')
    const payload = raw.subarray('DPAPI'.length)
    console.error(`[diag] readDecryptionKey calling DPAPI (bytes=${payload.length})`)
    const key = this.deps.decrypt ? this.deps.decrypt(payload) : this.dpapiDecrypt(payload)
    console.error('[diag] readDecryptionKey ok')
    return key
  }

  private dpapiDecrypt(encrypted: Buffer): Buffer {
    const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${encrypted.toString('base64')}'), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      timeout: 20000,
    }).trim()
    return Buffer.from(out, 'base64')
  }

  async scan(browser: 'chrome' | 'edge') {
    console.error(`[diag] scan enter browser=${browser}`)
    const { localState, cookiesDb } = this.browserPaths(browser)
    if (!existsSync(localState) || !existsSync(cookiesDb)) {
      console.error(`[diag] scan skip browser=${browser} (localState=${existsSync(localState)} cookiesDb=${existsSync(cookiesDb)})`)
      return []
    }

    let db: any = null
    try {
      const key = this.readDecryptionKey(localState)
      console.error(`[diag] scan opening DB ${cookiesDb}`)
      db = this.deps.dbOpen
        ? this.deps.dbOpen(cookiesDb, { readonly: true, timeout: 5000 })
        : await import('better-sqlite3').then((mod: any) => mod.default(cookiesDb, { readonly: true, timeout: 5000 }))
      console.error('[diag] scan DB opened')

      const cookieSources = this.cookieSources()
      const domains = [...new Set(cookieSources.flatMap((s) => s.domains))]
      if (domains.length === 0) return []
      const clauses = domains.map(() => `host_key LIKE ?`).join(' OR ')
      console.error(`[diag] scan querying ${domains.length} domains`)
      const rows = db
        .prepare(`SELECT host_key, name, path, encrypted_value, expires_utc FROM cookies WHERE ${clauses}`)
        .all(...domains.map((d) => `%${d}`))
      console.error(`[diag] scan rows=${rows.length}`)

      const now = Date.now()
      const validRows = rows.filter((row: any) => {
        // expires_utc === 0 is a session cookie and is valid while the browser session exists.
        if (!row.expires_utc) return true
        const unixTimestamp = (row.expires_utc - 11644473600000000) / 1000
        return unixTimestamp > now
      })

      const byProvider: Record<string, Array<Record<string, unknown>>> = {}
      for (const row of validRows) {
        const source = cookieSources.find((s) => s.domains.some((d) => row.host_key.includes(d)))
        if (!source) continue

        try {
          const encrypted = Buffer.from(row.encrypted_value)
          let value: Buffer
          if (
            encrypted.subarray(0, 3).toString() === 'v10' ||
            encrypted.subarray(0, 3).toString() === 'v11'
          ) {
            value = this.aesGcmDecrypt(key, encrypted)
          } else {
            value = encrypted
          }
          ;(byProvider[source.storageKey] ||= []).push({
            name: row.name,
            value: value.toString('utf8'),
            domain: row.host_key,
            path: row.path,
          })
        } catch (error) {
          // One incompatible/corrupt cookie must not abort the whole browser scan.
          console.warn(`[CookieImporter] Failed to decrypt cookie ${row.name} for ${browser}:`, error)
        }
      }

      const result: Array<{ provider: string; cookies: Array<Record<string, unknown>> }> = []
      for (const [storageKey, cookies] of Object.entries(byProvider)) {
        const sourceId = Object.keys(CREDENTIAL_SOURCES).find((id) => CREDENTIAL_SOURCES[id].storageKey === storageKey)
        const source = sourceId ? CREDENTIAL_SOURCES[sourceId] : undefined
        if (!source || source.kind !== 'cookies') continue
        if (source.requiredCookies && !source.requiredCookies.every((name) => cookies.some((c: any) => c.name === name))) continue
        result.push({ provider: storageKey, cookies })
      }
      console.error(`[diag] scan exit browser=${browser} providers=${result.length}`)
      return result
    } catch (error) {
      // Browser cookie access is optional authentication discovery. Never let a
      // locked/incompatible browser profile propagate through IPC and destabilize the app.
      if (isNativeAbiMismatch(error)) {
        console.error(
          `[CookieImporter] Native SQLite driver is incompatible with this runtime ` +
            `(node ${process.versions.node} / ABI ${process.versions.modules}). ` +
            `Run "electron-builder install-app-deps" to rebuild it against Electron. Skipping ${browser} cookie import.`,
          error
        )
      } else {
        console.error(`[CookieImporter] Failed to scan ${browser} cookies:`, error)
      }
      return []
    } finally {
      if (db && typeof db.close === 'function') {
        try {
          db.close()
        } catch (error) {
          console.warn(`[CookieImporter] Failed to close ${browser} cookie DB:`, error)
        }
      }
    }
  }

  async hasSession(browser: 'chrome' | 'edge'): Promise<boolean> {
    const found = await this.scan(browser)
    return found.length > 0
  }

  private aesGcmDecrypt(key: Buffer, encrypted: Buffer): Buffer {
    const nonce = encrypted.subarray(3, 3 + 12)
    const tag = encrypted.subarray(encrypted.length - 16)
    const data = encrypted.subarray(3 + 12, encrypted.length - 16)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()])
  }

  async importSession(
    providerId: string,
    cookies: Array<Record<string, unknown>>
  ): Promise<ImportedSession> {
    const accountId = `web-${providerId}-imported-${Date.now()}`
    const sessionData = {
      accountId,
      providerId,
      cookies,
      createdAt: Date.now(),
      lastValidatedAt: Date.now(),
    }

    const homeDir = homedir()
    const profilesDir = join(homeDir, '.mychatbridge', 'web-runtime', 'profiles')
    mkdirSync(profilesDir, { recursive: true })
    const sessionPath = join(profilesDir, `${accountId}.json`)
    writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), { mode: 0o600 })

    return { providerId, accountId, cookies }
  }
}
