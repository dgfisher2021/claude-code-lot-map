import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, Entry, StationId, Status } from '../types'
import {
  STATIONS,
  classify,
  clean,
  describeNow,
  drawMap,
  feedLines,
  firstLine,
  framedMap,
  memoryIds,
  PLAN_TOOLS,
  pinnedLines,
  planAfter,
  planLines,
  setupFrom,
  shortModel,
  taskNotice,
  taskOf,
} from './map'
import type { Setup } from './map'
import { MAP_COLUMNS, MAP_MIN_COLUMNS, MAP_ROWS, PICTURE_CELL, mapSize, paceOf, paintMap } from './raster'

const PANE = 'lot-map'
/** The terminal map's Raster or Image, by the key a repaint names it with. */
const MAP = 'map'
const KEEP = 80
const CREW = 12

// Change the tag when a field of Entry or Board changes: it declines what an earlier version stored.
const board = atom({ plugin: 'lot-map', key: 'board' } as const, { entries: [], counts: {} } as Board, { shape: 'board-3' })

const newId = (now: number): string => `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Whatever goes wrong on the map must never reach the tool, the turn or the conversation. */
async function quietly<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

type Start = {
  station: StationId
  label: string
  from?: Entry['from']
  status?: Status
  agentId?: string
  mark?: Entry['mark']
  waits?: true
  /** Adds nothing to the station's count: a second view of something already counted. */
  uncounted?: boolean
  startedAt?: number
  endedAt?: number
  patch?: Partial<Pick<Board, 'model' | 'step' | 'switchedAt' | 'phase'>>
}

/** The newest rows, and beside them every background task still going, however long ago it started. */
const kept = (entries: Entry[]): Entry[] => {
  const from = entries.length - KEEP
  return from <= 0 ? entries : entries.filter((e, i) => i >= from || (e.status === 'run' && e.task !== undefined))
}

const oneMore = (counts: Board['faults'], station: StationId): Board['faults'] => ({ ...counts, [station]: (counts?.[station] ?? 0) + 1 })

/**
 * A call that ended badly counts on its station, an error with the faults and a refusal with the blocks, and marks the
 * subagent that made it.
 */
function tally(b: Board, station: StationId, status: Status, agentId?: string): Pick<Board, 'faults' | 'blocks' | 'agentFaults'> {
  if (status !== 'err' && status !== 'block') return {}
  const agentFaults = agentId === undefined || (b.agentFaults ?? []).includes(agentId) ? {} : { agentFaults: [...(b.agentFaults ?? []), agentId].slice(-12) }
  return { ...(status === 'err' ? { faults: oneMore(b.faults, station) } : { blocks: oneMore(b.blocks, station) }), ...agentFaults }
}

async function begin($: EngineInterface, start: Start): Promise<string | undefined> {
  return quietly(async () => {
    const now = await $.clock.now()
    const entry: Entry = {
      id: newId(now),
      station: start.station,
      label: clean(start.label),
      from: start.from ?? 'core',
      startedAt: start.startedAt ?? now,
      status: start.status ?? 'run',
      ...(start.status !== undefined ? { endedAt: start.endedAt ?? now } : {}),
      ...(start.agentId !== undefined ? { agentId: start.agentId } : {}),
      ...(start.mark !== undefined ? { mark: start.mark } : {}),
      ...(start.waits === true ? { waits: true as const } : {}),
    }
    await update($, board, b => ({
      ...b,
      ...start.patch,
      entries: kept([...b.entries, entry]),
      counts: start.uncounted ? b.counts : { ...b.counts, [entry.station]: (b.counts[entry.station] ?? 0) + 1 },
      // What a hook brought to memory unasked is counted apart from what was asked for.
      ...(entry.station === 'memory' && entry.from === 'inbound' && !start.uncounted ? { pushed: (b.pushed ?? 0) + 1 } : {}),
      // An interrupted turn lands on the person's own station and is no fault of anything.
      ...(entry.station !== 'you' ? tally(b, entry.station, entry.status, entry.agentId) : {}),
      ...(entry.agentId !== undefined && !(b.agents ?? []).includes(entry.agentId)
        ? { agents: [...(b.agents ?? []), entry.agentId].slice(-CREW) }
        : {}),
    }))
    return entry.id
  })
}

async function finish($: EngineInterface, id: string | undefined, status: Status, patch?: Pick<Board, 'context'>, exit?: number): Promise<void> {
  if (id === undefined) return
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.id === id && e.status === 'run')
      return {
        ...b,
        ...patch,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now, ...(exit === undefined ? {} : { exit }) } : e)),
        ...(open !== undefined ? tally(b, open.station, status, open.agentId) : {}),
      }
    })
  })
}

/** The call started work that goes on after it answered: its row stays open under the task's id. */
async function background($: EngineInterface, id: string | undefined, task: string): Promise<void> {
  if (id === undefined) return
  await quietly(() => update($, board, b => ({ ...b, entries: b.entries.map(e => (e.id === id && e.status === 'run' ? { ...e, task } : e)) })))
}

/** A background task ended: its row closes, as a fault when the task failed. */
async function settle($: EngineInterface, task: string, status: Status): Promise<void> {
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.task === task && e.status === 'run')
      if (open === undefined) return b
      return {
        ...b,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...tally(b, open.station, status, open.agentId),
      }
    })
  })
}

/** How full the context window is, as the status line has it; costs nothing. */
async function contextOf($: EngineInterface): Promise<Pick<Board, 'context'>> {
  const percent = await quietly(async () => (await $.session.usage()).context.percent)
  return typeof percent === 'number' ? { context: percent } : {}
}

/**
 * The terminal's map between drawings. A terminal draws no picture that moves by itself, so a timer paints each next
 * frame into the mounted Raster: often while something flies, seldom while the map only breathes.
 */
const reel: { shown?: { columns: number; rows: number }; painted: string; tick?: Timer; isPainting: boolean; misses: number } = {
  painted: '',
  isPainting: false,
  misses: 0,
}

function stopReel(): void {
  reel.tick?.cancel()
  reel.tick = undefined
  reel.shown = undefined
}

function soon($: EngineInterface, setup: Setup, ms: number): void {
  reel.tick?.cancel()
  reel.tick = reel.shown === undefined ? undefined : $.clock.after(ms, () => void frame($, setup))
}

async function frame($: EngineInterface, setup: Setup): Promise<void> {
  reel.tick = undefined
  const size = reel.shown
  if (size === undefined || reel.isPainting) return
  reel.isPainting = true
  let wait = 250
  await quietly(async () => {
    const state = await read($, board)
    const now = await $.clock.now()
    const cells = paintMap(state, now, setup, size.columns, size.rows)
    wait = paceOf(state, now)
    if (cells === reel.painted) return
    // Refused is refused, whether the answer says so or the call rejects.
    const { deny } = await $.ui.blit({ requestId: PANE, key: MAP, cells, columns: size.columns, rows: size.rows }).catch((failure: unknown) => ({ deny: String(failure) }))
    if (deny === undefined) {
      reel.painted = cells
      reel.misses = 0
    } else if (++reel.misses > 20) {
      // Not mounted for a while: the pane's next drawing starts the frames again.
      reel.shown = undefined
    } else wait = 250
  })
  reel.isPainting = false
  if (reel.shown !== undefined && reel.tick === undefined) soon($, setup, reel.shown === size ? wait : 40)
}

/**
 * The terminal's map as pictures. Where the terminal shows an Image, a renderer (renderer/render.mjs) paints the map's
 * own SVG in headless Chromium and says when each frame is written; the pane shows the newest. Anything that fails
 * leaves the map in cells.
 */
const picture: {
  /** Whether this terminal shows pictures: unknown until the session starts. */
  canShow?: boolean
  /** The renderer's folder, once it is ready: it reads map.svg there and writes frame.png. */
  dir?: string
  generation: number
  isRunning: boolean
  isStopping: boolean
  /** The terminal drew the picture's alt instead: cells for the rest of the session. */
  isRefused: boolean
  /** Whether the pane now holds the picture, so that a new frame is swapped in place. */
  isShown: boolean
  written: string
} = { generation: 0, isRunning: false, isStopping: false, isRefused: false, isShown: false, written: '' }

/** Whether the terminal draws an Image as a picture, as Claude Code decides it: kitty, Ghostty, iTerm2, or forced. */
async function showsPictures($: EngineInterface): Promise<boolean> {
  if ((await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) === '1') return true
  if (((await $.env.get('TMUX')) ?? '') !== '') return false
  const term = (await $.env.get('TERM')) ?? ''
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  const kitty = (await $.env.get('KITTY_WINDOW_ID')) ?? ''
  return term === 'xterm-kitty' || term === 'xterm-ghostty' || program === 'ghostty' || program === 'iTerm.app' || kitty !== ''
}

const frameSource = (dir: string, generation: number) => ({ file: `${dir}/frame.png`, format: 'png' as const, generation })

/** Starts the renderer once; its life is the loop over what it writes, which ends with it or when the pane closes. */
function startRenderer($: EngineInterface): void {
  if (picture.isRunning || picture.isRefused) return
  picture.isRunning = true
  picture.isStopping = false
  void (async () => {
    try {
      let rest = ''
      for await (const { stream, text } of $.process.spawn({ argv: ['node', `${$.plugin.root}/renderer/render.mjs`] })) {
        if (picture.isStopping) break
        if (stream !== 'stdout') continue
        rest += text
        for (let at = rest.indexOf('\n'); at !== -1; at = rest.indexOf('\n')) {
          await heard($, rest.slice(0, at))
          rest = rest.slice(at + 1)
        }
      }
    } catch {
      // No node, no Chromium, no processes here: the map stays in cells.
    } finally {
      Object.assign(picture, { isRunning: false, dir: undefined, generation: 0, written: '', isShown: false })
      await quietly(async () => $.ui.invalidate('ui.render'))
    }
  })()
}

/** One line from the renderer: it is ready, a frame is written, or it cannot run. */
async function heard($: EngineInterface, line: string): Promise<void> {
  const [word = '', ...rest] = line.split(' ')
  const value = rest.join(' ')
  if (word === 'ready' && value.startsWith('/')) {
    picture.dir = value
    await quietly(async () => $.ui.invalidate('ui.render'))
  } else if (word === 'frame' && picture.dir !== undefined) {
    picture.generation = Number(value) || picture.generation + 1
    if (!picture.isShown) {
      await quietly(async () => $.ui.invalidate('ui.render'))
      return
    }
    const { deny } = await $.ui.blit({ requestId: PANE, key: MAP, source: frameSource(picture.dir, picture.generation) }).catch((failure: unknown) => ({ deny: String(failure) }))
    // The terminal shows the picture's words instead, or cannot read its file: back to cells for good.
    if (deny !== undefined && !/mounted/i.test(deny)) {
      picture.isRefused = true
      picture.isStopping = true
      await quietly(async () => $.ui.invalidate('ui.render'))
    }
  }
}

/** Hands the renderer the map as it now stands, sized for the box it fills; nothing when it is unchanged. */
async function writePicture($: EngineInterface, state: Board, now: number, setup: Setup, size: { columns: number; rows: number }): Promise<void> {
  if (picture.dir === undefined) return
  const svg = framedMap(state, now, setup, size.columns * PICTURE_CELL.width, size.rows * PICTURE_CELL.height)
  if (svg === picture.written) return
  picture.written = svg
  await $.fs.write(`${picture.dir}/map.svg`, svg)
}

/**
 * The map in a window of its own, for a terminal that shows Sixel pictures but not a mod's Image, such as Windows
 * Terminal: `/lot-map window` keeps the live map in a folder (map.svg, the rows under it in feed.json, and a heartbeat
 * in alive) and opens renderer/view.mjs beside the session to draw them.
 */
const sharing: { dir?: string; timer?: Timer; written: string; line: string; beat: number } = { written: '', line: '', beat: 0 }

/** The top line's own clock: while it counts time it is drawn again when its words would change. */
const lineTick: { timer?: Timer } = {}

function tickLine($: EngineInterface, next: number | undefined): void {
  lineTick.timer?.cancel()
  lineTick.timer = next === undefined ? undefined : $.clock.after(Math.max(50, next), () => void quietly(async () => $.ui.invalidate('ui.render')))
}

/** Writes the map when the board has changed, and the heartbeat every few seconds, so the window knows the session lives. */
async function share($: EngineInterface, setup: Setup): Promise<void> {
  const dir = sharing.dir
  if (dir === undefined) return
  await quietly(async () => {
    const state = await read($, board)
    const now = await $.clock.now()
    const seen = JSON.stringify(state)
    const isChanged = seen !== sharing.written
    if (isChanged) {
      sharing.written = seen
      await $.fs.write(`${dir}/map.svg`, framedMap(state, now, setup, 920, 860))
    }
    // The rows under the map, as the pane writes them; again when the top line's time moves on.
    const line = describeNow(state, setup.t, now)
    const pinned = pinnedLines(state.entries, now, setup.t)
    const said = [line.text, ...pinned.map(p => p.line)].join('\n')
    if (isChanged || said !== sharing.line) {
      sharing.line = said
      const feed = {
        now: line.text,
        nowTone: line.tone,
        plan: planLines(state.plan, setup.t),
        pinned,
        rows: feedLines(state.entries, setup.t, state.agentNames),
        empty: setup.t.nothingYet,
        legend: setup.t.legend,
      }
      await $.fs.write(`${dir}/feed.json`, JSON.stringify(feed))
    }
    if (now - sharing.beat >= 3000) {
      sharing.beat = now
      await $.fs.write(`${dir}/alive`, String(now))
    }
  })
}

/** How recently the window must have marked itself shown (it does every two seconds) to count as open. */
const SHOWN_MS = 6000

/**
 * Starts keeping the live map and opens the window beside this one in Windows Terminal, unless one already shows it;
 * elsewhere, says how to open it.
 */
async function openWindow($: EngineInterface, setup: Setup): Promise<{ isOpen: boolean; text: string }> {
  if (sharing.dir !== undefined) {
    const shown = await quietly(() => $.fs.stat(`${sharing.dir}/shown`))
    if (shown !== undefined && (await $.clock.now()) - shown.mtimeMs < SHOWN_MS) return { isOpen: true, text: setup.t.windowOpen }
  } else {
    const tmp = ((await $.env.get('TMPDIR')) ?? '') || '/tmp'
    sharing.dir = `${tmp}/lot-map-live-${Math.random().toString(36).slice(2, 10)}`
    await share($, setup)
    sharing.timer = $.clock.every(250, () => void share($, setup))
  }
  const view = `${$.plugin.root}/renderer/view.mjs`
  // Found here, where the session's PATH has them: a pane wsl.exe opens starts with a bare PATH that has neither.
  const node = (await quietly(() => $.process.run(['sh', '-c', 'command -v node'])))?.stdout.trim() || 'node'
  const chromium = (await quietly(() => $.process.run(['sh', '-c', 'command -v chromium || command -v google-chrome'])))?.stdout.trim().split('\n')[0] ?? ''
  const found = chromium !== '' && !/\s/.test(chromium) ? [`LOT_MAP_CHROMIUM=${chromium}`] : []
  const command = ['env', ...found, node, view, sharing.dir ?? '']
  const distro = (await $.env.get('WSL_DISTRO_NAME')) ?? ''
  if (distro !== '') {
    const opened = await quietly(() => $.process.run(['wt.exe', '-w', '0', 'split-pane', '--vertical', '--size', '0.45', 'wsl.exe', '-d', distro, '--', ...command]))
    if (opened?.exitCode === 0) return { isOpen: true, text: setup.t.windowOpened }
  }
  return { isOpen: false, text: setup.t.windowByHand(command.join(' ')) }
}

/**
 * Whether the map is the window and not the pane: in Windows Terminal from WSL, where the pane can draw it only in
 * cells. A session in the background has the profile's id though not the tab's.
 */
async function windowIsTheMap($: EngineInterface, setup: Setup): Promise<boolean> {
  if (!setup.terminalMap || setup.terminalWindow === 'off' || picture.canShow === true) return false
  const distro = (await $.env.get('WSL_DISTRO_NAME')) ?? ''
  const tab = (await $.env.get('WT_SESSION')) ?? ''
  const profile = (await $.env.get('WT_PROFILE_ID')) ?? ''
  return distro !== '' && (tab !== '' || profile !== '')
}

/**
 * In Windows Terminal the map is a window in place of the pane, opened the first time the person writes: a session can
 * start in the background, and only then is its tab sure to be the one in front, the one the window splits.
 */
const windowed = { isMap: false, isAsked: false }

/** What opens the pane. */
type Opening = Parameters<EngineInterface['ui']['open']>[0]

/** Opens the window, or the pane where the window cannot open. */
async function showWindow($: EngineInterface, setup: Setup, opening: Opening): Promise<string> {
  windowed.isAsked = true
  const opened = await openWindow($, setup)
  if (opened.isOpen) return opened.text
  const placed = await $.ui.open(opening)
  return placed.isPlaced ? setup.t.opened : setup.t.cannotOpen(String(placed.reason))
}

/** `/lot-map` and `/workmap`: the pane, or in Windows Terminal the window; `window` asks for the window anywhere. */
async function runCommand($: EngineInterface, args: string, setup: Setup, opening: Opening): Promise<{ text: string }> {
  if (args.trim() === 'help') return { text: setup.t.legend.join('\n') }
  if (args.trim() === 'window') return { text: (await openWindow($, setup)).text }
  if (windowed.isMap) return { text: await showWindow($, setup, opening) }
  const opened = await $.ui.open(opening)
  return { text: opened.isPlaced ? setup.t.opened : setup.t.cannotOpen(String(opened.reason)) }
}

/** Stops keeping the live map and removes its folder; a window still open sees its heartbeat go and closes. */
async function stopSharing($: EngineInterface): Promise<void> {
  const dir = sharing.dir
  sharing.timer?.cancel()
  Object.assign(sharing, { dir: undefined, timer: undefined, written: '', line: '', beat: 0 })
  if (dir !== undefined && /\/lot-map-live-[a-z0-9]+$/.test(dir)) await quietly(() => $.process.run(['rm', '-rf', '--', dir]))
}

/** What a settings hook added to the context: shown as the hook acting and, when it brought records, as memory. */
async function noteContext($: EngineInterface, context: readonly string[] | undefined, when: string, setup: Setup): Promise<void> {
  const { t } = setup
  const text = (context ?? []).join('\n')
  if (text.trim() === '') return
  const ids = setup.hookRecords ? memoryIds(text) : []
  if (ids.length === 0) {
    await begin($, { station: 'hooks', label: t.addedContext(when), status: 'ok' })
    return
  }
  await begin($, { station: 'hooks', label: t.addedMemory(when), status: 'ok' })
  const shown = ids.slice(0, 6).map(id => `#${id}`).join(' ')
  await begin($, {
    station: 'memory',
    label: t.records(ids.length, `${shown}${ids.length > 6 ? ' …' : ''}`),
    from: 'inbound',
    status: 'ok',
  })
}

export const register: Register = (on, options) => {
  const setup = setupFrom(options)
  const { t } = setup

  // Calls a settings hook refused, so that the tool's own row reads as blocked and not as an error.
  // Loses nothing across a reload that matters: a reload never lands in the middle of a call.
  const refused = new Set<string>()

  // The model the main loop last ran on: in this session, or else in the last session in this folder.
  // The one thing the map keeps between sessions, and only its name.
  let lastModel: string | undefined
  let modelKey = 'model'

  const opening = { id: PANE, title: t.title, ...(setup.terminalMap ? { columns: MAP_COLUMNS, rows: MAP_ROWS } : {}) }

  on('session.start', async ($, e, next) => {
    // Two names for one command: lot-map, as the plugin is called, and workmap.
    await quietly(() => $.command.register({ name: 'lot-map', description: t.command, argumentHint: '[window | help]' }))
    await quietly(() => $.command.register({ name: 'workmap', description: t.command, argumentHint: '[window | help]' }))
    picture.canShow = setup.terminalMap && setup.terminalPicture === 'auto' && (await quietly(() => showsPictures($))) === true
    windowed.isAsked = false
    // A -p run or the SDK draws nowhere (surface null): no window.
    windowed.isMap = e.surface === 'terminal' && (await quietly(() => windowIsTheMap($, setup))) === true
    if (!windowed.isMap) void quietly(() => $.ui.open(opening))
    await quietly(async () => {
      modelKey = `model:${e.cwd}`
      const kept = await $.store.get(modelKey)
      if (lastModel === undefined && typeof kept === 'string') lastModel = kept
    })
    return next(e)
  })

  on('command.run', { command: 'lot-map' }, ($, e) => runCommand($, e.args, setup, opening))
  on('command.run', { command: 'workmap' }, ($, e) => runCommand($, e.args, setup, opening))

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    // A /clear ends the conversation but not the process: the window stays for what comes next.
    if (e.reason !== 'clear') await stopSharing($)
    return result
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) {
      stopReel()
      // The renderer goes with the pane; opening it again starts another.
      picture.isStopping = true
    }
    return result
  })

  // A subagent's name is the short description it was started with: its rows carry it.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const agentId = spawned.agentId
    const name = clean(e.description ?? '').slice(0, 24)
    if (agentId !== undefined && name !== '') {
      await quietly(() =>
        update($, board, b => ({ ...b, agentNames: Object.fromEntries([...Object.entries(b.agentNames ?? {}), [agentId, name]].slice(-12)) })),
      )
    }
    return spawned
  })

  on('turn.start', async ($, e, next) => {
    const notice = e.agentId === undefined ? taskNotice(e.text) : undefined
    if (notice !== undefined) {
      // A background task reporting back is no message of the person's.
      if (notice.status !== undefined) await settle($, notice.id, notice.status)
    } else if (e.agentId === undefined && e.text !== '') {
      // A new message clears what went wrong on the way to the last answer, and the session thinks again.
      await quietly(() =>
        update($, board, b => ({
          ...b,
          ...(b.faults === undefined ? {} : { faults: {} }),
          ...(b.blocks === undefined ? {} : { blocks: {} }),
          phase: 'thinking' as const,
        })),
      )
      await begin($, { station: 'you', label: t.newMessage, from: 'inbound', status: 'ok' })
      if (windowed.isMap && !windowed.isAsked) void quietly(() => showWindow($, setup, opening))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    if (isMain && lastModel !== e.model) {
      const before = lastModel
      lastModel = e.model
      void quietly(() => $.store.set(modelKey, e.model))
      if (before !== undefined) {
        const now = await quietly(() => $.clock.now())
        await begin($, {
          station: 'model',
          label: `${shortModel(before)} → ${shortModel(e.model)}`,
          status: 'ok',
          mark: 'switch',
          uncounted: true,
          ...(now !== undefined ? { patch: { switchedAt: now } } : {}),
        })
      }
    }
    const id = await begin($, {
      station: 'model',
      label: `${shortModel(e.model)} · ${t.step(e.index + 1)}${isMain ? '' : ` · ${t.subagent}`}`,
      from: isMain ? 'core' : 'agents',
      ...(isMain ? { patch: { model: e.model, step: e.index + 1 } } : { agentId: e.agentId }),
    })
    try {
      return yield* next(e)
    } finally {
      await finish($, id, 'ok', isMain ? await contextOf($) : undefined)
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // A subagent's loop is over: it leaves the agents station, and a call of its that never reported back is settled.
      const agentId = e.agentId
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => ({
          ...b,
          agents: (b.agents ?? []).filter(id => id !== agentId),
          entries: b.entries.map(x => (x.status === 'run' && (x.agentId === agentId || x.task === agentId) ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    } else {
      await begin($, {
        station: 'you',
        label: e.isAborted ? t.turnAborted : t.answerReady,
        status: e.isAborted ? 'err' : 'ok',
        ...(e.isAborted ? {} : { mark: 'done' as const }),
      })
      if (!e.isAborted && setup.notify) void quietly(() => $.ui.notify(t.notifyDone, { title: t.title, key: 'lot-map-wait' }))
      // An interrupted call never reports back; left alone its row would pulse for the rest of the session.
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => ({
          ...b,
          phase: 'done' as const,
          entries: b.entries.map(x => (x.status === 'run' && x.from === 'core' && x.task === undefined ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = await quietly(async () => {
      const seen = classify(e.tool, e as unknown as Record<string, unknown>, setup)
      // A question for the person, or a plan for their approval, waits on them until they answer.
      const waits = e.agentId === undefined && (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode')
      if (waits && setup.notify) void quietly(() => $.ui.notify(t.notifyWaiting(seen.label), { title: t.title, key: 'lot-map-wait' }))
      return begin($, {
        ...seen,
        ...(e.agentId === undefined ? { from: 'core' as const } : { from: 'agents' as const, agentId: e.agentId }),
        ...(waits ? { waits: true as const } : {}),
      })
    })
    // A call other than the plan's own counts as work on the task in progress, a subagent's as well.
    if (!PLAN_TOOLS.has(String(e.tool))) {
      await quietly(() =>
        update($, board, b => {
          const at = (b.plan ?? []).findIndex(p => p.status === 'in_progress')
          return at < 0 ? b : { ...b, plan: (b.plan ?? []).map((p, i) => (i === at ? { ...p, calls: p.calls + 1 } : p)) }
        }),
      )
    }
    try {
      const ran = await next(e)
      const wasRefused = ran.deny !== undefined || (e.tool_use_id !== undefined && refused.delete(e.tool_use_id))
      // Claude's own plan, as the main loop's task tools set it.
      if (e.agentId === undefined && !wasRefused && ran.isError !== true && PLAN_TOOLS.has(String(e.tool))) {
        await quietly(async () => {
          const now = await $.clock.now()
          await update($, board, b => {
            const plan = planAfter(b.plan, String(e.tool), e as unknown as Record<string, unknown>, ran.result, String(ran.text ?? ''), now)
            return plan === undefined ? b : { ...b, plan }
          })
        })
      }
      const task = wasRefused || ran.isError === true ? undefined : taskOf(ran.result)
      if (task !== undefined) {
        await background($, id, task)
        return ran
      }
      // A failed shell command keeps its exit code, read off the first line of its answer, and nothing else of it.
      const isShell = ['Bash', 'PowerShell'].includes(String(e.tool))
      const code = isShell && !wasRefused && ran.isError === true ? /^(?:Error: )?Exit code (\d{1,3})\b/.exec(String(ran.text ?? ''))?.[1] : undefined
      await finish($, id, wasRefused ? 'block' : ran.isError === true ? 'err' : 'ok', undefined, code === undefined ? undefined : Number(code))
      return ran
    } catch (failure) {
      await finish($, id, 'err')
      throw failure
    }
  })

  on('classic.PreToolUse', async ($, e, next) => {
    const startedAt = (await quietly(() => $.clock.now())) ?? 0
    const decided = await next(e)
    const endedAt = (await quietly(() => $.clock.now())) ?? startedAt
    if (decided.deny !== undefined) {
      if (e.tool_use_id !== undefined) refused.add(e.tool_use_id)
      await begin($, { station: 'hooks', label: (setup.hookReasons ? firstLine(decided.deny) : '') || t.stopped(e.tool), status: 'block', startedAt })
    } else if (decided.ask !== undefined) {
      await begin($, { station: 'hooks', label: t.askedPermission(e.tool), status: 'ok', startedAt, endedAt })
    } else if (endedAt - startedAt >= 400) {
      // A check that took a moment is worth seeing; the instant ones are not.
      await begin($, { station: 'hooks', label: t.checkBefore(e.tool), status: 'ok', startedAt, endedAt })
    }
    return decided
  })

  // A notification delivered into a running turn starts no turn of its own; this is where it is seen.
  on('prompt.submit', async ($, e, next) => {
    await quietly(async () => {
      if (e.origin?.kind !== 'task-notification') return
      const notice = taskNotice(e.text)
      if (notice?.status !== undefined) await settle($, notice.id, notice.status)
    })
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    await noteContext($, result.additionalContext, t.toMessage, setup)
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await noteContext($, result.additionalContext, t.atStart, setup)
    return result
  })

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    // A skill the model called is already on the map as its tool call; this one catches a typed slash command.
    await quietly(async () => {
      const now = await $.clock.now()
      await update($, board, b => {
        const label = clean(e.skill)
        if (b.entries.some(x => x.station === 'skills' && x.status === 'run' && x.label === label)) return b
        const entry: Entry = { id: newId(now), station: 'skills', label, from: 'core', startedAt: now, endedAt: now, status: 'ok' }
        return { ...b, entries: kept([...b.entries, entry]), counts: { ...b.counts, skills: (b.counts.skills ?? 0) + 1 } }
      })
    })
    return result
  })

  on('session.compact', async ($, e, next) => {
    const before = (await quietly(() => read($, board)))?.phase
    const id = await begin($, { station: 'model', label: t.compacting, patch: { phase: 'compacting' } })
    try {
      return await next(e)
    } finally {
      await finish($, id, 'ok', await contextOf($))
      await quietly(() => update($, board, b => ({ ...b, phase: before })))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, board)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    // Theme keys, so the rows read on a light theme as well as on a dark one.
    const rows = feedLines(state.entries, t, state.agentNames).map(({ line, tone }) => (
      <Text
        mono
        size="footnote"
        color={tone === 'run' || tone === 'switch' ? 'claude' : tone === 'bad' ? 'error' : tone === 'block' ? 'warning' : undefined}
        dimColor={tone === 'ok'}
      >
        {line}
      </Text>
    ))
    const feed = rows.length > 0 ? rows : [<Text dimColor>{t.nothingYet}</Text>]
    // The top line: a wait on the person stands out, a finished turn reads as theirs.
    const line = describeNow(state, t, now)
    // Under it, work still going in the background, with its time: the pane is drawn again as the times move on.
    const pinned = pinnedLines(state.entries, now, t)
    const next = Math.min(line.next ?? Infinity, pinned.length > 0 ? 1000 - (now % 1000) : Infinity)
    tickLine($, Number.isFinite(next) ? next : undefined)
    const current = (
      <Box flexDirection="column">
        <Text mono size="footnote" color={line.tone === 'wait' ? 'warning' : line.tone === 'done' ? 'success' : undefined} bold={line.tone === 'wait'}>
          {line.text}
        </Text>
        {planLines(state.plan, t).map(p => (
          <Text mono size="footnote" color={p.tone === 'run' ? 'claude' : undefined} dimColor={p.tone === 'ok'} bold={p.isBold === true}>
            {p.line}
          </Text>
        ))}
        {pinned.map(p => (
          <Text mono size="footnote" color="claude">
            {p.line}
          </Text>
        ))}
      </Box>
    )

    if (e.surface === 'terminal') {
      const size = setup.terminalMap ? mapSize(e.props.bodyColumns, e.props.scroll.bodyRows, e.props.placement) : undefined
      if (size === undefined) {
        stopReel()
        const tally = STATIONS.filter(s => (state.counts[s.id] ?? 0) > 0).map(s => `${t.stations[s.id]} ${state.counts[s.id]}`).join(' · ')
        // A dock kept narrow (the person's own width wins over the pane's ask) says how wide the map needs it.
        const isNarrow = setup.terminalMap && e.props.placement === 'dock' && e.props.bodyColumns < MAP_MIN_COLUMNS
        return (
          <Box flexDirection="column">
            {current}
            <Text dimColor>{tally === '' ? t.noCounts : tally}</Text>
            {isNarrow ? <Text dimColor>{t.tooNarrow(MAP_MIN_COLUMNS + 2)}</Text> : null}
            {feed}
          </Box>
        )
      }
      const { Raster, Image } = $.ui.resolve(e)
      let map
      if (picture.canShow === true && !picture.isRefused) {
        startRenderer($)
        await quietly(() => writePicture($, state, now, setup, size))
      }
      if (picture.canShow === true && !picture.isRefused && picture.dir !== undefined && picture.generation > 0) {
        stopReel()
        picture.isShown = true
        map = <Image key={MAP} source={frameSource(picture.dir, picture.generation)} columns={size.columns} rows={size.rows} alt={line.text} />
      } else {
        picture.isShown = false
        reel.painted = paintMap(state, now, setup, size.columns, size.rows)
        reel.shown = size
        reel.misses = 0
        soon($, setup, 40)
        map = <Raster key={MAP} columns={size.columns} rows={size.rows} cells={reel.painted} />
      }
      return size.isBeside ? (
        <Box flexDirection="row">
          {map}
          <Box flexDirection="column" marginLeft={2} flexShrink={1}>
            {current}
            {feed}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {map}
          {current}
          {feed}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Svg source={drawMap(state, now, setup)} alt={`${t.title}. ${line.text}`} />
        {current}
        {feed}
      </Box>
    )
  })
}
