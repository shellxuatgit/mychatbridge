/* eslint-disable @typescript-eslint/no-require-imports */
const { app, safeStorage } = require('electron')
const { readFileSync } = require('fs')
const { join } = require('path')
const { homedir } = require('os')
const crypto = require('crypto')

const DATA_FILE = join(homedir(), '.mychatbridge', 'data.json')
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

function tryDecrypt(value) {
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch (e) {
    return `<ERR ${e && e.message ? e.message : e}> raw=${String(value).slice(0, 40)}...`
  }
}

app.whenReady().then(() => {
  console.log('safeStorage available:', safeStorage.isEncryptionAvailable())
  const store = JSON.parse(decryptConf(readFileSync(DATA_FILE)))
  const provider = process.argv[2]
  const accounts = (store.accounts || []).filter((a) => !provider || a.providerId === provider)
  for (const a of accounts) {
    console.log(`\n=== ${a.providerId} (${a.id}) ===`)
    for (const [k, v] of Object.entries(a.credentials || {})) {
      const plain = tryDecrypt(String(v))
      console.log(`${k}: len=${plain.length} preview=${plain.slice(0, 80)}`)
    }
  }
  app.quit()
})
