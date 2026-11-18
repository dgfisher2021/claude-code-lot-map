// The list under the map, from the session's feed.json: its filters, its keys and its lines. Pure, so that the
// terminal window (view.mjs) and the app window (window.js) share it, and tests can call it.

/** Where the list stands: scrolled lines, the filters, the search being typed, the subagent watched (-1: all). */
export const freshList = () => ({ logAt: 0, onlyErrors: false, onlyStation: '', search: '', isTyping: false, watched: -1 })

/** The subagents feed.json names, each with its id and short name. */
export const crewOf = feed =>
  Array.isArray(feed.agents) ? feed.agents.filter(a => a && typeof a.id === 'string').map(a => ({ id: a.id, name: String(a.name ?? a.id) })) : []

/** The station list feed.json gives, in the map's order: `1` to `9` pick from it. */
const stationsOf = feed => (Array.isArray(feed.stations) ? feed.stations : [])

/**
 * A key on the list, by its browser name (ArrowUp, ArrowDown, PageUp, PageDown, Enter, Escape, Backspace) or the
 * character typed: scrolls, filters or searches. While a search is typed every key goes into it, q included.
 * Gives back the list as it now stands and whether the key was taken, so the window leaves its own keys alone.
 */
export function listKey(list, key, feed, page = 5) {
  const next = { ...list }
  if (list.isTyping) {
    if (key === 'Enter') next.isTyping = false
    else if (key === 'Escape') Object.assign(next, { search: '', isTyping: false })
    else if (key === 'Backspace') next.search = Array.from(list.search).slice(0, -1).join('')
    else if (Array.from(key).length === 1 && key >= ' ') next.search += key
    next.logAt = 0
    return { list: next, took: true }
  }
  if (key === 'ArrowUp') next.logAt = Math.max(0, list.logAt - 1)
  else if (key === 'ArrowDown') next.logAt = list.logAt + 1
  else if (key === 'PageUp') next.logAt = Math.max(0, list.logAt - page)
  else if (key === 'PageDown') next.logAt = list.logAt + page
  else if (key === '/') return { list: { ...next, search: '', isTyping: true, logAt: 0 }, took: true }
  else if (key === 'Escape') Object.assign(next, { search: '', logAt: 0 })
  else if (key === 'e') Object.assign(next, { onlyErrors: !list.onlyErrors, logAt: 0 })
  else if (key >= '0' && key <= '9' && key.length === 1) Object.assign(next, { onlyStation: stationsOf(feed)[Number(key) - 1]?.id ?? '', logAt: 0 })
  else return { list, took: false }
  return { list: next, took: key === '/' }
}

/** `a` goes through the subagents one at a time, then back to all the rows. */
export const nextAgent = (list, feed) => {
  const crew = crewOf(feed)
  return { ...list, watched: list.watched + 1 < crew.length ? list.watched + 1 : -1 }
}

/**
 * The list's lines in `room` rows: the live rows, or while a filter holds or the list is scrolled, the log (every
 * call the board keeps, newest first) cut to it, under a line that says what filters and how many remain; then only
 * the watched subagent's, under a line saying whose. Gives back the lines, the list with its scroll held inside the
 * log, and a page: how many log lines fit.
 */
export function listLines(feed, list, room) {
  const isFiltered = list.onlyErrors || list.onlyStation !== '' || list.search !== '' || list.isTyping
  let lines
  let page = Math.max(1, room)
  let held = list
  if (!isFiltered && list.logAt === 0) lines = Array.isArray(feed.rows) ? feed.rows : []
  else {
    const needle = list.search.toLowerCase()
    const log = (Array.isArray(feed.log) ? feed.log : []).filter(
      // The closing line, that older calls are gone, has no station and always stays.
      l =>
        !l.station ||
        ((!list.onlyErrors || l.tone === 'bad' || l.tone === 'block') &&
          (list.onlyStation === '' || l.station === list.onlyStation) &&
          String(l.line).toLowerCase().includes(needle)),
    )
    page = Math.max(1, room - (isFiltered ? 1 : 0))
    held = { ...list, logAt: Math.min(list.logAt, Math.max(0, log.length - page)) }
    const shown = log.slice(held.logAt, held.logAt + page)
    if (!isFiltered) lines = shown
    else {
      const station = stationsOf(feed).find(x => x.id === list.onlyStation)?.name
      const errors = typeof feed.errorsWord === 'string' ? feed.errorsWord : 'errors'
      const what = [
        list.onlyErrors ? errors : '',
        station ?? '',
        list.search !== '' || list.isTyping ? `/${list.search}${list.isTyping ? '_' : ''}` : '',
      ].filter(Boolean)
      lines = [{ line: `[${what.join(' · ')}] ${log.filter(l => l.station).length}`, tone: 'run' }, ...shown]
    }
  }
  const crew = crewOf(feed)
  const agent = list.watched >= 0 ? crew[list.watched] : undefined
  if (agent !== undefined) {
    lines = [{ line: `a ${list.watched + 1}/${crew.length} · ${agent.name}`, tone: 'run', isBold: true }, ...lines.filter(row => row.agentId === agent.id)]
  } else if (list.watched >= crew.length) held = { ...held, watched: -1 }
  return { lines, list: held, page }
}

/**
 * Everything under the map, in order: the top line (`isNow`, with the feed's tone), the warnings, then the legend or
 * the plan, the changed files, the work pinned and the list, which takes the rows left of `room`.
 */
export function feedLines(feed, list, room, showsLegend) {
  const head = [{ line: String(feed.now ?? ''), tone: feed.nowTone ?? 'plain', isNow: true }]
  for (const line of Array.isArray(feed.warnings) ? feed.warnings : []) head.push({ line: String(line), tone: 'run' })
  if (showsLegend)
    return { lines: [...head, ...(Array.isArray(feed.legend) ? feed.legend : []).map(line => ({ line: String(line), tone: 'plain', isLegend: true }))], list }
  // The plan's lines wrap in a page (`isPlan`); every other line keeps to one.
  for (const p of Array.isArray(feed.plan) ? feed.plan : []) head.push({ ...p, isPlan: true })
  if (feed.changed) head.push(feed.changed)
  for (const p of Array.isArray(feed.pinned) ? feed.pinned : []) head.push(p)
  const listed = listLines(feed, list, room - head.length)
  const rest = listed.lines.length > 0 ? listed.lines : [{ line: String(feed.empty ?? ''), tone: 'ok' }]
  return { lines: [...head, ...rest], list: listed.list, page: listed.page }
}
