import { chromium } from 'playwright'
import { join } from 'path'
import { homedir } from 'os'

async function main(): Promise<void> {
  const profileDir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'shared')
  console.log('[Claude Setup] Launching browser window for onboarding completion...')
  
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled', '--disable-infobars'],
    ignoreDefaultArgs: ['--enable-automation'],
  })

  try {
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})

    console.log('\n======================================================')
    console.log('[ACTION REQUIRED] Browser window is now open!')
    console.log('Please enter your name, select your mode, and complete')
    console.log('the Claude onboarding flow until you see the chat input box.')
    console.log('Waiting for the chat input box to appear (up to 5 minutes)...')
    console.log('======================================================\n')

    const startTime = Date.now()
    const timeoutMs = 300000 // 5 minutes
    let completed = false

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const hasComposer = await page.evaluate(() => {
          const editor = document.querySelector('div.ProseMirror, fieldset div[contenteditable="true"], div[contenteditable="true"]')
          return !!editor
        })

        if (hasComposer) {
          console.log('[Claude Setup] Chat composer detected! Onboarding successfully completed!')
          completed = true
          break
        }
      } catch {
        // navigation transient error, keep polling
      }
    }

    if (completed) {
      console.log('[Claude Setup] Waiting 3 seconds to ensure state is saved...')
      await new Promise((r) => setTimeout(r, 3000))
    } else {
      console.log('[Claude Setup] Timed out waiting for chat box.')
    }
  } finally {
    await ctx.close().catch(() => {})
  }
}

main().catch(console.error)
