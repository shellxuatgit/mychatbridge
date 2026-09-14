import test from 'node:test'
import assert from 'node:assert/strict'

import { applyProviderOrder, moveProvider } from '../../src/renderer/src/lib/providerOrder.ts'

type Lite = { id: string }

const p = (id: string): Lite => ({ id })

test('applyProviderOrder overlays persisted order and preserves unknown providers', () => {
  const providers = [p('a'), p('b'), p('c'), p('d')]

  assert.deepEqual(
    applyProviderOrder(providers, ['c', 'a']).map((x) => x.id),
    ['c', 'a', 'b', 'd']
  )

  assert.deepEqual(
    applyProviderOrder(providers, ['x', 'a']).map((x) => x.id),
    ['a', 'b', 'c', 'd']
  )

  assert.equal(applyProviderOrder(providers, undefined), providers)
  assert.equal(applyProviderOrder(providers, []), providers)
})

test('moveProvider relocates a provider and does not mutate the input', () => {
  const providers = [p('a'), p('b'), p('c'), p('d')]

  assert.deepEqual(
    moveProvider(providers, 'a', 'c').map((x) => x.id),
    ['b', 'c', 'a', 'd']
  )
  assert.deepEqual(
    providers.map((x) => x.id),
    ['a', 'b', 'c', 'd']
  )

  assert.equal(moveProvider(providers, 'a', 'zzz'), providers)
  assert.equal(moveProvider(providers, 'zzz', 'c'), providers)
  assert.equal(moveProvider(providers, 'b', 'b'), providers)
})