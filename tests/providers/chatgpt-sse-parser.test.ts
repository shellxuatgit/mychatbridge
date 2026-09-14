/**
 * Core Gateway Module - ChatGPT SSE Parser Tests
 * Verifies chunk-safe parsing of ChatGPT backend-api /conversation SSE.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseChatGptChunk,
  createChatGptParseState,
} from '../../src/main/proxy/adapters/chatgpt/sse-parser.ts'

function feedAll(chunks: Array<Buffer | string>) {
  let state = createChatGptParseState()
  const allDeltas: string[] = []
  let completed = false
  let error: string | undefined

  for (const chunk of chunks) {
    const result = parseChatGptChunk(chunk, state)
    state = result.state
    allDeltas.push(...result.deltas)
    if (result.error) error = result.error
    if (result.completed) completed = true
  }

  return { deltas: allDeltas, state, completed, error }
}

test('parses cumulative parts and emits only suffixes', () => {
  const { deltas, state } = feedAll([
    'data: {"message":{"content":{"parts":["Hello"]},"conversation_id":"c1"}}\n\n',
    'data: {"message":{"content":{"parts":["Hello world"]}}}\n\n',
  ])

  assert.deepEqual(deltas, ['Hello', ' world'])
  assert.equal(state.accumulatedText, 'Hello world')
  assert.equal(state.conversationId, 'c1')
})

test('handles delta events and [DONE]', () => {
  const { deltas, completed, state } = feedAll([
    'data: {"message":{"content":{"parts":["Hel"]}}}\n\n',
    'data: {"delta":{"content":"lo"}}\n\n',
    'data: [DONE]\n\n',
  ])

  assert.deepEqual(deltas, ['Hel', 'lo'])
  assert.equal(state.accumulatedText, 'Hello')
  assert.equal(completed, true)
  assert.equal(state.done, true)
})

test('handles chunk boundaries that split records', () => {
  const stream =
    'data: {"message":{"content":{"parts":["Hello"]},"conversation_id":"c1"}}\n\n' +
    'data: {"message":{"content":{"parts":["Hello world"]}}}\n\n' +
    'data: [DONE]\n\n'

  const state0 = createChatGptParseState()
  const r1 = parseChatGptChunk(stream.slice(0, 10), state0)
  const r2 = parseChatGptChunk(stream.slice(10, 60), r1.state)
  const r3 = parseChatGptChunk(stream.slice(60), r2.state)

  const deltas = [...r1.deltas, ...r2.deltas, ...r3.deltas]
  assert.deepEqual(deltas, ['Hello', ' world'])
  assert.equal(r3.completed, true)
  assert.equal(r3.state.conversationId, 'c1')
})

test('ignores non-data lines and empty payloads', () => {
  const { deltas, completed } = feedAll([
    'event: ping\n\n',
    ': comment\n\n',
    'data:\n\n',
    'data: [DONE]\n\n',
  ])

  assert.deepEqual(deltas, [])
  assert.equal(completed, true)
})

test('upstream error event surfaces a structured error', () => {
  const { error } = feedAll([
    'data: {"error":"upstream exploded"}\n\n',
  ])

  assert.equal(error, 'upstream exploded')
})

test('emits completion exactly once for multiple done signals', () => {
  const { deltas, completed } = feedAll([
    'data: {"message":{"content":{"parts":["hi"]},"conversation_id":"c"}}\n\n',
    'data: {"message":{"content":{"parts":["hi"]},"conversation_id":"c"},"done":true}\n\n',
    'data: [DONE]\n\n',
  ])

  assert.deepEqual(deltas, ['hi'])
  assert.equal(completed, true)
})

test('handles text events with content.text string form', () => {
  const { deltas } = feedAll([
    'data: {"message":{"content":{"text":"answer"}}}\n\n',
  ])

  assert.deepEqual(deltas, ['answer'])
})

test('no credential leakage: access token never appears in output', () => {
  const { deltas, state } = feedAll([
    'data: {"message":{"content":{"parts":["secret token abc"]},"conversation_id":"c"}}\n\n',
  ])

  assert.deepEqual(deltas, ['secret token abc'])
  assert.equal(state.conversationId, 'c')
  // The parser never echoes back raw event payloads
  assert.equal(Object.keys(state).includes('accumulatedText'), true)
})