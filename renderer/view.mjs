#!/usr/bin/env node
// The map in a window of its own, for a terminal that shows Sixel pictures (Windows Terminal 1.22 and later, foot,
// mlterm, WezTerm and others). Usage: node view.mjs <live folder>
//
// lot-map keeps the session's live map in the folder (map.svg) with a heartbeat (alive) while `/lot-map window` is on.
// This window runs render.mjs at its own size, draws each frame as Sixel, and closes when the heartbeat stops, or on
// q or ctrl+c.

import { spawn } from 'node:child_process'
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const live = process.argv[2]
const here = dirname(fileURLToPath(import.meta.url))
const out = process.stdout
/** The map's own proportions. */
const [MAP_W, MAP_H] = [460, 430]
/** At most this many pictures a second go to the terminal, and none while it still reads the last. */
const MAX_FPS = 10
/** The session is gone when its heartbeat is this old. */
const STALE_MS = 15_000

if (!live || !out.isTTY) {
  process.stderr.write('usage: node view.mjs <live folder>, in a terminal that shows Sixel pictures\n')
  process.exit(2)
}

// ---- the terminal ------------------------------------------------------------------------------

const [envW, envH] = (process.env.LOT_MAP_CELL ?? '').split('x').map(Number)
// Until the terminal says its cell size, a small guess: a picture too tall for the pane would scroll it every frame.
let cell = envW > 0 && envH > 0 ? { w: envW, h: envH } : { w: 8, h: 17 }
let asked = !(envW > 0 && envH > 0)

process.stdin.setRawMode?.(true)
process.stdin.resume()
process.stdin.on('data', data => {
  const text = data.toString('latin1')
  // The cell size the terminal answers: CSI 6 ; height ; width t
  const reply = /\x1b\[6;(\d+);(\d+)t/.exec(text)
  if (reply && asked) {
    asked = false
    cell = { w: Number(reply[2]), h: Number(reply[1]) }
    relayout()
  }
  if (/[q\x03]/.test(text.replace(/\x1b\[[0-9;]*t/g, ''))) quit(0)
})

/** The picture's size in pixels, the largest the window holds in the map's proportions, and the column it starts at. */
function fit() {
  const cols = out.columns || 80
  const rows = out.rows || 24
  const scale = Math.min((cols * cell.w) / MAP_W, ((rows - 1) * cell.h) / MAP_H)
  const w = Math.max(60, Math.floor(MAP_W * scale))
  const h = Math.max(56, Math.floor(MAP_H * scale))
  return { w, h, col: Math.max(0, Math.floor((cols - Math.ceil(w / cell.w)) / 2)), rows }
}

let size = fit()

function relayout() {
  size = fit()
  out.write('\x1b[2J')
  hint()
  fedKey = ''
  feed()
}

function hint() {
  out.write(`\x1b[${size.rows};1H\x1b[2mq closes this window\x1b[0m`)
}

out.write('\x1b[?25l\x1b[2J')
hint()
if (asked) out.write('\x1b[16t')
out.on('resize', relayout)

// ---- the renderer, fed the live map at this window's size ---------------------------------------

const renderer = spawn(process.execPath, [join(here, 'render.mjs')], { stdio: ['ignore', 'pipe', 'ignore'] })
let rdir
let fedKey = ''

/** Copies the live map to the renderer at this window's size, when either has changed. */
function feed() {
  if (rdir === undefined) return
  let stat
  try {
    stat = statSync(join(live, 'map.svg'))
  } catch {
    return
  }
  const key = `${stat.mtimeMs}:${size.w}x${size.h}`
  if (key === fedKey) return
  const svg = readFileSync(join(live, 'map.svg'), 'utf8')
  if (!svg.trimEnd().endsWith('</svg>')) return
  fedKey = key
  const sized = svg.replace(/^(<svg\b[^>]*?)\swidth="\d+"\sheight="\d+"/, `$1 width="${size.w}" height="${size.h}"`)
  writeFileSync(join(rdir, 'map.svg.tmp'), sized)
  renameSync(join(rdir, 'map.svg.tmp'), join(rdir, 'map.svg'))
}

let lastDraw = 0
let later

createInterface({ input: renderer.stdout }).on('line', line => {
  if (line.startsWith('ready ')) {
    rdir = line.slice(6)
    feed()
  } else if (line.startsWith('frame ')) draw()
  else if (line.startsWith('error ')) {
    out.write(`\x1b[1;1H${line.slice(6)}`)
    setTimeout(() => quit(1), 4000)
  }
})
renderer.on('exit', () => quit(0))

/** Draws the newest frame, unless one went out a moment ago or the terminal is still reading it: then it is drawn later. */
function draw() {
  clearTimeout(later)
  const wait = 1000 / MAX_FPS - (Date.now() - lastDraw)
  if (wait > 0 || out.writableNeedDrain) {
    later = setTimeout(draw, Math.max(wait, 20))
    return
  }
  try {
    const picture = sixel(decodePng(readFileSync(join(rdir, 'frame.png'))))
    lastDraw = Date.now()
    out.write(`\x1b[1;${size.col + 1}H${picture}`)
  } catch {
    // A frame caught mid-write: the next one comes soon.
  }
}

setInterval(feed, 60)
setInterval(() => {
  let beat = 0
  try {
    beat = statSync(join(live, 'alive')).mtimeMs
  } catch {}
  if (Date.now() - beat > STALE_MS) {
    rmSync(live, { recursive: true, force: true })
    quit(0)
  }
}, 2000)

let isQuitting = false
function quit(code) {
  if (isQuitting) return
  isQuitting = true
  renderer.kill('SIGTERM')
  out.write('\x1b[2J\x1b[H\x1b[?25h')
  process.stdin.setRawMode?.(false)
  setTimeout(() => process.exit(code), 100)
}
process.on('SIGTERM', () => quit(0))
process.on('SIGHUP', () => quit(0))

// ---- PNG in, Sixel out ----------------------------------------------------------------------------

/** The pixels of an 8-bit, non-interlaced RGB or RGBA PNG, as Chromium writes them. */
function decodePng(buf) {
  let width = 0
  let height = 0
  let bpp = 0
  const idat = []
  for (let pos = 8; pos < buf.length; ) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 2 && data[9] !== 6)) throw new Error('unsupported PNG')
      bpp = data[9] === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0
      const b = y > 0 ? px[dst - stride + x] : 0
      const c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0
      let v = raw[src + x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[dst + x] = v & 255
    }
  }
  return { width, height, bpp, px }
}

/**
 * The picture as Sixel: its colours bucketed to 15 bits, the 255 most used buckets made the palette and every other
 * bucket drawn in its nearest, then each band of six rows written colour by colour with runs compressed.
 */
function sixel({ width: w, height: h, bpp, px }) {
  const n = w * h
  const bucket = new Uint16Array(n)
  const count = new Uint32Array(32768)
  const sum = new Float64Array(32768 * 3)
  for (let i = 0; i < n; i++) {
    const r = px[i * bpp]
    const g = px[i * bpp + 1]
    const b = px[i * bpp + 2]
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    bucket[i] = k
    count[k]++
    sum[k * 3] += r
    sum[k * 3 + 1] += g
    sum[k * 3 + 2] += b
  }
  const used = []
  for (let k = 0; k < 32768; k++) if (count[k] > 0) used.push(k)
  used.sort((p, q) => count[q] - count[p])
  const palette = used.slice(0, 255)
  const rgb = palette.map(k => [sum[k * 3] / count[k], sum[k * 3 + 1] / count[k], sum[k * 3 + 2] / count[k]])
  const index = new Int16Array(32768)
  palette.forEach((k, i) => (index[k] = i))
  for (const k of used.slice(255)) {
    const [r, g, b] = [sum[k * 3] / count[k], sum[k * 3 + 1] / count[k], sum[k * 3 + 2] / count[k]]
    let best = 0
    let bestD = Infinity
    rgb.forEach(([pr, pg, pb], i) => {
      const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    index[k] = best
  }

  const parts = ['\x1bP0;1;0q', `"1;1;${w};${h}`]
  rgb.forEach(([r, g, b], i) => parts.push(`#${i};2;${Math.round((r * 100) / 255)};${Math.round((g * 100) / 255)};${Math.round((b * 100) / 255)}`))
  const colours = palette.length
  const masks = new Uint8Array(colours * w)
  const present = new Uint8Array(colours)
  for (let band = 0; band < h; band += 6) {
    masks.fill(0)
    present.fill(0)
    for (let dy = 0; dy < 6 && band + dy < h; dy++) {
      const row = (band + dy) * w
      for (let x = 0; x < w; x++) {
        const ci = index[bucket[row + x]]
        masks[ci * w + x] |= 1 << dy
        present[ci] = 1
      }
    }
    let isFirst = true
    for (let ci = 0; ci < colours; ci++) {
      if (present[ci] === 0) continue
      const base = ci * w
      let end = w
      while (end > 0 && masks[base + end - 1] === 0) end--
      let line = isFirst ? `#${ci}` : `$#${ci}`
      isFirst = false
      let prev = -1
      let run = 0
      for (let x = 0; x <= end; x++) {
        const ch = x < end ? masks[base + x] + 63 : -1
        if (ch === prev) {
          run++
          continue
        }
        if (run > 3) line += `!${run}${String.fromCharCode(prev)}`
        else if (run > 0) line += String.fromCharCode(prev).repeat(run)
        prev = ch
        run = 1
      }
      parts.push(line)
    }
    parts.push('-')
  }
  parts.push('\x1b\\')
  return parts.join('')
}
