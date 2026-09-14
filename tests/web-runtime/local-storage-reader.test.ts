import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { LocalStorageReader } from '../../src/main/webRuntime/localStorageReader.ts'

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
function recordPayload(entry: { key: Buffer; value: Buffer }, seq: number): Buffer {
  return Buffer.concat([uint64le(seq), uint32le(1), entryBytes(entry.key, entry.value)])
}
function headerFor(payloadLen: number, type: number): Buffer {
  const h = Buffer.alloc(7)
  h.writeUInt16LE(payloadLen, 4)
  h[6] = type
  return h
}
function blockBytes(header: Buffer, payload: Buffer): Buffer {
  const buf = Buffer.alloc(BLOCK_SIZE)
  header.copy(buf, 0)
  payload.copy(buf, 7)
  return buf
}

const DEEPSEEK_KEY = Buffer.concat([
  Buffer.from([0x5f]),
  Buffer.from('https://chat.deepseek.com', 'latin1'),
  Buffer.from([0x00]),
  Buffer.from([0x01]),
  Buffer.from('userToken', 'latin1'),
])

function buildFixtureDir(tmp: string): string {
  const dir = path.join(tmp, 'Local Storage', 'leveldb')
  fs.mkdirSync(dir, { recursive: true })
  const tokenValue = Buffer.concat([Buffer.from([0x01]), Buffer.from('sk-deepseek-abc', 'latin1')])
  const entry = { key: internalKey(DEEPSEEK_KEY, 1), value: tokenValue }
  const payload = recordPayload(entry, 5)
  // 000005.log: single record split as FIRST fragment in block 0, LAST in block 1 (same file)
  const chunk1 = payload.subarray(0, 100)
  const chunk2 = payload.subarray(100)
  const log1 = blockBytes(headerFor(chunk1.length, 2), chunk1) // K_FIRST
  const log2 = blockBytes(headerFor(chunk2.length, 4), chunk2) // K_LAST
  fs.writeFileSync(path.join(dir, '000003.log'), Buffer.alloc(BLOCK_SIZE)) // noise/empty
  fs.writeFileSync(path.join(dir, '000005.log'), Buffer.concat([log1, log2]))
  fs.writeFileSync(path.join(dir, '000007.ldb'), Buffer.alloc(16)) // SST ignored
  return dir
}

test('findToken reads newest *.log and returns the token', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsr-'))
  const dir = buildFixtureDir(tmp)
  const reader = new LocalStorageReader({ browserPaths: () => ({ leveldbDir: dir }) })
  const token = await reader.findToken('chrome', 'userToken', 'chat.deepseek.com')
  assert.equal(token, 'sk-deepseek-abc')
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('findToken returns null for missing leveldb dir', async () => {
  const reader = new LocalStorageReader({ browserPaths: () => null })
  assert.equal(await reader.findToken('chrome', 'userToken', 'chat.deepseek.com'), null)
})

test('findToken returns null for non-existent dir', async () => {
  const reader = new LocalStorageReader({ browserPaths: () => ({ leveldbDir: '/nonexistent/path' }) })
  assert.equal(await reader.findToken('chrome', 'userToken', 'chat.deepseek.com'), null)
})