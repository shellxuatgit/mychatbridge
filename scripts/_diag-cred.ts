/**
 * Diagnose credential extraction for a provider using the PRODUCTION code path.
 *
 *   npx tsx scripts/_diag-cred.ts <providerId>
 *
 * Prints only metadata (names, lengths, booleans) — never credential values.
 */
import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { getCredentialSource, cookiesToPayload } from '../src/main/webRuntime/credentialSources.ts'

async function main(): Promise<void> {
const providerId = process.argv[2]
if (!providerId) {
  console.error('usage: npx tsx scripts/_diag-cred.ts <providerId>')
  process.exit(1)
}

const source = getCredentialSource(providerId)
if (!source) {
  console.error(`no CREDENTIAL_SOURCES entry for ${providerId}`)
  process.exit(1)
}

console.log('--- source config ---')
console.log('kind        :', source.kind)
console.log('domains     :', source.domains.join(', '))
console.log('sink        :', source.sink)
console.log('storageKey  :', source.storageKey)
console.log('required    :', source.requiredCookies?.join(', ') ?? '(none)')
console.log('loginSuccess:', JSON.stringify(source.loginSuccess ?? null))

const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', providerId)
console.log('\n--- profile ---')
console.log('dir exists  :', existsSync(profileDir))
if (!existsSync(profileDir)) process.exit(0)

let ctx = null
for (const opts of [
  { headless: true, channel: 'chrome' as const },
  { headless: true, channel: 'msedge' as const },
]) {
  try {
    ctx = await chromium.launchPersistentContext(profileDir, opts)
    console.log('launched via:', opts.channel)
    break
  } catch (e) {
    console.log('launch failed:', opts.channel, String((e as Error).message).split('\n')[0])
  }
}
if (!ctx) process.exit(1)

try {
  const cookies = (await ctx.cookies()) as unknown as Array<Record<string, unknown>>
  const filtered = cookies.filter((c) => source.domains.some((d) => String(c.domain).includes(d)))
  console.log('\n--- cookies ---')
  console.log('total:', cookies.length, '| matching domains:', filtered.length)
  for (const c of filtered) {
    console.log(`  ${String(c.name).padEnd(42)} len=${String(c.value ?? '').length}`)
  }

  console.log('\n--- production cookiesToPayload() ---')
  const payload = cookiesToPayload(filtered, source)
  if (!payload) {
    console.log('RESULT: NULL  <-- extraction FAILED, login would poll until timeout')
  } else {
    console.log('RESULT: OK')
    console.log('providerId :', payload.providerId)
    console.log('accountName:', payload.accountName)
    for (const [k, v] of Object.entries(payload.credentials)) {
      console.log(`credential : ${k} (len=${String(v).length})`)
    }
  }
} finally {
  await ctx.close().catch(() => {})
}
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
