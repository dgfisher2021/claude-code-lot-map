import { expect, test } from 'claude-code/testing'

import { feedLines, freshList, listKey, listLines, nextAgent } from '../renderer/window/lines.mjs'
import type { Feed, List } from '../renderer/window/lines.mjs'
import { route } from '../renderer/window/route.mjs'

const FEED: Feed = {
  now: 'Shell: Run the tests · context 10%',
  nowTone: 'plain',
  warnings: ['Shell: the same command failed 3 times'],
  plan: [{ line: '◐ Label the limit arcs · 16 calls · 30.0 s', tone: 'run', isBold: true }],
  changed: { line: '✎ 1 file changed: map.ts ×2', tone: 'plain' },
  pinned: [],
  rows: [{ line: '● Shell    Run the tests  running', tone: 'run' }],
  log: [
    { line: '✕ Shell    Run the tests  exit 1', tone: 'bad', station: 'shell' },
    { line: '· Files    map.ts', tone: 'ok', station: 'files' },
    { line: '⊘ Network  ↳ plan · curl example.com', tone: 'block', station: 'web', agentId: 'a2' },
    { line: '· Files    text.ts', tone: 'ok', station: 'files', agentId: 'a1' },
    { line: '20 older calls are gone', tone: 'ok' },
  ],
  agents: [
    { id: 'a1', name: 'explore' },
    { id: 'a2', name: 'plan' },
  ],
  stations: [
    { id: 'you', name: 'You' },
    { id: 'files', name: 'Files' },
  ],
  errorsWord: 'errors',
  legend: ['Ring: the context window.'],
  empty: 'Nothing yet.',
}

/** The list after these keys, in order. */
const pressed = (keys: string[], from: List = freshList()): List => keys.reduce((list, key) => listKey(list, key, FEED).list, from)

test('the map window server answers its own page and a live folder named as the session names it, and nothing else', () => {
  expect(route('/')).toEqual({ kind: 'file', file: 'index.html', type: 'text/html' })
  expect(route('/ui.css')).toEqual({ kind: 'file', file: 'ui.css', type: 'text/css' })
  expect(route('/health')).toEqual({ kind: 'health' })
  expect(route('/live/u5s931je/map.svg')).toEqual({ kind: 'live', name: 'u5s931je', file: 'map.svg' })
  expect(route('/live/u5s931je/feed.json')).toEqual({ kind: 'live', name: 'u5s931je', file: 'feed.json' })
  expect(route('/live/u5s931je/events')).toEqual({ kind: 'events', name: 'u5s931je', file: 'events' })
  expect(route('/live/u5s931je/about')).toEqual({ kind: 'about', name: 'u5s931je', file: 'about' })
  for (const path of [
    '/live/../etc/map.svg',
    '/live/U5S9/map.svg',
    '/live/u5s931je/alive',
    '/live/u5s931je/shown',
    '/etc/passwd',
    '/route.mjs',
    '/live//map.svg',
  ]) {
    expect(route(path)).toEqual({ kind: 'missing' })
  }
})

test('the list shows the live rows until a filter or a scroll asks for the log, and says what it filters', () => {
  expect(listLines(FEED, freshList(), 10).lines).toEqual(FEED.rows)
  const errors = listLines(FEED, pressed(['e']), 10).lines.map(l => l.line)
  expect(errors).toEqual(['[errors] 2', '✕ Shell    Run the tests  exit 1', '⊘ Network  ↳ plan · curl example.com', '20 older calls are gone'])
  // 2 is the second station in the map's order; 0 clears it.
  expect(listLines(FEED, pressed(['2']), 10).lines[0]?.line).toBe('[Files] 2')
  expect(listLines(FEED, pressed(['2', '0']), 10).lines).toEqual(FEED.rows)
  // Scrolled, the log shows unfolded; the scroll never passes its end.
  const scrolled = listLines(FEED, pressed(['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']), 3)
  expect(scrolled.list.logAt).toBe(2)
  expect(scrolled.lines.map(l => l.line)).toEqual(['⊘ Network  ↳ plan · curl example.com', '· Files    text.ts', '20 older calls are gone'])
})

test('a search takes every key while it is typed, q included, Enter keeps it and Escape clears it', () => {
  const typing = pressed(['/', 'q', 'u', 'x', 'Backspace'])
  expect(typing.isTyping).toBe(true)
  expect(typing.search).toBe('qu')
  expect(listKey(typing, 'q', FEED).took).toBe(true)
  const kept = pressed(['/', 't', 'e', 'x', 't', 'Enter'])
  expect(kept.isTyping).toBe(false)
  expect(listLines(FEED, kept, 10).lines.map(l => l.line)).toEqual(['[/text] 1', '· Files    text.ts', '20 older calls are gone'])
  expect(pressed(['Escape'], kept).search).toBe('')
  // A key the list does not know is left to the window, the list unchanged.
  const list = freshList()
  expect(listKey(list, 'm', FEED)).toEqual({ list, took: false })
})

test("a subagent's rows show alone under whose they are, then all again", () => {
  const first = nextAgent(freshList(), FEED)
  expect(listLines(FEED, pressed(['ArrowDown'], first), 10).lines.map(l => l.line)).toEqual(['a 1/2 · explore', '· Files    text.ts'])
  expect(nextAgent(nextAgent(first, FEED), FEED).watched).toBe(-1)
})

test('under the map: the top line in its tone, the warnings, the plan to wrap, the changed files, then the list or the legend', () => {
  const shown = feedLines(FEED, freshList(), 10, false).lines
  expect(shown[0]).toEqual({ line: 'Shell: Run the tests · context 10%', tone: 'plain', isNow: true })
  expect(shown[1]).toEqual({ line: 'Shell: the same command failed 3 times', tone: 'run' })
  expect(shown[2]?.isPlan).toBe(true)
  expect(shown.slice(3).map(l => l.isPlan === true)).toEqual([false, false])
  expect(shown.at(-1)).toEqual(FEED.rows?.[0])
  const legend = feedLines(FEED, freshList(), 10, true).lines
  expect(legend.map(l => l.line)).toEqual([FEED.now, FEED.warnings?.[0], 'Ring: the context window.'])
  expect(legend.at(-1)?.isLegend).toBe(true)
  // With nothing to list, the list says so.
  expect(feedLines({ ...FEED, rows: [] }, freshList(), 10, false).lines.at(-1)).toEqual({ line: 'Nothing yet.', tone: 'ok' })
})
