/**
 * Core Gateway Module - Router Types
 * Defines the pluggable routing strategy contract.
 */

import type { Account, Provider } from '../../../store/types.ts'
import type { ProviderCapabilityKey } from '../capabilities.ts'
import type { GatewayInstance } from '../instance.ts'
import type { RoutableCandidate } from '../instancePool.ts'

/** Request context a strategy may use to pick an instance. */
export interface RouterContext {
  /** Requested (logical) model name */
  model: string
  /** Preferred provider id (model mapping / provider hint) */
  preferredProviderId?: string
  /** Preferred account id (sticky session / mapping) */
  preferredAccountId?: string
  /** Required capabilities filter */
  capabilities?: Partial<Record<ProviderCapabilityKey, boolean>>
}

/** Selection result: the chosen instance and its actual model. */
export interface RouteSelection {
  instance: GatewayInstance
  actualModel: string
  /** Strategy id that made the selection (for observability) */
  strategy: string
}

/** The pluggable routing strategy interface. */
export interface RoutingStrategy {
  /** Stable strategy id, e.g. 'round-robin' */
  readonly id: string
  /** Human-readable name */
  readonly name: string
  /**
   * Pick an instance from candidates.
   * Returns null when no candidate satisfies the context (e.g. all preferred).
   */
  select(candidates: RoutableCandidate[], context: RouterContext): RoutableCandidate | null
}

/** Legacy account selection view used by the thin loadbalancer wrapper. */
export interface AccountSelectionView {
  account: Account
  provider: Provider
  actualModel: string
}
