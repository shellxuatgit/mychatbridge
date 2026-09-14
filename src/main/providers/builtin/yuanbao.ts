import type { BuiltinProviderConfig } from '../../store/types'

/**
 * 元宝（Yuanbao / Tencent）web provider.
 * Requests are routed through the managed Playwright browser
 * (`YuanbaoBrowserAdapter`), which drives the live web UI and reads token usage
 * from the authoritative `meta` SSE event.
 */
export const yuanbaoConfig: BuiltinProviderConfig = {
  id: 'yuanbao',
  name: 'Yuanbao',
  type: 'builtin',
  authType: 'cookie',
  apiEndpoint: 'https://yuanbao.tencent.com',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Origin': 'https://yuanbao.tencent.com',
    'Referer': 'https://yuanbao.tencent.com/',
  },
  enabled: true,
  description: '腾讯元宝 web assistant via managed browser profile',
  supportedModels: [
    'hunyuan-t1',
    'hunyuan-turbo',
  ],
  modelMappings: {
    'hunyuan-t1': 'hunyuan-t1',
    'hunyuan-turbo': 'hunyuan-turbo',
  },
  credentialFields: [
    {
      name: 'cookie',
      label: 'Cookie',
      type: 'textarea',
      required: false,
      placeholder: 'Click "Auto fetch" to log in via browser',
      helpText: 'Authentication is managed via the browser profile. Click "Auto fetch" to log in.',
    },
  ],
  logoUrl: 'https://yuanbao.tencent.com/favicon.ico',
}

export default yuanbaoConfig