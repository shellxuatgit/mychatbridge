/**
 * Drive the GLM adapter directly (production code path) to surface the real
 * upstream error behind the Local API's opaque 500.
 *
 *   npx tsx scripts/_glm-direct.ts
 *
 * This imports the same GLMAdapter the proxy uses, with the account credentials
 * read from the app's own store via the Management API.
 */
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'
import axios from 'axios'
import crypto from 'crypto'

const SIGN_SECRET = '8a1317a7468aa3ad86e997d08f3f31cb'

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function generateSign(): { timestamp: string; nonce: string; sign: string } {
  const e = Date.now()
  const A = e.toString()
  const t = A.length
  const o = A.split('').map((c) => Number(c))
  const i = o.reduce((acc, val) => acc + val, 0) - o[t - 2]
  const a = i % 10
  const timestamp = A.substring(0, t - 2) + a + A.substring(t - 1, t)
  const nonce = uuid()
  const sign = crypto.createHash('md5').update(`${timestamp}-${nonce}-${SIGN_SECRET}`).digest('hex')
  return { timestamp, nonce, sign }
}

function secret(): string {
  return readFileSync(join(homedir(), '.mychatbridge', 'management-secret.txt'), 'utf8').trim()
}

async function readRefreshTokenFromProfile(): Promise<string> {
  const { chromium } = await import('playwright')
  const dir = join(homedir(), '.mychatbridge', 'web-runtime', 'playwright-users', 'glm')
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chrome' })
  try {
    const cookies = await ctx.cookies()
    const c = cookies.find((x) => x.name === 'chatglm_refresh_token')
    if (!c) throw new Error('chatglm_refresh_token not found in profile')
    return c.value
  } finally {
    await ctx.close().catch(() => {})
  }
}

async function main(): Promise<void> {
  const refreshToken = await readRefreshTokenFromProfile()
  console.log('refresh_token: len =', refreshToken.length)

  // --- Step 1: refresh ---
  const sign = generateSign()
  const refreshRes = await axios.post(
    'https://chatglm.cn/chatglm/user-api/user/refresh',
    {},
    {
      headers: {
        Authorization: `Bearer ${refreshToken}`,
        'Content-Type': 'application/json',
        Origin: 'https://chatglm.cn',
        Referer: 'https://chatglm.cn/',
        'App-Name': 'chatglm',
        'X-App-Platform': 'pc',
        'X-App-Version': '0.0.1',
        'X-Device-Id': sign.nonce,
        'X-Nonce': sign.nonce,
        'X-Request-Id': sign.nonce,
        'X-Sign': sign.sign,
        'X-Timestamp': sign.timestamp,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      },
      timeout: 20000,
      validateStatus: () => true,
    }
  )
  console.log('\n--- step 1: /user-api/user/refresh ---')
  console.log('http:', refreshRes.status)
  const rd = (refreshRes.data || {}) as Record<string, unknown>
  console.log('code:', rd.code, '| status:', rd.status, '| message:', rd.message)
  const result = (rd.result || {}) as Record<string, unknown>
  const accessToken = result.access_token as string | undefined
  console.log('access_token present:', Boolean(accessToken))
  if (!accessToken) {
    console.log('body:', JSON.stringify(refreshRes.data).slice(0, 600))
    process.exit(1)
  }

  // --- Step 2: chat ---
  // Mirrors GLMAdapter.chatCompletion exactly (meta_data + preparedMessages shape)
  const arg = process.argv[2] || 'adapter'
  const body =
    arg === 'simple'
      ? {
          assistant_id: '65940acff94777010aa6b796',
          conversation_id: '',
          project_id: '',
          chat_type: 'user_chat',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] },
          ],
          meta_data: { if_plus_model: false, is_test: false, input_tool: 'chat_tool' },
          model: '',
          temperature: 0.6,
          stream: true,
        }
      : {
          assistant_id: '65940acff94777010aa6b796',
          conversation_id: '',
          project_id: '',
          chat_type: 'user_chat',
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] },
          ],
          meta_data: {
            channel: '',
            chat_mode: undefined,
            draft_id: '',
            if_plus_model: true,
            input_question_type: 'xxxx',
            is_networking: false,
            is_test: false,
            platform: 'pc',
            quote_log_id: '',
            cogview: { rm_label_watermark: false },
          },
        }
  console.log(`\n(using "${arg}" request body)`)
  const chatSign = generateSign()
  const chatRes = await axios.post(
    'https://chatglm.cn/chatglm/backend-api/assistant/stream',
    body,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Origin: 'https://chatglm.cn',
        Referer: 'https://chatglm.cn/',
        'App-Name': 'chatglm',
        'X-App-Platform': 'pc',
        'X-App-Version': '0.0.1',
        'X-Device-Id': chatSign.nonce,
        'X-Nonce': chatSign.nonce,
        'X-Request-Id': chatSign.nonce,
        'X-Sign': chatSign.sign,
        'X-Timestamp': chatSign.timestamp,
        'X-Lang': 'zh',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      },
      timeout: 60000,
      responseType: 'text',
      validateStatus: () => true,
    }
  )
  console.log('\n--- step 2: /backend-api/assistant/stream ---')
  console.log('http  :', chatRes.status)
  const text = typeof chatRes.data === 'string' ? chatRes.data : JSON.stringify(chatRes.data)
  console.log('bytes :', text.length)
  console.log('head  :', text.slice(0, 700).replace(/\n/g, '\\n'))
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
