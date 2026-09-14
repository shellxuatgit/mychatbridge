import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  console.log('Launching headed Chrome to inspect Claude.ai UI...')
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  try {
    const page = ctx.pages()[0] || (await ctx.newPage())

    page.on('request', (req) => {
      if (req.url().includes('/api/') || req.url().includes('completion')) {
        console.log('[Claude Network] REQ:', req.method(), req.url())
      }
    })

    page.on('response', async (res) => {
      if (res.url().includes('/api/')) {
        console.log('[Claude Network] RES:', res.status(), res.url())
      }
    })

    await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 60000 })
    console.log('Page loaded, waiting for elements...')
    await page.waitForTimeout(5000)

    // Inspect candidate selectors for input
    const info = await page.evaluate(() => {
      const p = document.querySelector('div.ProseMirror, fieldset div[contenteditable="true"], div[contenteditable="true"]')
      const btns = Array.from(document.querySelectorAll('button')).map((b) => ({
        text: (b.innerText || '').trim(),
        ariaLabel: b.getAttribute('aria-label'),
        testid: b.getAttribute('data-testid'),
      }))
      return {
        hasInput: !!p,
        inputTag: p?.tagName,
        inputClasses: p?.className,
        buttons: btns.slice(0, 15),
      }
    })
    console.log('Detected input info:', JSON.stringify(info, null, 2))
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
