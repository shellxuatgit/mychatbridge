// Pure-Node PNG rasterizer for the MyChatBridge gateway-portal logo.
// No native deps: SDF (signed distance field) AA rendering + zlib PNG encode.
import { deflateSync } from 'zlib'
import { writeFileSync } from 'fs'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---- SDF helpers (units in 32x32 space, scaled by s) ----
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r)
  const dy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r
}
function sdSeg(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay
  const bax = bx - ax, bay = by - ay
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - t * bax, pay - t * bay)
}
function cover(d, px) {
  // 1px soft AA edge
  const a = 0.5 - d / px
  return Math.max(0, Math.min(1, a))
}

const BG = [16, 16, 20], ACC = [91, 141, 239]
const U = 32

function render(size) {
  const s = size / U
  const rgba = Buffer.alloc(size * size * 4)
  const px = 1 // pixel size in unit space
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) / s, uy = (y + 0.5) / s
      let r = BG[0], g = BG[1], b = BG[2], a = 255

      // background rounded rect
      const d0 = sdRoundRect(ux, uy, 16, 16, 16, 16, 5)
      if (d0 > 0) { a = 0 } // outside canvas
      else {
        // frame ring (stroke width 2)
        const dF = Math.abs(sdRoundRect(ux, uy, 16, 16, 9, 9, 2)) - 1
        const cF = cover(dF, 1)
        if (cF > 0) { r = ACC[0]; g = ACC[1]; b = ACC[2]; a = 255 }
        // main diagonal (11,11)->(21,21), round cap width 2
        const dM = sdSeg(ux, uy, 11, 11, 21, 21) - 1
        const cM = cover(dM, 1)
        if (cM > 0) { r = ACC[0]; g = ACC[1]; b = ACC[2]; a = 255 }
        // anti diagonal (21,11)->(11,21) at 45%
        const dA = sdSeg(ux, uy, 21, 11, 11, 21) - 1
        const cA = cover(dA, 1) * 0.45
        if (cA > 0) {
          // blend accent at 45% over current pixel
          r = Math.round(r + (ACC[0] - r) * cA)
          g = Math.round(g + (ACC[1] - g) * cA)
          b = Math.round(b + (ACC[2] - b) * cA)
        }
      }
      const i = (y * size + x) * 4
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a
    }
  }
  return encodePNG(size, size, rgba)
}

for (const sz of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  writeFileSync(`build/icons/${sz}x${sz}.png`, render(sz))
}
writeFileSync('build/icon.png', render(1024))
writeFileSync('build/icons.png', render(1024))
writeFileSync('src/renderer/src/assets/icons/icons.png', render(1024))
console.log('rendered all png sizes (pure node)')
