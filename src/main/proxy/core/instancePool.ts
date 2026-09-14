/**
 * Core Gateway Module - Instance Pool
 * Builds and manages the set of routable GatewayInstances.
 *
 * The pool is STORE-AGNOSTIC: all store reads are injected through `PoolData`,
 * so strategies and candidate generation stay pure and unit-testable. The
 * proxy layer (loadbalancer) supplies the real store adapter.
 *
 * The pool replaces the legacy `LoadBalancer.getAvailableAccounts` candidate
 * generation: enabled providers × active accounts → GatewayInstance list,
 * filtered by model support, preferred provider, and required capabilities.
 */

import type { Account, AppConfig, EffectiveModel, Provider } from '../../store/types.ts'
import { supportsCapabilities } from './capabilities.ts'
import type { ProviderCapabilityKey } from './capabilities.ts'
import { createInstance, isInstanceRoutable, tickInstance } from './instance.ts'
import type { GatewayInstance } from './instance.ts'

/** Minimal store surface the pool reads from. */
export interface PoolData {
  getProviders(): Provider[]
  /** Accounts for a provider (decrypted credentials). */
  getAccounts(providerId: string): Account[]
  getEffectiveModels(providerId: string): EffectiveModel[]
  getConfig(): Pick<AppConfig, 'modelMappings'>
}

export interface CandidateOptions {
  /** Preferred provider id (from model mapping) */
  preferredProviderId?: string
  /** Preferred account id (from sticky session / mapping) */
  preferredAccountId?: string
  /** Required capabilities filter */
  capabilities?: Partial<Record<ProviderCapabilityKey, boolean>>
  /** Exclude instances currently in cooldown (failover semantics) */
  excludeCooldown?: boolean
  /** Runtime health override for an instance id (`providerId:accountId`) */
  healthOverride?: (instanceId: string) => 'HEALTHY' | 'DEGRADED' | 'COOLDOWN' | undefined
  /** Instance ids to exclude from this candidate set (used for rerouting) */
  excludeInstanceIds?: string[]
  /** Clock for health ticking (testability) */
  now?: () => number
}

/** A single routed candidate: an instance plus its provider-specific actual model. */
export interface RoutableCandidate {
  instance: GatewayInstance
  actualModel: string
}

/**
 * Check whether a provider supports a model, mirroring the legacy
 * LoadBalancer.providerSupportsModel semantics (effective models + global mappings).
 */
export function providerSupportsModel(data: PoolData, provider: Provider, model: string): boolean {
  const effectiveModels = data.getEffectiveModels(provider.id)
  if (effectiveModels.length === 0) {
    return true
  }

  const normalizedModel = model.toLowerCase()
  const supported = effectiveModels.some(m => {
    const normalizedSupported = m.displayName.toLowerCase()
    if (normalizedSupported.endsWith('*')) {
      return normalizedModel.startsWith(normalizedSupported.slice(0, -1))
    }
    return normalizedSupported === normalizedModel
  })

  if (supported) {
    return true
  }

  const globalMapping = data.getConfig().modelMappings[model]
  if (globalMapping) {
    if (globalMapping.preferredProviderId) {
      return globalMapping.preferredProviderId === provider.id
    }
    const actualModel = globalMapping.actualModel
    const normalizedActualModel = actualModel.toLowerCase()
    return effectiveModels.some(m => {
      const normalizedSupported = m.displayName.toLowerCase()
      if (normalizedSupported.endsWith('*')) {
        return normalizedActualModel.startsWith(normalizedSupported.slice(0, -1))
      }
      return normalizedSupported === normalizedActualModel
    })
  }

  return false
}

/** Map a requested model to the provider-specific actual model (legacy mapModel). */
export function mapModelForProvider(data: PoolData, provider: Provider, model: string): string {
  const effectiveModels = data.getEffectiveModels(provider.id)
  const effectiveModel = effectiveModels.find(m => m.displayName.toLowerCase() === model.toLowerCase())
  if (effectiveModel) {
    return effectiveModel.actualModelId
  }

  const mapping = data.getConfig().modelMappings[model]

  if (mapping && (!mapping.preferredProviderId || mapping.preferredProviderId === provider.id)) {
    const actualModel = mapping.actualModel
    const actualEffectiveModel = effectiveModels.find(m => m.displayName.toLowerCase() === actualModel.toLowerCase())
    if (actualEffectiveModel) {
      return actualEffectiveModel.actualModelId
    }
    return actualModel
  }

  return model
}

/**
 * Build all candidate instances for a request. This is the routing entry point
 * consumed by the router strategies. Returns instances with the actual model
 * already computed per provider.
 */
export function getCandidateInstances(
  data: PoolData,
  model: string,
  options: CandidateOptions = {}
): RoutableCandidate[] {
  const now = options.now ?? Date.now
  const providers = data.getProviders().filter(p => p.enabled)
  const candidates: RoutableCandidate[] = []

  for (const provider of providers) {
    if (options.preferredProviderId && provider.id !== options.preferredProviderId) {
      continue
    }

    if (!providerSupportsModel(data, provider, model)) {
      continue
    }

    if (!supportsCapabilities(provider, options.capabilities)) {
      continue
    }

    const accounts = data.getAccounts(provider.id).filter(a => {
      if (a.status !== 'active') {
        return false
      }
      if (a.dailyLimit && a.todayUsed && a.todayUsed >= a.dailyLimit) {
        return false
      }
      return true
    })

    for (const account of accounts) {
      if (options.preferredAccountId && account.id !== options.preferredAccountId) {
        continue
      }

      const instanceId = `${provider.id}:${account.id}`
      if (options.excludeInstanceIds?.includes(instanceId)) {
        continue
      }

      const instance = createInstance({ provider, account })

      // Runtime health override: apply the live circuit-breaker state when the
      // caller provides one (e.g. InstancePoolRuntime); otherwise use the
      // local tick logic and honor excludeCooldown.
      if (options.healthOverride) {
        const status = options.healthOverride(instanceId)
        if (status) {
          instance.health = {
            ...instance.health,
            status,
          }
        }
        if (options.excludeCooldown && !isInstanceRoutable(instance)) {
          continue
        }
      } else {
        const ticked = tickInstance(instance, now(), instanceHealthOptions())
        if (options.excludeCooldown && !isInstanceRoutable(ticked)) {
          continue
        }
        instance.health = ticked.health
      }

      candidates.push({
        instance,
        actualModel: mapModelForProvider(data, provider, model),
      })
    }
  }

  return candidates
}

/**
 * Instance options used by the pool (matches legacy FAIL_THRESHOLD/RECOVERY_TIME).
 */
function instanceHealthOptions() {
  return { failureThreshold: 3, recoveryTimeMs: 60000, degradedThreshold: 1 }
}

export { isInstanceRoutable, tickInstance }