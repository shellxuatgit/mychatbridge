export const START_AUTO_CONNECT_PROVIDERS = ['chatgpt', 'chatgpt-web', 'doubao-web', 'deepseek']

export type AutoConnectUiPhase = 'idle' | 'checking' | 'opened' | 'success' | 'error'

export function isAutoConnectProvider(providerId: string): boolean {
  return START_AUTO_CONNECT_PROVIDERS.includes(providerId)
}

export function nextAutoConnectUiPhase(
  current: AutoConnectUiPhase,
  result: { status: string; payload?: { providerId: string; credentials: Record<string, string>; accountName: string } }
): AutoConnectUiPhase {
  if (result.status === 'imported') return 'success'
  if (result.status === 'opened') return 'opened'
  if (result.status === 'unsupported') return 'error'
  return current
}
