import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'
import { localHostsIn, stationTip, withLocal } from './map'
import { stringsFor } from './text'

const NOW = 1_000_000
const en = stringsFor('en')

test('localHostsIn finds loopback addresses in a command and a URL, host and port only', () => {
  expect(localHostsIn({ command: 'curl -s http://127.0.0.1:4747/api?token=x && open http://localhost:5173/app' })).toEqual(['localhost:4747', 'localhost:5173'])
  expect(localHostsIn({ url: 'http://[::1]:8080/a' })).toEqual(['localhost:8080'])
  expect(localHostsIn({ url: 'http://0.0.0.0:3000' })).toEqual(['localhost:3000'])
  expect(localHostsIn({ command: 'curl http://localhost/health' })).toEqual(['localhost'])
})

test('localHostsIn leaves other hosts, look-alikes and repeats out', () => {
  expect(localHostsIn({ command: 'curl https://example.com:443 http://localhost.evil.com:80 http://localhost:4747 http://localhost:4747/b' })).toEqual([
    'localhost:4747',
  ])
  expect(localHostsIn({ command: 'npm run dev', description: 'http://localhost:9999' })).toEqual([])
})

test('withLocal keeps the newest six, a server used again moving to the front', () => {
  let local: Board['local'] = undefined
  for (let n = 1; n <= 7; n++) local = withLocal(local, [`localhost:${3000 + n}`], NOW + n)
  expect(local?.map(l => l.host)).toEqual(['localhost:3007', 'localhost:3006', 'localhost:3005', 'localhost:3004', 'localhost:3003', 'localhost:3002'])
  local = withLocal(local, ['localhost:3004'], NOW + 9)
  expect(local?.[0]).toEqual({ host: 'localhost:3004', lastAt: NOW + 9 })
  expect(local).toHaveLength(6)
  expect(withLocal(local, [], NOW + 10)).toBe(local)
})

test("Browser's tooltip lists the local servers Claude's calls used", () => {
  const board: Board = { entries: [], counts: {}, local: [{ host: 'localhost:4747', lastAt: NOW }] }
  expect(stationTip(board, 'browser', en).top).toEqual({ title: en.tip.local, items: [{ name: 'localhost:4747', uses: '', icon: 'server' }] })
  expect(stationTip(board, 'web', en).top).toBeUndefined()
})

test('a call that names a localhost address puts it in the window’s feed', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { WSL_DISTRO_NAME: 'Ubuntu', TMPDIR: '/tmp' })
  on('tool.call', () => ({ result: {} }))
  const runs: string[][] = []
  on('session.end', () => ({ sessionId: 'test' }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const script = e.argv[0] === 'sh' ? (e.argv[2] ?? '') : ''
    const stdout = script.includes('node') ? '/usr/bin/node\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await $.tool.call({ tool: 'Bash', command: 'curl -s http://localhost:4747/api/sessions', description: 'Ask the preview' })
  await $.command.run({ command: 'workmap', args: 'window' } as never)
  const live = runs.find(argv => argv[1]?.endsWith('/renderer/serve.mjs'))?.[3] ?? ''
  const feed = JSON.parse(written.filter(w => w.path === `/tmp/workmap-live-${live}/feed.json`).at(-1)?.text ?? '{}')
  expect(feed.local).toEqual({ title: en.localTitle, hosts: ['localhost:4747'] })
  // Only the address: nothing else of the command reaches the feed's local line.
  expect(JSON.stringify(feed.local)).not.toContain('api/sessions')
  await $.session.end({ reason: 'other' } as never)
})
