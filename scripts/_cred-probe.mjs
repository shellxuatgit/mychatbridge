import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'

// Prints credential METADATA only (name / length / domain) — never values.
const providerId = process.argv[2]
const origin = process.argv[3]
if (!providerId) {
  console.error('usage: node _cred-probe.mjs <providerId> [origin]')
  process.exit(1)
}

const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', providerId)
if (!existsSync(profileDir)) {
  console.log('RESULT: NO_PROFILE_DIR ' + profileDir)
  process.exit(0)
}
console.log('PROFILE: ' + profileDir)

let ctx = null
let lastErr = null
const attempts = [
  { headless: true, channel: 'chrome' },
  { headless: true, channel: 'msedge' },
  { headless: true },
]
for (const opts of attempts) {
  try {
    ctx = await chromium.launchPersistentContext(profileDir, opts)
    console.log('LAUNCHED with ' + JSON.stringify(opts))
    break
  } catch (e) {
    lastErr = e
    console.log('launch failed ' + JSON.stringify(opts) + ' :: ' + String(e.message).split('\n')[0])
  }
}
if (!ctx) {
  console.log('RESULT: LAUNCH_FAILED ' + String(lastErr && lastErr.message).split('\n')[0])
  process.exit(1)
}

try {
  const cookies = await ctx.cookies()
  console.log('\n=== COOKIES (' + cookies.length + ') ===')
  for (const c of cookies) {
    const len = String(c.value || '').length
    const auth = /token|auth|session|sso|refresh|ticket|uid/i.test(c.name)
    console.log(`  ${auth ? '*' : ' '} ${c.name} len=${len} domain=${c.domain}`)
  }

  if (origin) {
    const page = ctx.pages()[0] || (await ctx.newPage())
    try {
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(2500)
    } catch (e) {
      console.log('nav warn: ' + String(e.message).split('\n')[0])
    }
    const ls = await page
      .evaluate(() => {
        const out = []
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i)
          out.push({ k, len: (window.localStorage.getItem(k) || '').length })
        }
        return out
      })
      .catch(() => [])
    console.log('\n=== LOCALSTORAGE (' + ls.length + ') ===')
    for (const e of ls) {
      const auth = /token|auth|session|refresh|sso|ticket/i.test(e.k)
      console.log(`  ${auth ? '*' : ' '} ${e.k} len=${e.len}`)
    }
    console.log('URL: ' + page.url())
    console.log('TITLE: ' + (await page.title().catch(() => '')))
  }
} finally {
  await ctx.close().catch(() => {})
}
console.log('\nPROBE_DONE')
