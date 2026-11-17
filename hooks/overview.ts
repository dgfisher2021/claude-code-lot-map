import { formatClock } from './map'
import type { SessionState } from './map'
import type { Strings } from './text'

/** What each session writes for `/workmap all`, and renderer/view.mjs reads: the folder name is the session's id. */
export type Tile = {
  name: string
  state: SessionState
  /** The state's word in the session's own language. */
  word: string
  now: string
  context?: number
  startedAt: number
  updatedAt: number
  fault: boolean
  /** The session's live map folder, when it has a window. */
  live?: string
}

/** A status file older than this is a session gone. */
export const TILE_FRESH_MS = 15_000

const GROUP: Partial<Record<SessionState, number>> = { waiting: 0, thinking: 1, running: 1 }

/** The tiles in the files' texts that are young enough, waiting first, then running and thinking, then the rest, each by name. */
export function tilesFrom(texts: readonly string[], now: number): Tile[] {
  const tiles: Tile[] = []
  for (const text of texts) {
    try {
      const tile = JSON.parse(text) as Tile
      if (typeof tile.name === 'string' && typeof tile.updatedAt === 'number' && now - tile.updatedAt <= TILE_FRESH_MS) tiles.push(tile)
    } catch {
      // A file caught mid-write: the next read has it whole.
    }
  }
  return tiles.sort((a, b) => (GROUP[a.state] ?? 2) - (GROUP[b.state] ?? 2) || a.name.localeCompare(b.name))
}

/** A string from a file anyone can write to, with every control character out, so that it cannot drive the terminal. */
export function plain(text: unknown): string {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
}

/** A tile as one line of text: name, state word, the top line, context and time. */
export function tileText(tile: Tile, now: number, t: Strings): string {
  const context = Number.isFinite(tile.context) ? [`${Math.round(tile.context ?? 0)}%`] : []
  return [plain(tile.name), plain(tile.word), plain(tile.now), ...context, formatClock(now - tile.startedAt, t)].join('  ')
}
