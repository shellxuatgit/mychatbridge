/**
 * Storage Migration Tests — legacy ~/.chat2api → ~/.mychatbridge
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { migrateLegacyStorage } from '../../src/main/store/migrate.ts'

function makeDirs() {
  const root = mkdtempSync(join(tmpdir(), 'mychatbridge-migrate-'))
  const legacy = join(root, '.chat2api')
  const target = join(root, '.mychatbridge')
  mkdirSync(legacy, { recursive: true })
  return { root, legacy, target }
}

test('migrates legacy storage into the new location, keeping source intact', () => {
  const { root, legacy, target } = makeDirs()
  writeFileSync(join(legacy, 'data.json'), '{"encrypted":true}')
  mkdirSync(join(legacy, 'request-logs'), { recursive: true })
  writeFileSync(join(legacy, 'request-logs', '1.log'), 'log')

  const result = migrateLegacyStorage(legacy, target)

  assert.equal(result.migrated, true)
  assert.equal(result.reason, 'copied')
  assert.equal(existsSync(target), true)
  assert.equal(readFileSync(join(target, 'data.json'), 'utf8'), '{"encrypted":true}')
  assert.equal(readFileSync(join(target, 'request-logs', '1.log'), 'utf8'), 'log')
  // Legacy directory is kept as a backup and never deleted
  assert.equal(readFileSync(join(legacy, 'data.json'), 'utf8'), '{"encrypted":true}')
  rmSync(root, { recursive: true, force: true })
})

test('no-op when legacy directory is missing (fresh install)', () => {
  const { root, legacy, target } = makeDirs()
  rmSync(legacy, { recursive: true, force: true })

  const result = migrateLegacyStorage(legacy, target)

  assert.equal(result.migrated, false)
  assert.equal(result.reason, 'legacy_missing')
  assert.equal(existsSync(target), false)
  rmSync(root, { recursive: true, force: true })
})

test('no-op when target already exists (already migrated)', () => {
  const { root, legacy, target } = makeDirs()
  writeFileSync(join(legacy, 'data.json'), 'old')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'data.json'), 'new')

  const result = migrateLegacyStorage(legacy, target)

  assert.equal(result.migrated, false)
  assert.equal(result.reason, 'target_exists')
  assert.equal(readFileSync(join(target, 'data.json'), 'utf8'), 'new')
  rmSync(root, { recursive: true, force: true })
})
