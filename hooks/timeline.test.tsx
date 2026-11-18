import { expect, mock, test } from 'claude-code/testing'

import type { Board, Entry, TimelineMark } from '../types'
import { drawMap, setupFrom } from './map'
import { paintMap } from './raster'
import { layout } from '../renderer/layout.mjs'

const PANE = {
  plugin: 'workmap',
  component: 'Pane',
  requestId: 'workmap',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOW = 1_000_000

/** A Raster's glyphs as lines of text, one per row. */
function linesOf(cells: string, columns: number): string[] {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const body = cells.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (const ch of body) {
    acc = ((acc << 6) | digits.indexOf(ch)) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[o++] = (acc >> bits) & 255
    }
  }
  const words = new Uint32Array(bytes.buffer)
  const lines: string[] = []
  for (let k = 0; k < words.length; k += columns * 3) {
    let line = ''
    for (let c = 0; c < columns; c++) line += String.fromCodePoint(words[k + c * 3] ?? 0x3f)
    lines.push(line)
  }
  return lines
}

const entry = (station: Entry['station'], ago: number): Entry => ({
  id: `${station}${ago}`,
  station,
  label: station,
  from: 'core',
  startedAt: NOW - ago,
  endedAt: NOW - ago + 200,
  status: 'ok',
})

const marks = (): TimelineMark[] => [
  { at: NOW - 120_000, until: NOW - 60_000, kind: 'shell' },
  ...Array.from({ length: 20 }, (_, i): TimelineMark => ({ at: NOW - 50_000 + i * 500, until: NOW - 50_000 + i * 500 + 100, kind: 'files' })),
  { at: NOW - 20_000, until: NOW - 12_000, kind: 'wait' },
  { at: NOW - 8_000, until: NOW - 7_000, kind: 'memory' },
]
const board = (timeline: TimelineMark[]): Board => ({ entries: [entry('web', 3000)], counts: { web: 4, files: 2, shell: 1 }, timeline })

/** The strip's marks: kind, x and width, as drawn. */
const strip = (svg: string) =>
  [...svg.matchAll(/<rect class="tl" data-kind="(\w+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"([^>]*)>/g)].map(m => ({
    kind: m[1],
    x: Number(m[2]),
    y: Number(m[3]),
    width: Number(m[4]),
    height: Number(m[5]),
    rest: m[6] ?? '',
  }))

test('the map is 448 tall, and the window lays it out the same', () => {
  const svg = drawMap(board(marks()), NOW, setupFrom({ theme: 'dark' }))
  expect(svg).toContain('viewBox="0 0 460 448"')
  expect(layout({ cols: 60, rows: 30, cell: { w: 8, h: 16 }, listRows: 6, view: 'map' }).h).toBe(Math.floor(448 * Math.min((60 * 8) / 460, (29 * 16) / 448)))
})

test('the strip shows a long Shell call wider than many short Reads, and a wait in amber', () => {
  const setup = setupFrom({ theme: 'dark' })
  const marksOf = strip(drawMap(board(marks()), NOW, setup))
  const shell = marksOf.filter(m => m.kind === 'shell')
  const reads = marksOf.filter(m => m.kind === 'files')
  expect(shell).toHaveLength(1)
  expect(reads).toHaveLength(20)
  expect(shell[0]!.width).toBeGreaterThan(reads.reduce((n, m) => n + m.width, 0))
  // Six pixels tall at 432, inside 20 to 440.
  for (const m of marksOf) {
    expect(m.y).toBe(432)
    expect(m.height).toBe(6)
    expect(m.x).toBeGreaterThanOrEqual(20)
    expect(m.x + m.width).toBeLessThanOrEqual(440.01)
  }
  const wait = marksOf.find(m => m.kind === 'wait')!
  expect(wait.rest).toContain('stroke-dasharray')
  expect(wait.rest).toContain('stroke="#e1ac6e"')
  // Memory keeps its colour, a fault its red.
  expect(drawMap(board(marks()), NOW, setup)).toMatch(/data-kind="memory"[^>]*fill="#62c7ba"/)
  const bad = drawMap(board([{ at: NOW - 5000, until: NOW - 1000, kind: 'shell', bad: true }]), NOW, setup)
  expect(bad).not.toMatch(/data-kind="shell"[^>]*fill="#e1ac6e"/)
  expect(strip(bad)).toHaveLength(1)
  // A turn's start is a one pixel tick above, and an empty board draws no strip.
  const turned = drawMap({ ...board(marks()), turns: [{ n: 1, startedAt: NOW - 130_000, calls: 3, errors: 0 }] }, NOW, setup)
  expect(turned).toMatch(/<rect class="tick"[^>]*width="1"/)
  expect(strip(drawMap({ entries: [], counts: {} }, NOW, setup))).toHaveLength(0)
  // Nothing in the strip moves.
  expect(drawMap(board(marks()), NOW, setupFrom({ motion: 'reduced' })).match(/<g class="timeline">.*?<\/g>/)?.[0]).not.toMatch(/animate/)
})

test("the strip never covers the lowest station's name", () => {
  const setup = setupFrom({ theme: 'dark' })
  const b = board(marks())
  const svg = drawMap(b, NOW, setup)
  const labels = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)" text-anchor="middle"[^>]*font-size="11.5"/g)].map(m => Number(m[1]))
  expect(labels.length).toBeGreaterThan(0)
  // Under the lowest name's baseline, with room for its descenders.
  expect(Math.max(...labels) + 4).toBeLessThan(432)
  const bare = { ...b, timeline: undefined }
  for (const rows of [22, 28]) {
    const withStrip = linesOf(paintMap(b, NOW, setup, 60, rows), 60)
    const without = linesOf(paintMap(bare, NOW, setup, 60, rows), 60)
    const name = withStrip.findIndex(l => l.includes('Network'))
    const changed = withStrip.flatMap((l, k) => (l === without[k] ? [] : [k]))
    expect(name).toBeGreaterThan(0)
    // The strip is one row, and it lies under the name; the name's own row is untouched.
    expect(changed).toHaveLength(1)
    expect(changed[0]).toBeGreaterThan(name)
  }
  // A map with no row to spare draws none.
  expect(paintMap(b, NOW, setup, 60, 14)).toBe(paintMap(bare, NOW, setup, 60, 14))
})

test('the timeline keeps the last 240 marks', async ($, on) => {
  // A board already past the cap (300 marks, as a long session would have left it) takes one more call and keeps 240.
  const old: TimelineMark[] = Array.from({ length: 300 }, (_, i) => ({ at: NOW - 400_000 + i * 1000, until: NOW - 400_000 + i * 1000 + 500, kind: 'files' }))
  on('clock.now', () => ({ value: NOW }))
  let held: unknown = { shape: 'board-5', value: { entries: [], counts: {}, timeline: old } }
  let version = 1
  on('state.get', () => ({ value: { value: held, version } }) as never)
  on('state.set', ((_: unknown, e: { value?: unknown }, next: (e: unknown) => unknown) => {
    held = e.value
    version++
    return next(e)
  }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  for (let i = 0; i < 1; i++) await $.tool.call({ tool: 'Read', file_path: `/a/b/c${i}.ts` } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(strip(svg)).toHaveLength(240)
  await ui.unmount()
})

const keepBoard = (on: (event: 'state.set', hook: never) => void) => {
  const kept: { board: Board } = { board: { entries: [], counts: {} } }
  on(
    'state.set',
    ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept.board = e.value?.value ?? kept.board), next(e))) as never,
  )
  return kept
}

test("a background agent's row, closed by its turn.complete, closes its mark and adds to the time", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = keepBoard(on as never)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => new Promise(() => {}))
  void $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts', agentId: 'a1' } as never)
  await clock.settle()
  expect(kept.board.timeline?.at(-1)?.until).toBeUndefined()
  await clock.advance(700)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' } as never)
  expect(kept.board.timeline?.at(-1)?.until).toBe(NOW + 700)
  expect(kept.board.busyMs?.files).toBe(700)
})

test("an interrupted turn closes the main loop's open marks, and draws no red mark for itself", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = keepBoard(on as never)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => new Promise(() => {}))
  void $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts' } as never)
  await clock.settle()
  await clock.advance(400)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)
  const read = kept.board.timeline?.find(m => m.kind === 'files')
  expect(read?.until).toBe(NOW + 400)
  expect(kept.board.busyMs?.files).toBe(400)
  const you = kept.board.timeline?.find(m => m.kind === 'you')
  expect(you?.bad).toBeUndefined()
})

const CALL = { tool: 'Bash', command: 'make build', description: 'Build it', tool_use_id: 'u1' } as never

/** A shell call that waits on the person: checked as ask, held until released. */
function askedShell(on: (event: string, hook: never) => void) {
  let asking = false
  let settling = false
  let release: () => void = () => {}
  on('tool.check', (() => ({ decision: asking ? 'ask' : 'allow' })) as never)
  on('tool.judge', (() => ({ decision: 'allow' })) as never)
  on('tool.run', ((_: unknown, e: { tool: string }) =>
    settling || e.tool !== 'Bash' ? { result: {} } : new Promise(resolve => (release = () => resolve({ result: {} })))) as never)
  on('tool.call', (() => ({ result: {} })) as never)
  return {
    release: () => release(),
    ask: ($: { tool: { check: (input: never) => Promise<unknown> } }) => ((asking = true), $.tool.check(ASK)),
    settle: async ($: { tool: { run: (input: never) => Promise<unknown> } }) => {
      settling = true
      await $.tool.run(CALL)
      settling = false
    },
  }
}

const ASK = { tool: 'Bash', input: { command: 'make build', description: 'Build it' }, tool_use_id: 'u1' } as never

test('an approved permission closes its wait mark at the approval', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = keepBoard(on as never)
  const held = askedShell(on as never)
  const calling = $.tool.call(CALL)
  await clock.settle()
  await held.ask($)
  await clock.advance(1000)
  await clock.settle()
  const wait = () => kept.board.timeline?.find(m => m.kind === 'wait')
  expect(wait()?.until).toBeUndefined()
  await clock.advance(4000)
  await held.settle($)
  expect(wait()?.until).toBe(NOW + 5000)
  await clock.advance(9000)
  held.release()
  await calling
  expect(wait()?.until).toBe(NOW + 5000)
})

test("an unrelated call finishing leaves another call's wait open", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = keepBoard(on as never)
  const held = askedShell(on as never)
  const calling = $.tool.call(CALL)
  await clock.settle()
  await held.ask($)
  await clock.advance(1000)
  await clock.settle()
  await $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts', tool_use_id: 'u2' } as never)
  expect(kept.board.timeline?.find(m => m.kind === 'wait')?.until).toBeUndefined()
  held.release()
  await calling
  expect(kept.board.timeline?.find(m => m.kind === 'wait')?.until).toBeDefined()
})
