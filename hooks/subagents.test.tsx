import { expect, mock, test } from 'claude-code/testing'

import type { Board, Entry } from '../types'
import { agentList, drawMap, feedLines, setupFrom } from './map'
import { stringsFor } from './text'

const PANE = {
  plugin: 'workmap',
  component: 'Pane',
  requestId: 'workmap',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const NOW = 1_000_000
const STRANGER = setupFrom({ language: 'en', coreName: 'CLAUDE', memoryServers: ['memory'], hookRecords: false })
const STILL = setupFrom({ language: 'en', coreName: 'CLAUDE', motion: 'reduced' })
const BOTTOM = setupFrom({ language: 'en', coreName: 'CLAUDE', layout: 'you-bottom' })

const call = (agentId: string, ago: number): Entry => ({
  id: `${agentId}${ago}`,
  station: 'files',
  label: 'x',
  from: 'agents',
  startedAt: NOW - ago,
  endedAt: NOW - ago + 10,
  status: 'ok',
  agentId,
})

test("a subagent's dot carries its name and its clock", () => {
  const board: Board = {
    entries: [call('a1', 90_000), call('a1', 5000)],
    counts: {},
    agents: ['a1', 'a2'],
    agentNames: { a1: 'explore auth and more', a2: 'tests' },
    agentFaults: ['a2'],
  }
  const svg = drawMap(board, NOW, STRANGER)
  // Its name, cut to ten characters, at size 7.
  expect(svg).toMatch(/font-size="7"[^>]*>explore au</)
  expect(svg).toMatch(/font-size="7"[^>]*>tests</)
  // Its clock: a lap a minute, 90 s in, so 30 s round.
  expect(svg).toContain('begin="-30.000s" dur="60.000s" repeatCount="indefinite"')
  // A failed one stays red.
  expect(svg).toMatch(/<circle [^>]*r="1.6" fill="#e8654f"\/>/)

  // Standing still the arc is drawn, stepped as the hands are, and moves by nothing.
  const still = drawMap(board, NOW, STILL)
  expect(still).toMatch(/font-size="7"[^>]*>explore au</)
  expect(still).not.toContain('<animate')
  expect(still).toContain('stroke-dashoffset="0.5"')
  const later = drawMap(board, NOW + 4000, STILL)
  expect(later).toContain('stroke-dashoffset="0.5"')
})

test('at most six subagents are labelled, the rest are dots only', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const board: Board = { entries: [], counts: {}, agents: ids, agentNames: Object.fromEntries(ids.map(id => [id, `job ${id}`])) }
  const svg = drawMap(board, NOW, STRANGER)
  expect(svg.split('font-size="7"').length - 1).toBe(6)
  expect(svg.split('<animateTransform').length - 1).toBe(8)
})

test('a subagent with no name has a dot and no label', () => {
  const svg = drawMap({ entries: [], counts: {}, agents: ['w7'] }, NOW, STRANGER)
  expect(svg).not.toContain('font-size="7"')
  expect(svg.split('<animateTransform').length - 1).toBe(1)
})

test("a workflow's agents draw as one cluster with progress", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let n = 0
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `w${++n}` }) as never)
  on('tool.call', async (_, e) => {
    if (e.tool === 'Workflow') await gate
    return { result: {} } as never
  })
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The agents spawn while the Workflow call is still running.
  const running = $.tool.call({ tool: 'Workflow', name: 'build' } as never)
  await clock.settle()
  for (let i = 0; i < 3; i++) await $.agent.spawn({ prompt: 'x', description: `step ${i}`, subagentType: 'Explore' } as never)
  release()
  await running
  for (const id of ['w1', 'w2', 'w3']) await $.tool.call({ tool: 'Read', file_path: '/a/b/x.py', agentId: id } as never)
  let svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toMatch(/font-size="7"[^>]*>0\/3</)
  // One dot for the run, not three.
  expect(svg.split('<animateTransform').length - 1).toBe(1)
  expect(svg).not.toContain('>step 0<')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'w1' } as never)
  svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toMatch(/>1\/3</)
  await ui.unmount()
})

test('a subagent spawned outside a workflow keeps its own dot and label', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.agent.spawn({ prompt: 'x', description: 'explore auth', subagentType: 'Explore', parentAgentId: 'p1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/x.py', agentId: 'a1' } as never)
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(svg).toMatch(/font-size="7"[^>]*>explore au</)
  expect(svg).not.toMatch(/>\d+\/\d+</)
  await ui.unmount()
})

const box = (m: RegExpMatchArray) => {
  const [, x, y, anchor, size, text = ''] = m
  const w = Array.from(text.replace(/<[^>]+>/g, '')).length * 0.6 * Number(size)
  const left = anchor === 'middle' ? Number(x) - w / 2 : Number(x)
  return { left, right: left + w, top: Number(y) - Number(size), bottom: Number(y) + Number(size) * 0.25 }
}

test("subagent labels keep clear of the Agents station's name", () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const board: Board = {
    entries: [],
    counts: { agents: 40, files: 9, browser: 3, skills: 5, hooks: 4, web: 2 },
    agents: ids,
    agentNames: Object.fromEntries(ids.map(id => [id, 'a long name x'])),
  }
  for (const setup of [STRANGER, BOTTOM]) {
    const svg = drawMap(board, NOW, setup)
    const texts = [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*?text-anchor="(\w+)"[^>]*?font-size="([\d.]+)"[^>]*>(.*?)<\/text>/g)].map(m => ({
      size: m[4],
      b: box(m),
    }))
    const labels = texts.filter(t => t.size === '7')
    expect(labels).toHaveLength(6)
    for (const l of labels) {
      expect(l.b.left).toBeGreaterThan(0)
      expect(l.b.right).toBeLessThan(460)
      expect(l.b.bottom).toBeLessThan(430)
      expect(l.b.top).toBeGreaterThan(0)
      for (const o of texts.filter(t => t.size !== '7' && t.size !== '8' && t.size !== '9'))
        expect(l.b.right <= o.b.left || o.b.right <= l.b.left || l.b.bottom <= o.b.top || o.b.bottom <= l.b.top).toBe(true)
    }
  }
})

test('the window learns each subagent: its id and name', () => {
  const t = stringsFor('en')
  const board: Board = { entries: [call('a1', 10)], counts: {}, agents: ['a1', 'a3'], agentNames: { a1: 'explore', a2: 'old one' } }
  expect(agentList(board)).toEqual([
    { id: 'a1', name: 'explore' },
    { id: 'a2', name: 'old one' },
    { id: 'a3', name: 'a3' },
  ])
  // Each row of a subagent's carries its id, for the window to filter by.
  const rows = feedLines([call('a1', 10)], t, { a1: 'explore' })
  expect(rows[0]).toMatchObject({ agentId: 'a1' })
})
