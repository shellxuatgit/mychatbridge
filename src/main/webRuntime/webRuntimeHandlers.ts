/**
 * Pure handler functions for Web Runtime IPC channels.
 *
 * Each function receives its parameters and returns a result, calling into
 * WebRuntimeManager / CookieImporter internally.  The Electron IPC layer
 * (handlers.ts) wires these to ipcMain.handle() without any logic of its own.
 *
 * Extracted here so unit tests can cover the business logic without Electron.
 */
import { WebRuntimeManager } from './manager.ts'
import { CookieImporter, type ImportedSession } from './cookieImporter.ts'
import { Methods } from '../../web-runtime/ipc-protocol.ts'
import { CREDENTIAL_SOURCES } from './credentialSources.ts'
import { PlaywrightLoginService, type PlaywrightLoginResult } from './playwrightLogin.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectParams {
  providerId: string
  accountId: string
}

export interface ImportBrowserParams {
  browser?: 'chrome' | 'edge'
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * `webRuntime:connect`
 *
 * Ensures the sidecar is running, invokes `browser.invoke` with action
 * `connect`, then persists the session via `session.save`.
 */
export async function handleConnect(params: ConnectParams): Promise<{ ok: true }> {
  const runtime = WebRuntimeManager.getInstance()

  // Packaged builds ship without the Chromium binary (keeps the installer
  // small); ensure it is installed (one-time download) before the sidecar
  // tries to launch it.
  await runtime.ensureBrowser()

  await runtime.ensureStarted()

  const provider = params.providerId.replace(/-web$/, '')
  await runtime.request(Methods.BROWSER_INVOKE, {
    provider,
    action: 'connect',
    account_id: params.accountId,
    params: {},
  })

  await runtime.request(Methods.SESSION_SAVE, {
    account_id: params.accountId,
  })

  return { ok: true }
}

/**
 * `webRuntime:importBrowser`
 *
 * Scans the given browser's cookie store, filters to chatgpt / doubao, and
 * imports each matching session. Returns the list of imported sessions.
 */
export async function handleImportBrowser(
  params: ImportBrowserParams,
): Promise<ImportedSession[]> {
  const browser = params.browser ?? 'chrome'
  const importer = new CookieImporter()
  const found = await importer.scan(browser)

  const imported: ImportedSession[] = []
  for (const entry of found) {
    if (entry.provider === 'chatgpt' || entry.provider === 'doubao') {
      imported.push(
        await importer.importSession(entry.provider as 'chatgpt' | 'doubao', entry.cookies),
      )
    }
  }

  return imported
}

/**
 * `webRuntime:health`
 *
 * Ensures the sidecar is running and returns the health probe result.
 */
export async function handleHealth(): Promise<unknown> {
  const runtime = WebRuntimeManager.getInstance()
  await runtime.ensureStarted()
  return runtime.request(Methods.BROWSER_HEALTH, {})
}

export function handlePlaywrightLoginConfig(): Record<string, { loginUrl: string }> {
  const config: Record<string, { loginUrl: string }> = {}
  for (const [id, source] of Object.entries(CREDENTIAL_SOURCES)) {
    if (source.loginUrl && source.loginSuccess) {
      config[id] = { loginUrl: source.loginUrl }
    }
  }
  return config
}

export async function handlePlaywrightLogin(
  params: { providerId: string },
  service: Pick<PlaywrightLoginService, 'login'> = PlaywrightLoginService.getInstance(),
): Promise<PlaywrightLoginResult> {
  return service.login(params?.providerId)
}

export async function handleCancelPlaywrightLogin(
  params: { providerId: string },
  service: Pick<PlaywrightLoginService, 'cancel'> = PlaywrightLoginService.getInstance(),
): Promise<{ ok: true }> {
  await service.cancel(params?.providerId)
  return { ok: true as const }
}

export async function handleSaveImportedSession(
  params: { providerId: string; cookies: Array<Record<string, unknown>> },
  importer: CookieImporter = new CookieImporter(),
): Promise<{ accountId: string }> {
  const result = await importer.importSession(params?.providerId, params?.cookies)
  return { accountId: result.accountId }
}
