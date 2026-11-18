// A local preview of the map: the real drawing code in a browser, fed by a made-up session or a live one.
// Run: node dev/preview/server.mjs  (then open http://localhost:4747)

import { createServer } from 'node:http'
import { appendFile, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(HERE, '../..')
const PORT = Number(process.env.PREVIEW_PORT ?? 4747)
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}
/** The map window's own page parts, which the preview shares: its lines and its tooltips. */
const WINDOW = join(ROOT, 'renderer/window')

/** Types stripped, and extensionless relative imports pointed at their `.ts` file, so the browser can load the module. */
async function moduleOf(file) {
  const source = await readFile(file, 'utf8')
  const js = stripTypeScriptTypes(source, { mode: 'strip' })
  return js.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (all, a, path, b) => (extname(path) === '' ? `${a}${path}.ts${b}` : all))
}

/** Where sessions keep their status files, as the mod writes them. */
function statusDir() {
  const xdg = process.env.XDG_RUNTIME_DIR
  return xdg ? join(xdg, 'workmap-sessions') : join(homedir(), '.cache/workmap/sessions')
}

/** Sessions with a live folder: only folders the mod made under the temporary directory are served. */
async function sessions() {
  const dir = statusDir()
  const names = await readdir(dir).catch(() => [])
  const found = []
  for (const name of names.filter(n => n.endsWith('.json'))) {
    const status = JSON.parse(await readFile(join(dir, name), 'utf8').catch(() => '{}'))
    const live = typeof status.live === 'string' ? normalize(status.live) : ''
    if (!live.startsWith(join(tmpdir(), 'workmap-live-'))) continue
    if (!(await stat(join(live, 'map.svg')).catch(() => undefined))) continue
    found.push({ id: name.slice(0, -5), name: status.name, word: status.word, context: status.context, live })
  }
  return found
}

/** Notes pinned on the map, one JSON object a line, for Claude to read. */
const NOTES = join(ROOT, 'claude/preview-notes.jsonl')

async function notes() {
  const text = await readFile(NOTES, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

async function bodyOf(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 20_000) throw new Error('note too long')
  }
  return JSON.parse(body)
}

const clients = new Set()

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = decodeURIComponent(url.pathname)
  try {
    if (path === '/favicon.ico') return send(res, 204, 'text/plain', '')
    if (path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write('retry: 1000\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (path === '/api/sessions') return send(res, 200, TYPES['.json'], JSON.stringify(await sessions()))
    if (path === '/api/notes' && req.method === 'GET') return send(res, 200, TYPES['.json'], JSON.stringify(await notes()))
    if (path === '/api/notes' && req.method === 'POST') {
      const { text, x, y, target, scene, options } = await bodyOf(req)
      const note = { at: new Date().toISOString(), text: String(text).slice(0, 2000), x, y, target, scene, options }
      await appendFile(NOTES, `${JSON.stringify(note)}\n`)
      return send(res, 200, TYPES['.json'], JSON.stringify(note))
    }
    if (path === '/api/notes/clear' && req.method === 'POST') {
      await writeFile(NOTES, '')
      return send(res, 200, TYPES['.json'], '[]')
    }
    const live = /^\/api\/live\/([0-9a-f-]{36})\/(map\.svg|feed\.json)$/.exec(path)
    if (live) {
      const session = (await sessions()).find(s => s.id === live[1])
      if (!session) return send(res, 404, 'text/plain', 'no such session')
      return send(res, 200, TYPES[extname(live[2])], await readFile(join(session.live, live[2]), 'utf8'))
    }
    if (path.startsWith('/src/')) {
      const file = normalize(join(ROOT, path.slice(5)))
      if (!file.startsWith(join(ROOT, 'hooks')) || extname(file) !== '.ts') return send(res, 404, 'text/plain', 'not found')
      try {
        return send(res, 200, TYPES['.js'], await moduleOf(file))
      } catch (error) {
        // The page shows why the drawing code failed to load.
        return send(res, 200, TYPES['.js'], `throw new Error(${JSON.stringify(`${path}: ${error.message}`)})`)
      }
    }
    const [base, rel] = path.startsWith('/window/') ? [WINDOW, path.slice(8)] : [HERE, path === '/' ? 'index.html' : path]
    const file = normalize(join(base, rel))
    if (!file.startsWith(base) || !TYPES[extname(file)]) return send(res, 404, 'text/plain', 'not found')
    const body = await readFile(file).catch(() => undefined)
    return body === undefined ? send(res, 404, 'text/plain', 'not found') : send(res, 200, TYPES[extname(file)], body)
  } catch (error) {
    send(res, 500, 'text/plain', error.message)
  }
})

// A save in the drawing code or the preview reloads every open page.
let pending
for (const dir of [join(ROOT, 'hooks'), HERE, WINDOW]) {
  watch(dir, () => {
    clearTimeout(pending)
    pending = setTimeout(() => clients.forEach(c => c.write('data: reload\n\n')), 150)
  })
}

server.listen(PORT, '127.0.0.1', () => console.log(`workmap preview: http://localhost:${PORT}`))
