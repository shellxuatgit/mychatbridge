import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Server } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LocalApiSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  port: number
  host: string
  running: boolean
  onSave: (port: number, host: string) => Promise<void>
  onStart: () => Promise<void>
  onStop: () => Promise<void>
  onTestConnection: () => Promise<{
    ok: boolean
    endpoint: string
    model?: string
    models?: string[]
    reply?: string
    latencyMs: number
    error?: string
  }>
}

export function LocalApiSettingsDialog({
  open,
  onOpenChange,
  port,
  host,
  running,
  onSave,
  onStart,
  onStop,
  onTestConnection,
}: LocalApiSettingsDialogProps) {
  const { t } = useTranslation()
  const [portInput, setPortInput] = useState(String(port))
  const [hostInput, setHostInput] = useState(host)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; reply?: string; models?: string[]; latencyMs: number; error?: string } | null>(null)

  useEffect(() => {
    if (open) {
      setPortInput(String(port))
      setHostInput(host)
      setSaving(false)
      setToggling(false)
      setTestResult(null)
    }
  }, [open, port, host])

  const parsedPort = parseInt(portInput, 10)

  const handleSave = async () => {
    if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) return
    setSaving(true)
    try {
      await onSave(parsedPort, hostInput)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    setToggling(true)
    try {
      if (running) {
        await onStop()
      } else {
        await onStart()
      }
    } finally {
      setToggling(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await onTestConnection()
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {t('home.localApiSettingsTitle')}
          </DialogTitle>
          <DialogDescription>{t('home.localApiSettingsDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="local-api-port">{t('proxy.port')}</Label>
            <Input
              id="local-api-port"
              type="number"
              min={1}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('home.bindAddress')}</Label>
            <div className="space-y-1.5">
              {['127.0.0.1', '0.0.0.0'].map((addr) => (
                <button
                  key={addr}
                  type="button"
                  onClick={() => setHostInput(addr)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                    hostInput === addr
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full border',
                      hostInput === addr ? 'border-primary bg-primary' : 'border-muted-foreground/50'
                    )}
                  />
                  {addr}
                  {addr === '0.0.0.0' && (
                    <span className="text-xs text-muted-foreground">{t('home.bindAddressAdvanced')}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggle}
              disabled={toggling}
              className="text-sm flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
            >
              {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {running ? t('home.localApiStop') : t('home.localApiStart')}
            </button>
            <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('home.testApi')}
            </Button>
          </div>
          {testResult && (
            <div className={cn('rounded-md border p-3 text-sm', testResult.ok ? 'border-green-500/50 text-green-600' : 'border-destructive/50 text-destructive')}>
              <div className="font-medium">{testResult.ok ? t('home.apiTestSuccess') : t('home.apiTestFailed')}</div>
              {testResult.ok ? (
                <div className="mt-1 space-y-1 text-xs">
                  <div>{t('home.apiTestModel')}: {testResult.models?.join(', ') || '-'}</div>
                  <div>{t('home.apiTestReply')}: {testResult.reply || '-'}</div>
                  <div>{t('home.apiTestLatency')}: {testResult.latencyMs}ms</div>
                </div>
              ) : (
                <div className="mt-1 text-xs">{testResult.error}</div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}