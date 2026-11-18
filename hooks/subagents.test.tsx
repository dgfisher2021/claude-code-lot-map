import { expect, mock, test } from 'claude-code/testing'

import type { Board, Entry } from '../types'
import { agentList, drawMap, feedLines, setupFrom, stationTip } from './map'
import { stringsFor } from './text'

const PANE = {
  plugin: 'workmap',
  component: 'Pane',
  requestId: 'workmap',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOW = 1_000_000
const en = stringsFor('en')
const SETUP = setupFrom({ language: 'en' })

const call = (agentId: string, ago: number, status: Entry['status'] = 'ok'): Entry => ({
  id: `${agentId}${ago}`,
  station: 'files',
  label: 'x',
  from: 'agents',
  startedAt: NOW - ago,
  endedAt: NOW - ago + 10,
  status,
  agentId,
})

/** The dots circling the Agents station: one per subagent at work. */
const dots = (svg: string): number => (svg.match(/<circle cx="[\d.]+" cy="[\d.]+" r="3" fill="#[0-9a-f]{6}"\/><\/g>/g) ?? []).length

test('each subagent at work is one plain dot at Agents, its name and time at work in the station’s tooltip', () => {
  const board: Board = {
    entries: [call('a1', 90_000), call('a1', 5000)],
    counts: {},
    agents: ['a1', 'a2'],
    agentNames: { a1: 'explore auth and more', a2: 'tests' },
  }
  const svg = drawMap(board, NOW, SETUP)
  expect(dots(svg)).toBe(2)
  // No names nor clock arcs beside the station.
  expect(svg).not.toMatch(/font-size="7"[^>]*>explore/)
  expect(stationTip(board, 'agents', en, 0, undefined, NOW).top).toEqual({
    title: en.tip.working,
    items: [
      { name: 'explore auth and more', uses: expect.stringContaining('1 min'), icon: 'clock' },
      { name: 'tests', uses: '', icon: 'clock' },
    ],
  })
})

test('a call failing inside a subagent leaves its dot as it was: the call counts at its own station', () => {
  const board: Board = { entries: [call('a1', 2000, 'err')], counts: { files: 1 }, faults: { files: 1 }, agents: ['a1'] }
  const svg = drawMap(board, NOW, SETUP)
  expect(svg).not.toMatch(/r="3" fill="#e8654f"/)
  expect(dots(svg)).toBe(1)
})

test("a workflow's agents are dots like any other, with no cluster", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku-5-5', agentId: (e as { description: string }).description }) as never)
  on('tool.call', () => new Promise(() => {}))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  void $.tool.call({ tool: 'Workflow', script: 'x' } as never)
  for (const id of ['w1', 'w2', 'w3']) {
    await $.agent.spawn({ prompt: 'x', description: id, subagentType: 'Explore' } as never)
    void $.tool.call({ tool: 'Read', file_path: '/a/b/x.py', agentId: id } as never)
  }
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).not.toMatch(/>\d+\/\d+</)
  await ui.unmount()
})

test('the window learns each subagent: its id and name', () => {
  const board: Board = { entries: [call('a1', 10)], counts: {}, agents: ['a1', 'a3'], agentNames: { a1: 'explore', a2: 'old one' } }
  expect(agentList(board)).toEqual([
    { id: 'a1', name: 'explore' },
    { id: 'a2', name: 'old one' },
    { id: 'a3', name: 'a3' },
  ])
  // Each row of a subagent's carries its id, for the window to filter by.
  const rows = feedLines([call('a1', 10)], en, { a1: 'explore' })
  expect(rows[0]).toMatchObject({ agentId: 'a1' })
})
