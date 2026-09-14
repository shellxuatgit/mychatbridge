import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/hooks/useTheme'
import { useSettingsStore, type Language } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { MoreHorizontal, Globe, Plus, Moon, Sun, Palette, FileText, Settings } from 'lucide-react'
import logoIcon from '@/assets/icons/icons.png'

export function Header() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { language, setLanguage } = useSettingsStore()
  const { theme, setTheme } = useTheme()
  const setAddProviderOpen = useUiStore((state) => state.setAddProviderOpen)

  return (
    <header className="glass-topbar flex items-center justify-between px-4 drag-region h-12 flex-shrink-0">
      <div className="flex items-center gap-3 no-drag">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center gap-3 cursor-pointer select-none transition-opacity hover:opacity-80"
          title={t('header.goHome')}
        >
          <div className="sidebar-logo-icon">
            <img src={logoIcon} alt="MyChatBridge" className="h-7 w-7 object-contain" />
          </div>
          <span className="text-base font-bold text-[var(--text-primary)] leading-tight">MyChatBridge</span>
        </button>
      </div>

      <div className="flex items-center gap-4 no-drag">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-300 group"
              title={t('header.language')}
            >
              <Globe className="h-4 w-4 text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('header.language')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={language} onValueChange={(v) => setLanguage(v as Language)}>
              {([
                ['zh-CN', '简体中文'],
                ['zh-TW', '繁體中文'],
                ['en-US', 'English'],
                ['ja-JP', '日本語'],
                ['ko-KR', '한국어'],
                ['es-ES', 'Español'],
                ['fr-FR', 'Français'],
                ['de-DE', 'Deutsch'],
                ['ru-RU', 'Русский'],
              ] as const).map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-300 group"
              title={t('header.more')}
            >
              <MoreHorizontal className="h-4 w-4 text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setAddProviderOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('header.addProvider')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="mr-2 h-4 w-4" />
                {t('header.appearance')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
                  <DropdownMenuRadioItem value="light">
                    <Sun className="mr-2 h-4 w-4" />
                    {t('settings.themeLight')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon className="mr-2 h-4 w-4" />
                    {t('settings.themeDark')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">{t('settings.themeSystem')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => navigate('/logs')}>
              <FileText className="mr-2 h-4 w-4" />
              {t('header.usageLogs')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              {t('header.settings')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}