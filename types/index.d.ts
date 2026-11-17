export type StationId =
  | 'you' | 'model' | 'memory' | 'files' | 'shell'
  | 'web' | 'browser' | 'agents' | 'skills' | 'hooks'

export type Status = 'run' | 'ok' | 'err' | 'block'

/** One action on the map. Labels carry names and record numbers, never the text of a memory. */
export type Entry = {
  id: string
  station: StationId
  label: string
  /** Where the pulse starts: the core, the agents station, or the station itself (a signal coming in). */
  from: 'core' | 'agents' | 'inbound'
  startedAt: number
  endedAt?: number
  status: Status
  /** The subagent whose loop made the call; absent for the main loop. */
  agentId?: string
  /** The background task the call started; the row stays open until that task reports back. */
  task?: string
  /** A moment the map marks: the model changed, or the answer is ready. */
  mark?: 'switch' | 'done'
  /** The call waits on the person: a question for them, a plan for their approval. */
  waits?: true
  /** The mode asked about the call and nothing has settled it yet: a permission prompt may be open. */
  asks?: true
  /** When the call was allowed after an ask: its running time counts from here. */
  ranAt?: number
  /** A failed shell command's exit code: a number, nothing of its output. */
  exit?: number
  /** A failed call's first line of error, cleaned and cut. Only with `errorReasons` on. */
  reason?: string
  /** The person's message this call came under: the `n` of a `TurnSummary`. */
  turn?: number
}

/** One message of the person's and what followed it: when, how many calls counted, how many ended in error. */
export type TurnSummary = { n: number; startedAt: number; endedAt?: number; calls: number; errors: number }

/** A task of Claude's own plan: its subject as Claude wrote it, cut short, and the work done while it was in progress. */
export type PlanItem = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Calls made while it was the task in progress. */
  calls: number
  startedAt?: number
  endedAt?: number
}

/** The rate-limit windows the map shows. */
export type LimitKind = 'five_hour' | 'seven_day'

export type Board = {
  entries: Entry[]
  counts: Partial<Record<StationId, number>>
  model?: string
  step?: number
  /** How many of the memory station's count a hook brought unasked. */
  pushed?: number
  /** Errors per station since the person's last message. */
  faults?: Partial<Record<StationId, number>>
  /** Errors per station this session; no message of the person's clears it. */
  faultTotals?: Partial<Record<StationId, number>>
  /** Calls per station since the person's last message. */
  turnCounts?: Partial<Record<StationId, number>>
  /** Calls refused per station (by a hook or a permission prompt) since the person's last message. */
  blocks?: Partial<Record<StationId, number>>
  /** Subagents whose loops are still going. */
  agents?: string[]
  /** The short description each subagent was started with, by its id: the last twelve. */
  agentNames?: Record<string, string>
  /** Subagents a call of which failed or was refused. */
  agentFaults?: string[]
  /** How full the context window is, 0 to 100. */
  context?: number
  /** When the model last changed. */
  switchedAt?: number
  /** Where the main loop's turn stands: thinking from the person's message, done at its end, compacting meanwhile. */
  phase?: 'thinking' | 'compacting' | 'done'
  /** When the main loop's last turn gave its answer; cleared when the next one starts. */
  answeredAt?: number
  /** Claude's own plan, as its task tools set it. */
  plan?: PlanItem[]
  /** A changed file's label to how many times it was written or edited; the 40 most recently changed. */
  changed?: Record<string, number>
  /** The person's messages this session as turns, the last twelve; the newest is the open one. */
  turns?: TurnSummary[]
  /** The rate-limit windows the engine last reported: how much of each is used, and when it resets (ISO 8601). */
  limits?: { kind: LimitKind; percent: number; resetsAt?: string }[]
  /** What the session has cost so far, in US dollars: an estimate. */
  cost?: number
}

declare module 'claude-code' {
  interface PluginState {
    'lot-map': { board: Shaped<Board> }
  }
}
