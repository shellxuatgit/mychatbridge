/**
 * Regression: the Local API start/stop toggle must survive React re-renders.
 *
 * The control used to be injected into the Local API <h2> via createPortal.
 * React owns that heading, so changing its text (e.g. switching language) ran
 * `textContent = ...`, which removed every child node — including the portaled
 * button — and React never re-inserted it.
 *
 * Requires a fresh build: npx electron-vite build
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { _electron } from 'playwright'

const LOCAL_API_HEADING = '.phase1-overview > .mx-auto.max-w-2xl.space-y-8 > section:nth-of-type(2) h2'

async function probe(page: import('playwright').Page) {
  return page.evaluate((selector) => {
    const h2 = document.querySelector(selector)
    return {
      text: h2?.textContent?.trim() ?? null,
      buttons: h2 ? h2.querySelectorAll('button').length : -1,
    }
  }, LOCAL_API_HEADING)
}

test('Local API toggle button survives a language change', { timeout: 180_000 }, async (t) => {
  const app = await _electron.launch({ cwd: process.cwd(), args: ['out/main/index.js'] })
  t.after(() => app.close().catch(() => {}))

  const first = await app.firstWindow()
  await first.waitForLoadState('domcontentloaded')
  await new Promise((r) => setTimeout(r, 2500))

  const windows = app.windows()
  let page = first
  for (const w of windows) {
    const hash = await w.evaluate(() => window.location.hash).catch(() => '')
    if (hash !== '#tray') page = w
  }

  await page.evaluate(() => { window.location.hash = '#/' })
  await new Promise((r) => setTimeout(r, 3000))

  const before = await probe(page)
  assert.equal(before.buttons, 1, `expected exactly one Local API toggle before switching, got ${JSON.stringify(before)}`)

  // Switch to a different language than the currently active one so the heading
  // text is guaranteed to change.
  const target = /[\u3040-\u30ff]/.test(before.text ?? '') ? 'English' : '日本語'
  const trigger = page.locator('.phase1-overview-header [role="combobox"]').first()
  await trigger.click()
  await new Promise((r) => setTimeout(r, 700))
  await page.getByRole('option', { name: target }).click()
  await new Promise((r) => setTimeout(r, 2500))

  const after = await probe(page)
  assert.notEqual(after.text, before.text, 'language switch should change the Local API heading text')
  assert.equal(after.buttons, 1, `Local API toggle disappeared after re-render: ${JSON.stringify(after)}`)

  // The surviving button must still be functional: clicking it flips the
  // start/stop state (observed through the aria-label).
  const label = () => page.evaluate((selector) =>
    document.querySelector(`${selector} button`)?.getAttribute('aria-label') ?? null, LOCAL_API_HEADING)

  const labelBefore = await label()
  await page.locator(`${LOCAL_API_HEADING} button`).click()
  await new Promise((r) => setTimeout(r, 2500))
  const labelAfter = await label()

  assert.notEqual(labelAfter, labelBefore, `toggle did not change Local API state (still ${labelAfter})`)
})
