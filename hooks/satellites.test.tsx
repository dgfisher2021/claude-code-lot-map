import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'
import { GLOW_MS, NODE, drawMap, setupFrom, stillChangeIn, withSatellite } from './map'
import { stringsFor } from './text'
import { paintMap } from './raster'

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOW = 1_000_000
const IDS = ['you', 'model', 'memory', 'files', 'shell', 'web', 'browser', 'agents', 'skills', 'hooks'] as const

const dots = (svg: string, kind = '[a-z]+'): number => (svg.match(new RegExp(`data-satellite="${kind}"`, 'g')) ?? []).length

// Every text of the picture as a box, by the width a monospace face of that size takes.
function boxes(svg: string): { text: string; size: number; x0: number; x1: number; y0: number; y1: number }[] {
  const out = []
  for (const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)"[^>]*font-size="([\d.]+)"[^>]*>(.*?)<\/text>/g)) {
    const [, x, y, anchor, size, inner] = m
    const text = String(inner).replace(/<[^>]+>/g, '')
    const w = [...text].length * 0.6 * Number(size)
    const left = anchor === 'middle' ? Number(x) - w / 2 : anchor === 'end' ? Number(x) - w : Number(x)
    out.push({ text, size: Number(size), x0: left, x1: left + w, y0: Number(y) - Number(size) * 0.8, y1: Number(y) + Number(size) * 0.25 })
  }
  return out
}

function crowded(): Board {
  const counts = Object.fromEntries(IDS.map(id => [id, 123])) as Board['counts']
  const satellites = Object.fromEntries(
    IDS.map(id => [
      id,
      Array.from({ length: 8 }, (_, k) => ({
        name: `a-long-file-name-${k}.ts`,
        uses: 9 - k,
        ...(k % 2 === 0 ? { isEdited: true as const } : {}),
        lastAt: NOW - 1000 * k,
      })),
    ]),
  ) as Board['satellites']
  return { entries: [], counts, satellites, agents: ['a', 'b', 'c'] }
}

test('Files gets satellites for its most-touched files, edited ones filled', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/a/read.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a/read.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/a/edit.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a/edit.ts' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('>a/read.ts<')
  expect(svg).toContain('>a/edit.ts<')
  expect(dots(svg, 'edited')).toBe(1)
  expect(dots(svg, 'read')).toBe(1)
  expect(svg).toContain('a/edit.ts: 2 calls this session · edited')
  await ui.unmount()
})

test(
  'an MCP server gets a satellite at its station, a memory server none',
  { options: { memoryServers: ['recall'], serverStations: ['jira=skills'] } },
  async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('tool.call', () => ({ result: {} }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.tool.call({ tool: 'mcp__figma__get_node' } as never)
    await $.tool.call({ tool: 'mcp__figma__get_file' } as never)
    await $.tool.call({ tool: 'mcp__jira__search' } as never)
    await $.tool.call({ tool: 'mcp__recall__search' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    expect(svg).toContain('>figma<')
    expect(svg).toContain('figma: 2 calls this session')
    expect(svg).toContain('>jira<')
    expect(svg).not.toContain('>recall<')
    expect(dots(svg)).toBe(2)
    await ui.unmount()
  },
)

test('satellites stay capped', () => {
  // Five thousand calls over a thousand names: twelve kept per station, five drawn.
  let sat: Board['satellites']
  for (let i = 0; i < 5000; i++) sat = withSatellite(sat, i % 3 === 0 ? 'files' : 'web', `name-${i % 1000}`, i % 7 === 0, NOW + i)
  expect(sat?.files?.length).toBe(12)
  expect(sat?.web?.length).toBe(12)
  const board: Board = { entries: [], counts: { files: 5, web: 5 }, satellites: sat }
  const drawn = dots(drawMap(board, NOW + 6000, setupFrom({ theme: 'dark' })))
  expect(drawn).toBeLessThanOrEqual(10)
  expect(drawn).toBeGreaterThanOrEqual(8)
  // A name already kept counts up, and the newest call is never the one dropped.
  const once = withSatellite(withSatellite(undefined, 'files', 'a.ts', false, 1), 'files', 'a.ts', true, 2)
  expect(once?.files).toEqual([{ name: 'a.ts', uses: 2, isEdited: true, lastAt: 2 }])
  let full: Board['satellites']
  for (let i = 0; i < 12; i++) full = withSatellite(full, 'files', `f${i}`, false, i)
  for (let i = 0; i < 12; i++) full = withSatellite(full, 'files', `f${i}`, false, 100 + i)
  expect(withSatellite(full, 'files', 'fresh', false, 500)?.files?.some(s => s.name === 'fresh')).toBe(true)
})

test('satellites keep clear of station names, counts and the crew, at either layout', () => {
  for (const layout of ['you-top', 'you-bottom']) {
    const svg = drawMap(crowded(), NOW + 60_000, setupFrom({ theme: 'dark', layout }))
    const all = boxes(svg)
    const sats = all.filter(b => b.size === 7)
    const station = all.filter(b => b.size === 11.5 || b.size === 9.5)
    expect(sats.length).toBeGreaterThan(20)
    for (const s of sats) {
      expect(s.x0).toBeGreaterThanOrEqual(0)
      expect(s.x1).toBeLessThanOrEqual(460)
      expect(s.y0).toBeGreaterThanOrEqual(0)
      expect(s.y1).toBeLessThanOrEqual(430)
      for (const n of station) {
        const apart = s.x1 <= n.x0 || n.x1 <= s.x0 || s.y1 <= n.y0 || n.y1 <= s.y0
        expect(apart, `${s.text} over ${n.text}`).toBe(true)
      }
      // Names are cut to twelve characters.
      expect([...s.text].length).toBeLessThanOrEqual(12)
    }
  }
})

test('a satellite lights for a moment; with reduced motion it is simply lit, then out', () => {
  const board: Board = { entries: [], counts: { files: 3 }, satellites: { files: [{ name: 'a.ts', uses: 3, lastAt: NOW - 1000 }] } }
  const full = drawMap(board, NOW, setupFrom({ theme: 'dark' }))
  const still = drawMap(board, NOW, setupFrom({ theme: 'dark', motion: 'reduced' }))
  expect(full).toMatch(/data-lit="1"[^>]*>\s*<animate/)
  expect(still).toContain('data-lit="1"')
  expect(still).not.toMatch(/data-lit="1"[^>]*>\s*<animate/)
  expect(drawMap(board, NOW + GLOW_MS, setupFrom({ theme: 'dark', motion: 'reduced' }))).not.toContain('data-lit')
  // The picture is looked at again when the light goes out.
  expect(stillChangeIn(board, NOW)).toBe(GLOW_MS - 1000)
})

// A Raster's glyphs as lines of text.
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

test('cells show the count of satellites after the name, no dots', () => {
  const board: Board = { entries: [], counts: { files: 4 }, satellites: { files: [1, 2, 3].map(k => ({ name: `f${k}.ts`, uses: k, lastAt: 1 })) } }
  const text = (b: Board) => linesOf(paintMap(b, NOW, setupFrom({ theme: 'dark' }), 60, 28), 60).join('\n')
  expect(text(board)).toContain('Files 4 ·3')
  expect(text({ ...board, satellites: undefined })).not.toContain('·3')
})

test('every drawn satellite is nearer its own station than any other, crowded and not, at either layout', () => {
  const names = stringsFor('en').stations
  for (const layout of ['you-top', 'you-bottom']) {
    for (const [count, len] of [
      [0, 3],
      [0, 12],
      [5000, 30],
    ] as const) {
      // Every station serves files named after it, so a dot's station reads off its title.
      const sats = (id: string) =>
        Array.from({ length: 8 }, (_, k) => ({ name: `${id.slice(0, 3)}${'f'.repeat(len)}${k}`, uses: 9 - k, lastAt: NOW - 1000 * k }))
      const board: Board = {
        entries: [],
        counts: Object.fromEntries(IDS.map(id => [id, count])) as Board['counts'],
        satellites: Object.fromEntries(IDS.map(id => [id, sats(id)])) as Board['satellites'],
        agents: ['a', 'b'],
      }
      const svg = drawMap(board, NOW + 60_000, setupFrom({ theme: 'dark', layout }))
      // A station's centre, from where its name stands: the name's baseline is NODE + 15 under it.
      const centre = (id: (typeof IDS)[number]) => {
        const m = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)" text-anchor="middle"[^>]*font-size="11.5"[^>]*>${names[id]}<`).exec(svg)
        return { x: Number(m?.[1]), y: Number(m?.[2]) - NODE - 15 }
      }
      const drawn = [...svg.matchAll(/<title>([a-z]{3})[^<]*<\/title><circle cx="([\d.]+)" cy="([\d.]+)" r="3" /g)].map(m => ({
        id: IDS.find(i => i.startsWith(m[1] as string)) as (typeof IDS)[number],
        x: Number(m[2]),
        y: Number(m[3]),
      }))
      expect(drawn.length).toBeGreaterThan(10)
      for (const d of drawn) {
        const own = centre(d.id)
        const ownGap = Math.hypot(d.x - own.x, d.y - own.y)
        for (const id of IDS) {
          if (id === d.id) continue
          const o = centre(id)
          expect(Math.hypot(d.x - o.x, d.y - o.y), `${layout}: a ${d.id} dot at ${d.x},${d.y} beside ${id}`).toBeGreaterThan(ownGap)
        }
      }
    }
  }
})

test('a refused or failed Edit marks no satellite; one that went through marks it edited', async ($, on) => {
  mock.clock(on, { now: NOW })
  let answer: { result: object; isError?: boolean } = { result: {} }
  on('tool.call', () => answer as never)
  const mounted = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    return svg
  }
  answer = { result: {}, isError: true }
  await $.tool.call({ tool: 'Edit', file_path: '/a/b/gone.ts', old_string: 'x', new_string: 'y' } as never)
  expect(dots(await mounted())).toBe(0)
  answer = { result: {} }
  await $.tool.call({ tool: 'Edit', file_path: '/a/b/kept.ts', old_string: 'x', new_string: 'y' } as never)
  expect(dots(await mounted(), 'edited')).toBe(1)
})
