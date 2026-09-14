export type CredentialSink = 'web-session' | 'token'

export interface CredentialSourceConfig {
  providerId: string
  kind: 'cookies' | 'localStorage'
  domains: string[]
  requiredCookies?: string[]
  tokenKey?: string
  sink: CredentialSink
  storageKey: string
  accountName: string
  /**
   * For `sink: 'token'`: the cookie holding the credential, and the credential
   * field name the provider adapter reads it from. Each provider stores its
   * token under a different cookie name (glm → chatglm_refresh_token, kimi →
   * kimi-auth, …), so this cannot be inferred from the sink alone.
   */
  tokenCookie?: string
  tokenField?: string
  /**
   * For `sink: 'web-session'`: the primary session cookie and the credential
   * field name the adapter reads it from (perplexity → sessionToken).
   */
  sessionCookie?: string
  sessionField?: string
  /** Companion credential fields, mapped field name → cookie name. */
  extraFields?: Record<string, string>
  /** Persist the full cookie jar as a JSON object under `credentials.cookies`. */
  includeCookies?: boolean
  loginUrl?: string
  loginSuccess?: {
    cookie?: string
    urlPattern?: string
  }
  loginChannel?: 'chrome' | 'msedge' | 'auto'
  loginTimeoutMs?: number
}

export const CREDENTIAL_SOURCES: Record<string, CredentialSourceConfig> = {
  chatgpt: {
    providerId: 'chatgpt',
    kind: 'cookies',
    domains: ['chatgpt.com', 'openai.com'],
    requiredCookies: ['__Secure-next-auth.session-token'],
    sink: 'web-session',
    storageKey: 'chatgpt',
    accountName: 'ChatGPT',
    loginUrl: 'https://chatgpt.com/',
    loginSuccess: {
      cookie: '__Secure-next-auth.session-token',
      urlPattern: 'https://chatgpt.com/?**',
    },
    loginChannel: 'auto',
  },
  'chatgpt-web': {
    providerId: 'chatgpt-web',
    kind: 'cookies',
    domains: ['chatgpt.com', 'openai.com'],
    requiredCookies: ['__Secure-next-auth.session-token'],
    sink: 'web-session',
    storageKey: 'chatgpt',
    accountName: 'ChatGPT',
    loginUrl: 'https://chatgpt.com/',
    loginSuccess: {
      cookie: '__Secure-next-auth.session-token',
      urlPattern: 'https://chatgpt.com/?**',
    },
    loginChannel: 'auto',
  },
  'doubao-web': {
    providerId: 'doubao-web',
    kind: 'cookies',
    domains: ['doubao.com'],
    requiredCookies: ['sessionid'],
    sink: 'web-session',
    storageKey: 'doubao',
    accountName: 'Doubao',
    loginUrl: 'https://www.doubao.com/chat/',
    loginSuccess: { cookie: 'sessionid' },
    loginChannel: 'auto',
  },
  deepseek: {
    providerId: 'deepseek',
    kind: 'cookies',
    domains: ['chat.deepseek.com'],
    requiredCookies: ['authorization'],
    sink: 'token',
    tokenCookie: 'authorization',
    tokenField: 'token',
    storageKey: 'deepseek',
    accountName: 'DeepSeek',
    loginUrl: 'https://chat.deepseek.com/',
    loginSuccess: { cookie: 'authorization' },
    loginChannel: 'auto',
  },
  gemini: {
    providerId: 'gemini',
    kind: 'cookies',
    domains: ['gemini.google.com', 'accounts.google.com'],
    requiredCookies: ['__Secure-1PSID'],
    sink: 'web-session',
    sessionCookie: '__Secure-1PSID',
    sessionField: 'token',
    includeCookies: true,
    storageKey: 'gemini',
    accountName: 'Gemini',
    loginUrl: 'https://gemini.google.com/app',
    loginSuccess: { cookie: '__Secure-1PSID', urlPattern: 'https://gemini.google.com/app**' },
    loginChannel: 'auto',
  },
  claude: {
    providerId: 'claude',
    kind: 'cookies',
    domains: ['claude.ai'],
    requiredCookies: ['sessionKey'],
    sink: 'web-session',
    sessionCookie: 'sessionKey',
    sessionField: 'token',
    extraFields: { cookie: 'sessionKey' },
    includeCookies: true,
    storageKey: 'claude',
    accountName: 'Claude',
    loginUrl: 'https://claude.ai/login',
    loginSuccess: { cookie: 'sessionKey' },
    loginChannel: 'auto',
  },
  glm: {
    providerId: 'glm',
    kind: 'cookies',
    domains: ['chatglm.cn'],
    sink: 'token',
    tokenCookie: 'chatglm_refresh_token',
    tokenField: 'refresh_token',
    storageKey: 'glm',
    accountName: 'GLM',
    loginUrl: 'https://chatglm.cn/',
    loginSuccess: { cookie: 'chatglm_refresh_token', urlPattern: 'https://chatglm.cn/**' },
    loginChannel: 'auto',
  },
  kimi: {
    providerId: 'kimi',
    kind: 'cookies',
    domains: ['kimi.com', 'moonshot.cn'],
    sink: 'token',
    tokenCookie: 'kimi-auth',
    tokenField: 'token',
    storageKey: 'kimi',
    accountName: 'Kimi',
    loginUrl: 'https://www.kimi.com/',
    loginSuccess: { cookie: 'kimi-auth', urlPattern: 'https://www.kimi.com/**' },
    loginChannel: 'auto',
  },
  minimax: {
    providerId: 'minimax',
    kind: 'cookies',
    domains: ['minimaxi.com'],
    sink: 'token',
    tokenCookie: 'token',
    tokenField: 'token',
    extraFields: { realUserID: 'realUserID' },
    storageKey: 'minimax',
    accountName: 'MiniMax',
    loginUrl: 'https://agent.minimaxi.com/chat',
    loginSuccess: { cookie: 'token', urlPattern: 'https://agent.minimaxi.com/chat**' },
    loginChannel: 'auto',
  },
  qwen: {
    providerId: 'qwen',
    kind: 'cookies',
    domains: ['qianwen.com', 'tongyi.com'],
    sink: 'token',
    tokenCookie: 'tongyi_sso_ticket',
    tokenField: 'ticket',
    storageKey: 'qwen',
    accountName: 'Qwen',
    loginUrl: 'https://chat2.qianwen.com/',
    loginSuccess: { cookie: 'tongyi_sso_ticket', urlPattern: 'https://chat2.qianwen.com/**' },
    loginChannel: 'auto',
  },
  'qwen-ai': {
    providerId: 'qwen-ai',
    kind: 'cookies',
    domains: ['chat.qwen.ai'],
    sink: 'token',
    tokenCookie: 'token',
    tokenField: 'token',
    includeCookies: true,
    storageKey: 'qwen-ai',
    accountName: 'Qwen AI',
    loginUrl: 'https://chat.qwen.ai/',
    loginSuccess: { cookie: 'token', urlPattern: 'https://chat.qwen.ai/**' },
    loginChannel: 'auto',
  },
  zai: {
    providerId: 'zai',
    kind: 'cookies',
    domains: ['chat.z.ai', 'z.ai'],
    sink: 'token',
    tokenCookie: 'token',
    tokenField: 'token',
    storageKey: 'zai',
    accountName: 'Z.ai',
    loginUrl: 'https://chat.z.ai/',
    loginSuccess: { cookie: 'token', urlPattern: 'https://chat.z.ai/**' },
    loginChannel: 'auto',
  },
  mimo: {
    providerId: 'mimo',
    kind: 'cookies',
    domains: ['aistudio.xiaomimimo.com'],
    sink: 'web-session',
    sessionCookie: 'serviceToken',
    sessionField: 'service_token',
    extraFields: { user_id: 'userId', ph_token: 'xiaomichatbot_ph' },
    includeCookies: true,
    storageKey: 'mimo',
    accountName: 'Mimo',
    loginUrl: 'https://aistudio.xiaomimimo.com/',
    loginSuccess: { cookie: 'serviceToken', urlPattern: 'https://aistudio.xiaomimimo.com/**' },
    loginChannel: 'auto',
  },
  perplexity: {
    providerId: 'perplexity',
    kind: 'cookies',
    domains: ['perplexity.ai'],
    requiredCookies: ['__Secure-next-auth.session-token'],
    sink: 'web-session',
    sessionCookie: '__Secure-next-auth.session-token',
    sessionField: 'sessionToken',
    includeCookies: true,
    storageKey: 'perplexity',
    accountName: 'Perplexity',
    loginUrl: 'https://www.perplexity.ai/',
    loginSuccess: { cookie: '__Secure-next-auth.session-token' },
    loginChannel: 'auto',
  },
  yuanbao: {
    providerId: 'yuanbao',
    kind: 'cookies',
    domains: ['yuanbao.tencent.com'],
    sink: 'web-session',
    sessionCookie: 'hy_user',
    sessionField: 'token',
    extraFields: { cookie: 'hy_user' },
    includeCookies: true,
    storageKey: 'yuanbao',
    accountName: 'Yuanbao',
    loginUrl: 'https://yuanbao.tencent.com/chat',
    loginSuccess: { cookie: 'hy_user', urlPattern: 'https://yuanbao.tencent.com/chat**' },
    loginChannel: 'auto',
  },
}

export function getCredentialSource(providerId: string): CredentialSourceConfig | undefined {
  return CREDENTIAL_SOURCES[providerId]
}

export const DEEPSEEK_ORIGIN = 'https://chat.deepseek.com'

export interface SessionPayload {
  providerId: string
  credentials: Record<string, string>
  accountName: string
}

function findCookieValue(
  cookies: Array<Record<string, unknown>>,
  name: string
): string | undefined {
  const value = cookies.find((cookie) => cookie.name === name)?.value
  return typeof value === 'string' && value ? value : undefined
}

export function cookiesToPayload(
  cookies: Array<Record<string, unknown>>,
  source: CredentialSourceConfig | undefined
): SessionPayload | null {
  if (!source) return null

  if (source.providerId === 'chatgpt' || source.providerId === 'chatgpt-web') {
    // 1) Find the primary session token cookie (__Secure-next-auth.session-token)
    // ChatGPT slices tokens exceeding 4KB into chunked cookies (.0, .1, etc.)
    const chunkPrefix = '__Secure-next-auth.session-token.'
    const chunkCookies = cookies
      .filter((c) => typeof c.name === 'string' && c.name.startsWith(chunkPrefix) && typeof c.value === 'string')
      .sort((a, b) => {
        const idxA = parseInt((a.name as string).slice(chunkPrefix.length), 10) || 0
        const idxB = parseInt((b.name as string).slice(chunkPrefix.length), 10) || 0
        return idxA - idxB
      })

    let sessionCookie: string | undefined
    if (chunkCookies.length > 0) {
      sessionCookie = chunkCookies.map((c) => c.value).join('')
    } else {
      sessionCookie = cookies.find((c) =>
        c.name === '__Secure-next-auth.session-token' ||
        c.name === '__Host-next-auth.csrf-token' ||
        (typeof c.name === 'string' && /session-token|auth-token/i.test(c.name))
      )?.value as string | undefined
    }

    // Must have at least a session cookie to be considered authenticated
    if (!sessionCookie) return null

    // 2) Build full cookie header string from all chatgpt/openai cookies
    const cookiePairs = cookies
      .filter((c) => typeof c.name === 'string' && typeof c.value === 'string' && c.name && c.value)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    if (!cookiePairs) return null

    return {
      providerId: 'chatgpt',
      accountName: source.accountName,
      credentials: {
        cookie: cookiePairs,
        sessionToken: sessionCookie,
      },
    }
  }

  if (source.sink === 'token') {
    if (!source.tokenCookie || !source.tokenField) return null

    const raw = cookies.find((cookie) => cookie.name === source.tokenCookie)?.value
    if (typeof raw !== 'string' || !raw) return null

    // DeepSeek stores `Bearer <jwt>` in the authorization cookie; every other
    // provider stores the bare token.
    const token = raw.startsWith('Bearer ') ? raw.replace(/^Bearer\s+/i, '').trim() : raw
    if (!token) return null

    const credentials: Record<string, string> = { [source.tokenField]: token }

    // Some providers need companion values from other cookies (mimo: user_id,
    // ph_token). Fill those in when the cookie is present.
    for (const [field, cookieName] of Object.entries(source.extraFields ?? {})) {
      const value = findCookieValue(cookies, cookieName)
      if (value) credentials[field] = value
    }

    return {
      providerId: source.storageKey,
      accountName: source.accountName,
      credentials,
    }
  }

  if (source.sink === 'web-session') {
    const credentials: Record<string, string> = {}

    if (source.sessionCookie && source.sessionField) {
      const value = findCookieValue(cookies, source.sessionCookie)
      if (value) credentials[source.sessionField] = value
    }

    for (const [field, cookieName] of Object.entries(source.extraFields ?? {})) {
      const value = findCookieValue(cookies, cookieName)
      if (value) credentials[field] = value
    }

    if (source.includeCookies) {
      credentials.cookies = JSON.stringify(cookies)
    }

    // A web-session provider is only usable once we have at least one real
    // credential — never return a payload built purely from cookie metadata.
    if (Object.keys(credentials).length === 0) return null

    return {
      providerId: source.storageKey,
      accountName: source.accountName,
      credentials,
    }
  }

  return null
}
