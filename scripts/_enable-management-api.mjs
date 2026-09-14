/**
 * Enable the Management API and (re)use a stable secret, so external scripts
 * can create accounts over HTTP.
 *
 *   node scripts/_enable-management-api.mjs
 *
 * Writes ~/.mychatbridge/data.json using the same Conf framing the app uses, so
 * the running app picks the change up on its next getConfig() (Conf re-reads the
 * file on every access — no restart needed).
 *
 * The secret is stored at $HOME/.mychatbridge/management-secret.txt (0600) for
 * later scripts; it is never printed here.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import crypto from 'crypto'

const STORAGE_DIR = join(homedir(), '.mychatbridge')
const DATA_FILE = join(STORAGE_DIR, 'data.json')
const SECRET_FILE = join(STORAGE_DIR, 'management-secret.txt')
const ENCRYPTION_KEY = 'chat2api-fixed-encryption-key-v1'
const ALGORITHM = 'aes-256-cbc'

function derivePassword(iv) {
  return crypto.pbkdf2Sync(ENCRYPTION_KEY, iv.toString(), 10_000, 32, 'sha512')
}

function decryptConf(buffer) {
  const iv = buffer.subarray(0, 16)
  const body = buffer.subarray(17)
  const decipher = crypto.createDecipheriv(ALGORITHM, derivePassword(iv), iv)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

function encryptConf(text) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, derivePassword(iv), iv)
  return Buffer.concat([iv, Buffer.from(':'), cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
}

if (!existsSync(DATA_FILE)) {
  console.error('data.json not found at ' + DATA_FILE)
  process.exit(1)
}

const raw = readFileSync(DATA_FILE)
const store = JSON.parse(decryptConf(raw))
console.log('decrypted data.json — top-level keys:', Object.keys(store).join(', '))

const config = store.config
if (!config) {
  console.error('no `config` key in store')
  process.exit(1)
}

const current = config.managementApi ?? {}
console.log('current managementApi:', JSON.stringify({
  enableManagementApi: current.enableManagementApi,
  hasSecret: Boolean(current.managementApiSecret),
}))

// Reuse an existing non-empty secret; otherwise mint a stable one.
let secret = current.managementApiSecret
if (secret) {
  console.log('reusing the existing secret from data.json')
} else if (existsSync(SECRET_FILE)) {
  secret = readFileSync(SECRET_FILE, 'utf8').trim()
  console.log('reusing the previously generated secret file')
} else {
  secret = 'mgmt_' + crypto.randomUUID()
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 })
  console.log('generated a new secret and saved it to ' + SECRET_FILE)
}

config.managementApi = { ...current, enableManagementApi: true, managementApiSecret: secret }

// Preserve the exact serialization Conf uses (tab-indented JSON).
const serialized = JSON.stringify(store, undefined, '\t')
writeFileSync(DATA_FILE, encryptConf(serialized))
console.log('wrote data.json — managementApi.enableManagementApi = true')

const check = JSON.parse(decryptConf(readFileSync(DATA_FILE)))
console.log('verify round-trip: enabled =', check.config.managementApi.enableManagementApi)
