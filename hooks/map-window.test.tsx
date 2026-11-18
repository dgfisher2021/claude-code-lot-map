import { expect, test } from 'claude-code/testing'

import { freshList, listKey } from '../renderer/window/lines.mjs'
import type { Feed, List } from '../renderer/window/lines.mjs'
import { route } from '../renderer/window/route.mjs'

test('the map window server answers its own page and a live folder named as the session names it, and nothing else', () => {
  expect(route('/')).toEqual({ kind: 'file', file: 'index.html', type: 'text/html' })
  expect(route('/ui.css')).toEqual({ kind: 'file', file: 'ui.css', type: 'text/css' })
  expect(route('/health')).toEqual({ kind: 'health' })
  expect(route('/split')).toEqual({ kind: 'split' })
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
