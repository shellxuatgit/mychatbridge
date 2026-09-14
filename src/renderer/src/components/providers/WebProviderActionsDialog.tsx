/**
 * Web Provider Actions Dialog
 *
 * Single entry point for the three web-provider actions (chatgpt-web /
 * doubao-web) defined in the Task 8 UI spec:
 *
 *   1. Connect        - launch the managed Chromium browser to sign in
 *   2. Import Browser - scan Chrome/Edge cookies (ChatGPT / Doubao)
 *   3. Manual Token   - reuse the existing AddAccountDialog flow
 *
 * The dialog lets the user pick the browser to import from (Connect uses the
 * bundled managed Chromium), then delegates the actual IPC calls back to
 * Providers.tsx.
 */

import { useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

export type WebProviderAction = 'connect' | 'importBrowser' | 'manualToken'
export type WebProviderBrowser = 'chrome' | 'edge'

interface WebProviderActionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: WebProviderAction | null
  providerName: string
  isBusy: boolean
  busyLabel?: string
  onConnect: () => void
  onImportBrowser: (browser: WebProviderBrowser) => void
  onManualToken: () => void
}

export function WebProviderActionsDialog({
  open,
  onOpenChange,
  action,
  providerName,
  isBusy,
  busyLabel,
  onConnect,
  onImportBrowser,
  onManualToken,
}: WebProviderActionsDialogProps) {
  const { t } = useTranslation()
  const [browser, setBrowser] = useState<WebProviderBrowser>('chrome')

  const handlePrimary = () => {
    if (action === 'connect') {
      onConnect()
    } else if (action === 'importBrowser') {
      onImportBrowser(browser)
    } else if (action === 'manualToken') {
      onManualToken()
    }
  }

  const isConnect = action === 'connect'
  const isImport = action === 'importBrowser'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {isConnect
              ? t('providers.connect')
              : isImport
                ? t('providers.importBrowser')
                : t('providers.manualToken')}
          </DialogTitle>
          <DialogDescription>
            {isConnect
              ? t('providers.connectDesc')
              : isImport
                ? t('providers.importBrowserDesc')
                : t('providers.manualTokenDesc')}{' '}
            - {providerName}
          </DialogDescription>
        </DialogHeader>

        {isImport && (
          <div className="space-y-2 mt-2">
            <Label htmlFor="web-import-browser">{t('providers.browserPlaceholder')}</Label>
            <Select value={browser} onValueChange={(v) => setBrowser(v as WebProviderBrowser)}>
              <SelectTrigger id="web-import-browser">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chrome">{t('providers.browserChrome')}</SelectItem>
                <SelectItem value="edge">{t('providers.browserEdge')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('providers.importBrowserDesc')}</p>
          </div>
        )}

        {isConnect && (
          <p className="text-sm text-muted-foreground mt-2">
            {t('providers.connectDesc')} - {providerName}
          </p>
        )}

        {action === 'manualToken' && (
          <p className="text-sm text-muted-foreground mt-2">
            {t('providers.manualTokenDesc')} {t('providers.manageAllAccounts')}
          </p>
        )}

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handlePrimary} disabled={isBusy}>
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {busyLabel || t('common.loading')}
              </>
            ) : (
              t(isConnect ? 'providers.connect' : isImport ? 'providers.importBrowser' : 'providers.manualToken')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default WebProviderActionsDialog