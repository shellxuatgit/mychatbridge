import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ProviderLogo } from '@/lib/providerIcons'
import { formatTokenCount } from '@/components/dashboard/ProviderStatusCard'
import type { Provider } from '@/types/electron'
import { Coins, GripVertical, Plus, RefreshCw, Settings, Trash2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ProviderUiStatus = 'connected' | 'connect' | 'connecting' | 'error'

interface ProviderRowProps {
  provider: Provider
  uiStatus: ProviderUiStatus
  accountCount: number
  totalTokens?: number
  logoUrl?: string
  draggable?: boolean
  isDragOver?: boolean
  onConnect: (provider: Provider) => void
  onOpenBrowser?: (provider: Provider) => void
  onAddAccount: (provider: Provider) => void
  onTestConnection: (provider: Provider) => void
  onManage: (provider: Provider) => void
  onRemove: (provider: Provider) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropOnto: (id: string) => void
}

const statusRender: Record<ProviderUiStatus, { dot: string; label: string }> = {
  connected: { dot: 'bg-[var(--success)]', label: 'home.statusConnected' },
  connect: { dot: 'bg-[var(--text-dim)]', label: 'home.statusConnect' },
  connecting: { dot: 'bg-[var(--warning)] animate-pulse', label: 'home.statusConnecting' },
  error: { dot: 'bg-[var(--error)]', label: 'home.statusError' },
}

export function ProviderRow({
  provider,
  uiStatus,
  accountCount,
  totalTokens,
  logoUrl,
  draggable = true,
  isDragOver,
  onConnect,
  onAddAccount,
  onTestConnection,
  onManage,
  onRemove,
  onDragStart,
  onDragEnd,
  onDropOnto,
}: ProviderRowProps) {
  const { t } = useTranslation()
  const name = t(`${provider.id}.name`, { defaultValue: provider.name })
  const status = statusRender[uiStatus]

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', provider.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(provider.id)
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDropOnto(provider.id)
      }}
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-3 transition-colors',
        isDragOver ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'hover:bg-[var(--glass-bg-hover)]'
      )}
    >
      <span
        className="cursor-grab text-[var(--text-dim)] select-none flex items-center flex-shrink-0 opacity-60 group-hover:opacity-100"
        title={t('home.dragToReorder')}
      >
        <GripVertical className="h-4 w-4" />
      </span>

      <ProviderLogo providerId={provider.id} name={name} logoUrl={logoUrl} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{name}</span>
          {totalTokens ? (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20"
              title={`${totalTokens.toLocaleString()} tokens`}
            >
              <Coins className="h-3 w-3 shrink-0" />
              <span>{formatTokenCount(totalTokens)} Token</span>
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-normal tabular-nums text-muted-foreground/60 bg-muted/30 border border-border/40"
              title={t('dashboard.noTokenData')}
            >
              <Coins className="h-3 w-3 shrink-0 opacity-50" />
              <span>0 Token</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {t('home.accountCount', { count: accountCount })}
        </p>
      </div>

      <button
        onClick={() => onConnect(provider)}
        className={cn(
          'flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors',
          uiStatus === 'connected'
            ? 'text-[var(--success)]'
            : uiStatus === 'error'
              ? 'text-[var(--error)]'
              : 'text-muted-foreground hover:text-[var(--accent-primary)]'
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', status.dot)} />
        {t(status.label)}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onAddAccount(provider)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('home.addAccount')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onTestConnection(provider)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('home.testConnection')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onManage(provider)}>
            <Users className="mr-2 h-4 w-4" />
            {t('home.providerSettings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onRemove(provider)} className="text-destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            {t('providers.deleteProvider')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
