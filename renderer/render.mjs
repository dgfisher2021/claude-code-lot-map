#!/usr/bin/env node
// The map as pictures, for a terminal that shows them: headless Chromium draws the map's own SVG, animations and all,
// and each frame it paints is written as a PNG for the pane's Image to show.
//
// Protocol, one line each on stdout:
//   ready <dir>   the folder to write <dir>/map.svg into; frames appear as <dir>/frame.png
//   frame <n>     frame n is in <dir>/frame.png, written whole
//   error <text>  the renderer cannot run; it exits
// The size of the picture is the width and height of map.svg's root element; data-running="1" there says a call runs,
// and data-motion="reduced" that nothing moves: the map is painted once for each file written, and no more.
//
// Chromium is WORKMAP_CHROMIUM when set, else the first that runs of chromium on PATH, ~/.local/bin/chromium,
// ~/bin/chromium, google-chrome, and chromium-browser.
// It is driven over a pipe, never a port, and goes with this process. The process ends with its parent.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Removes what renderers that ended without tidying up left behind. Only a folder with a renderer's pid file whose
 * process is gone is removed: anything else of that name is not this renderer's to touch.
 */
function sweep() {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('workmap-')) continue
    const folder = join(tmpdir(), name)
    // A session's live map for `/workmap window` whose heartbeat stopped long ago: its session ended without tidying up.
    if (name.startsWith('workmap-live-')) {
      try {
        if (Date.now() - statSync(join(folder, 'alive')).mtimeMs > 10 * 60_000) rmSync(folder, { recursive: true, force: true })
      } catch {}
      continue
    }
    let pid
    try {
      pid = Number(readFileSync(join(folder, 'pid'), 'utf8'))
    } catch {
      continue
    }
    if (!(pid > 0)) continue
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') rmSync(folder, { recursive: true, force: true })
    }
  }
}
try {
  sweep()
} catch {}

/**
 * Frames a second by how long ago the map changed: quick while pulses fly and rings spread, slower while glows fade,
 * slow while a call runs (its clock hands move), and slowest when only the core breathes. Each frame costs a capture.
 */
const FPS = Number(process.env.WORKMAP_FPS) || 15
const pace = (sinceChange, isRunning) => (sinceChange < 4000 ? FPS : sinceChange < 20_000 ? 4 : isRunning ? 2 : 0.5)
const dir = mkdtempSync(join(tmpdir(), 'workmap-'))
writeFileSync(join(dir, 'pid'), String(process.pid))
const svgPath = join(dir, 'map.svg')
const framePath = join(dir, 'frame.png')
const parent = process.ppid

const say = line => process.stdout.write(`${line}\n`)

let chrome
let isClosing = false

/** Stops Chromium, waits for it to let go of its profile, and removes the folder; then ends with `code`. */
function finish(code) {
  if (isClosing) return
  isClosing = true
  const remove = () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 })
    } catch {}
    process.exit(code)
  }
  if (chrome === undefined || chrome.exitCode !== null) return remove()
  chrome.once('exit', () => setTimeout(remove, 300))
  chrome.kill()
  setTimeout(remove, 3000)
}

function fail(text) {
  say(`error ${text}`)
  finish(1)
}

function findChromium() {
  const named = process.env.WORKMAP_CHROMIUM
  // A process started without a login shell (a pane wsl.exe opens) has no ~/.local/bin on its PATH: look there too,
  // before chromium-browser, which on WSL is often a snap wrapper whose --version never returns.
  const home = process.env.HOME ?? ''
  const own = home === '' ? [] : [join(home, '.local/bin/chromium'), join(home, 'bin/chromium')]
  for (const bin of named ? [named] : ['chromium', ...own, 'google-chrome', 'google-chrome-stable', 'chromium-browser']) {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5_000 })
    if (probe.status === 0 && /chrom/i.test(probe.stdout)) return bin
  }
  return undefined
}

const bin = findChromium()
if (bin === undefined) {
  fail('no Chromium found: set WORKMAP_CHROMIUM or put chromium on PATH')
  await new Promise(() => {})
}

chrome = spawn(
  bin,
  [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${join(dir, 'profile')}`,
    '--no-sandbox',
    '--no-first-run',
    // The page is the map alone, from a data: address; Chromium's own background traffic is off.
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-sync',
    '--no-pings',
    '--mute-audio',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    // Plain software drawing: SwiftShader's emulated GPU keeps every core busy for a picture this size.
    '--disable-gpu',
    '--disable-gpu-compositing',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
)
const toChrome = chrome.stdio[3]
const fromChrome = chrome.stdio[4]
chrome.on('exit', () => isClosing || fail('Chromium exited'))

// ---- the DevTools protocol over the pipe: one JSON message per NUL ----------------------------

let nextId = 0
const waiting = new Map()
const listeners = new Map()
let pending = []

fromChrome.on('data', chunk => {
  let start = 0
  for (let i = chunk.indexOf(0); i !== -1; i = chunk.indexOf(0, start)) {
    pending.push(chunk.subarray(start, i))
    const message = JSON.parse(Buffer.concat(pending).toString('utf8'))
    pending = []
    start = i + 1
    if (message.id !== undefined) {
      const done = waiting.get(message.id)
      waiting.delete(message.id)
      if (message.error) done?.reject(new Error(`${message.error.message}`))
      else done?.resolve(message.result)
    } else listeners.get(message.method)?.(message.params, message.sessionId)
  }
  if (start < chunk.length) pending.push(chunk.subarray(start))
})

function send(method, params = {}, sessionId) {
  const id = ++nextId
  toChrome.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
}

// ---- the page --------------------------------------------------------------------------------

const PAGE =
  'data:text/html,' + encodeURIComponent('<!doctype html><html><body style="margin:0;overflow:hidden;background:#0a0c11"><div id="m"></div></body></html>')

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId: page } = await send('Target.attachToTarget', { targetId, flatten: true })
const loaded = new Promise(resolve => listeners.set('Page.loadEventFired', resolve))
await send('Page.enable', {}, page)
await send('Page.navigate', { url: PAGE }, page)
await loaded

let size = { width: 0, height: 0 }
let generation = 0

// The map's animations are paused and stepped to the wall clock: FPS times a second while the map changes, IDLE_FPS
// once it rests, one screenshot a step. Left to run, Chromium would paint every animation frame at full rate.
// Every svg element is stepped: Chromium runs a nested one on a clock of its own.
const SHOW = `(() => { for (const s of document.querySelectorAll('#m svg')) { s.pauseAnimations(); s.setCurrentTime(0) } window.t0 = performance.now() })()`
const STEP = `(() => { const t = (performance.now() - window.t0) / 1000; for (const s of document.querySelectorAll('#m svg')) s.setCurrentTime(t) })()`
async function step() {
  const started = Date.now()
  // With reduced motion a frame is painted for a new map only, never for animation alone.
  if (shownAt !== 0 && !isClosing && (!isStill || isFresh)) {
    isFresh = false
    await send('Runtime.evaluate', { expression: STEP }, page).catch(() => {})
    // The picture is cut to the map's own size: after a resize Chromium can go on capturing the viewport it had.
    const clip = size.width > 0 ? { clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }, captureBeyondViewport: true } : {}
    const shot = await send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, ...clip }, page).catch(() => undefined)
    if (shot?.data && !isClosing) {
      writeFileSync(`${framePath}.tmp`, Buffer.from(shot.data, 'base64'))
      renameSync(`${framePath}.tmp`, framePath)
      say(`frame ${++generation}`)
    }
  }
  const every = 1000 / pace(Date.now() - shownWallAt, isRunning)
  setTimeout(() => void step(), Math.max(0, every - (Date.now() - started)))
}

async function resize(width, height) {
  if (width === size.width && height === size.height) return
  size = { width, height }
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, page)
}

let shownAt = 0
let shownWallAt = 0
let isRunning = false
let isStill = false
let isFresh = false
async function show() {
  let stat
  try {
    stat = statSync(svgPath)
  } catch {
    return
  }
  if (stat.mtimeMs === shownAt) return
  const svg = readFileSync(svgPath, 'utf8')
  // A file caught half written is read again on the next look.
  if (!svg.trimEnd().endsWith('</svg>')) return
  shownAt = stat.mtimeMs
  shownWallAt = Date.now()
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
  isRunning = /\sdata-running="1"/.test(root)
  isStill = /\sdata-motion="reduced"/.test(root)
  isFresh = true
  const width = Number(/\swidth="(\d+)"/.exec(root)?.[1])
  const height = Number(/\sheight="(\d+)"/.exec(root)?.[1])
  if (width > 0 && height > 0) await resize(Math.min(width, 4096), Math.min(height, 4096))
  await send('Runtime.evaluate', { expression: `document.getElementById('m').innerHTML = ${JSON.stringify(svg)}; ${SHOW}` }, page)
}

process.on('SIGTERM', () => finish(0))
process.on('SIGINT', () => finish(0))
// A terminal pane that closes hangs up on everything it started.
process.on('SIGHUP', () => finish(0))
// Nobody reading any more: the parent is gone.
process.stdout.on('error', () => finish(0))

say(`ready ${dir}`)

// Looks for a new map often, steps the one shown, and ends when the process that started it is gone.
setInterval(() => void show().catch(error => process.stderr.write(`${error}\n`)), 40)
void step()
setInterval(() => process.ppid !== parent && finish(0), 2000)
