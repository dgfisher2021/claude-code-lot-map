import { expect, mock, test } from 'claude-code/testing'

import type { Entry } from '../types'
import { STATIONS, logLines } from './map'
import { stringsFor } from './text'

const NOW = 1_000_000
const en = stringsFor('en')
const call = (n: number, more: Partial<Entry> = {}): Entry => ({
  id: `e${n}`,
  station: 'files',
  label: `f${n}.ts`,
  from: 'core',
  startedAt: NOW + n,
  endedAt: NOW + n + 10,
  status: 'ok',
  ...more,
})

function fakeHost(on: Parameters<typeof mock.clock>[0]): string[][] {
  const runs: string[][] = []
  on('session.end', () => ({ sessionId: 'test' }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const script = e.argv[0] === 'sh' ? (e.argv[2] ?? '') : ''
    const stdout = script.includes('node') ? '/usr/bin/node\n' : script.includes('chromium') ? '/home/u/.local/bin/chromium\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return runs
}

test('logLines: every entry newest first and unfolded, a closing line only when older calls are gone', () => {
  const entries = [call(1), call(2), call(3)]
  const whole = logLines(entries, en)
  expect(whole.map(l => l.line.slice(2))).toEqual(['Files    f3.ts  10 ms', 'Files    f2.ts  10 ms', 'Files    f1.ts  10 ms'])
  expect(whole.map(l => l.station)).toEqual(['files', 'files', 'files'])
  const cut = logLines(entries, en, {}, 10)
  expect(cut.length).toBe(4)
  expect(cut[3]).toEqual({ line: en.logGone(3, 10), tone: 'plain' })
  // A switch of model is no counted call.
  const marked = [call(1, { station: 'model', mark: 'switch' }), call(2)]
  expect(logLines(marked, en, {}, 1).length).toBe(2)
})

test('/workmap log lists every kept call and says when older ones are gone', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('skill.prompt', (_, e) => ({ text: e.text }) as never)
  expect((await $.command.run({ command: 'workmap', args: 'log' } as never)).text).toBe(en.nothingYet)
  for (let i = 1; i <= 90; i++) await $.skill.prompt({ skill: `s${i}`, text: '' } as never)
  const lines = String((await $.command.run({ command: 'workmap', args: 'log' } as never)).text).split('\n')
  // The board keeps 80: the log shows those, newest first, and says the rest are gone.
  expect(lines.length).toBe(81)
  expect(lines[0]).toContain('s90')
  expect(lines[79]).toContain('s11')
  expect(lines.join('\n')).not.toContain('s10')
  expect(lines[80]).toBe(en.logGone(80, 90))
})

test('feed.json carries the log and the station names', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { WSL_DISTRO_NAME: 'Ubuntu', TMPDIR: '/tmp' })
  on('tool.call', () => ({ result: {} }))
  const runs = fakeHost(on)
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/one.py' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
  await $.command.run({ command: 'workmap', args: 'window' } as never)
  const dir = runs.find(argv => argv[0] === 'wt.exe')?.at(-1) ?? ''
  const feed = JSON.parse(written.filter(w => w.path === `${dir}/feed.json`).at(-1)?.text ?? '{}')
  expect(feed.log.map((l: { line: string }) => l.line)).toEqual([expect.stringContaining('Run the tests'), expect.stringContaining('b/one.py')])
  expect(feed.log[0].station).toBe('shell')
  expect(feed.stations).toEqual(STATIONS.map(s => ({ id: s.id, name: en.stations[s.id] })))
  expect(feed.keys).toBe(en.windowKeys)
  expect(feed.errorsWord).toBe(en.logErrors)
  await $.session.end({ reason: 'other' } as never)
})

test('the command hints at log', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, {})
  const hints: string[] = []
  on('command.register', (_, e) => {
    hints.push(String((e as { argumentHint?: string }).argumentHint))
    return { value: { command: 'x' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.write', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(hints).toHaveLength(1)
  expect(hints[0]).toContain('log')
})
