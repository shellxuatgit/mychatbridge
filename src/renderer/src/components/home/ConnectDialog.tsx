import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useProvidersStore } from '@/stores/providersStore'
import { ProviderLogo } from '@/lib/providerIcons'
import { isOAuthCapable, mapOAuthCredentials } from '@/lib/providerConnect'
import { isAutoConnectProvider, nextAutoConnectUiPhase, type AutoConnectUiPhase } from '@/lib/autoConnect'
import type { Provider, BuiltinProviderConfig, CredentialField, ProviderVendor } from '@/types/electron'
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: Provider | null
  onConnected: () => Promise<void>
}

type Phase = 'idle' | 'working' | 'success' | 'error'

export function ConnectDialog({ open, onOpenChange, provider, onConnected }: ConnectDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const store = useProvidersStore()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [credentials, setCredentials] = useState<Record<string, string>>({})

  const AUTO_POLL_MS = 3000
  const AUTO_POLL_TIMEOUT_MS = 5 * 60 * 1000
  const [autoPhase, setAutoPhase] = useState<AutoConnectUiPhase>('idle')
  const [autoError, setAutoError] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const builtin = provider?.id
    ? store.builtinProviders.find((b) => b.id === (provider as BuiltinProviderConfig).id)
    : undefined
  const credentialFields: CredentialField[] = builtin?.credentialFields || []
  const isWeb = provider?.type === 'web'
  const supportsOAuth = provider ? isOAuthCapable(provider.id) : false

  const useAuto = provider ? isAutoConnectProvider(provider.id) : false

  useEffect(() => {
    if (!open) {
      setPhase('idle')
      setMessage('')
      setManualOpen(false)
      setCredentials({})
      setAutoPhase('idle')
      setAutoError('')
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!provider) return null

  const providerName = t(`${provider.id}.name`, { defaultValue: provider.name })

  const refreshState = async () => {
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
        countMap[p.id] = {
          total: accounts.length,
          active: accounts.filter((a) => a.status === 'active').length,
        }
      }
      store.setAccountCounts(countMap)
      await onConnected()
    } catch (error) {
      console.error('Failed to refresh providers state:', error)
    }
  }

  const finishSuccess = async (successMessage?: string) => {
    setPhase('success')
    setMessage(successMessage || t('providers.connectSuccessDesc'))
    await refreshState()
    setTimeout(() => onOpenChange(false), 900)
  }

  const fail = (errorMessage: string) => {
    setPhase('error')
    setMessage(errorMessage)
  }

  const ensureAccount = async (): Promise<string> => {
    const existing = store.getAccountsByProvider(provider.id)
    if (existing.length > 0) {
      const active = existing.find((a) => a.status === 'active')
      return (active || existing[0]).id
    }
    const account = await window.electronAPI.accounts.add({
      providerId: provider.id,
      name: providerName,
      credentials: {},
    })
    store.addAccount(account)
    return account.id
  }

  const handleWebConnect = async () => {
    setPhase('working')
    setMessage(t('providers.openingLoginWindow'))
    try {
      const accountId = await ensureAccount()
      setMessage(t('providers.connecting'))
      await window.electronAPI.webRuntime.connect(provider.id, accountId)
      await window.electronAPI.webRuntime.health().catch(() => null)
      await finishSuccess(t('providers.connectSuccessDesc'))
    } catch (error) {
      fail(error instanceof Error ? error.message : t('providers.connectFailed'))
    }
  }

  const persistSession = async (payload: { providerId: string; credentials: Record<string, string>; accountName: string }) => {
    const account = await window.electronAPI.accounts.add({
      providerId: provider.id,
      name: payload.accountName,
      credentials: payload.credentials,
    })
    store.addAccount(account)
  }

  const clearAutoInterval = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const runAutoPhase = async (action: 'start' | 'poll') => {
    if (action === 'start') {
      setAutoPhase('checking')
      setAutoError('')
    }
    try {
      const result = action === 'start'
        ? await window.electronAPI.webRuntime.autoConnect(provider.id)
        : await window.electronAPI.webRuntime.checkSession(provider.id)
      setAutoPhase((prev) => nextAutoConnectUiPhase(prev, result))
      if (result.status === 'imported') {
        clearAutoInterval()
        await persistSession(result.payload)
        setMessage(t('providers.autoImportFound'))
        await finishSuccess(t('providers.autoImportFound'))
      } else if (result.status === 'opened') {
        const startedAt = Date.now()
        intervalRef.current = setInterval(async () => {
          if (Date.now() - startedAt > AUTO_POLL_TIMEOUT_MS) {
            clearAutoInterval()
            setAutoError(t('providers.pollTimeout'))
            setAutoPhase('error')
            return
          }
          try {
            await runAutoPhase('poll')
          } catch (e) {
            clearAutoInterval()
            setAutoError(e instanceof Error ? e.message : t('providers.connectFailed'))
            setAutoPhase('error')
          }
        }, AUTO_POLL_MS)
      } else if (result.status === 'unsupported') {
        setAutoError(result.reason || t('providers.connectFailed'))
        setAutoPhase('error')
      }
    } catch (error) {
      setAutoError(error instanceof Error ? error.message : t('providers.connectFailed'))
      setAutoPhase('error')
    }
  }

  const handleOAuthConnect = async () => {
    setPhase('working')
    setMessage(t('providers.openingLoginWindow'))
    try {
      const result = await window.electronAPI.oauth.startInAppLogin(
        provider.id,
        provider.id as ProviderVendor
      )
      if (result?.success && result.credentials) {
        const mapped = mapOAuthCredentials(provider.id, result.credentials)
        const accountName = result.accountInfo?.name || providerName
        await window.electronAPI.accounts.add({
          providerId: provider.id,
          name: accountName,
          email: result.accountInfo?.email,
          credentials: mapped,
        })
        setMessage(t('providers.loginSuccess'))
        await finishSuccess(t('providers.connectSuccessDesc'))
      } else {
        const errorMsg = result?.error || t('providers.loginFailed')
        fail(
          errorMsg === 'Login window was closed'
            ? t('providers.loginWindowClosed')
            : errorMsg.includes('Guest account')
              ? t('providers.guestAccountNotAllowed')
              : errorMsg
        )
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : t('providers.loginFailed'))
    }
  }

  const handleManualValidate = async () => {
    const missing = credentialFields.filter((f) => f.required && !credentials[f.name])
    if (missing.length > 0) {
      toast({
        title: t('providers.validateFailed'),
        description: t('providers.fillRequiredFields', {
          fields: missing.map((f) => f.label).join(', '),
        }),
        variant: 'destructive',
      })
      return
    }
    setPhase('working')
    setMessage(t('providers.validating'))
    try {
      const result = await window.electronAPI.accounts.validateToken(provider.id, credentials)
      if (!result.valid) {
        fail(result.error || t('providers.credentialsInvalid'))
        return
      }
      await window.electronAPI.accounts.add({
        providerId: provider.id,
        name: result.userInfo?.name || providerName,
        email: result.userInfo?.email,
        credentials,
      })
      await finishSuccess(t('providers.credentialsValid'))
    } catch (error) {
      fail(error instanceof Error ? error.message : t('providers.validateFailed'))
    }
  }

const primaryAction = useAuto
    ? { label: t('providers.connect'), run: () => runAutoPhase('start') }
    : isWeb
    ? { label: t('providers.connect'), run: handleWebConnect }
    : supportsOAuth && !manualOpen
    ? { label: t('providers.openOAuthLogin'), run: handleOAuthConnect }
    : { label: t('providers.addAccount'), run: handleManualValidate }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderLogo providerId={provider.id} name={providerName} size="sm" logoUrl={builtin?.logoUrl} />
            {providerName}
          </DialogTitle>
          <DialogDescription>{t('home.connectDesc')}</DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          {useAuto ? (
            <div className="space-y-2">
              <div className="flex items-center gap-4 rounded-md border bg-muted/50 p-3 text-sm">
                {autoPhase === 'checking' || autoPhase === 'opened' ? (
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                ) : autoPhase === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                ) : autoPhase === 'error' ? (
                  <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-500" />
                ) : (
                  <Loader2 className="h-4 w-4 flex-shrink-0 opacity-0" />
                )}
                <span
                  className={cn(
                    autoPhase === 'error' ? 'text-red-500' :
                    autoPhase === 'success' ? 'text-green-600' : ''
                  )}
                >
                  {autoPhase === 'checking' && t('providers.checkingSession')}
                  {autoPhase === 'opened' && t('providers.waitingLogin')}
                  {autoPhase === 'success' && t('providers.autoImportFound')}
                  {autoPhase === 'error' && (autoError || t('providers.connectFailed'))}
                  {autoPhase === 'idle' && t('home.connectIdle')}
                </span>
              </div>
              {autoPhase === 'opened' && (
                <p className="text-xs text-muted-foreground">{t('providers.privacyNote')}</p>
              )}
              {(autoPhase === 'error' || autoPhase === 'idle') && (
                <button
                  type="button"
                  onClick={() => setManualOpen(true)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-primary"
                >
                  {t('providers.manualInput')}
                </button>
              )}
            </div>
          ) : (
            (isWeb || (supportsOAuth && !manualOpen)) && (
              <div className="space-y-2">
                <ol className="list-none space-y-2 text-sm text-muted-foreground">
                  <li>1. {t('home.connectStepBrowser')}</li>
                  <li>2. {t('home.connectStepLogin')}</li>
                  <li>3. {t('home.connectStepDetect')}</li>
                </ol>
                {supportsOAuth && !isWeb && (
                  <button
                    type="button"
                    onClick={() => setManualOpen(true)}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-primary"
                  >
                    {t('providers.manualInput')}
                  </button>
                )}
                <div className="flex items-center gap-4 rounded-md border bg-muted/50 p-3 text-sm">
                  <Loader2 className={cn('h-4 w-4 flex-shrink-0', phase === 'working' ? 'animate-spin' : 'opacity-0')} />
                  <span className={cn(phase === 'error' ? 'text-red-500' : phase === 'success' ? 'text-green-600' : '')}>
                    {message || t('home.connectIdle')}
                  </span>
                </div>
              </div>
            )
          )}

          {(!supportsOAuth || manualOpen) && !isWeb && (
            <div className="space-y-4">
              {credentialFields.map((field) => (
                <div key={field.name} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`connect-${field.name}`}>{field.label}</Label>
                    {field.required && (
                      <Badge variant="outline" className="text-xs">
                        {t('providers.required')}
                      </Badge>
                    )}
                  </div>
                  <Input
                    id={`connect-${field.name}`}
                    type={field.type === 'password' ? 'password' : 'text'}
                    placeholder={field.placeholder}
                    value={credentials[field.name] || ''}
                    onChange={(e) =>
                      setCredentials((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                  />
                </div>
              ))}
              {phase === 'error' && (
                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950/30 p-3 rounded-md">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{message}</span>
                </div>
              )}
              {phase === 'success' && (
                <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950/30 p-3 rounded-md">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>{message}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={phase === 'working' || autoPhase === 'checking' || autoPhase === 'opened'}>
              {t('common.cancel')}
            </Button>
            <Button onClick={primaryAction.run} disabled={phase === 'working' || autoPhase === 'checking' || autoPhase === 'opened' || autoPhase === 'success'}>
              {phase === 'working' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {message || t('providers.connecting')}
                </>
              ) : autoPhase === 'checking' || autoPhase === 'opened' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('providers.connecting')}
                </>
              ) : (
                <>
                  {(isWeb || (supportsOAuth && !manualOpen)) && !useAuto ? (
                    <ExternalLink className="mr-2 h-4 w-4" />
                  ) : null}
                  {primaryAction.label}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}