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
  /** A failed shell command's exit code: a number, nothing of its output. */
  exit?: number
}

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

export type Board = {
  entries: Entry[]
  counts: Partial<Record<StationId, number>>
  model?: string
  step?: number
  /** How many of the memory station's count a hook brought unasked. */
  pushed?: number
  /** Errors per station since the person's last message. */
  faults?: Partial<Record<StationId, number>>
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
  /** Claude's own plan, as its task tools set it. */
  plan?: PlanItem[]
}

declare module 'claude-code' {
  interface PluginState {
    'lot-map': { board: Shaped<Board> }
  }
}
