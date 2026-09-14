/**
 * Chat-verify a provider through the Local API and assert token accounting.
 *
 *   npx tsx scripts/_chat-verify.ts <model> [providerId]
 *
 * Sends a non-stream request, then a stream request, and reports the usage each
 * one reported plus the per-provider token delta observed in /statistics.
 */
const BASE = 'http://127.0.0.1:8082/v1'
import { homedir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'

interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

interface StatsSnapshot {
  totalTokens: number
  providerTokens: Record<string, number>
}

function secret(): string {
  return readFileSync(join(homedir(), '.mychatbridge', 'management-secret.txt'), 'utf8').trim()
}

async function stats(): Promise<StatsSnapshot> {
  const res = await fetch('http://127.0.0.1:8082/v0/management/statistics', {
    headers: { 'X-Management-Secret': secret() },
  })
  const json = (await res.json()) as { data?: { providerTokens?: Record<string, { totalTokens?: number }> } }
  const providerTokens: Record<string, number> = {}
  let totalTokens = 0
  const raw = json.data?.providerTokens ?? {}
  for (const [k, v] of Object.entries(raw)) {
    providerTokens[k] = v?.totalTokens ?? 0
    totalTokens += v?.totalTokens ?? 0
  }
  return { totalTokens, providerTokens }
}

async function main(): Promise<void> {
  const model = process.argv[2]
  const providerId = process.argv[3] || model
  if (!model) {
    console.error('usage: npx tsx scripts/_chat-verify.ts <model> [providerId]')
    process.exit(1)
  }

  const before = await stats()
  console.log(`=== chat-verify ${model} (provider ${providerId}) ===`)
  console.log('baseline total tokens :', before.totalTokens)
  console.log(`baseline ${providerId} tokens:`, before.providerTokens[providerId] ?? 0)

  // ---- non-stream ----
  const t0 = Date.now()
  const nonStreamRes = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      stream: false,
    }),
  })
  const nonStreamBody = (await nonStreamRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: Usage
    error?: unknown
  }
  console.log('\n--- non-stream ---')
  console.log('http      :', nonStreamRes.status, `(${Date.now() - t0}ms)`)
  if (!nonStreamRes.ok) {
    console.log('error     :', JSON.stringify(nonStreamBody.error ?? nonStreamBody).slice(0, 400))
  } else {
    const text = nonStreamBody.choices?.[0]?.message?.content ?? ''
    console.log('reply     :', JSON.stringify(text.slice(0, 120)))
    console.log('usage     :', JSON.stringify(nonStreamBody.usage ?? null))
  }

  await new Promise((r) => setTimeout(r, 1500))

  // ---- stream ----
  const t1 = Date.now()
  const streamRes = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: STREAM_OK' }],
      stream: true,
    }),
  })
  let streamText = ''
  let sawDone = false
  let streamUsage: Usage | null = null
  if (streamRes.ok && streamRes.body) {
    const reader = streamRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') {
          sawDone = true
          continue
        }
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
            usage?: Usage
          }
          streamText += chunk.choices?.[0]?.delta?.content ?? ''
          if (chunk.usage) streamUsage = chunk.usage
        } catch {
          /* ignore malformed chunk */
        }
      }
    }
  }
  console.log('\n--- stream ---')
  console.log('http      :', streamRes.status, `(${Date.now() - t1}ms)`)
  console.log('saw [DONE]:', sawDone)
  console.log('reply     :', JSON.stringify(streamText.slice(0, 120)))
  console.log('usage     :', JSON.stringify(streamUsage))

  await new Promise((r) => setTimeout(r, 2000))

  const after = await stats()
  console.log('\n--- token accounting ---')
  const delta = after.totalTokens - before.totalTokens
  const providerDelta = (after.providerTokens[providerId] ?? 0) - (before.providerTokens[providerId] ?? 0)
  console.log('total delta    :', delta)
  console.log(`${providerId} delta   :`, providerDelta)
  console.log('after total    :', after.totalTokens)

  const ok = nonStreamRes.ok && streamRes.ok && sawDone && providerDelta > 0
  console.log('\nRESULT:', ok ? 'PASS' : 'FAIL')
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e)
  process.exit(1)
})
