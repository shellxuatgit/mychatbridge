/**
 * Proxy Service Module - Route Index
 * Export all routes
 */

import chatRouter from './chat.ts'
import anthropicRouter from './anthropic.ts'
import modelsRouter from './models.ts'
import completionsRouter from './completions.ts'
import multiRouter from './multi.ts'

export {
  chatRouter,
  anthropicRouter,
  modelsRouter,
  completionsRouter,
  multiRouter,
}

export default [
  anthropicRouter,
  chatRouter,
  modelsRouter,
  completionsRouter,
  multiRouter,
]
