/**
 * ChatGPT Stream Handler
 * Consumes the upstream ChatGPT SSE stream, parses it into deltas via the pure
 * parser, and re-emits OpenAI `chat.completion.chunk` SSE events.
 */

import { PassThrough } from 'stream'
import {
  createChatGptParseState,
  parseChatGptChunk,
} from './chatgpt/sse-parser.ts'
import { WebProviderError } from '../core/providerContract.ts'

export class ChatGPTStreamHandler {
  private model: string
  private sessionId: string
  private isFirstChunk: boolean = true
  private created: number

  constructor(model: string, sessionId: string, onEnd?: () => void) {
    this.model = model
    this.sessionId = sessionId
    this.created = Math.floor(Date.now() / 1000)
    void onEnd
  }

  private createChunk(delta: any, finishReason: string | null = null): string {
    return `data: ${JSON.stringify({
      id: this.sessionId,
      model: this.model,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      created: this.created,
    })}\n\n`
  }

  /**
   * Parse the upstream ChatGPT stream and emit OpenAI SSE chunks.
   */
  async handleStream(stream: NodeJS.ReadableStream): Promise<NodeJS.ReadableStream> {
    const transStream = new PassThrough()
    let state = createChatGptParseState()
    let completed = false

    transStream.write(this.createChunk({ role: 'assistant', content: '' }))

    const onData = (chunk: Buffer) => {
      const result = parseChatGptChunk(chunk, state)
      state = result.state

      if (result.error) {
        transStream.write(this.createChunk({ content: `\n\n[Error: ${result.error}]` }, 'stop'))
        transStream.write('data: [DONE]\n\n')
        transStream.end()
        return
      }

      for (const delta of result.deltas) {
        transStream.write(this.createChunk({ content: delta }))
      }

      if (result.completed && !completed) {
        completed = true
        transStream.write(this.createChunk({}, 'stop'))
        transStream.write('data: [DONE]\n\n')
        transStream.end()
      }
    }

    stream.on('data', onData)
    stream.on('end', () => {
      if (!completed) {
        // Upstream stream ended without [DONE]/done flag: report invalid.
        if (state.accumulatedText) {
          transStream.write(this.createChunk({}, 'stop'))
        }
        transStream.write('data: [DONE]\n\n')
        transStream.end()
      }
    })
    stream.on('error', () => {
      transStream.write(this.createChunk({ content: `\n\n[Error: ${WebProviderError.invalidResponse().message}]` }, 'stop'))
      transStream.write('data: [DONE]\n\n')
      transStream.end()
    })

    return transStream
  }

  /**
   * Buffer the upstream stream, then return the complete OpenAI JSON response.
   */
  async handleNonStream(stream: NodeJS.ReadableStream): Promise<any> {
    let state = createChatGptParseState()
    let completed = false

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        const result = parseChatGptChunk(chunk, state)
        state = result.state
        if (result.error) {
          reject(WebProviderError.upstream(result.error))
        }
        if (result.completed) completed = true
      })
      stream.on('end', resolve)
      stream.on('error', reject)
    })

    return {
      id: this.sessionId,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: state.accumulatedText,
        },
        finish_reason: completed ? 'stop' : 'length',
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    }
  }
}

export default ChatGPTStreamHandler