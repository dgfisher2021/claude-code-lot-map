import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, Entry, StationId, Status } from '../types'
import { STATIONS, classify, clean, describeNow, drawMap, firstLine, foldRows, formatMs, framedMap, memoryIds, setupFrom, shortModel, taskNotice, taskOf } from './map'
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
  /** Adds nothing to the station's count: a second view of something already counted. */
  uncounted?: boolean
  startedAt?: number
  endedAt?: number
  patch?: Partial<Pick<Board, 'model' | 'step' | 'switchedAt'>>
}

/** The newest rows, and beside them every background task still going, however long ago it started. */
const kept = (entries: Entry[]): Entry[] => {
  const from = entries.length - KEEP
  return from <= 0 ? entries : entries.filter((e, i) => i >= from || (e.status === 'run' && e.task !== undefined))
}

const isFault = (status: Status): boolean => status === 'err' || status === 'block'

const oneMore = (faults: Board['faults'], station: StationId): Board['faults'] => ({ ...faults, [station]: (faults?.[station] ?? 0) + 1 })

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
    }
    await update($, board, b => ({
      ...b,
      ...start.patch,
      entries: kept([...b.entries, entry]),
      counts: start.uncounted ? b.counts : { ...b.counts, [entry.station]: (b.counts[entry.station] ?? 0) + 1 },
      // What a hook brought to memory unasked is counted apart from what was asked for.
      ...(entry.station === 'memory' && entry.from === 'inbound' && !start.uncounted ? { pushed: (b.pushed ?? 0) + 1 } : {}),
      // An interrupted turn lands on the person's own station and is no fault of anything.
      ...(isFault(entry.status) && entry.station !== 'you' ? { faults: oneMore(b.faults, entry.station) } : {}),
      ...(entry.agentId !== undefined && !(b.agents ?? []).includes(entry.agentId)
        ? { agents: [...(b.agents ?? []), entry.agentId].slice(-CREW) }
        : {}),
    }))
    return entry.id
  })
}

async function finish($: EngineInterface, id: string | undefined, status: Status, patch?: Pick<Board, 'context'>): Promise<void> {
  if (id === undefined) return
  await quietly(async () => {
    const now = await $.clock.now()
    await update($, board, b => {
      const open = b.entries.find(e => e.id === id && e.status === 'run')
      return {
        ...b,
        ...patch,
        entries: b.entries.map(e => (e === open ? { ...e, status, endedAt: now } : e)),
        ...(open !== undefined && isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
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
        ...(isFault(status) ? { faults: oneMore(b.faults, open.station) } : {}),
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
  // The feed's second column fits the longest station name of the language.
  const column = Math.max(8, ...Object.values(t.stations).map(name => name.length))

  // Calls a settings hook refused, so that the tool's own row reads as blocked and not as an error.
  // Loses nothing across a reload that matters: a reload never lands in the middle of a call.
  const refused = new Set<string>()

  // The model the main loop last ran on: in this session, or else in the last session in this folder.
  // The one thing the map keeps between sessions, and only its name.
  let lastModel: string | undefined
  let modelKey = 'model'

  const opening = { id: PANE, title: t.title, ...(setup.terminalMap ? { columns: MAP_COLUMNS, rows: MAP_ROWS } : {}) }

  on('session.start', async ($, e, next) => {
    await quietly(() => $.command.register({ name: 'lot-map', description: t.command }))
    picture.canShow = setup.terminalMap && setup.terminalPicture === 'auto' && (await quietly(() => showsPictures($))) === true
    void quietly(() => $.ui.open(opening))
    await quietly(async () => {
      modelKey = `model:${e.cwd}`
      const kept = await $.store.get(modelKey)
      if (lastModel === undefined && typeof kept === 'string') lastModel = kept
    })
    return next(e)
  })

  on('command.run', { command: 'lot-map' }, async $ => {
    const opened = await $.ui.open(opening)
    return { text: opened.isPlaced ? t.opened : t.cannotOpen(String(opened.reason)) }
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

  on('turn.start', async ($, e, next) => {
    const notice = e.agentId === undefined ? taskNotice(e.text) : undefined
    if (notice !== undefined) {
      // A background task reporting back is no message of the person's.
      if (notice.status !== undefined) await settle($, notice.id, notice.status)
    } else if (e.agentId === undefined && e.text !== '') {
      // A new message clears what went wrong on the way to the last answer.
      await quietly(() => update($, board, b => (b.faults === undefined ? b : { ...b, faults: {} })))
      await begin($, { station: 'you', label: t.newMessage, from: 'inbound', status: 'ok' })
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
      // An interrupted call never reports back; left alone its row would pulse for the rest of the session.
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, board, b => ({
          ...b,
          entries: b.entries.map(x => (x.status === 'run' && x.from === 'core' && x.task === undefined ? { ...x, status: 'ok' as const, endedAt: now } : x)),
        }))
      })
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = await quietly(async () => {
      const seen = classify(e.tool, e as unknown as Record<string, unknown>, setup)
      return begin($, { ...seen, ...(e.agentId === undefined ? { from: 'core' as const } : { from: 'agents' as const, agentId: e.agentId }) })
    })
    try {
      const ran = await next(e)
      const wasRefused = ran.deny !== undefined || (e.tool_use_id !== undefined && refused.delete(e.tool_use_id))
      const task = wasRefused || ran.isError === true ? undefined : taskOf(ran.result)
      if (task !== undefined) {
        await background($, id, task)
        return ran
      }
      await finish($, id, wasRefused ? 'block' : ran.isError === true ? 'err' : 'ok')
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
    const id = await begin($, { station: 'model', label: t.compacting })
    try {
      return await next(e)
    } finally {
      await finish($, id, 'ok', await contextOf($))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, board)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    const rows = foldRows(state.entries).map(({ entry, times, tookMs }) => {
      const isSwitch = entry.mark === 'switch'
      const mark = isSwitch ? '◆' : entry.status === 'run' ? '●' : entry.status === 'ok' ? '·' : '✕'
      const took = entry.endedAt === undefined ? t.running : tookMs > 0 ? formatMs(tookMs, t) : ''
      // Theme keys, so the rows read on a light theme as well as on a dark one.
      const color = isSwitch || entry.status === 'run' ? 'claude' : entry.status === 'ok' ? undefined : 'error'
      const line = `${mark} ${t.stations[entry.station].padEnd(column)} ${entry.label}${times > 1 ? `  +${times - 1}` : ''}${took === '' ? '' : `  ${took}`}`
      return (
        <Text mono size="footnote" color={color} dimColor={entry.status === 'ok' && !isSwitch}>
          {line}
        </Text>
      )
    })
    const feed = rows.length > 0 ? rows : [<Text dimColor>{t.nothingYet}</Text>]
    const current = <Text mono size="footnote">{describeNow(state, t)}</Text>

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
        map = <Image key={MAP} source={frameSource(picture.dir, picture.generation)} columns={size.columns} rows={size.rows} alt={describeNow(state, t)} />
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
        <Svg source={drawMap(state, now, setup)} alt={`${t.title}. ${describeNow(state, t)}`} />
        {current}
        {feed}
      </Box>
    )
  })
}
