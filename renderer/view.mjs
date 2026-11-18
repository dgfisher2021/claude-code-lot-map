#!/usr/bin/env node
// The map window in a pane of a terminal that shows Sixel pictures (Windows Terminal 1.22 and later, foot, mlterm,
// WezTerm and others): the page the Edge window shows (renderer/window), served by serve.mjs and painted by render.mjs
// in headless Chromium at the pane's size, each frame drawn as Sixel. The mouse and the keys go to the page, so its
// header, tooltips, list and keys work as they do in Edge. Usage: node view.mjs <live folder>
//
// workmap keeps the session's live map in the folder (map.svg, feed.json) and a heartbeat (alive) while the window is
// wanted. The window marks itself shown (shown) while it runs, so the session opens no second one, and closes when the
// heartbeat stops, when the page closes itself (q, or its session ended), or on ctrl+c.
// `--all <sessions folder>` shows every session as tiles instead (overview.mjs).

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

import { PORT, ensureServer } from './serve.mjs'

const live = process.argv[2]
// --all: every session at a glance, in overview.mjs; this module goes no further.
if (live === '--all') {
  await import('./overview.mjs')
  await new Promise(() => {})
}
const here = dirname(fileURLToPath(import.meta.url))
const out = process.stdout
/** The live folder's name after `workmap-live-`: the page's address names the session by it. */
const name = /\/workmap-live-([a-z0-9]{1,32})$/.exec(live ?? '')?.[1]
/** At most this many pictures a second go to the terminal, and none while it still reads the last. */
const MAX_FPS = 10
/** The session is gone when its heartbeat is this old. */
const STALE_MS = 15_000
/** The page's ground, for the pane's last row, which the picture leaves free. */
const GROUND = '\x1b[48;2;10;12;17m'

if (name === undefined || !out.isTTY) {
  process.stderr.write('usage: node view.mjs <live folder>, in a terminal that shows Sixel pictures\n')
  process.exit(2)
}

// ---- the terminal ------------------------------------------------------------------------------

const [envW, envH] = (process.env.WORKMAP_CELL ?? '').split('x').map(Number)
// Until the terminal says its cell size, a small guess: a picture too tall for the pane would scroll it every frame.
let cell = envW > 0 && envH > 0 ? { w: envW, h: envH } : { w: 8, h: 17 }
let asked = !(envW > 0 && envH > 0)

/**
 * The picture's size: the pane's width, and its height less the last row. Windows Terminal scrolls the screen for a
 * picture that reaches the last row, with every frame.
 */
function fit() {
  const cols = out.columns || 80
  const rows = out.rows || 24
  return { cols, rows, w: cols * cell.w, h: Math.max(1, rows - 1) * cell.h }
}

let size = fit()

/**
 * Clears the screen in place, in the page's ground. Windows Terminal answers ED 2 (ESC [ 2 J) by moving the screen,
 * pictures and all, into the scrollback, so a window cleared that way grew by a screen at each resize.
 */
const CLEAR = `${GROUND}\x1b[H\x1b[J`

function relayout() {
  size = fit()
  out.write(CLEAR)
  tell({ size: [size.w, size.h] })
}

/** A line in the middle of the pane, until the first picture covers it. */
function say(text) {
  out.write(`${GROUND}\x1b[${Math.max(1, Math.floor(size.rows / 2))};1H\x1b[2K${Array.from(text).slice(0, size.cols).join('')}`)
}

// Raw from the start: the terminal's replies are then never echoed onto the pane.
process.stdin.setRawMode?.(true)
// The alternate screen keeps no scrollback, and leaving it gives the pane back as it was. The mouse is reported with
// every move (1003) in SGR form (1006), and focus coming and going (1004).
out.write(`\x1b[?1049h\x1b[?25l\x1b[?1003h\x1b[?1006h\x1b[?1004h${CLEAR}`)
say('Starting the map…')
if (asked) out.write('\x1b[16t')
out.on('resize', relayout)

// ---- the mouse and the keys, to the page ----------------------------------------------------------

/** A press's keys by the browser's names, as the page takes them: the escape sequences it knows, then characters. */
const KEY_NAMES = {
  '\x1b[A': 'ArrowUp',
  '\x1b[B': 'ArrowDown',
  '\x1b[5~': 'PageUp',
  '\x1b[6~': 'PageDown',
  '\r': 'Enter',
  '\n': 'Enter',
  '\x1b': 'Escape',
  '\x7f': 'Backspace',
  '\b': 'Backspace',
}
const BUTTONS = ['left', 'middle', 'right']
/** The button held down, so that a move while it is held drags. */
let held = 'none'

/**
 * One SGR mouse report, at a cell, sent to the page at that cell's centre. The terminal never says the pointer left the
 * pane, so its first column, where the pointer leaves for the session beside it, and its last row, under the picture,
 * count as outside the page: its tooltips close as they do when the pointer leaves Edge.
 */
function mouse(code, col, row, isRelease) {
  const isOut = col <= 1 || row >= size.rows
  const x = isOut ? -1 : Math.round((col - 0.5) * cell.w)
  const y = isOut ? -1 : Math.round((row - 0.5) * cell.h)
  if (code & 64) tell({ mouse: { type: 'mouseWheel', x, y, dy: code & 1 ? 120 : -120 } })
  else if (code & 32) tell({ mouse: { type: 'mouseMoved', x, y, button: held } })
  else if (isRelease) {
    tell({ mouse: { type: 'mouseReleased', x, y, button: BUTTONS[code & 3] ?? 'left' } })
    held = 'none'
  } else {
    held = BUTTONS[code & 3] ?? 'left'
    tell({ mouse: { type: 'mousePressed', x, y, button: held } })
  }
}

/** Takes what the terminal sends: its cell size, the mouse, focus going, and keys, which go to the page. */
function heard(data) {
  const text = data.toString()
  // The cell size the terminal answers: CSI 6 ; height ; width t
  const reply = /\x1b\[6;(\d+);(\d+)t/.exec(text)
  if (reply && asked) {
    asked = false
    cell = { w: Number(reply[2]), h: Number(reply[1]) }
    relayout()
  }
  // Ctrl+C always closes; q too once the map cannot be drawn, since no page is there to take it.
  if (text.includes('\x03') || (failed !== undefined && text.includes('q'))) return quit(0)
  for (const [, code, col, row, end] of text.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) mouse(Number(code), Number(col), Number(row), end === 'm')
  // Focus leaving the pane: the pointer has gone with it.
  if (text.includes('\x1b[O')) tell({ mouse: { type: 'mouseMoved', x: -1, y: -1, button: 'none' } })
  const keys = text.replace(/\x1b\[<[\d;]*[Mm]|\x1b\[[IO]|\x1b\[6;\d+;\d+t/g, '')
  for (const [key] of keys.matchAll(/\x1b\[[0-9;?]*[ -/]*[@-~]|[\s\S]/gu)) {
    const named = KEY_NAMES[key] ?? ([...key].length === 1 && key >= ' ' ? key : '')
    if (named !== '') tell({ key: named })
  }
}

// ---- the renderer, painting the page at this window's size ------------------------------------------

let renderer
/** The renderer's folder, once it is ready: frames appear there as frame.png. */
let rdir
/** Why the map cannot be drawn, once it cannot. */
let failed
let isQuitting = false

/** Sends the renderer one line: the window's size, the mouse or a key. */
function tell(message) {
  if (rdir !== undefined && renderer?.stdin.writable) renderer.stdin.write(`${JSON.stringify(message)}\n`)
}

/** The map cannot be drawn: the window says why, and stays until q or ctrl+c closes it. */
function cannot(why) {
  failed ??= why
  out.write(CLEAR)
  say(`The map cannot be drawn: ${failed}.`)
  out.write(`\x1b[${size.rows};1H\x1b[2m${'press q to close this window'.slice(0, size.cols)}\x1b[0m`)
}

/** A local server the page's Browser station opens, in the person's own browser: a localhost address, nothing else. */
function openLink(url) {
  if (!/^http:\/\/localhost(:\d{1,5})?\/$/.test(url)) return
  const [command, args] = existsSync('/mnt/c') ? ['cmd.exe', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(command, args, { cwd: existsSync('/mnt/c') ? '/mnt/c' : undefined, detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref()
  } catch {}
}

let lastDraw = 0
let later

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
    // A frame painted for the size before a resize would spill over the last row: one at the new size comes next.
    if (png.width !== size.w || png.height !== size.h) return
    const picture = sixel(png)
    lastDraw = Date.now()
    out.write(`\x1b[1;1H${picture}`)
  } catch {
    // A frame caught mid-write: the next one comes soon.
  }
}

// The page's server, one for every session's window, started unless one answers; then the renderer, on the page.
if (await ensureServer()) {
  renderer = spawn(process.execPath, [join(here, 'render.mjs'), '--page', `http://127.0.0.1:${PORT}/?live=${name}`], { stdio: ['pipe', 'pipe', 'ignore'] })
  createInterface({ input: renderer.stdout }).on('line', line => {
    if (line.startsWith('ready ')) {
      rdir = line.slice(6)
      tell({ size: [size.w, size.h] })
    } else if (line.startsWith('frame ')) draw()
    else if (line.startsWith('open ')) openLink(line.slice(5))
    else if (line === 'close') quit(0)
    else if (line.startsWith('error ')) failed = line.slice(6)
  })
  renderer.on('exit', () => isQuitting || cannot('its renderer stopped'))
} else cannot(`its server did not start on port ${PORT}`)

// What the terminal sent while the server started waited for this: raw mode kept its replies from being echoed.
process.stdin.on('data', heard)
process.stdin.resume()

/** Marks the window shown, so that the session opens no second one beside it. */
function markShown() {
  try {
    writeFileSync(join(live, 'shown'), String(Date.now()))
  } catch {}
}

markShown()
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

function quit(code) {
  if (isQuitting) return
  isQuitting = true
  renderer?.kill('SIGTERM')
  out.write(`\x1b[?1004l\x1b[?1006l\x1b[?1003l\x1b[0m\x1b[H\x1b[J\x1b[?1049l\x1b[?25h`)
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
