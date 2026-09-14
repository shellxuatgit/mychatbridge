import { chromium } from 'playwright'
import { execSync, spawn } from 'child_process'

const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CHROME_DATA = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\User Data'
const PORT = 9222

function killChrome() {
  try { execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' }) } catch {}
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  killChrome()
  await sleep(3000)

  // Use Default profile
  const profileDir = `${CHROME_DATA}\\Default`
  const child = spawn(CHROME_EXE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    'https://chat.deepseek.com',
  ], { detached: true, stdio: 'ignore' })
  child.unref()

  // Wait for CDP
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break } catch {}
  }

  // Get CDP page list
  const versionResp = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  const version = await versionResp.json()
  console.log('Browser:', version.Browser)

  const pagesResp = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const pages = await pagesResp.json()
  console.log(`\nOpen pages (${pages.length}):`)
  for (const p of pages) {
    console.log(`  ${p.type}: ${p.title} — ${p.url}`)
  }

  // Connect via Playwright
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const ctx = browser.contexts()[0]
  console.log(`\nPlaywright contexts: ${browser.contexts().length}`)
  console.log(`Playwright pages: ${ctx.pages().length}`)

  // Find deepseek page
  let page = ctx.pages().find(p => p.url().includes('deepseek'))
  if (page) {
    console.log(`\nDeepseek page found: ${page.url()}`)
  } else {
    console.log('\nNo deepseek page, navigating...')
    page = ctx.pages()[0] || await ctx.newPage()
    await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(5000)
    console.log('Navigated to:', page.url())
  }

  // Check cookies
  const cookies = await ctx.cookies('https://chat.deepseek.com')
  console.log(`\nCookies for chat.deepseek.com (${cookies.length}):`)
  for (const c of cookies) {
    console.log(`  ${c.name} = ${c.value.substring(0, 60)}${c.value.length > 60 ? '...' : ''}`)
  }

  const auth = cookies.find(c => c.name === 'authorization')
  if (auth) {
    console.log(`\n>>> AUTH COOKIE FOUND! len=${auth.value.length}`)
    console.log(`>>> Value: ${auth.value}`)
  } else {
    console.log('\n>>> No authorization cookie')
  }

  await browser.close()
  killChrome()
}

main().catch(console.error)
