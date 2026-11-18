import { expect, mock, test } from 'claude-code/testing'

import type { Board, Entry, StationId } from '../types'
import { drawMap, setupFrom } from './map'
import { paintMap } from './raster'
import { busier } from './register'

const NOW = 1_000_000

const keepBoard = (on: (event: 'state.set' | 'session.measure', hook: never) => void) => {
  const kept: { board: Board } = { board: { entries: [], counts: {} } }
  on(
    'state.set',
    ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept.board = e.value?.value ?? kept.board), next(e))) as never,
  )
  on('session.measure', ((_: unknown, e: { changed: unknown }) => ({ changed: e.changed })) as never)
  return kept
}

test('busy time adds up per station and stays one number each', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = keepBoard(on as never)
  // A call that runs 10 ms, through the real hooks.
  on('tool.call', async () => {
    await clock.advance(10)
    return { result: {} } as never
  })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Read', file_path: `/a/${i}`, tool_use_id: `r${i}` } as never)
  expect(kept.board.busyMs).toEqual({ files: 30 })
  // A call allowed after a prompt counts from when it was allowed.
  const asked: Entry = { id: 'a', station: 'shell', label: 'x', from: 'core', startedAt: 0, ranAt: 900, status: 'run' }
  expect(busier({ entries: [], counts: {} }, asked, 1000)).toEqual({ busyMs: { shell: 100 } })
  // The model and the person are not stations that work.
  expect(busier({ entries: [], counts: {} }, { ...asked, station: 'you' }, 1000)).toEqual({})
  // 5,000 calls across the stations leave one number per station.
  let board: Board = { entries: [], counts: {} }
  const ids = ['files', 'shell', 'web'] as const
  for (let i = 0; i < 5000; i++) board = { ...board, ...busier(board, { ...asked, station: ids[i % 3] as StationId, ranAt: undefined, startedAt: 0 }, 7) }
  expect(Object.keys(board.busyMs ?? {}).sort()).toEqual(['files', 'shell', 'web'])
  expect(JSON.stringify(board.busyMs).length).toBeLessThan(80)
  expect(Object.values(board.busyMs ?? {}).reduce((x, y) => x + y, 0)).toBe(35_000)
})

// One slow Shell call against forty quick Reads.
const slowShell: Board = {
  entries: [],
  counts: { shell: 1, files: 40 },
  busyMs: { shell: 60_000, files: 4_000 },
}

// The stroke widths of the spokes, in the order of the stations.
const widths = (svg: string): number[] =>
  [...svg.matchAll(/<line [^>]*stroke-width="([\d.]+)"[^>]*stroke-linecap="round" stroke="[^"]*"\/>/g)].map(m => Number(m[1]))

test("with spokes time the slow station's spoke is the thickest", () => {
  const byCalls = widths(drawMap(slowShell, NOW, setupFrom({})))
  const byTime = widths(drawMap(slowShell, NOW, setupFrom({ spokes: 'time' })))
  expect(byCalls.length).toBeGreaterThan(2)
  // By calls Files is the thickest; by time it is Shell, and the two draw differently.
  const idx = (w: number[]) => w.indexOf(Math.max(...w))
  expect(idx(byTime)).not.toBe(idx(byCalls))
  const cells = (spokes: string) => paintMap(slowShell, NOW, setupFrom({ spokes }), 60, 28)
  expect(cells('time')).not.toBe(cells('calls'))
  // Nothing timed yet: time mode draws no wear.
  const none = drawMap({ entries: [], counts: { shell: 9 } }, NOW, setupFrom({ spokes: 'time' }))
  expect(widths(none).every(w => w === 1)).toBe(true)
})

test("a station's title gives its share of the time", () => {
  const svg = drawMap(slowShell, NOW, setupFrom({}))
  expect(svg).toContain('94% of the time')
  expect(svg).toContain('6% of the time')
  expect(drawMap({ entries: [], counts: { shell: 3 } }, NOW, setupFrom({}))).not.toContain('of the time')
})
