import type { BuiltinProviderConfig } from '../../store/types.ts'

export const doubaoWebConfig: BuiltinProviderConfig = {
  id: 'doubao-web',
  name: '豆包 (Web)',
  type: 'web',
  authType: 'browser',
  apiEndpoint: '', // web provider 不走 HTTP endpoint
  chatPath: '',
  headers: {},
  enabled: true,
  description: 'Doubao (豆包) via managed browser (Connect) or imported session; web_url: https://www.doubao.com',
  supportedModels: ['doubao-web'],
  modelMappings: { 'doubao-web': 'doubao-web' },
  credentialFields: [],
  logoUrl: 'https://www.doubao.com/favicon.ico',
}

export default doubaoWebConfig
