import type { BuiltinProviderConfig } from '../../store/types'

export const chatgptConfig: BuiltinProviderConfig = {
  id: 'chatgpt',
  name: 'ChatGPT',
  type: 'builtin',
  authType: 'cookie',
  apiEndpoint: 'https://chatgpt.com/backend-api',
  chatPath: '/conversation',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': 'text/event-stream',
    'Content-Type': 'application/json',
    'Origin': 'https://chatgpt.com',
    'Referer': 'https://chatgpt.com/',
  },
  enabled: true,
  description: 'ChatGPT web backend API with automatic access token acquisition from a saved session cookie',
  supportedModels: [
    'chatgpt-auto',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
  ],
  modelMappings: {
    'chatgpt-auto': 'auto',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-4.1': 'gpt-4.1',
  },
  credentialFields: [
    {
      name: 'cookie',
      label: 'ChatGPT Cookie',
      type: 'textarea',
      required: true,
      placeholder: 'Paste the ChatGPT cookie string',
      helpText: 'The saved ChatGPT session cookie is exchanged automatically for an access token when this account is first used. The access token is kept in memory and refreshed on demand.',
    },
  ],
  tokenCheckEndpoint: '/api/auth/session',
  tokenCheckMethod: 'GET',
  logoUrl: 'https://cdn.openai.com/openai-logomark-primary.svg',
}

export default chatgptConfig
