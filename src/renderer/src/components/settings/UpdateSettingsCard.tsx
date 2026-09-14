import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Sparkles, RefreshCw, Download, CheckCircle, AlertCircle, ArrowUpCircle } from 'lucide-react'

interface UpdateInfo {
  version?: string
  releaseDate?: string
  releaseNotes?: string
}

interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export function UpdateSettingsCard() {
  const { t } = useTranslation()
  const [currentVersion, setCurrentVersion] = useState<string>('0.1.0')
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.app?.getVersion?.().then((v) => {
      if (v) setCurrentVersion(v)
    }).catch(() => null)

    window.electronAPI?.app?.getUpdateStatus?.().then((s) => {
      if (!s) return
      setChecking(s.checking)
      setAvailable(s.available)
      setDownloading(s.downloading)
      setDownloaded(s.downloaded)
      if (s.version) setUpdateInfo({ version: s.version, releaseDate: s.releaseDate, releaseNotes: s.releaseNotes })
      if (s.error) setError(s.error)
    }).catch(() => null)

    const unChecking = window.electronAPI?.app?.onUpdateChecking?.(() => {
      setChecking(true)
      setError(null)
    })

    const unAvailable = window.electronAPI?.app?.onUpdateAvailable?.((info) => {
      setChecking(false)
      setAvailable(true)
      setUpdateInfo(info)
    })

    const unNotAvailable = window.electronAPI?.app?.onUpdateNotAvailable?.(() => {
      setChecking(false)
      setAvailable(false)
      setError(null)
    })

    const unProgress = window.electronAPI?.app?.onUpdateProgress?.((p) => {
      setDownloading(true)
      setProgress(p)
    })

    const unDownloaded = window.electronAPI?.app?.onUpdateDownloaded?.((info) => {
      setDownloading(false)
      setDownloaded(true)
      setProgress(null)
      if (info) setUpdateInfo(info)
    })

    const unError = window.electronAPI?.app?.onUpdateError?.((err) => {
      setChecking(false)
      setDownloading(false)
      setError(err?.message || 'Update check failed')
    })

    return () => {
      unChecking?.()
      unAvailable?.()
      unNotAvailable?.()
      unProgress?.()
      unDownloaded?.()
      unError?.()
    }
  }, [])

  const handleCheck = async () => {
    setError(null)
    setChecking(true)
    try {
      await window.electronAPI?.app?.checkUpdate?.()
    } catch (e) {
      setError((e as Error).message)
      setChecking(false)
    }
  }

  const handleSimulate = async () => {
    setError(null)
    try {
      await (window.electronAPI?.app as any)?.simulateUpdate?.('0.2.0')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleDownload = async () => {
    setError(null)
    setDownloading(true)
    try {
      await window.electronAPI?.app?.downloadUpdate?.()
    } catch (e) {
      setError((e as Error).message)
      setDownloading(false)
    }
  }

  const handleInstall = async () => {
    try {
      await window.electronAPI?.app?.installUpdate?.()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Card className="border border-[var(--glass-border)] bg-[var(--glass-bg)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" />
              {t('settings.updateTitle', { defaultValue: '软件更新' })}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('settings.currentVersion', { defaultValue: '当前版本' })}: <span className="font-mono font-medium text-foreground">v{currentVersion}</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Simulation button for testing/demo */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSimulate}
              disabled={checking || downloading}
              className="text-xs h-8"
              title="模拟有新版本可用（用于测试完整升级流程）"
            >
              <ArrowUpCircle className="h-3.5 w-3.5 mr-1 text-[var(--accent-primary)]" />
              模拟升级测试
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleCheck}
              disabled={checking || downloading}
              className="text-xs h-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checking ? 'animate-spin' : ''}`} />
              {checking ? t('settings.checkingUpdates', { defaultValue: '检查中...' }) : t('settings.checkUpdates', { defaultValue: '检查更新' })}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {downloaded && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              <div>
                <p className="font-medium text-green-600 dark:text-green-400">新版本 v{updateInfo?.version || '最新'} 已就绪</p>
                <p className="text-muted-foreground">重启客户端后即可完成更新</p>
              </div>
            </div>
            <Button size="sm" onClick={handleInstall} className="h-7 text-xs bg-green-600 hover:bg-green-700">
              立即重启安装
            </Button>
          </div>
        )}

        {downloading && progress && (
          <div className="p-3 rounded-lg bg-muted/40 space-y-2 text-xs">
            <div className="flex justify-between font-medium">
              <span>正在下载更新...</span>
              <span className="tabular-nums">{progress.percent.toFixed(1)}%</span>
            </div>
            <Progress value={progress.percent} className="h-1.5" />
            <div className="flex justify-between text-muted-foreground text-[11px] tabular-nums">
              <span>{(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s</span>
              <span>{(progress.transferred / 1024 / 1024).toFixed(1)} MB / {(progress.total / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          </div>
        )}

        {available && !downloaded && !downloading && (
          <div className="p-3 rounded-lg bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="text-[10px] px-1.5 py-0">NEW</Badge>
                <span className="font-semibold text-foreground">发现新版本 v{updateInfo?.version}</span>
              </div>
              <Button size="sm" onClick={handleDownload} className="h-7 text-xs">
                <Download className="h-3 w-3 mr-1" />
                立即下载
              </Button>
            </div>
            {updateInfo?.releaseNotes && (
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-sans bg-background/50 p-2 rounded border border-border/40">
                {updateInfo.releaseNotes}
              </pre>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        {!available && !checking && !downloaded && !downloading && !error && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <CheckCircle className="h-3.5 w-3.5 text-green-500/70" />
            <span>当前已是最新版本</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
