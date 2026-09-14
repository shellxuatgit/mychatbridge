const BASE = 'http://127.0.0.1:8082/v1'
const KEY = 'sk-mgmt-410747842c077f1520be8570e6d3bf24'

async function main(): Promise<void> {
  const model = process.argv[2] || 'Qwen3.7-Max'
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: '请回复数字 42' }],
      stream: true,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  console.log('status:', res.status)
  const reader = res.body?.getReader()
  if (!reader) return
  const dec = new TextDecoder()
  let buffer = ''
  const started = Date.now()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += dec.decode(value, { stream: true })
    if (buffer.length > 4000 || Date.now() - started > 60000) break
  }
  console.log(buffer.slice(0, 2500))
}

main().catch(console.error)
