/**
 * Storage Migration — legacy ~/.chat2api → ~/.mychatbridge
 *
 * Pure helper (no electron / no homedir dependency) so it can be unit
 * tested with temp directories. The encryption key is intentionally kept
 * stable across the rename (see store.ts getEncryptionKey) so copied data
 * stays decryptable.
 */

import { existsSync, cpSync } from 'fs'

export interface MigrationResult {
  migrated: boolean
  reason: 'legacy_missing' | 'target_exists' | 'copied' | 'failed'
}

/**
 * Copy legacy storage into the new location once.
 *
 * No-op when the legacy directory does not exist (fresh install) or when
 * the new directory already exists (already-migrated install). The legacy
 * directory is preserved as a backup and never deleted.
 */
export function migrateLegacyStorage(
  legacyDir: string,
  newDir: string,
): MigrationResult {
  if (!existsSync(legacyDir)) {
    return { migrated: false, reason: 'legacy_missing' }
  }
  if (existsSync(newDir)) {
    return { migrated: false, reason: 'target_exists' }
  }

  try {
    cpSync(legacyDir, newDir, { recursive: true, force: false })
    return { migrated: true, reason: 'copied' }
  } catch (error) {
    console.error('[Store] Storage migration failed:', error)
    return { migrated: false, reason: 'failed' }
  }
}
