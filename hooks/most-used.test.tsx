import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Board, StationId } from '../types'
import { drawMap, setupFrom, stationTip, withSatellite } from './map'
import type { StationTip } from './map'
import { stringsFor } from './text'

const NOW = 1_000_000
const en = stringsFor('en')
const PANE = {
  plugin: 'workmap',
  component: 'Pane',
  requestId: 'workmap',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

/** A station's tooltip as the drawn map carries it. */
function tipIn(svg: string, station: StationId): StationTip | undefined {
  const unescape = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  return [...svg.matchAll(/<g data-tip="([^"]*)"/g)].map(m => JSON.parse(unescape(m[1] ?? '{}'))).find(t => t.station === station)
}

async function drawn($: Parameters<TestBody>[0]): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()
  return svg
}

test('Files lists its most-touched files in its tooltip, an edited one marked edited, and draws none of them', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/a/read.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a/read.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/a/edit.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/a/edit.ts' } as never)
  const svg = await drawn($)
  expect(tipIn(svg, 'files')?.top).toEqual({
    title: en.tip.mostUsed,
    items: expect.arrayContaining([
      { name: 'a/edit.ts', uses: '×2', icon: 'edited', note: en.satelliteEdited },
      { name: 'a/read.ts', uses: '×2', icon: 'read', note: en.tip.read },
    ]),
  })
  expect(svg).not.toContain('data-satellite')
})

test('a refused or failed Edit lists no file; one that went through lists it edited', async ($, on) => {
  mock.clock(on, { now: NOW })
  let answer: { result: object; isError?: boolean } = { result: {} }
  on('tool.call', () => answer as never)
  answer = { result: {}, isError: true }
  await $.tool.call({ tool: 'Edit', file_path: '/a/b/gone.ts', old_string: 'x', new_string: 'y' } as never)
  expect(tipIn(await drawn($), 'files')?.top).toBeUndefined()
  answer = { result: {} }
  await $.tool.call({ tool: 'Edit', file_path: '/a/b/kept.ts', old_string: 'x', new_string: 'y' } as never)
  expect(tipIn(await drawn($), 'files')?.top?.items).toEqual([{ name: 'b/kept.ts', uses: '×1', icon: 'edited', note: en.satelliteEdited }])
})

test('an MCP server is listed under Skills & MCP, a memory server is not', { options: { memoryServers: ['recall'] } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__figma__get_node' } as never)
  await $.tool.call({ tool: 'mcp__figma__get_file' } as never)
  await $.tool.call({ tool: 'mcp__recall__search' } as never)
  const items = tipIn(await drawn($), 'skills')?.top?.items ?? []
  expect(items).toEqual([{ name: 'figma', uses: '×2', icon: 'server' }])
})

test('the most-used lists stay capped: twelve kept a station, five listed, the newest never dropped', () => {
  let sat: Board['satellites']
  for (let i = 0; i < 5000; i++) sat = withSatellite(sat, i % 3 === 0 ? 'files' : 'skills', `name-${i % 1000}`, i % 7 === 0, NOW + i)
  expect(sat?.files?.length).toBe(12)
  expect(sat?.skills?.length).toBe(12)
  expect(stationTip({ entries: [], counts: {}, satellites: sat }, 'files', en).top?.items).toHaveLength(5)
  // A name already kept counts up, and the newest call is never the one dropped.
  const once = withSatellite(withSatellite(undefined, 'files', 'a.ts', false, 1), 'files', 'a.ts', true, 2)
  expect(once?.files).toEqual([{ name: 'a.ts', uses: 2, isEdited: true, lastAt: 2 }])
  let full: Board['satellites']
  for (let i = 0; i < 12; i++) full = withSatellite(full, 'files', `f${i}`, false, i)
  for (let i = 0; i < 12; i++) full = withSatellite(full, 'files', `f${i}`, false, 100 + i)
  expect(withSatellite(full, 'files', 'fresh', false, 500)?.files?.some(s => s.name === 'fresh')).toBe(true)
  // Nothing of them reaches the map's drawing.
  expect(drawMap({ entries: [], counts: { files: 5 }, satellites: sat }, NOW, setupFrom({ theme: 'dark' }))).not.toContain('data-satellite')
})
