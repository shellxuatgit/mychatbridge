import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Power, Copy, Check, Play, Square, RotateCw, ExternalLink, Moon, Sun, Zap, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { useProvidersStore } from '@/stores/providersStore'
import iconsPng from '@/assets/icons/icons.png'

interface ProviderInfo {
  id: string
  name: string
  accountCount: number
  activeCount: number
}

export function TrayView() {
  const { t } = useTranslation()
  const { toggleTheme, isDark } = useTheme()
  const { providers, accounts, setProviders, setAccounts, setIsLoading, isLoading } = useProvidersStore()

  const [proxyRunning, setProxyRunning] = useState(false)
  const [proxyLoading, setProxyLoading] = useState(false)
  const [port, setPort] = useState(8080)
  const [host, setHost] = useState('127.0.0.1')
  const [copied, setCopied] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)

  useEffect(() => {
    const loadProxyStatus = async () => {
      const status = await window.electronAPI?.proxy?.getStatus?.()
      setProxyRunning(status.isRunning)
      
      const config = await window.electronAPI?.config?.get?.()
      if (config) {
        setPort(config.proxyPort || 8080)
        setHost(config.proxyHost || '127.0.0.1')
      }
    }
    
    loadProxyStatus()

    const unsubscribeProxy = window.electronAPI?.proxy?.onStatusChanged?.((status) => {
      setProxyRunning(status.isRunning)
      if (status.port) setPort(status.port)
    })

    const unsubscribeConfig = window.electronAPI?.config?.onConfigChanged?.((config) => {
      setPort(config.proxyPort || 8080)
      setHost(config.proxyHost || '127.0.0.1')
    })

    return () => {
      unsubscribeProxy?.()
      unsubscribeConfig?.()
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!selectedProvider && providers.length > 0) {
      const firstWithAccounts = providers.find((p) => {
        const count = accounts.filter((a) => a.providerId === p.id).length
        return count > 0
      })
      setSelectedProvider(firstWithAccounts?.id || providers[0]?.id || null)
    }
  }, [providers, accounts, selectedProvider])

  useEffect(() => {
    window.electronAPI?.send?.('tray:set-height', 460)
  }, [])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [providersData, accountsData, config] = await Promise.all([
        window.electronAPI?.providers?.getAll?.() || [],
        window.electronAPI?.accounts?.getAll?.() || [],
        window.electronAPI?.config?.get?.(),
      ])
      setProviders(providersData)
      setAccounts(accountsData)
      if (config) {
        setPort(config.proxyPort || 8080)
        setHost(config.proxyHost || '127.0.0.1')
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await loadData()
    setTimeout(() => setIsRefreshing(false), 1000)
  }

  const handleCopyUrl = async () => {
    const url = `http://${host}:${port}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleProxy = async () => {
    if (proxyLoading) return
    setProxyLoading(true)
    try {
      if (proxyRunning) {
        await window.electronAPI?.proxy?.stop?.()
        setProxyRunning(false)
      } else {
        await window.electronAPI?.proxy?.start?.()
        setProxyRunning(true)
      }
    } finally {
      setProxyLoading(false)
    }
  }

  const openDashboard = () => {
    window.electronAPI?.send?.('tray:open-dashboard')
  }

  const quitApp = () => {
    window.electronAPI?.tray?.quitApp?.()
  }

  const providerList: ProviderInfo[] = useMemo(() => {
    return providers.map((p) => {
      const providerAccounts = accounts.filter((a) => a.providerId === p.id)
      return {
        id: p.id,
        name: p.name,
        accountCount: providerAccounts.length,
        activeCount: providerAccounts.filter((a) => a.status === 'active').length,
      }
    })
  }, [providers, accounts])

  const selectedProviderAccounts = useMemo(() => {
    if (!selectedProvider) return []
    return accounts.filter((a) => a.providerId === selectedProvider)
  }, [accounts, selectedProvider])

  return (
    <div className="w-full h-[460px] flex flex-col select-none overflow-hidden bg-white dark:bg-slate-900">
      <div className="absolute top-0 left-0 right-0 h-6 drag-region z-50" />

      {/* Header with status color (flat) */}
      <div className={cn(
        "flex-none relative overflow-hidden",
        proxyRunning
          ? "bg-emerald-600"
          : "bg-slate-600"
      )}>
        <div className="relative px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-md bg-white/15 flex items-center justify-center border border-white/20">
              <img src={iconsPng} alt="MyChatBridge" className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">MyChatBridge</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                {proxyRunning ? (
                  <>
                    <Wifi size={12} className="text-white/90" />
                    <span className="text-xs text-white/90 font-medium">{t('tray.serviceRunning')}</span>
                  </>
                ) : (
                  <>
                    <WifiOff size={12} className="text-white/90" />
                    <span className="text-xs text-white/90 font-medium">{t('tray.serviceStopped')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
              className="p-2 rounded-md hover:bg-white/20 transition-colors disabled:opacity-30"
            >
              <RotateCw size={15} className={cn('text-white', (isLoading || isRefreshing) && 'animate-spin')} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-white/20 transition-colors"
            >
              {isDark ? <Sun size={15} className="text-white" /> : <Moon size={15} className="text-white" />}
            </button>
          </div>
        </div>
      </div>

      {/* Endpoint Card */}
      <section className="flex-none px-4 -mt-3 relative z-10 no-drag">
        <div className="bg-white dark:bg-slate-800 rounded-md shadow-sm border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={12} className="text-amber-500" />
                <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">API Endpoint</span>
              </div>
              <button
                onClick={handleCopyUrl}
                className="flex items-center gap-1.5 group"
              >
                <code className="text-sm font-mono font-semibold text-slate-800 dark:text-white truncate">
                  {host}:{port}
                </code>
                {copied ? (
                  <Check size={12} className="text-emerald-500 flex-shrink-0" />
                ) : (
                  <Copy size={12} className="text-slate-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            </div>
            <button
              onClick={toggleProxy}
              disabled={proxyLoading}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-md font-semibold text-sm transition-colors shadow-sm",
                proxyRunning
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              )}
            >
              {proxyRunning ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              <span>{proxyRunning ? t('tray.stop') : t('tray.start')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Provider Tabs */}
      {providerList.length > 0 && (
        <nav className="flex-none px-4 pt-3 pb-2 no-drag">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {providerList.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProvider(p.id)}
                className={cn(
                  "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  selectedProvider === p.id
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                )}
              >
                {p.name}
                <span className={cn(
                  "ml-1",
                  selectedProvider === p.id ? "opacity-70" : "opacity-50"
                )}>
                  {p.activeCount}/{p.accountCount}
                </span>
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Account List */}
      <main className="flex-1 min-h-0 px-4 overflow-y-auto no-drag">
        {isLoading && selectedProviderAccounts.length === 0 ? (
          <div className="py-10 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-slate-200 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : selectedProviderAccounts.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-2">
              <WifiOff size={20} className="text-slate-400" />
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">{t('tray.noAccounts')}</p>
          </div>
        ) : (
          <div className="space-y-2 pb-3">
            {selectedProviderAccounts.map((account) => {
              const isActive = account.status === 'active'
              return (
                <div
                  key={account.id}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-md transition-colors",
                    isActive
                      ? "bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/30"
                      : "bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full flex-shrink-0",
                      isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                    )} />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                      {account.name || account.email || 'Unknown'}
                    </span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0",
                    isActive
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                  )}>
                    {isActive ? t('providers.online') : t('providers.offline')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="flex-none p-4 border-t border-slate-200 dark:border-slate-700 no-drag">
        <div className="flex gap-2">
          <button
            onClick={openDashboard}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors shadow-sm"
          >
            <ExternalLink size={15} />
            <span>{t('tray.openDashboard')}</span>
          </button>
          <button
            onClick={quitApp}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-sm transition-colors border border-slate-200 dark:border-slate-700"
          >
            <Power size={15} />
            <span>{t('tray.quit')}</span>
          </button>
        </div>
      </footer>
    </div>
  )
}

export default TrayView
