import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

import { CookieImporter } from '../../src/main/webRuntime/cookieImporter.ts'
import {
  createCookieDbFixture,
  openCookieDbReadonly,
  unixMsToChromeEpoch,
} from './sqlite-fixture.ts'

// ---------------------------------------------------------------------------
// Helper: encrypt a plaintext using Chrome v10 format with a given key
// ---------------------------------------------------------------------------

function chromeV10Encrypt(key: Buffer, plaintext: string): Buffer {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from('v10'), nonce, encrypted, authTag])
}

// ---------------------------------------------------------------------------
// Helper: create a real SQLite cookie DB file on disk
// ---------------------------------------------------------------------------

function createRealCookieDb(dbPath: string, rows: Array<Record<string, unknown>>): void {
  createCookieDbFixture(dbPath, rows as never)
}

// ---------------------------------------------------------------------------
// Helper: create mock Local State JSON file on disk
// ---------------------------------------------------------------------------

function createLocalState(tmpDir: string, key: Buffer) {
  const localState = {
    os_crypt: {
      encrypted_key: key.toString('base64'),
    },
  }
  const lsPath = path.join(tmpDir, 'Local State')
  fs.writeFileSync(lsPath, JSON.stringify(localState))
  return lsPath
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('scan: returns chatgpt cookies, filters expired, decrypts correctly', async () => {
  // Setup temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-test-'))
  const dbPath = path.join(tmpDir, 'Cookies')

  // The "decrypted" AES key that mockDecrypt will return (32 bytes)
  const aesKey = crypto.randomBytes(32)

  const now = Date.now()

  // Encrypt cookie values using the AES key so aesGcmDecrypt can decrypt them
  const testRows = [
    {
      host_key: '.chatgpt.com',
      name: '__Secure-next-auth.session-token',
      path: '/',
      encrypted_value: chromeV10Encrypt(aesKey, 'session-token-abc'),
      expires_utc: unixMsToChromeEpoch(now + 86400000), // valid (1 day from now)
    },
    {
      host_key: 'chatgpt.com',
      name: '_puid',
      path: '/',
      encrypted_value: chromeV10Encrypt(aesKey, 'puid-xyz'),
      expires_utc: unixMsToChromeEpoch(now + 86400000),
    },
    {
      host_key: '.chatgpt.com',
      name: 'expired-token',
      path: '/',
      encrypted_value: chromeV10Encrypt(aesKey, 'expired-val'),
      expires_utc: unixMsToChromeEpoch(now - 86400000), // expired (1 day ago)
    },
    {
      host_key: '.doubao.com',
      name: 'sessionid',
      path: '/',
      encrypted_value: chromeV10Encrypt(aesKey, 'doubao-val'),
      expires_utc: unixMsToChromeEpoch(now + 86400000),
    },
  ]

  // Create real SQLite file so existsSync + copyFileSync pass
  createRealCookieDb(dbPath, testRows)
  const lsPath = createLocalState(tmpDir, aesKey)

  // Mock decrypt: return the AES key (simulates DPAPI decryption of the os_crypt key)
  const mockDecrypt = (_encrypted: Buffer): Buffer => aesKey

  // Mock dbOpen: open the real file read-only through the test SQLite helper
  const mockDbOpen = (p: string) => {
    return openCookieDbReadonly(p)
  }

  const importer = new CookieImporter({
    decrypt: mockDecrypt,
    dbOpen: mockDbOpen,
  })

  // Override browserPaths to return our test paths
  importer.browserPaths = () => ({
    localState: lsPath,
    cookiesDb: dbPath,
  })

  // Run scan
  const results = await importer.scan('chrome')

  // Assertions
  assert.ok(results.length > 0, 'should return results')

  // Find chatgpt results
  const chatgptResult = results.find(r => r.provider === 'chatgpt')
  assert.ok(chatgptResult, 'should have chatgpt provider')

  // Should have 2 valid cookies (1 expired filtered out)
  assert.equal(chatgptResult.cookies.length, 2, 'should have 2 valid chatgpt cookies')

  // Verify cookie names
  const cookieNames = chatgptResult.cookies.map(c => c.name as string)
  assert.ok(cookieNames.includes('__Secure-next-auth.session-token'))
  assert.ok(cookieNames.includes('_puid'))
  assert.ok(!cookieNames.includes('expired-token'), 'expired cookie should be filtered')

  // Verify decryption was applied (values should match original plaintext)
  const tokenCookie = chatgptResult.cookies.find(c => c.name === '__Secure-next-auth.session-token')
  assert.equal(tokenCookie.value, 'session-token-abc', 'cookie value should be decrypted')
  const puidCookie = chatgptResult.cookies.find(c => c.name === '_puid')
  assert.equal(puidCookie.value, 'puid-xyz', 'cookie value should be decrypted')

  // Find doubao results
  const doubaoResult = results.find(r => r.provider === 'doubao')
  assert.ok(doubaoResult, 'should have doubao provider')
  assert.equal(doubaoResult.cookies.length, 1, 'should have 1 valid doubao cookie')
  assert.equal(doubaoResult.cookies[0].value, 'doubao-val', 'doubao cookie should be decrypted')

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('scan: returns empty array when browser paths do not exist', async () => {
  const importer = new CookieImporter({
    decrypt: () => Buffer.from('plain'),
    dbOpen: () => null,
  })

  importer.browserPaths = () => ({
    localState: '/nonexistent/Local State',
    cookiesDb: '/nonexistent/Cookies',
  })

  const results = await importer.scan('chrome')
  assert.deepEqual(results, [])
})

test('importSession: creates session file with correct structure', async () => {
  const homeDir = os.homedir()
  const profilesDir = path.join(homeDir, '.mychatbridge', 'web-runtime', 'profiles')

  const mockCookies = [
    { name: 'session-token', value: 'test-value', domain: '.chatgpt.com', path: '/' },
    { name: '_puid', value: 'test-puid', domain: 'chatgpt.com', path: '/' },
  ]

  const importer = new CookieImporter({
    decrypt: () => Buffer.from('plain'),
    dbOpen: () => null,
  })

  const result = await importer.importSession('chatgpt', mockCookies)

  // Assertions
  assert.ok(result.accountId.startsWith('web-chatgpt-imported-'), 'accountId should have correct format')
  assert.equal(result.providerId, 'chatgpt')
  assert.deepEqual(result.cookies, mockCookies)

  // Verify file was created
  const sessionPath = path.join(profilesDir, `${result.accountId}.json`)
  assert.ok(fs.existsSync(sessionPath), 'session file should exist')

  // Read and verify content
  const content = fs.readFileSync(sessionPath, 'utf8')
  const sessionData = JSON.parse(content)

  assert.equal(sessionData.accountId, result.accountId)
  assert.equal(sessionData.providerId, 'chatgpt')
  assert.deepEqual(sessionData.cookies, mockCookies)
  assert.ok(sessionData.createdAt > 0, 'should have createdAt timestamp')
  assert.ok(sessionData.lastValidatedAt > 0, 'should have lastValidatedAt timestamp')

  // Cleanup
  fs.rmSync(sessionPath, { force: true })
})

test('importSession: creates session for doubao', async () => {
  const mockCookies = [
    { name: 'doubao-session', value: 'doubao-value', domain: '.doubao.com', path: '/' },
  ]

  const importer = new CookieImporter()
  const result = await importer.importSession('doubao', mockCookies)

  assert.ok(result.accountId.startsWith('web-doubao-imported-'))
  assert.equal(result.providerId, 'doubao')
  assert.deepEqual(result.cookies, mockCookies)

  // Cleanup
  const homeDir = os.homedir()
  const sessionPath = path.join(homeDir, '.mychatbridge', 'web-runtime', 'profiles', `${result.accountId}.json`)
  fs.rmSync(sessionPath, { force: true })
})

test('aesGcmDecrypt: correctly decrypts v10 encrypted data', async () => {
  const key = crypto.randomBytes(32)
  const nonce = crypto.randomBytes(12)
  const plaintext = Buffer.from('Hello, World!')

  // Encrypt using AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Construct Chrome v10 format: 'v10' + nonce + ciphertext + authTag
  const chromeEncrypted = Buffer.concat([
    Buffer.from('v10'),
    nonce,
    encrypted,
    authTag,
  ])

  const importer = new CookieImporter()
  const result = (importer as any).aesGcmDecrypt(key, chromeEncrypted)
  assert.deepEqual(result, plaintext, 'should decrypt v10 correctly')
})

test('aesGcmDecrypt: correctly decrypts v11 encrypted data', async () => {
  const key = crypto.randomBytes(32)
  const nonce = crypto.randomBytes(12)
  const plaintext = Buffer.from('v11 test payload')

  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  const chromeEncrypted = Buffer.concat([
    Buffer.from('v11'),
    nonce,
    encrypted,
    authTag,
  ])

  const importer = new CookieImporter()
  const result = (importer as any).aesGcmDecrypt(key, chromeEncrypted)
  assert.deepEqual(result, plaintext, 'should decrypt v11 correctly')
})

test('scan uses registry domains and filters out providers missing required cookies', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-reg-'))
  const dbPath = path.join(tmpDir, 'Cookies')
  const aesKey = crypto.randomBytes(32)
  const now = Date.now()

  const testRows = [
    // chatgpt: 只有部分必需 cookie → 应整组丢弃
    { host_key: '.chatgpt.com', name: '_puid', path: '/', encrypted_value: chromeV10Encrypt(aesKey, 'puid-x'), expires_utc: unixMsToChromeEpoch(now + 86400000) },
    // doubao: 必需 cookie 齐 → 保留
    { host_key: '.doubao.com', name: 'sessionid', path: '/', encrypted_value: chromeV10Encrypt(aesKey, 'doubao-sess'), expires_utc: unixMsToChromeEpoch(now + 86400000) },
  ]
  createRealCookieDb(dbPath, testRows)
  const lsPath = createLocalState(tmpDir, aesKey)

  const importer = new CookieImporter({ decrypt: () => aesKey, dbOpen: (p) => openCookieDbReadonly(p) })
  importer.browserPaths = () => ({ localState: lsPath, cookiesDb: dbPath })

  const results = await importer.scan('chrome')
  assert.ok(!results.find((r) => r.provider === 'chatgpt'), 'chatgpt group dropped when required cookie missing')
  const doubao = results.find((r) => r.provider === 'doubao')
  assert.ok(doubao, 'doubao group kept')
  assert.equal(doubao!.cookies.length, 1)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('importSession accepts any providerId from CREDENTIAL_SOURCES', async () => {
  const importer = new CookieImporter()
  const result = await importer.importSession('doubao-web', [
    { name: 'sessionid', value: 's1', domain: '.doubao.com', path: '/' },
  ])
  assert.equal(result.providerId, 'doubao-web')
  assert.ok(result.accountId.startsWith('web-doubao-web-imported-'))
  const homeDir = os.homedir()
  const sessionPath = path.join(homeDir, '.mychatbridge', 'web-runtime', 'profiles', `${result.accountId}.json`)
  fs.rmSync(sessionPath, { force: true })
})

test('hasSession returns true only when every required cookie for some provider is present', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-has-'))
  const dbPath = path.join(tmpDir, 'Cookies')
  const aesKey = crypto.randomBytes(32)
  const now = Date.now()
  createRealCookieDb(dbPath, [
    { host_key: '.doubao.com', name: 'sessionid', path: '/', encrypted_value: chromeV10Encrypt(aesKey, 's'), expires_utc: unixMsToChromeEpoch(now + 86400000) },
  ])
  const lsPath = createLocalState(tmpDir, aesKey)
  const importer = new CookieImporter({ decrypt: () => aesKey, dbOpen: (p) => openCookieDbReadonly(p) })
  importer.browserPaths = () => ({ localState: lsPath, cookiesDb: dbPath })
  assert.equal(await importer.hasSession('chrome'), true)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})