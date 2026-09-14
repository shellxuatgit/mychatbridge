import { chromium, _electron as electron } from 'playwright'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'

const LOCALES = ['zh-CN', 'en-US', 'zh-TW', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR', 'de-DE', 'ru-RU']

const PAGES = [
  { hash: '#/', name: 'overview' },
  { hash: '#/providers', name: 'providers' },
  { hash: '#/api-keys', name: 'api-keys' },
  { hash: '#/models', name: 'models' },
  { hash: '#/dashboard', name: 'dashboard' },
  { hash: '#/logs', name: 'logs' },
  { hash: '#/settings', name: 'settings' },
  { hash: '#/about', name: 'about' },
]

const OUT_ROOT = join(process.cwd(), 'docs', 'screenshots')
const STORAGE_DIR = join(homedir(), '.mychatbridge')

async function captureLocale(locale) {
  mkdirSync(join(OUT_ROOT, locale), { recursive: true })
  mkdirSync(STORAGE_DIR, { recursive: true })
  const dataFile = join(STORAGE_DIR, 'data.json')
  let existing = {}
  if (existsSync(dataFile)) {
    try {
      existing = JSON.parse(await import('fs').then(m => m.readFileSync(dataFile, 'utf-8')))
    } catch {}
  }
  writeFileSync(
    dataFile,
    JSON.stringify({ ...existing, config: { ...(existing.config || {}), language: locale } }, null, 2)
  )

  const userDataDir = join(process.cwd(), '.shot-userdata', locale)
  rmSync(userDataDir, { recursive: true, force: true })

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_USER_DATA_DIR: userDataDir },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(4000)

  for (const page of PAGES) {
    await win.evaluate((h) => { window.location.hash = h }, page.hash)
    await win.waitForTimeout(1500)
    try {
      await win.screenshot({ path: join(OUT_ROOT, locale, `${page.name}.png`), timeout: 15000 })
    } catch {
      await win.bringToFront()
      await win.screenshot({ path: join(OUT_ROOT, locale, `${page.name}.png`), timeout: 15000 })
    }
    console.log(`[${locale}] ${page.name}.png`)
  }

  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
}

async function main() {
  const only = process.argv[2]
  const locales = only ? LOCALES.filter((l) => l === only) : LOCALES
  for (const locale of locales) {
    console.log(`Capturing ${locale}...`)
    try {
      await captureLocale(locale)
    } catch (err) {
      console.error(`Failed for ${locale}:`, err.message)
    }
  }
}

main()
