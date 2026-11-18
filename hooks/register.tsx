import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AgentInfo, Board, Entry, StationId, Status, TurnSummary } from '../types'
import {
  STATIONS,
  agentList,
  changedItems,
  changedLine,
  classify,
  clean,
  describeNow,
  drawMap,
  feedLines,
  firstLine,
  framedMap,
  actOf,
  keepNewest,
  localHostsIn,
  logLines,
  memoryIds,
  PLAN_TOOLS,
  pinnedLines,
  planAfter,
  planLines,
  recapLines,
  setupFrom,
  stillChangeIn,
  shortModel,
  stateOf,
  taskNotice,
  taskOf,
  untilText,
  warningsOf,
  withLocal,
  withSatellite,
  costText,
} from './map'
import type { Setup } from './map'
import { tilesFrom, tileText } from './overview'
import { tokensShort } from './text'
import type { Tile } from './overview'
import { MAP_COLUMNS, MAP_MIN_COLUMNS, MAP_ROWS, PICTURE_CELL, mapSize, paceOf, paintMap } from './raster'

const PANE = 'workmap'
/** The terminal map's Raster or Image, by the key a repaint names it with. */
const MAP = 'map'
const KEEP = 80
/**
 * One step's growth of the context is shared evenly among its calls when there are at most this many. With more, an
 * even share says too little: a large read and a short command would each show the same. Their rows then get no figure.
 */
const SHARED_AT_MOST = 3
/** How many calls with the most growth the board keeps by name. */
const HEAVIEST = 3
/** How many refusals are remembered until their calls come by: a call that never comes would stay for the whole session. */
const REFUSALS_KEPT = 64
const CREW = 12
/** How many turns the board keeps. */
const TURNS = 12
/** How many changed files the board keeps. */
const CHANGED = 40
/** The calls that change a file. */
const CHANGING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])

// Change the tag when a field of Entry or Board changes: it declines what an earlier version stored.
const board = atom({ plugin: 'workmap', key: 'board' } as const, { entries: [], counts: {} } as Board, { shape: 'board-5' })

const newId = (now: number): string => `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Whatever goes wrong on the map must never reach the tool, the turn or the conversation. */
async function quietly<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch {
    return undefined
  }
}

/** What a spawn tells of its subagent, kept by id (the last 24): its parent and its type's name. */
const spawnInfo = (b: Board, id: string, e: { parentAgentId?: string; subagentType?: string }, now: number): Pick<Board, 'agentInfo'> => {
  const info: AgentInfo = {
    at: now,
    ...(e.parentAgentId ? { parent: e.parentAgentId } : {}),
    ...(e.subagentType ? { type: Array.from(clean(e.subagentType)).slice(0, 24).join('') } : {}),
  }
  return { agentInfo: Object.fromEntries([...Object.entries(b.agentInfo ?? {}), [id, info]].slice(-24)) }
}

/** Keeps what a spawn told of its subagent. */
async function noteSpawn($: EngineInterface, id: string, e: { parentAgentId?: string; subagentType?: string }): Promise<void> {
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => ({ ...b, ...spawnInfo(b, id, e, now) }))
  })
}

type Start = {
  station: StationId
  label: string
  from?: Entry['from']
  status?: Status
  agentId?: string
  mark?: Entry['mark']
  waits?: true
  act?: Entry['act']
  /** Adds nothing to the station's count: a second view of something already counted. */
  uncounted?: boolean
  /** Comes ahead of the turn it belongs to, as a settings hook's row at a message: no turn yet, nothing counted on one. */
  loose?: true
  startedAt?: number
  endedAt?: number
  patch?: Partial<Pick<Board, 'model' | 'step' | 'switchedAt' | 'phase'>>
}

/** The newest rows, and beside them every background task still going, however long ago it started. */
const kept = (entries: Entry[]): Entry[] => {
  const from = entries.length - KEEP
  return from <= 0 ? entries : entries.filter((e, i) => i >= from || (e.status === 'run' && e.task !== undefined))
}

/** The turns with turn `n` changed by `f`, the open one when no turn is named; nothing before the person's first message. */
const inTurn = (b: Board, f: (t: TurnSummary) => TurnSummary, n?: number): Pick<Board, 'turns'> => {
  const turns = b.turns
  const at = turns === undefined ? -1 : n === undefined ? turns.length - 1 : turns.findIndex(t => t.n === n)
  return turns === undefined || at < 0 ? {} : { turns: turns.map((t, i) => (i === at ? f(t) : t)) }
}

/** The first line of `body` with text in it, cleaned and cut to 72 characters. */
function firstText(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const text = clean(line, 72)
    if (text !== '') return text
  }
  return undefined
}

/** The picked running rows closed as ok at `now`, their time folded in. */
function closeRuns(b: Board, pick: (e: Entry) => boolean, now: number): Pick<Board, 'entries' | 'busyMs'> {
  let acc: Board = b
  const entries = b.entries.map(e => {
    if (e.status !== 'run' || !pick(e)) return e
    acc = { ...acc, ...busier(acc, e, now) }
    return { ...e, status: 'ok' as const, endedAt: now }
  })
  return { entries, busyMs: acc.busyMs }
}

const oneMore = (counts: Board['faults'], station: StationId): Board['faults'] => ({ ...counts, [station]: (counts?.[station] ?? 0) + 1 })

/**
 * A call that ended badly counts on its station, an error with the faults and a refusal with the blocks; one that worked
 * clears them there, so a badge says what is wrong now, not what went wrong once. The session's totals keep everything. A
 * subagent's own failure shows on its Agent call's row; one bad call inside it does not mark it.
 */
function tally(
  b: Board,
  station: StationId,
  status: Status,
  agentId?: string,
  turn?: number,
): Pick<Board, 'faults' | 'faultTotals' | 'blocks' | 'blockTotals' | 'turns'> {
  if (status === 'ok') {
    const isClear = (b.faults?.[station] ?? 0) === 0 && (b.blocks?.[station] ?? 0) === 0
    return isClear ? {} : { faults: { ...b.faults, [station]: 0 }, blocks: { ...b.blocks, [station]: 0 } }
  }
  if (status !== 'err' && status !== 'block') return {}
  const bad =
    status === 'err'
      ? { faults: oneMore(b.faults, station), faultTotals: oneMore(b.faultTotals, station) }
      : { blocks: oneMore(b.blocks, station), blockTotals: oneMore(b.blockTotals, station) }
  // An error counts on the turn of the call.
  const turns = status === 'err' && station !== 'model' && station !== 'you' ? inTurn(b, t => ({ ...t, errors: t.errors + 1 }), turn) : {}
  return { ...bad, ...turns }
}

/** The calls that read or change a file. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit'])

/** A file or an MCP server a call used becomes a satellite of its station; a memory server does not, as Memory shows its records. */
async function keepSatellite($: EngineInterface, tool: string, input: Record<string, unknown>, setup: Setup): Promise<void> {
  const seen = classify(tool, input, setup)
  const server = /^mcp__([^_].*?)__.+$/.exec(tool)?.[1]
  const name = FILE_TOOLS.has(tool) ? (seen.station === 'files' && seen.label !== tool ? seen.label : undefined) : server
  if (name === undefined || seen.station === 'memory' || seen.station === 'agents' || setup.memoryServers.has(server ?? '')) return
  const now = await $.clock.now()
  await update($, board, b => ({ ...b, satellites: withSatellite(b.satellites, seen.station, clean(name, 40), CHANGING_TOOLS.has(tool), now) }))
}

/** A call that ended adds its time to its station: one number per station, whatever the length of the session. */
export const busier = (b: Board, e: Entry, endedAt: number): Pick<Board, 'busyMs'> =>
  e.station === 'model' || e.station === 'you' ? {} : { busyMs: { ...b.busyMs, [e.station]: (b.busyMs?.[e.station] ?? 0) + Math.max(0, endedAt - (e.ranAt ?? e.startedAt)) } }

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
      ...(start.act === undefined ? {} : { act: start.act }),
    }
    await update($, board, b => {
      const open = start.loose ? undefined : b.turns?.[b.turns.length - 1]
      const bad = entry.station !== 'you' ? tally(b, entry.station, entry.status, entry.agentId) : {}
      const counts = !start.uncounted && !start.loose && entry.station !== 'model' && entry.station !== 'you'
      return {
        ...b,
        ...start.patch,
        entries: kept([...b.entries, open === undefined ? entry : { ...entry, turn: open.n }]),
        counts: start.uncounted ? b.counts : { ...b.counts, [entry.station]: (b.counts[entry.station] ?? 0) + 1 },
        ...(start.uncounted || start.loose ? {} : { turnCounts: oneMore(b.turnCounts, entry.station) }),
        // What a hook brought to memory unasked is counted apart from what was asked for.
        ...(entry.station === 'memory' && entry.from === 'inbound' && !start.uncounted ? { pushed: (b.pushed ?? 0) + 1 } : {}),
        // An interrupted turn lands on the person's own station and is no fault of anything.
        ...bad,
        ...(counts ? inTurn({ ...b, ...bad }, t => ({ ...t, calls: t.calls + 1 })) : {}),
        ...(entry.agentId !== undefined && !(b.agents ?? []).includes(entry.agentId) ? { agents: [...(b.agents ?? []), entry.agentId].slice(-CREW) } : {}),
      }
    })
    return entry.id
  })
}

async function finish($: EngineInterface, id: string | undefined, status: Status, patch?: Pick<Board, 'context'>, exit?: number, reason?: string): Promise<void> {
  if (id === undefined) return
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.id === id && e.status === 'run')
      // An error after an ask nothing settled is a refusal: the person's no, or the mode's.
      const refusal = open?.asks === true && status === 'err'
      const closed = refusal ? 'block' : status
      return {
        ...b,
        ...patch,
        ...peaked(b, patch?.context),
        entries: b.entries.map(e => {
          if (e !== open) return e
          return { ...bare(e), status: closed, endedAt: now, ...(exit === undefined || refusal ? {} : { exit }), ...(reason === undefined || refusal ? {} : { reason }) }
        }),
        ...(open !== undefined ? tally(b, open.station, closed, open.agentId, open.turn) : {}),
        ...(open !== undefined ? busier(b, open, now) : {}),
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
        ...tally(b, open.station, status, open.agentId, open.turn),
        ...busier(b, open, now),
      }
    })
  })
}

/** A row without a permission prompt's marks. */
const bare = (e: Entry): Entry => {
  const { asks, waits, ...rest } = e
  return rest
}

/** A permission prompt's row: its ask marked, or its ask and wait cleared and the moment it was allowed kept. */
async function askOn($: EngineInterface, calls: Map<string, string>, call: string | undefined, isAsked: boolean): Promise<void> {
  await quietly(async () => {
    const id = call === undefined ? undefined : calls.get(call)
    if (id === undefined) return
    const now = await $.clock.now()
    await update($, board, b => ({
      ...b,
      entries: b.entries.map(e => {
        if (e.id !== id || e.status !== 'run') return e
        // A question or a plan already waits on the person, and the mode's ask is no news. Only a mode's ask is cleared.
        if (isAsked) return e.waits === true ? e : { ...e, asks: true as const }
        return e.asks === true ? { ...bare(e), ranAt: now } : e
      }),
    }))
  })
}

/** A second after the ask, a call nothing has settled waits on the person: the row waits, and a notification goes out once. */
async function waitsOnYou($: EngineInterface, setup: Setup, calls: Map<string, string>, call: string): Promise<void> {
  await quietly(async () => {
    const id = calls.get(call)
    if (id === undefined) return
    const now = await $.clock.now()
    // Checked and written in one step: a run that cleared the ask meanwhile leaves the row alone.
    let row: Entry | undefined
    await update($, board, b => {
      row = b.entries.find(x => x.id === id && x.status === 'run' && x.asks === true && x.waits !== true)
      return row === undefined ? b : { ...b, entries: b.entries.map(x => (x === row ? { ...x, waits: true as const } : x)) }
    })
    if (row === undefined) return
    const { t } = setup
    const { station, label } = row
    if (setup.notify) void quietly(() => $.ui.notify(t.notifyWaiting(t.permissionFor(`${t.stations[station]}: ${label}`)), { title: t.title, key: 'workmap-wait' }))
  })
}

/** How full the context window is, as the status line has it, and its tokens; costs nothing. */
async function contextOf($: EngineInterface): Promise<{ patch: Pick<Board, 'context'>; tokens: number | undefined }> {
  const context = await quietly(async () => (await $.session.usage()).context)
  return {
    patch: typeof context?.percent === 'number' ? { context: context.percent } : {},
    tokens: typeof context?.tokens === 'number' ? context.tokens : undefined,
  }
}

/**
 * What one step of the main loop added to the context, put on the calls whose answers it was sent with.
 *
 * The engine reads the context as the input a response was answered over, so the calls of step N show in the reading
 * of step N+1: `before` and `after` are those two readings. The growth also holds the model's own words, what a hook
 * added and, at the start of a turn, the message: an estimate. A context that shrank, as at a compaction, puts nothing
 * anywhere. Calls no longer in the list lose their figure.
 *
 * Up to SHARED_AT_MOST calls share it evenly, marked as shared. With more the rows get nothing, but when every call
 * was at one station there is no doubt where it went, and that station's sum gets it whole.
 */
async function charge($: EngineInterface, calls: readonly string[], before: number | undefined, after: number | undefined): Promise<void> {
  if (before === undefined || after === undefined || calls.length === 0 || after <= before) return
  const grown = after - before
  await quietly(() =>
    update($, board, b => {
      const own = b.entries.filter(e => calls.includes(e.id))
      if (own.length === 0) return b
      const share = calls.length <= SHARED_AT_MOST ? Math.round(grown / calls.length) : undefined
      const spent = { ...b.spent }
      const add = (station: StationId, tokens: number): void => {
        spent[station] = (spent[station] ?? 0) + tokens
      }
      if (share !== undefined) for (const e of own) add(e.station, share)
      else if (own.length === calls.length && new Set(own.map(e => e.station)).size === 1 && own[0] !== undefined) add(own[0].station, grown)
      if (share === undefined) return { ...b, spent }
      const heaviest = [...(b.heaviest ?? []), ...own.map(e => ({ label: e.label, tokens: share }))].sort((x, y) => y.tokens - x.tokens).slice(0, HEAVIEST)
      return {
        ...b,
        spent,
        heaviest,
        entries: b.entries.map(e => (calls.includes(e.id) ? { ...e, tokens: share, ...(calls.length > 1 ? { shared: true as const } : {}) } : e)),
      }
    }),
  )
}

/** Raises the board's peak context to a fill when it is higher. */
const peaked = (b: Board, percent: number | undefined): Pick<Board, 'peakContext'> =>
  typeof percent === 'number' && percent > (b.peakContext ?? 0) ? { peakContext: percent } : {}

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
    wait = paceOf(state, now, setup)
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

/** Whether the terminal draws an Image as a picture, as Claude Code decides it: kitty, Ghostty, or forced. Never iTerm2: it keeps every frame in memory. */
async function showsPictures($: EngineInterface): Promise<boolean> {
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  if (program === 'iTerm.app' || (await $.env.get('LC_TERMINAL')) === 'iTerm2') return false
  if ((await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) === '1') return true
  if (((await $.env.get('TMUX')) ?? '') !== '') return false
  const term = (await $.env.get('TERM')) ?? ''
  const kitty = (await $.env.get('KITTY_WINDOW_ID')) ?? ''
  return term === 'xterm-kitty' || term === 'xterm-ghostty' || program === 'ghostty' || kitty !== ''
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
 * Terminal: `/workmap window` keeps the live map in a folder (map.svg, the rows under it in feed.json, and a heartbeat
 * in alive) and opens renderer/view.mjs beside the session to draw them.
 */
const sharing: { dir?: string; timer?: Timer; written: string; still: string; line: string; beat: number } = {
  written: '',
  still: '',
  line: '',
  beat: 0,
}

/** The top line's own clock: while it counts time it is drawn again when its words would change. */
const lineTick: { timer?: Timer } = {}

function tickLine($: EngineInterface, next: number | undefined): void {
  lineTick.timer?.cancel()
  lineTick.timer = next === undefined ? undefined : $.clock.after(Math.max(50, next), () => void quietly(async () => $.ui.invalidate('ui.render')))
}

/** Where the session works, for the window's title: the repository, its branch, and the worktree when it is one. */
type Place = { repo: string; branch?: string; worktree?: string }
const place: { at: number; value?: Place } = { at: 0 }

/** The folder's repository by one `git rev-parse` (its common folder, its top, its branch); a folder outside git, by its name. */
async function placeOf($: EngineInterface): Promise<Place | undefined> {
  // The session's root follows a worktree it moves into or a /cd; the folder it started in is the fallback.
  const cwd = (await quietly(() => $.session.root())) || overview.cwd
  if (cwd === '') return undefined
  const base = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  const ran = await quietly(() => $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel', '--abbrev-ref', 'HEAD']))
  const [common = '', top = '', branch = ''] = ran?.exitCode === 0 ? ran.stdout.trim().split('\n') : []
  if (common === '') return { repo: base(cwd) }
  const root = common.replace(/[\\/]\.git[\\/]?$/, '')
  return {
    repo: base(root),
    ...(branch !== '' && branch !== 'HEAD' ? { branch } : {}),
    // A worktree's top is not the repository's own folder.
    ...(top !== '' && top !== root ? { worktree: base(top) } : {}),
  }
}

/** Writes the map when the board has changed, and the heartbeat every few seconds, so the window knows the session lives. */
async function share($: EngineInterface, setup: Setup): Promise<void> {
  const dir = sharing.dir
  if (dir === undefined) return
  await quietly(async () => {
    const state = await read($, board)
    const now = await $.clock.now()
    const seen = JSON.stringify(state)
    const warnings = warningsOf(state, now, setup.t)
    // Without animation nothing fades the map's marks out by itself, so a still map is written again when its drawing changes.
    const isMoved = seen !== sharing.written
    // The picture is built only when the board moved, or, still, to see whether its drawing did.
    const svg = isMoved || setup.motion === 'reduced' ? framedMap(state, now, setup, 920, 860) : undefined
    const isChanged = isMoved || (svg !== undefined && svg !== sharing.still)
    // The repository and branch, asked again every half minute while the window is wanted: a checkout changes the branch.
    // Asked aside, never awaited here: a slow git must not hold the map; its answer goes in with the next write.
    if (now - place.at >= 30_000) {
      place.at = now
      void quietly(async () => {
        place.value = await placeOf($)
      })
    }
    if (isChanged && svg !== undefined) {
      sharing.written = seen
      sharing.still = svg
      await $.fs.write(`${dir}/map.svg`, svg)
    }
    // The top line, warnings, changed line, pinned lines and rows, as the pane writes them; again when the top line's time moves on.
    const line = describeNow(state, setup.t, now)
    const pinned = pinnedLines(state.entries, now, setup.t)
    const changed = changedLine(state.changed, setup.t) ?? null
    const said = [line.text, ...warnings.map(w => w.line), changed?.line ?? '', ...pinned.map(p => p.line)].join('\n')
    if (isChanged || said !== sharing.line) {
      sharing.line = said
      const feed = {
        now: line.text,
        nowTone: line.tone,
        plan: planLines(state.plan, setup.t),
        warnings: warnings.map(w => w.line),
        changed,
        pinned,
        agents: agentList(state),
        rows: feedLines(state.entries, setup.t, state.agentNames, state.turns, setup.contextCost),
        ...logFeed(state, setup),
        empty: setup.t.nothingYet,
        legend: setup.t.legend,
        windowRows: setup.windowRows,
        ...(place.value === undefined ? {} : { place: place.value }),
      }
      await $.fs.write(`${dir}/feed.json`, JSON.stringify(feed))
    }
    if (now - sharing.beat >= 3000) {
      sharing.beat = now
      await $.fs.write(`${dir}/alive`, String(now))
    }
  })
}

/** The folder a session's temporary files go in: TMPDIR, or /tmp. */
async function tmpDir($: EngineInterface): Promise<string> {
  return ((await $.env.get('TMPDIR')) ?? '') || '/tmp'
}

/**
 * Opens renderer/view.mjs with `args` in a split of the current Windows Terminal tab, for a session from WSL; else
 * the command is only returned, to run by hand. `withChromium` hands it the Chromium found here, for the picture.
 */
async function splitTab($: EngineInterface, args: string[], withChromium: boolean): Promise<{ isOpen: boolean; command: string[] }> {
  const view = `${$.plugin.root}/renderer/view.mjs`
  // Found here, where the session's PATH has them: a pane wsl.exe opens starts with a bare PATH that has neither.
  const node = (await quietly(() => $.process.run(['sh', '-c', 'command -v node'])))?.stdout.trim() || 'node'
  const chromium = withChromium
    ? ((await quietly(() => $.process.run(['sh', '-c', 'command -v chromium || command -v google-chrome'])))?.stdout.trim().split('\n')[0] ?? '')
    : ''
  const found = chromium !== '' && !/\s/.test(chromium) ? [`WORKMAP_CHROMIUM=${chromium}`] : []
  const command = ['env', ...found, node, view, ...args]
  const distro = (await $.env.get('WSL_DISTRO_NAME')) ?? ''
  if (distro !== '') {
    const opened = await quietly(() =>
      $.process.run(['wt.exe', '-w', '0', 'split-pane', '--vertical', '--size', '0.45', 'wsl.exe', '-d', distro, '--', ...command]),
    )
    if (opened?.exitCode === 0) return { isOpen: true, command }
  }
  return { isOpen: false, command }
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
    sharing.dir = `${await tmpDir($)}/workmap-live-${Math.random().toString(36).slice(2, 10)}`
    await share($, setup)
    sharing.timer = $.clock.every(250, () => void share($, setup))
  }
  // From WSL the map is a split of the terminal's tab, the window's page drawn as Sixel, and an Edge window where the split
  // cannot open; `edge` asks for Edge first.
  const isWsl = ((await $.env.get('WSL_DISTRO_NAME')) ?? '') !== ''
  const opened = { isOpen: true, text: setup.t.windowOpened }
  if (isWsl && setup.terminalWindow === 'edge' && (await appWindow($, sharing.dir ?? ''))) return opened
  const { isOpen, command } = await splitTab($, [sharing.dir ?? ''], true)
  if (isOpen) return opened
  if (isWsl && setup.terminalWindow !== 'edge' && (await appWindow($, sharing.dir ?? ''))) return opened
  return { isOpen: false, text: setup.t.windowByHand(command.join(' ')) }
}

/** Opens the live map in an Edge app window: renderer/serve.mjs starts the local server unless one runs, then Edge. */
async function appWindow($: EngineInterface, dir: string): Promise<boolean> {
  const live = /\/workmap-live-([a-z0-9]+)$/.exec(dir)?.[1]
  if (live === undefined) return false
  const node = (await quietly(() => $.process.run(['sh', '-c', 'command -v node'])))?.stdout.trim() || 'node'
  const opened = await quietly(() => $.process.run([node, `${$.plugin.root}/renderer/serve.mjs`, '--open', live]))
  return opened?.exitCode === 0
}

/** Whether the session runs from WSL in Windows Terminal. A session in the background has the profile's id though not the tab's. */
async function inWindowsTerminal($: EngineInterface): Promise<boolean> {
  const distro = (await $.env.get('WSL_DISTRO_NAME')) ?? ''
  const tab = (await $.env.get('WT_SESSION')) ?? ''
  const profile = (await $.env.get('WT_PROFILE_ID')) ?? ''
  return distro !== '' && (tab !== '' || profile !== '')
}

/** Whether the map is the window and not the pane: in Windows Terminal from WSL, where the pane can draw it only in cells. */
async function windowIsTheMap($: EngineInterface, setup: Setup): Promise<boolean> {
  if (!setup.terminalMap || setup.terminalWindow === 'off' || picture.canShow === true) return false
  return inWindowsTerminal($)
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

/** Every call the board keeps and what filtering it needs: the station names, the keys' hint, the errors' word. */
function logFeed(state: Board, setup: Setup) {
  const { t } = setup
  return {
    log: logCalls(state, setup),
    stations: STATIONS.map(s => ({ id: s.id, name: t.stations[s.id] })),
    keys: t.windowKeys,
    keyHelp: t.keyHelp,
    errorsWord: t.logErrors,
    local: { title: t.localTitle, hosts: (state.local ?? []).map(l => l.host) },
  }
}

/** The log: every kept call, and a last line when older ones are gone, counted from the stations' totals. */
const logCalls = (state: Board, setup: Setup) =>
  logLines(state.entries, setup.t, state.agentNames, Object.values(state.counts).reduce((n, c) => n + (c ?? 0), 0), setup.contextCost)

/** `/workmap log`: every call the board keeps, newest first, one a line. */
async function logText($: EngineInterface, setup: Setup): Promise<string> {
  const lines = logCalls(await read($, board), setup)
  return lines.length === 0 ? setup.t.nothingYet : lines.map(l => l.line).join('\n')
}

/** `/workmap changed`: every changed file, most edits first, one a line. */
async function changedFiles($: EngineInterface, setup: Setup): Promise<string> {
  const items = changedItems((await read($, board)).changed)
  return items.length === 0 ? setup.t.nothingChanged : items.join('\n')
}

/** `/workmap usage`: the context's fill, its categories, the rate-limit windows and the cost; a figure the engine lacks is left out. */
async function usageLines($: EngineInterface, setup: Setup): Promise<string> {
  const { t } = setup
  const state = await read($, board)
  const now = await $.clock.now()
  const context = (await quietly(() => $.session.usage({ breakdown: 'summary' })))?.context
  const percent = context?.percent ?? state.context
  const breakdown = context?.breakdown
  const window = breakdown === undefined ? 0 : breakdown.rawMaxTokens || breakdown.maxTokens
  const lines = [
    ...(percent === undefined ? [] : [t.usageContext(percent, context?.tokens, context?.window)]),
    ...(breakdown?.categories ?? [])
      .filter(category => category.kind !== 'deferred' && category.tokens > 0 && window > 0)
      .map(category => `${category.name}: ${Math.max(1, Math.round((category.tokens / window) * 100))}%`),
    ...(state.limits ?? []).map(({ kind, percent: used, resetsAt }) =>
      [`${t.limitNames[kind]} ${Math.round(used)}%`, ...[untilText(resetsAt, now, t)].flatMap(until => (until === undefined ? [] : [t.resetsIn(until)]))].join(
        ' · ',
      ),
    ),
    ...(state.heaviest === undefined || state.heaviest.length === 0
      ? []
      : [t.usageHeaviest(state.heaviest.map(h => `${h.label} +${tokensShort(h.tokens)}`).join('; '))]),
    ...[costText(state.cost)].flatMap(cost => (cost === undefined ? [] : [t.estimatedCost(cost)])),
  ]
  return lines.length === 0 ? t.usageNothing : lines.join('\n')
}

/** `/workmap recap`: the session in a few lines, or a line saying there is nothing yet. */
async function recapText($: EngineInterface, setup: Setup): Promise<string> {
  const state = await read($, board)
  const now = await $.clock.now()
  const startedAt = await quietly(async () => (await $.session.usage()).startedAt)
  // Each station's share of the busy time, for the stations that have any: the model and the person keep none.
  const busy = Object.entries(state.busyMs ?? {}).filter(([, ms]) => (ms ?? 0) > 0)
  const total = busy.reduce((sum, [, ms]) => sum + (ms ?? 0), 0)
  const shares = total > 0 ? (Object.fromEntries(busy.map(([id, ms]) => [id, (ms ?? 0) / total])) as Partial<Record<StationId, number>>) : undefined
  const lines = recapLines(state, startedAt, now, setup.t, shares)
  return lines.length === 0 ? setup.t.recapNothing : lines.join('\n')
}

/** `/workmap`: the pane, or in Windows Terminal the window; `window` asks for the window anywhere. */
async function runCommand($: EngineInterface, args: string, setup: Setup, opening: Opening): Promise<{ text: string }> {
  if (args.trim() === 'changed') return { text: await changedFiles($, setup) }
  if (args.trim() === 'log') return { text: await logText($, setup) }
  if (args.trim() === 'usage') return { text: await usageLines($, setup) }
  if (args.trim() === 'recap') return { text: await recapText($, setup) }
  if (args.trim() === 'help') {
    // The legend, then the commands: the map window's ? shows only its keys.
    const { title, commands } = setup.t.commandHelp
    const wide = Math.max(...commands.map(c => c.command.length))
    return { text: [...setup.t.legend, '', title, ...commands.map(c => `${c.command.padEnd(wide)}  ${c.label}`)].join('\n') }
  }
  if (args.trim() === 'window') return { text: (await openWindow($, setup)).text }
  if (args.trim() === 'all') return { text: await showOverview($, setup) }
  if (windowed.isMap) return { text: await showWindow($, setup, opening) }
  const opened = await $.ui.open(opening)
  return { text: opened.isPlaced ? setup.t.opened : setup.t.cannotOpen(String(opened.reason)) }
}

/** Stops keeping the live map and removes its folder; a window still open sees its heartbeat go and closes. */
async function stopSharing($: EngineInterface): Promise<void> {
  const dir = sharing.dir
  sharing.timer?.cancel()
  Object.assign(sharing, { dir: undefined, timer: undefined, written: '', still: '', line: '', beat: 0 })
  if (dir !== undefined && /\/workmap-live-[a-z0-9]+$/.test(dir)) await quietly(() => $.process.run(['rm', '-rf', '--', dir]))
}

/**
 * Every session with a surface keeps a small status file in one folder of the person's own, so that `/workmap all` and
 * renderer/view.mjs --all can show them side by side. It is written when the status changes and every five seconds,
 * and goes with the session.
 */
const overview: { timer?: Timer; dir?: string; cwd: string; startedAt: number; json: string; wroteAt: number; file?: string } = {
  cwd: '',
  startedAt: 0,
  json: '',
  wroteAt: 0,
}

/** The id for a session whose own is no fit for a file name: made once per process. */
const fallbackId = Math.random().toString(36).slice(2, 12)

/** A status file older than this at a session's start is a session killed without an end. */
const SESSION_GONE_MS = 3_600_000
/** A status that has not changed is written again this often, so that its `updatedAt` shows the session lives. */
const HEARTBEAT_MS = 5000

/**
 * The status files' folder, the person's own: in XDG_RUNTIME_DIR, else in ~/.cache. With neither, as on Windows,
 * there is none and no status is kept. A path that is not absolute counts as not set.
 */
async function sessionsDir($: EngineInterface): Promise<string | undefined> {
  const runtime = (await $.env.get('XDG_RUNTIME_DIR')) ?? ''
  if (runtime.startsWith('/')) return `${runtime}/workmap-sessions`
  const home = (await $.env.get('HOME')) ?? ''
  return home.startsWith('/') ? `${home}/.cache/workmap/sessions` : undefined
}

/** Writes the session's status when it has changed, and at least every five seconds. */
async function writeStatus($: EngineInterface, setup: Setup): Promise<void> {
  await quietly(async () => {
    const dir = overview.dir
    if (dir === undefined) return
    const state = await read($, board)
    const now = await $.clock.now()
    const id = (await quietly(() => $.session.id())) ?? ''
    const file = `${dir}/${/^[\w-]+$/.test(id) ? id : fallbackId}.json`
    // After a /clear the session goes on under another id: the old file goes.
    if (overview.file !== undefined && overview.file !== file) await quietly(() => $.process.run(['rm', '-f', '--', overview.file ?? '']))
    const status = stateOf(state)
    const tile: Omit<Tile, 'updatedAt'> = {
      name: overview.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? overview.cwd,
      state: status,
      word: setup.t.states[status],
      now: describeNow(state, setup.t, now, false).text,
      ...(state.context === undefined ? {} : { context: Math.round(state.context) }),
      startedAt: overview.startedAt,
      fault: Object.values(state.faults ?? {}).some(count => count > 0),
      ...(sharing.dir === undefined ? {} : { live: sharing.dir }),
    }
    const json = JSON.stringify(tile)
    if (file === overview.file && json === overview.json && now - overview.wroteAt < HEARTBEAT_MS) return
    // A tick still running when the session ended must not bring the file back.
    if (overview.timer === undefined) return
    await $.fs.write(file, JSON.stringify({ ...tile, updatedAt: now }))
    if (overview.timer === undefined) await $.process.run(['rm', '-f', '--', file])
    else Object.assign(overview, { file, json, wroteAt: now })
  })
}

/** Takes away the status files of sessions killed without an end: those not written for an hour, and no other file. */
async function sweepSessions($: EngineInterface): Promise<void> {
  await quietly(async () => {
    const dir = overview.dir
    if (dir === undefined) return
    const now = await $.clock.now()
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !/^[\w-]+\.json$/.test(entry.name)) continue
      // One file that cannot be read or removed leaves the others to their turn; a file that is no status goes by its age.
      await quietly(async () => {
        const path = `${dir}/${entry.name}`
        const parsed = await quietly(async () => (JSON.parse(String(await $.fs.read(path))) as { updatedAt?: unknown } | null)?.updatedAt)
        const at = typeof parsed === 'number' ? parsed : entry.mtimeMs
        if (now - at > SESSION_GONE_MS) await $.process.run(['rm', '-f', '--', path])
      })
    }
  })
}

/** Starts keeping the status, once: from a session's start when it has a surface, else from the attach; never without a folder. */
async function startStatus($: EngineInterface, setup: Setup, cwd?: string): Promise<void> {
  if (cwd !== undefined) overview.cwd = cwd
  if (overview.timer !== undefined) return
  const dir = await sessionsDir($)
  overview.dir = dir
  if (dir === undefined) return
  overview.startedAt = await $.clock.now()
  // The folder is made the person's alone before the first write; one already there keeps its mode.
  await quietly(() => $.process.run(['mkdir', '-p', '-m', '700', '--', dir]))
  if (overview.timer === undefined) overview.timer = $.clock.every(1000, () => void writeStatus($, setup))
}

/** Stops keeping the status and takes the file away. */
async function stopStatus($: EngineInterface): Promise<void> {
  overview.timer?.cancel()
  const file = overview.file
  Object.assign(overview, { timer: undefined, json: '', wroteAt: 0, file: undefined })
  if (file !== undefined) await quietly(() => $.process.run(['rm', '-f', '--', file]))
}

/** The tiles of the sessions that live, waiting first, as `/workmap all` answers them outside Windows Terminal. */
async function overviewText($: EngineInterface, setup: Setup, dir: string | undefined): Promise<string> {
  if (dir === undefined) return setup.t.overviewNone
  const now = await $.clock.now()
  const entries = (await quietly(() => $.fs.list(dir))) ?? []
  const texts: string[] = []
  for (const entry of entries) {
    if (entry.kind === 'file' && /^[\w-]+\.json$/.test(entry.name)) texts.push(String((await quietly(() => $.fs.read(`${dir}/${entry.name}`))) ?? ''))
  }
  const tiles = tilesFrom(texts, now)
  return tiles.length === 0 ? setup.t.overviewNone : tiles.map(tile => tileText(tile, now, setup.t)).join('\n')
}

/** `/workmap all`: in Windows Terminal a window beside this one, running view.mjs --all; elsewhere the tiles as text. */
async function showOverview($: EngineInterface, setup: Setup): Promise<string> {
  if (overview.timer !== undefined) await writeStatus($, setup)
  const dir = await sessionsDir($)
  if (dir === undefined || !(await inWindowsTerminal($))) return overviewText($, setup, dir)
  const { isOpen, command } = await splitTab($, ['--all', dir], false)
  return isOpen ? setup.t.overviewOpened : setup.t.windowByHand(command.join(' '))
}

/**
 * What a settings hook added to the context: shown as the hook acting and, when it brought records, as memory. With
 * `ahead`, the rows wait loose for the turn the message starts, their ids kept there.
 */
async function noteContext($: EngineInterface, context: readonly string[] | undefined, when: string, setup: Setup, ahead?: string[]): Promise<void> {
  const { t } = setup
  const text = (context ?? []).join('\n')
  if (text.trim() === '') return
  const note = async (start: Start): Promise<void> => {
    const id = await begin($, ahead === undefined ? start : { ...start, loose: true })
    if (id !== undefined) ahead?.push(id)
  }
  const ids = setup.hookRecords ? memoryIds(text) : []
  if (ids.length === 0) {
    await note({ station: 'hooks', label: t.addedContext(when), status: 'ok' })
    return
  }
  await note({ station: 'hooks', label: t.addedMemory(when), status: 'ok' })
  const shown = ids.slice(0, 6).map(id => `#${id}`).join(' ')
  await note({
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

  // A call's id to its row's, until the call answers: where a permission prompt finds its row.
  const calls = new Map<string, string>()

  // The model the main loop last ran on: in this session, or else in the last session in this folder.
  // The one thing the map keeps between sessions, and only its name.
  let lastModel: string | undefined
  let modelKey = 'model'
  /** The context's fill and window at the last measurement; forgotten at a session's start and end, so a /clear marks nothing. */
  let lastContext: { percent: number; window: number } | undefined
  // With `contextCost`: the main loop's calls since its last model step, and the context that step was answered over.
  // Lost with a reload, which costs at most one step's figures.
  let awaiting: string[] = []
  let lastTokens: number | undefined
  /**
   * The rows a person's prompt brought before its turn started, its settings hooks' and a typed skill's: they join the
   * turn when it starts. Unset while no prompt waits for its turn.
   */
  let ahead: string[] | undefined

  const opening = { id: PANE, title: t.title, ...(setup.terminalMap ? { columns: MAP_COLUMNS, rows: MAP_ROWS } : {}) }

  on('session.start', async ($, e, next) => {
    await quietly(() => $.command.register({ name: 'workmap', description: t.command, argumentHint: '[window | help | changed | usage | recap | log | all]' }))
    picture.canShow = setup.terminalMap && setup.terminalPicture === 'auto' && (await quietly(() => showsPictures($))) === true
    windowed.isAsked = false
    // A -p run or the SDK draws nowhere (surface null): no window.
    windowed.isMap = e.surface === 'terminal' && (await quietly(() => windowIsTheMap($, setup))) === true
    lastContext = undefined
    lastTokens = undefined
    awaiting = []
    ahead = undefined
    // A -p run or the SDK shows nowhere: it keeps no status.
    if (e.surface !== null) {
      await quietly(() => startStatus($, setup, e.cwd))
      void sweepSessions($)
    } else overview.cwd = e.cwd
    // With no surface attached yet an open has nowhere to go; session.attach opens the pane then. A roster that
    // cannot be read is tried as before.
    const surfaces = await quietly(() => $.session.surfaces())
    if (!windowed.isMap && (surfaces === undefined || surfaces.length > 0)) void quietly(() => $.ui.open(opening))
    await quietly(async () => {
      modelKey = `model:${e.cwd}`
      const kept = await $.store.get(modelKey)
      if (lastModel === undefined && typeof kept === 'string') lastModel = kept
    })
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (!windowed.isMap) windowed.isMap = e.surface === 'terminal' && (await quietly(() => windowIsTheMap($, setup))) === true
    if (!windowed.isMap) void quietly(() => $.ui.open(opening))
    await quietly(() => startStatus($, setup))
    return next(e)
  })

  on('command.run', { command: 'workmap' }, ($, e) => runCommand($, e.args, setup, opening))

  on('session.end', async ($, e, next) => {
    lastContext = undefined
    const result = await next(e)
    // A /clear or a resume ends the conversation but not the process: the window and the status stay for what comes next.
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      await stopSharing($)
      await stopStatus($)
    }
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
    const name = Array.from(clean(e.description ?? ''))
      .slice(0, 24)
      .join('')
    if (agentId !== undefined && name !== '') {
      await quietly(() =>
        update($, board, b => ({ ...b, agentNames: Object.fromEntries([...Object.entries(b.agentNames ?? {}), [agentId, name]].slice(-12)) })),
      )
    }
    if (agentId !== undefined) await noteSpawn($, agentId, e)
    return spawned
  })

  on('turn.start', async ($, e, next) => {
    const notice = e.agentId === undefined ? taskNotice(e.text) : undefined
    // Any turn of the main loop, the person's or one a background task starts, has Claude thinking again.
    if (e.agentId === undefined) await quietly(() => update($, board, b => ({ ...b, phase: 'thinking' as const, answeredAt: undefined })))
    if (notice !== undefined) {
      // A background task reporting back is no message of the person's.
      if (notice.status !== undefined) await settle($, notice.id, notice.status)
    } else if (e.agentId === undefined && e.text !== '') {
      // A new message clears what went wrong on the way to the last answer, and opens a turn with the rows it brought ahead.
      const brought = new Set(ahead ?? [])
      ahead = undefined
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => {
          const n = (b.turns?.[b.turns.length - 1]?.n ?? 0) + 1
          const joined = b.entries.filter(x => brought.has(x.id) && x.station !== 'model' && x.station !== 'you')
          const turnCounts = joined.reduce<Board['turnCounts']>((c, x) => oneMore(c, x.station), {})
          return {
            ...b,
            ...(b.faults === undefined ? {} : { faults: {} }),
            ...(b.blocks === undefined ? {} : { blocks: {} }),
            ...(b.turnCounts === undefined && joined.length === 0 ? {} : { turnCounts }),
            entries: b.entries.map(x => (brought.has(x.id) ? { ...x, turn: n } : x)),
            turns: [...(b.turns ?? []), { n, startedAt: now, calls: joined.length, errors: 0 }].slice(-TURNS),
          }
        })
      })
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
    // The calls whose answers this step is sent with: those made since the last step. A call this step starts is the next one's.
    const answered = isMain ? awaiting : []
    if (isMain) awaiting = []
    const id = await begin($, {
      station: 'model',
      label: `${shortModel(e.model)} · ${t.step(e.index + 1)}${isMain ? '' : ` · ${t.subagent}`}`,
      from: isMain ? 'core' : 'agents',
      ...(isMain ? { patch: { model: e.model, step: e.index + 1 } } : { agentId: e.agentId }),
    })
    try {
      return yield* next(e)
    } finally {
      if (isMain) {
        const context = await contextOf($)
        await finish($, id, 'ok', context.patch)
        if (setup.contextCost) {
          await charge($, answered, lastTokens, context.tokens)
          lastTokens = context.tokens
        }
      } else {
        await finish($, id, 'ok')
      }
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
          ...closeRuns(b, x => x.agentId === agentId || x.task === agentId, now),
        }))
      })
    } else {
      // What the last step's calls added would show only in the next turn's first reading, beside the next message: none.
      awaiting = []
      await begin($, {
        station: 'you',
        label: e.isAborted ? t.turnAborted : t.answerReady,
        status: e.isAborted ? 'err' : 'ok',
        ...(e.isAborted ? {} : { mark: 'done' as const }),
      })
      if (!e.isAborted && setup.notify) void quietly(() => $.ui.notify(t.notifyDone, { title: t.title, key: 'workmap-wait' }))
      // An interrupted call never reports back; left alone its row would pulse for the rest of the session.
      await quietly(async () => {
        const now = await $.clock.now()
        // An answer leaves the turn done, and says when; an interrupted turn, nothing at work.
        await update($, board, b => ({
          ...b,
          phase: e.isAborted ? undefined : ('done' as const),
          answeredAt: e.isAborted ? undefined : now,
          ...inTurn(b, t => ({ ...t, endedAt: now })),
          ...closeRuns(b, x => x.from === 'core' && x.task === undefined, now),
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
      if (waits && setup.notify) void quietly(() => $.ui.notify(t.notifyWaiting(seen.label), { title: t.title, key: 'workmap-wait' }))
      return begin($, {
        ...seen,
        ...(e.agentId === undefined ? { from: 'core' as const } : { from: 'agents' as const, agentId: e.agentId }),
        ...(waits ? { waits: true as const } : {}),
        ...(seen.station === 'files' && actOf(String(e.tool)) !== undefined ? { act: actOf(String(e.tool)) } : {}),
      })
    })
    // A subagent's calls fill its own context, which the engine does not report: only the main loop's are counted.
    if (setup.contextCost && id !== undefined && e.agentId === undefined) awaiting = [...awaiting, id].slice(-KEEP)
    if (id !== undefined && e.tool_use_id !== undefined) {
      calls.set(e.tool_use_id, id)
      keepNewest(calls, REFUSALS_KEPT)
    }
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
      // A file or a server of a call that went through becomes a satellite, an edit marking it edited.
      if (!wasRefused && ran.isError !== true) await quietly(() => keepSatellite($, String(e.tool), e as unknown as Record<string, unknown>, setup))
      // A localhost address the call named joins the local servers, whether or not it answered: the window shows if it is up.
      const hosts = wasRefused ? [] : localHostsIn(e as unknown as Record<string, unknown>)
      if (hosts.length > 0) {
        await quietly(async () => {
          const now = await $.clock.now()
          await update($, board, b => ({ ...b, local: withLocal(b.local, hosts, now) }))
        })
      }
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
      // A file written or edited is counted by its label, a subagent's as well; a refused or failed call changes nothing.
      if (CHANGING_TOOLS.has(String(e.tool)) && !wasRefused && ran.isError !== true) {
        await quietly(() => {
          const label = classify(e.tool, e as unknown as Record<string, unknown>, setup).label
          return update($, board, b => {
            const had = b.changed ?? {}
            const count = (Object.hasOwn(had, label) ? (had[label] ?? 0) : 0) + 1
            const others = Object.entries(had).filter(([name]) => name !== label)
            return { ...b, changed: Object.fromEntries([...others, [label, count]].slice(-CHANGED)) }
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
      // With errorReasons on, a failed call also keeps the first line of its error, cleaned and cut; a shell's exit line is no reason.
      const failed = !wasRefused && ran.isError === true
      const body = String(ran.text ?? '').replace(/^\s*(?:Error: )?Exit code \d{1,3}\b[^\n]*\n?/, '')
      const reason = setup.errorReasons && failed ? firstText(body) : undefined
      await finish($, id, wasRefused ? 'block' : ran.isError === true ? 'err' : 'ok', undefined, code === undefined ? undefined : Number(code), reason)
      return ran
    } catch (failure) {
      await finish($, id, 'err')
      throw failure
    } finally {
      if (e.tool_use_id !== undefined) calls.delete(e.tool_use_id)
    }
  })

  // The mode put the call to a decider: a person's dialog, or auto mode's classifier. A second unsettled reads as needs you.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) {
      const call = e.tool_use_id
      await askOn($, calls, call, true)
      $.clock.after(1000, () => void waitsOnYou($, setup, calls, call))
    }
    return verdict
  })

  // The classifier decides at the judge, and a call that runs was allowed: neither waits on a person.
  on('tool.judge', async ($, e, next) => {
    await askOn($, calls, e.tool_use_id, false)
    return next(e)
  })

  on('tool.run', async ($, e, next) => {
    await askOn($, calls, e.tool_use_id, false)
    return next(e)
  })

  // On a Team or Enterprise login a guard of the organisation's sends these five events on past every mod, with a
  // notice in the transcript each time. With `guardedHooks` off the mod adds no hook on them.
  if (setup.guardedHooks) {
    on('classic.PreToolUse', async ($, e, next) => {
      const startedAt = (await quietly(() => $.clock.now())) ?? 0
      const decided = await next(e)
      const endedAt = (await quietly(() => $.clock.now())) ?? startedAt
      if (decided.deny !== undefined) {
        if (e.tool_use_id !== undefined) {
          refused.add(e.tool_use_id)
          keepNewest(refused, REFUSALS_KEPT)
        }
        await begin($, { station: 'hooks', label: (setup.hookReasons ? firstLine(decided.deny) : '') || t.stopped(e.tool), status: 'block', startedAt })
      } else if (decided.ask !== undefined) {
        await begin($, { station: 'hooks', label: t.askedPermission(e.tool), status: 'ok', startedAt, endedAt })
      } else if (endedAt - startedAt >= 400) {
        // A check that took a moment is worth seeing; the instant ones are not.
        await begin($, { station: 'hooks', label: t.checkBefore(e.tool), status: 'ok', startedAt, endedAt })
      }
      return decided
    })
  }

  // A notification delivered into a running turn starts no turn of its own; this is where it is seen. Any other prompt
  // comes before its turn, and what its settings hooks and a typed skill add waits for that turn.
  on('prompt.submit', async ($, e, next) => {
    await quietly(async () => {
      if (e.origin?.kind !== 'task-notification') {
        ahead ??= []
        return
      }
      const notice = taskNotice(e.text)
      if (notice?.status !== undefined) await settle($, notice.id, notice.status)
    })
    return next(e)
  })

  if (setup.guardedHooks) {
    on('classic.UserPromptSubmit', async ($, e, next) => {
      const result = await next(e)
      await noteContext($, result.additionalContext, t.toMessage, setup, ahead)
      return result
    })

    on('classic.SessionStart', async ($, e, next) => {
      const result = await next(e)
      await noteContext($, result.additionalContext, t.atStart, setup)
      return result
    })

    on('skill.prompt', async ($, e, next) => {
      const result = await next(e)
      // A skill the model called is already on the map as its tool call; this one catches a typed slash command, which
      // waits for the turn its prompt starts, or else counts on the open one.
      await quietly(async () => {
        const now = await $.clock.now()
        const waiting = ahead
        let added: string | undefined
        await update($, board, b => {
          const label = clean(e.skill)
          const entry: Entry = { id: newId(now), station: 'skills', label, from: 'core', startedAt: now, endedAt: now, status: 'ok' }
          added = b.entries.some(x => x.station === 'skills' && x.status === 'run' && x.label === label) ? undefined : entry.id
          if (added === undefined) return b
          const open = waiting === undefined ? b.turns?.[b.turns.length - 1] : undefined
          return {
            ...b,
            entries: kept([...b.entries, open === undefined ? entry : { ...entry, turn: open.n }]),
            counts: { ...b.counts, skills: (b.counts.skills ?? 0) + 1 },
            ...(waiting === undefined ? { turnCounts: oneMore(b.turnCounts, 'skills'), ...inTurn(b, x => ({ ...x, calls: x.calls + 1 })) } : {}),
          }
        })
        if (added !== undefined) waiting?.push(added)
      })
      return result
    })

    on('session.compact', async ($, e, next) => {
      const before = (await quietly(() => read($, board)))?.phase
      const id = await begin($, { station: 'model', label: t.compacting, patch: { phase: 'compacting' } })
      // After a compaction the context starts again: no call before it gets a figure, and the next step only sets the mark.
      awaiting = []
      lastTokens = undefined
      try {
        return await next(e)
      } finally {
        await finish($, id, 'ok', (await contextOf($)).patch)
        await quietly(() => update($, board, b => ({ ...b, phase: before })))
      }
    })
  }

  // Without session.compact the mark of a compaction is a sharp fall of the context between two measurements.
  on('session.measure', async ($, e, next) => {
    await quietly(async () => {
      // The windows and the cost the engine has, whatever guardedHooks is; one it lacks is left out.
      const limits: NonNullable<Board['limits']> = []
      for (const { kind, percentUsed, resetsAt } of e.rateLimits) {
        if (kind === 'five_hour' || kind === 'seven_day') limits.push({ kind, percent: percentUsed, ...(resetsAt === undefined ? {} : { resetsAt }) })
      }
      // The first time a plan limit reads reached, the cost so far is what the plan covered; the rest is billed.
      const isReached = limits.some(l => l.percent >= 100)
      await update($, board, b => ({
        ...b,
        limits: limits.length > 0 ? limits : undefined,
        cost: e.cost?.usd,
        ...(isReached && b.paidFrom === undefined ? { paidFrom: b.cost ?? 0 } : {}),
        ...peaked(b, e.context.percent),
      }))
    })
    await quietly(async () => {
      const { percent, window } = e.context
      if (typeof percent !== 'number') return
      // A switch to a model with another window moves the fill with no compaction.
      const fell = lastContext !== undefined && lastContext.window === window && lastContext.percent - percent >= 30
      lastContext = { percent, window }
      if (fell) {
        awaiting = []
        lastTokens = undefined
      }
      if (!setup.guardedHooks && fell) await begin($, { station: 'model', label: t.compacted, status: 'ok' })
    })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, board)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    // Theme keys, so the rows read on a light theme as well as on a dark one.
    const rows = feedLines(state.entries, t, state.agentNames, state.turns, setup.contextCost).map(({ line, tone, isBold }) => (
      <Text
        mono
        size="footnote"
        bold={isBold === true}
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
    const changed = changedLine(state.changed, t)
    const pinned = pinnedLines(state.entries, now, t)
    const warnings = warningsOf(state, now, t)
    // A running turn is looked at again every five seconds, so a warning comes in time.
    const isRunning = ['thinking', 'running'].includes(stateOf(state))
    const still = setup.motion === 'reduced' ? stillChangeIn(state, now) : undefined
    const next = Math.min(
      line.next ?? Infinity,
      pinned.length > 0 ? 1000 - (now % 1000) : Infinity,
      isRunning ? 5000 - (now % 5000) : Infinity,
      still ?? Infinity,
    )
    tickLine($, Number.isFinite(next) ? next : undefined)
    const current = (
      <Box flexDirection="column">
        <Text mono size="footnote" color={line.tone === 'wait' ? 'warning' : line.tone === 'done' ? 'success' : undefined} bold={line.tone === 'wait'}>
          {line.text}
        </Text>
        {warnings.map(w => (
          <Text mono size="footnote" color="warning">
            {w.line}
          </Text>
        ))}
        {planLines(state.plan, t).map(p => (
          <Text mono size="footnote" color={p.tone === 'run' ? 'claude' : undefined} dimColor={p.tone === 'ok'} bold={p.isBold === true}>
            {p.line}
          </Text>
        ))}
        {changed === undefined ? null : (
          <Text mono size="footnote">
            {changed.line}
          </Text>
        )}
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
        const tally = STATIONS.filter(s => (state.counts[s.id] ?? 0) > 0)
          .map(s => `${t.stations[s.id]} ${state.counts[s.id]}${(state.faultTotals?.[s.id] ?? 0) > 0 ? ` · ${state.faultTotals?.[s.id]}✕` : ''}`)
          .join(' · ')
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
