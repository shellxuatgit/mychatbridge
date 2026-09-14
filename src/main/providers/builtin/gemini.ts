import type { BuiltinProviderConfig } from '../../store/types'

/**
 * Gemini web provider scaffold.
 * NOTE: The Gemini adapter is not implemented yet; requests route to the
 * committed skeleton and return `capability_not_supported` until the adapter
 * lands. The config + credential fields are ready so users/UI can start.
 */
export const geminiConfig: BuiltinProviderConfig = {
  id: 'gemini',
  name: 'Gemini',
  type: 'builtin',
  authType: 'token',
  apiEndpoint: 'https://gemini.google.com',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://gemini.google.com',
    'Referer': 'https://gemini.google.com/',
  },
  enabled: true,
  description: 'Gemini web assistant via managed browser profile',
  supportedModels: [
    'gemini-2.5-pro-web',
    'gemini-2.5-flash-web',
  ],
  modelMappings: {
    'gemini-2.5-pro-web': 'gemini-2.5-pro',
    'gemini-2.5-flash-web': 'gemini-2.5-flash',
  },
  credentialFields: [
    {
      name: 'token',
      label: 'Session Token',
      type: 'textarea',
      required: true,
      placeholder: 'Click "Auto fetch" to log in via browser',
      helpText: 'Authentication is managed via the browser profile. Click "Auto fetch" to log in.',
    },
  ],
  logoUrl: '',
}

export default geminiConfig