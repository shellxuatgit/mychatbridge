/**
 * Core Gateway Module - Provider Registry
 * Maps providers to adapters using the existing `isXxxProvider` matching rules,
 * and provides the WebProviderRuntime bridge factory.
 *
 * The registry reuses the same static matchers the legacy `RequestForwarder`
 * uses, so a provider stays on its dedicated adapter exactly as before.
 */

import type { Account, Provider } from '../../store/types.ts'
import type { ChatCompletionRequest, ForwardResult } from '../types.ts'
import { ProviderAdapterBridge } from './providerAdapterBridge.ts'
import type { WebProviderRuntime } from './providerContract.ts'

/**
 * A registered adapter descriptor. `matches` mirrors the legacy forwarder
 * registry rules; `createBridge` builds a runtime for a provider+account pair.
 */
export interface ProviderAdapterDescriptor {
  /** Provider id this descriptor targets */
  name: string
  /** Match rule copied from the legacy adapter's static `isXxxProvider` */
  matches: (provider: Provider) => boolean
  /** Adapter factory taking (provider, account) */
  create: (provider: Provider, account: Account) => WebProviderRuntime
}

/** Forward-function descriptors for legacy adapters (one per provider). */
export interface LegacyForwardDescriptor {
  name: string
  matches: (provider: Provider) => boolean
  forward: (
    request: ChatCompletionRequest,
    account: Account,
    provider: Provider,
    actualModel: string,
    startTime: number
  ) => Promise<ForwardResult>
}

/**
 * Registry holding both descriptor kinds. The legacy forward functions are
 * registered by `RequestForwarder` at construction; pure adapter factories can
 * be registered here directly for providers that implement WebProviderRuntime.
 */
class ProviderRegistry {
  private readonly legacyForwards: LegacyForwardDescriptor[] = []
  private readonly directRuntimeFactories: ProviderAdapterDescriptor[] = []

  /** Register a legacy forward function (called by RequestForwarder). */
  registerLegacyForward(descriptor: LegacyForwardDescriptor): void {
    this.legacyForwards.push(descriptor)
  }

  /** Register a provider that implements WebProviderRuntime directly. */
  registerRuntimeFactory(descriptor: ProviderAdapterDescriptor): void {
    this.directRuntimeFactories.push(descriptor)
  }

  /**
   * Find the adapter descriptor for a provider: direct runtime factories win,
   * then legacy forward functions. Returns null when unknown so the legacy
   * generic axios path is used.
   */
  match(provider: Provider): { kind: 'direct' | 'legacy'; name: string } | null {
    const direct = this.directRuntimeFactories.find(d => d.matches(provider))
    if (direct) {
      return { kind: 'direct', name: direct.name }
    }
    const legacy = this.legacyForwards.find(d => d.matches(provider))
    if (legacy) {
      return { kind: 'legacy', name: legacy.name }
    }
    return null
  }

  /**
   * Build a WebProviderRuntime for a provider+account pair, preferrring the
   * dedicated adapter; falls back to a bridge over the legacy forward function.
   */
  createRuntime(provider: Provider, account: Account): WebProviderRuntime {
    const direct = this.directRuntimeFactories.find(d => d.matches(provider))
    if (direct) {
      return direct.create(provider, account)
    }
    const legacy = this.legacyForwards.find(d => d.matches(provider))
    if (legacy) {
      return new ProviderAdapterBridge({
        id: legacy.name,
        provider,
        account,
        forward: legacy.forward,
      })
    }
    // Unknown provider: bridge without a forward path; chat() will throw a
    // capability_not_supported error that the forwarder can map back to the
    // legacy generic axios path.
    return new ProviderAdapterBridge({
      id: provider.id,
      provider,
      account,
      forward: undefined,
    })
  }

  /** All registered adapter names (for diagnostics). */
  listAdapters(): string[] {
    return [
      ...this.directRuntimeFactories.map(d => d.name),
      ...this.legacyForwards.map(d => d.name),
    ]
  }
}

export const providerRegistry = new ProviderRegistry()
export default providerRegistry