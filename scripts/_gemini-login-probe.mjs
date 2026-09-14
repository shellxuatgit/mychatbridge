import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'gemini')
const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: ['--disable-blink-features=AutomationControlled', '--disable-infobars'],
  ignoreDefaultArgs: ['--enable-automation'],
})
const page = ctx.pages()[0] || await ctx.newPage()
await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

console.log('WINDOW_OPENED - please log in with your Google account (max 5 min)...')

// Capture the conversation protocol request while the user interacts
let captured = null
page.on('request', (req) => {
  if (req.method() === 'POST' && /batchexecute|StreamGenerate|generation/i.test(req.url())) {
    try {
      const body = req.postData() || ''
      if (!captured && body.length > 50) {
        captured = { url: req.url(), bodyLength: body.length }
      }
    } catch { /* ignore */ }
  }
})

// Navigation-tolerant login poll
let loggedIn = false
for (let i = 0; i < 200; i++) {
  await page.waitForTimeout(1500)
  try {
    const state = await page.evaluate(() => {
      const loginBtns = Array.from(document.querySelectorAll('button, a')).filter((el) =>
        /^登录$|^Log in$|^Sign in$/i.test((el.textContent || '').trim())
      )
      const editor = document.querySelector('div.ql-editor[contenteditable="true"]')
      return { loginVisible: loginBtns.length > 0, hasEditor: !!editor, url: window.location.href }
    })
    if (i % 10 === 0) console.log(`poll ${i}:`, JSON.stringify(state))
    if (!state.loginVisible && state.hasEditor) {
      console.log('LOGGED_IN')
      loggedIn = true
      break
    }
  } catch { /* navigation destroyed context - retry */ }
}

if (!loggedIn) {
  console.log('LOGIN_TIMEOUT_OR_FAILED')
  await ctx.close()
  process.exit(1)
}

// Send a test message and capture the protocol request
try {
  await page.waitForTimeout(1000)
  const editor = page.locator('div.ql-editor[contenteditable="true"]').first()
  await editor.fill('请只回复：Gemini 协议探测成功。')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(10000)
  console.log('CAPTURED_REQUEST:', JSON.stringify(captured))

  // Extract the reply text and model selector label
  const finalState = await page.evaluate(() => {
    const modelBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /打开模式选择器|model picker|当前模式/i.test(b.getAttribute('aria-label') || '')
    )
    const responses = document.querySelectorAll('model-response, .model-response-text, message-content')
    return {
      modelLabel: modelBtn?.getAttribute('aria-label') || null,
      replyCount: responses.length,
      lastReply: responses.length ? responses[responses.length - 1].textContent?.slice(0, 100) : null,
    }
  })
  console.log('FINAL_STATE:', JSON.stringify(finalState))
} catch (e) {
  console.log('MESSAGE_SEND_ERR:', e.message?.slice(0, 200))
}

await ctx.close()
console.log('PROBE_DONE')
