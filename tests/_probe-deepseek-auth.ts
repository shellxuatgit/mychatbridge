import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const ctx = browser.contexts()[0]
  console.log(`Connected. ${ctx.pages().length} page(s): ${ctx.pages().map(p => p.url()).join(', ')}`)

  // === 1. ChatGPT (has session token in Default profile) ===
  console.log('\n========== ChatGPT ==========')
  const chatgptPage = ctx.pages().find(p => p.url().includes('chatgpt')) || await ctx.newPage()
  await chatgptPage.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await chatgptPage.waitForTimeout(3000)
  console.log('URL:', chatgptPage.url())

  const chatgptCookies = await ctx.cookies('https://chatgpt.com')
  const sessionTokens = chatgptCookies.filter(c => c.name.includes('session-token'))
  console.log(`Session tokens: ${sessionTokens.length}`)
  for (const c of sessionTokens) {
    console.log(`  ${c.name} = ${c.value.substring(0, 40)}... (len=${c.value.length})`)
  }

  // === 2. DeepSeek ===
  console.log('\n========== DeepSeek ==========')
  const dsPage = ctx.pages().find(p => p.url().includes('deepseek')) || await ctx.newPage()
  if (!dsPage.url().includes('deepseek')) {
    await dsPage.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await dsPage.waitForTimeout(3000)
  }
  console.log('URL:', dsPage.url())

  const dsCookies = await ctx.cookies('https://chat.deepseek.com')
  console.log(`Cookies: ${dsCookies.length}`)
  for (const c of dsCookies) {
    console.log(`  ${c.name} = ${c.value.substring(0, 60)}${c.value.length > 60 ? '...' : ''}`)
  }

  const auth = dsCookies.find(c => c.name === 'authorization')
  if (auth) {
    console.log(`\n>>> authorization FOUND (len=${auth.value.length})`)
  } else {
    console.log(`\n>>> authorization NOT found`)
    // Try reading from page JS
    const lsToken = await dsPage.evaluate(() => localStorage.getItem('userToken')).catch(() => null)
    if (lsToken) console.log(`  localStorage.userToken: ${lsToken.substring(0, 60)}...`)
  }

  await browser.close()
}

main().catch(console.error)
