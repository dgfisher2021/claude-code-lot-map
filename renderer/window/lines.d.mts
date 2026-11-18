/** A line under the map: its words and tone, as feed.json gives them, and what kind of line it is. */
export type Line = { line: string; tone: string; isBold?: boolean; isNow?: boolean; isPlan?: boolean; isLegend?: boolean; agentId?: string; station?: string }

/** Where the list stands: scrolled lines, the filters, the search being typed, the subagent watched (-1: all). */
export type List = { logAt: number; onlyErrors: boolean; onlyStation: string; search: string; isTyping: boolean; watched: number }

/** The parts of feed.json the list reads. */
export type Feed = {
  now?: string
  nowTone?: string
  warnings?: string[]
  plan?: Line[]
  changed?: Line | null
  pinned?: Line[]
  rows?: Line[]
  log?: Line[]
  agents?: { id: string; name?: string }[]
  stations?: { id: string; name: string }[]
  errorsWord?: string
  legend?: string[]
  empty?: string
}

export declare function freshList(): List
export declare function crewOf(feed: Feed): { id: string; name: string }[]
export declare function listKey(list: List, key: string, feed: Feed, page?: number): { list: List; took: boolean }
export declare function nextAgent(list: List, feed: Feed): List
export declare function listLines(feed: Feed, list: List, room: number): { lines: Line[]; list: List; page: number }
export declare function feedLines(feed: Feed, list: List, room: number, showsLegend: boolean): { lines: Line[]; list: List; page?: number }
