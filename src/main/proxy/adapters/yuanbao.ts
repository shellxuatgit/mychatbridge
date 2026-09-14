/**
 * Yuanbao Adapter - Scaffold
 *
 * Placeholder that always returns `capability_not_supported`. The Yuanbao web
 * protocol is not implemented yet; this skeleton keeps the provider visible in
 * the UI and forwards errors clearly until the real adapter lands.
 */

import type { Account, Provider } from '../../store/types'
import type { ChatCompletionRequest } from '../types'
import { WebProviderError } from '../core/providerContract.ts'

export class YuanbaoAdapter {
  private provider: Provider
  private account: Account

  constructor(provider: Provider, account: Account) {
    this.provider = provider
    this.account = account
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<never> {
    void request
    throw WebProviderError.capabilityUnsupported(
      `Yuanbao web adapter is not implemented yet (provider: ${this.provider.id}, account: ${this.account.id})`
    )
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    void sessionId
    return false
  }

  static isYuanbaoProvider(provider: Provider): boolean {
    return provider.id === 'yuanbao' || provider.apiEndpoint.includes('yuanbao.tencent.com')
  }
}

export const yuanbaoAdapter = { YuanbaoAdapter }
export default YuanbaoAdapter