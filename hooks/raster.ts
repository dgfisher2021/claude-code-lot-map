// The map in a terminal: the scene `drawMap` draws, painted into the cells of a Raster.

import type { Board, Entry } from '../types'
import {
  CORE,
  CX,
  CY,
  DONE_MS,
  GLOW_MS,
  H,
  HUB,
  NODE,
  PULSE_MS,
  RIPPLE_MS,
  STATIONS,
  STILL_STEP_MS,
  STRIP,
  SWITCH_MS,
  TRAIL_FADE_MS,
  TRAIL_HOLD_MS,
  W,
  aside,
  costText,
  edge,
  endsOf,
  indexOf,
  laneOf,
  legPoints,
  legsOf,
  motionOf,
  orient,
  paletteOf,
  place,
  shortModel,
  stateOf,
  stationState,
  stripOf,
  warningsOf,
  wearOf,
} from './map'
import type { Palette, Point, Setup } from './map'

type Rgb = [number, number, number]

/** Pixels per cell: two across and four down, so that a pixel is square on a cell twice as tall as it is wide. */
const PX = 2
const PY = 4
/** The thinnest line, in pixels: a thinner one fades to nothing once a cell takes its two colors. */
const HAIR = 1.2
/** The terminal's own color, where the map leaves the surface showing. */
const DEFAULT = 0x01000000

/** One glyph per pattern of a cell's quarters: bit 0 top left, 1 top right, 2 bottom left, 3 bottom right. */
const QUARTERS = [...' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'].map(ch => ch.codePointAt(0) ?? 0x20)

/** A sign in the middle of each station, where the station is big enough to hold one. */
const SIGNS: Record<(typeof STATIONS)[number]['id'], string> = {
  you: '@',
  model: '◆',
  memory: '¶',
  files: '▤',
  shell: '$',
  web: '◎',
  browser: '▣',
  agents: '◬',
  skills: '↯',
  hooks: '↩',
}

const rgbOf = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Only characters a cell holds one of: anything wide, joining or unprintable becomes a dot. */
const isNarrow = (cp: number): boolean =>
  (cp >= 0x20 && cp < 0x7f) ||
  (cp >= 0xa1 && cp <= 0x2ff && cp !== 0xad) ||
  (cp >= 0x384 && cp <= 0x482) ||
  (cp >= 0x48a && cp <= 0x52f) ||
  (cp >= 0x2010 && cp <= 0x2027) ||
  (cp >= 0x2190 && cp <= 0x21ff) ||
  (cp >= 0x2500 && cp <= 0x25ff) ||
  cp === 0x2715

const glyphs = (text: string): number[] => Array.from(text.normalize('NFC'), ch => ch.codePointAt(0) ?? 0xb7).map(cp => (isNarrow(cp) ? cp : 0xb7))

/** Words laid over the cells: `bg` absent keeps what was painted under them. */
type Words = { col: number; row: number; parts: { text: string; fg: Rgb }[]; bg?: Rgb }

/** A canvas of square pixels, painted by signed distance so that every edge is soft. Coordinates are the map's own units. */
class Canvas {
  readonly w: number
  readonly h: number
  /** Pixels per unit of the map. */
  readonly s: number
  readonly ox: number
  readonly oy: number
  readonly px: Float32Array

  constructor(w: number, h: number, ground: Rgb) {
    this.w = w
    this.h = h
    this.s = Math.min(w / W, h / H)
    this.ox = (w - W * this.s) / 2
    this.oy = (h - H * this.s) / 2
    this.px = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h; i++) this.px.set(ground, i * 3)
  }

  /** Paints where `sd` (units from the edge, negative inside) is within half a pixel, over the box `x0..x1`, `y0..y1`. */
  private shade(x0: number, y0: number, x1: number, y1: number, sd: (x: number, y: number) => number, c: Rgb, alpha: number): void {
    if (!(alpha > 0.004)) return
    const { s, ox, oy, w, h, px } = this
    const i0 = Math.max(0, Math.floor(x0 * s + ox - 1))
    const i1 = Math.min(w - 1, Math.ceil(x1 * s + ox + 1))
    const j0 = Math.max(0, Math.floor(y0 * s + oy - 1))
    const j1 = Math.min(h - 1, Math.ceil(y1 * s + oy + 1))
    const a1 = Math.min(1, alpha)
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5 - oy) / s
      for (let i = i0; i <= i1; i++) {
        const cover = clamp(0.5 - sd((i + 0.5 - ox) / s, y) * s, 0, 1)
        if (cover <= 0) continue
        const a = cover * a1
        const k = (j * w + i) * 3
        px[k] = (px[k] ?? 0) + (c[0] - (px[k] ?? 0)) * a
        px[k + 1] = (px[k + 1] ?? 0) + (c[1] - (px[k + 1] ?? 0)) * a
        px[k + 2] = (px[k + 2] ?? 0) + (c[2] - (px[k + 2] ?? 0)) * a
      }
    }
  }

  /** Half a line's width in units: as written, or a hair at the least. */
  private half(width: number): number {
    return Math.max(width * this.s, HAIR) / 2 / this.s
  }

  disc(p: Point, r: number, c: Rgb, alpha = 1): void {
    const rr = Math.max(r, 0.8 / this.s)
    this.shade(p.x - rr, p.y - rr, p.x + rr, p.y + rr, (x, y) => Math.hypot(x - p.x, y - p.y) - rr, c, alpha)
  }

  /** A ring; `sweep` below 1 draws that share of it as an arc, clockwise from the top. */
  ring(p: Point, r: number, width: number, c: Rgb, alpha = 1, sweep = 1): void {
    if (sweep <= 0) return
    const half = this.half(width)
    const out = r + half
    this.shade(
      p.x - out,
      p.y - out,
      p.x + out,
      p.y + out,
      (x, y) => {
        if (sweep < 1 && (Math.atan2(x - p.x, p.y - y) / (2 * Math.PI) + 1) % 1 > sweep) return Infinity
        return Math.abs(Math.hypot(x - p.x, y - p.y) - r) - half
      },
      c,
      alpha,
    )
  }

  /**
   * A line through `points`; `dash` above 0 breaks it into dashes that many pixels long.
   * Each segment marks its own box in a shared mask, the most cover a pixel gets, so joints are not painted twice.
   */
  path(points: readonly Point[], width: number, c: Rgb, alpha = 1, dash = 0): void {
    if (points.length < 2 || !(alpha > 0.004)) return
    const { s, ox, oy, w, h, px } = this
    const half = this.half(width) * s
    const mask = (this.mask ??= new Float32Array(w * h))
    let bx0 = w
    let by0 = h
    let bx1 = -1
    let by1 = -1
    let along = 0
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1] as Point
      const b = points[k] as Point
      const ax = a.x * s + ox
      const ay = a.y * s + oy
      const dx = b.x * s + ox - ax
      const dy = b.y * s + oy - ay
      const len2 = dx * dx + dy * dy
      const len = Math.sqrt(len2)
      const i0 = Math.max(0, Math.floor(Math.min(ax, ax + dx) - half - 1))
      const i1 = Math.min(w - 1, Math.ceil(Math.max(ax, ax + dx) + half + 1))
      const j0 = Math.max(0, Math.floor(Math.min(ay, ay + dy) - half - 1))
      const j1 = Math.min(h - 1, Math.ceil(Math.max(ay, ay + dy) + half + 1))
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = i + 0.5 - ax
          const y = j + 0.5 - ay
          const t = len2 > 0 ? clamp((x * dx + y * dy) / len2, 0, 1) : 0
          if (dash > 0 && (along + t * len) % (dash * 2) > dash) continue
          const cover = clamp(half + 0.5 - Math.hypot(x - dx * t, y - dy * t), 0, 1)
          const n = j * w + i
          if (cover > (mask[n] ?? 0)) mask[n] = cover
        }
      }
      along += len
      bx0 = Math.min(bx0, i0)
      by0 = Math.min(by0, j0)
      bx1 = Math.max(bx1, i1)
      by1 = Math.max(by1, j1)
    }
    const a1 = Math.min(1, alpha)
    for (let j = by0; j <= by1; j++) {
      for (let i = bx0; i <= bx1; i++) {
        const n = j * w + i
        const cover = mask[n] ?? 0
        if (cover <= 0) continue
        mask[n] = 0
        const a = cover * a1
        const k = n * 3
        px[k] = (px[k] ?? 0) + (c[0] - (px[k] ?? 0)) * a
        px[k + 1] = (px[k + 1] ?? 0) + (c[1] - (px[k + 1] ?? 0)) * a
        px[k + 2] = (px[k + 2] ?? 0) + (c[2] - (px[k + 2] ?? 0)) * a
      }
    }
  }

  /** Scratch for `path`: how much of each pixel the line covers, cleared as it is painted. */
  private mask: Float32Array | undefined

  /** An ellipse's outline, dotted every `dash` pixels when `dash` is above 0. */
  ellipse(p: Point, rx: number, ry: number, width: number, c: Rgb, alpha = 1, dash = 0): void {
    const half = this.half(width)
    const s = this.s
    const round = (rx + ry) / 2
    this.shade(
      p.x - rx - half,
      p.y - ry - half,
      p.x + rx + half,
      p.y + ry + half,
      (x, y) => {
        const u = (x - p.x) / rx
        const v = (y - p.y) / ry
        if (dash > 0 && ((Math.atan2(v, u) + Math.PI) * round * s) % (dash * 2) > dash) return Infinity
        const grad = Math.hypot(u / rx, v / ry) * 2 || 1
        return Math.abs((u * u + v * v - 1) / grad) - half
      },
      c,
      alpha,
    )
  }

  /** The canvas as Raster cells: each cell's four quarters split into the two colors that fit them best, words laid over them. */
  cells(columns: number, rows: number, words: readonly Words[], ground: Rgb, isTransparent: boolean): Uint32Array {
    const out = new Uint32Array(columns * rows * 3)
    const isGround = (c: Rgb): boolean => isTransparent && Math.abs(c[0] - ground[0]) + Math.abs(c[1] - ground[1]) + Math.abs(c[2] - ground[2]) < 6
    const pack = (c: Rgb): number => (clamp(Math.round(c[0]), 0, 255) << 16) | (clamp(Math.round(c[1]), 0, 255) << 8) | clamp(Math.round(c[2]), 0, 255)
    // Only a background may be the terminal's own: as a foreground the same value is its text color.
    const packBg = (c: Rgb): number => (isGround(c) ? DEFAULT : pack(c))
    const means: Rgb[] = []
    const q = new Float32Array(12)
    const { w, px } = this
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        // A quarter cell is two pixels, one above the other.
        for (let n = 0; n < 4; n++) {
          const top = ((row * PY + (n >> 1) * 2) * w + col * PX + (n & 1)) * 3
          for (let ch = 0; ch < 3; ch++) q[n * 3 + ch] = ((px[top + ch] ?? 0) + (px[top + w * 3 + ch] ?? 0)) / 2
        }
        const all = mean(q, 15)
        means.push(all)
        let best = { mask: 0, fg: all, bg: all, err: spread(q, 15, all) }
        // Seven ways to split four quarters in two; the bottom right always stays in the second part.
        for (let mask = 1; mask < 8; mask++) {
          const fg = mean(q, mask)
          const bg = mean(q, 15 & ~mask)
          const err = spread(q, mask, fg) + spread(q, 15 & ~mask, bg)
          if (err < best.err - 24) best = { mask, fg, bg, err }
        }
        // The smaller part takes the glyph, so the cell's background carries most of it; where the ground shows through, the ground is the background.
        if (isGround(best.fg) ? !isGround(best.bg) : popcount(best.mask) > 2 && !isGround(best.bg)) {
          best = { ...best, mask: 15 & ~best.mask, fg: best.bg, bg: best.fg }
        }
        const k = (row * columns + col) * 3
        out[k] = QUARTERS[best.mask] ?? 0x20
        out[k + 1] = pack(best.mask === 0 ? best.bg : best.fg)
        out[k + 2] = packBg(best.bg)
      }
    }
    for (const { col, row, parts, bg } of words) {
      if (row < 0 || row >= rows) continue
      let x = col
      for (const { text, fg } of parts) {
        for (const cp of glyphs(text)) {
          if (x >= 0 && x < columns) {
            const k = (row * columns + x) * 3
            out[k] = cp
            out[k + 1] = pack(fg)
            out[k + 2] = packBg(bg ?? means[row * columns + x] ?? ground)
          }
          x++
        }
      }
    }
    return out
  }
}

const popcount = (mask: number): number => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)

/** The mean color of the quarters in `mask`, from `q`: four colors, three numbers each. */
function mean(q: Float32Array, mask: number): Rgb {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < 4; i++) {
    if (((mask >> i) & 1) === 0) continue
    r += q[i * 3] ?? 0
    g += q[i * 3 + 1] ?? 0
    b += q[i * 3 + 2] ?? 0
    n++
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

function spread(q: Float32Array, mask: number, m: Rgb): number {
  let err = 0
  for (let i = 0; i < 4; i++) {
    if (((mask >> i) & 1) === 0) continue
    err += ((q[i * 3] ?? 0) - m[0]) ** 2 + ((q[i * 3 + 1] ?? 0) - m[1]) ** 2 + ((q[i * 3 + 2] ?? 0) - m[2]) ** 2
  }
  return err
}

const B64 = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map(ch => ch.charCodeAt(0))
const PAD = 0x3d
const isLittleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

/** Standard padded base64 of the cells' bytes, little-endian as a Raster reads them. */
function base64(words: Uint32Array): string {
  let bytes: Uint8Array
  if (isLittleEndian) bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
  else {
    bytes = new Uint8Array(words.length * 4)
    const view = new DataView(bytes.buffer)
    words.forEach((v, i) => view.setUint32(i * 4, v, true))
  }
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)
  for (let i = 0, o = 0; i < bytes.length; i += 3, o += 4) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out[o] = B64[(n >> 18) & 63] ?? PAD
    out[o + 1] = B64[(n >> 12) & 63] ?? PAD
    out[o + 2] = i + 1 < bytes.length ? (B64[(n >> 6) & 63] ?? PAD) : PAD
    out[o + 3] = i + 2 < bytes.length ? (B64[n & 63] ?? PAD) : PAD
  }
  let text = ''
  for (let i = 0; i < out.length; i += 8192) text += String.fromCharCode(...out.subarray(i, i + 8192))
  return text
}

/** A quadratic curve as a run of short lines, drawn up to `upTo` of its length. */
function curve(a: Point, bend: Point, b: Point, upTo = 1): Point[] {
  const steps = 18
  const points: Point[] = []
  for (let k = 0; k <= steps; k++) {
    const t = (k / steps) * upTo
    const u = 1 - t
    points.push({ x: u * u * a.x + 2 * u * t * bend.x + t * t * b.x, y: u * u * a.y + 2 * u * t * bend.y + t * t * b.y })
  }
  return points
}

/** The room the pane asks for: docked, columns for the map with its labels clear of one another; inline, rows for it. */
export const MAP_COLUMNS = 60
export const MAP_ROWS = 22
/** The narrowest docked pane whose map keeps its labels apart. */
export const MAP_MIN_COLUMNS = 44
/** Pixels a picture of the map gets per cell: a little over a common terminal cell, sharp without costing much a frame. */
export const PICTURE_CELL = { width: 12, height: 24 }

/** Where the map goes in the pane, in cells: above the rows, or beside them. */
export type MapLayout = { columns: number; rows: number; isBeside: boolean }

/**
 * The map's place in a pane, keeping the ring round on cells twice as tall as wide. Docked beside the conversation the
 * pane is narrow and tall, so the map takes its width with the rows under it; inline above the prompt it is wide and
 * short, so the map takes its height with the rows beside it. In a short dock the rows under the map give way before
 * the map does. Undefined where the map would be too small for its labels.
 */
export function mapSize(bodyColumns: number, bodyRows: number, placement: 'dock' | 'inline' | 'widget'): MapLayout | undefined {
  if (placement === 'dock') {
    const columns = Math.min(Math.floor(bodyColumns), 120)
    // Eight rows for the feed while the map keeps its 20, then fewer.
    const room = Math.max(bodyRows - 8, Math.min(bodyRows, 20))
    const rows = Math.min(Math.round((columns * PX * H) / (W * PY)), room, 44)
    return columns >= MAP_MIN_COLUMNS && rows >= 20 ? { columns, rows, isBeside: false } : undefined
  }
  const rows = Math.min(Math.floor(bodyRows), 24)
  const columns = Math.round((rows * PY * W) / (H * PX))
  return rows >= 20 && bodyColumns >= columns + 32 ? { columns, rows, isBeside: true } : undefined
}

/** How soon the map wants its next frame: often while something flies, seldom while it only breathes; with reduced motion, every five seconds at most. */
export function paceOf(board: Board, now: number, setup: Setup): number {
  if (setup.motion === 'reduced') return STILL_STEP_MS
  const { recent, flights, returns, beams, anyRunning } = motionOf(board, now)
  const done = recent.filter(e => e.mark === 'done').pop()
  const isSwitching = board.switchedAt !== undefined && now - board.switchedAt < SWITCH_MS
  const isDrawing = legsOf(recent, now).some(leg => leg.age < 600)
  if (flights.length + returns.length + beams.length > 0 || isSwitching || isDrawing || (done !== undefined && now - done.startedAt < DONE_MS)) return 40
  const isGlowing = STATIONS.some(st => {
    const state = stationState(st.id, recent, board, now)
    return state.isLit || state.isAlarm
  })
  return anyRunning || isGlowing || (board.agents ?? []).length > 0 ? 90 : 250
}

/** The map at `now`, as a Raster's `cells` for `columns` by `rows`. */
export function paintMap(board: Board, now: number, setup: Setup, columns: number, rows: number): string {
  const palette = paletteOf(setup)
  const c = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, rgbOf(v)])) as Record<keyof Palette, Rgb>
  orient(setup)
  const cv = new Canvas(columns * PX, rows * PY, c.ground)
  const s = cv.s
  const words: Words[] = []
  const rim = setup.background === 'transparent' ? undefined : c.ground
  const colOf = (x: number): number => (x * s + cv.ox) / PX
  const rowOf = (y: number): number => (y * s + cv.oy) / PY
  const core: Point = { x: CX, y: CY }
  const isStill = setup.motion === 'reduced'
  const { recent, flights, returns, beams, anyRunning } = motionOf(board, now, isStill)
  const isBad = (e: Entry): boolean => e.status === 'block' || e.status === 'err'
  const tone = (e: Entry): [Rgb, Rgb] => (e.station === 'memory' ? [c.mem, c.memHot] : [c.accent, c.hot])

  // Contours around the core: solid and faint, as dots this coarse read as noise.
  for (const [rx, ry] of [
    [66, 62],
    [104, 97],
    [142, 132],
  ] as const)
    cv.ellipse(core, rx, ry, 0.7, c.line, 0.4)

  // Spokes, worn in with use.
  STATIONS.forEach((st, i) => {
    const p = place(i)
    const a = edge(core, p, HUB)
    const b = edge(p, core, NODE)
    const worn = wearOf(board, st.id, setup)
    const width = (HAIR + 1.6 * worn) / s
    cv.path([a, b], width, c.spoke)
    if (worn > 0) cv.path([a, b], width, st.id === 'memory' ? c.mem : c.accent, worn * 0.55)
  })

  const states = STATIONS.map(st => stationState(st.id, recent, board, now))
  const warned = new Set(warningsOf(board, now, setup.t).map(w => w.station))

  // Under the stations: the glow, the beat of what runs and the two hands of its clock.
  STATIONS.forEach((st, i) => {
    const p = place(i)
    const { running, isLit, isAlarm, fade, span } = states[i] ?? stationState(st.id, recent, board, now)
    const [main, hot] = st.id === 'memory' ? [c.mem, c.memHot] : [c.accent, c.hot]
    const color = isAlarm ? c.red : main
    if (isLit || isAlarm) cv.disc(p, NODE + 10, color, running.length > 0 && !isAlarm ? 0.16 : isStill ? 0.3 : 0.3 * (1 - fade / span))
    if (running.length > 0) {
      const ran = now - Math.min(...running.map(e => e.startedAt))
      // Standing still, the hands step every five seconds.
      const elapsed = isStill ? ran - (ran % STILL_STEP_MS) : ran
      const beat = (elapsed % 1400) / 1400
      if (!isStill) cv.ring(p, NODE + 15 * beat, 1.3, color, 0.9 * (1 - beat))
      cv.ring(p, NODE + Math.max(4, 1.5 / s), 2.2, hot, 1, (elapsed % 60_000) / 60_000)
      cv.ring(p, NODE + Math.max(8, 3.1 / s), 1.2, hot, 1, Math.min(elapsed, 600_000) / 600_000)
    }
  })

  // The route between the last stations, the newest leg drawing itself. Lighter than the drawing's, as its lines are wider here.
  for (const leg of legsOf(recent, now)) {
    // Standing still, a leg is drawn whole and goes with the next frame after its time.
    if (isStill && leg.age >= TRAIL_HOLD_MS) continue
    const { a, bend, b } = legPoints(indexOf(leg.from), indexOf(leg.to))
    const isHead = leg.k === leg.count - 1
    const fading = clamp(1 - (leg.age - TRAIL_HOLD_MS) / TRAIL_FADE_MS, 0, 1)
    const opacity = (0.08 + (0.32 * leg.k) / (leg.count - 1)) * fading
    cv.path(curve(a, bend, b, isHead && !isStill ? clamp(leg.age / 500, 0.02, 1) : 1), isHead ? 1.5 : 1.1, c.trail, opacity)
    if (isHead && (isStill || leg.age > 400)) cv.disc(b, 2.4, c.trail, 0.85 * (isStill ? 1 : clamp((leg.age - 400) / 150, 0, 1)) * fading)
  }

  /** A pulse with a short tail behind it; a hollow one is a signal nobody asked for. */
  const pulse = (a: Point, b: Point, color: Rgb, age: number, radius: number, isHollow = false): void => {
    for (let k = isHollow ? 0 : 2; k >= 0; k--) {
      const t = (age - k * 45) / PULSE_MS
      if (t < 0 || t >= 1) continue
      const peak = 1 - 0.36 * k
      const alpha = t < 0.82 ? peak : peak * (1 - (t - 0.82) / 0.18)
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const r = Math.max(radius * (1 - 0.27 * k), (1.8 - 0.45 * k) / s)
      if (isHollow) cv.ring(at, r, 1.4, color, alpha)
      else cv.disc(at, r, color, alpha)
    }
  }
  const ripple = (p: Point, r: number, color: Rgb, age: number): void => {
    const t = (age - PULSE_MS) / RIPPLE_MS
    if (t >= 0 && t < 1) cv.ring(p, r + 11 * t, 1.2, color, 0.7 * (1 - t))
  }

  for (const e of beams) {
    const [a, b] = endsOf(e)
    cv.path([a, b], 1.4, isBad(e) ? c.red : tone(e)[0], 0.75 * (1 - (now - e.startedAt) / (GLOW_MS / 2)), e.from === 'inbound' ? 1.5 : 0)
  }
  for (const e of flights) {
    const [a, b] = aside(...endsOf(e), laneOf(flights, e))
    const age = now - e.startedAt
    const color = e.status === 'block' ? c.red : tone(e)[1]
    if (e.from === 'inbound') {
      pulse(b, a, color, age, 3.8, true)
      ripple(core, HUB - 2, color, age)
    } else {
      pulse(a, b, color, age, 3.8)
      ripple(place(indexOf(e.station)), NODE, color, age)
    }
  }
  for (const e of returns) {
    const [a, b] = aside(...endsOf(e), laneOf(returns, e))
    pulse(b, a, e.status === 'ok' ? c.ash : c.red, now - (e.endedAt ?? now), 2.6)
  }

  // The stations themselves, their names and counts under them.
  const hasSigns = NODE * s >= 3.5
  let lowestName = -1
  STATIONS.forEach((st, i) => {
    const p = place(i)
    const { count, running, isLit, isAlarm, fade, span } = states[i] ?? stationState(st.id, recent, board, now)
    const [main, hot] = st.id === 'memory' ? [c.mem, c.memHot] : [c.accent, c.hot]
    const color = isAlarm ? c.red : main
    cv.disc(p, NODE, c.raised)
    cv.ring(p, NODE, 1.2, c.line)
    if (running.length > 0) cv.ring(p, NODE, 1.2, color)
    else if (isLit || isAlarm) cv.ring(p, NODE, 1.2, color, isStill ? 1 : 1 - fade / span)

    const sign = warned.has(st.id) ? c.accent : isAlarm ? c.red : isLit ? hot : st.id === 'memory' && count > 0 ? main : c.ash
    if (hasSigns) words.push({ col: Math.floor(colOf(p.x)), row: Math.floor(rowOf(p.y)), parts: [{ text: SIGNS[st.id], fg: sign }] })

    const parts = [{ text: setup.t.stations[st.id], fg: isLit || isAlarm ? c.bone : c.ash }]
    if (count > 0) {
      const pushed = st.id === 'memory' ? Math.min(count, board.pushed ?? 0) : 0
      const asked = count - pushed
      if (pushed === 0 || asked > 0) parts.push({ text: ` ${pushed === 0 ? count : asked}`, fg: c.dim })
      if (pushed > 0) parts.push({ text: ` ↓${pushed}`, fg: main })
      // This turn's share, then the session's errors, while the figures stay within ten cells: the share goes first.
      const turn = board.turnCounts?.[st.id] ?? 0
      const total = board.faultTotals?.[st.id] ?? 0
      const share = turn > 0 && turn < count ? [{ text: ` +${turn}`, fg: c.dim }] : []
      const errors = total > 0 ? [{ text: ` ${total}✕`, fg: c.red }] : []
      const width = (list: { text: string }[]) => list.reduce((n, part) => n + glyphs(part.text).length, 0)
      const base = parts.slice(1)
      for (const more of [[...share, ...errors], errors]) {
        if (width(base) + width(more) <= 10) {
          parts.push(...more)
          break
        }
      }
      // The satellites' count, when it fits.
      const kept = board.satellites?.[st.id]?.length ?? 0
      if (kept > 0 && width(parts.slice(1)) + glyphs(` ·${kept}`).length <= 10) parts.push({ text: ` ·${kept}`, fg: c.dim })
    }
    const length = parts.reduce((n, part) => n + glyphs(part.text).length, 0)
    const nameRow = Math.min(rows - 1, Math.ceil(rowOf(p.y + NODE) - 0.3))
    lowestName = Math.max(lowestName, nameRow)
    words.push({
      col: clamp(Math.round(colOf(p.x) - length / 2), 0, Math.max(0, columns - length)),
      row: nameRow,
      parts,
      ...(rim !== undefined ? { bg: rim } : {}),
    })

    // Top right: how many run at once. Top left: what went wrong since the last message, until the next one.
    const top = Math.floor(rowOf(p.y - NODE * 0.74))
    if (running.length > 1)
      words.push({
        col: Math.round(colOf(p.x + NODE * 0.74)),
        row: top,
        parts: [{ text: `×${running.length}`, fg: hot }],
        ...(rim !== undefined ? { bg: rim } : {}),
      })
    const faults = board.faults?.[st.id] ?? 0
    if (faults > 0) {
      const text = faults > 99 ? '99+' : String(faults)
      words.push({ col: Math.round(colOf(p.x - NODE * 0.74)) - text.length + 1, row: top, parts: [{ text, fg: c.ground }], bg: c.red })
    }
    // Calls refused there, red on the ground, left of the faults: a node has no room under it before its name.
    const blocks = board.blocks?.[st.id] ?? 0
    if (blocks > 0) {
      const text = blocks > 99 ? '99+' : String(blocks)
      const beside = faults > 0 ? (faults > 99 ? 4 : String(faults).length + 1) : 0
      words.push({
        col: Math.round(colOf(p.x - NODE * 0.74)) - text.length + 1 - beside,
        row: top,
        parts: [{ text, fg: c.red }],
        ...(rim !== undefined ? { bg: rim } : {}),
      })
    }
  })

  // The timeline strip as a row of quarter blocks under the lowest name, where the map has a row to spare.
  const stripRow = Math.floor(rowOf(STRIP.y + STRIP.h / 2))
  const strip = stripRow > lowestName && stripRow < rows ? stripOf(board, now) : undefined
  if (strip !== undefined) {
    const col0 = Math.round(colOf(STRIP.x0))
    const cols = Math.max(1, Math.round(colOf(STRIP.x1)) - col0)
    // Per cell, the strongest mark in it: a fault, then a wait, then memory, then any other.
    const cells: { glyph: string; fg: Rgb; rank: number }[] = []
    const claim = (k: number, glyph: string, fg: Rgb, rank: number): void => {
      if (k >= 0 && k < cols && rank > (cells[k]?.rank ?? 0)) cells[k] = { glyph, fg, rank }
    }
    for (const { from, to, kind, bad } of strip.marks) {
      const [glyph, fg, rank] = bad ? ['▄', c.red, 4] : kind === 'wait' ? ['▚', c.accent, 3] : kind === 'memory' ? ['▄', c.mem, 2] : ['▄', c.accent, 1]
      for (let k = Math.floor(from * cols); k <= Math.min(cols - 1, Math.floor(to * cols)); k++) claim(k, glyph as string, fg as Rgb, rank as number)
    }
    for (const t of strip.ticks) claim(Math.min(cols - 1, Math.floor(t * cols)), '▘', c.bone, 0.5)
    cells.forEach((cell, k) => words.push({ col: col0 + k, row: stripRow, parts: [{ text: cell.glyph, fg: cell.fg }], ...(rim !== undefined ? { bg: rim } : {}) }))
  }

  // Each subagent still at work circles the agents station.
  const agentsAt = place(indexOf('agents'))
  const crew = board.agents ?? []
  crew.forEach((agent, k) => {
    const lap = 7000
    const turn = (isStill ? k / crew.length : ((now + (k * lap) / crew.length) % lap) / lap) * 2 * Math.PI
    const r = NODE + 6
    // A subagent a call of which failed or was refused circles in red.
    cv.disc({ x: agentsAt.x + r * Math.sin(turn), y: agentsAt.y - r * Math.cos(turn) }, 3, (board.agentFaults ?? []).includes(agent) ? c.red : c.hot)
  })

  // The core breathes at rest and quickens while something runs.
  const period = anyRunning ? 1600 : 4800
  const phase = (now % period) / period
  const breath = phase < 0.5 ? phase * 2 : 2 - phase * 2
  if (isStill) cv.disc(core, CORE + 8, c.accent, anyRunning ? 0.16 : 0.08)
  else cv.disc(core, CORE + 3 + 10 * breath, c.accent, 0.05 + ((anyRunning ? 0.24 : 0.12) - 0.05) * breath)
  cv.disc(core, CORE, c.raised)
  cv.ring(core, CORE, 1.3, anyRunning ? c.accent : c.line)

  // The context window as a ring around the core.
  const middle = Math.floor(rowOf(CY))
  const centre = colOf(CX)
  const say = (row: number, text: string, fg: Rgb): void => {
    words.push({ col: Math.round(centre - glyphs(text).length / 2), row, parts: [{ text, fg }] })
  }
  if (board.context !== undefined) {
    const full = clamp(Math.round(board.context), 0, 100)
    const r = CORE + Math.max(5, 1.6 / s)
    cv.ring(core, r, 2.2, c.line, 0.7)
    cv.ring(core, r, 2.2, full >= 90 ? c.red : full >= 70 ? c.accent : c.ash, 1, full / 100)
    say(middle - 1, `${full}%`, c.dim)
  }
  // The rate-limit windows as thin arcs outside it.
  for (const { kind, percent } of board.limits ?? []) {
    const used = clamp(Math.round(percent), 0, 100)
    const r = CORE + Math.max(kind === 'five_hour' ? 9 : 12, (kind === 'five_hour' ? 3 : 4.4) / s)
    cv.ring(core, r, 1.2, c.line, 0.5)
    cv.ring(core, r, 1.2, used >= 90 ? c.red : used >= 70 ? c.accent : c.ash, 1, used / 100)
  }

  const switchAge = board.switchedAt === undefined ? Infinity : now - board.switchedAt
  const isSwitching = switchAge >= 0 && switchAge < SWITCH_MS
  say(middle, setup.core, c.bone)
  if (board.model !== undefined) say(middle + 1, shortModel(board.model), isSwitching ? c.hot : c.ash)
  // Under them, one word for what the session is doing; a wait for the person blinks.
  const state = stateOf(board)
  const isDim = state === 'waiting' && !isStill && Math.floor(now / 600) % 2 === 1
  say(
    middle + 2,
    setup.t.states[state],
    { idle: c.dim, thinking: c.bone, running: c.hot, waiting: isDim ? c.dim : c.accent, compacting: c.mem, done: c.ash }[state],
  )
  // The cost on the row under it, where that row lies no further out than the map draws it in the picture.
  const spent = costText(board.cost)
  if (spent !== undefined && ((middle + 3.5) * PY - cv.oy) / s - CY < CORE + 30) say(middle + 3, spent, c.dim)

  // A changed model rings at the core and at its station for a few seconds.
  if (isSwitching && !isStill) {
    const t = (switchAge % 1600) / 1600
    for (const [p, r] of [
      [core, CORE],
      [place(indexOf('model')), NODE],
    ] as const)
      cv.ring(p, r + 26 * t, 1.4, c.bone, 0.7 * (1 - t))
  }

  // The answer leaves the core as one wide ring.
  const done = recent.filter(e => e.mark === 'done').pop()
  if (done !== undefined && now - done.startedAt < DONE_MS && !isStill) {
    const t = (now - done.startedAt) / DONE_MS
    cv.ring(core, CORE + 38 * t, 1.6, c.bone, 0.6 * (1 - t))
  }

  return base64(cv.cells(columns, rows, words, c.ground, setup.background === 'transparent'))
}
