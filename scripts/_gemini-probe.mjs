import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'gemini')
const ctx = await chromium.launchPersistentContext(profileDir, { headless: false })
const page = ctx.pages()[0] || await ctx.newPage()

await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(5000)

console.log('URL:', page.url())
console.log('TITLE:', await page.title().catch(() => ''))

// Find composer input candidates
const composer = await page.evaluate(() => {
  const candidates = [
    'rich-textarea[data-placeholder]',
    'div.ql-editor[contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
  ]
  const found = []
  for (const sel of candidates) {
    document.querySelectorAll(sel).forEach((el) => {
      found.push({ selector: sel, tag: el.tagName, placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '' })
    })
  }
  return found
})
console.log('COMPOSERS:', JSON.stringify(composer, null, 2))

// Find send button candidates
const buttons = await page.evaluate(() => {
  const found = []
  document.querySelectorAll('button').forEach((b) => {
    const label = (b.getAttribute('aria-label') || b.getAttribute('test-id') || b.textContent || '').trim().slice(0, 40)
    if (label) found.push(label)
  })
  return found.slice(0, 20)
})
console.log('BUTTONS:', JSON.stringify(buttons, null, 2))

await page.waitForTimeout(1500)
await ctx.close()
console.log('PROBE_DONE')
