import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLogEntries } from '../../src/main/webRuntime/leveldbLog.ts'

const BLOCK_SIZE = 32768
const K_FULL = 1, K_FIRST = 2, K_MIDDLE = 3, K_LAST = 4

function varint(n: number): Buffer {
  const out: number[] = []
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128) }
  out.push(n)
  return Buffer.from(out)
}
function uint64le(n: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}
function uint32le(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
function internalKey(userKey: Buffer, typeByte: number): Buffer {
  return Buffer.concat([userKey, Buffer.from([0,0,0,0,0,0,0,typeByte])])
}
function entryBytes(key: Buffer, value: Buffer): Buffer {
  return Buffer.concat([varint(0), varint(key.length), varint(value.length), key, value])
}
function recordBytes(entry: { key: Buffer; value: Buffer }, seq: number, type: number): Buffer {
  const list = entryBytes(entry.key, entry.value)
  const payload = Buffer.concat([uint64le(seq), uint32le(1), list])
  const head = Buffer.alloc(7)
  head.writeUInt16LE(payload.length, 4)
  head[6] = type
  return Buffer.concat([head, payload])
}
function recordPayload(entry: { key: Buffer; value: Buffer }, seq: number): Buffer {
  return Buffer.concat([uint64le(seq), uint32le(1), entryBytes(entry.key, entry.value)])
}
function blockBytes(...records: Buffer[]): Buffer {
  const buf = Buffer.alloc(BLOCK_SIZE)
  let pos = 0
  for (const r of records) {
    r.copy(buf, pos)
    pos += r.length
  }
  return buf
}
function headerFor(payloadLen: number, type: number): Buffer {
  const head = Buffer.alloc(7)
  head.writeUInt16LE(payloadLen, 4)
  head[6] = type
  return head
}

const DEEPSEEK_KEY = Buffer.concat([
  Buffer.from([0x5f]),
  Buffer.from('https://chat.deepseek.com', 'latin1'),
  Buffer.from([0x00]),
  Buffer.from([0x01]),
  Buffer.from('userToken', 'latin1'),
])

test('parseLogEntries returns stored key/value pairs', () => {
  const value = Buffer.concat([Buffer.from([0x01]), Buffer.from('sk-test-token', 'latin1')])
  const rec = recordBytes({ key: internalKey(DEEPSEEK_KEY, 1), value }, 5, K_FULL)
  const entries = parseLogEntries(blockBytes(rec))
  assert.equal(entries.length, 1)
  assert.ok(entries[0].key.equals(DEEPSEEK_KEY))
  assert.ok(entries[0].value.equals(value))
})

test('parseLogEntries reads multiple records in one block', () => {
  const rec1 = recordBytes({ key: internalKey(Buffer.from('_k1'), 1), value: Buffer.from('v1') }, 1, K_FULL)
  const rec2 = recordBytes({ key: internalKey(Buffer.from('_k2'), 1), value: Buffer.from('v2') }, 2, K_FULL)
  const entries = parseLogEntries(blockBytes(rec1, rec2))
  assert.equal(entries.length, 2)
  assert.ok(entries[0].key.equals(Buffer.from('_k1')))
  assert.ok(entries[1].key.equals(Buffer.from('_k2')))
})

test('parseLogEntries reconstructs a record split as first/last across blocks', () => {
  // Create a large enough value so payload > 100 bytes
  const largeValue = Buffer.from('x'.repeat(300), 'latin1')
  const entry = { key: internalKey(DEEPSEEK_KEY, 1), value: Buffer.concat([Buffer.from([0x01]), largeValue]) }
  const payload = recordPayload(entry, 42)
  const splitAt = 100
  const chunk1 = payload.subarray(0, splitAt)
  const chunk2 = payload.subarray(splitAt)

  // Block 0: FIRST fragment at offset 0
  const block1 = Buffer.alloc(BLOCK_SIZE)
  const head1 = headerFor(chunk1.length, K_FIRST)
  head1.copy(block1, 0)
  chunk1.copy(block1, 7)

  // Block 1: LAST fragment at offset 0 (start of block)
  const block2 = Buffer.alloc(BLOCK_SIZE)
  const head2 = headerFor(chunk2.length, K_LAST)
  head2.copy(block2, 0)
  chunk2.copy(block2, 7)

  const combined = Buffer.concat([block1, block2])
  const entries = parseLogEntries(combined)
  assert.equal(entries.length, 1)
  assert.ok(entries[0].key.equals(DEEPSEEK_KEY))
  assert.equal(entries[0].value[0], 0x01)
  assert.equal(entries[0].value.subarray(1).toString('latin1'), 'x'.repeat(300))
})

test('parseLogEntries handles first + middle + last across three blocks', () => {
  // Create a large enough payload
  const largeValue = Buffer.from('y'.repeat(300), 'latin1')
  const entry = { key: internalKey(Buffer.from('_tri'), 1), value: Buffer.concat([Buffer.from([0x01]), largeValue]) }
  const payload = recordPayload(entry, 99)
  const a = 50, b = 70
  const c = payload.length - a - b
  if (c <= 0) throw new Error('payload too small for triple split')

  // Block 0: FIRST
  const block1 = Buffer.alloc(BLOCK_SIZE)
  headerFor(a, K_FIRST).copy(block1, 0)
  payload.subarray(0, a).copy(block1, 7)

  // Block 1: MIDDLE at start of block
  const block2 = Buffer.alloc(BLOCK_SIZE)
  headerFor(b, K_MIDDLE).copy(block2, 0)
  payload.subarray(a, a + b).copy(block2, 7)

  // Block 2: LAST at start of block
  const block3 = Buffer.alloc(BLOCK_SIZE)
  headerFor(c, K_LAST).copy(block3, 0)
  payload.subarray(a + b).copy(block3, 7)

  const entries = parseLogEntries(Buffer.concat([block1, block2, block3]))
  assert.equal(entries.length, 1)
  assert.ok(entries[0].key.equals(Buffer.from('_tri')))
  assert.equal(entries[0].value[0], 0x01)
  assert.equal(entries[0].value.subarray(1).toString('latin1'), 'y'.repeat(300))
})

test('parseLogEntries skips truncated trailing record instead of throwing', () => {
  const rec = recordBytes({ key: internalKey(Buffer.from('A'), 1), value: Buffer.from('B') }, 1, K_FULL)
  const fullBlock = blockBytes(rec)
  const truncated = Buffer.concat([fullBlock.subarray(0, fullBlock.length - 20), Buffer.from([0xff, 0xff, 0xff])])
  const entries = parseLogEntries(truncated)
  assert.ok(Array.isArray(entries), 'should not throw on truncation')
})

test('parseLogEntries ignores deletion entries (internal type 0)', () => {
  const recDel = recordBytes({ key: internalKey(Buffer.from('_del'), 0), value: Buffer.from('val') }, 1, K_FULL)
  const recVal = recordBytes({ key: internalKey(Buffer.from('_val'), 1), value: Buffer.from('ok') }, 2, K_FULL)
  const entries = parseLogEntries(blockBytes(recDel, recVal))
  assert.equal(entries.length, 1)
  assert.ok(entries[0].key.equals(Buffer.from('_val')))
})

test('parseLogEntries ignores zero-padded blocks and VERSION keys that are not data keys', () => {
  const rec = recordBytes({ key: internalKey(Buffer.from('VERSION'), 1), value: Buffer.from('1') }, 0, K_FULL)
  const entries = parseLogEntries(blockBytes(rec))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key.toString('latin1'), 'VERSION')
})