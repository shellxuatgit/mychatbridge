import test from 'node:test'
import assert from 'node:assert/strict'
import { snappyUncompress, getVarint } from '../../src/main/webRuntime/snappy.ts'

function encLiteral(s: string | Buffer): Buffer {
  const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')
  const h = Buffer.from([(b.length - 1) << 2])
  return Buffer.concat([h, b])
}
function encCopy1(offset: number, length: number): Buffer {
  // copy1: length in [4,11], offset in [1, 2047]
  const tag = ((length - 4) << 2) | 0x01 | (((offset >> 8) & 0x07) << 5)
  return Buffer.from([tag, offset & 0xff])
}
function encCopy2(offset: number, length: number): Buffer {
  // copy2: length in [1,64], offset in [1, 65535]
  const tag = ((length - 1) << 2) | 0x02
  return Buffer.from([tag, offset & 0xff, offset >> 8])
}
function encCopy4(offset: number, length: number): Buffer {
  // copy4: length in [1,64], offset in [1, 2^32-1]
  const tag = ((length - 1) << 2) | 0x03
  return Buffer.from([tag, offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff, (offset >> 24) & 0xff])
}

test('snappyUncompress: literal-only payload', () => {
  assert.equal(snappyUncompress(encLiteral('hello')).toString(), 'hello')
})

test('snappyUncompress: copy1 restores a repeated run', () => {
  const block = 'ab'
  const src = Buffer.concat([encLiteral(block), encCopy1(2, 4)])
  assert.equal(snappyUncompress(src).toString(), 'ababab')
})

test('snappyUncompress: copy2 overlapping (self-referential run)', () => {
  // 输出 'a' 后,从 offset 1 拷贝 3 字节 → 'aaaa'
  const src = Buffer.concat([encLiteral('a'), encCopy2(1, 3)])
  assert.equal(snappyUncompress(src).toString(), 'aaaa')
})

test('snappyUncompress: literal with UTF-16LE buffer', () => {
  const utf16 = Buffer.from('hello', 'utf16le')
  const src = encLiteral(utf16)
  assert.deepEqual(snappyUncompress(src), utf16)
})

test('snappyUncompress: copy4 with 4-byte offset', () => {
  // literal 'x' + copy4 offset=1 length=2 → 'x' + 'xx' = 'xxx'
  const src = Buffer.concat([encLiteral('x'), encCopy4(1, 2)])
  assert.equal(snappyUncompress(src).toString(), 'xxx')
})

test('snappyUncompress: varint helper works', () => {
  // 310 = 0x136 -> LEB128: 0xB6 (54|0x80), 0x02
  const buf = Buffer.from([0xB6, 0x02])
  const { value, next } = getVarint(buf, 0)
  assert.equal(value, 310)
  assert.equal(next, 2)
})

test('snappyUncompress: throws on malformed literal overrun', () => {
  // tag=0xF8 (rel=62 >= 60 -> 4-byte length), then length=3, but only 1 byte follows
  const src = Buffer.from([0xF8, 0x03, 0x00, 0x00, 0x00, 0x61])
  assert.throws(() => snappyUncompress(src), /snappy: literal overruns input/)
})