/**
 * Claude Adapter - Scaffold
 *
 * Placeholder that always returns `capability_not_supported`. The Claude web
 * protocol (session/login API + SSO tokens) is not implemented yet; this
 * skeleton keeps the provider visible in the UI and forwards errors clearly
 * until the real adapter lands.
 */

import type { Account, Provider } from '../../store/types'
import type { ChatCompletionRequest } from '../types'
import { WebProviderError } from '../core/providerContract.ts'

export class ClaudeAdapter {
  private provider: Provider
  private account: Account

  constructor(provider: Provider, account: Account) {
    this.provider = provider
    this.account = account
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<never> {
    void request
    throw WebProviderError.capabilityUnsupported(
      `Claude web adapter is not implemented yet (provider: ${this.provider.id}, account: ${this.account.id})`
    )
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    void sessionId
    return false
  }

  static isClaudeProvider(provider: Provider): boolean {
    return provider.id === 'claude' || provider.apiEndpoint.includes('claude.ai')
  }
}

export const claudeAdapter = { ClaudeAdapter }
export default ClaudeAdapter