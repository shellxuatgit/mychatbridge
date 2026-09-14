import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  console.log('Opening Claude in Chrome...')
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 60000 })

    console.log('Page loaded. Checking for modals or continue buttons...')
    await page.waitForTimeout(3000)

    const continueBtn = page.locator('button[data-testid="continue"]')
    if (await continueBtn.isVisible().catch(() => false)) {
      console.log('Clicking continue button...')
      await continueBtn.click()
      await page.waitForTimeout(2000)
    }

    // Check for ProseMirror editor or input
    const editor = page.locator('div.ProseMirror, fieldset div[contenteditable="true"], div[contenteditable="true"]')
    console.log('Editor visible:', await editor.first().isVisible().catch(() => false))

    if (await editor.first().isVisible().catch(() => false)) {
      console.log('Typing test prompt...')
      await editor.first().fill('Say OK')
      await page.waitForTimeout(1000)

      // Find send button
      const sendBtn = page.locator('button[aria-label*="Send"], button[aria-label*="发送"], button:has(svg)').last()
      console.log('Send button visible:', await sendBtn.isVisible().catch(() => false))
    }

    console.log('Holding window for 15s to observe...')
    await page.waitForTimeout(15000)
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
