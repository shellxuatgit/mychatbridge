import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Sun, Moon, Languages, ArrowUpCircle, CheckCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTheme } from '@/hooks/useTheme'
import { useSettingsStore, type Language } from '@/stores/settingsStore'

export function OverviewQuickControls() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { language, setLanguage } = useSettingsStore()

  // Updater state
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [newVersion, setNewVersion] = useState<string>('')

  useEffect(() => {
    // Initial sync
    window.electronAPI?.app?.getUpdateStatus?.().then((s) => {
      if (!s) return
      setUpdateAvailable(s.available)
      setDownloading(s.downloading)
      setDownloaded(s.downloaded)
      if (s.version) setNewVersion(s.version)
    }).catch(() => null)

    const unAvailable = window.electronAPI?.app?.onUpdateAvailable?.((info) => {
      setUpdateAvailable(true)
      setDownloading(false)
      setDownloaded(false)
      if (info?.version) setNewVersion(info.version)
    })

    const unProgress = window.electronAPI?.app?.onUpdateProgress?.(() => {
      setDownloading(true)
      setUpdateAvailable(true)
    })

    const unDownloaded = window.electronAPI?.app?.onUpdateDownloaded?.((info) => {
      setDownloading(false)
      setDownloaded(true)
      setUpdateAvailable(true)
      if (info?.version) setNewVersion(info.version)
    })

    const unNotAvailable = window.electronAPI?.app?.onUpdateNotAvailable?.(() => {
      setUpdateAvailable(false)
      setDownloading(false)
      setDownloaded(false)
    })

    return () => {
      unAvailable?.()
      unProgress?.()
      unDownloaded?.()
      unNotAvailable?.()
    }
  }, [])

  const handleDirectUpgrade = async () => {
    if (downloaded) {
      // Ready to install -> quit and install
      await window.electronAPI?.app?.installUpdate?.()
    } else {
      // Available but not downloaded -> start download
      setDownloading(true)
      try {
        await window.electronAPI?.app?.downloadUpdate?.()
      } catch {
        setDownloading(false)
      }
    }
  }

  const isDark = theme === 'dark'
  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark')
  }

  const isZh = language === 'zh-CN'

  const languages: { value: Language; label: string }[] = [
    { value: 'zh-CN', label: '简体中文' },
    { value: 'zh-TW', label: '繁體中文' },
    { value: 'en-US', label: 'English' },
    { value: 'ja-JP', label: '日本語' },
    { value: 'ko-KR', label: '한국어' },
    { value: 'es-ES', label: 'Español' },
    { value: 'fr-FR', label: 'Français' },
    { value: 'de-DE', label: 'Deutsch' },
    { value: 'ru-RU', label: 'Русский' },
  ]

  // Tooltip content
  const upgradeTooltip = downloaded
    ? (isZh ? `新版本 ${newVersion ? 'v' + newVersion : ''} 已就绪，点击重启完成升级` : `Update ${newVersion ? 'v' + newVersion : ''} ready, click to restart and install`)
    : downloading
      ? (isZh ? '正在下载更新...' : 'Downloading update...')
      : (isZh ? `发现新版本 ${newVersion ? 'v' + newVersion : ''}，点击直接升级` : `New version ${newVersion ? 'v' + newVersion : ''} available, click to upgrade`)

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
        <SelectTrigger
          className="h-8 w-[92px] px-2.5 text-xs font-medium gap-1.5 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] text-foreground/80"
          aria-label={t('settings.language')}
        >
          <Languages className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {languages.map((item) => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Theme toggle: icon button with sun / moon */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        className="h-8 w-8 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] text-foreground/80 hover:text-foreground transition-all"
        title={isDark ? t('settings.themeLight') : t('settings.themeDark')}
        aria-label={isDark ? t('settings.themeLight') : t('settings.themeDark')}
      >
        {isDark ? (
          <Sun className="h-4 w-4 text-amber-400 hover:rotate-45 transition-transform" />
        ) : (
          <Moon className="h-4 w-4 text-slate-700 hover:-rotate-12 transition-transform" />
        )}
      </Button>

      {/* Upgrade icon button (only visible when an update is available/downloading/downloaded) */}
      {updateAvailable && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDirectUpgrade}
          disabled={downloading}
          className={`h-8 w-8 rounded-lg border transition-all ${
            downloaded
              ? 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 animate-pulse'
          }`}
          title={upgradeTooltip}
          aria-label={upgradeTooltip}
        >
          {downloaded ? (
            <CheckCircle className="h-4 w-4" />
          ) : downloading ? (
            <RefreshCw className="h-4 w-4 animate-spin text-amber-500" />
          ) : (
            <ArrowUpCircle className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  )
}

