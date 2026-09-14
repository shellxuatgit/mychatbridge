import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTokenCount } from './ProviderStatusCard'
import type { ProviderStats } from './ProviderStatusCard'

export interface TokenUsageCardProps {
  providers: ProviderStats[]
  todayTokens: number
  totalTokens: number
  tokenTrend?: { date: string; tokens: number }[]
  className?: string
}

export function TokenUsageCard({ providers, todayTokens, totalTokens, tokenTrend, className }: TokenUsageCardProps) {
  const { t } = useTranslation()

  const ranked = providers
    .filter((p) => (p.totalTokens ?? 0) > 0)
    .sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0))
    .slice(0, 8)
  const max = ranked[0]?.totalTokens ?? 0
  const trendMax = Math.max(...(tokenTrend?.map((d) => d.tokens) ?? [0]), 0)

  return (
    <Card className={cn('h-full flex flex-col', className)}>
      <CardHeader className="pb-2 flex-shrink-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="h-7 w-7 rounded-lg bg-[var(--accent-primary)]/10 flex items-center justify-center">
            <Coins className="h-4 w-4 text-[var(--accent-primary)]" />
          </div>
          {t('dashboard.tokenRanking')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-4 pt-0 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-muted/30">
            <span className="text-muted-foreground">{t('dashboard.todayTokens')}</span>
            <p className="font-medium">{formatTokenCount(todayTokens)} Token</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/30">
            <span className="text-muted-foreground">{t('dashboard.totalTokens')}</span>
            <p className="font-medium">{formatTokenCount(totalTokens)} Token</p>
          </div>
        </div>
        {tokenTrend && trendMax > 0 && (
          <div className="flex items-end gap-1 h-10" title={t('dashboard.tokenTrend')}>
            {tokenTrend.map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div
                  className="w-full rounded-sm bg-[var(--accent-primary)]/60"
                  style={{ height: day.tokens > 0 ? `${Math.max(8, (day.tokens / trendMax) * 100)}%` : '4%' }}
                />
                <span className="text-[10px] text-muted-foreground">{day.date}</span>
              </div>
            ))}
          </div>
        )}
        {ranked.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center text-muted-foreground py-4">
            {t('dashboard.noTokenData')}
          </div>
        ) : (
          <div className="space-y-2">
            {ranked.map((provider) => (
              <div key={provider.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate">{provider.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatTokenCount(provider.totalTokens ?? 0)} Token
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-300"
                    style={{ width: max > 0 ? `${Math.max(2, ((provider.totalTokens ?? 0) / max) * 100)}%` : '0%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
