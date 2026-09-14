import type { Account, Provider } from '../../store/types'

/**
 * WebBridgeAdapter - routes a `type: 'web'` provider chat request to the
 * WebLLM browser sidecar via `browser.invoke` (JSON-RPC `sendMessage`), then
 * normalises the sidecar reply into the OpenAI chat.completion shape.
 *
 * The sidecar's normalized response is `{ content, finishReason }` — see the
 * Task 2/3 protocol notes. No HTTP endpoint is involved (web providers have an
 * empty apiEndpoint).
 *
 * Requests are wrapped in `ReliabilityManager.withRetry` (Task 6) so that
 * transient page / context / auth failures are automatically recovered.
 */
export class WebBridgeAdapter {
  private provider: Provider
  private account: Account
  private runtime: any
  /** Lazily-initialised reliability wrapper; created on first chatCompletion. */
  private reliabilityMgr: any = null

  constructor(provider: Provider, account: Account, runtime: any) {
    this.provider = provider
    this.account = account
    this.runtime = runtime
  }

  /**
   * Lazily obtain the ReliabilityManager for this adapter's runtime.
   * Uses dynamic import to avoid circular dependencies.
   */
  private async getReliabilityManager(): Promise<any> {
    if (this.reliabilityMgr) return this.reliabilityMgr
    const { ReliabilityManager } = await import('../../webRuntime/reliability.ts')
    this.reliabilityMgr = new ReliabilityManager({ runtime: this.runtime })
    return this.reliabilityMgr
  }

  async chatCompletion(req: {
    model: string
    messages: Array<{ role: string; content: string }>
  }): Promise<{ content: string; finishReason: string }> {
    const last = req.messages[req.messages.length - 1]
    const providerId = this.provider.id.replace(/-web$/, '')
    const mgr = await this.getReliabilityManager()

    const res = (await mgr.withRetry(this.account.id, async () => {
      return this.runtime.request('browser.invoke', {
        provider: providerId,
        action: 'sendMessage',
        account_id: this.account.id,
        params: { message: typeof last?.content === 'string' ? last.content : '', conversation_id: null },
      })
    })) as { content: string; finishReason: string }
    return { content: res.content ?? '', finishReason: res.finishReason ?? 'stop' }
  }
}
