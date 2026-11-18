// What the map knows: which station an action belongs to, what to call it, and how to draw the board.
// Nothing here touches the engine.
import type { Board, Entry, PlanItem, Satellite, StationId, Status, TimelineMark, TurnSummary } from '../types'
import { clean, formatMs, shortModel } from './classify'
import { stringsFor, tokensShort } from './text'
import type { Strings } from './text'

export { classify, clean, firstLine, formatMs, memoryIds, shortModel } from './classify'

// ---- stations ---------------------------------------------------------------------------------

export const STATIONS: { id: StationId; icon: string }[] = [
  { id: 'you', icon: `${ring(0, -3.6, 3.4)}M-6.5 8c0-4 3-6.2 6.5-6.2s6.5 2.2 6.5 6.2` },
  { id: 'model', icon: 'M-5 -5h10v10h-10zM-2 -8.5v3.5M2 -8.5v3.5M-2 5v3.5M2 5v3.5M-8.5 -2h3.5M-8.5 2h3.5M5 -2h3.5M5 2h3.5' },
  { id: 'memory', icon: `M-5 4.5L0 -5L6 3.5M-5 4.5L6 3.5${ring(-5, 4.5, 2.1)}${ring(0, -5, 2.1)}${ring(6, 3.5, 2.1)}` },
  { id: 'files', icon: 'M-5.5 -8h7.5l3.5 3.5v12.5h-11zM2 -8v3.5h3.5' },
  { id: 'shell', icon: 'M-7.5 -5l5 5l-5 5M0 6h7.5' },
  { id: 'web', icon: `${ring(0, 0, 7.8)}M-7.8 0h15.6M0 -7.8c-4.2 4.2 -4.2 11.4 0 15.6M0 -7.8c4.2 4.2 4.2 11.4 0 15.6` },
  { id: 'browser', icon: 'M-8.5 -6.5h17v13h-17zM-8.5 -2.8h17M-6.3 -4.7h.1M-3.8 -4.7h.1' },
  { id: 'agents', icon: `M0 -4v3.5M0 -.5L-6 4M0 -.5L6 4${ring(0, -6, 2.1)}${ring(-6.5, 5.5, 2.1)}${ring(6.5, 5.5, 2.1)}` },
  { id: 'skills', icon: 'M1.5 -8.5L-5.5 1h4.5l-1.5 7.5l7.5 -9.8h-4.5z' },
  { id: 'hooks', icon: `M2.5 -5.5v8a4.2 4.2 0 1 1 -8.4 0v-1.5${ring(2.5, -7.3, 1.8)}` },
]

function ring(x: number, y: number, r: number): string {
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}

// ---- what the person set -----------------------------------------------------------------------

/** The mod's options made ready to use. Whatever is missing or malformed counts as not set. */
export type Setup = {
  t: Strings
  core: string
  memoryServers: ReadonlySet<string>
  memoryCommands: readonly string[]
  /** The words after a memory command that may be shown. Any other word could be content. */
  memorySubcommands: ReadonlySet<string>
  memoryPaths: readonly string[]
  memoryLabels: ReadonlyMap<string, string>
  /** The station the person gave an MCP server: the server's tools and resources go there, unless it is a memory server. */
  serverStations: ReadonlyMap<string, StationId>
  hookRecords: boolean
  /** Whether the first line of a hook's refusal is shown. Off, the row names only the tool. */
  hookReasons: boolean
  /** Whether the first line of a failed call's error is shown on its row. Off, the row says only that it failed. */
  errorReasons: boolean
  /** Whether a row says about how much its call added to the context, a station's count line its sum, and a pulse's width follows it. */
  contextCost: boolean
  /** Whether the mod listens to the five events an organisation's guard keeps a mod away from. Off, it adds no hook on them. */
  guardedHooks: boolean
  theme: 'auto' | 'dark' | 'light' | 'contrast'
  /** Whether the map paints its own ground, or leaves the surface it lies on showing through. */
  background: 'solid' | 'transparent'
  /** Colors the person set, by their place in the palette. They hold on any surface; the rest follows the theme. */
  colors: Partial<Palette>
  /** Who sits at the top of the ring: the person, or the network with the person at the bottom. */
  layout: 'you-top' | 'you-bottom'
  /** With `reduced` nothing on the map moves by itself: the same state is shown still. */
  motion: 'full' | 'reduced'
  /** Whether a terminal draws the map in cells above the rows, or the rows alone. */
  terminalMap: boolean
  /** In a terminal that shows pictures, whether the map is a picture a browser paints (`auto`) or stays in cells (`off`). */
  terminalPicture: 'auto' | 'off'
  /** In Windows Terminal from WSL, whether the map is a window of its own in place of the pane (`auto`) or the pane (`off`). */
  terminalWindow: 'auto' | 'pane' | 'off'
  /** Whether a spoke wears by its station's calls or by its share of the busy time. */
  spokes: 'calls' | 'time'
  /** Whether a wait on the person and a finished turn raise a notification. */
  notify: boolean
  /** The rows the map window keeps for the list under the map: 3 to 30. */
  windowRows: number
}

const SERVER_STATIONS: readonly StationId[] = ['files', 'shell', 'web', 'browser', 'agents', 'skills', 'you']

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => String(x).trim()).filter(x => x !== '')

export function setupFrom(options: Readonly<Record<string, unknown>> = {}): Setup {
  const memoryLabels = new Map<string, string>()
  for (const pair of list(options.memoryLabels)) {
    const at = pair.indexOf('=')
    if (at > 0 && at < pair.length - 1) memoryLabels.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
  }
  const serverStations = new Map<string, StationId>()
  for (const pair of list(options.serverStations)) {
    const at = pair.indexOf('=')
    const station = SERVER_STATIONS.find(id => id === pair.slice(at + 1).trim())
    if (at > 0 && station !== undefined) serverStations.set(pair.slice(0, at).trim(), station)
  }
  const core = typeof options.coreName === 'string' ? options.coreName.trim().slice(0, 10) : ''
  return {
    t: stringsFor(options.language),
    core: core === '' ? 'CLAUDE' : core,
    memoryServers: new Set(list(options.memoryServers)),
    memoryCommands: list(options.memoryCommands),
    memorySubcommands: new Set(list(options.memorySubcommands)),
    memoryPaths: list(options.memoryPaths),
    memoryLabels,
    serverStations,
    hookRecords: options.hookRecords === true,
    hookReasons: options.hookReasons === true,
    errorReasons: options.errorReasons === true,
    contextCost: options.contextCost === true,
    guardedHooks: !(options.guardedHooks === false || options.guardedHooks === 'false'),
    theme: options.theme === 'dark' || options.theme === 'light' || options.theme === 'contrast' ? options.theme : 'auto',
    background: options.background === 'transparent' ? 'transparent' : 'solid',
    colors: colorsFrom(options.colors),
    layout: options.layout === 'you-bottom' ? 'you-bottom' : 'you-top',
    motion: options.motion === 'reduced' ? 'reduced' : 'full',
    terminalMap: options.terminalMap !== false,
    terminalPicture: options.terminalPicture === 'off' ? 'off' : 'auto',
    terminalWindow: options.terminalWindow === 'off' || options.terminalWindow === 'pane' ? options.terminalWindow : 'auto',
    spokes: options.spokes === 'time' ? 'time' : 'calls',
    notify: options.notify === true,
    windowRows: Math.min(30, Math.max(3, Math.round(Number(options.windowRows ?? 10)) || 10)),
  }
}

const busyAll = (board: Board): number => Object.values(board.busyMs ?? {}).reduce((a, b) => a + b, 0)

/** A station's share of the session's busy time, in whole percent. */
export function timeShareOf(board: Board, id: StationId): number {
  const all = busyAll(board)
  return all > 0 ? Math.round(((board.busyMs?.[id] ?? 0) / all) * 100) : 0
}

/** How worn a spoke is, 0 to 1: by the station's calls, or with `spokes: time` by its share of the busy time, on the same scale. */
export function wearOf(board: Board, id: StationId, setup: Setup): number {
  if (setup.spokes !== 'time') return Math.min(1, Math.log2(1 + (board.counts[id] ?? 0)) / 7)
  const all = busyAll(board)
  const calls = Object.values(board.counts).reduce((a, b) => a + b, 0)
  const asCalls = all > 0 ? ((board.busyMs?.[id] ?? 0) / all) * calls : 0
  return Math.min(1, Math.log2(1 + asCalls) / 7)
}

// ---- drawing ----------------------------------------------------------------------------------

export const W = 460
export const H = 430
export const CX = 230
export const CY = 212
export const RX = 176
export const RY = 164
export const NODE = 22
export const CORE = 40
/** Where spokes and pulses meet the core: outside the context ring. */
export const HUB = CORE + 8

export type Palette = {
  ground: string
  raised: string
  line: string
  spoke: string
  bone: string
  ash: string
  dim: string
  accent: string
  hot: string
  red: string
  mem: string
  memHot: string
  /** The route between stations: as light as the words on a dark ground, a soft grey on a light one, where a thin dark line weighs much more. */
  trail: string
}

const DARK: Palette = {
  ground: '#0a0c11',
  raised: '#12151c',
  line: '#272c36',
  spoke: '#1a1e27',
  bone: '#ebe6dc',
  ash: '#9ba1ab',
  dim: '#6b7280',
  accent: '#e1ac6e',
  hot: '#f0c595',
  red: '#e8654f',
  mem: '#62c7ba',
  memHot: '#a5e6dc',
  // One step away from `bone`, so that the light rules can give the route a color of its own.
  trail: '#ebe6dd',
}

const LIGHT: Palette = {
  ground: '#f5f2ea',
  raised: '#ffffff',
  line: '#cfc9bc',
  spoke: '#e3ded2',
  bone: '#1f2228',
  ash: '#5f6570',
  dim: '#8b909a',
  accent: '#b8762a',
  hot: '#8f560f',
  red: '#c5402b',
  mem: '#1c8c81',
  memHot: '#136a62',
  trail: '#9c978b',
}

/** The dark palette at full contrast: text at 7:1 or more against the ground, every mark at 4.5:1 or more. */
const CONTRAST: Palette = {
  ground: '#000000',
  raised: '#0d0f14',
  line: '#8a909c',
  spoke: '#7c828e',
  bone: '#ffffff',
  ash: '#e0e3e8',
  dim: '#b4b9c2',
  accent: '#ffc266',
  hot: '#ffe0b3',
  red: '#ff7a66',
  mem: '#4de3d1',
  memHot: '#b3fff5',
  trail: '#f0f0f0',
}

const PALETTES = { auto: DARK, dark: DARK, light: LIGHT, contrast: CONTRAST }

/** The palette a drawing paints with: the theme's, with the person's own colors over it. `auto` starts from the dark one. */
export const paletteOf = (setup: Setup): Palette => ({ ...PALETTES[setup.theme], ...setup.colors })

/**
 * For `auto`: the drawing is made in the dark palette, and these rules repaint it where the surface around it is light.
 * Every color on the map is one of the palette's, written as a plain attribute, so a rule per color reaches all of it;
 * a surface that drops the rules shows the dark map, whole.
 */
const lightRules = (own: Partial<Palette> = {}): string =>
  `<style>@media (prefers-color-scheme: light){${(Object.keys(DARK) as (keyof Palette)[])
    // A color the person set stays as it is, and so does anything that shares its value with one.
    .filter(k => own[k] === undefined && !Object.values(own).includes(DARK[k]))
    .map(k => `[fill="${DARK[k]}"]{fill:${LIGHT[k]}}[stroke="${DARK[k]}"]{stroke:${LIGHT[k]}}`)
    .join('')}}</style>`

/** The names a person writes for the places of the palette. */
export const COLOR_NAMES: Record<string, keyof Palette> = {
  background: 'ground',
  node: 'raised',
  line: 'line',
  spoke: 'spoke',
  text: 'bone',
  label: 'ash',
  faint: 'dim',
  accent: 'accent',
  active: 'hot',
  error: 'red',
  memory: 'mem',
  memoryActive: 'memHot',
  route: 'trail',
}

/**
 * `accent=#ff9900, background=#101418` made into palette entries. A color goes into the drawing as it is written,
 * so only `#rgb` and `#rrggbb` pass; an unknown name or anything else counts as not set.
 */
function colorsFrom(v: unknown): Partial<Palette> {
  const out: Partial<Palette> = {}
  for (const pair of list(v)) {
    const at = pair.indexOf('=')
    const key = COLOR_NAMES[pair.slice(0, at).trim()]
    const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.exec(pair.slice(at + 1).trim())?.[0].toLowerCase()
    if (at < 1 || key === undefined || hex === undefined) continue
    out[key] = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
  }
  return out
}

/** With reduced motion the clock hands step this often, and the marks that fade switch off instead. */
export const STILL_STEP_MS = 5000

/** Under reduced motion, how long until the map next changes by itself: a lit mark going out, a trail leg going, a clock hand stepping. */
export function stillChangeIn(board: Board, now: number): number | undefined {
  const recent = board.entries.slice(-40)
  const waits: number[] = []
  for (const s of STATIONS) {
    const { running, isLit, isAlarm, fade, span } = stationState(s.id, recent, board, now)
    if (running.length > 0) {
      const elapsed = now - Math.min(...running.map(e => e.startedAt))
      waits.push(STILL_STEP_MS - (elapsed % STILL_STEP_MS))
    } else if (isLit || isAlarm) waits.push(span - fade)
  }
  for (const leg of legsOf(recent, now)) if (leg.age < TRAIL_HOLD_MS) waits.push(TRAIL_HOLD_MS - leg.age)
  return waits.length > 0 ? Math.max(1, Math.min(...waits)) : undefined
}

const FONT = 'font-family="SF Mono, ui-monospace, Menlo, monospace"'

export const PULSE_MS = 800
export const RIPPLE_MS = 450
export const GLOW_MS = 3200
export const ALARM_MS = 6000
export const SWITCH_MS = 8000
export const DONE_MS = 1100
const TRAIL_STOPS = 7
/** A leg of the route stays for a while after it was drawn, then fades: the route shows where the work is going, and the spokes keep where it went. */
export const TRAIL_HOLD_MS = 40_000
export const TRAIL_FADE_MS = 20_000

export type Point = { x: number; y: number }

/** How many places the ring is turned. The stations keep their order, so the far side of the person is always the network. */
let shift = 0
/** Turns the ring for the person's layout: every drawing does this before it places a station. */
export function orient(setup: Setup): void {
  shift = setup.layout === 'you-bottom' ? STATIONS.length / 2 : 0
}
const turn = (i: number): number => ((i + shift) * 2 * Math.PI) / STATIONS.length
const at = (a: number, f = 1): Point => ({ x: CX + RX * f * Math.sin(a), y: CY - RY * f * Math.cos(a) })
export const place = (i: number): Point => at(turn(i))
export const indexOf = (id: StationId): number => STATIONS.findIndex(s => s.id === id)

const n1 = (v: number): string => (Math.round(v * 10) / 10).toString()
/** A moment on the drawing's own clock, which starts at zero each time it is drawn; a past moment is negative. */
const clock = (ms: number): string => `${(ms / 1000).toFixed(3)}s`

/** Where a straight line from `from` to `to` meets the circle of radius `r` around `from`. */
export function edge(from: Point, to: Point, r: number): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: from.x + ((to.x - from.x) * r) / d, y: from.y + ((to.y - from.y) * r) / d }
}

/** The same line moved sideways, so that several pulses on one spoke fly side by side. */
export function aside(a: Point, b: Point, off: number): [Point, Point] {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const dx = (-(b.y - a.y) * off) / d
  const dy = ((b.x - a.x) * off) / d
  return [{ x: a.x + dx, y: a.y + dy }, { x: b.x + dx, y: b.y + dy }]
}

/** With `contextCost`, a pulse's radius grows with its call's tokens: 3 at none, 7 from 50k, square-root scaled. */
export function pulseRadius(tokens: number | undefined, fallback: number): number {
  return tokens === undefined ? fallback : 3 + 4 * Math.sqrt(Math.min(Math.max(tokens, 0), 50_000) / 50_000)
}

/** A pulse with a short tail behind it. A hollow one is a signal nobody asked for. */
function pulse(a: Point, b: Point, color: string, age: number, radius: number, isHollow = false): string {
  // A negative begin carries on where the last drawing left off, so a redraw never restarts a flight.
  const path = `M${n1(a.x)} ${n1(a.y)}L${n1(b.x)} ${n1(b.y)}`
  let out = ''
  for (let k = isHollow ? 0 : 2; k >= 0; k--) {
    const timing = `begin="${clock(k * 45 - age)}" dur="${clock(PULSE_MS)}" fill="freeze"`
    const peak = n1(1 - 0.36 * k)
    const paint = isHollow ? `fill="none" stroke="${color}" stroke-width="1.4"` : `fill="${color}"`
    out +=
      `<circle r="${n1(radius * (1 - 0.27 * k))}" ${paint} opacity="0">` +
      `<animateMotion path="${path}" ${timing}/>` +
      `<animate attributeName="opacity" values="${peak};${peak};0" keyTimes="0;.82;1" ${timing}/>` +
      `</circle>`
  }
  return out
}

/** A ring that spreads from where a pulse lands, at the moment it lands. */
function ripple(p: Point, r: number, color: string, age: number): string {
  const timing = `begin="${clock(PULSE_MS - age)}" dur="${clock(RIPPLE_MS)}" fill="freeze"`
  return (
    `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${r}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0">` +
    `<animate attributeName="r" values="${r};${r + 11}" ${timing}/>` +
    `<animate attributeName="opacity" values=".7;0" ${timing}/></circle>`
  )
}

function beam(a: Point, b: Point, color: string, age: number, isDashed: boolean): string {
  return (
    `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${color}" stroke-width="1.4"${isDashed ? ' stroke-dasharray="3 4"' : ''} opacity="0">` +
    `<animate attributeName="opacity" values=".75;0" begin="${clock(-age)}" dur="${clock(GLOW_MS / 2)}" fill="freeze"/></line>`
  )
}

/** How far from the core a leg bends, by how many stations apart its ends are: far enough in to clear the labels under the nodes, far enough out to clear the core. */
const BEND = [0.5, 0.5, 0.4, 0.45, 0.55, 0.75]

/** The way from one station to another: a curve from `a` to `b` through `bend`, in the room between the core and the ring. */
export function legPoints(i: number, j: number): { a: Point; bend: Point; b: Point } {
  const n = STATIONS.length
  let steps = (((j - i) % n) + n) % n
  if (steps > n / 2) steps -= n
  const bend = at(turn(i + steps / 2), BEND[Math.abs(steps)] ?? 0.5)
  return { a: edge(place(i), bend, NODE + 4), bend, b: edge(place(j), bend, NODE + 4) }
}

function leg(i: number, j: number): { path: string; end: Point } {
  const { a, bend, b } = legPoints(i, j)
  return { path: `M${n1(a.x)} ${n1(a.y)}Q${n1(bend.x)} ${n1(bend.y)} ${n1(b.x)} ${n1(b.y)}`, end: b }
}

/** The legs of the route still on the map: `k` counts from the oldest, and `age` is how long ago the leg was drawn. */
export function legsOf(entries: readonly Entry[], now: number): { from: StationId; to: StationId; at: number; k: number; count: number; age: number }[] {
  const stops = routeOf(entries)
  const legs = []
  for (let k = 1; k < stops.length; k++) {
    const from = stops[k - 1]
    const to = stops[k]
    if (from === undefined || to === undefined) continue
    const age = now - to.at
    if (age >= TRAIL_HOLD_MS + TRAIL_FADE_MS) continue
    legs.push({ from: from.station, to: to.station, at: to.at, k, count: stops.length, age })
  }
  return legs
}

/** The stations the main loop went through, oldest first, a station visited twice in a row counted once. */
export function routeOf(entries: readonly Entry[], max = TRAIL_STOPS): { station: StationId; at: number }[] {
  const stops: { station: StationId; at: number }[] = []
  for (const e of entries) {
    if (e.from === 'agents' || e.station === 'model') continue
    const last = stops[stops.length - 1]
    if (last !== undefined && last.station === e.station) last.at = e.startedAt
    else stops.push({ station: e.station, at: e.startedAt })
  }
  return stops.slice(-max)
}

function trail(entries: readonly Entry[], now: number, c: Palette, isStill: boolean): string {
  let out = ''
  for (const { from, to, at: toAt, k, count, age } of legsOf(entries, now)) {
    // A leg that cannot fade is not drawn once its time is up.
    if (isStill && age >= TRAIL_HOLD_MS) continue
    const { path, end } = leg(indexOf(from), indexOf(to))
    const isHead = k === count - 1
    const opacity = n1(0.12 + (0.5 * k) / (count - 1))
    // The fading is written into the drawing, so a leg goes out on time even when nothing redraws the map.
    const fade = isStill
      ? ''
      : `<animate attributeName="opacity" values="${opacity};0" begin="${clock(TRAIL_HOLD_MS - age)}" dur="${clock(TRAIL_FADE_MS)}" fill="freeze"/>`
    // The newest leg draws itself; the rest are already there.
    const drawing =
      isHead && !isStill
        ? ` pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" values="1;0" begin="${clock(toAt - now)}" dur=".5s" fill="freeze"/>`
        : '>'
    out += `<path d="${path}" fill="none" stroke="${c.trail}" stroke-width="${isHead ? 1.5 : 1.1}" stroke-linecap="round" opacity="${opacity}"${drawing}${fade}</path>`
    if (isHead) {
      out += isStill
        ? `<circle cx="${n1(end.x)}" cy="${n1(end.y)}" r="2.4" fill="${c.trail}" opacity=".85"/>`
        : `<circle cx="${n1(end.x)}" cy="${n1(end.y)}" r="2.4" fill="${c.trail}" opacity="0">` +
          `<animate attributeName="opacity" values="0;.85" begin="${clock(toAt - now + 400)}" dur=".15s" fill="freeze"/>` +
          `<animate attributeName="opacity" values=".85;0" begin="${clock(TRAIL_HOLD_MS - age)}" dur="${clock(TRAIL_FADE_MS)}" fill="freeze"/></circle>`
    }
  }
  return out
}

/** What a station shows at a moment: what runs there, whether it glows or rings red, and how far its glow has faded. */
export type StationState = { count: number; running: Entry[]; isLit: boolean; isAlarm: boolean; fade: number; span: number }

export function stationState(id: StationId, entries: readonly Entry[], board: Board, now: number): StationState {
  const own = entries.filter(e => e.station === id)
  const running = own.filter(e => e.status === 'run')
  const latest = own.length > 0 ? own[own.length - 1] : undefined
  const since = latest === undefined ? Infinity : now - (latest.endedAt ?? latest.startedAt)
  const alarm = own.filter(e => e.status === 'block' || e.status === 'err').pop()
  const alarmAge = alarm === undefined ? Infinity : now - (alarm.endedAt ?? alarm.startedAt)
  const isAlarm = alarmAge < ALARM_MS
  return {
    count: board.counts[id] ?? 0,
    running,
    isLit: running.length > 0 || since < GLOW_MS,
    isAlarm,
    fade: isAlarm ? alarmAge : since,
    span: isAlarm ? ALARM_MS : GLOW_MS,
  }
}

/** What moves on the map at a moment: pulses going out and coming back, beams along the spokes. With `isStill` nothing does. */
export function motionOf(
  board: Board,
  now: number,
  isStill = false,
): { recent: Entry[]; flights: Entry[]; returns: Entry[]; beams: Entry[]; anyRunning: boolean } {
  const recent = board.entries.slice(-40)
  return {
    recent,
    flights: isStill ? [] : recent.filter(e => now - e.startedAt < PULSE_MS + RIPPLE_MS).slice(-14),
    returns: isStill ? [] : recent.filter(e => e.endedAt !== undefined && e.from !== 'inbound' && now - e.endedAt < PULSE_MS + RIPPLE_MS).slice(-14),
    beams: isStill ? [] : recent.filter(e => now - e.startedAt < GLOW_MS / 2).slice(-10),
    anyRunning: recent.some(e => e.status === 'run'),
  }
}

/** The two ends of an entry's spoke: where it starts (the core or the agents station) and its own station. */
export function endsOf(e: Entry): [Point, Point] {
  const p = place(indexOf(e.station))
  const start = e.from === 'agents' ? place(indexOf('agents')) : { x: CX, y: CY }
  return [edge(start, p, e.from === 'agents' ? NODE : HUB), edge(p, start, NODE)]
}

/** Pulses that share a spoke and a moment fly in lanes, five apart. */
export function laneOf(list: readonly Entry[], e: Entry): number {
  const peers = list.filter(x => x.station === e.station && x.from === e.from)
  return (peers.indexOf(e) - (peers.length - 1) / 2) * 5
}

type Scene = {
  /** With `contextCost` on: each station's tokens this session, for the count line. */
  spent: Board['spent'] | undefined
  entries: Entry[]
  board: Board
  now: number
  c: Palette
  names: Strings['stations']
  t: Strings
  warned: ReadonlySet<StationId>
  isStill: boolean
}

/** A figure in a station's tooltip: an icon each surface draws its own way, what it counts, and the number. */
export type TipFigure = {
  icon: 'calls' | 'turn' | 'running' | 'time' | 'errors' | 'session' | 'refused' | 'pushed' | 'tokens'
  label: string
  value: string
  tone?: 'bad' | 'block' | 'run'
}

/** One of a station's most used: a file (edited, or only read) or an MCP server, with how often. */
export type TipItem = { name: string; uses: string; icon: 'edited' | 'read' | 'server'; note?: string }

/**
 * A station's tooltip: its name, what lands there, and its figures (the calls and this turn always, the rest when they have
 * something), then its most used files or servers when it has any.
 */
export type StationTip = { station: StationId; name: string; about: string; figures: TipFigure[]; top?: { title: string; items: TipItem[] } }

export function stationTip(board: Board, id: StationId, t: Strings, running = 0, spent?: Board['spent']): StationTip {
  const count = board.counts[id] ?? 0
  const pushed = id === 'memory' ? Math.min(count, board.pushed ?? 0) : 0
  const share = timeShareOf(board, id)
  const tokens = spent?.[id] ?? 0
  const when = (n: number, figure: TipFigure): TipFigure[] => (n > 0 ? [figure] : [])
  const listed = listedOf(board.satellites?.[id])
  const items = listed.map(
    (sat): TipItem =>
      id === 'files'
        ? { name: sat.name, uses: `×${sat.uses}`, icon: sat.isEdited === true ? 'edited' : 'read', note: sat.isEdited === true ? t.satelliteEdited : t.tip.read }
        : { name: sat.name, uses: `×${sat.uses}`, icon: 'server' },
  )
  return {
    station: id,
    name: t.stations[id],
    about: t.stationAbout[id],
    figures: [
      { icon: 'calls', label: t.tip.calls, value: String(count) },
      { icon: 'turn', label: t.tip.turn, value: String(board.turnCounts?.[id] ?? 0) },
      ...when(running, { icon: 'running', label: t.tip.running, value: String(running), tone: 'run' }),
      ...when(share, { icon: 'time', label: t.tip.time, value: `${share}%` }),
      ...when(pushed, { icon: 'pushed', label: t.tip.pushed, value: String(pushed) }),
      ...when(board.faults?.[id] ?? 0, { icon: 'errors', label: t.tip.errors, value: String(board.faults?.[id] ?? 0), tone: 'bad' }),
      ...when(board.faultTotals?.[id] ?? 0, { icon: 'session', label: t.tip.session, value: String(board.faultTotals?.[id] ?? 0), tone: 'bad' }),
      ...when(board.blocks?.[id] ?? 0, { icon: 'refused', label: t.tip.refused, value: String(board.blocks?.[id] ?? 0), tone: 'block' }),
      ...when(tokens, { icon: 'tokens', label: t.tip.tokens, value: `~${tokensShort(tokens)}` }),
    ],
    ...(items.length > 0 ? { top: { title: t.tip.mostUsed, items } } : {}),
  }
}

/** A station's name sits below the outermost ring it can wear (the warning ring at NODE + 12), never on one. */
const NAME_DROP = NODE + 24

function station(
  s: (typeof STATIONS)[number],
  i: number,
  { entries, board, now, c, names, t, warned, isStill, spent }: Scene,
): { under: string; over: string } {
  const p = place(i)
  const x = n1(p.x)
  const y = n1(p.y)
  const { count, running, isLit, isAlarm, fade, span } = stationState(s.id, entries, board, now)
  const [main, hot] = s.id === 'memory' ? [c.mem, c.memHot] : [c.accent, c.hot]
  const color = isAlarm ? c.red : main

  let under = ''
  // A station that looks stuck wears a dashed ring in the accent colour.
  if (warned.has(s.id)) under += `<circle cx="${x}" cy="${y}" r="${NODE + 12}" fill="none" stroke="${c.accent}" stroke-width="1.4" stroke-dasharray="4 4"/>`
  if (isLit || isAlarm) {
    under +=
      running.length > 0 && !isAlarm
        ? `<circle cx="${x}" cy="${y}" r="${NODE + 10}" fill="${color}" opacity=".16"/>`
        : isStill
          ? `<circle cx="${x}" cy="${y}" r="${NODE + 10}" fill="${color}" opacity=".3"/>`
          : `<circle cx="${x}" cy="${y}" r="${NODE + 10}" fill="${color}" opacity="0">` +
            `<animate attributeName="opacity" values=".3;0" begin="${clock(-fade)}" dur="${clock(span)}" fill="freeze"/></circle>`
  }
  if (running.length > 0) {
    const elapsed = now - Math.min(...running.map(e => e.startedAt))
    const beat = `begin="${clock(-(elapsed % 1400))}" dur="1.4s" repeatCount="indefinite"`
    // Standing still, the beat is left out: the lit ring and the hands at their place say the same.
    if (!isStill) {
      under +=
        `<circle cx="${x}" cy="${y}" r="${NODE}" fill="none" stroke="${color}" stroke-width="1.3">` +
        `<animate attributeName="r" values="${NODE};${NODE + 15}" ${beat}/>` +
        `<animate attributeName="opacity" values=".9;0" ${beat}/></circle>`
    }
    // Two hands of a clock around the node: the inner one goes round in a minute, the outer one in ten.
    const hand = (r: number, width: number, lapMs: number, isOnce: boolean): string => {
      // Standing still, the hands step every five seconds.
      const held = isStill ? elapsed - (elapsed % STILL_STEP_MS) : elapsed
      const done = isOnce ? Math.min(held, lapMs) : held % lapMs
      const ring = `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${hot}" stroke-width="${width}" pathLength="1" stroke-dasharray="1 1" transform="rotate(-90 ${x} ${y})"`
      if (isStill) return `${ring} stroke-dashoffset="${n1(1 - done / lapMs)}"/>`
      return `${ring} stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" values="1;0" begin="${clock(-done)}" dur="${clock(lapMs)}" ${isOnce ? 'fill="freeze"' : 'repeatCount="indefinite"'}/></circle>`
    }
    under += hand(NODE + 4, 2.2, 60_000, false) + hand(NODE + 8, 1.2, 600_000, true)
  }

  // A lit node wears a ring of its color while something runs; afterwards the ring fades back to the resting line.
  const lit = `<circle cx="${x}" cy="${y}" r="${NODE}" fill="none" stroke="${color}" stroke-width="1.2"`
  const cooling =
    running.length > 0
      ? `${lit}/>`
      : isLit || isAlarm
        ? isStill
          ? `${lit}/>`
          : `${lit} opacity="0"><animate attributeName="opacity" values="1;0" begin="${clock(-fade)}" dur="${clock(span)}" fill="freeze"/></circle>`
        : ''
  const glyphColor = isAlarm ? c.red : isLit ? hot : s.id === 'memory' && count > 0 ? main : c.ash
  // The words stand on a rim of the ground's own color, so a line that passes behind them never strikes them through.
  const rim = `paint-order="stroke" stroke="${c.ground}" stroke-width="3.5" stroke-linejoin="round"`
  // With `contextCost`, the name carries what its calls added to the context; every other figure is in the tooltip.
  const tokens = spent?.[s.id] ?? 0
  const added = tokens > 0 ? `<tspan font-size="9.5" fill="${c.dim}"> ~${tokensShort(tokens)}</tspan>` : ''
  let over =
    `<circle cx="${x}" cy="${y}" r="${NODE}" fill="${c.raised}" stroke="${c.line}" stroke-width="1.2"/>${cooling}` +
    `<path transform="translate(${x} ${y})" d="${s.icon}" fill="none" stroke="${glyphColor}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="${x}" y="${n1(p.y + NAME_DROP)}" text-anchor="middle" ${FONT} font-size="11.5" ${rim} fill="${isLit || isAlarm ? c.bone : c.ash}">${names[s.id]}${added}</text>`

  const turn = board.turnCounts?.[s.id] ?? 0
  const share = timeShareOf(board, s.id)
  const total = board.faultTotals?.[s.id] ?? 0

  // Top right: how many run at once. Top left: what went wrong since the last message, until the next one.
  const corner = NODE * 0.74
  if (running.length > 1) {
    over +=
      `<circle cx="${n1(p.x + corner)}" cy="${n1(p.y - corner)}" r="8" fill="${c.raised}" stroke="${color}" stroke-width="1"/>` +
      `<text x="${n1(p.x + corner)}" y="${n1(p.y - corner + 3)}" text-anchor="middle" ${FONT} font-size="8.5" fill="${hot}">×${running.length}</text>`
  }
  const faults = board.faults?.[s.id] ?? 0
  if (faults > 0) {
    over +=
      `<circle cx="${n1(p.x - corner)}" cy="${n1(p.y - corner)}" r="7.5" fill="${c.red}"/>` +
      `<text x="${n1(p.x - corner)}" y="${n1(p.y - corner + 3.1)}" text-anchor="middle" ${FONT} font-size="9" font-weight="700" fill="${c.ground}">${faults > 99 ? '99+' : faults}</text>`
  }
  // Bottom left, in outline: calls refused there, a rule working rather than something broken.
  const blocks = board.blocks?.[s.id] ?? 0
  if (blocks > 0) {
    over +=
      `<circle cx="${n1(p.x - corner)}" cy="${n1(p.y + corner)}" r="7.5" fill="none" stroke="${c.red}" stroke-width="1.3"/>` +
      `<text x="${n1(p.x - corner)}" y="${n1(p.y + corner + 3.1)}" text-anchor="middle" ${FONT} font-size="9" font-weight="700" fill="${c.red}">${blocks > 99 ? '99+' : blocks}</text>`
  }
  // Hovering a station in the app says what its figures are.
  const figures = [
    t.callsHere(board.counts[s.id] ?? 0),
    turn > 0 && turn < count ? t.thisTurn(turn) : '',
    faults > 0 ? t.errorsHere(faults) : '',
    blocks > 0 ? t.refusedHere(blocks) : '',
    share > 0 ? t.timeShare(share) : '',
    total > 0 ? t.errorsInSession(total) : '',
  ]
  const title = `${names[s.id]}: ${figures.filter(f => f !== '').join(' · ')}`
  // The title for a surface that shows only text; the tooltip's parts for one that draws its own.
  const tip = escapeXml(JSON.stringify(stationTip(board, s.id, t, running.length, spent)))
  return { under, over: `<g data-tip="${tip}"><title>${escapeXml(title)}</title>${over}</g>` }
}


/**
 * The map as one picture of `width` by `height` pixels for a terminal's renderer: centred on its ground, in the dark
 * palette when the theme is `auto`, since a terminal does not say its colours and a headless browser reports light.
 */
export function framedMap(board: Board, now: number, setup: Setup, width: number, height: number): string {
  const own: Setup = setup.theme === 'auto' ? { ...setup, theme: 'dark' } : setup
  // Tells the renderer that a call runs, so it keeps the clock hands moving while nothing else changes.
  // With reduced motion it says so instead: the picture is written once and stays.
  const running = setup.motion === 'reduced' ? ' data-motion="reduced"' : motionOf(board, now).anyRunning ? ' data-running="1"' : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}"${running} style="display:block">` +
    `<rect width="100%" height="100%" fill="${paletteOf(own).ground}"/>${drawMap(board, now, own, true)}</svg>`
  )
}

// ---- the crew at the agents station -----------------------------------------------------------

/** A subagent still at work, or a Workflow's agents as one: its label and when it began. */
type Crew = { label?: string; since?: number; isFaulty: boolean; isRun: boolean }

const CREW_LABELS = 6
const CREW_ROW = 9

/** The crew in `board.agents` order: each subagent, a Workflow's agents as one with `done/started`. */
function crewOf(board: Board): Crew[] {
  const live = board.agents ?? []
  const info = board.agentInfo ?? {}
  const faulty = board.agentFaults ?? []
  const first = (id: string): number | undefined => {
    const own = board.entries.filter(e => e.agentId === id).map(e => e.startedAt)
    return own.length > 0 ? Math.min(...own) : info[id]?.at
  }
  const seen = new Set<string>()
  const crew: Crew[] = []
  for (const id of live) {
    const run = info[id]?.run
    if (run === undefined) {
      const name = Array.from(board.agentNames?.[id] ?? '').slice(0, 10).join('')
      const since = first(id)
      crew.push({ ...(name === '' ? {} : { label: name }), ...(since === undefined ? {} : { since }), isFaulty: faulty.includes(id), isRun: false })
    } else if (!seen.has(run)) {
      seen.add(run)
      const all = Object.keys(info).filter(x => info[x]?.run === run)
      const starts = all.map(first).filter((x): x is number => x !== undefined)
      crew.push({
        label: `${all.filter(x => !live.includes(x)).length}/${all.length}`,
        ...(starts.length > 0 ? { since: Math.min(...starts) } : {}),
        isFaulty: all.some(x => faulty.includes(x)),
        isRun: true,
      })
    }
  }
  return crew
}

/** Whether a stack of `rows` labels with its top edge at `top` beside `at` stands clear of the canvas edge and of every other station's name and count. */
function isClear(at: Point, top: number, rows: number): boolean {
  const bottom = top + CREW_ROW * (rows - 1) + 9
  return (
    top >= 2 &&
    bottom <= H - 2 &&
    STATIONS.every((s, i) => {
      const p = place(i)
      return s.id === 'agents' || at.x - 30 >= p.x + 33 || at.x + 26 <= p.x - 33 || bottom <= p.y - 30 || top >= p.y + 54
    })
  )
}

/** The crew's label rows: those shown, and the top edge of their stack, under the station's count or above it when that room is taken. */
function crewRows(crew: readonly Crew[], at: Point): { shown: Crew[]; top: number } {
  const shown = crew.filter(m => m.label !== undefined).slice(0, CREW_LABELS)
  const height = CREW_ROW * (shown.length - 1) + 9
  const below = at.y + NODE + 36
  const above = at.y - NODE - 16 - height
  return { shown, top: isClear(at, below, shown.length) || !isClear(at, above, shown.length) ? below : above }
}

/** The label rows of the first six: a dot, its clock arc (a lap a minute) and its name, under the station's count, or above it when that room is taken. */
function crewLabels(crew: readonly Crew[], at: Point, c: Palette, now: number, isStill: boolean): string {
  const { shown, top } = crewRows(crew, at)
  if (shown.length === 0) return ''
  let out = ''
  shown.forEach((m, k) => {
    const y = top + 7 + k * CREW_ROW
    const cx = at.x - 24
    const cy = y - 2.5
    const ring = `cx="${n1(cx)}" cy="${n1(cy)}" r="3.4" fill="none" stroke-width="1" pathLength="1"`
    out += `<circle ${ring} stroke="${c.line}"/><circle cx="${n1(cx)}" cy="${n1(cy)}" r="1.6" fill="${m.isFaulty ? c.red : c.hot}"/>`
    if (m.since !== undefined) {
      const elapsed = Math.max(0, now - m.since)
      const held = isStill ? elapsed - (elapsed % STILL_STEP_MS) : elapsed
      const done = held % 60_000
      const arc = `<circle ${ring} stroke="${m.isFaulty ? c.red : c.hot}" stroke-dasharray="1 1" transform="rotate(-90 ${n1(cx)} ${n1(cy)})"`
      out += isStill
        ? `${arc} stroke-dashoffset="${n1(1 - done / 60_000)}"/>`
        : `${arc} stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" values="1;0" begin="${clock(-done)}" dur="${clock(60_000)}" repeatCount="indefinite"/></circle>`
    }
    out += `<text x="${n1(at.x - 17)}" y="${n1(y)}" text-anchor="start" ${FONT} font-size="7" paint-order="stroke" stroke="${c.ground}" stroke-width="3" stroke-linejoin="round" fill="${c.ash}">${escapeXml(m.label as string)}</text>`
  })
  return out
}

/** Every subagent the window can pick: those named, then those still at work, each with its id. */
export function agentList(board: Board): { id: string; name: string }[] {
  const ids = [...new Set([...Object.keys(board.agentNames ?? {}), ...(board.agents ?? [])])]
  return ids.map(id => ({ id, name: board.agentNames?.[id] ?? id }))
}


export function drawMap(board: Board, now: number, setup: Setup, isFilling = false): string {
  const c = paletteOf(setup)
  orient(setup)
  const core: Point = { x: CX, y: CY }
  const isStill = setup.motion === 'reduced'
  const { recent, flights, returns, beams, anyRunning } = motionOf(board, now, isStill)
  const agentsAt = place(indexOf('agents'))
  const isBad = (e: Entry): boolean => e.status === 'block' || e.status === 'err'
  const tone = (e: Entry): [string, string] => (e.station === 'memory' ? [c.mem, c.memHot] : [c.accent, c.hot])

  // Without its ground the map keeps the rim around its words, in the ground's color: a faint halo on a surface of another shade.
  let body = setup.background === 'transparent' ? '' : `<rect width="${W}" height="${H}" rx="12" fill="${c.ground}"/>`

  // Contours around the core.
  for (const [rx, ry] of [[66, 62], [104, 97], [142, 132]]) {
    body += `<ellipse cx="${CX}" cy="${CY}" rx="${rx}" ry="${ry}" fill="none" stroke="${c.line}" stroke-width=".7" opacity=".45" stroke-dasharray="2 5"/>`
  }

  // Spokes first, then whatever flies along them, then the nodes on top.
  // A spoke wears in with use: by the end of a session the map shows where the work went.
  STATIONS.forEach((s, i) => {
    const p = place(i)
    const a = edge(core, p, HUB)
    const b = edge(p, core, NODE)
    const worn = wearOf(board, s.id, setup)
    const line = `<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke-width="${n1(1 + 2.6 * worn)}" stroke-linecap="round"`
    body += `${line} stroke="${c.spoke}"/>`
    if (worn > 0) body += `${line} stroke="${s.id === 'memory' ? c.mem : c.accent}" opacity="${n1(worn * 0.55)}"/>`
  })

  const scene: Scene = {
    spent: setup.contextCost ? board.spent : undefined,
    entries: recent,
    board,
    now,
    c,
    names: setup.t.stations,
    t: setup.t,
    warned: new Set(warningsOf(board, now, setup.t).flatMap(w => (w.station === undefined ? [] : [w.station]))),
    isStill,
  }
  const drawn = STATIONS.map((s, i) => station(s, i, scene))
  body += drawn.map(d => d.under).join('')
  body += trail(recent, now, c, isStill)

  for (const e of beams) {
    const [a, b] = endsOf(e)
    body += beam(a, b, isBad(e) ? c.red : tone(e)[0], now - e.startedAt, e.from === 'inbound')
  }
  for (const e of flights) {
    const [a, b] = aside(...endsOf(e), laneOf(flights, e))
    const age = now - e.startedAt
    const color = e.status === 'block' ? c.red : tone(e)[1]
    if (e.from === 'inbound') {
      body += pulse(b, a, color, age, 3.8, true) + ripple(core, HUB - 2, color, age)
    } else {
      body += pulse(a, b, color, age, setup.contextCost ? pulseRadius(e.tokens, 3.8) : 3.8) + ripple(place(indexOf(e.station)), NODE, color, age)
    }
  }
  for (const e of returns) {
    const [a, b] = aside(...endsOf(e), laneOf(returns, e))
    body += pulse(b, a, e.status === 'ok' ? c.ash : c.red, now - (e.endedAt as number), setup.contextCost ? pulseRadius(e.tokens, 2.6) : 2.6)
  }

  body += drawn.map(d => d.over).join('')

  // Each subagent still at work circles the agents station; a Workflow's agents are one dot between them.
  const crew = crewOf(board)
  crew.forEach((member, k) => {
    const lap = 7000
    const spin = `${n1(agentsAt.x)} ${n1(agentsAt.y)}`
    // A subagent a call of which failed or was refused circles in red.
    const dot = member.isFaulty ? c.red : c.hot
    const mark = `<circle cx="${n1(agentsAt.x)}" cy="${n1(agentsAt.y - NODE - 6)}" r="${member.isRun ? 4 : 3}" fill="${dot}"/>`
    // Standing still, each keeps its own place on the circle.
    body += isStill
      ? `<g transform="rotate(${n1((360 * k) / crew.length)} ${spin})">${mark}</g>`
      : `<g><animateTransform attributeName="transform" type="rotate" from="0 ${spin}" to="360 ${spin}" begin="${clock(-((now + (k * lap) / crew.length) % lap))}" dur="${clock(lap)}" repeatCount="indefinite"/>${mark}</g>`
  })
  body += crewLabels(crew, agentsAt, c, now, isStill)

  // A name longer than three letters shrinks to stay inside the circle.
  const coreSize = Math.min(17, 62 / (0.75 * setup.core.length))

  // The core breathes at rest and quickens while something runs.
  const period = anyRunning ? 1600 : 4800
  const breath = `begin="${clock(-(now % period))}" dur="${clock(period)}" repeatCount="indefinite"`
  body +=
    (isStill
      ? `<circle cx="${CX}" cy="${CY}" r="${CORE + 8}" fill="${c.accent}" opacity="${anyRunning ? '.16' : '.08'}"/>`
      : `<circle cx="${CX}" cy="${CY}" r="${CORE + 6}" fill="${c.accent}" opacity=".08">` +
        `<animate attributeName="r" values="${CORE + 3};${CORE + 13};${CORE + 3}" ${breath}/>` +
        `<animate attributeName="opacity" values=".05;${anyRunning ? '.24' : '.12'};.05" ${breath}/></circle>`) +
    `<circle cx="${CX}" cy="${CY}" r="${CORE}" fill="${c.raised}" stroke="${anyRunning ? c.accent : c.line}" stroke-width="1.3"/>`

  // The context window as a ring around the core: it fills as the session goes and empties at a compaction.
  if (board.context !== undefined) {
    const full = Math.max(0, Math.min(100, Math.round(board.context)))
    const ring = `cx="${CX}" cy="${CY}" r="${CORE + 5}" fill="none" stroke-width="2.2"`
    body +=
      `<circle ${ring} stroke="${c.line}" opacity=".7"/>` +
      `<circle ${ring} stroke="${full >= 90 ? c.red : full >= 70 ? c.accent : c.ash}" pathLength="100" stroke-dasharray="${full} 100" transform="rotate(-90 ${CX} ${CY})"/>` +
      `<text x="${CX}" y="${CY - 19}" text-anchor="middle" ${FONT} font-size="8" fill="${c.dim}">${full}%</text>`
  }

  // The rate-limit windows as thin arcs outside it, on the context ring's colours.
  for (const { kind, percent, resetsAt } of board.limits ?? []) {
    const used = Math.max(0, Math.min(100, Math.round(percent)))
    const arc = `cx="${CX}" cy="${CY}" r="${CORE + (kind === 'five_hour' ? 9 : 12)}" fill="none" stroke-width="1.2"`
    body +=
      `<circle ${arc} stroke="${c.line}" opacity=".5"/>` +
      `<circle ${arc} stroke="${used >= 90 ? c.red : used >= 70 ? c.accent : c.ash}" pathLength="100" stroke-dasharray="${used} 100" transform="rotate(-90 ${CX} ${CY})">` +
      `<title>${escapeXml(setup.t.limitTitle(kind, used, untilText(resetsAt, now, setup.t)))}</title></circle>`
  }

  const switchAge = board.switchedAt === undefined ? Infinity : now - board.switchedAt
  const isSwitching = switchAge >= 0 && switchAge < SWITCH_MS
  body += `<text x="${CX}" y="${CY + (board.model === undefined ? 6 : 1)}" text-anchor="middle" ${FONT} font-size="${n1(coreSize)}" letter-spacing="${n1(coreSize * 0.147)}" fill="${c.bone}">${escapeXml(setup.core)}</text>`
  if (board.model !== undefined) {
    body += `<text x="${CX}" y="${CY + 17}" text-anchor="middle" ${FONT} font-size="9" fill="${isSwitching ? c.hot : c.ash}">${escapeXml(shortModel(board.model))}</text>`
  }

  // Under the core, one word for what the session is doing.
  const state = stateOf(board)
  const stateColor = { idle: c.dim, thinking: c.bone, running: c.hot, waiting: c.accent, compacting: c.mem, done: c.ash }[state]
  const blink =
    state === 'waiting' && !isStill
      ? `<animate attributeName="opacity" values="1;.45;1" begin="${clock(-(now % 1200))}" dur="1.2s" repeatCount="indefinite"/>`
      : ''
  // A wait on you wears a dashed ring inside the core's edge, a sign that does not depend on the blink.
  if (state === 'waiting') body += `<circle cx="${CX}" cy="${CY}" r="${CORE - 4}" fill="none" stroke="${c.accent}" stroke-width="1.4" stroke-dasharray="3 3"/>`
  body += `<text x="${CX}" y="${CY + CORE + 25}" text-anchor="middle" ${FONT} font-size="9" paint-order="stroke" stroke="${c.ground}" stroke-width="3.5" stroke-linejoin="round" fill="${stateColor}">${blink}${escapeXml(setup.t.states[state])}</text>`
  const spent = costText(board.cost)
  // The cost is an estimate, and its title says so.
  if (spent !== undefined) {
    body += `<text x="${CX}" y="${CY + CORE + 36}" text-anchor="middle" ${FONT} font-size="8" fill="${c.dim}"><title>${escapeXml(setup.t.estimatedCost(spent))}</title>${spent}</text>`
  }

  // A changed model rings at the core and at its station for a few seconds.
  if (isSwitching && !isStill) {
    const model = place(indexOf('model'))
    const laps = Math.ceil((SWITCH_MS - switchAge) / 1600)
    for (const [p, r] of [[core, CORE], [model, NODE]] as const) {
      const ringing = `begin="${clock(-(switchAge % 1600))}" dur="1.6s" repeatCount="${laps}" fill="freeze"`
      body +=
        `<circle cx="${n1(p.x)}" cy="${n1(p.y)}" r="${r}" fill="none" stroke="${c.bone}" stroke-width="1.4" opacity="0">` +
        `<animate attributeName="r" values="${r};${r + 26}" ${ringing}/>` +
        `<animate attributeName="opacity" values=".7;0" ${ringing}/></circle>`
    }
  }

  // The answer leaves the core as one wide ring.
  const done = recent.filter(e => e.mark === 'done').pop()
  if (done !== undefined && now - done.startedAt < DONE_MS && !isStill) {
    const leaving = `begin="${clock(done.startedAt - now)}" dur="${clock(DONE_MS)}" fill="freeze"`
    body +=
      `<circle cx="${CX}" cy="${CY}" r="${CORE}" fill="none" stroke="${c.bone}" stroke-width="1.6" opacity="0">` +
      `<animate attributeName="r" values="${CORE};${CORE + 38}" ${leaving}/>` +
      `<animate attributeName="opacity" values=".6;0" ${leaving}/></circle>`
  }

  // Twice the viewBox, so the picture fills whatever room the pane gives it; or the whole box it is framed in.
  const size = isFilling ? 'width="100%" height="100%"' : `width="${W * 2}" height="${H * 2}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${size}>${setup.theme === 'auto' ? lightRules(setup.colors) : ''}${body}</svg>`
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string)
}

// ---- the feed ---------------------------------------------------------------------------------

/** A row of the feed: one entry, or several finished ones in a row at one station, shown as the newest of them. */
export type Row = {
  entry: Entry
  times: number
  tookMs: number
  /** With `contextCost`: the tokens the row's calls added to the context, where any of them has a figure. */
  tokens?: number
  /** The figure is not all of it: one call's share of a step, or a folded row some of whose calls have none. */
  isShared?: boolean
}

/** A row of one entry, with its share of the context if it has one. */
const rowOf = (e: Entry, tookMs: number): Row => ({
  entry: e,
  times: 1,
  tookMs,
  ...(e.tokens === undefined ? {} : { tokens: e.tokens, ...(e.shared ? { isShared: true } : {}) }),
})

/** One more call folded into a row: its time and its tokens; the figure is partial when only one side has any. */
function fold(row: Row, e: Entry, took: number): void {
  row.times++
  row.tookMs += took
  if (e.tokens === undefined && row.tokens === undefined) return
  if (e.tokens === undefined || row.tokens === undefined || e.shared) row.isShared = true
  row.tokens = (row.tokens ?? 0) + (e.tokens ?? 0)
}

const isPlain = (e: Entry): boolean => e.status === 'ok' && e.mark === undefined

/**
 * The newest rows first. Finished calls that follow one another at one station fold into a single row.
 * A call still running is never pushed out by what came after it: past the last row it stays, as the last rows,
 * in place of the oldest finished ones. Such rows take half the list at most; with more still running than that,
 * the last stands for the rest, as a folded row does.
 */
export function foldRows(entries: readonly Entry[], max = 16): Row[] {
  const rows: Row[] = []
  const running: Row[] = []
  // Set once a row was left out: from there on nothing is a neighbour of the last row.
  let isCut = false
  const held = Math.max(1, Math.floor(max / 2))
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e === undefined) continue
    const took = e.endedAt === undefined ? 0 : Math.max(0, e.endedAt - e.startedAt)
    const last = rows[rows.length - 1]
    if (!isCut && last !== undefined && isPlain(e) && isPlain(last.entry) && last.entry.station === e.station && last.entry.from === e.from) {
      fold(last, e, took)
      continue
    }
    if (rows.length >= max) {
      // Past the list's end only what still runs counts.
      isCut = true
      if (e.status !== 'run') continue
      const oldest = running[running.length - 1]
      if (running.length < held || oldest === undefined) running.push(rowOf(e, took))
      else oldest.times++
      continue
    }
    rows.push(rowOf(e, took))
  }
  return running.length === 0 ? rows : [...rows.slice(0, max - running.length), ...running]
}

/**
 * Keeps the newest `max` of what a set or a map holds and drops the rest: both hand their keys back in the order
 * they were added. For what the mod remembers between two events and may never be asked for again.
 */
export function keepNewest(kept: { readonly size: number; keys(): IterableIterator<string>; delete(key: string): boolean }, max: number): void {
  for (const key of kept.keys()) {
    if (kept.size <= max) break
    kept.delete(key)
  }
}

/** The width of the rows' station column: the longest station name of the language, eight at least. */
const columnOf = (t: Strings): number => Math.max(8, ...Object.values(t.stations).map(name => name.length))

/** A call that started work in the background, and that work goes on. */
const isPinned = (e: Entry): boolean => e.status === 'run' && e.task !== undefined

/** A time that counts on its own, to the second: a wait on the person, work in the background. */
export function formatClock(ms: number, t: Strings): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? t.seconds(String(s)) : t.minutes(Math.floor(s / 60), s % 60)
}

/** A reset's time from now as words, or nothing when it is not given, unreadable or past. */
export function untilText(resetsAt: string | undefined, now: number, t: Strings): string | undefined {
  const ms = resetsAt === undefined ? NaN : Date.parse(resetsAt) - now
  if (!(ms > 0)) return undefined
  const minutes = Math.floor(ms / 60_000)
  return minutes >= 60 ? t.hoursMinutes(Math.floor(minutes / 60), minutes % 60) : minutes >= 1 ? t.wholeMinutes(minutes) : formatClock(ms, t)
}

/** The session's cost as `$1.23`; nothing under a cent, where a fresh session's `$0.00` is noise. */
export function costText(cost: number | undefined): string | undefined {
  return cost !== undefined && cost >= 0.01 ? `$${cost.toFixed(2)}` : undefined
}

/** Work sent to the background and still going, pinned above the rows: the newest five, each with its time so far. */
export function pinnedLines(entries: readonly Entry[], now: number, t: Strings): FeedLine[] {
  const column = columnOf(t)
  const going = entries.filter(isPinned).reverse()
  const lines: FeedLine[] = going
    .slice(0, 5)
    .map(e => ({ line: `↻ ${t.stations[e.station].padEnd(column)} ${e.label}  ${formatClock(now - e.startedAt, t)}`, tone: 'run' as const }))
  // The rest still go on: they are counted, since the rows leave them out.
  if (going.length > 5) lines.push({ line: t.andMore(going.length - 5).trim(), tone: 'ok' })
  return lines
}

/** The tools with which Claude keeps its own plan: their calls are no work done on a task. */
export const PLAN_TOOLS: ReadonlySet<string> = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'])

/** A task's subject as Claude wrote it, cleaned and cut to sixty characters, a character never split. */
function subjectOf(value: unknown): string {
  const characters = Array.from(clean(String(value ?? ''), 4000))
  return characters.length > 60 ? `${characters.slice(0, 59).join('')}…` : characters.join('')
}

const planStatusOf = (value: unknown): PlanItem['status'] | undefined =>
  value === 'pending' || value === 'in_progress' || value === 'completed' ? value : undefined

/**
 * Claude's plan after one of its task tools answered: a task created, one changed or deleted, or the whole list written
 * anew. Undefined for any other tool, and for an answer that changes nothing, such as an update to a task never seen.
 */
export function planAfter(
  plan: readonly PlanItem[] = [],
  tool: string,
  input: Record<string, unknown>,
  result: unknown,
  text: string,
  now: number,
): PlanItem[] | undefined {
  if (tool === 'TaskCreate') {
    const task = typeof result === 'object' && result !== null ? (result as { task?: { id?: unknown } }).task : undefined
    const id = typeof task?.id === 'string' ? task.id : /Task #(\w+)/.exec(text)?.[1]
    const subject = subjectOf(input.subject)
    if (id === undefined || subject === '' || plan.some(p => p.id === id)) return undefined
    return [...plan, { id, subject, status: 'pending', calls: 0 }]
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    if (!plan.some(p => p.id === id)) return undefined
    if (input.status === 'deleted') return plan.filter(p => p.id !== id)
    const status = planStatusOf(input.status)
    const subject = input.subject === undefined ? '' : subjectOf(input.subject)
    return plan.map(p =>
      p.id !== id
        ? p
        : {
            ...p,
            ...(subject !== '' ? { subject } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(status === 'in_progress' && p.startedAt === undefined ? { startedAt: now } : {}),
            ...(status === 'completed' ? { endedAt: now } : {}),
          },
    )
  }
  if (tool === 'TodoWrite') {
    // The whole list, written anew: a task kept under the same subject keeps the work counted against it, and its times.
    const todos = Array.isArray(input.todos) ? (input.todos as { content?: unknown; status?: unknown }[]) : []
    return todos.flatMap((todo, i) => {
      const subject = subjectOf(todo.content)
      if (subject === '') return []
      const kept = plan.find(p => p.subject === subject)
      const status = planStatusOf(todo.status) ?? 'pending'
      const startedAt = kept?.startedAt ?? (status === 'in_progress' ? now : undefined)
      const endedAt = status !== 'completed' ? undefined : kept?.status === 'completed' ? kept.endedAt : now
      const times = { ...(startedAt !== undefined ? { startedAt } : {}), ...(endedAt !== undefined ? { endedAt } : {}) }
      return [{ id: `t${i}`, subject, status, calls: kept?.calls ?? 0, ...times }]
    })
  }
  return undefined
}

/** Claude's plan over the rows: how far along, the last two tasks finished, the ones in progress, the next two. */
export function planLines(plan: readonly PlanItem[] = [], t: Strings): FeedLine[] {
  if (plan.length === 0) return []
  const done = plan.filter(p => p.status === 'completed')
  const filled = Math.round((done.length / plan.length) * 10)
  const lines: FeedLine[] = [{ line: `${t.planHeader(done.length, plan.length)} ${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`, tone: 'plain' }]
  for (const p of done.slice(-2)) {
    const took = p.startedAt !== undefined && p.endedAt !== undefined ? formatMs(p.endedAt - p.startedAt, t) : ''
    const details = [p.calls > 0 ? t.planCalls(p.calls) : '', took].filter(d => d !== '')
    lines.push({ line: [`✓ ${p.subject}`, ...details].join(' · '), tone: 'ok' })
  }
  for (const p of plan.filter(p => p.status === 'in_progress')) lines.push({ line: `◐ ${p.subject}`, tone: 'run', isBold: true })
  const pending = plan.filter(p => p.status === 'pending')
  for (const p of pending.slice(0, 2)) lines.push({ line: `○ ${p.subject}`, tone: 'plain' })
  const hidden = Math.max(0, done.length - 2) + Math.max(0, pending.length - 2)
  if (hidden > 0) lines.push({ line: t.andMore(hidden).trim(), tone: 'ok' })
  return lines
}

/** The most characters the changed line shows. */
const CHANGED_MAX = 100

/** The changed files as `name ×N` (no ×1), most edits first; of equal counts, the one changed last. */
export function changedItems(changed: Readonly<Record<string, number>> = {}): string[] {
  return Object.keys(changed)
    .reverse()
    .sort((a, b) => (changed[b] ?? 0) - (changed[a] ?? 0))
    .map(name => ((changed[name] ?? 0) > 1 ? `${name} ×${changed[name]}` : name))
}

/** The files written or edited this session, most edits first, cut between names to 100 characters; the rest counted. */
export function changedLine(changed: Readonly<Record<string, number>> | undefined, t: Strings): FeedLine | undefined {
  const items = changedItems(changed)
  if (items.length === 0) return undefined
  const head = `✎ ${t.changedFiles(items.length)}: `
  const more = (rest: number) => (rest > 0 ? t.andMore(rest) : '')
  const width = (text: string) => Array.from(text).length
  let shown = 0
  while (shown < items.length && width(head + items.slice(0, shown + 1).join(', ') + more(items.length - shown - 1)) <= CHANGED_MAX) shown++
  if (shown > 0) return { line: head + items.slice(0, shown).join(', ') + more(items.length - shown), tone: 'plain' }
  // Even the first name alone is too long: it is cut, not the line widened.
  const room = Math.max(1, CHANGED_MAX - width(head) - width(more(items.length - 1)) - 1)
  return { line: `${head}${Array.from(items[0] ?? '').slice(0, room).join('')}…${more(items.length - 1)}`, tone: 'plain' }
}

/** The sum of a per-station tally. */
const sumOf = (tally: Readonly<Partial<Record<StationId, number>>> | undefined): number => Object.values(tally ?? {}).reduce((a, b) => a + b, 0)

/**
 * `/workmap recap`: the session in up to five lines: turns and wall time, calls by station (most first, each with its
 * share of the time when `shares` has it), the files changed, the errors and refusals, the cost and the peak context.
 * A line with nothing to say is left out. Station names and file names only.
 */
export function recapLines(
  board: Board,
  startedAt: number | undefined,
  now: number,
  t: Strings,
  shares?: Readonly<Partial<Record<StationId, number>>>,
): string[] {
  const lines: string[] = []
  const turns = board.turns?.at(-1)?.n ?? 0
  const time = startedAt === undefined || now - startedAt < 1000 ? undefined : formatClock(now - startedAt, t)
  if (turns > 0) lines.push(t.recapTurns(turns, time))
  const order = Object.keys(t.stations) as StationId[]
  const calls = order
    .filter(id => (board.counts[id] ?? 0) > 0)
    .sort((a, b) => (board.counts[b] ?? 0) - (board.counts[a] ?? 0))
    .map(id => {
      const share = shares?.[id]
      return `${t.stations[id]} ${board.counts[id]}${share === undefined ? '' : ` (${Math.round(share * 100)}%)`}`
    })
  if (calls.length > 0) lines.push(t.recapCalls(calls.join(', ')))
  const files = changedItems(board.changed)
  if (files.length > 0) lines.push(t.recapFiles(files.length, files.slice(0, 3).join(', ')))
  const errors = sumOf(board.faultTotals)
  const refused = sumOf(board.blockTotals)
  if (errors + refused > 0) lines.push(t.recapErrors(errors, refused))
  const cost = costText(board.cost)
  if (cost !== undefined || board.peakContext !== undefined) lines.push(t.recapCost(cost, board.peakContext))
  return lines
}

/** A row of the feed as written: at work, finished, gone wrong, refused, a change of model, or plain words. */
export type FeedLine = { line: string; agentId?: string; tone: 'run' | 'ok' | 'bad' | 'block' | 'switch' | 'plain'; isBold?: true }

/** The most lines the rows take, headers included. */
const FEED_MAX = 16

/** How many earlier turns keep a header. */
const EARLIER = 4

/**
 * The feed's rows as the pane and the map window write them, the station names in a column as wide as the longest.
 * With turns: the open turn's header, its rows, then the headers of up to four earlier turns, in 16 lines in all.
 */
export function feedLines(
  entries: readonly Entry[],
  t: Strings,
  agentNames: Readonly<Record<string, string>> = {},
  turns: readonly TurnSummary[] = [],
  withCost = false,
): FeedLine[] {
  const open = turns[turns.length - 1]
  // Work still going in the background is pinned above the rows, not listed among them.
  const shown = entries.filter(e => !isPinned(e))
  if (open === undefined) return rowLines(foldRows(shown), t, agentNames, withCost)
  const from = Math.max(0, turns.length - 1 - EARLIER)
  // An entry with no turn goes with the open one.
  const mine = shown.filter(e => e.turn === undefined || e.turn === open.n)
  const newest = mine.reduce((m, e) => Math.max(m, e.endedAt ?? e.startedAt), open.startedAt)
  const header = {
    line: t.turnHeader(open.n, formatMs((open.endedAt ?? newest) - open.startedAt, t), open.calls, open.errors),
    tone: 'plain' as const,
    isBold: true as const,
  }
  const heads = turns
    .slice(from, -1)
    .map((x, i): FeedLine => {
      // A turn never closed ran until the next began.
      const end = x.endedAt ?? turns[from + i + 1]?.startedAt ?? x.startedAt
      return { line: t.turnHeader(x.n, formatMs(end - x.startedAt, t), x.calls, x.errors), tone: 'ok' }
    })
    .reverse()
  return [header, ...rowLines(foldRows(mine, FEED_MAX - 1 - heads.length), t, agentNames, withCost), ...heads]
}

/** A line of the log, with the station of its call so that the window can filter; the closing line has none. */
export type LogLine = FeedLine & { station?: StationId }

/**
 * Every call the board keeps, newest first and unfolded, in the rows' own format. When `calls`, the running total of
 * counted calls from `counts`, is more than the board holds, a last line says older calls are gone.
 */
export function logLines(entries: readonly Entry[], t: Strings, agentNames: Readonly<Record<string, string>> = {}, calls = 0, withCost = false): LogLine[] {
  const newest = entries.slice().reverse()
  const rows = newest.map(entry => rowOf(entry, entry.endedAt === undefined ? 0 : Math.max(0, entry.endedAt - entry.startedAt)))
  const lines: LogLine[] = rowLines(rows, t, agentNames, withCost).map((l, i) => ({ ...l, station: newest[i]?.station }))
  // A switch of model is no counted call.
  const kept = entries.filter(e => e.mark !== 'switch').length
  return calls > kept ? [...lines, { line: t.logGone(kept, calls), tone: 'plain' }] : lines
}

function rowLines(rows: readonly Row[], t: Strings, agentNames: Readonly<Record<string, string>>, withCost: boolean): FeedLine[] {
  const column = columnOf(t)
  return rows.map(({ entry, times, tookMs, tokens, isShared }) => {
    const isSwitch = entry.mark === 'switch'
    const mark = isSwitch ? '◆' : entry.status === 'run' ? '●' : entry.status === 'ok' ? '·' : entry.status === 'block' ? '⊘' : '✕'
    // With `contextCost`, what the call added to the context follows its time: `85 ms +42k`, `~+14k` when shared.
    const cost = withCost && tokens !== undefined ? `${isShared ? '~' : ''}+${tokensShort(tokens)}` : ''
    const took = [entry.endedAt === undefined ? t.running : tookMs > 0 ? formatMs(tookMs, t) : '', cost].filter(x => x !== '').join(' ')
    const exit = entry.exit === undefined ? '' : `  ${t.exitCode(entry.exit)}`
    // A subagent's call carries its name, when it is known.
    const agent = entry.agentId === undefined ? undefined : agentNames[entry.agentId]
    const label = agent === undefined ? entry.label : `↳ ${agent} · ${entry.label}`
    const line = `${mark} ${t.stations[entry.station].padEnd(column)} ${label}${times > 1 ? `  +${times - 1}` : ''}${exit}${entry.reason === undefined ? '' : ` — ${entry.reason}`}${took === '' ? '' : `  ${took}`}`
    const tone = isSwitch ? 'switch' : entry.status === 'run' ? 'run' : entry.status === 'ok' ? 'ok' : entry.status === 'block' ? 'block' : 'bad'
    return { line, ...(entry.agentId === undefined ? {} : { agentId: entry.agentId }), tone }
  })
}

/**
 * The id of the background task a tool's answer started, if it started one: a shell command sent to the
 * background, a subagent or workflow launched to run on, a monitor.
 */
export function taskOf(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const r = result as Record<string, unknown>
  const id = (v: unknown): string | undefined => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : undefined)
  if (r.status === 'async_launched' || r.status === 'remote_launched') return id(r.agentId) ?? id(r.taskId)
  return id(r.backgroundTaskId) ?? (typeof r.timeoutMs === 'number' ? id(r.taskId) : undefined)
}

/**
 * A background task's notification, read for the task's id and how it ended and for nothing else:
 * its summary and output never reach the map. No status: the task spoke and goes on (a monitor's event).
 */
export function taskNotice(text: string): { id: string; status?: Status } | undefined {
  if (!text.trimStart().startsWith('<task-notification>')) return undefined
  const id = /<task-id>([\w-]{1,64})<\/task-id>/.exec(text)?.[1]
  if (id === undefined) return undefined
  const word = /<status>(\w+)<\/status>/.exec(text)?.[1]
  if (word === undefined) return { id }
  return { id, status: word === 'failed' ? 'err' : 'ok' }
}

/** What the session is doing, as the word under the core says it. */
export type SessionState = keyof Strings['states']

/**
 * The session's state: a wait on the person first, then a compaction, then a call at work, then where the turn stands.
 * Background work is not the turn's.
 */
export function stateOf(board: Board): SessionState {
  if (board.entries.some(e => e.status === 'run' && e.waits === true)) return 'waiting'
  if (board.phase === 'compacting') return 'compacting'
  // A foreground subagent keeps the main loop's own Agent call open; a background one's calls are not the turn's.
  const isTurnWork = (e: Entry): boolean =>
    e.status === 'run' && e.task === undefined && e.agentId === undefined && e.station !== 'model' && e.station !== 'you'
  if (board.entries.some(isTurnWork)) return 'running'
  return board.phase ?? 'idle'
}

/** A sign that the session looks stuck, and the station it sits at, when it has one. */
type Warning = { station?: StationId; line: string }

const LOOP_MIN = 3
const LONG_MS = 60_000
const LONG_TIMES = 5
const QUIET_MS = 180_000

/** Work meant to run long, or to wait on the person, is never stuck. */
const isPatient = (e: Entry): boolean => e.task !== undefined || e.waits === true || e.asks === true

/**
 * What looks stuck, at most three: a command failing again and again in one loop, a call running far past its station's
 * usual time, a running turn with nothing new for three minutes.
 */
export function warningsOf(board: Board, now: number, t: Strings): Warning[] {
  const out: Warning[] = []
  const own = board.entries.filter(e => e.station !== 'model' && e.station !== 'you')

  // A loop: the main loop's and each subagent's finished calls, newest first, the same failure from the newest back.
  const loops = new Map<string | undefined, Entry[]>()
  for (const e of own) if (e.status !== 'run') loops.set(e.agentId, [e, ...(loops.get(e.agentId) ?? [])])
  const state = stateOf(board)
  const isGoing = (id: string | undefined): boolean =>
    id === undefined ? ['thinking', 'running', 'waiting'].includes(state) : (board.agents ?? []).includes(id)
  for (const [id, list] of loops) {
    if (!isGoing(id)) continue
    const [last] = list
    if (last === undefined || last.status !== 'err') continue
    const n = list.findIndex(e => e.status !== 'err' || e.station !== last.station || e.label !== last.label)
    const streak = n === -1 ? list.length : n
    if (streak >= LOOP_MIN) out.push({ station: last.station, line: t.failedInARow(t.stations[last.station], last.label, streak) })
  }

  // A call far past its station's median, each timed from when it was allowed to run.
  for (const e of own) {
    // A foreground subagent is work meant to run long.
    if (e.status !== 'run' || isPatient(e) || e.station === 'agents') continue
    const took = own
      .filter(x => x.station === e.station && x.endedAt !== undefined && (x.status === 'ok' || x.status === 'err') && x.task === undefined)
      .map(x => (x.endedAt ?? x.startedAt) - (x.ranAt ?? x.startedAt))
      .sort((a, b) => a - b)
    if (took.length < 3) continue
    const median = took[Math.floor(took.length / 2)] ?? 0
    const elapsed = now - (e.ranAt ?? e.startedAt)
    if (elapsed > LONG_MS && elapsed > LONG_TIMES * median) {
      out.push({ station: e.station, line: t.runningLong(t.stations[e.station], e.label, formatClock(elapsed, t), formatMs(median, t)) })
    }
  }

  // A running turn with nothing running and nothing starting or ending.
  if ((state === 'thinking' || state === 'running') && board.entries.length > 0 && !board.entries.some(e => e.status === 'run')) {
    const newest = Math.max(...board.entries.map(e => Math.max(e.startedAt, e.endedAt ?? 0)))
    if (now - newest >= QUIET_MS) out.push({ line: t.quietFor(Math.floor((now - newest) / 60_000)) })
  }
  return out.slice(0, 3)
}

/**
 * The line over the rows, how it reads (waiting on the person, the answer given, or plain), and in how many
 * milliseconds its words change by themselves, when they count time.
 */
export type NowLine = { text: string; tone: 'wait' | 'done' | 'plain'; next?: number }

/** What the session does now: what it waits on the person for and how long, since when the answer is ready, or what runs. */
export function describeNow(board: Board, t: Strings, now: number, withContext = true): NowLine {
  const context = board.context === undefined || !withContext ? '' : ` · ${t.context} ${Math.round(board.context)}%`
  const state = stateOf(board)
  const wait = state === 'waiting' ? board.entries.find(e => e.status === 'run' && e.waits === true) : undefined
  if (wait !== undefined) {
    // A wait counts in seconds.
    const what = wait.asks === true ? t.permissionFor(`${t.stations[wait.station]}: ${wait.label}`) : wait.label
    return { text: `${t.waitingFor(what, formatClock(now - wait.startedAt, t))}${context}`, tone: 'wait', next: 1000 - ((now - wait.startedAt) % 1000) }
  }
  if (state === 'done' && board.answeredAt !== undefined) {
    // The time since the answer counts in seconds for a minute, then in whole minutes.
    const ms = Math.max(0, now - board.answeredAt)
    const s = Math.max(1, Math.floor(ms / 1000))
    const since = s < 60 ? t.seconds(String(s)) : t.wholeMinutes(Math.floor(s / 60))
    return { text: `${t.yourTurn(since)}${context}`, tone: 'done', next: s < 60 ? 1000 - (ms % 1000) : 60_000 - (ms % 60_000) }
  }
  const running = board.entries.filter(e => e.status === 'run')
  const top = running[running.length - 1]
  if (top === undefined) return { text: `${t.idle}${context}`, tone: 'plain' }
  return { text: `${t.stations[top.station]}: ${top.label}${running.length > 1 ? t.andMore(running.length - 1) : ''}${context}`, tone: 'plain' }
}

// ---- satellites -------------------------------------------------------------------------------

/** How many satellites a station keeps: its tooltip lists the most used. */
const SAT_KEPT = 12
/** How many of them a tooltip lists. */
const SAT_LISTED = 5

/** The satellites with one more use of `name` at `station`: twelve kept, the least used going first and never the newest. */
export function withSatellite(sat: Board['satellites'], station: StationId, name: string, isEdited: boolean, now: number): Board['satellites'] {
  const list = sat?.[station] ?? []
  const had = list.find(s => s.name === name)
  const next: Satellite = { name, uses: (had?.uses ?? 0) + 1, ...(isEdited || had?.isEdited === true ? { isEdited: true as const } : {}), lastAt: now }
  const rest = list.filter(s => s.name !== name)
  if (rest.length >= SAT_KEPT) {
    const weakest = rest.reduce((w, s) => (s.uses < w.uses || (s.uses === w.uses && s.lastAt < w.lastAt) ? s : w))
    rest.splice(rest.indexOf(weakest), 1)
  }
  return { ...sat, [station]: [...rest, next] }
}

/** The satellites a tooltip lists: the most used, the latest first among equals. */
const listedOf = (list: readonly Satellite[] | undefined): Satellite[] =>
  [...(list ?? [])].sort((a, b) => b.uses - a.uses || b.lastAt - a.lastAt).slice(0, SAT_LISTED)
