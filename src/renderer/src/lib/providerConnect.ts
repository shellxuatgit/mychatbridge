export const OAUTH_CAPABLE_PROVIDERS = [
  'deepseek',
  'glm',
  'kimi',
  'mimo',
  'minimax',
  'qwen',
  'qwen-ai',
  'zai',
  'perplexity',
]

export function isOAuthCapable(providerId: string): boolean {
  return OAUTH_CAPABLE_PROVIDERS.includes(providerId)
}

/**
 * Map in-app login (OAuth) credentials to the provider credential field names.
 * OAuth returns keys like 'chatglm_refresh_token' while providers expect
 * 'refresh_token'; DeepSeek stores its token as JSON.
 */
export function mapOAuthCredentials(
  providerId: string | undefined,
  credentials: Record<string, string>
): Record<string, string> {
  if (!providerId) return credentials

  const credentialKeyMap: Record<string, string> = {
    glm: 'chatglm_refresh_token',
    deepseek: 'userToken',
    qwen: 'tongyi_sso_ticket',
    'qwen-ai': 'tongyi_sso_ticket',
    zai: 'tongyi_sso_ticket',
    perplexity: '__Secure-next-auth.session-token',
    mimo: 'serviceToken',
  }

  const providerFieldNames: Record<string, string> = {
    glm: 'refresh_token',
    deepseek: 'token',
    qwen: 'ticket',
    'qwen-ai': 'ticket',
    zai: 'ticket',
    perplexity: 'sessionToken',
    mimo: 'service_token',
  }

  const oauthKey = credentialKeyMap[providerId]
  if (oauthKey && credentials[oauthKey]) {
    const fieldName = providerFieldNames[providerId]
    if (fieldName) {
      let tokenValue = credentials[oauthKey]
      if (
        providerId === 'deepseek' &&
        tokenValue.startsWith('{') &&
        tokenValue.endsWith('}')
      ) {
        try {
          const parsed = JSON.parse(tokenValue)
          if (parsed.value) tokenValue = parsed.value
        } catch (e) {
          console.error('[mapOAuthCredentials] Error parsing JSON token:', e)
        }
      }
      return { [fieldName]: tokenValue }
    }
  }

  if (providerId === 'perplexity' && credentials['__Secure-next-auth.session-token']) {
    return { sessionToken: credentials['__Secure-next-auth.session-token'] }
  }
  if (providerId === 'perplexity' && credentials['next-auth.session-token']) {
    return { sessionToken: credentials['next-auth.session-token'] }
  }

  if (providerId === 'mimo') {
    const result: Record<string, string> = {}
    if (credentials['service_token']) result['service_token'] = credentials['service_token']
    else if (credentials['serviceToken']) result['service_token'] = credentials['serviceToken']
    if (credentials['user_id']) result['user_id'] = credentials['user_id']
    else if (credentials['userId']) result['user_id'] = credentials['userId']
    if (credentials['ph_token']) result['ph_token'] = credentials['ph_token']
    else if (credentials['xiaomichatbot_ph']) result['ph_token'] = credentials['xiaomichatbot_ph']
    return result
  }

  return credentials
}