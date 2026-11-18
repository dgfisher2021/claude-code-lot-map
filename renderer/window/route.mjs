// What the map window's server (serve.mjs) answers, by path. Pure, so that tests can call it.

/** The page's own files, by the path the page asks for. */
const FILES = {
  '/': ['index.html', 'text/html'],
  '/window.js': ['window.js', 'text/javascript'],
  '/ui.js': ['ui.js', 'text/javascript'],
  '/ui.css': ['ui.css', 'text/css'],
  '/lines.mjs': ['lines.mjs', 'text/javascript'],
}

/** A live folder's name after `workmap-live-`, as the session makes it: letters and digits, nothing else. */
export const isLiveName = name => /^[a-z0-9]{1,32}$/.test(String(name))

/**
 * What a path asks for: the health check, the lines' kept height, a file of the page, a session's map, feed, events or
 * name; else nothing.
 */
export function route(path) {
  if (path === '/health') return { kind: 'health' }
  if (path === '/favicon.ico') return { kind: 'empty' }
  if (path === '/split') return { kind: 'split' }
  const file = FILES[path]
  if (file) return { kind: 'file', file: file[0], type: file[1] }
  const live = /^\/live\/([^/]+)\/(map\.svg|feed\.json|events|about)$/.exec(path)
  if (live && isLiveName(live[1])) return { kind: live[2] === 'events' || live[2] === 'about' ? live[2] : 'live', name: live[1], file: live[2] }
  return { kind: 'missing' }
}
