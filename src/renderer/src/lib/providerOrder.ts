import type { Provider } from '@/types/electron'

/** Overlay a persisted id order onto a provider list. */
export function applyProviderOrder(providers: Provider[], order?: string[] | null): Provider[] {
  if (!Array.isArray(order) || order.length === 0) return providers
  const byId = new Map(providers.map((p) => [p.id, p]))
  const ordered: Provider[] = []
  for (const id of order) {
    const provider = byId.get(id)
    if (provider) {
      ordered.push(provider)
      byId.delete(id)
    }
  }
  for (const provider of byId.values()) ordered.push(provider)
  return ordered
}

/** Move a provider to a new index within the list. */
export function moveProvider(providers: Provider[], fromId: string, toId: string): Provider[] {
  const fromIndex = providers.findIndex((p) => p.id === fromId)
  const toIndex = providers.findIndex((p) => p.id === toId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return providers
  const next = [...providers]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}