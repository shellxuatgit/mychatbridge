export type WebProviderNextAction = 'connect' | 'none'

/**
 * Web providers require browser authentication rather than a credential form.
 * Returning this decision from a pure helper keeps the Add Provider flow
 * testable without rendering Electron UI.
 */
export function getBuiltinProviderNextAction(provider: { type?: string }): WebProviderNextAction {
  return provider.type === 'web' ? 'connect' : 'none'
}
