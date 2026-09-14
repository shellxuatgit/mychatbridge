import type { BuiltinProviderConfig } from '../../store/types.ts'

export const chatgptWebConfig: BuiltinProviderConfig = {
  id: 'chatgpt-web',
  name: 'ChatGPT (Web)',
  type: 'web',
  authType: 'browser',
  apiEndpoint: '', // web provider 不走 HTTP endpoint
  chatPath: '',
  headers: {},
  enabled: true,
  description: 'ChatGPT via managed browser (Connect) or imported session',
  supportedModels: ['chatgpt-web'],
  modelMappings: { 'chatgpt-web': 'chatgpt-web' },
  credentialFields: [],
  logoUrl: 'https://cdn.openai.com/openai-logomark-primary.svg',
}

export default chatgptWebConfig
