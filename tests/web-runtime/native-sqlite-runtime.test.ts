/**
 * Regression: native better-sqlite3 must load and work under the runtime that
 * actually ships in the app — Electron's bundled Node — not the system Node.
 *
 * Crash being guarded against:
 *   better-sqlite3@13 declares "engines": { "node": ">=22" } and its prebuilt
 *   addon needs Node-API 10, but Electron 33 bundles Node 20.18 (NAPI 9).
 *   `new Database(...)` then segfaults (0xC0000005) and kills the whole main
 *   process, so cookie import / auto-connect exits the app.
 *
 * Why ELECTRON_RUN_AS_NODE: it runs Electron's own Node (same ABI as the main
 * process) without booting a window, and it reproduces the crash deterministically.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ELECTRON_BIN =
  process.platform === 'win32'
    ? join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
    : process.platform === 'darwin'
      ? join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
      : join(ROOT, 'node_modules', 'electron', 'dist', 'electron')

const PROBE = `
const D = require('better-sqlite3')
const db = new D(':memory:')
db.exec('CREATE TABLE t (a INTEGER)')
db.prepare('INSERT INTO t VALUES (1)').run()
const row = db.prepare('SELECT count(*) AS c FROM t').get()
db.close()
console.log('SQLITE_OK', JSON.stringify(row))
`

test('better-sqlite3 works under Electron runtime (not just system Node)', { timeout: 120_000 }, () => {
  assert.ok(existsSync(ELECTRON_BIN), `Electron binary not found at ${ELECTRON_BIN}`)

  const result = spawnSync(ELECTRON_BIN, ['-e', PROBE], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  // A native crash exits with a negative/NTSTATUS code (e.g. -1073741819 for
  // 0xC0000005) rather than a clean 0.
  assert.equal(
    result.status,
    0,
    `Electron runtime could not use better-sqlite3 (exit=${result.status}). Output:\n${output}`
  )
  assert.match(output, /SQLITE_OK \{"c":1\}/, `unexpected probe output:\n${output}`)
})
