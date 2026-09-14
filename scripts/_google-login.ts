import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  console.log('[GoogleLogin] Launching browser for Google SSO...')
  console.log(`[GoogleLogin] Profile dir: ${profileDir}`)

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  const page = ctx.pages()[0] || (await ctx.newPage())

  // Navigate directly to Google sign-in
  await page.goto('https://accounts.google.com/ServiceLogin', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  }).catch(() => {})

  console.log('\n======================================================')
  console.log('[ACTION REQUIRED] Google login page is open in the browser!')
  console.log('Please log into your Google account in the window.')
  console.log('Once logged in, your Google session will be permanently saved')
  console.log('and shared across Qwen-AI, Gemini, and all other providers.')
  console.log('You can close the browser window or press Ctrl+C when done.')
  console.log('======================================================\n')

  // Keep open and monitor until user logs in or closes
  let loggedIn = false
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const cookies = await ctx.cookies()
      const googleSid = cookies.find((c) => (c.name === 'SID' || c.name === '__Secure-1PSID') && c.domain.includes('google.com'))
      if (googleSid) {
        console.log('[GoogleLogin] Detected Google login cookies (SID)! Login successful!')
        loggedIn = true
        break
      }
    } catch {
      // Browser closed or navigation happening
    }
  }

  if (loggedIn) {
    console.log('[GoogleLogin] Saving cookies and settling session...')
    await new Promise((r) => setTimeout(r, 3000))
  }
  await ctx.close().catch(() => {})
  console.log('[GoogleLogin] Browser closed.')
}

main().catch(console.error)
