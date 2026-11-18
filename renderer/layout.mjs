// The map window's layout: how large the picture is, where it starts, and where the list under it goes. Pure, so that
// it can be tested; renderer/view.mjs draws what it says.

/** The map's own proportions. */
export const MAP_W = 460
export const MAP_H = 430
/** Rows the map keeps however short the window: the list gives way first. */
const MAP_MIN_ROWS = 12

/**
 * The layout of a window `cols` by `rows` cells of `cell` pixels, its last row kept for the hint.
 * `both`: the map as large as the window's width allows while the list keeps `listRows` rows, the map never under
 * twelve, and the list the rest under a blank row. `map`: the picture alone. `list`: the list alone.
 */
export function layout({ cols, rows, cell, listRows, view }) {
  if (view === 'list') return { w: 0, h: 0, col: 0, mapRows: 0, listTop: 1, listRows: Math.max(0, rows - 1) }
  // Never past the hint's row: a picture taller than the window would scroll it with every frame.
  const room = view === 'map' ? rows - 1 : Math.min(rows - 1, Math.max(MAP_MIN_ROWS, rows - 2 - listRows))
  const scale = Math.min((cols * cell.w) / MAP_W, (room * cell.h) / MAP_H)
  const w = Math.max(60, Math.floor(MAP_W * scale))
  const h = Math.max(56, Math.floor(MAP_H * scale))
  const mapRows = Math.ceil(h / cell.h)
  const col = Math.max(0, Math.floor((cols - Math.ceil(w / cell.w)) / 2))
  if (view === 'map') return { w, h, col, mapRows, listTop: rows, listRows: 0 }
  return { w, h, col, mapRows, listTop: mapRows + 2, listRows: Math.max(0, rows - mapRows - 2) }
}
