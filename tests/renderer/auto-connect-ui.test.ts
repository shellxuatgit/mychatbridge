import test from 'node:test'
import assert from 'node:assert/strict'
import {
  START_AUTO_CONNECT_PROVIDERS,
  isAutoConnectProvider,
  nextAutoConnectUiPhase,
  type AutoConnectUiPhase,
} from '../../src/renderer/src/lib/autoConnect'

test('which providers participate', () => {
  assert.deepEqual(START_AUTO_CONNECT_PROVIDERS, ['chatgpt', 'chatgpt-web', 'doubao-web', 'deepseek'])
  assert.equal(isAutoConnectProvider('chatgpt-web'), true)
  assert.equal(isAutoConnectProvider('deepseek'), true)
  assert.equal(isAutoConnectProvider('chatgpt'), true)
  assert.equal(isAutoConnectProvider('glm'), false)
})

test('UI phase transitions follow L1 -> L2 -> L3', () => {
  assert.equal(nextAutoConnectUiPhase('idle', { status: 'imported', payload: { providerId: 'chatgpt', credentials: {}, accountName: 'x' } }), 'success')
  assert.equal(nextAutoConnectUiPhase('idle', { status: 'opened' }), 'opened')
  assert.equal(nextAutoConnectUiPhase('idle', { status: 'unsupported', reason: 'x' }), 'error')
  assert.equal(nextAutoConnectUiPhase('opened', { status: 'imported', payload: { providerId: 'x', credentials: {}, accountName: 'x' } }), 'success')
  assert.equal(nextAutoConnectUiPhase('opened', { status: 'pending' }), 'opened')
  assert.equal(nextAutoConnectUiPhase('checking', { status: 'pending' }), 'checking')
})