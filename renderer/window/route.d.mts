/** What the map window's server answers for a path. */
export type Route =
  | { kind: 'health' | 'empty' | 'missing' }
  | { kind: 'file'; file: string; type: string }
  | { kind: 'live' | 'events' | 'about'; name: string; file: string }

export declare function isLiveName(name: unknown): boolean
export declare function route(path: string): Route
