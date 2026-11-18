// The preview page: draws the window (map and rows) from the made-up session or a live one, with tooltips and notes.

import { LOOP_S, boardAt } from './scene.js'

const $ = id => document.getElementById(id)
const pane = $('pane')
const mapBox = $('map')
const rowsBox = $('rows')
const tip = $('tip')
const LINE_H = 17

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

/** The map's room in the pane: what is left above the rows, the hint and the gap. */
function mapRoom() {
  const rows = Math.max(3, Number(state.options.windowRows) || 10)
  const room = Math.max(120, pane.clientHeight - (rows + 1) * LINE_H - 16)
  // As large as the width allows while the rows keep their room, as renderer/layout.mjs lays out the window.
  return { w: pane.clientWidth, h: Math.min(room, Math.round((pane.clientWidth * (lib?.H ?? 430)) / (lib?.W ?? 460))) }
}

function renderRows(feed) {
  const rows = Math.max(3, Number(state.options.windowRows) || 10)
  const lines = [{ line: feed.now ?? '', cls: `n-${feed.nowTone ?? 'plain'}` }]
  for (const w of feed.warnings ?? []) lines.push({ line: w, cls: 't-run' })
  for (const p of feed.plan ?? []) lines.push({ line: p.line, cls: `t-${p.tone}${p.isBold ? ' b' : ''}` })
  if (feed.changed) lines.push({ line: feed.changed.line, cls: `t-${feed.changed.tone}` })
  for (const p of feed.pinned ?? []) lines.push({ line: p.line, cls: `t-${p.tone}` })
  for (const r of feed.rows ?? []) lines.push({ line: r.line, cls: `t-${r.tone}${r.isBold ? ' b' : ''}` })
  rowsBox.replaceChildren(
    ...lines.slice(0, rows).map(({ line, cls }) => {
      const div = document.createElement('div')
      div.className = cls
      div.textContent = line
      return div
    }),
  )
}

function setMap(svg) {
  mapBox.innerHTML = svg
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
/** The title of whatever is under the pointer, walking up to the nearest element that carries one. */
function titleAt(x, y) {
  for (let el = document.elementFromPoint(x, y); el && el !== mapBox; el = el.parentElement) {
    const title = [...el.children].find(c => c.tagName.toLowerCase() === 'title')
    if (title) return title.textContent
  }
  return undefined
}
/** The structured tooltip of whatever is under the pointer, when the drawing gives one (a station does). */
function tipAt(x, y) {
  for (let el = document.elementFromPoint(x, y); el && el !== mapBox; el = el.parentElement) {
    const data = el.getAttribute?.('data-tip')
    if (data) return JSON.parse(data)
  }
  return undefined
}

// The figures' icons on a 24-unit grid; each matches the mark it explains on the map, where there is one.
const ICONS = {
  calls: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  turn: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  running: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  errors: '<rect x="5" y="5" width="14" height="14" fill="currentColor" stroke="none"/>',
  session: '<path d="M18 6 6 18M6 6l12 12"/>',
  refused: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  pushed: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  tokens: '<path d="m12 3 9 4.5-9 4.5-9-4.5zM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
}
// An icon carries its own size, so it stays small even before the page's styles apply.
const svgIcon = (inner, size = 16, viewBox = '0 0 24 24', width = 2) =>
  `<svg width="${size}" height="${size}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// Backticks in the words mark a command.
const withCode = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')

/** A station's tooltip: its icon and name, what lands there, then a row for each figure. */
function tipHtml(t) {
  const glyph = lib.STATIONS.find(s => s.id === t.station)?.icon ?? ''
  const rows = t.figures
    .map(f => `<div class="fig${f.tone ? ` t-${f.tone}` : ''}">${svgIcon(ICONS[f.icon] ?? '')}<span>${esc(f.label)}</span><b>${esc(f.value)}</b></div>`)
    .join('')
  return (
    `<div class="tip-head">${svgIcon(`<path d="${esc(glyph)}"/>`, 20, '-10 -10 20 20', 1.4)}<strong>${esc(t.name)}</strong></div>` +
    `<p class="tip-about">${withCode(t.about)}</p><div class="tip-figures">${rows}</div>`
  )
}

function showTip() {
  const rich = pointer && tipAt(pointer.x, pointer.y)
  const text = pointer && !rich && titleAt(pointer.x, pointer.y)
  tip.style.display = rich || text ? 'block' : 'none'
  if (!rich && !text) return
  tip.classList.toggle('rich', Boolean(rich))
  if (rich) tip.innerHTML = tipHtml(rich)
  else tip.textContent = text
  // Beside the pointer, flipped to the other side near an edge of the window.
  const left = pointer.x + 16 + tip.offsetWidth > innerWidth - 8 ? pointer.x - 16 - tip.offsetWidth : pointer.x + 16
  const top = pointer.y + 18 + tip.offsetHeight > innerHeight - 8 ? pointer.y - 12 - tip.offsetHeight : pointer.y + 18
  tip.style.left = `${Math.max(8, left)}px`
  tip.style.top = `${Math.max(8, top)}px`
}
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
  const target = titleAt(e.clientX, e.clientY)
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
