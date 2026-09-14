import test from 'node:test'
import assert from 'node:assert/strict'
import { extractScriptValue } from '../../src/main/webRuntime/chromeLocalStorage.ts'
import type { LogEntry } from '../../src/main/webRuntime/leveldbLog.ts'

const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com'

function scriptKeyBytes(scriptKey: string): Buffer {
  // 0x01 = latin1 marker
  return Buffer.concat([Buffer.from([0x01]), Buffer.from(scriptKey, 'latin1')])
}
function valueWithMarker(v: string): Buffer {
  return Buffer.concat([Buffer.from([0x01]), Buffer.from(v, 'latin1')])
}
function fullKey(origin: string, scriptKey: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x5f]),
    Buffer.from(origin, 'latin1'),
    Buffer.from([0x00]),
    scriptKeyBytes(scriptKey),
  ])
}

test('extractScriptValue finds latin1-prefixed userToken', () => {
  const key = fullKey(DEEPSEEK_ORIGIN, 'userToken')
  const entries: LogEntry[] = [
    { key, value: valueWithMarker('sk-latin1') },
    { key: Buffer.from('_https://unrelated.com\x00\x01other'), value: Buffer.from([0x01, 0x78]) },
    { key: Buffer.from('META:' + DEEPSEEK_ORIGIN), value: Buffer.alloc(4) },
  ]
  assert.equal(extractScriptValue(entries, DEEPSEEK_ORIGIN, 'userToken'), 'sk-latin1')
})

test('extractScriptValue finds utf16-prefixed userToken', () => {
  const key = fullKey(DEEPSEEK_ORIGIN, 'userToken')
  const entries: LogEntry[] = [{
    key,
    value: Buffer.concat([Buffer.from([0x00]), Buffer.from('sk-utf16', 'utf16le')]),
  }]
  assert.equal(extractScriptValue(entries, DEEPSEEK_ORIGIN, 'userToken'), 'sk-utf16')
})

test('extractScriptValue returns null for META key', () => {
  const entries: LogEntry[] = [
    { key: Buffer.from('META:' + DEEPSEEK_ORIGIN), value: Buffer.from([0x00, 0x00, 0x00, 0x00]) },
  ]
  assert.equal(extractScriptValue(entries, DEEPSEEK_ORIGIN, 'userToken'), null)
})

test('extractScriptValue returns null for VERSION key', () => {
  const entries: LogEntry[] = [
    { key: Buffer.from('VERSION'), value: Buffer.from([0x00]) },
  ]
  assert.equal(extractScriptValue(entries, DEEPSEEK_ORIGIN, 'userToken'), null)
})

test('extractScriptValue returns null for empty value body', () => {
  const key = fullKey(DEEPSEEK_ORIGIN, 'userToken')
  const entries: LogEntry[] = [
    { key, value: Buffer.from([0x01]) }, // marker only, empty body
  ]
  assert.equal(extractScriptValue(entries, DEEPSEEK_ORIGIN, 'userToken'), null)
})

test('extractScriptValue returns null for mismatched scriptKey', () => {
  const key = fullKey(DEEPSEEK_ORIGIN, 'otherKey')
  const entries: LogEntry[] = [{ key, value: valueWithMarker('not-token') }]
  assert.equal(extractScriptValue(entries, DEEPSEEK_ORIGIN, 'userToken'), null)
})

test('extractScriptValue picks last matching entry (newest wins)', () => {
  const key = fullKey(DEEPSEEK_ORIGIN, 'userToken')
  const entries: LogEntry[] = [
    { key, value: valueWithMarker('old-token') },
    { key, value: valueWithMarker('new-token') },
  ]
  assert.equal(extractScriptValue(entries, DEEPSEEK_ORIGIN, 'userToken'), 'new-token')
})