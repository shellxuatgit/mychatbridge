// Build a Windows .ico from the rendered PNG sizes (pure Node).
import { readFileSync, writeFileSync } from 'fs'

const sizes = [16, 32, 48, 64, 128, 256]
const images = sizes.map((s) => ({
  size: s,
  data: readFileSync(`build/icons/${s}x${s}.png`),
}))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(images.length, 4)

const dir = []
let offset = 6 + 16 * images.length
for (const img of images) {
  const e = Buffer.alloc(16)
  e[0] = img.size >= 256 ? 0 : img.size
  e[1] = img.size >= 256 ? 0 : img.size
  e[2] = 0 // palette
  e[3] = 0 // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(img.data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += img.data.length
  dir.push(e)
}

writeFileSync('build/icon.ico', Buffer.concat([header, ...dir, ...images.map((i) => i.data)]))
console.log('icon.ico written', offset, 'bytes')
