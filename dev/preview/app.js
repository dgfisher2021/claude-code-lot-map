// The preview page: draws the window (map and rows) from the made-up session or a live one, with tooltips and notes.

import { feedLines, freshList } from '/window/lines.mjs'
import {
  drawLines,
  drawStatus,
  drawTitle,
  markLocal,
  setHelp,
  showTip as showTipAt,
  tipAt,
  untitle,
  setLocal,
  watchLocal,
  wireHelp,
  wireSplit,
  wireStatus,
} from '/window/ui.js'
import { LOOP_S, boardAt } from './scene.js'

const $ = id => document.getElementById(id)
const pane = $('pane')
const mapBox = $('map')
const rowsBox = $('rows')
const tip = $('tip')
const help = $('help')
const LINE_H = 22

const DEFAULTS = {
  source: 'scene',
  isPlaying: true,
  s: 4,
  figures: { context: 10, fiveHour: 40, weekly: 100, cost: 4.2, plan: true, agents: true, satellites: true },
  options: { theme: 'dark', motion: 'full', layout: 'you-top', spokes: 'calls', language: 'en', windowRows: 10, contextCost: false, errorReasons: false },
  pane: { w: 560, h: 860 },
}

/** What the page remembers across a reload: the controls, the time and the pane's size. */
function load() {
  try {
    const kept = JSON.parse(localStorage.getItem('workmap-preview') ?? '{}')
    return { ...DEFAULTS, ...kept, figures: { ...DEFAULTS.figures, ...kept.figures }, options: { ...DEFAULTS.options, ...kept.options } }
  } catch {
    return structuredClone(DEFAULTS)
  }
}
const state = load()
// ?window=<session id> shows that session alone, filling the window, as the map window does.
const windowed = new URLSearchParams(location.search).get('window')
if (windowed) {
  document.body.classList.add('windowed')
  state.source = windowed
}
function save() {
  if (windowed) return
  try {
    localStorage.setItem('workmap-preview', JSON.stringify({ ...state, pane: { w: pane.offsetWidth, h: pane.offsetHeight } }))
  } catch {}
}

function showError(message) {
  $('error').style.display = message ? 'block' : 'none'
  $('error').textContent = message ?? ''
}

// The drawing code itself, from hooks/ in this worktree.
let lib
try {
  lib = await import('/src/hooks/map.ts')
} catch (error) {
  showError(`The drawing code did not load:\n${error.message}`)
}

// ---- the clock --------------------------------------------------------------------------------

let loopStart = Date.now() - state.s * 1000
function elapsed() {
  if (!state.isPlaying) return state.s
  let s = (Date.now() - loopStart) / 1000
  if (s >= LOOP_S) {
    loopStart = Date.now()
    s = 0
  }
  state.s = s
  return s
}
function setTime(s) {
  state.s = Math.max(0, Math.min(LOOP_S - 0.1, s))
  loopStart = Date.now() - state.s * 1000
}

// ---- drawing ----------------------------------------------------------------------------------

/** The map's room in the pane: what is left above the rows and the gap. */
function mapRoom() {
  const rows = Math.max(3, Number(state.options.windowRows) || 10)
  // The lines' height as dragged at the handle, or windowRows until it is.
  const list = state.listPx > 0 ? state.listPx : rows * LINE_H + 12
  const room = Math.max(120, pane.clientHeight - list - $('split').offsetHeight - $('top').offsetHeight)
  // As large as the width allows while the rows keep their room, as renderer/layout.mjs lays out the window.
  return { w: pane.clientWidth, h: Math.min(room, Math.round((pane.clientWidth * (lib?.H ?? 430)) / (lib?.W ?? 460))) }
}

/** The lines under the map as the window draws them (renderer/window), cut to windowRows; the ? shows the feed's keys. */
let keyHelp
function renderRows(feed) {
  keyHelp = feed.keyHelp
  setHelp(help, keyHelp)
  drawTitle($('title'), feed.place)
  setLocal(feed.local)
  const rows = Math.max(3, Number(state.options.windowRows) || 10)
  // Every line the window would hold; the box scrolls when they overflow.
  drawLines(rowsBox, feedLines(feed, freshList(), Math.max(rows, 200), false).lines)
}

function setMap(svg) {
  mapBox.innerHTML = svg
  untitle(mapBox)
  drawStatus($('status'), mapBox)
  markLocal(mapBox)
  placePins()
  showTip()
}

/** The made-up session at the current second, through the same calls the pane makes when it writes the window's feed. */
function drawScene() {
  if (!lib) return
  const s = elapsed()
  const { board, now } = boardAt(s, loopStart, { ...state.figures, errorReasons: state.options.errorReasons })
  const setup = lib.setupFrom(state.options)
  const room = mapRoom()
  mapBox.style.height = `${room.h}px`
  setMap(lib.framedMap(board, now, setup, room.w, room.h))
  const t = setup.t
  const line = lib.describeNow(board, t, now)
  renderRows({
    now: line.text,
    nowTone: line.tone,
    warnings: lib.warningsOf(board, now, t).map(w => w.line),
    plan: lib.planLines(board.plan, t),
    changed: lib.changedLine(board.changed, t) ?? null,
    pinned: lib.pinnedLines(board.entries, now, t),
    rows: lib.feedLines(board.entries, t, board.agentNames, board.turns, setup.contextCost),
    keyHelp: t.keyHelp,
    place: { repo: 'claude-code-lot-map', branch: 'worktree-preview', worktree: 'preview' },
    local: { title: t.localTitle, hosts: (board.local ?? []).map(l => l.host) },
  })
  $('scrub').value = String(s)
  $('clock').textContent = `${s.toFixed(1)} s`
}

/** A live session's own map and rows, as its window reads them; drawn again only when they change. */
let liveSeen = ''
async function drawLive() {
  const id = state.source
  try {
    const [svg, feed] = await Promise.all([
      fetch(`/api/live/${id}/map.svg`).then(r => (r.ok ? r.text() : Promise.reject(new Error('the session has no live map')))),
      fetch(`/api/live/${id}/feed.json`).then(r => r.json()),
    ])
    const room = mapRoom()
    mapBox.style.height = `${room.h}px`
    const sized = svg.replace(/^<svg([^>]*?) width="\d+" height="\d+"/, `<svg$1 width="${room.w}" height="${room.h}"`)
    if (sized !== liveSeen) {
      liveSeen = sized
      setMap(sized)
    }
    renderRows(feed)
    showError()
  } catch (error) {
    showError(`Live session: ${error.message}`)
  }
}

function draw() {
  if (state.source === 'scene') drawScene()
  else void drawLive()
}

// ---- tooltips ---------------------------------------------------------------------------------

let pointer
const showTip = () => showTipAt(tip, mapBox, pointer)

// The ? in the corner: the window's keys, as the map window shows them.
wireHelp(tip, help, () => keyHelp)
wireStatus(tip, $('status'))
wireSplit(
  $('split'),
  px => {
    state.listPx = Math.max(3 * LINE_H, Math.min(pane.clientHeight - 200, px - (innerHeight - pane.getBoundingClientRect().bottom)))
    draw()
  },
  save,
)
watchLocal(() => markLocal(mapBox))
mapBox.addEventListener('mousemove', e => {
  pointer = { x: e.clientX, y: e.clientY }
  showTip()
})
mapBox.addEventListener('mouseleave', () => {
  pointer = undefined
  showTip()
})

// ---- notes ------------------------------------------------------------------------------------

let notes = []
/** The map's own coordinates (its W by H drawing) of a point on the screen, and back. */
const inner = () => mapBox.querySelector('svg svg')
function toMap(x, y) {
  const svg = inner()
  const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM().inverse())
  return { x: Math.round(p.x), y: Math.round(p.y) }
}
function toBox(x, y) {
  const svg = inner()
  const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM())
  const box = mapBox.getBoundingClientRect()
  return { left: p.x - box.left, top: p.y - box.top }
}
function pinOf(n, title) {
  const pin = document.createElement('span')
  pin.className = 'pin'
  pin.textContent = String(n)
  pin.title = title
  return pin
}
function placePins() {
  if (!inner()) return
  for (const [i, note] of notes.entries()) {
    if (note.x === undefined) continue
    const pin = pinOf(i + 1, note.text)
    const { left, top } = toBox(note.x, note.y)
    pin.style.left = `${left}px`
    pin.style.top = `${top}px`
    mapBox.append(pin)
  }
}
function listNotes() {
  $('notes').replaceChildren(
    ...notes.map((note, i) => {
      const li = document.createElement('li')
      const body = document.createElement('div')
      body.textContent = note.text
      const meta = document.createElement('small')
      meta.textContent = [note.target, note.scene === undefined ? 'live' : `at ${note.scene} s`].filter(Boolean).join(' · ')
      body.append(meta)
      li.append(pinOf(i + 1, note.text), body)
      return li
    }),
  )
}
async function loadNotes() {
  notes = await fetch('/api/notes')
    .then(r => r.json())
    .catch(() => [])
  listNotes()
  draw()
}
mapBox.addEventListener('click', async e => {
  if (!e.shiftKey || !inner()) return
  const wasPlaying = state.isPlaying
  setPlaying(false)
  const found = tipAt(mapBox, e.clientX, e.clientY)
  const target = found?.tip?.name ?? found?.text
  const text = prompt(`Note${target ? ` on "${target}"` : ''}:`)
  if (text?.trim()) {
    const { x, y } = toMap(e.clientX, e.clientY)
    await fetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        text: text.trim(),
        x,
        y,
        target,
        scene: state.source === 'scene' ? Number(state.s.toFixed(1)) : undefined,
        options: { ...state.options, ...state.figures },
      }),
    })
    await loadNotes()
  }
  setPlaying(wasPlaying)
})
$('clearNotes').addEventListener('click', async () => {
  if (!confirm('Clear every note?')) return
  await fetch('/api/notes/clear', { method: 'POST' })
  await loadNotes()
})

// ---- controls ---------------------------------------------------------------------------------

function setPlaying(isPlaying) {
  if (isPlaying && !state.isPlaying) loopStart = Date.now() - state.s * 1000
  state.isPlaying = isPlaying
  $('play').textContent = isPlaying ? 'Pause' : 'Play'
  save()
}
$('play').addEventListener('click', () => setPlaying(!state.isPlaying))
$('scrub').max = String(LOOP_S)
$('scrub').addEventListener('input', () => {
  setPlaying(false)
  setTime(Number($('scrub').value))
  draw()
})
for (const chip of document.querySelectorAll('[data-jump]')) {
  chip.addEventListener('click', () => {
    setTime(Number(chip.dataset.jump))
    draw()
  })
}

/** Each control bound to its figure or option by id. */
function bind(selector, group) {
  for (const input of document.querySelectorAll(selector)) {
    const out = document.querySelector(`output[for="${input.id}"]`)
    const show = () => out && (out.textContent = input.id === 'cost' ? `$${Number(input.value).toFixed(2)}` : `${input.value}%`)
    if (input.type === 'checkbox') input.checked = state[group][input.id] === true
    else input.value = String(state[group][input.id])
    show()
    input.addEventListener('input', () => {
      state[group][input.id] = input.type === 'checkbox' ? input.checked : input.type === 'range' || input.type === 'number' ? Number(input.value) : input.value
      show()
      save()
      liveSeen = ''
      draw()
    })
  }
}
bind('[data-figure]', 'figures')
bind('[data-option]', 'options')

async function loadSessions() {
  const list = await fetch('/api/sessions')
    .then(r => r.json())
    .catch(() => [])
  const select = $('source')
  const options = [
    { value: 'scene', label: 'Made-up session (this worktree’s code)' },
    ...list.map(s => ({ value: s.id, label: `Live: ${s.name} · ${s.word ?? ''}` })),
  ]
  if (!options.some(o => o.value === state.source)) state.source = 'scene'
  select.replaceChildren(...options.map(o => new Option(o.label, o.value, false, o.value === state.source)))
}
$('source').addEventListener('change', () => {
  state.source = $('source').value
  liveSeen = ''
  const isScene = state.source === 'scene'
  for (const id of ['playback', 'figures', 'options']) $(id).disabled = !isScene
  save()
  draw()
})

// The pane's size is the person's own: dragging its corner lays the map out again, as a resize does in the terminal.
if (!windowed) {
  pane.style.width = `${state.pane.w}px`
  pane.style.height = `${state.pane.h}px`
}
new ResizeObserver(() => {
  liveSeen = ''
  draw()
  save()
}).observe(pane)

// A save in hooks/ or here reloads the page where it was.
new EventSource('/events').addEventListener('message', e => {
  if (e.data !== 'reload') return
  save()
  location.reload()
})
addEventListener('beforeunload', save)

setPlaying(state.isPlaying)
await loadSessions()
$('source').dispatchEvent(new Event('change'))
await loadNotes()
// The made-up session moves four times a second; a live one is read once a second.
let ticks = 0
setInterval(() => {
  ticks += 1
  if (state.source === 'scene' ? state.isPlaying : ticks % 4 === 0) draw()
}, 250)
setInterval(loadSessions, 5000)
