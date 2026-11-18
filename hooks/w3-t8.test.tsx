import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'
import { GLOW_MS, drawMap, setupFrom, stillChangeIn, withSatellite } from './map'
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
