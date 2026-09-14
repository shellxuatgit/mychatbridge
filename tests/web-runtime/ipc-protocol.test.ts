import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeBinaryFrame, decodeBinaryFrame } from '../../src/web-runtime/ipc-protocol.ts'

test('encode/decode binary frame round-trips', () => {
  const buf = encodeBinaryFrame(JSON.stringify({ request_id: '1', delta: 'hi', finish_reason: null }))
  const { frame, remaining } = decodeBinaryFrame(buf)
  assert.equal(remaining.length, 0)
  assert.equal(JSON.parse(frame!.data.toString()).delta, 'hi')
})
