import { getVarint } from './snappy.ts'

export interface LogEntry {
  key: Buffer
  value: Buffer
}

const BLOCK_SIZE = 32768
const HEADER_LEN = 7 // crc(4) + length(2) + type(1)
const K_FULL = 1
const K_FIRST = 2
const K_MIDDLE = 3
const K_LAST = 4

export function parseLogEntries(buf: Buffer): LogEntry[] {
  const entries: LogEntry[] = []
  let pos = 0
  let pending: Buffer | null = null

  while (pos + HEADER_LEN <= buf.length) {
    const blockStart = Math.floor(pos / BLOCK_SIZE) * BLOCK_SIZE
    const blockEnd = Math.min(buf.length, blockStart + BLOCK_SIZE)

    if (pos + HEADER_LEN > blockEnd) {
      pos = blockEnd
      continue
    }

    const length = buf.readUInt16LE(pos + 4)
    const type = buf[pos + 6]

    if (length === 0 && type === 0) {
      pos = blockEnd
      continue
    }

    const payloadStart = pos + HEADER_LEN

    if (payloadStart + length > blockEnd) {
      break
    }

    const chunk = buf.subarray(payloadStart, payloadStart + length)

    if (type === K_FULL) {
      // Complete record in one fragment
      for (const e of parseRecordPayload(chunk)) entries.push(e)
      pending = null
    } else if (type === K_FIRST) {
      // Start of a fragmented record — initialize pending with this chunk
      pending = Buffer.concat([Buffer.alloc(0), chunk])
    } else if (type === K_MIDDLE) {
      // Middle fragment — append to pending
      pending = pending ? Buffer.concat([pending, chunk]) : chunk
    } else if (type === K_LAST) {
      // Final fragment — append to pending and parse complete payload
      pending = pending ? Buffer.concat([pending, chunk]) : chunk
      if (pending) {
        for (const e of parseRecordPayload(pending)) entries.push(e)
        pending = null
      }
    }

    pos = payloadStart + length

    // After FIRST or MIDDLE, skip to next block boundary (fragments placed at block starts)
    if (type === K_FIRST || type === K_MIDDLE) {
      const currentBlockStart = Math.floor(pos / BLOCK_SIZE) * BLOCK_SIZE
      const currentBlockEnd = Math.min(buf.length, currentBlockStart + BLOCK_SIZE)
      if (pos < currentBlockEnd) pos = currentBlockEnd
    }
  }
  return entries
}

function parseRecordPayload(payload: Buffer): LogEntry[] {
  const out: LogEntry[] = []
  if (payload.length < 8) return out
  const countPos = 8
  if (countPos + 4 > payload.length) return out
  const count = payload.readUInt32LE(countPos)
  let pos = countPos + 4
  let fullKey = Buffer.alloc(0)

  for (let i = 0; i < count; i++) {
    if (pos >= payload.length) break
    const sv = getVarint(payload, pos); const shared = sv.value; pos = sv.next
    if (pos >= payload.length) break
    const nv = getVarint(payload, pos); const nonShared = nv.value; pos = nv.next
    if (pos >= payload.length) break
    const vv = getVarint(payload, pos); const valueLen = vv.value; pos = vv.next
    if (pos + shared + nonShared + valueLen > payload.length) break

    const keyPortion = Buffer.concat([
      fullKey.subarray(0, shared),
      payload.subarray(pos + shared, pos + shared + nonShared)
    ])
    const value = payload.subarray(pos + shared + nonShared, pos + shared + nonShared + valueLen)
    pos = pos + shared + nonShared + valueLen

    if (keyPortion.length < 8) continue
    const userKey = keyPortion.subarray(0, keyPortion.length - 8)
    const internalType = keyPortion[keyPortion.length - 1]
    fullKey = keyPortion
    if (internalType !== 1) continue // skip deletions (type 0)
    out.push({ key: Buffer.from(userKey), value: Buffer.from(value) })
  }
  return out
}