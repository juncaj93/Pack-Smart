#!/usr/bin/env node
/**
 * Generates the PWA and iOS app icons.
 *
 * Deliberately dependency-free: a minimal PNG encoder over Node's built-in
 * zlib, so icons are reproducible from source and the runtime dependency budget
 * in technical-docs/01_ARCHITECTURE.md §2 stays intact. No image library, no
 * paid asset service.
 *
 *   npm run icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

// Matches --color-accent / --color-bg in src/styles/tokens.css.
const BACKGROUND = [47, 111, 94, 255]
const FOREGROUND = [255, 255, 255, 255]

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // One filter byte (0 = None) per scanline.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ */
/* drawing                                                             */
/* ------------------------------------------------------------------ */

function createCanvas(size, color) {
  const buffer = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i += 1) {
    buffer[i * 4] = color[0]
    buffer[i * 4 + 1] = color[1]
    buffer[i * 4 + 2] = color[2]
    buffer[i * 4 + 3] = color[3]
  }
  return buffer
}

function fillRoundedRect(buffer, size, x0, y0, w, h, radius, color) {
  const x1 = x0 + w
  const y1 = y0 + h
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x += 1) {
      // Corner rounding: only test distance when inside a corner box.
      const dx = x < x0 + radius ? x0 + radius - x : x > x1 - radius ? x - (x1 - radius) : 0
      const dy = y < y0 + radius ? y0 + radius - y : y > y1 - radius ? y - (y1 - radius) : 0
      if (dx * dx + dy * dy > radius * radius) continue

      const i = (y * size + x) * 4
      buffer[i] = color[0]
      buffer[i + 1] = color[1]
      buffer[i + 2] = color[2]
      buffer[i + 3] = color[3]
    }
  }
}

/**
 * A suitcase mark: body, handle, and a latch band.
 *
 * `inset` is the fraction of the canvas kept clear around the glyph. Maskable
 * icons need a larger inset so the mark survives an aggressive circular crop.
 */
function drawIcon(size, inset) {
  const canvas = createCanvas(size, BACKGROUND)

  const safe = size * (1 - inset * 2)
  const originX = size * inset
  const originY = size * inset

  const bodyW = safe * 0.82
  const bodyH = safe * 0.64
  const bodyX = originX + (safe - bodyW) / 2
  const bodyY = originY + safe * 0.3

  // Handle
  const handleW = safe * 0.3
  const handleH = safe * 0.14
  fillRoundedRect(
    canvas,
    size,
    originX + (safe - handleW) / 2,
    bodyY - handleH * 0.92,
    handleW,
    handleH,
    handleH * 0.42,
    FOREGROUND,
  )
  // Punch the handle hollow back out with the background colour.
  const innerW = handleW - safe * 0.1
  const innerH = handleH - safe * 0.05
  fillRoundedRect(
    canvas,
    size,
    originX + (safe - innerW) / 2,
    bodyY - handleH * 0.92 + safe * 0.025,
    innerW,
    innerH,
    innerH * 0.4,
    BACKGROUND,
  )

  // Body
  fillRoundedRect(canvas, size, bodyX, bodyY, bodyW, bodyH, safe * 0.09, FOREGROUND)

  // Latch band
  const bandH = Math.max(2, safe * 0.055)
  fillRoundedRect(
    canvas,
    size,
    bodyX,
    bodyY + bodyH * 0.42,
    bodyW,
    bandH,
    bandH * 0.5,
    BACKGROUND,
  )

  return encodePng(size, size, canvas)
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Pack Smart">
  <rect width="512" height="512" rx="96" fill="rgb(47,111,94)"/>
  <rect x="176" y="120" width="160" height="72" rx="30" fill="none" stroke="#fff" stroke-width="34"/>
  <rect x="96" y="184" width="320" height="248" rx="42" fill="#fff"/>
  <rect x="96" y="288" width="320" height="26" fill="rgb(47,111,94)"/>
</svg>
`

/* ------------------------------------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true })

const outputs = [
  ['icon-192.png', drawIcon(192, 0.12)],
  ['icon-512.png', drawIcon(512, 0.12)],
  // Maskable: bigger margin so a circular mask cannot clip the suitcase.
  ['icon-512-maskable.png', drawIcon(512, 0.2)],
  // iOS reads ONLY this one when adding to the Home Screen. It is also
  // always opaque — iOS does not honour transparency here.
  ['apple-touch-icon-180.png', drawIcon(180, 0.1)],
  ['icon.svg', Buffer.from(SVG, 'utf8')],
]

for (const [name, data] of outputs) {
  writeFileSync(resolve(OUT_DIR, name), data)
  console.log(`wrote public/icons/${name} (${data.length} bytes)`)
}
