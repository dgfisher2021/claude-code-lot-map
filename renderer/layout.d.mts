/** What a window's layout is worked out from. */
export type LayoutInput = {
  cols: number
  rows: number
  cell: { w: number; h: number }
  listRows: number
  view: 'both' | 'map' | 'list'
}

/** The picture's size in pixels and its first column, the rows it covers, and where the list goes. */
export type Layout = { w: number; h: number; col: number; mapRows: number; listTop: number; listRows: number }

export declare const MAP_W: number
export declare const MAP_H: number
export declare function layout(input: LayoutInput): Layout
