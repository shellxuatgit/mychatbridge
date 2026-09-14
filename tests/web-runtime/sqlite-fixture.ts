/**
 * Test helpers for building and opening real SQLite cookie databases.
 *
 * Uses Node's built-in `node:sqlite` (stable in Node 24) instead of the
 * better-sqlite3 native addon on purpose.
 *
 * Why: the app ships a better-sqlite3 binary rebuilt for Electron 33
 * (NODE_MODULE_VERSION 130, Node 20 / Node-API 9). That addon is ABI-locked, so
 * importing it under the system Node used by this test runner (ABI 137) fails.
 * Tests that only need "a real SQLite cookie DB" should therefore not depend on
 * the shipping driver. The driver itself is covered in the runtime that actually
 * loads it by tests/web-runtime/native-sqlite-runtime.test.ts.
 */

import { DatabaseSync } from 'node:sqlite'

export interface FixtureRow {
  host_key: string
  name: string
  path: string
  encrypted_value: Uint8Array
  expires_utc: number
}

const CHROME_EPOCH_OFFSET_US = 11644473600000000n

/** Convert a Unix millisecond timestamp to Chromium's 1601-based microseconds. */
export function unixMsToChromeEpoch(unixMs: number): number {
  return Number(BigInt(unixMs) * 1000n + CHROME_EPOCH_OFFSET_US)
}

/** Create a real on-disk SQLite file shaped like Chrome's Cookies database. */
export function createCookieDbFixture(dbPath: string, rows: FixtureRow[]): void {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE cookies (
      host_key TEXT,
      name TEXT,
      path TEXT,
      encrypted_value BLOB,
      expires_utc INTEGER
    )
  `)
  const insert = db.prepare(
    'INSERT INTO cookies (host_key, name, path, encrypted_value, expires_utc) VALUES (?, ?, ?, ?, ?)'
  )
  for (const row of rows) {
    insert.run(
      row.host_key,
      row.name,
      row.path,
      row.encrypted_value,
      // Chromium timestamps exceed Number.MAX_SAFE_INTEGER; node:sqlite requires
      // BigInt to bind them.
      BigInt(row.expires_utc)
    )
  }
  db.close()
}

/**
 * Open a cookie database read-only, matching the surface CookieImporter uses.
 *
 * node:sqlite returns out-of-range INTEGERs (like Chromium timestamps) as BigInt,
 * whereas the shipping driver yields plain numbers. Normalize BigInt back to
 * Number so the importer sees the same shapes it does in the app.
 */
export function openCookieDbReadonly(dbPath: string): {
  prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] }
  close: () => void
} {
  const db = new DatabaseSync(dbPath, { readOnly: true })

  const normalize = (rows: unknown[]): unknown[] =>
    rows.map((row) => {
      if (!row || typeof row !== 'object') return row
      const source = row as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(source)) {
        out[key] = typeof value === 'bigint' ? Number(value) : value
      }
      return out
    })

  return {
    prepare: (sql: string) => ({
      all: (...params: unknown[]) => {
        const statement = db.prepare(sql)
        // Chromium timestamps exceed Number.MAX_SAFE_INTEGER; without this the
        // driver throws ERR_OUT_OF_RANGE while materializing the row.
        statement.setReadBigInts(true)
        return normalize(statement.all(...(params as never[])))
      },
    }),
    close: () => db.close(),
  }
}
