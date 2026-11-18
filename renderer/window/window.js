// The map window: one session's live map and the lines under it, fetched when the server says they changed. The keys
// are the terminal window's: m, ?, the arrows and PgUp/PgDn, e, 1-9 and 0, a, / and q.

import { feedLines, freshList, listKey, nextAgent } from './lines.mjs'
import { drawLines, drawStatus, drawTitle, markLocal, setHelp, setLocal, showTip, untitle, watchLocal, wireHelp, wireSplit, wireStatus } from './ui.js'

const $ = id => document.getElementById(id)
const mapBox = $('map')
const linesBox = $('lines')
const splitBox = $('split')
const help = $('help')
const tip = $('tip')
const live = new URLSearchParams(location.search).get('live') ?? ''
const LINE_H = 22
/** Rows the map keeps however short the window: the list gives way first. */
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
  return box ? Number(box[2]) / Number(box[1]) : 454 / 460
}

/** How tall you dragged the lines to be, kept by the server for every window, Edge's and the split's; 0 until then. */
let listPx =
  (await fetch('split')
    .then(r => (r.ok ? r.text() : '0'))
    .then(Number)
    .catch(() => 0)) || 0

/**
 * The map as large as the width allows. The lines under it keep the height you dragged them to; until then the
 * session's windowRows, while the map keeps half the room. Never under twelve rows.
 */
function mapSize() {
  if (view === 'list') return { w: 0, h: 0 }
  // The line of local servers, when it shows, takes its room from the map's.
  const room = innerHeight - $('top').offsetHeight
  const rest = room - splitBox.offsetHeight
  const rows = Math.max(3, Number(feed.windowRows) || 30) * LINE_H + 8
  const tall = view === 'map' ? room : Math.max(MAP_MIN_ROWS * 17, listPx > 0 ? rest - listPx : Math.max(room / 2, rest - rows))
  return { w: innerWidth, h: Math.max(0, Math.round(Math.min(tall, innerWidth * aspect()))) }
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
  drawStatus($('status'), mapBox)
  markLocal(mapBox)
  showTip(tip, mapBox, pointer)
}

/** Whether the list shows the log: scrolled into it, or filtered. */
const inLog = () => list.logAt > 0 || list.onlyErrors || list.onlyStation !== '' || list.search !== '' || list.isTyping

/**
 * The live rows may hold more than fit, and the wheel scrolls them. The log shows what fits, so that the arrows, PgUp
 * and PgDn and the wheel move through it: asked for more rows than fit, it would hold its scroll at the top.
 */
function drawRows() {
  if (view === 'map') return
  const room = Math.max(1, Math.floor((linesBox.clientHeight - 8) / LINE_H))
  const shown = feedLines(feed, list, inLog() ? room : Math.max(room, 200), showsLegend)
  list = shown.list
  page = room
  drawLines(linesBox, shown.lines)
  if (inLog()) linesBox.scrollTop = 0
}

// In the log the wheel moves it as the arrows do, a row a notch; past the end of the live rows it goes on into the log.
linesBox.addEventListener(
  'wheel',
  e => {
    const isAtEnd = linesBox.scrollTop + linesBox.clientHeight >= linesBox.scrollHeight - 1
    if (!inLog() && !(e.deltaY > 0 && isAtEnd)) return
    e.preventDefault()
    const rows = Math.max(1, Math.round(Math.abs(e.deltaY) / LINE_H))
    for (let i = 0; i < rows; i++) list = listKey(list, e.deltaY > 0 ? 'ArrowDown' : 'ArrowUp', feed, page).list
    drawRows()
  },
  { passive: false },
)

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
  // The ? shows once the session sends its keys; the title once it names its repository.
  setHelp(help, feed.keyHelp)
  drawTitle($('title'), feed.place)
  setLocal(feed.local)
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
wireHelp(tip, help, () => feed.keyHelp)
wireStatus(tip, $('status'))
wireSplit(
  splitBox,
  px => {
    listPx = Math.max(3 * LINE_H, Math.min(innerHeight - MAP_MIN_ROWS * 17, px))
    drawMap()
    drawRows()
  },
  () => void fetch('split', { method: 'PUT', body: String(listPx) }).catch(() => {}),
)
watchLocal(() => markLocal(mapBox))
