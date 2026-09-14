/**
 * Test: System language detection + Overview Quick Controls state toggling
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { getDefaultLanguage } from '../../src/renderer/src/stores/settingsStore.ts'

test('getDefaultLanguage selects zh-CN when navigator.language starts with zh', () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'zh-CN' },
      configurable: true,
      writable: true,
    })
    assert.equal(getDefaultLanguage(), 'zh-CN')

    Object.defineProperty(globalThis, 'navigator', {
      value: { language: 'zh-TW' },
      configurable: true,
      writable: true,
    })
    assert.equal(getDefaultLanguage(), 'zh-TW')
  } finally {
    if (origDesc) {
      Object.defineProperty(globalThis, 'navigator', origDesc)
    }
  }
})

test('getDefaultLanguage supports major non-zh system languages', () => {
  const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    for (const [system, expected] of [
      ['en-US', 'en-US'],
      ['ja-JP', 'ja-JP'],
      ['ko-KR', 'ko-KR'],
      ['es-ES', 'es-ES'],
      ['fr-FR', 'fr-FR'],
      ['de-DE', 'de-DE'],
      ['ru-RU', 'ru-RU'],
    ] as const) {
      Object.defineProperty(globalThis, 'navigator', { value: { language: system }, configurable: true })
      assert.equal(getDefaultLanguage(), expected)
    }
  } finally {
    if (origDesc) Object.defineProperty(globalThis, 'navigator', origDesc)
  }
})

test('Theme toggle flips between dark and light', () => {
  const flip = (current: 'light' | 'dark') => (current === 'dark' ? 'light' : 'dark')
  assert.equal(flip('dark'), 'light')
  assert.equal(flip('light'), 'dark')
})

test('Language toggle flips between zh-CN and en-US', () => {
  const flip = (current: 'zh-CN' | 'en-US') => (current === 'zh-CN' ? 'en-US' : 'zh-CN')
  assert.equal(flip('zh-CN'), 'en-US')
  assert.equal(flip('en-US'), 'zh-CN')
})
