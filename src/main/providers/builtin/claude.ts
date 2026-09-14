import type { BuiltinProviderConfig } from '../../store/types'

/**
 * Claude web provider.
 * Requests are routed through the managed Playwright browser
 * (`ClaudeBrowserAdapter`), which drives the live claude.ai UI and parses the
 * `/completion` SSE stream (model slug + token usage).
 */
export const claudeConfig: BuiltinProviderConfig = {
  id: 'claude',
  name: 'Claude',
  type: 'builtin',
  authType: 'userToken',
  apiEndpoint: 'https://claude.ai/api',
  chatPath: '/chat-completions',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://claude.ai',
    'Referer': 'https://claude.ai/',
  },
  enabled: true,
  description: 'Claude web assistant via managed browser profile',
  supportedModels: [
    'claude-sonnet-4.5-web',
    'claude-opus-4.5-web',
  ],
  modelMappings: {
    'claude-sonnet-4.5-web': 'claude-sonnet-4-5',
    'claude-opus-4.5-web': 'claude-opus-4-5',
  },
  credentialFields: [
    {
      name: 'token',
      label: 'Session Token',
      type: 'textarea',
      required: false,
      placeholder: 'Click "Auto fetch" to log in via browser',
      helpText: 'Authentication is managed via the browser profile. Click "Auto fetch" to log in.',
    },
  ],
  logoUrl: 'https://www.anthropic.com/images/brand-guidelines/anthropic-logomark.svg',
}

export default claudeConfig