import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

test('home local API section renders the configured bind address instead of a hard-coded loopback host', () => {
  const headerSource = readFileSync(join(root, 'src/renderer/src/components/layout/Header.tsx'), 'utf8')
  const homeSource = readFileSync(join(root, 'src/renderer/src/pages/Home.tsx'), 'utf8')
  const handlersSource = readFileSync(join(root, 'src/main/ipc/handlers.ts'), 'utf8')
  const sharedTypesSource = readFileSync(join(root, 'src/shared/types.ts'), 'utf8')

  assert.match(sharedTypesSource, /export interface ProxyStatus \{[\s\S]*?\n\s+host: string/)
  assert.match(handlersSource, /host: proxyHost/)
  assert.match(handlersSource, /proxyStatusManager\.getHost\(\)/)
  assert.match(handlersSource, /key === 'config'[\s\S]*?IpcChannels\.CONFIG_CHANGED/)
  assert.match(homeSource, /const endpoint = `http:\/\/\$\{proxyStatus\.host === '0\.0\.0\.0' \? '127\.0\.0\.1' : proxyStatus\.host\}:/)
  assert.doesNotMatch(homeSource, /127\.0\.0\.1:\$\{proxyStatus\.port\}/)
  assert.doesNotMatch(headerSource, /const \[host, setHost\] = useState/)
})

test('tool calling smoke uses a local management API URL that is actually served by the proxy', () => {
  const preloadSource = readFileSync(join(root, 'src/preload/index.ts'), 'utf8')
  const managementSettingsSource = readFileSync(join(root, 'src/renderer/src/components/settings/ManagementApiSettings.tsx'), 'utf8')

  assert.match(preloadSource, /function resolveLocalManagementApiBaseUrl\(config: AppConfig\)/)
  assert.match(preloadSource, /configuredHost === '0\.0\.0\.0'/)
  assert.match(preloadSource, /return `http:\/\/\$\{host\}:\$\{config\.proxyPort\}\/v0\/management`/)
  assert.doesNotMatch(preloadSource, /managementApi\?\.managementApiPort \|\| config\.proxyPort/)
  assert.match(managementSettingsSource, /const apiEndpoint = `http:\/\/127\.0\.0\.1:\$\{proxyPort\}\/v0\/management`/)
})
