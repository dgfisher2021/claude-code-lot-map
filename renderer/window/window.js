// The map window: one session's live map and the lines under it, fetched when the server says they changed. The keys
// are the terminal window's: m, ?, the arrows and PgUp/PgDn, e, 1-9 and 0, a, / and q.

import { feedLines, freshList, listKey, nextAgent } from './lines.mjs'
import { drawLines, setCorner, showTip, untitle, wireCorner } from './ui.js'

const $ = id => document.getElementById(id)
const mapBox = $('map')
const linesBox = $('lines')
const corner = { keys: $('keys'), commands: $('commands') }
const tip = $('tip')
const live = new URLSearchParams(location.search).get('live') ?? ''
const LINE_H = 17
/** Rows the map keeps however short the window, as layout.mjs has it: the list gives way first. */
const MAP_MIN_ROWS = 12

/** The live map as the session last wrote it, and the size it was last drawn at. */
let svg = ''
let drawn = ''
let feed = {}
let list = freshList()
let page = 5
let showsLegend = false
/** What the window shows: the map with the list under it, the map alone, or the list alone. `m` goes round them. */
let view = 'both'
let pointer

function say(text) {
  mapBox.innerHTML = `<div id="say">${text}</div>`
  drawn = ''
}

/** The map's proportions, from its own drawing. */
function aspect() {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  return box ? Number(box[2]) / Number(box[1]) : 430 / 460
}

/** The map as large as the width allows while the list keeps the session's windowRows, never under twelve rows. */
function mapSize() {
  if (view === 'list') return { w: 0, h: 0 }
  const room = innerHeight
  const listRows = Math.max(3, Number(feed.windowRows) || 10)
  const tall = view === 'map' ? room : Math.max(MAP_MIN_ROWS * LINE_H, room - listRows * LINE_H - 8)
  return { w: innerWidth, h: Math.max(0, Math.min(tall, Math.round(innerWidth * aspect()))) }
}

/** Draws the map again only when it or its size changed: a fresh drawing starts its animations over. */
function drawMap() {
  const { w, h } = mapSize()
  mapBox.style.display = h === 0 ? 'none' : ''
  linesBox.style.display = view === 'map' ? 'none' : ''
  mapBox.style.height = `${h}px`
  const key = `${svg}:${w}x${h}`
  if (svg === '' || h === 0 || key === drawn) return
  drawn = key
  mapBox.innerHTML = svg.replace(/^(<svg\b[^>]*?)\swidth="\d+"\sheight="\d+"/, `$1 width="${w}" height="${h}"`)
  untitle(mapBox)
  showTip(tip, mapBox, pointer)
}

function drawRows() {
  if (view === 'map') return
  const room = Math.max(1, Math.floor((linesBox.clientHeight - 8) / LINE_H))
  const shown = feedLines(feed, list, room, showsLegend)
  list = shown.list
  page = shown.page ?? page
  drawLines(linesBox, shown.lines)
}

async function fetchMap() {
  const text = await fetch(`live/${live}/map.svg`)
    .then(r => (r.ok ? r.text() : ''))
    .catch(() => '')
  // A map caught while the session writes it is left for the next event.
  if (!text.trimEnd().endsWith('</svg>') || text === svg) return
  svg = text
  drawMap()
}

async function fetchFeed() {
  const next = await fetch(`live/${live}/feed.json`)
    .then(r => (r.ok ? r.json() : undefined))
    .catch(() => undefined)
  if (next === undefined) return
  const isResized = next.windowRows !== feed.windowRows
  feed = next
  // The corner's buttons show once the session sends its keys and commands.
  setCorner(corner, feed.keyHelp)
  if (isResized) drawMap()
  drawRows()
}

// The server says what changed in the live folder; `gone` when the session has ended, and the window closes with it.
const events = new EventSource(`live/${live}/events`)
events.addEventListener('message', e => {
  if (e.data === 'map') void fetchMap()
  else if (e.data === 'feed') void fetchFeed()
  else if (e.data === 'gone') {
    events.close()
    window.close()
    say('The session has ended.')
  }
})

// The title names the session's folder, so that one window tells from another.
fetch(`live/${live}/about`)
  .then(r => r.json())
  .then(({ name }) => {
    if (name) document.title = `${name} · Work map`
  })
  .catch(() => {})

const NAMED = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Escape', 'Backspace'])
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || (!NAMED.has(e.key) && e.key.length !== 1)) return
  const before = list
  const pressed = listKey(list, e.key, feed, page)
  list = pressed.list
  // A key the list did not take is one of the window's own.
  if (list === before && !pressed.took) {
    if (e.key === 'q') return window.close()
    if (e.key === '?') showsLegend = !showsLegend
    else if (e.key === 'm') {
      view = view === 'both' ? 'map' : view === 'map' ? 'list' : 'both'
      drawMap()
    } else if (e.key === 'a') list = nextAgent(list, feed)
    else return
  }
  e.preventDefault()
  drawRows()
})

addEventListener('resize', () => {
  drawMap()
  drawRows()
})
mapBox.addEventListener('mousemove', e => {
  pointer = { x: e.clientX, y: e.clientY }
  showTip(tip, mapBox, pointer)
})
mapBox.addEventListener('mouseleave', () => {
  pointer = undefined
  showTip(tip, mapBox, pointer)
})
wireCorner(tip, corner, () => feed.keyHelp)
