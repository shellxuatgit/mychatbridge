export type PlaywrightLoginUiStatus = 'idle' | 'importing' | 'imported' | 'error'

export function shouldShowPlaywrightLoginButton(
  providerId: string,
  providersWithLogin: string[]
): boolean {
  return providersWithLogin.includes(providerId)
}

export function credentialsFromPayload(
  payload: { credentials: Record<string, string> } | null
): Record<string, string> {
  return payload ? { ...payload.credentials } : {}
}
