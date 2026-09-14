import { Home } from './Home'
import { OverviewQuickControls } from './OverviewQuickControls'
import { useTranslation } from 'react-i18next'
import './Overview.css'

/**
 * Phase 1 Overview shell.
 *
 * Home already owns the provider, Local API and API key interactions. This
 * shell gives that workspace the new information hierarchy without deleting
 * the legacy Home implementation that will be refactored further in later
 * phases.
 */
export function Overview() {
  const { t } = useTranslation()

  return (
    <div className="phase1-overview">
      <header className="phase1-overview-header flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('overview.title', { defaultValue: 'Overview' })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('overview.subtitle', { defaultValue: 'Local API, API keys and providers' })}</p>
        </div>
        <OverviewQuickControls />
      </header>
      <Home />
    </div>
  )
}

export default Overview
