import { getVarint, snappyUncompress } from './snappy.ts'
import type { LogEntry } from './leveldbLog.ts'

const TRAILER_LEN = 5
const FOOTER_LEN = 48
const FOOTER_HANDLE_AREA_LEN = 40
const FOOTER_MAGIC = '57fb808b247547db'

interface BlockHandle {
  offset: number
  size: number
}

interface RawEntry {
  key: Buffer
  value: Buffer
}

function decodeBlockHandle(buf: Buffer, pos: number): { handle: BlockHandle; next: number } | null {
  if (pos < 0 || pos >= buf.length) return null
  const offset = getVarint(buf, pos)
  if (offset.next <= pos || offset.next > buf.length) return null
  const size = getVarint(buf, offset.next)
  if (size.next <= offset.next || size.next > buf.length) return null
  return { handle: { offset: offset.value, size: size.value }, next: size.next }
}

function readBlock(buf: Buffer, handle: BlockHandle): Buffer | null {
  const end = handle.offset + handle.size
  if (handle.offset < 0 || handle.size < 0 || end < handle.offset || end + TRAILER_LEN > buf.length) return null
  const payload = buf.subarray(handle.offset, end)
  const compression = buf[end]
  if (compression === 0) return Buffer.from(payload)
  if (compression !== 1) return null

  const length = getVarint(payload, 0)
  if (length.next <= 0 || length.next > payload.length) return null
  try {
    const result = snappyUncompress(payload.subarray(length.next))
    return result.length === length.value ? result : null
  } catch {
    return null
  }
}

function parseBlockEntries(block: Buffer): RawEntry[] {
  if (block.length < 4) return []
  const restartCount = block.readUInt32LE(block.length - 4)
  const restartBytes = restartCount * 4
  if (restartCount === 0 || restartBytes > block.length - 4) return []
  const entriesEnd = block.length - 4 - restartBytes
  const out: RawEntry[] = []
  let pos = 0
  let lastKey = Buffer.alloc(0)

  while (pos < entriesEnd) {
    const shared = getVarint(block, pos)
    if (shared.next <= pos) break
    pos = shared.next
    const nonShared = getVarint(block, pos)
    if (nonShared.next <= pos) break
    pos = nonShared.next
    const valueLength = getVarint(block, pos)
    if (valueLength.next <= pos) break
    pos = valueLength.next
    if (shared.value > lastKey.length || pos + nonShared.value + valueLength.value > entriesEnd) break

    const key = Buffer.concat([
      lastKey.subarray(0, shared.value),
      block.subarray(pos, pos + nonShared.value),
    ])
    pos += nonShared.value
    const value = Buffer.from(block.subarray(pos, pos + valueLength.value))
    pos += valueLength.value
    lastKey = key
    out.push({ key, value })
  }

  return out
}

function readFooterHandles(buf: Buffer): { metaindex: BlockHandle; index: BlockHandle } | null {
  if (buf.length < FOOTER_LEN) return null
  const footerStart = buf.length - FOOTER_LEN
  if (buf.subarray(footerStart + FOOTER_HANDLE_AREA_LEN).toString('hex') !== FOOTER_MAGIC) return null

  const metaindex = decodeBlockHandle(buf, footerStart)
  if (!metaindex) return null
  const index = decodeBlockHandle(buf, metaindex.next)
  if (!index) return null
  if (index.next > footerStart + FOOTER_HANDLE_AREA_LEN) return null
  return { metaindex: metaindex.handle, index: index.handle }
}

export function parseSstEntries(buf: Buffer): LogEntry[] {
  const handles = readFooterHandles(buf)
  if (!handles) return []
  const indexBlock = readBlock(buf, handles.index)
  if (!indexBlock) return []

  const out: LogEntry[] = []
  for (const indexEntry of parseBlockEntries(indexBlock)) {
    const dataHandle = decodeBlockHandle(indexEntry.value, 0)
    if (!dataHandle) continue
    const dataBlock = readBlock(buf, dataHandle.handle)
    if (!dataBlock) continue
    for (const entry of parseBlockEntries(dataBlock)) {
      if (entry.key.length < 8 || entry.key[entry.key.length - 1] !== 1) continue
      out.push({
        key: Buffer.from(entry.key.subarray(0, entry.key.length - 8)),
        value: entry.value,
      })
    }
  }
  return out
}
