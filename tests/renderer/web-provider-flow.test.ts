import test from 'node:test'
import assert from 'node:assert/strict'

import { getBuiltinProviderNextAction } from '../../src/renderer/src/components/providers/webProviderFlow.ts'

test('selecting a web provider advances directly to Connect', () => {
  assert.equal(getBuiltinProviderNextAction({ type: 'web' }), 'connect')
})

test('selecting a non-web provider keeps the normal credential flow', () => {
  assert.equal(getBuiltinProviderNextAction({ type: 'builtin' }), 'none')
  assert.equal(getBuiltinProviderNextAction({ type: 'custom' }), 'none')
})
