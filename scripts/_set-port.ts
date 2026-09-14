import { readFileSync, writeFileSync } from 'fs'
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
function encryptConf(text: string): Buffer {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, derivePassword(iv), iv)
  return Buffer.concat([iv, Buffer.from(':'), cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
}

const port = Number(process.argv[2] || 8082)
const store = JSON.parse(decryptConf(readFileSync(DATA_FILE)))
store.config = { ...store.config, proxyPort: port, autoStartProxy: true }
writeFileSync(DATA_FILE, encryptConf(JSON.stringify(store, undefined, '\t')))
console.log('proxyPort set to', port, '| accounts:', (store.accounts || []).length)
