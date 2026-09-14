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
    const doubaoCookies = cookies.filter((c) => c.domain.includes('doubao.com'))
    console.log('Doubao cookie count:', doubaoCookies.length)
    console.log('Doubao cookie names:', doubaoCookies.map((c) => c.name).join(', '))
    const sessionid = doubaoCookies.find((c) => c.name === 'sessionid')
    console.log('Has sessionid:', Boolean(sessionid?.value), 'len:', sessionid?.value?.length)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
