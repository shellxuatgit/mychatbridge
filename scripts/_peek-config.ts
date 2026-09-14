import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import crypto from 'crypto'

const DATA_FILE = join(homedir(), '.mychatbridge', 'data.json')
const ENCRYPTION_KEY = 'chat2api-fixed-encryption-key-v1'
const ALGORITHM = 'aes-256-cbc'

function derivePassword(iv: Buffer): Buffer {
  return crypto.pbkdf2Sync(ENCRYPTION_KEY, iv.toString(), 10_000, 32, 'sha512')
}
function decryptConf(buffer: Buffer): string {
  const iv = buffer.subarray(0, 16)
  const body = buffer.subarray(17)
  const decipher = crypto.createDecipheriv(ALGORITHM, derivePassword(iv), iv)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

const store = JSON.parse(decryptConf(readFileSync(DATA_FILE)))
const cfg = store.config || {}
console.log('config keys:', Object.keys(cfg).join(', '))
for (const key of ['proxy', 'localApi', 'server', 'managementApi', 'port', 'autoStart']) {
  if (cfg[key] !== undefined) console.log(`${key}:`, JSON.stringify(cfg[key]))
}
