/**
 * Cookie import must degrade gracefully when the native SQLite driver cannot be
 * used, instead of taking down the whole main process.
 *
 * History: better-sqlite3@13 was built for a newer Node-API than Electron 33
 * bundles, and `new Database(...)` segfaulted (0xC0000005) — a native crash that
 * no try/catch can intercept, so selecting "auto-connect" exited the app.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { isNativeAbiMismatch } from '../../src/main/webRuntime/cookieImporter.ts'

test('detects a NODE_MODULE_VERSION mismatch as an ABI problem', () => {
  const error = new Error(
    "The module 'better_sqlite3.node' was compiled against a different Node.js version using\n" +
      'NODE_MODULE_VERSION 137. This version of Node.js requires\n' +
      'NODE_MODULE_VERSION 130.'
  )
  assert.equal(isNativeAbiMismatch(error), true)
})

test('detects ERR_DLOPEN_FAILED as an ABI problem', () => {
  const error = Object.assign(new Error('dlopen failed'), { code: 'ERR_DLOPEN_FAILED' })
  assert.equal(isNativeAbiMismatch(error), true)
})

test('does not classify ordinary SQLite errors as ABI problems', () => {
  const locked = Object.assign(new Error('unable to open database file'), { code: 'SQLITE_CANTOPEN' })
  assert.equal(isNativeAbiMismatch(locked), false)
  assert.equal(isNativeAbiMismatch(new Error('some other failure')), false)
  assert.equal(isNativeAbiMismatch(undefined), false)
  assert.equal(isNativeAbiMismatch(null), false)
})
