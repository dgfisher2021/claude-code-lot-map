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
// `render.mjs --page <url>` paints a page instead, the map window's (renderer/window), for the Sixel window. Its size
// and input come on stdin, one JSON line each: {"size":[w,h]}, {"mouse":{type,x,y,button,dy}}, {"key":name}. Besides
// ready and frame it says `open <url>` when the page opens a link and `close` when it closes itself.
//
// Chromium is WORKMAP_CHROMIUM when set, else the first that runs of chromium on PATH, ~/.local/bin/chromium,
// ~/bin/chromium, google-chrome, and chromium-browser.
// It is driven over a pipe, never a port, and goes with this process. The process ends with its parent.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/** The page to paint, in page mode; else the map's SVG. */
const pageUrl = process.argv[2] === '--page' ? process.argv[3] : undefined

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

/** Windows' own fonts, from WSL: the page asks for Segoe UI (system-ui), Cascadia Mono and Consolas, as Edge draws it. */
const WINDOWS_FONTS = ['segoeui.ttf', 'segoeuib.ttf', 'seguisb.ttf', 'CascadiaMono.ttf', 'CascadiaCode.ttf', 'consola.ttf', 'consolab.ttf']

/** In page mode from WSL, a fontconfig file that adds those and makes them the defaults; else nothing. */
function windowsFonts() {
  const from = '/mnt/c/Windows/Fonts'
  if (pageUrl === undefined || !existsSync(from)) return {}
  const fonts = join(dir, 'fonts')
  mkdirSync(fonts)
  for (const file of WINDOWS_FONTS) if (existsSync(join(from, file))) symlinkSync(join(from, file), join(fonts, file))
  const prefer = (family, font) => `<alias binding="strong"><family>${family}</family><prefer><family>${font}</family></prefer></alias>`
  const conf = join(dir, 'fonts.conf')
  writeFileSync(
    conf,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include>` +
      `<dir>${fonts}</dir>${prefer('system-ui', 'Segoe UI')}${prefer('sans-serif', 'Segoe UI')}${prefer('sans', 'Segoe UI')}${prefer('monospace', 'Consolas')}</fontconfig>`,
  )
  return { FONTCONFIG_FILE: conf }
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
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: { ...process.env, ...windowsFonts() } },
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

/**
 * In page mode the page's window.open and window.close tell this renderer instead of acting: a link it opens goes to the
 * person's own browser, and a page that closes itself (q, or its session ended) closes the window that shows it.
 */
async function hookPage() {
  listeners.set('Runtime.bindingCalled', ({ name, payload }) => {
    if (name !== 'workmapSay') return
    const [word, url = ''] = String(payload).split(' ')
    if (word === 'close') say('close')
    else if (word === 'open' && /^https?:\/\/\S+$/.test(url)) say(`open ${url}`)
  })
  await send('Runtime.enable', {}, page)
  await send('Runtime.addBinding', { name: 'workmapSay' }, page)
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: "window.open = url => (workmapSay('open ' + url), null); window.close = () => workmapSay('close')" },
    page,
  )
  // The page counts as focused, as a window in front does: keys reach it, and :hover and :focus apply.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, page)
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId: page } = await send('Target.attachToTarget', { targetId, flatten: true })
const loaded = new Promise(resolve => listeners.set('Page.loadEventFired', resolve))
await send('Page.enable', {}, page)
if (pageUrl !== undefined) await hookPage()
await send('Page.navigate', { url: pageUrl ?? PAGE }, page)
await loaded

let size = { width: 0, height: 0 }
let generation = 0

// The map's animations are paused and stepped to the wall clock: FPS times a second while the map changes, IDLE_FPS
// once it rests, one screenshot a step. Left to run, Chromium would paint every animation frame at full rate.
// Every svg element is stepped: Chromium runs a nested one on a clock of its own.
const SHOW = `(() => { for (const s of document.querySelectorAll('#m svg')) { s.pauseAnimations(); s.setCurrentTime(0) } window.t0 = performance.now() })()`
const STEP = `(() => { const t = (performance.now() - window.t0) / 1000; for (const s of document.querySelectorAll('#m svg')) s.setCurrentTime(t) })()`
/** Paints what the page shows now into frame.png and says so. */
async function capture() {
  // The picture is cut to its own size: after a resize Chromium can go on capturing the viewport it had.
  const clip = size.width > 0 ? { clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 }, captureBeyondViewport: true } : {}
  const shot = await send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, ...clip }, page).catch(() => undefined)
  if (shot?.data && !isClosing) {
    writeFileSync(`${framePath}.tmp`, Buffer.from(shot.data, 'base64'))
    renameSync(`${framePath}.tmp`, framePath)
    say(`frame ${++generation}`)
  }
}

/** A step of the map's SVG: its clock moved on and a frame painted. Gives the time to the next. */
async function step() {
  // With reduced motion a frame is painted for a new map only, never for animation alone.
  if (shownAt !== 0 && !isClosing && (!isStill || isFresh)) {
    isFresh = false
    await send('Runtime.evaluate', { expression: STEP }, page).catch(() => {})
    await capture()
  }
  return 1000 / pace(Date.now() - shownWallAt, isRunning)
}

/**
 * The page's step: each svg it shows is paused when it first appears and stepped from then, as STEP steps the map's,
 * and the page says how long ago anything in it changed, which paces the frames as a new map does.
 */
const PAGE_STEP = `(() => {
  const now = performance.now()
  if (!window.wm) {
    window.wm = { at: now }
    new MutationObserver(() => (window.wm.at = performance.now())).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  }
  for (const s of document.querySelectorAll('#map svg')) {
    if (s.wmFrom === undefined) {
      s.pauseAnimations()
      s.wmFrom = now
    }
    s.setCurrentTime((now - s.wmFrom) / 1000)
  }
  const root = document.querySelector('#map > svg')
  return { since: now - window.wm.at, isRunning: root?.getAttribute('data-running') === '1', isStill: root?.getAttribute('data-motion') === 'reduced' }
})()`

/** When the page was last painted. */
let paintedAt = 0

/** A step of the page. With reduced motion it is painted only when something changed or input asked; else at the pace. */
async function stepPage() {
  if (size.width === 0 || isClosing) return 100
  const state = (await send('Runtime.evaluate', { expression: PAGE_STEP, returnByValue: true }, page).catch(() => undefined))?.result?.value
  if (state === undefined) return 250
  if (isFresh || !state.isStill || Date.now() - state.since > paintedAt) {
    isFresh = false
    paintedAt = Date.now()
    await capture()
  }
  return 1000 / pace(state.since, state.isRunning)
}

let stepTimer
let isStepping = false
/** Input arrived during a step: the next comes at once. */
let isWanted = false

/** Runs the next step `ms` from now, in place of one already due. */
function stepIn(ms) {
  clearTimeout(stepTimer)
  stepTimer = setTimeout(() => void run(), Math.max(0, ms))
}

async function run() {
  if (isStepping) return
  isStepping = true
  const started = Date.now()
  const every = await (pageUrl === undefined ? step() : stepPage()).catch(() => 1000)
  isStepping = false
  if (isWanted) {
    isWanted = false
    stepIn(15)
  } else stepIn(every - (Date.now() - started))
}

/** Input moved the page: a frame shows it at once, not at the pace's next turn. */
function kick() {
  isFresh = true
  if (isStepping) isWanted = true
  else stepIn(15)
}

/** Key names as the browser has them, for those that are not characters. */
const CODES = { ArrowUp: 38, ArrowDown: 40, PageUp: 33, PageDown: 34, Enter: 13, Escape: 27, Backspace: 8 }
const BUTTONS = { left: 1, right: 2, middle: 4 }

/** A line from the window: its size, the mouse or a key, played into the page as the person's own. */
async function input(line) {
  const message = JSON.parse(line)
  if (Array.isArray(message.size)) {
    const [width, height] = message.size.map(Number)
    if (width > 0 && height > 0) await resize(Math.min(width, 4096), Math.min(height, 4096))
  } else if (message.mouse) {
    const { type, x, y, button = 'none', dy = 0 } = message.mouse
    const isClick = type === 'mousePressed' || type === 'mouseReleased'
    const buttons = type === 'mouseReleased' ? 0 : (BUTTONS[button] ?? 0)
    await send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: isClick ? 1 : 0, deltaX: 0, deltaY: dy }, page)
  } else if (typeof message.key === 'string') {
    const key = message.key
    const named = CODES[key] === undefined ? {} : { code: key, windowsVirtualKeyCode: CODES[key] }
    await send('Input.dispatchKeyEvent', CODES[key] === undefined ? { type: 'keyDown', key, text: key } : { type: 'rawKeyDown', key, ...named }, page)
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...named }, page)
  }
  kick()
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

// Looks for a new map often (a page fetches its own and takes input instead), steps what it shows, and ends when the
// process that started it is gone.
if (pageUrl === undefined) setInterval(() => void show().catch(error => process.stderr.write(`${error}\n`)), 40)
else {
  let inputs = Promise.resolve()
  createInterface({ input: process.stdin }).on('line', line => {
    inputs = inputs.then(() => input(line)).catch(() => {})
  })
}
void run()
setInterval(() => process.ppid !== parent && finish(0), 2000)
