import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WebRuntimeManager } from '../../src/main/webRuntime/manager.ts'

const devEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/web-runtime/index.ts',
)

/**
 * Spawn-command resolution for the WebLLM sidecar across dev and packaged
 * builds. `resolveSidecarEntry()` must NOT depend on a real Electron runtime,
 * so both branches are asserted from a bare Node process.
 */
test('dev build resolves the dev sidecar entry', () => {
  const m = new WebRuntimeManager()
  const spec = m.resolveSidecarEntry()
  assert.equal(spec.command, 'node')
  assert.equal(spec.args.length, 1)
  assert.ok(path.isAbsolute(spec.args[0]))
  // Default dev entry points at the compiled web-runtime dist. Pointing at the
  // TS source would be a regression: it is not runnable by Node directly.
  assert.notEqual(spec.args[0], devEntry)
  assert.ok(!spec.args[0].includes('resources'))
})

test('dev build honors the WEBLLM_DEV_ENTRY override', () => {
  const entry = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'fake-sidecar.ts',
  )
  const prev = process.env.WEBLLM_DEV_ENTRY
  process.env.WEBLLM_DEV_ENTRY = entry
  try {
    const m = new WebRuntimeManager()
    const spec = m.resolveSidecarEntry()
    assert.equal(spec.command, 'node')
    assert.deepEqual(spec.args, [entry])
  } finally {
    if (prev === undefined) delete process.env.WEBLLM_DEV_ENTRY
    else process.env.WEBLLM_DEV_ENTRY = prev
  }
})

test('packaged build resolves the sidecar under process.resourcesPath', () => {
  // Bare Node has no `process.resourcesPath` (it is Electron-only), so stub it
  // for the duration of the assertion, mirroring where electron-builder places
  // extraResources: <resources>/web-runtime/index.js.
  const prev = (process as { resourcesPath?: string }).resourcesPath
  const fakeResources = '/fake/resources'
  ;(process as { resourcesPath?: string }).resourcesPath = fakeResources
  try {
    const m = new WebRuntimeManager({ isPackagedOverride: true })
    const spec = m.resolveSidecarEntry()
    assert.equal(spec.command, 'node')
    assert.deepEqual(spec.args, [path.join(fakeResources, 'web-runtime', 'index.js')])
  } finally {
    if (prev === undefined) delete (process as { resourcesPath?: string }).resourcesPath
    else (process as { resourcesPath?: string }).resourcesPath = prev
  }
})

test('entryOverride always wins over dev/packaged resolution', () => {
  const override = { command: process.execPath, args: ['-e', 'process.exit(0)'] }
  const m = new WebRuntimeManager({ entryOverride: override, isPackagedOverride: true })
  assert.deepEqual(m.resolveSidecarEntry(), override)
})
