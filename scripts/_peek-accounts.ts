import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import crypto from 'crypto'

const DATA_FILE = process.argv[3] || join(homedir(), '.mychatbridge', 'data.json')
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
const accounts = store.accounts || []
for (const a of accounts) {
  const credKeys = Object.keys(a.credentials || {})
  const lens = credKeys.map((k) => `${k}=${String(a.credentials[k]).length}`).join(', ')
  console.log(`${a.providerId.padEnd(14)} id=${a.id} status=${a.status} creds: ${lens}`)
}

const target = process.argv[2]
if (target) {
  const acct = accounts.find((a) => a.providerId === target)
  if (acct) {
    const key = Object.keys(acct.credentials)[0]
    console.log(`\n${target} ${key} = ${String(acct.credentials[key]).slice(0, 60)}...`)
  }
}
