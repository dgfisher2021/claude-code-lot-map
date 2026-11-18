// A made-up session as a pure function of time: the board at any second of an 80-second loop.
// Times are in seconds from the loop's start; turn 1 happened before it, so the map has history.

export const LOOP_S = 80

const A1 = 'agent-explore'
const A2 = 'agent-plan'

/** One call: when it starts, how long it takes, where it lands, and how it ends. */
const call = (at, dur, station, label, extra = {}) => ({ at, dur, station, label, end: 'ok', ...extra })

const SCRIPT = [
  // Turn 1, finished before the loop.
  call(-240, 0, 'you', 'new message', { message: 1 }),
  call(-239.5, 2, 'model', 'opus 5.5 · step 1', { step: 1 }),
  call(-237, 0.7, 'memory', 'search nodes', { tokens: 900 }),
  call(-236, 0.3, 'files', 'hooks/map.ts', { file: 'hooks/map.ts', tokens: 14000 }),
  call(-235.5, 0.3, 'files', 'renderer/view.mjs', { file: 'renderer/view.mjs', tokens: 9000 }),
  call(-230, 3, 'model', 'opus 5.5 · step 2', { step: 2 }),
  call(-226, 18, 'shell', 'Run the tests', { tokens: 2400 }),
  call(-207, 0.4, 'files', 'hooks/map.ts', { file: 'hooks/map.ts', edit: true, tokens: 600 }),
  call(-206, 0.4, 'files', 'hooks/map.ts', { file: 'hooks/map.ts', edit: true, tokens: 600 }),
  call(-204, 6, 'shell', 'Run the tests', { end: 'err', exit: 1, reason: '2 tests failed', tokens: 3100 }),
  call(-197, 2, 'model', 'opus 5.5 · step 3', { step: 3 }),
  call(-194, 1.2, 'web', 'github: list issues', { server: 'github', tokens: 5200 }),
  call(-192, 0.8, 'web', 'github.com', { tokens: 7000 }),
  call(-190, 4, 'model', 'opus 5.5 · step 4', { step: 4, answer: true }),

  // Turn 2, played in the loop.
  call(0, 0, 'you', 'new message', { message: 2 }),
  call(0.5, 3, 'model', 'opus 5.5 · step 1', { step: 1 }),
  call(4, 0.5, 'skills', 'brainstorming', { tokens: 3000 }),
  call(5, 1.2, 'files', 'hooks/map.ts', { file: 'hooks/map.ts', tokens: 14000 }),
  call(5, 1.4, 'files', 'hooks/text.ts', { file: 'hooks/text.ts', tokens: 8000 }),
  call(5, 1.1, 'files', 'types/index.d.ts', { file: 'types/index.d.ts', tokens: 3000 }),
  call(7.5, 2.5, 'model', 'opus 5.5 · step 2', { step: 2 }),
  call(9, Infinity, 'shell', 'Start the dev server', { task: 'dev-server' }),
  call(9.5, 0.3, 'web', 'localhost:4747', { local: 'localhost:4747' }),
  call(10, 22, 'agents', 'Explore: find the ring code', { spawns: A1, tokens: 4100 }),
  call(11, 17, 'agents', 'Plan: draft the change', { spawns: A2, tokens: 2600 }),
  call(12, 0.5, 'files', 'Grep', { agent: A1 }),
  call(13, 0.4, 'files', 'hooks/register.tsx', { agent: A2, file: 'hooks/register.tsx' }),
  call(14, 0.4, 'files', 'renderer/view.mjs', { agent: A1, file: 'renderer/view.mjs' }),
  call(17, 0.7, 'memory', 'search nodes', { agent: A2 }),
  call(18, 1, 'shell', 'List the hooks', { agent: A1 }),
  call(22, 0.2, 'web', 'curl example.com', { agent: A2, end: 'block' }),
  call(24, 1.5, 'web', 'docs.anthropic.com', { agent: A1 }),
  call(28, 0.3, 'files', 'renderer/layout.mjs', { agent: A1, file: 'renderer/layout.mjs' }),
  call(30, 0.4, 'web', 'localhost:3000', { agent: A1, local: 'localhost:3000' }),
  call(33, 3, 'model', 'opus 5.5 · step 3', { step: 3 }),
  call(36.5, 8, 'you', 'Which ring layout?', { waits: true }),
  call(45, 2, 'model', 'opus 5.5 · step 4', { step: 4 }),
  call(47.5, 0.4, 'files', 'hooks/map.ts', { file: 'hooks/map.ts', edit: true, tokens: 700 }),
  call(48.5, 0.4, 'files', 'hooks/map.ts', { file: 'hooks/map.ts', edit: true, tokens: 700 }),
  call(49.5, 0.4, 'files', 'hooks/text.ts', { file: 'hooks/text.ts', edit: true, tokens: 500 }),
  call(51, 9, 'shell', 'Run the tests', { end: 'err', exit: 1, reason: 'expected 3 arcs, got 2', tokens: 3300 }),
  call(60.5, 2, 'model', 'opus 5.5 · step 5', { step: 5 }),
  call(62.5, 0.4, 'files', 'hooks/map.ts', { file: 'hooks/map.ts', edit: true, tokens: 700 }),
  call(63, 6, 'shell', 'Run the tests', { tokens: 2900 }),
  call(69.5, 2.5, 'model', 'opus 5.5 · step 6', { step: 6, answer: true }),
]

const PLAN = [
  { id: '1', subject: 'Read the ring code', from: 4, to: 33 },
  { id: '2', subject: 'Label the limit arcs', from: 33, to: 63 },
  { id: '3', subject: 'Run the tests', from: 63, to: 72 },
]

const bump = (map, key, by = 1) => ({ ...map, [key]: (map[key] ?? 0) + by })

/**
 * The board `s` seconds into the loop, with the person's figures from the controls.
 * `base` is the wall-clock time of the loop's start, in ms.
 */
export function boardAt(s, base, figures) {
  const ms = x => base + x * 1000
  const now = ms(s)
  const started = SCRIPT.filter(c => c.at <= s)
  const isDone = c => c.at + c.dur <= s
  const turnOf = c => (c.at < 0 ? 1 : 2)

  const entries = []
  const timeline = []
  let counts = {}
  let turnCounts = {}
  let faults = {}
  let faultTotals = {}
  let blocks = {}
  let blockTotals = {}
  let busyMs = {}
  let spent = {}
  let changed = {}
  const files = new Map()
  const servers = new Map()
  let local = []
  const agentFaults = new Set()
  let step
  let answeredAt
  const turns = []

  for (const [i, c] of started.entries()) {
    const done = isDone(c)
    const status = done ? c.end : 'run'
    const turn = turnOf(c)
    const entry = {
      id: `c${i}`,
      station: c.station,
      label: c.label,
      from: c.agent ? 'agents' : 'core',
      startedAt: ms(c.at),
      status,
      turn,
      ...(done ? { endedAt: ms(c.at + c.dur) } : {}),
      ...(c.agent ? { agentId: c.agent } : {}),
      ...(c.task ? { task: c.task } : {}),
      ...(c.waits ? { waits: true } : {}),
      ...(c.station === 'files' && !c.agent ? { act: c.edit ? 'editing' : c.label === 'Grep' ? 'searching' : 'reading' } : {}),
      ...(c.answer && done ? { mark: 'done' } : {}),
      ...(done && c.exit !== undefined ? { exit: c.exit } : {}),
      ...(done && c.reason && figures.errorReasons ? { reason: c.reason } : {}),
      ...(done && c.tokens && !c.agent ? { tokens: c.tokens } : {}),
    }
    if (c.message) {
      turns.push({ n: c.message, startedAt: ms(c.at), calls: 0, errors: 0 })
      turnCounts = {}
      faults = {}
      blocks = {}
    }
    entries.push(entry)
    counts = bump(counts, c.station)
    turnCounts = bump(turnCounts, c.station)
    const open = turns[turns.length - 1]
    if (open && c.station !== 'model' && c.station !== 'you') open.calls += 1
    if (c.step) step = c.step
    if (done && c.answer) {
      answeredAt = ms(c.at + c.dur)
      if (open) open.endedAt = answeredAt
    }
    if (status === 'err') {
      faults = bump(faults, c.station)
      faultTotals = bump(faultTotals, c.station)
      if (open) open.errors += 1
    }
    if (status === 'block') {
      blocks = bump(blocks, c.station)
      blockTotals = bump(blockTotals, c.station)
      if (c.agent) agentFaults.add(c.agent)
    }
    if (c.station !== 'model' && c.station !== 'you' && !c.task) {
      busyMs = bump(busyMs, c.station, Math.round((Math.min(s, c.at + c.dur) - c.at) * 1000))
    }
    if (done && c.tokens && !c.agent) spent = bump(spent, c.station, c.tokens)
    if (c.file) {
      const was = files.get(c.file)
      files.set(c.file, { name: c.file, uses: (was?.uses ?? 0) + 1, lastAt: ms(c.at), ...(c.edit || was?.isEdited ? { isEdited: true } : {}) })
      if (c.edit && done) changed = bump(changed, c.file)
    }
    if (c.local) local = [{ host: c.local, lastAt: ms(c.at) }, ...local.filter(l => l.host !== c.local)]
    if (c.server) servers.set(c.server, { name: c.server, uses: (servers.get(c.server)?.uses ?? 0) + 1, lastAt: ms(c.at) })
    if (c.station !== 'model' && c.station !== 'you' && !c.task) {
      timeline.push({
        at: ms(c.at),
        ...(done ? { until: ms(c.at + c.dur) } : {}),
        kind: c.station,
        ...(status === 'err' || status === 'block' ? { bad: true } : {}),
      })
    }
    if (c.waits) timeline.push({ at: ms(c.at), ...(done ? { until: ms(c.at + c.dur) } : {}), kind: 'wait' })
  }

  // Subagents at work: their Agent call still running.
  const agents = started.filter(c => c.spawns && !isDone(c)).map(c => c.spawns)
  const isAnswered = answeredAt !== undefined && s >= 72
  const plan = figures.plan
    ? PLAN.map(p => ({
        id: p.id,
        subject: p.subject,
        status: s >= p.to ? 'completed' : s >= p.from ? 'in_progress' : 'pending',
        calls: entries.filter(e => e.turn === 2 && e.startedAt >= ms(p.from) && e.startedAt < ms(Math.min(s, p.to))).length,
        ...(s >= p.from ? { startedAt: ms(p.from) } : {}),
        ...(s >= p.to ? { endedAt: ms(p.to) } : {}),
      }))
    : undefined
  const heaviest = entries
    .filter(e => e.tokens)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)
    .map(e => ({ label: `${e.station}: ${e.label}`, tokens: e.tokens }))
  const hour = 3_600_000

  return {
    now,
    board: {
      entries: entries.slice(-80),
      counts,
      turnCounts,
      faults,
      faultTotals,
      blocks,
      blockTotals,
      busyMs,
      model: 'claude-opus-5-5',
      step,
      pushed: 0,
      agents: figures.agents ? agents : [],
      agentNames: { [A1]: 'find the ring code', [A2]: 'draft the change' },
      agentInfo: { [A1]: { type: 'Explore', at: ms(10) }, [A2]: { type: 'Plan', at: ms(11) } },
      agentFaults: [...agentFaults],
      context: figures.context,
      peakContext: figures.context,
      phase: isAnswered ? 'done' : 'thinking',
      ...(isAnswered ? { answeredAt } : {}),
      ...(plan ? { plan } : {}),
      changed,
      satellites: figures.satellites ? { files: [...files.values()], web: [...servers.values()] } : {},
      local,
      turns,
      timeline,
      limits: [
        { kind: 'five_hour', percent: figures.fiveHour, resetsAt: new Date(now + 4.8 * hour).toISOString() },
        { kind: 'seven_day', percent: figures.weekly, resetsAt: new Date(now + 13.5 * hour).toISOString() },
      ],
      cost: figures.cost,
      spent,
      heaviest,
    },
  }
}
