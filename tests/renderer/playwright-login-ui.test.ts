import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldShowPlaywrightLoginButton,
  credentialsFromPayload,
} from '../../src/renderer/src/components/providers/providersPlaywrightFlow.ts'

test('button shows only for providers with playwright login config', () => {
  const providers = ['chatgpt', 'deepseek']
  assert.equal(shouldShowPlaywrightLoginButton('deepseek', providers), true)
  assert.equal(shouldShowPlaywrightLoginButton('glm', providers), false)
})

test('credentialsFromPayload copies credentials immutably', () => {
  const payload = { credentials: { token: 'abc' } }
  const result = credentialsFromPayload(payload)
  assert.deepEqual(result, { token: 'abc' })
  result.token = 'mutated'
  assert.equal(payload.credentials.token, 'abc')
})

test('credentialsFromPayload handles null', () => {
  assert.deepEqual(credentialsFromPayload(null), {})
})
