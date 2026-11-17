// Every session at a glance, in a window of its own: view.mjs --all <sessions folder> runs this. No picture, no Chromium.
//
// Each session keeps a status file in the folder (see hooks/register.tsx). One tile a file younger than 15 s: the
// session's name, its state word as that session wrote it, the top line, context and time. Waiting tiles come first, in
// amber; a session with errors is in red. A key 1 to 9 shows that session's rows from its live folder, Esc goes back,
// q closes. The folder is read again every second.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[3]
const out = process.stdout
/** A status file older than this is a session gone. */
const FRESH_MS = 15_000

if (!dir || !out.isTTY) {
  process.stderr.write('usage: node view.mjs --all <sessions folder>, in a terminal\n')
  process.exit(2)
}

const AMBER = '\x1b[1;38;2;225;172;110m'
const RED = '\x1b[1;38;2;232;101;79m'
const TONES = {
  run: '\x1b[38;2;225;172;110m',
  switch: '\x1b[38;2;225;172;110m',
  bad: '\x1b[38;2;232;101;79m',
  block: '\x1b[38;2;230;150;70m',
  ok: '\x1b[2m',
}
const CLEAR = '\x1b[H\x1b[J'

/** The tile whose rows show, by its file; none while the tiles do. */
let opened

/** Cuts a line to the window's width, by characters. */
const fitLine = text =>
  Array.from(String(text))
    .slice(0, out.columns || 80)
    .join('')

/** The time since a start as `2h 5m`, `3m 12s` or `9s`. */
function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

/** The tiles of the sessions that live: waiting first, then running and thinking, then the rest, each by name. */
function tiles() {
  const found = []
  let names = []
  try {
    names = readdirSync(dir)
  } catch {}
  for (const file of names) {
    if (!/^[\w-]+\.json$/.test(file)) continue
    try {
      const tile = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (typeof tile.name === 'string' && Date.now() - tile.updatedAt <= FRESH_MS) found.push({ ...tile, file })
    } catch {}
  }
  const group = tile => (tile.state === 'waiting' ? 0 : tile.state === 'running' || tile.state === 'thinking' ? 1 : 2)
  return found.sort((a, b) => group(a) - group(b) || a.name.localeCompare(b.name))
}

/** The line of a tile's name and state: amber when it waits on the person, red when it has errors. */
function heading(tile, key) {
  const colour = tile.state === 'waiting' ? AMBER : tile.fault === true ? RED : '\x1b[1m'
  const context = Number.isFinite(tile.context) ? `  ${Math.round(tile.context)}%` : ''
  return `${colour}${fitLine(`${key} ${tile.name}  ${tile.word ?? tile.state}${context}  ${elapsed(Date.now() - tile.startedAt)}`)}\x1b[0m`
}

/** The lines of the screen: the tiles, or the opened session's rows. */
function screen(list) {
  const lines = []
  if (opened !== undefined) {
    const tile = list.find(item => item.file === opened)
    if (tile === undefined) opened = undefined
    else {
      lines.push(heading(tile, ' '), `\x1b[2m${fitLine(tile.now ?? '')}\x1b[0m`)
      // Only a folder the mod made is read.
      if (typeof tile.live !== 'string' || !/\/lot-map-live-[a-z0-9]+$/.test(tile.live)) lines.push('', '\x1b[2mThis session has no window.\x1b[0m')
      else {
        try {
          const feed = JSON.parse(readFileSync(join(tile.live, 'feed.json'), 'utf8'))
          for (const line of Array.isArray(feed.warnings) ? feed.warnings : []) lines.push(`${TONES.run}${fitLine(line)}\x1b[0m`)
          for (const { line, tone, isBold } of Array.isArray(feed.rows) ? feed.rows : []) {
            lines.push(`${isBold === true ? '\x1b[1m' : ''}${TONES[tone] ?? ''}${fitLine(line)}\x1b[0m`)
          }
        } catch {
          lines.push('', '\x1b[2mThis session has no window.\x1b[0m')
        }
      }
      return { lines, hint: 'Esc back · q closes' }
    }
  }
  list.slice(0, 9).forEach((tile, i) => lines.push(heading(tile, String(i + 1)), `\x1b[2m   ${fitLine(tile.now ?? '')}\x1b[0m`, ''))
  if (list.length === 0) lines.push('\x1b[2mNo sessions to show.\x1b[0m')
  return { lines, hint: '1-9 rows · q closes' }
}

/** Draws the screen, clearing what the last one left. */
function draw() {
  const { lines, hint } = screen(tiles())
  const rows = out.rows || 24
  let text = ''
  for (let i = 0; i < rows - 1; i++) text += `\x1b[${i + 1};1H\x1b[2K${lines[i] ?? ''}`
  out.write(`${text}\x1b[${rows};1H\x1b[2K\x1b[2m${fitLine(hint)}\x1b[0m`)
}

let isQuitting = false
function quit(code) {
  if (isQuitting) return
  isQuitting = true
  out.write(`${CLEAR}\x1b[?1049l\x1b[?25h`)
  process.stdin.setRawMode?.(false)
  setTimeout(() => process.exit(code), 50)
}

process.stdin.setRawMode?.(true)
process.stdin.resume()
process.stdin.on('data', data => {
  const text = data.toString('latin1')
  // A lone Esc goes back; the escape sequences the terminal sends are taken out before the keys are read.
  if (text === '\x1b') {
    opened = undefined
    draw()
    return
  }
  const keys = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  if (/[q\x03]/.test(keys)) quit(0)
  const digit = /[1-9]/.exec(keys)
  if (digit && opened === undefined) {
    opened = tiles()[Number(digit[0]) - 1]?.file
    draw()
  }
})

out.write(`\x1b[?1049h\x1b[?25l${CLEAR}`)
draw()
setInterval(draw, 1000)
out.on('resize', draw)
process.on('SIGTERM', () => quit(0))
process.on('SIGHUP', () => quit(0))
