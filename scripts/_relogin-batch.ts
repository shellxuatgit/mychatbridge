import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'
import { getCredentialSource } from '../src/main/webRuntime/credentialSources.ts'

async function main(): Promise<void> {
  const ids = (process.argv[2] || 'qwen-ai,claude,yuanbao').split(',')
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled', '--disable-infobars'],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  const pages: Record<string, any> = {}
  for (const id of ids) {
    const source = getCredentialSource(id)
    if (!source?.loginUrl) {
      console.log(`SKIP ${id} (no loginUrl)`)
      continue
    }
    const page = await ctx.newPage()
    await page.goto(source.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    pages[id] = page
    console.log(`Opened tab for ${id}: ${source.loginUrl}`)
  }

  console.log('\n======================================================')
  console.log('Please log in to EACH tab in the browser window.')
  console.log('Waiting up to 10 minutes for all sessions...')
  console.log('======================================================\n')

  const done = new Set<string>()
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline && done.size < Object.keys(pages).length) {
    await new Promise((r) => setTimeout(r, 2500))
    for (const id of Object.keys(pages)) {
      if (done.has(id)) continue
      const source = getCredentialSource(id)!
      try {
        const cookies = await ctx.cookies()
        const domainCookies = cookies.filter((c) => source.domains.some((d) => String(c.domain).includes(d)))
        const target = source.loginSuccess?.cookie
        let ok = false
        if (target) ok = domainCookies.some((c) => c.name === target && c.value)
        if (!ok && !target && source.loginSuccess?.urlPattern) {
          ok = pages[id].url().startsWith(source.loginSuccess.urlPattern.replace('**', ''))
        }
        if (ok) {
          done.add(id)
          console.log(`[OK] ${id} logged in`)
        }
      } catch {
        /* transient */
      }
    }
  }

  console.log('\nResult:', [...done].join(', ') || 'none', '| pending:', Object.keys(pages).filter((p) => !done.has(p)).join(', '))
  await ctx.close().catch(() => {})
}

main().catch(console.error)
