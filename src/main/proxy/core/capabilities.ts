/**
 * Core Gateway Module - Capability Registry
 * Declares provider capability sets used for capability-aware routing.
 *
 * The registry is the single source of truth for known providers' capabilities.
 * `resolveCapabilities(provider)` is used by the adapter bridge and the
 * candidate-selection layer; unknown providers fall back to the contract
 * default derivation.
 */

import type { Provider } from '../../store/types.ts'
import { createDefaultCapabilities } from './providerContract.ts'
import type { WebProviderCapabilities } from './providerContract.ts'

export type { WebProviderCapabilities as ProviderCapabilities }
export type ProviderCapabilityKey = keyof WebProviderCapabilities

/**
 * Default capability sets for built-in providers.
 * Values are conservative: they reflect what the current adapters actually
 * support. Update when a provider adapter gains a capability.
 */
const DEFAULT_CAPABILITY_MAP: Record<string, WebProviderCapabilities> = {
  deepseek: {
    text: true,
    vision: false,
    reasoning: true,
    web_search: true,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  glm: {
    text: true,
    vision: false,
    reasoning: true,
    web_search: true,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  kimi: {
    text: true,
    vision: false,
    reasoning: true,
    web_search: true,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  minimax: {
    text: true,
    vision: false,
    reasoning: false,
    web_search: false,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  mimo: {
    text: true,
    vision: false,
    reasoning: false,
    web_search: false,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  perplexity: {
    text: true,
    vision: false,
    reasoning: false,
    web_search: true,
    tools: false,
    file: false,
    long_context: true,
    stream: true,
  },
  qwen: {
    text: true,
    vision: false,
    reasoning: true,
    web_search: true,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  'qwen-ai': {
    text: true,
    vision: false,
    reasoning: true,
    web_search: true,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  zai: {
    text: true,
    vision: false,
    reasoning: true,
    web_search: false,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
  // First-phase new providers
  chatgpt: {
    text: true,
    vision: true,
    reasoning: false,
    web_search: true,
    tools: true,
    file: true,
    long_context: true,
    stream: true,
  },
  claude: {
    text: true,
    vision: true,
    reasoning: true,
    web_search: false,
    tools: true,
    file: true,
    long_context: true,
    stream: true,
  },
  gemini: {
    text: true,
    vision: true,
    reasoning: true,
    web_search: true,
    tools: true,
    file: true,
    long_context: true,
    stream: true,
  },
  yuanbao: {
    text: true,
    vision: false,
    reasoning: false,
    web_search: false,
    tools: true,
    file: false,
    long_context: true,
    stream: true,
  },
}

const easyDeepClone = <T extends object>(value: T): T => ({ ...value })

/**
 * Get the capability map for a provider id. Returns undefined for unknown ids
 * so callers can fall back to contract default derivation.
 */
export function getProviderCapabilities(providerId: string): WebProviderCapabilities | undefined {
  const entry = DEFAULT_CAPABILITY_MAP[providerId]
  return entry ? easyDeepClone(entry) : undefined
}

/**
 * Resolve the effective capability set for a provider:
 * registry override wins, provider-level `capabilities` override merges on top,
 * otherwise contract default derivation.
 */
export function resolveCapabilities(provider: Provider): WebProviderCapabilities {
  const base = getProviderCapabilities(provider.id) ?? createDefaultCapabilities(provider)
  if (provider.capabilities) {
    return { ...base, ...provider.capabilities }
  }
  return base
}

/**
 * Check whether a provider satisfies all required capabilities.
 */
export function supportsCapabilities(
  provider: Provider,
  required?: Partial<Record<ProviderCapabilityKey, boolean>>
): boolean {
  if (!required) {
    return true
  }
  const caps = resolveCapabilities(provider)
  return Object.entries(required).every(([key, wanted]) => {
    if (!wanted) {
      return true
    }
    return Boolean(caps[key as ProviderCapabilityKey])
  })
}

/**
 * Storage-backed extension point for user/registry overrides (read-only for
 * now; wiring writes through the store is a later milestone).
 */
export interface CapabilityOverrides {
  [providerId: string]: Partial<WebProviderCapabilities>
}