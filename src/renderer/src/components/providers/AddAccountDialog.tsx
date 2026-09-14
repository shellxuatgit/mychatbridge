import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LegacyAddAccountDialog from './AddAccountDialogLegacy'
import type { ComponentProps } from 'react'

const AUTO_CONNECT_PROVIDERS = new Set([
  'chatgpt', 'deepseek', 'gemini', 'claude', 'glm', 'kimi', 'minimax',
  'qwen', 'qwen-ai', 'zai', 'mimo', 'perplexity', 'yuanbao',
])

type AddAccountDialogProps = ComponentProps<typeof LegacyAddAccountDialog>

export function AddAccountDialog(props: AddAccountDialogProps) {
  const { open, provider } = props
  const { i18n } = useTranslation()
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')

  const isEnglish = i18n.language === 'en-US' || i18n.language.startsWith('en')
  const text = isEnglish
    ? {
        autoFetch: 'Auto fetch',
        reading: 'Opening browser, please log in...',
        success: '✓ Auto fetch succeeded, credentials filled',
        missingField: 'Fetched successfully, but no credential field was found',
        notLoggedIn: (name: string) => `Please complete ${name} login in the opened browser window.`,
        unsupported: 'Auto fetch is not supported for this provider.',
        failed: 'Auto fetch failed. Please try again or fill manually.',
        title: 'Launch browser to log in and fetch credentials automatically',
        timeout: 'Login timed out. Please try again.',
        cancelled: 'Login cancelled.',
      }
    : {
        autoFetch: '自动获取',
        reading: '正在打开独立浏览器窗口，请在其中登录…',
        success: '✓ 自动获取成功，凭证已填入',
        missingField: '获取成功，但未找到可填入的凭证字段',
        notLoggedIn: (name: string) => `请在弹出的浏览器窗口中完成 ${name} 登录。`,
        unsupported: '暂不支持自动获取，请手动填写凭证。',
        failed: '自动获取失败，请重试或手动填入。',
        title: '弹出独立浏览器登录并自动提取凭证',
        timeout: '登录超时，请重试。',
        cancelled: '已取消登录。',
      }

  useEffect(() => {
    if (!open || !provider || !AUTO_CONNECT_PROVIDERS.has(provider.id)) {
      setHost(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const locateField = () => {
      const dialog = document.querySelector('[role="dialog"]')
      const textarea = dialog?.querySelector('textarea') as HTMLTextAreaElement | null
      if (!textarea) {
        timer = setTimeout(locateField, 100)
        return
      }

      const parent = textarea.parentElement
      if (!parent) return
      parent.classList.add('relative')
      let target = parent.querySelector('[data-auto-connect-host]') as HTMLElement | null
      if (!target) {
        target = document.createElement('div')
        target.dataset.autoConnectHost = 'true'
        target.className = 'absolute right-1 bottom-1'
        parent.appendChild(target)
      }
      if (!cancelled) setHost(target)
    }

    timer = setTimeout(locateField, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      setHost(null)
    }
  }, [open, provider?.id])

  const setFieldValue = (value: string) => {
    const dialog = document.querySelector('[role="dialog"]')
    const field = dialog?.querySelector('textarea') as HTMLTextAreaElement | null
    if (!field) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  const handleAutoConnect = async () => {
    if (!provider) return
    console.error(`[diag] renderer handleAutoConnect click providerId=${provider.id}`)
    setLoading(true)
    setStatus(text.reading)
    try {
      // 1. Try launching a dedicated Playwright browser window first.
      // This bypasses file locks, isolates cookies/localStorage, and lets
      // the user easily pass any Cloudflare/verification checkpoints.
      const pwResult = await window.electronAPI?.webRuntime?.playwrightLogin?.(provider.id)
      console.error(`[diag] renderer playwrightLogin result:`, pwResult)

      if (pwResult && pwResult.status === 'imported') {
        const credentials = pwResult.payload?.credentials || {}
        // Browser-managed providers (gemini): fill a placeholder since actual
        // auth is via the Playwright profile. Others: extract the token/cookie
        // value from the login payload.
        const browserManaged = provider.id === 'gemini'
        const fieldName = provider.id === 'deepseek' ? 'token'
          : provider.id === 'gemini' ? 'token'
          : provider.id === 'glm' ? 'refresh_token'
          : provider.id === 'qwen' ? 'ticket'
          : provider.id === 'perplexity' ? 'sessionToken'
          : provider.id === 'yuanbao' ? 'cookie'
          : 'token'
        const value = browserManaged
          ? 'browser-managed'
          : credentials[fieldName] || Object.values(credentials)[0]
        if (value && setFieldValue(value)) {
          setStatus(text.success)
          return
        }
        setStatus(text.missingField)
        return
      } else if (pwResult && pwResult.status === 'timeout') {
        setStatus(text.timeout)
        return
      } else if (pwResult && pwResult.status === 'cancelled') {
        setStatus(text.cancelled)
        return
      }

      // 2. Fallback to existing disk reader if Playwright browser was missing/unsupported
      const result = await window.electronAPI.webRuntime.autoConnect(provider.id)
      console.error(`[diag] renderer autoConnect fallback result status=${result.status}`, result)
      if (result.status === 'imported') {
        const credentials = result.payload.credentials || {}
        const fieldName = provider.id === 'deepseek' ? 'token' : 'cookie'
        const value = credentials[fieldName] || Object.values(credentials)[0]
        if (value && setFieldValue(value)) {
          setStatus(text.success)
        } else {
          setStatus(text.missingField)
        }
      } else if (result.status === 'opened') {
        setStatus(text.notLoggedIn(provider.name))
      } else {
        setStatus(text.unsupported)
      }
    } catch (error) {
      console.error('[diag] renderer handleAutoConnect threw:', error)
      console.error('[AddAccountDialog] auto fetch failed:', error)
      setStatus(error instanceof Error ? `${text.failed} (${error.message})` : text.failed)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <LegacyAddAccountDialog {...props} />
      {host && createPortal(
        <div className="flex items-center gap-1 rounded-md bg-background/95 px-1 shadow-sm">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleAutoConnect}
            disabled={loading}
            title={status || text.title}
          >
            {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            {text.autoFetch}
          </Button>
        </div>,
        host
      )}
      {open && status && (
        <div className="fixed bottom-6 right-6 z-[100] max-w-sm rounded-md border bg-background px-3 py-2 text-xs shadow-lg">
          {status}
        </div>
      )}
    </>
  )
}

export default AddAccountDialog