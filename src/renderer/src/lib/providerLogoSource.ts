/**
 * Resolves which logo source the provider avatar should render.
 *
 * Priority: bundled local icon -> remote logoUrl -> initial letter.
 *
 * Local icons win because packaged builds must work offline and several remote
 * logoUrl values are unreliable: `cdn.openai.com/openai-logomark-primary.svg`
 * returns 404, and `www.perplexity.ai/favicon.ico` responds with
 * `Cross-Origin-Resource-Policy: same-origin`, which Chromium reports as
 * ERR_BLOCKED_BY_RESPONSE.NotSameOrigin.
 */

export type LogoSource = 'local' | 'network' | 'initial'

export interface ResolveLogoSourceInput {
  providerId: string
  logoUrl?: string
  netFailed: boolean
  hasLocalIcon: (providerId: string) => boolean
}

export function resolveLogoSource(input: ResolveLogoSourceInput): LogoSource {
  if (input.hasLocalIcon(input.providerId)) {
    return 'local'
  }
  if (input.logoUrl && !input.netFailed) {
    return 'network'
  }
  return 'initial'
}
