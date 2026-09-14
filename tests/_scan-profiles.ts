/**
 * Iterate all Chrome profiles, start Chrome with CDP for each,
 * navigate to chat.deepseek.com, check for authorization cookie.
 */
import { chromium } from 'playwright'
import { execSync, spawn } from 'child_process'

const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CHROME_DATA = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\User Data'
const PORT = 9222

function killChrome() {
  try { execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' }) } catch {}
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function waitForCDP(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (resp.ok) return true
    } catch {}
    await sleep(1000)
  }
  return false
}

async function checkProfile(profileName: string): Promise<{ profile: string; url: string; hasAuth: boolean; cookies: string[]; tokenPreview: string }> {
  killChrome()
  await sleep(3000)

  const profileDir = `${CHROME_DATA}\\${profileName}`
  const child = spawn(CHROME_EXE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    'https://chat.deepseek.com',
  ], { detached: true, stdio: 'ignore' })
  child.unref()

  const ready = await waitForCDP(PORT)
  if (!ready) {
    return { profile: profileName, url: 'CDP_TIMEOUT', hasAuth: false, cookies: [], tokenPreview: '' }
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const ctx = browser.contexts()[0]

  // Wait for page to load
  await sleep(5000)

  const page = ctx.pages().find(p => p.url().includes('deepseek')) || ctx.pages()[0]
  const url = page.url()

  // Get all cookies
  const cookies = await ctx.cookies('https://chat.deepseek.com')
  const auth = cookies.find(c => c.name === 'authorization')
  const cookieNames = cookies.map(c => c.name)

  let tokenPreview = ''
  if (auth) {
    tokenPreview = auth.value.substring(0, 60) + (auth.value.length > 60 ? '...' : '')
  }

  await browser.close()
  killChrome()
  await sleep(2000)

  return {
    profile: profileName,
    url,
    hasAuth: !!auth,
    cookies: cookieNames,
    tokenPreview,
  }
}

async function main() {
  console.log('Scanning Chrome profiles for DeepSeek authorization cookie...\n')

  // Get profiles
  const fs = require('fs')
  const path = require('path')
  const entries = fs.readdirSync(CHROME_DATA, { withFileTypes: true })
  const profiles = entries
    .filter((e: any) => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile')))
    .map((e: any) => e.name)

  console.log(`Found ${profiles.length} profiles: ${profiles.join(', ')}\n`)

  for (const profile of profiles) {
    process.stdout.write(`[${profile}] `)
    const result = await checkProfile(profile)

    if (result.url === 'CDP_TIMEOUT') {
      console.log('CDP_TIMEOUT - could not connect')
      continue
    }

    const status = result.hasAuth ? 'AUTH_FOUND' : 'NO_AUTH'
    console.log(`${status}  url=${result.url}`)
    console.log(`  cookies: ${result.cookies.join(', ') || '(none)'}`)
    if (result.hasAuth) {
      console.log(`  token: ${result.tokenPreview}`)
    }
    console.log()
  }
}

main().catch(console.error)
