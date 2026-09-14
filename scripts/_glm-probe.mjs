import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'glm')
const ctx = await chromium.launchPersistentContext(profileDir, { headless: true })
const page = ctx.pages()[0] || await ctx.newPage()

await page.goto('https://chatglm.cn/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(3000)

console.log('URL:', page.url())
console.log('TITLE:', await page.title().catch(() => ''))

// Extract cookies
const cookies = await ctx.cookies()
console.log('\n=== COOKIES ===')
for (const c of cookies) {
  console.log(`  ${c.name} = ${c.value ? c.value.substring(0, 60) + (c.value.length > 60 ? '...' : '') : '(empty)'}  [domain: ${c.domain}]`)
}

// Extract localStorage keys related to auth
const ls = await page.evaluate(() => {
  const result = {}
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    const val = window.localStorage.getItem(key) || ''
    if (/token|auth|refresh|session|user/i.test(key) || val.length > 50) {
      result[key] = val.substring(0, 100)
    }
  }
  return result
})
console.log('\n=== LOCALSTORAGE (auth-related) ===')
console.log(JSON.stringify(ls, null, 2))

// Check for specific auth keys
const authData = await page.evaluate(() => {
  const result = {}
  // Check common storage keys for GLM
  const keys = ['refresh_token', 'access_token', 'token', 'auth_token', 'user_token', 'session_token']
  for (const key of keys) {
    const fromLS = window.localStorage.getItem(key)
    const fromSS = window.sessionStorage.getItem(key)
    if (fromLS) result['localStorage.' + key] = fromLS.substring(0, 80)
    if (fromSS) result['sessionStorage.' + key] = fromSS.substring(0, 80)
  }
  // Also check for chatglm specific keys
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)
    if (/chatglm|zhipu|glm/i.test(key)) {
      const val = window.localStorage.getItem(key) || ''
      if (val.length > 10) result['localStorage.' + key] = val.substring(0, 100)
    }
  }
  return result
})
console.log('\n=== AUTH DATA ===')
console.log(JSON.stringify(authData, null, 2))

await ctx.close()
console.log('PROBE_DONE')
