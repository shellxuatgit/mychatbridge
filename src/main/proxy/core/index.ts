/**
 * Core Gateway Module - Public Exports
 * Single entry point for the gateway abstractions.
 */

export * from './providerContract.ts'
export * from './capabilities.ts'
export * from './instance.ts'
export * from './instancePool.ts'
export * from './providerRegistry.ts'
export * from './router/types.ts'
export { router, Router } from './router/index.ts'
export { RoundRobinStrategy } from './router/strategies/roundRobin.ts'
export { FillFirstStrategy } from './router/strategies/fillFirst.ts'
export { FailoverStrategy } from './router/strategies/failover.ts'
export { WeightedStrategy } from './router/strategies/weighted.ts'
