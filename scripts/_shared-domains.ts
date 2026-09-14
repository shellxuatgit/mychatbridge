import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: true, channel: 'chrome' })
  try {
    const cookies = await ctx.cookies()
    const byDomain: Record<string, string[]> = {}
    for (const c of cookies) {
      const base = c.domain.replace(/^\./, '')
      ;(byDomain[base] ||= []).push(c.name)
    }
    for (const [d, names] of Object.entries(byDomain)) {
      console.log(`${d}: ${names.join(', ')}`)
    }
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
