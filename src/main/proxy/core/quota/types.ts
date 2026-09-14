/**
 * Core Gateway Module - Quota & Rate Limit Types
 * Config + result shapes for the multi-dimensional quota / rate-limit layer.
 */

import type { QuotaConfig } from '../../../store/types.ts'

export type { QuotaConfig }

/** Quota dimensions the layer can enforce. */
export type QuotaDimension =
  | 'apiKey'
  | 'account'
  | 'provider'
  | 'ip'
  | 'rpm'
  | 'concurrency'

/** A quota that was exceeded (used for observability and error detail). */
export interface QuotaExceeded {
  dimension: QuotaDimension
  limit: number
  used: number
  scope: string
}

/** Outcome of a quota check. */
export interface QuotaCheckResult {
  allowed: boolean
  /** List of exceeded quotas (empty when allowed) */
  exceeded: QuotaExceeded[]
  /** Remaining capacity of the most restrictive dimension */
  remaining: number
}

/** Identity/scope extracted from a request for quota enforcement. */
export interface QuotaScope {
  apiKeyId?: string
  apiKeyName?: string
  accountId?: string
  providerId?: string
  clientIp?: string
}

export interface QuotaLimits {
  rpmPerApiKey: number
  rpdPerApiKey: number
  concurrencyPerApiKey: number
  rpdPerAccount: number
  rpdPerProvider: number
  rpdPerIp: number
}

/** Resolve effective limits from config (0 = unlimited). */
export function limitsFromConfig(config: QuotaConfig): QuotaLimits {
  return {
    rpmPerApiKey: config.rpmPerApiKey || 0,
    rpdPerApiKey: config.rpdPerApiKey || 0,
    concurrencyPerApiKey: config.concurrencyPerApiKey || 0,
    rpdPerAccount: config.rpdPerAccount || 0,
    rpdPerProvider: config.rpdPerProvider || 0,
    rpdPerIp: config.rpdPerIp || 0,
  }
}
