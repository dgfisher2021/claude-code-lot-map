import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'

const NOW = 1_000_000

const keepBoard = (on: (event: 'state.set', hook: never) => void) => {
  const kept: { board: Board } = { board: { entries: [], counts: {} } }
  on(
    'state.set',
    ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept.board = e.value?.value ?? kept.board), next(e))) as never,
  )
  return kept
}

test("a background agent's call, closed by its turn.complete, adds its time to its station", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = keepBoard(on as never)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => new Promise(() => {}))
  void $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts', agentId: 'a1' } as never)
  await clock.settle()
  await clock.advance(700)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' } as never)
  expect(kept.board.busyMs?.files).toBe(700)
})

test("an interrupted turn closes the main loop's running calls and adds their time", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kept = keepBoard(on as never)
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => new Promise(() => {}))
  void $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts' } as never)
  await clock.settle()
  await clock.advance(400)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)
  expect(kept.board.entries.find(e => e.station === 'files')?.endedAt).toBe(NOW + 400)
  expect(kept.board.busyMs?.files).toBe(400)
})
