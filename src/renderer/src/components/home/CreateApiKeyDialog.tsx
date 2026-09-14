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
import { useToast } from '@/hooks/use-toast'
import { generateApiKey, generateId } from '@/lib/apiKeyUtils'
import type { ApiKey } from '@/types/electron'
import { Check, Copy, KeyRound } from 'lucide-react'

export const API_KEY_CREATED_EVENT = 'api-key-created'

interface CreateApiKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (key: ApiKey) => Promise<void>
}

export function CreateApiKeyDialog({ open, onOpenChange, onCreate }: CreateApiKeyDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [createdKey, setCreatedKey] = useState<ApiKey | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setCreatedKey(null)
      setIsSubmitting(false)
      setCopied(false)
    }
  }, [open])

  const handleCreate = async () => {
    if (!name.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      const key: ApiKey = {
        id: generateId(),
        name: name.trim(),
        key: generateApiKey(),
        enabled: true,
        createdAt: Date.now(),
        usageCount: 0,
      }
      await onCreate(key)
      setCreatedKey(key)
    } catch (error) {
      toast({
        title: t('apiKeys.createFailed'),
        description: error instanceof Error ? error.message : t('apiKeys.createApiKeyDesc'),
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopy = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('apiKeys.keyCreated')}</DialogTitle>
              <DialogDescription>{t('apiKeys.showOnceWarning')}</DialogDescription>
            </DialogHeader>
            <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted p-3">
              <code className="flex-1 text-sm break-all font-mono">{createdKey.key}</code>
              <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <DialogFooter className="mt-2">
              <Button
                onClick={() => {
                  setCreatedKey(null)
                  onOpenChange(false)
                }}
              >
                {t('common.done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                {t('apiKeys.createApiKey')}
              </DialogTitle>
              <DialogDescription>{t('apiKeys.createApiKeyDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 mt-2">
              <Label htmlFor="key-name">{t('apiKeys.keyName')}</Label>
              <Input
                id="key-name"
                placeholder={t('apiKeys.keyNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim() || isSubmitting}>
                {t('apiKeys.create')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}