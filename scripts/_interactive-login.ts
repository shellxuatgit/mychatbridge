import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { getCredentialSource, cookiesToPayload } from '../src/main/webRuntime/credentialSources.ts'

async function main(): Promise<void> {
  const providerId = process.argv[2]
  if (!providerId) {
    console.error('Usage: npx tsx scripts/_interactive-login.ts <providerId>')
    process.exit(1)
  }

  const source = getCredentialSource(providerId)
  if (!source) {
    console.error(`Provider ${providerId} not found in CREDENTIAL_SOURCES`)
    process.exit(1)
  }

  const sharedDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const profileDir = sharedDir
  const loginUrl = source.loginUrl || 'https://www.google.com'

  console.log(`[InteractiveLogin] Launching browser for ${providerId}...`)
  console.log(`[InteractiveLogin] Profile dir: ${profileDir}`)
  console.log(`[InteractiveLogin] Target URL: ${loginUrl}`)

  let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null
  for (const channel of ['chrome', 'msedge'] as const) {
    try {
      ctx = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        channel,
        viewport: { width: 1280, height: 800 },
        args: ['--disable-blink-features=AutomationControlled', '--disable-infobars'],
        ignoreDefaultArgs: ['--enable-automation'],
      })
      console.log(`[InteractiveLogin] Launched using channel: ${channel}`)
      break
    } catch (err) {
      console.log(`[InteractiveLogin] Failed with ${channel}: ${(err as Error).message.split('\n')[0]}`)
    }
  }

  if (!ctx) {
    console.error('[InteractiveLogin] Failed to launch Chrome or Edge')
    process.exit(1)
  }

  const page = ctx.pages()[0] || (await ctx.newPage())

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  } catch (err) {
    console.log(`[InteractiveLogin] Initial navigation notice: ${(err as Error).message.split('\n')[0]}`)
  }

  console.log(`\n======================================================`)
  console.log(`[ACTION REQUIRED] Browser window has been opened!`)
  console.log(`Please complete the login for ${providerId.toUpperCase()} in the browser window.`)
  console.log(`Waiting for login success signal (up to 5 minutes)...`)
  console.log(`======================================================\n`)

  const startTime = Date.now()
  const timeoutMs = 300000 // 5 minutes
  let success = false

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000))

    try {
      const cookies = await ctx.cookies()
      const domainCookies = cookies.filter((c) =>
        source.domains.some((d) => String(c.domain).includes(d))
      )

      let signalMatched = false

      // Check cookie condition
      if (source.loginSuccess?.cookie) {
        const targetCookie = source.loginSuccess.cookie
        const found = domainCookies.find((c) => c.name === targetCookie && c.value)
        if (found) {
          signalMatched = true
        }
      }

      // Check URL pattern condition
      if (source.loginSuccess?.urlPattern) {
        const currentUrl = page.url()
        const pattern = source.loginSuccess.urlPattern.replace(/\*\*/g, '.*')
        const regex = new RegExp('^' + pattern)
        if (regex.test(currentUrl)) {
          if (!source.loginSuccess.cookie) {
            signalMatched = true
          }
        } else if (source.loginSuccess.cookie && !signalMatched) {
          signalMatched = false
        }
      }

      if (signalMatched) {
        console.log(`\n[InteractiveLogin] Login signal detected! Extracting credentials...`)
        const payload = cookiesToPayload(domainCookies as any, source)
        console.log(`[InteractiveLogin] Extracted payload:`, payload ? Object.keys(payload.credentials) : 'null')

        if (payload || domainCookies.length > 0) {
          success = true
          console.log(`[InteractiveLogin] Success! Found ${domainCookies.length} relevant cookies.`)
          break
        }
      }
    } catch {
      // context or page navigation transient error, keep polling
    }
  }

  if (success) {
    console.log(`[InteractiveLogin] Waiting 3 seconds to let cookies settle...`)
    await new Promise((r) => setTimeout(r, 3000))
    await ctx.close().catch(() => {})
    console.log(`[InteractiveLogin] Finished successfully for ${providerId}.`)
    process.exit(0)
  } else {
    console.error(`[InteractiveLogin] Login timed out or cancelled.`)
    await ctx.close().catch(() => {})
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[InteractiveLogin] Fatal error:', err)
  process.exit(1)
})
