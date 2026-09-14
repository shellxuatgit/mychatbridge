/**
 * Test: supported locale registration and system-language mapping
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { getDefaultLanguage } from '../../src/renderer/src/stores/settingsStore.ts'

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'es-ES', 'fr-FR', 'de-DE', 'ru-RU'] as const

test('all supported locale files are complete and valid', async () => {
  const fs = await import('fs')
  const path = new URL('../../src/renderer/src/i18n/locales/', import.meta.url)
  const base = JSON.parse(fs.readFileSync(new URL('en-US.json', path), 'utf8'))
  const paths = (value: unknown, prefix = '', result: string[] = []): string[] => {
    if (!value || typeof value !== 'object') return result
    for (const [key, child] of Object.entries(value)) {
      const current = prefix ? `${prefix}.${key}` : key
      if (child && typeof child === 'object') paths(child, current, result)
      else result.push(current)
    }
    return result
  }
  const expected = paths(base)
  for (const locale of locales) {
    const data = JSON.parse(fs.readFileSync(new URL(`${locale}.json`, path), 'utf8'))
    assert.deepEqual(paths(data), expected, `${locale} should contain every translation key`)
  }
})

test('system language maps to supported locale', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    for (const [system, expected] of [
      ['zh-TW', 'zh-TW'], ['zh-CN', 'zh-CN'], ['ja-JP', 'ja-JP'],
      ['ko-KR', 'ko-KR'], ['es-ES', 'es-ES'], ['fr-FR', 'fr-FR'],
      ['de-DE', 'de-DE'], ['ru-RU', 'ru-RU'], ['en-US', 'en-US'],
    ] as const) {
      Object.defineProperty(globalThis, 'navigator', { value: { language: system }, configurable: true })
      assert.equal(getDefaultLanguage(), expected)
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
  }
})
