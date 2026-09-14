export function getVarint(buf: Buffer, pos: number): { value: number; next: number } {
  let result = 0
  let shift = 0
  let i = pos
  while (i < buf.length) {
    const b = buf[i++]
    result |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
    if (shift > 28) break
  }
  return { value: result, next: i }
}

export function snappyUncompress(input: Buffer): Buffer {
  const out: number[] = []
  let ip = 0
  while (ip < input.length) {
    const tag = input[ip++]
    const type = tag & 0x03
    if (type === 0) {
      const rel = (tag >> 2) & 0x3f
      let length: number
      if (rel < 60) {
        length = rel + 1
      } else {
        const n = rel - 59
        length = 0
        for (let i = 0; i < n; i++) length |= input[ip + i] << (8 * i)
        ip += n
        length += 1
      }
      if (ip + length > input.length) throw new Error('snappy: literal overruns input')
      for (let i = 0; i < length; i++) out.push(input[ip++])
    } else if (type === 1) {
      const length = 4 + ((tag >> 2) & 0x07)
      const offset = ((tag & 0xe0) << 3) | input[ip]
      ip += 1
      copyBack(out, offset, length)
    } else if (type === 2) {
      const length = 1 + (tag >> 2)
      let offset = input[ip] | (input[ip + 1] << 8)
      ip += 2
      if (offset === 0) offset = 65536
      copyBack(out, offset, length)
    } else {
      const length = 1 + (tag >> 2)
      const offset = input[ip] | (input[ip + 1] << 8) | (input[ip + 2] << 16) | (input[ip + 3] << 24)
      ip += 4
      copyBack(out, offset, length)
    }
  }
  return Buffer.from(out)
}

function copyBack(out: number[], offset: number, length: number): void {
  for (let i = 0; i < length; i++) out.push(out[out.length - offset])
}