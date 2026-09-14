import { useState } from 'react'
import deepseekIcon from '@/assets/providers/deepseek.svg'
import glmIcon from '@/assets/providers/glm.svg'
import kimiIcon from '@/assets/providers/kimi.svg'
import mimoIcon from '@/assets/providers/mimo.svg'
import minimaxIcon from '@/assets/providers/minimax.svg'
import perplexityIcon from '@/assets/providers/perplexity.svg'
import qwenIcon from '@/assets/providers/qwen.svg'
import zaiIcon from '@/assets/providers/zai.svg'
import chatgptIcon from '@/assets/providers/chatgpt.svg'
import claudeIcon from '@/assets/providers/claude.svg'
import { cn } from '@/lib/utils'
import { resolveLogoSource } from '@/lib/providerLogoSource'

export const providerIconMap: Record<string, string> = {
  deepseek: deepseekIcon,
  glm: glmIcon,
  kimi: kimiIcon,
  mimo: mimoIcon,
  minimax: minimaxIcon,
  perplexity: perplexityIcon,
  qwen: qwenIcon,
  'qwen-ai': qwenIcon,
  zai: zaiIcon,
  chatgpt: chatgptIcon,
  'chatgpt-web': chatgptIcon,
  claude: claudeIcon,
}

const brandColors: Record<string, string> = {
  deepseek: '#4d6bfe',
  glm: '#10a37f',
  kimi: '#1a1a1a',
  'chatgpt-web': '#10a37f',
  chatgpt: '#10a37f',
  claude: '#d97757',
  gemini: '#4b8bf5',
  mimo: '#ff6f00',
  minimax: '#6c5ce7',
  perplexity: '#20b8cd',
  qwen: '#615ced',
  'qwen-ai': '#615ced',
  zai: '#615ced',
  yuanbao: '#ff4d4f',
  'doubao-web': '#00b96b',
}

interface ProviderLogoProps {
  providerId: string
  name?: string
  size?: 'sm' | 'md'
  className?: string
  logoUrl?: string
}

export function ProviderLogo({ providerId, name, size = 'md', className, logoUrl }: ProviderLogoProps) {
  const localIcon = providerIconMap[providerId]
  const color = brandColors[providerId] || 'var(--accent-primary)'
  const initial = (name || providerId).trim().charAt(0).toUpperCase() || '?'

  // Priority: bundled local icon -> remote logoUrl -> initial letter.
  // Local icons win so packaged/offline builds never hit dead or
  // cross-origin-blocked upstream logo URLs.
  const [netFailed, setNetFailed] = useState(false)
  const source = resolveLogoSource({
    providerId,
    logoUrl,
    netFailed,
    hasLocalIcon: (id) => Boolean(providerIconMap[id]),
  })

  if (source === 'local' && localIcon) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl overflow-hidden flex-shrink-0',
          providerId === 'kimi' ? 'bg-black' : 'bg-[var(--accent-primary)]/10',
          size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
          className
        )}
      >
        <img src={localIcon} alt={name || providerId} className="object-contain" style={size === 'sm' ? { width: 20, height: 20 } : { width: 26, height: 26 }} />
      </div>
    )
  }

  if (source === 'network') {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl overflow-hidden flex-shrink-0',
          providerId === 'kimi' ? 'bg-black' : 'bg-[var(--accent-primary)]/10',
          size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
          className
        )}
      >
        <img
          src={logoUrl}
          alt={name || providerId}
          className="object-contain"
          style={size === 'sm' ? { width: 20, height: 20 } : { width: 26, height: 26 }}
          onError={() => setNetFailed(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-xl font-semibold text-white flex-shrink-0',
        size === 'sm' ? 'h-8 w-8 text-sm' : 'h-10 w-10 text-base',
        className
      )}
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  )
}