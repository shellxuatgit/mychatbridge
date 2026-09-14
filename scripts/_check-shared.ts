import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    channel: 'chrome',
  })

  try {
    const cookies = await ctx.cookies()
    const googleCookies = cookies.filter((c) => c.domain.includes('google.com'))
    console.log(`Total cookies in shared profile: ${cookies.length}`)
    console.log(`Google cookies in shared profile: ${googleCookies.length}`)
    console.log('Google cookie names:', googleCookies.map((c) => c.name).join(', '))
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
