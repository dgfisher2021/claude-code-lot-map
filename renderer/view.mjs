#!/usr/bin/env node
// The map in a window of its own, for a terminal that shows Sixel pictures (Windows Terminal 1.22 and later, foot,
// mlterm, WezTerm and others). Usage: node view.mjs <live folder>
//
// lot-map keeps the session's live map in the folder (map.svg), the rows under it (feed.json) and a heartbeat (alive)
// while `/lot-map window` is on. The rows are drawn as text under the picture, as the pane draws them. The window
// marks itself shown (shown) while it runs, so the session opens no second one.
// This window runs render.mjs at its own size, draws each frame as Sixel, and closes when the heartbeat stops, or on
// q or ctrl+c.

import { spawn } from 'node:child_process'
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

import { layout } from './layout.mjs'

const live = process.argv[2]
const here = dirname(fileURLToPath(import.meta.url))
const out = process.stdout
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
  // Keys, with every escape sequence the terminal sends taken out first.
  const keys = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  if (/[q\x03]/.test(keys)) quit(0)
  // ? swaps the rows for the legend, and back.
  if (keys.includes('?')) {
    showsLegend = !showsLegend
    feedAt = 0
    rows()
  }
  // m goes round the map with the list, the map alone, and the list alone.
  if (keys.includes('m')) {
    view = view === 'both' ? 'map' : view === 'map' ? 'list' : 'both'
    relayout()
  }
})

/** The rows the list keeps under the map: the session's `windowRows`, once feed.json says it. */
let listMin = 10
/** What the window shows: the map with the list under it, the map alone, or the list alone. `m` goes round them. */
let view = 'both'

/** The layout for the window as it is now (layout.mjs), with its size in cells and where the feed's rows go. */
function fit() {
  const cols = out.columns || 80
  const rows = out.rows || 24
  const at = layout({ cols, rows, cell, listRows: listMin, view })
  return { ...at, rows, cols, feedTop: at.listTop, feedRows: at.listRows }
}

let size = fit()

/**
 * Clears the screen in place. Windows Terminal answers ED 2 (ESC [ 2 J) by moving the screen, pictures and all, into
 * the scrollback, so a window cleared that way grew by a screen at each resize.
 */
const CLEAR = '\x1b[H\x1b[J'

function relayout() {
  size = fit()
  out.write(CLEAR)
  hint()
  fedKey = ''
  feed()
  feedAt = 0
  rows()
}

function hint() {
  // Cut to the width: a line wrapping off the last row would scroll the window.
  out.write(`\x1b[${size.rows};1H\x1b[2K\x1b[2m${fitLine('q closes · ? legend · m map/list')}\x1b[0m`)
}

/** A line in the middle of the map's room, until the first picture covers it. */
function say(text) {
  out.write(`\x1b[${Math.max(1, Math.floor(size.feedTop / 2))};1H\x1b[2K${text}`)
}

// ---- the feed under the map, as the pane writes it ---------------------------------------------

/** Colours of the rows, as the app's dark theme gives them: at work and a change of model in the accent, faults in red. */
const TONES = {
  run: '\x1b[38;2;225;172;110m',
  switch: '\x1b[38;2;225;172;110m',
  bad: '\x1b[38;2;232;101;79m',
  // A refusal: a rule at work, in the warning colour rather than the error's.
  block: '\x1b[38;2;230;150;70m',
  ok: '\x1b[2m',
}
let feedAt = 0

/** Cuts a line to the window's width, by characters. */
const fitLine = text => Array.from(text).slice(0, size.cols).join('')

/** Whether the legend stands where the rows go: `?` swaps them. */
let showsLegend = false

/** Breaks a line of the legend at spaces to the window's width, a word too long for it cut. */
function wrapLine(text) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`
    if (Array.from(next).length <= size.cols) line = next
    else {
      if (line !== '') lines.push(line)
      line = fitLine(word)
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

/** Draws the action now and the rows under it when feed.json has changed, clearing what the last ones left. */
function rows() {
  let stat
  try {
    stat = statSync(join(live, 'feed.json'))
  } catch {
    return
  }
  if (stat.mtimeMs === feedAt || size.feedRows === 0) return
  let feed
  try {
    feed = JSON.parse(readFileSync(join(live, 'feed.json'), 'utf8'))
  } catch {
    return
  }
  feedAt = stat.mtimeMs
  // The rows the session's windowRows has the list keep: a change lays the window out again.
  const wanted = Math.round(Number(feed.windowRows))
  if (Number.isFinite(wanted) && wanted !== listMin) {
    listMin = wanted
    relayout()
    return
  }
  // The top line: a wait on the person in the accent, a finished turn in green.
  const nowTone = { wait: '\x1b[1;38;2;225;172;110m', done: '\x1b[1;38;2;143;191;127m' }[feed.nowTone] ?? '\x1b[1m'
  const lines = [`${nowTone}${fitLine(String(feed.now ?? ''))}\x1b[0m`]
  // Warnings in amber, under the top line.
  for (const line of Array.isArray(feed.warnings) ? feed.warnings : []) lines.push(`${TONES.run}${fitLine(String(line))}\x1b[0m`)
  if (showsLegend) {
    for (const line of Array.isArray(feed.legend) ? feed.legend : []) lines.push(...wrapLine(String(line)))
  } else {
    // Claude's plan, then work still going in the background, under the top line.
    for (const { line, tone, isBold } of Array.isArray(feed.plan) ? feed.plan : []) {
      lines.push(`${isBold === true ? '\x1b[1m' : ''}${TONES[tone] ?? ''}${fitLine(String(line))}\x1b[0m`)
    }
    if (feed.changed) lines.push(`${TONES[feed.changed.tone] ?? ''}${fitLine(String(feed.changed.line))}\x1b[0m`)
    for (const { line, tone } of Array.isArray(feed.pinned) ? feed.pinned : []) lines.push(`${TONES[tone] ?? ''}${fitLine(String(line))}\x1b[0m`)
    const listed = Array.isArray(feed.rows) ? feed.rows : []
    if (listed.length === 0) lines.push(`\x1b[2m${fitLine(String(feed.empty ?? ''))}\x1b[0m`)
    for (const { line, tone, isBold } of listed) lines.push(`${isBold === true ? '\x1b[1m' : ''}${TONES[tone] ?? ''}${fitLine(String(line))}\x1b[0m`)
  }
  let text = ''
  for (let i = 0; i < size.feedRows; i++) text += `\x1b[${size.feedTop + i};1H\x1b[2K${lines[i] ?? ''}`
  out.write(text)
}

// The alternate screen keeps no scrollback, and leaving it gives the pane back as it was.
out.write(`\x1b[?1049h\x1b[?25l${CLEAR}`)
hint()
say('Starting the map…')
if (asked) out.write('\x1b[16t')
out.on('resize', relayout)

// ---- the renderer, fed the live map at this window's size ---------------------------------------

const renderer = spawn(process.execPath, [join(here, 'render.mjs')], { stdio: ['ignore', 'pipe', 'ignore'] })
let rdir
let fedKey = ''

/** Copies the live map to the renderer at this window's size, when either has changed. */
function feed() {
  // The list alone needs no picture.
  if (rdir === undefined || size.w === 0) return
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
  else if (line.startsWith('error ')) failed = line.slice(6)
})
// Without its renderer the window has nothing to show: it says why, and stays until a key closes it.
let failed = ''
renderer.on('exit', () => {
  if (isQuitting) return
  out.write(CLEAR)
  say(`The map cannot be drawn: ${failed || 'its renderer stopped'}.`)
  out.write(`\x1b[${size.rows};1H\x1b[2m${fitLine('press q to close this window')}\x1b[0m`)
})

/** Draws the newest frame, unless one went out a moment ago or the terminal is still reading it: then it is drawn later. */
function draw() {
  clearTimeout(later)
  const wait = 1000 / MAX_FPS - (Date.now() - lastDraw)
  if (wait > 0 || out.writableNeedDrain) {
    later = setTimeout(draw, Math.max(wait, 20))
    return
  }
  try {
    const png = decodePng(readFileSync(join(rdir, 'frame.png')))
    // A frame painted for the size before a resize would spill over the rows: one at the new size comes next.
    if (png.width !== size.w || png.height !== size.h) return
    const picture = sixel(png)
    lastDraw = Date.now()
    out.write(`\x1b[1;${size.col + 1}H${picture}`)
  } catch {
    // A frame caught mid-write: the next one comes soon.
  }
}

/** Marks the window shown, so that the session opens no second one beside it. */
function markShown() {
  try {
    writeFileSync(join(live, 'shown'), String(Date.now()))
  } catch {}
}

markShown()
setInterval(feed, 60)
setInterval(rows, 200)
setInterval(() => {
  let beat = 0
  try {
    beat = statSync(join(live, 'alive')).mtimeMs
  } catch {}
  if (Date.now() - beat > STALE_MS) {
    rmSync(live, { recursive: true, force: true })
    quit(0)
  } else markShown()
}, 2000)

let isQuitting = false
function quit(code) {
  if (isQuitting) return
  isQuitting = true
  renderer.kill('SIGTERM')
  out.write(`${CLEAR}\x1b[?1049l\x1b[?25h`)
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
