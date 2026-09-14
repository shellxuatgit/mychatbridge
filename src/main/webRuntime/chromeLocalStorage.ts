import type { LogEntry } from './leveldbLog.ts'

const DATA_PREFIX = 0x5f // '_'
const SEP = 0x00

export interface ScriptEntry {
  key: Buffer
  value: Buffer
}

function decodeValue(v: Buffer): string | null {
  if (v.length < 1) return null
  const marker = v[0]
  const body = v.subarray(1)
  if (marker === 0x01) return body.toString('latin1')
  if (marker === 0x00 && body.length % 2 === 0) return body.toString('utf16le')
  return null
}

/**
 * Find the script value for a given origin + scriptKey inside localStorage
 * LevelDB entries. Each data key is `"_" + origin + \x00 + scriptKey` where
 * both origin-part and scriptKey are raw bytes; the scriptKey portion and the
 * value both carry a 1-byte type-prefix (0x00=UTF-16LE, 0x01=Latin-1).
 */
export function extractScriptValue(entries: ScriptEntry[], origin: string, scriptKey: string): string | null {
  let found: string | null = null
  for (const e of entries) {
    const k = e.key
    if (k.length === 0 || k[0] !== DATA_PREFIX) continue
    const sep = k.indexOf(SEP)
    if (sep < 0) continue
    const entryOrigin = k.subarray(1, sep).toString('latin1')
    if (!entryOrigin.includes(origin)) continue
    const sk = decodeValue(k.subarray(sep + 1))
    if (sk !== scriptKey) continue
    const val = decodeValue(e.value)
    if (val) found = val // last match wins (newest)
  }
  return found
}