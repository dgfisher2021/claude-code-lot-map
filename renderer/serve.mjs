#!/usr/bin/env node
// The map window's server, for a session from WSL: each session's live map (map.svg, feed.json) as a page an Edge app
// window shows, a window that can be dragged, resized and moved to another screen like any other. One server, on a
// fixed port of this machine's loopback, serves every session; it ends a minute after the last one's heartbeat stops.
//
// Usage: node serve.mjs                 run the server
//        node serve.mjs --open <live>   start one unless one answers, open Edge on the session whose live folder is
//                                       workmap-live-<live>, and print the port; exit 1 when it cannot

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, watch } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { isLiveName, route } from './window/route.mjs'

export const PORT = Number(process.env.WORKMAP_PORT) || 47470
const HERE = fileURLToPath(new URL('.', import.meta.url))
/** The session is gone when its heartbeat is this old, as view.mjs reads it. */
const STALE_MS = 15_000
/** The server ends when no session has lived for this long. */
const IDLE_MS = 60_000
/** A page connected marks its session's window shown this often; the session counts it open for six seconds. */
const SHOWN_MS = 2000

/** A live folder from the name after `workmap-live-`, as the session makes it. */
const liveOf = name => (isLiveName(name) ? join(tmpdir(), `workmap-live-${name}`) : undefined)

/** The folder where sessions keep their status files, as the mod writes them. */
const statusDir = () => (process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, 'workmap-sessions') : join(homedir(), '.cache/workmap/sessions'))

/** The name of the session's folder, from its status file, for the window's title. */
async function nameOf(dir) {
  for (const file of await readdir(statusDir()).catch(() => [])) {
    const status = JSON.parse(await readFile(join(statusDir(), file), 'utf8').catch(() => '{}'))
    if (status.live === dir && typeof status.name === 'string') return status.name
  }
  return ''
}

/** Whether a session's heartbeat is fresh. */
const lives = async dir => {
  const beat = await stat(join(dir, 'alive')).catch(() => undefined)
  return beat !== undefined && Date.now() - beat.mtimeMs < STALE_MS
}

function serve() {
  let pages = 0
  let busyAt = Date.now()
  const server = createServer(async (req, res) => {
    const to = route(new URL(req.url ?? '/', 'http://localhost').pathname)
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
      res.end(body)
    }
    try {
      if (to.kind === 'health') return send(200, 'text/plain', 'workmap')
      if (to.kind === 'empty') return send(204, 'text/plain', '')
      if (to.kind === 'file') return send(200, to.type, await readFile(join(HERE, 'window', to.file)))
      if (to.kind === 'missing') return send(404, 'text/plain', 'not found')
      const dir = liveOf(to.name)
      if (to.kind === 'about') return send(200, 'application/json', JSON.stringify({ name: await nameOf(dir) }))
      if (to.kind === 'live') {
        const body = await readFile(join(dir, to.file), 'utf8').catch(() => undefined)
        return body === undefined ? send(404, 'text/plain', 'no live map') : send(200, to.file.endsWith('.svg') ? 'image/svg+xml' : 'application/json', body)
      }
      // Events: what changed in the live folder, so the page fetches only then; `gone` when the session has ended.
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      const say = what => res.write(`data: ${what}\n\n`)
      pages += 1
      say('map')
      say('feed')
      const pending = new Map()
      let watcher
      try {
        watcher = watch(dir, (_, file) => {
          if (file !== 'map.svg' && file !== 'feed.json') return
          clearTimeout(pending.get(file))
          pending.set(
            file,
            setTimeout(() => say(file === 'map.svg' ? 'map' : 'feed'), 40),
          )
        })
      } catch {
        say('gone')
      }
      const mark = async () => {
        await writeFile(join(dir, 'shown'), String(Date.now())).catch(() => {})
        if (!(await lives(dir))) say('gone')
      }
      void mark()
      const beat = setInterval(mark, SHOWN_MS)
      req.on('close', () => {
        pages -= 1
        clearInterval(beat)
        watcher?.close()
        pending.forEach(clearTimeout)
      })
    } catch (error) {
      send(500, 'text/plain', error.message)
    }
  })
  // Another server already holds the port: it serves every session, so this one has nothing to do.
  server.on('error', () => process.exit(0))
  server.listen(PORT, '127.0.0.1')
  // It ends once no page is open and no session has lived for a minute.
  setInterval(async () => {
    const names = (await readdir(tmpdir()).catch(() => [])).filter(n => n.startsWith('workmap-live-'))
    const anyLive = (await Promise.all(names.map(n => lives(join(tmpdir(), n))))).some(Boolean)
    if (pages > 0 || anyLive) busyAt = Date.now()
    else if (Date.now() - busyAt > IDLE_MS) process.exit(0)
  }, 10_000)
}

/** Whether the server answers on its port. */
async function answers() {
  try {
    const reply = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(800) })
    return (await reply.text()) === 'workmap'
  } catch {
    return false
  }
}

/** An install's version, from the plugin.json beside the renderer folder its serve.mjs is in; 0.0.0 when unreadable. */
function versionAt(script) {
  try {
    return JSON.parse(readFileSync(join(script, '../../.claude-plugin/plugin.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Whether version `a` is older than `b`, part by part. */
const isOlder = (a, b) => {
  const [x, y] = [a, b].map(v => String(v).split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0)
  return false
}

/**
 * The server an older workmap install of yours started on this port, by its process id from /proc: windows would get
 * that version's page. Only your own processes can be read there, and on a system without /proc nothing is found.
 */
function olderServer() {
  const own = fileURLToPath(import.meta.url)
  for (const pid of existsSync('/proc') ? readdirSync('/proc').filter(n => /^\d+$/.test(n)) : []) {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
      const script = argv.find(a => a.endsWith('/renderer/serve.mjs'))
      if (script === undefined || script === own || argv.includes('--open') || !isOlder(versionAt(script), versionAt(own))) continue
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
      if ((Number(env.find(v => v.startsWith('WORKMAP_PORT='))?.slice(13)) || 47470) === PORT) return Number(pid)
    } catch {}
  }
  return undefined
}

/**
 * Starts the server unless one answers; whether one answers then. One an older install started is stopped first, so
 * that an update reaches the windows: their pages reconnect to this one. The Sixel window (view.mjs) starts it too.
 */
export async function ensureServer() {
  if (await answers()) {
    const older = olderServer()
    if (older === undefined) return true
    try {
      process.kill(older)
    } catch {}
    for (let i = 0; i < 20 && (await answers()); i++) await new Promise(r => setTimeout(r, 100))
  }
  spawn(process.execPath, [fileURLToPath(import.meta.url)], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 40 && !(await answers()); i++) await new Promise(r => setTimeout(r, 100))
  return answers()
}

/**
 * Starts the server unless one answers, then opens Edge on the session's page: an app window of its own profile, so
 * that Edge keeps its size and place; one address for every session, so that each window opens where the last was.
 */
async function open(name) {
  if (liveOf(name) === undefined) return false
  if (!(await ensureServer())) return false
  const edge = spawnSync(
    'cmd.exe',
    [
      '/c',
      'start',
      '',
      'msedge',
      '--user-data-dir=%LOCALAPPDATA%\\workmap\\edge',
      '--no-first-run',
      '--no-default-browser-check',
      `--app=http://localhost:${PORT}/?live=${name}`,
      '--window-size=600,960',
    ],
    // cmd.exe starts in a Windows folder: in a WSL one it says so on stderr.
    { cwd: existsSync('/mnt/c') ? '/mnt/c' : undefined, stdio: 'ignore', timeout: 15_000 },
  )
  return edge.status === 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv[2] === '--open') {
    const isOpen = await open(process.argv[3])
    if (isOpen) console.log(PORT)
    process.exit(isOpen ? 0 : 1)
  }
  serve()
}
