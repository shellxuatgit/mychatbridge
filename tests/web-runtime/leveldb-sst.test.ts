import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSstEntries } from '../../src/main/webRuntime/leveldbSst.ts'

function varint(value: number): Buffer {
  const bytes: number[] = []
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80)
    value = Math.floor(value / 128)
  }
  bytes.push(value)
  return Buffer.from(bytes)
}

function blockEntry(key: Buffer, value: Buffer): Buffer {
  return Buffer.concat([varint(0), varint(key.length), varint(value.length), key, value])
}

function blockPayload(entries: Buffer[]): Buffer {
  const body = Buffer.concat(entries)
  return Buffer.concat([body, Buffer.alloc(4), Buffer.from([1, 0, 0, 0])])
}

function handle(offset: number, size: number): Buffer {
  return Buffer.concat([varint(offset), varint(size)])
}

function snappyLiteral(payload: Buffer): Buffer {
  let lengthTag: Buffer
  if (payload.length < 60) {
    lengthTag = Buffer.from([(payload.length - 1) << 2])
  } else if (payload.length < 256) {
    lengthTag = Buffer.from([60 << 2, payload.length - 1])
  } else if (payload.length < 65536) {
    const n = payload.length - 1
    lengthTag = Buffer.from([61 << 2, n & 0xff, (n >> 8) & 0xff])
  } else {
    throw new Error('fixture literal too large')
  }
  return Buffer.concat([varint(payload.length), lengthTag, payload])
}

function buildSst(compressed: boolean): Buffer {
  const userKey = Buffer.concat([
    Buffer.from('_https://chat.deepseek.com\x00\x01userToken', 'latin1'),
    Buffer.alloc(8),
  ])
  userKey[userKey.length - 1] = 1
  const value = Buffer.from([1, ...Buffer.from('sk-sst-token', 'latin1')])
  const dataPayload = blockPayload([blockEntry(userKey, value)])
  const dataStored = compressed ? snappyLiteral(dataPayload) : dataPayload
  const dataBlock = Buffer.concat([dataStored, Buffer.from([compressed ? 1 : 0, 0, 0, 0, 0])])

  const dataOffset = 0
  const metaPayload = Buffer.concat([Buffer.alloc(4), Buffer.from([1, 0, 0, 0])])
  const metaOffset = dataBlock.length
  const metaBlock = Buffer.concat([metaPayload, Buffer.from([0, 0, 0, 0, 0])])

  const indexEntry = blockEntry(Buffer.from([0xff]), handle(dataOffset, dataStored.length))
  const indexPayload = blockPayload([indexEntry])
  const indexOffset = metaOffset + metaBlock.length
  const indexBlock = Buffer.concat([indexPayload, Buffer.from([0, 0, 0, 0, 0])])

  const footerHandles = Buffer.concat([
    handle(metaOffset, metaPayload.length),
    handle(indexOffset, indexPayload.length),
  ])
  const footer = Buffer.concat([
    footerHandles,
    Buffer.alloc(40 - footerHandles.length),
    Buffer.from('57fb808b247547db', 'hex'),
  ])
  return Buffer.concat([dataBlock, metaBlock, indexBlock, footer])
}

test('parseSstEntries reads compact-footer uncompressed SST data', () => {
  const entries = parseSstEntries(buildSst(false))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key.toString('latin1'), '_https://chat.deepseek.com\x00\x01userToken')
  assert.equal(entries[0].value.toString('latin1'), '\x01sk-sst-token')
})

test('parseSstEntries reads Snappy-compressed SST data with length header', () => {
  const entries = parseSstEntries(buildSst(true))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key.toString('latin1'), '_https://chat.deepseek.com\x00\x01userToken')
  assert.equal(entries[0].value.toString('latin1'), '\x01sk-sst-token')
})

test('parseSstEntries ignores deletion records', () => {
  const key = Buffer.concat([Buffer.from('_deleted', 'latin1'), Buffer.alloc(7), Buffer.from([0])])
  const dataPayload = blockPayload([blockEntry(key, Buffer.from('value'))])
  const dataBlock = Buffer.concat([dataPayload, Buffer.alloc(5)])
  const metaPayload = Buffer.concat([Buffer.alloc(4), Buffer.from([1, 0, 0, 0])])
  const metaBlock = Buffer.concat([metaPayload, Buffer.alloc(5)])
  const indexPayload = blockPayload([blockEntry(Buffer.from([0xff]), handle(0, dataPayload.length))])
  const indexBlock = Buffer.concat([indexPayload, Buffer.alloc(5)])
  const metaOffset = dataBlock.length
  const indexOffset = metaOffset + metaBlock.length
  const footerHandles = Buffer.concat([handle(metaOffset, metaPayload.length), handle(indexOffset, indexPayload.length)])
  const footer = Buffer.concat([footerHandles, Buffer.alloc(40 - footerHandles.length), Buffer.from('57fb808b247547db', 'hex')])
  assert.deepEqual(parseSstEntries(Buffer.concat([dataBlock, metaBlock, indexBlock, footer])), [])
})
