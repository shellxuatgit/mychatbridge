import deepseekConfig from './deepseek.ts'
import glmConfig from './glm.ts'
import kimiConfig from './kimi.ts'
import minimaxConfig from './minimax.ts'
import mimoConfig from './mimo.ts'
import perplexityConfig from './perplexity.ts'
import qwenConfig from './qwen.ts'
import qwenAiConfig from './qwen-ai.ts'
import zaiConfig from './zai.ts'
import chatgptConfig from './chatgpt.ts'
import claudeConfig from './claude.ts'
import geminiConfig from './gemini.ts'
import yuanbaoConfig from './yuanbao.ts'
import type { BuiltinProviderConfig } from '../../store/types.ts'

/**
 * API-first built-in providers.
 * Legacy browser/web provider configs are intentionally kept out of the
 * active provider catalog so they cannot appear in Provider Management.
 */
export const builtinProviders: BuiltinProviderConfig[] = [
  deepseekConfig,
  glmConfig,
  kimiConfig,
  minimaxConfig,
  mimoConfig,
  perplexityConfig,
  qwenConfig,
  qwenAiConfig,
  zaiConfig,
  chatgptConfig,
  claudeConfig,
  geminiConfig,
  yuanbaoConfig,
]

export const builtinProviderMap: Record<string, BuiltinProviderConfig> = {
  deepseek: deepseekConfig,
  glm: glmConfig,
  kimi: kimiConfig,
  minimax: minimaxConfig,
  mimo: mimoConfig,
  perplexity: perplexityConfig,
  qwen: qwenConfig,
  'qwen-ai': qwenAiConfig,
  zai: zaiConfig,
  chatgpt: chatgptConfig,
  claude: claudeConfig,
  gemini: geminiConfig,
  yuanbao: yuanbaoConfig,
}

export function getBuiltinProvider(id: string): BuiltinProviderConfig | undefined {
  return builtinProviderMap[id]
}

export function getBuiltinProviders(): BuiltinProviderConfig[] {
  return builtinProviders
}

export {
  deepseekConfig,
  glmConfig,
  kimiConfig,
  minimaxConfig,
  mimoConfig,
  perplexityConfig,
  qwenConfig,
  qwenAiConfig,
  zaiConfig,
  chatgptConfig,
  claudeConfig,
  geminiConfig,
  yuanbaoConfig,
}

export default builtinProviders
