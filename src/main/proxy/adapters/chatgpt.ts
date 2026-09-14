/**
 * ChatGPT Adapter
 * Implements the ChatGPT web backend-api `/conversation` protocol over direct
 * HTTP. Authentication follows the same minimal on-demand pattern as the
 * other web-backed adapters: use a configured access token when available,
 * otherwise exchange the saved ChatGPT session cookie for an access token and
 * keep it in memory until it expires/gets rejected.
 *
 * The upstream response is an SSE stream of `data:` JSON records; parsing is
 * delegated to the pure `chatgpt/sse-parser.ts` module.
 */

import axios, { AxiosResponse } from 'axios'
import type { Account, Provider } from '../../store/types'
import type { ChatCompletionRequest } from '../types'
import { WebProviderError } from '../core/providerContract.ts'
import {
  ChatGptParseState,
  createChatGptParseState,
  parseChatGptChunk,
} from './chatgpt/sse-parser.ts'

const API_BASE = 'https://chatgpt.com/backend-api'
const SESSION_API = 'https://chatgpt.com/api/auth/session'
const ACCESS_TOKEN_EXPIRES = 30 * 60 * 1000

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

/** Minimal request shape accepted by the ChatGPT backend. */
export interface ChatGptUpstreamRequest {
  action: string
  messages: Array<{ id: string; role: string; content: { content_type: string; parts: string[] } }>
  model: string
  conversation_id?: string | null
  parent_message_id?: string | null
  stream: boolean
}

function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Build the ChatGPT-format conversation request from OpenAI messages. */
export function buildChatGptPayload(
  request: ChatCompletionRequest,
  conversationId?: string | null
): ChatGptUpstreamRequest {
  const messages = (request.messages || []).map(msg => {
    let parts: string[] = []
    if (typeof msg.content === 'string') {
      parts = [msg.content]
    } else if (Array.isArray(msg.content)) {
      parts = msg.content
        .filter(p => p?.type === 'text' && typeof p.text === 'string')
        .map((p: any) => p.text)
    }
    return {
      id: generateUuid(),
      role: msg.role,
      content: { content_type: 'text', parts },
    }
  })

  const model = request.model || 'auto'

  return {
    action: 'next',
    messages,
    model,
    conversation_id: conversationId ?? null,
    parent_message_id: null,
    stream: true,
  }
}

export class ChatGPTAdapter {
  private provider: Provider
  private account: Account
  private configuredToken: string
  private sessionCookie: string

  constructor(provider: Provider, account: Account) {
    this.provider = provider
    this.account = account
    const credentials = account.credentials
    this.configuredToken = credentials.accessToken || credentials.token || ''
    this.sessionCookie = this.getSessionCookie(credentials)
  }

  private getSessionCookie(credentials: Record<string, string>): string {
    if (credentials.cookie) return credentials.cookie
    if (credentials.cookies) return credentials.cookies
    if (credentials.sessionCookie) return credentials.sessionCookie
    if (credentials.sessionToken) {
      return `__Secure-next-auth.session-token=${credentials.sessionToken}`
    }
    return ''
  }

  private getCacheKey(): string {
    return this.configuredToken || this.sessionCookie || this.account.id
  }

  private invalidateToken(): void {
    tokenCache.delete(this.getCacheKey())
  }

  /**
   * Resolve an access token only when the first real request needs it.
   * Existing accessToken/token credentials continue to work without any
   * network request; cookie-based accounts exchange their session at runtime.
   */
  private async acquireToken(): Promise<string> {
    if (this.configuredToken) {
      return this.configuredToken
    }

    if (!this.sessionCookie) {
      throw WebProviderError.notLoggedIn(
        'ChatGPT credentials not configured; add accessToken or session cookie'
      )
    }

    const cacheKey = this.getCacheKey()
    const cached = tokenCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.accessToken
    }

    const response = await axios.get(SESSION_API, {
      headers: {
        Cookie: this.sessionCookie,
        Accept: 'application/json',
        Origin: 'https://chatgpt.com',
        Referer: 'https://chatgpt.com/',
      },
      timeout: 15000,
      validateStatus: () => true,
    })

    const accessToken = response.data?.accessToken
    if (response.status !== 200 || typeof accessToken !== 'string' || !accessToken) {
      throw WebProviderError.notLoggedIn(
        `ChatGPT session exchange failed (HTTP ${response.status})`
      )
    }

    tokenCache.set(cacheKey, {
      accessToken,
      expiresAt: Date.now() + ACCESS_TOKEN_EXPIRES,
    })

    return accessToken
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.acquireToken()
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Origin: 'https://chatgpt.com',
      Referer: 'https://chatgpt.com/',
    }
  }

  /**
   * Perform a chat completion against the ChatGPT backend.
   * A rejected access token is invalidated and re-acquired once when the
   * account is cookie-backed. This avoids an infinite retry loop.
   */
  async chatCompletion(request: ChatCompletionRequest): Promise<{
    response: AxiosResponse
    sessionId?: string
    conversationId?: string | null
  }> {
    const conversationId = (request as any).conversation_id ?? null
    const payload = buildChatGptPayload(request, conversationId)

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response: AxiosResponse = await axios.post(
          `${API_BASE}/conversation`,
          payload,
          {
            headers: await this.getAuthHeaders(),
            timeout: 120000,
            responseType: request.stream ? 'stream' : 'json',
            validateStatus: () => true,
          }
        )

        if (response.status === 401 || response.status === 403) {
          if (attempt === 0 && !this.configuredToken && this.sessionCookie) {
            this.invalidateToken()
            continue
          }
          throw WebProviderError.notLoggedIn(`ChatGPT auth failed (HTTP ${response.status})`)
        }
        if (response.status === 429) {
          throw WebProviderError.blocked('ChatGPT rate limited')
        }
        if (response.status >= 400) {
          throw WebProviderError.upstream(`ChatGPT upstream error (HTTP ${response.status})`, response.status)
        }

        return {
          response,
          sessionId: undefined,
          conversationId,
        }
      } catch (error) {
        if (error instanceof WebProviderError) {
          throw error
        }
        if (attempt === 0 && !this.configuredToken && this.sessionCookie) {
          this.invalidateToken()
          continue
        }
        throw WebProviderError.upstream(
          error instanceof Error ? error.message : 'ChatGPT request failed'
        )
      }
    }

    throw WebProviderError.notLoggedIn('ChatGPT authentication failed')
  }

  static isChatGptProvider(provider: Provider): boolean {
    return provider.id === 'chatgpt' || provider.apiEndpoint.includes('chatgpt.com')
  }
}

export const chatGptAdapter = { ChatGPTAdapter }