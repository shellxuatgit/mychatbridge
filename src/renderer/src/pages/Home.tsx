import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProvidersStore } from '@/stores/providersStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useToast } from '@/hooks/use-toast'
import { ProviderRow, type ProviderUiStatus } from '@/components/home/ProviderRow'
import { ConnectDialog } from '@/components/home/ConnectDialog'
import { LocalApiSettingsDialog } from '@/components/home/LocalApiSettingsDialog'
import { CreateApiKeyDialog } from '@/components/home/CreateApiKeyDialog'
import { AddProviderDialog } from '@/components/providers/AddProviderDialog'
import { AddAccountDialog } from '@/components/providers/AddAccountDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { maskKey } from '@/lib/apiKeyUtils'
import { applyProviderOrder, moveProvider } from '@/lib/providerOrder'
import type {
  Provider,
  BuiltinProviderConfig,
  ProviderStatus,
  ProxyStatus,
  ApiKey,
  ProviderCheckResult,
} from '@/types/electron'
import { Check, ChevronRight, Clipboard, Copy, KeyRound, Play, Plus, Server, Settings, Square, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const ORDER_STORAGE_KEY = 'providerOrder'

export function Home() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const navigate = useNavigate()
  const store = useProvidersStore()
  const { config, updateConfig, fetchConfig } = useSettingsStore()
  const { addProviderOpen, setAddProviderOpen } = useUiStore()

  const hasLoadedRef = useRef(false)

  const [proxyStatus, setProxyStatus] = useState<ProxyStatus>({
    isRunning: false,
    port: 8080,
    host: '127.0.0.1',
    uptime: 0,
    connections: 0,
  })
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [connectProvider, setConnectProvider] = useState<Provider | null>(null)
  const [addAccountProvider, setAddAccountProvider] = useState<{ provider: Provider; builtin?: BuiltinProviderConfig } | null>(null)
  const [deleteProvider, setDeleteProvider] = useState<Provider | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [copiedEndpoint, setCopiedEndpoint] = useState(false)
  const [connectionTest, setConnectionTest] = useState<{ provider: Provider; result: ProviderCheckResult } | null>(null)
  const [proxyBusy, setProxyBusy] = useState(false)
  const [providerTokens, setProviderTokens] = useState<Record<string, { totalTokens: number }>>({})

  const loadInitial = useCallback(async () => {
    if (!window.electronAPI?.providers?.getAll) {
      store.setProviders([])
      store.setBuiltinProviders([])
      store.setAccounts([])
      return
    }
    try {
      const [providersData, builtinData, accountsData, order, stats] = await Promise.all([
        window.electronAPI.providers.getAll(),
        window.electronAPI.providers.getBuiltin(),
        window.electronAPI.accounts.getAll(),
        window.electronAPI.store.get<string[]>(ORDER_STORAGE_KEY),
        window.electronAPI.statistics?.get?.(),
      ])
      store.setProviders(providersData)
      store.setBuiltinProviders(builtinData)
      store.setAccounts(accountsData)

      if (stats?.providerTokens) {
        setProviderTokens(stats.providerTokens)
      }

      if (Array.isArray(order) && order.length > 0) {
        store.setProviders(applyProviderOrder(providersData, order))
      }

      const statusMap: Record<string, ProviderStatus> = { ...store.providerStatuses }
      const countMap: Record<string, { total: number; active: number }> = {}
      for (const provider of providersData) {
        if (provider.status) statusMap[provider.id] = provider.status
        else if (!statusMap[provider.id]) statusMap[provider.id] = 'unknown'
        const accounts = accountsData.filter((a) => a.providerId === provider.id)
        countMap[provider.id] = {
          total: accounts.length,
          active: accounts.filter((a) => a.status === 'active').length,
        }
      }
      store.setProviderStatuses(statusMap)
      store.setAccountCounts(countMap)
    } catch (error) {
      console.error('Failed to load providers:', error)
    }
  }, [store])

  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    loadInitial()
    fetchConfig()
    // Keep the Local API available when the app opens.
    window.electronAPI.proxy.getStatus()
      .then((status) => {
        setProxyStatus(status)
        if (!status.isRunning) {
          return window.electronAPI.proxy.start()
            .then(() => window.electronAPI.proxy.getStatus())
            .then(setProxyStatus)
        }
        return undefined
      })
      .catch(() => null)
    const unsubscribeProxy = window.electronAPI.proxy.onStatusChanged((status) => {
      setProxyStatus(status)
    })

    // 1. Realtime push from main process when token stats update
    const unsubscribeStats = window.electronAPI.statistics?.onUpdated?.((stats) => {
      if (stats?.providerTokens) {
        setProviderTokens(stats.providerTokens)
      }
    })

    // 2. Refresh on window focus (e.g. user switching back to client)
    const handleFocus = () => {
      window.electronAPI.statistics?.get?.().then((stats) => {
        if (stats?.providerTokens) {
          setProviderTokens(stats.providerTokens)
        }
      }).catch(() => null)
    }
    window.addEventListener('focus', handleFocus)

    // 3. Fallback poll every 10 seconds
    const pollTimer = setInterval(handleFocus, 10000)

    return () => {
      unsubscribeProxy?.()
      unsubscribeStats?.()
      window.removeEventListener('focus', handleFocus)
      clearInterval(pollTimer)
    }
  }, [loadInitial, fetchConfig])

  const endpoint = `http://${proxyStatus.host === '0.0.0.0' ? '127.0.0.1' : proxyStatus.host}:${proxyStatus.port}/v1`

  const orderedProviders = store.providers

  const uiStatus = useCallback(
    (provider: Provider): ProviderUiStatus => {
      if (connectingId === provider.id) return 'connecting'
      const active = store.accountCounts[provider.id]?.active || 0
      const status = store.providerStatuses[provider.id]
      if (active > 0 || status === 'online') return 'connected'
      if (status === 'offline') return 'error'
      return 'connect'
    },
    [connectingId, store.accountCounts, store.providerStatuses]
  )

  const refreshCounts = useCallback(async () => {
    try {
      const [providersData, accountsData] = await Promise.all([
        window.electronAPI.providers.getAll(),
        window.electronAPI.accounts.getAll(),
      ])
      store.setProviders(providersData)
      store.setAccounts(accountsData)
      const countMap: Record<string, { total: number; active: number }> = {}
      for (const p of providersData) {
        const accounts = accountsData.filter((a) => a.providerId === p.id)
        countMap[p.id] = { total: accounts.length, active: accounts.filter((a) => a.status === 'active').length }
      }
      store.setAccountCounts(countMap)
    } catch (error) {
      console.error('Failed to refresh counts:', error)
    }
  }, [store])

  const reorder = async (fromId: string, toId: string) => {
    const next = moveProvider(orderedProviders, fromId, toId)
    if (next === orderedProviders) return
    store.setProviders(next)
    try {
      await window.electronAPI.store.set(ORDER_STORAGE_KEY, next.map((p) => p.id))
    } catch (error) {
      console.error('Failed to persist provider order:', error)
    }
  }

  const handleConnect = (provider: Provider) => {
    setConnectingId(provider.id)
    setConnectProvider(provider)
  }

  const handleOpenBrowser = (provider: Provider) => {
    setConnectingId(provider.id)
    setConnectProvider(provider)
  }

  const handleAddAccount = (provider: Provider) => {
    const builtin = store.builtinProviders.find((b) => b.id === provider.id)
    setAddAccountProvider({ provider, builtin })
  }

  const handleOnAddAccount = async (data: {
    name: string
    email?: string
    credentials: Record<string, string>
    dailyLimit?: number
  }) => {
    if (!addAccountProvider) return
    const providerId = addAccountProvider.provider.id
    const account = await window.electronAPI.accounts.add({
      providerId,
      name: data.name,
      email: data.email,
      credentials: data.credentials,
      dailyLimit: data.dailyLimit,
    })
    store.addAccount(account)
    const accounts = store.getAccountsByProvider(providerId)
    store.updateAccountCount(providerId, accounts.length, accounts.filter((a) => a.status === 'active').length)
    toast({ title: t('providers.addSuccess'), description: t('providers.accountAdded') })
  }

  const handleTestConnection = async (provider: Provider) => {
    try {
      const result = await window.electronAPI.providers.checkStatus(provider.id)
      store.updateProviderStatus(provider.id, result.status)
      setConnectionTest({ provider, result })
      toast({
        title: result.status === 'online' ? t('providers.providerOnline') : t('providers.providerOffline'),
        description: result.error || `${t('providers.latency')}: ${result.latency}ms`,
        variant: result.status === 'online' ? 'default' : 'destructive',
      })
    } catch (error) {
      toast({
        title: t('providers.checkFailed'),
        description: error instanceof Error ? error.message : t('providers.cannotCheckProviderStatus'),
        variant: 'destructive',
      })
    }
  }

  const handleManage = (provider: Provider) => {
    store.setSelectedProviderId(provider.id)
    navigate('/providers')
  }

  const handleRemove = async () => {
    if (!deleteProvider) return
    try {
      const success = await window.electronAPI.providers.delete(deleteProvider.id)
      if (success) {
        store.removeProvider(deleteProvider.id)
        toast({ title: t('providers.deleteSuccess'), description: t('providers.providerDeleted') })
      }
    } catch (error) {
      toast({
        title: t('providers.deleteFailed'),
        description: error instanceof Error ? error.message : t('providers.cannotDeleteProvider'),
        variant: 'destructive',
      })
    } finally {
      setDeleteProvider(null)
    }
  }

  const handleSelectBuiltin = async (provider: BuiltinProviderConfig, credentials: Record<string, string>) => {
    let target = store.providers.find((p) => p.id === provider.id)
    if (!target) {
      const created = await window.electronAPI.providers.add({
        id: provider.id,
        name: provider.name,
        type: provider.type as 'builtin' | 'custom',
        authType: provider.authType,
        apiEndpoint: provider.apiEndpoint,
        headers: provider.headers,
        description: provider.description,
        supportedModels: provider.supportedModels,
        credentialFields: provider.credentialFields,
      })
      store.addProvider(created)
      target = created
    }

    if (credentials && Object.keys(credentials).length > 0) {
      const account = await window.electronAPI.accounts.add({
        providerId: target.id,
        name: provider.name,
        credentials,
      })
      store.addAccount(account)
      store.updateAccountCount(target.id, store.getAccountsByProvider(target.id).length, 1)
    }

    setAddProviderOpen(false)

    if (provider.type === 'web') {
      handleConnect(target)
      return
    }

    toast({ title: t('providers.addSuccess'), description: `${provider.name} ${t('providers.accountAdded')}` })
  }

  const handleCreateApiKey = async (key: ApiKey) => {
    const keys = config?.apiKeys || []
    await updateConfig({ apiKeys: [...keys, key] })
  }

  const handleDeleteApiKey = async (id: string) => {
    const keys = config?.apiKeys || []
    await updateConfig({ apiKeys: keys.filter((k) => k.id !== id) })
    toast({ title: t('apiKeys.deleted'), description: t('apiKeys.keyDeleted') })
  }

  const handleCopyApiKey = async (key: ApiKey) => {
    await navigator.clipboard.writeText(key.key)
    setCopiedKeyId(key.id)
    setTimeout(() => setCopiedKeyId(null), 2000)
    toast({ title: t('apiKeys.copied'), description: t('apiKeys.copiedToClipboard') })
  }

  const handleCopyEndpoint = async () => {
    await navigator.clipboard.writeText(endpoint)
    setCopiedEndpoint(true)
    setTimeout(() => setCopiedEndpoint(false), 2000)
  }

  const handleSaveLocalApi = async (port: number, host: string) => {
    if (proxyStatus.isRunning) {
      await window.electronAPI.proxy.stop()
    }
    await updateConfig({ proxyPort: port, proxyHost: host })
    await window.electronAPI.proxy.start(port)
    const status = await window.electronAPI.proxy.getStatus()
    setProxyStatus(status)
    toast({ title: t('proxy.configSaved'), description: t('proxy.proxyConfigUpdated') })
  }

  const handleStartProxy = async () => {
    await window.electronAPI.proxy.start()
    const status = await window.electronAPI.proxy.getStatus()
    setProxyStatus(status)
  }

  const handleStopProxy = async () => {
    await window.electronAPI.proxy.stop()
    const status = await window.electronAPI.proxy.getStatus()
    setProxyStatus(status)
  }

  const handleToggleProxy = async () => {
    if (proxyBusy) return
    setProxyBusy(true)
    try {
      if (proxyStatus.isRunning) {
        await handleStopProxy()
      } else {
        await handleStartProxy()
      }
    } catch (error) {
      console.error('Failed to toggle Local API:', error)
    } finally {
      setProxyBusy(false)
    }
  }

  const handleTestLocalApi = async () => {
    const apiKey = config?.apiKeys?.find((key) => key.enabled)?.key
    return window.electronAPI.proxy.testConnection({ apiKey })
  }

  const apiKeys = useMemo(() => config?.apiKeys || [], [config?.apiKeys])
  const isLoading = store.isLoading

  if (isLoading) {
    return <div className="flex items-center justify-center h-[50vh] text-muted-foreground">{t('providers.loading')}</div>
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">{t('home.providersTitle')}</h2>
        <div className="space-y-2" onDragOver={(e) => e.preventDefault()}>
          {orderedProviders.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              uiStatus={uiStatus(provider)}
              accountCount={store.accountCounts[provider.id]?.total || 0}
              totalTokens={providerTokens[provider.id]?.totalTokens}
              logoUrl={store.builtinProviders.find((b) => b.id === provider.id)?.logoUrl}
              isDragOver={dragOverId === provider.id}
              onDragStart={(id) => setDragOverId(id)}
              onDragEnd={() => setDragOverId(null)}
              onDropOnto={(toId) => {
                const fromId = dragOverId
                setDragOverId(null)
                if (fromId) reorder(fromId, toId)
              }}
              onConnect={handleConnect}
              onOpenBrowser={handleOpenBrowser}
              onAddAccount={handleAddAccount}
              onTestConnection={handleTestConnection}
              onManage={handleManage}
              onRemove={setDeleteProvider}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold tracking-tight">
          {t('home.localApiTitle')}
          <Button
            size="sm"
            className="h-8 w-8 min-w-8 p-0"
            onClick={handleToggleProxy}
            disabled={proxyBusy}
            title={proxyStatus.isRunning ? t('home.stopLocalApi') : t('home.startLocalApi')}
            aria-label={proxyStatus.isRunning ? t('home.stopLocalApi') : t('home.startLocalApi')}
          >
            {proxyStatus.isRunning ? (
              <Square className="h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
          </Button>
        </h2>
        <div className="flex items-center gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3">
          <Server className={cn('h-4 w-4 flex-shrink-0', proxyStatus.isRunning ? 'text-[var(--success)]' : 'text-muted-foreground')} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              {proxyStatus.isRunning ? t('home.localApiRunning') : t('home.localApiStopped')}
            </div>
            <code className="text-xs text-muted-foreground break-all">{endpoint}</code>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleCopyEndpoint} title={t('common.copy')}>
            {copiedEndpoint ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => setSettingsOpen(true)} title={t('home.localApiSettingsTitle')}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            {t('home.apiKeysTitle')}
            {apiKeys.length > 0 && (
              <Badge variant="secondary" className="text-xs font-semibold tabular-nums">
                {apiKeys.length}
              </Badge>
            )}
          </h2>
          <Button size="sm" onClick={() => setCreateKeyOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t('apiKeys.newApiKey')}
          </Button>
        </div>
        {apiKeys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--glass-border)] px-4 py-8 text-center text-sm text-muted-foreground">
            {t('apiKeys.noApiKeys')}
          </div>
        ) : (
          <div className="overview-keys-scroll rounded-lg border border-[var(--glass-border)]">
            {apiKeys.map((key, index) => (
              <div
                key={key.id}
                className={cn(
                  'flex items-center gap-3 bg-[var(--glass-bg)] px-4 py-3',
                  index !== apiKeys.length - 1 && 'border-b border-[var(--glass-border)]'
                )}
              >
                <KeyRound className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{key.name}</div>
                  <code className="text-xs text-muted-foreground">{maskKey(key.key)}</code>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => handleCopyApiKey(key)}
                  title={t('common.copy')}
                >
                  {copiedKeyId === key.id ? <Check className="h-4 w-4 text-green-500" /> : <Clipboard className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0 text-destructive hover:text-destructive"
                  onClick={() => handleDeleteApiKey(key.id)}
                  title={t('apiKeys.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        {apiKeys.length > 0 && (
          <Button
            variant="link"
            size="sm"
            onClick={() => navigate('/api-keys')}
            className="h-auto p-0 text-xs font-medium text-[var(--accent-primary)]"
          >
            {t('apiKeys.viewAll')}
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        )}
      </section>

      <Dialog open={!!connectionTest} onOpenChange={(open) => !open && setConnectionTest(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t('home.connectionTestTitle')}</DialogTitle>
            <DialogDescription>
              {connectionTest?.provider.name} · {connectionTest?.result.status === 'online' ? t('providers.providerOnline') : t('providers.providerOffline')}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-black/90 p-3 font-mono text-xs max-h-64 overflow-y-auto space-y-1">
            {connectionTest?.result.logs?.map((log, index) => (
              <div key={`${log.timestamp}-${index}`} className={log.level === 'error' ? 'text-red-400' : 'text-green-300'}>
                <span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                {log.messageKey ? t(log.messageKey, (log.messageParams as Record<string, unknown>) ?? {}) : log.message}
              </div>
            ))}
            {(!connectionTest?.result.logs || connectionTest.result.logs.length === 0) && (
              <div className="text-slate-400">{connectionTest?.result.error || t('home.connectionTestNoLogs')}</div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setConnectionTest(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConnectDialog
        open={!!connectProvider}
        onOpenChange={(open) => {
          if (!open) {
            setConnectProvider(null)
            setConnectingId(null)
            refreshCounts().catch(() => null)
          }
        }}
        provider={connectProvider}
        onConnected={refreshCounts}
      />

      <AddAccountDialog
        open={!!addAccountProvider}
        onOpenChange={(open) => !open && setAddAccountProvider(null)}
        provider={addAccountProvider?.builtin || addAccountProvider?.provider || null}
        onAddAccount={handleOnAddAccount}
        onValidateToken={async (providerId, credentials) => {
          const result = await window.electronAPI.accounts.validateToken(providerId, credentials)
          return result
        }}
      />

      <AddProviderDialog
        open={addProviderOpen}
        onOpenChange={setAddProviderOpen}
        builtinProviders={store.builtinProviders}
        onSelectBuiltin={handleSelectBuiltin}
        onCreateCustom={() => {
          setAddProviderOpen(false)
          navigate('/providers')
        }}
        onValidateToken={async (providerId, credentials) => {
          const result = await window.electronAPI.accounts.validateToken(providerId, credentials)
          return result
        }}
      />

      <LocalApiSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        port={proxyStatus.port}
        host={proxyStatus.host}
        running={proxyStatus.isRunning}
        onSave={handleSaveLocalApi}
        onStart={handleStartProxy}
        onStop={handleStopProxy}
        onTestConnection={handleTestLocalApi}
      />

      <CreateApiKeyDialog open={createKeyOpen} onOpenChange={setCreateKeyOpen} onCreate={handleCreateApiKey} />

      <Dialog open={!!deleteProvider} onOpenChange={(open) => !open && setDeleteProvider(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('providers.confirmDelete')}</DialogTitle>
            <DialogDescription>
              {t('providers.confirmDeleteDesc', {
                name: deleteProvider ? t(`${deleteProvider.id}.name`, { defaultValue: deleteProvider.name }) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProvider(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleRemove}>
              {t('providers.deleteProvider')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Home