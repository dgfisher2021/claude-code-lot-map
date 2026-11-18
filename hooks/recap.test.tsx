import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'
import { recapLines } from './map'
import { stringsFor } from './text'

const NOW = 1_000_000
const t = stringsFor('en')

test('/workmap recap sums up the session', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOW - 125_000, context: { window: 200000, percent: 20 } } }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/p/a/b.ts', content: 'x' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/a/b.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/d.ts' } as never)
  await $.session.measure({ context: { percent: 64 }, rateLimits: [], cost: { usd: 1.234 }, changed: ['context'] } as never)
  await $.session.measure({ context: { percent: 30 }, rateLimits: [], cost: { usd: 1.234 }, changed: ['context'] } as never)
  const lines = String((await $.command.run({ command: 'workmap', args: 'recap' } as never)).text).split('\n')
  expect(lines.some(l => l.includes('2 min'))).toBe(true)
  expect(lines.some(l => l.includes('Files 3'))).toBe(true)
  expect(lines.some(l => l.includes('a/b.ts ×2'))).toBe(true)
  expect(lines.at(-1)).toContain('$1.23')
  expect(lines.at(-1)).toContain('64%')
})

test("the recap's refusals are the session's, not only those since the last message", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOW - 125_000, context: { window: 200000, percent: 20 } } }) as never)
  on('classic.PreToolUse', () => ({ deny: 'no' }))
  on('tool.call', () => ({ result: {}, isError: true }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Status' } as never)
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'again', turnId: 't2' } as never)
  expect(String((await $.command.run({ command: 'workmap', args: 'recap' } as never)).text)).toContain('refused')
})

test("a fresh session's recap says there is nothing yet", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200000 } } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'workmap', args: 'recap' } as never)).text).toBe(t.recapNothing)
  expect(recapLines({ entries: [], counts: {} }, undefined, NOW, t)).toEqual([])
})

test('the recap holds no labels but file names', () => {
  const board: Board = {
    entries: [],
    counts: { shell: 4, files: 9 },
    turns: [{ n: 3, startedAt: 0, calls: 13, errors: 1 }],
    faultTotals: { shell: 1 },
    changed: { 'src/a.ts': 3, 'b.ts': 1, 'c.ts': 2, 'd.ts': 1 },
    cost: 0.5,
    peakContext: 71,
  }
  const lines = recapLines(board, 0, 60_000, t, { files: 0.6 })
  expect(lines.find(l => l === t.recapCalls(`${t.stations.files} 9 (60%), ${t.stations.shell} 4`))).toBeDefined()
  expect(lines.find(l => l.includes('src/a.ts'))).toContain('src/a.ts ×3, c.ts ×2, d.ts')
  expect(lines.join('\n')).not.toContain('b.ts')
  expect(lines).toHaveLength(5)
})
