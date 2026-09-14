/**
 * Smoke-test every provider through the Local API (/v1/chat/completions) and
 * report whether it answers and whether token usage is returned.
 *
 *   npx tsx scripts/_api-smoke.ts [modelFilter]
 */
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://127.0.0.1:${process.env.MCB_PORT || '8082'}/v1`
const KEY_FILE = join(homedir(), '.mychatbridge', 'api-test-key.txt')
const KEY =
  process.env.MCB_API_KEY ||
  (() => {
    try {
      return readFileSync(KEY_FILE, 'utf8').trim()
    } catch {
      return ''
    }
  })()

const MODELS = [
  'GLM-5.1',
  'Kimi-K2.6',
  'GLM-5-Turbo',
  'claude-sonnet-4.5-web',
  'hunyuan-t1',
  'Auto',
  'MiniMax-M2.7',
  'gemini-2.5-pro-web',
  'gpt-4o',
]

interface Result {
  model: string
  status: number
  ok: boolean
  content: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: string
  ms: number
}

async function test(model: string): Promise<Result> {
  const started = Date.now()
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复数字 42，不要任何其他内容' }],
        stream: false,
      }),
      signal: AbortSignal.timeout(180_000),
    })
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      /* non-json */
    }
    const content = json?.choices?.[0]?.message?.content ?? ''
    return {
      model,
      status: res.status,
      ok: res.ok && Boolean(content),
      content: typeof content === 'string' ? content.slice(0, 60) : JSON.stringify(content).slice(0, 60),
      usage: json?.usage,
      error: res.ok ? undefined : text.slice(0, 200),
      ms: Date.now() - started,
    }
  } catch (e) {
    return { model, status: 0, ok: false, content: '', error: (e as Error).message, ms: Date.now() - started }
  }
}

async function main(): Promise<void> {
  const filter = process.argv[2]
  const targets = filter ? MODELS.filter((m) => m.toLowerCase().includes(filter.toLowerCase())) : MODELS
  const results: Result[] = []
  for (const model of targets) {
    process.stdout.write(`\n→ ${model} ... `)
    const r = await test(model)
    results.push(r)
    process.stdout.write(r.ok ? 'OK' : 'FAIL')
    console.log(` (${r.ms}ms)`)
    console.log(`   content: ${JSON.stringify(r.content)}`)
    console.log(`   usage  : ${JSON.stringify(r.usage)}`)
    if (r.error) console.log(`   error  : ${r.error}`)
  }

  console.log('\n===== SUMMARY =====')
  for (const r of results) {
    const u = r.usage
    const usageStr = u ? `pt=${u.prompt_tokens ?? '-'} ct=${u.completion_tokens ?? '-'} tt=${u.total_tokens ?? '-'}` : 'usage=NONE'
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.model.padEnd(24)} status=${r.status} ${usageStr} ${r.error ? '| ' + r.error.slice(0, 60) : ''}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
