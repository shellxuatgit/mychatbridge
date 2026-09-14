/**
 * Set config flags in ~/.mychatbridge/data.json (Conf framing) and preserve a
 * stable management secret. Also re-issues a local API key when requested.
 *
 *   npx tsx scripts/_set-flags.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import crypto from 'crypto'

const STORAGE_DIR = join(homedir(), '.mychatbridge')
const DATA_FILE = join(STORAGE_DIR, 'data.json')
const SECRET_FILE = join(STORAGE_DIR, 'management-secret.txt')
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

const store = JSON.parse(decryptConf(readFileSync(DATA_FILE)))
const secret = existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, 'utf8').trim() : 'mgmt_' + crypto.randomUUID()
writeFileSync(SECRET_FILE, secret, { mode: 0o600 })

store.config = {
  ...store.config,
  autoStartProxy: true,
  autoStart: true,
  managementApi: {
    ...(store.config.managementApi ?? {}),
    enableManagementApi: true,
    managementApiSecret: secret,
  },
}

writeFileSync(DATA_FILE, encryptConf(JSON.stringify(store, undefined, '\t')))
console.log('set autoStartProxy=true, autoStart=true, enableManagementApi=true')
console.log('secret:', secret)
console.log('existing apiKeys:', JSON.stringify((store.config.apiKeys || []).map((k: any) => ({ id: k.id, name: k.name, enabled: k.enabled }))))
