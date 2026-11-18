import { expect, mock, test } from 'claude-code/testing'

import { classify, localHostsIn, setupFrom } from './map'
import { stringsFor } from './text'

const NOW = 1_000_000
const en = stringsFor('en')

test('localHostsIn finds loopback addresses in a command and a URL, host and port only', () => {
  expect(localHostsIn({ command: 'curl -s http://127.0.0.1:4747/api?token=x && open http://localhost:5173/app' })).toEqual(['localhost:4747', 'localhost:5173'])
  expect(localHostsIn({ url: 'http://[::1]:8080/a' })).toEqual(['localhost:8080'])
  expect(localHostsIn({ url: 'http://0.0.0.0:3000' })).toEqual(['localhost:3000'])
  expect(localHostsIn({ command: 'curl http://localhost/health' })).toEqual(['localhost'])
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
  const live = /workmap-live-([a-z0-9]+)$/.exec(runs.find(argv => argv[0] === 'wt.exe')?.at(-1) ?? '')?.[1] ?? ''
  const feed = JSON.parse(written.filter(w => w.path === `/tmp/workmap-live-${live}/feed.json`).at(-1)?.text ?? '{}')
  expect(feed.local).toEqual({ title: en.localTitle, hosts: ['localhost:4747'] })
  // Only the address: nothing else of the command reaches the feed's local line.
  expect(JSON.stringify(feed.local)).not.toContain('api/sessions')
  await $.session.end({ reason: 'other' } as never)
})

test('a call that reaches only localhost lands on Browser; one that reaches anywhere else stays on Network', () => {
  const setup = setupFrom({})
  expect(classify('Bash', { command: 'curl -s http://localhost:5173/api' }, setup).station).toBe('browser')
  expect(classify('WebFetch', { url: 'http://127.0.0.1:4747/' }, setup).station).toBe('browser')
  expect(classify('Bash', { command: 'curl http://localhost:4747 && curl https://example.com' }, setup).station).toBe('web')
  expect(classify('Bash', { command: 'curl http://localhost.evil.com/x' }, setup).station).toBe('web')
  expect(classify('WebFetch', { url: 'https://example.com/' }, setup).station).toBe('web')
})
