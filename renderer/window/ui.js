// The parts of a page that shows the map: the lines under it and the tooltips over it. Shared by the map window
// (renderer/window) and the preview (dev/preview); the styles are in ui.css.

// The figures' icons on a 24-unit grid; each matches the mark it explains on the map, where there is one.
const ICONS = {
  calls: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  turn: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  running: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  errors: '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none"/>',
  session: '<path d="M18 6 6 18M6 6l12 12"/>',
  refused: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  pushed: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  tokens: '<path d="m12 3 9 4.5-9 4.5-9-4.5zM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
}

// A listed item's icon: a pencil for a file edited, an eye for one only read, a server, a clock for a subagent at work.
const TOP_ICONS = {
  edited: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  read: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  server: '<path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}

// An icon carries its own size, so it stays small even before the page's styles apply.
const svgIcon = (inner, size = 16, viewBox = '0 0 24 24', width = 2) =>
  `<svg width="${size}" height="${size}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// Backticks in the words mark a command.
const withCode = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')

/** A station's tooltip: its icon and name, what lands there, a row for each figure, then its most used, if any. */
function tipHtml(tip, glyph) {
  const rows = tip.figures
    .map(f => `<div class="fig${f.tone ? ` t-${f.tone}` : ''}">${svgIcon(ICONS[f.icon] ?? '')}<span>${esc(f.label)}</span><b>${esc(f.value)}</b></div>`)
    .join('')
  const top = tip.top
    ? `<div class="section">${esc(tip.top.title)}</div><div class="tip-top">` +
      tip.top.items
        .map(
          i =>
            `<div class="fig">${svgIcon(TOP_ICONS[i.icon] ?? '')}<span>${esc(i.name)}${i.note ? ` <small>${esc(i.note)}</small>` : ''}</span><b>${esc(i.uses)}</b></div>`,
        )
        .join('') +
      '</div>'
    : ''
  return (
    `<div class="tip-head">${svgIcon(`<path d="${esc(glyph)}"/>`, 20, '-10 -10 20 20', 1.4)}<strong>${esc(tip.name)}</strong></div>` +
    `<p class="tip-about">${withCode(tip.about)}</p><div class="tip-figures">${rows}</div>${top}`
  )
}

// The core's tooltip: a gauge for its heading, a coin for the cost's row.
const GAUGE = '<path d="M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0"/>'
const COIN = '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2A2.5 2 0 0 0 12 8h-.5a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4H12a2.5 2 0 0 1-2.5-1.2M12 6.5V8M12 16v1.5"/>'

/** The core's tooltip: the model, then a row per usage ring (its colour, what it measures, its figure, when it resets) and the cost. */
function usageHtml(tip) {
  const rows = tip.rows
    .map(
      r =>
        `<div class="fig usage${r.isReached ? ' t-bad' : ''}">${r.color ? `<i class="swatch" style="background:${esc(r.color)}"></i>` : svgIcon(COIN)}` +
        `<span>${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</span><b>${esc(r.value)}</b></div>`,
    )
    .join('')
  return `<div class="tip-head">${svgIcon(GAUGE, 20)}<strong>${esc(tip.name)}</strong></div><p class="tip-about">${esc(tip.about)}</p><div class="tip-figures">${rows}</div>`
}

/** Moves each title of the map in `box` onto its parent as `data-title`: the page's own tooltip shows it, the browser's never. */
export function untitle(box) {
  for (const title of box.querySelectorAll('title')) {
    title.parentElement?.setAttribute('data-title', title.textContent ?? '')
    title.remove()
  }
}

/**
 * What the map inside `box` shows at a point: a station's tooltip parts (its `data-tip`, with the station's own icon),
 * or the nearest title of anything else; nothing over the ground.
 */
export function tipAt(box, x, y) {
  for (let el = document.elementFromPoint(x, y); el && el !== box; el = el.parentElement) {
    const data = el.getAttribute?.('data-tip')
    if (data) return { tip: JSON.parse(data), glyph: el.querySelector('path[transform]')?.getAttribute('d') ?? '' }
    const title = el.getAttribute?.('data-title')
    if (title) return { text: title }
  }
  return undefined
}

/** Shows in `tipEl` the tooltip of what is at `pointer` in `box`, beside it and kept inside the window; hides it over nothing. */
export function showTip(tipEl, box, pointer) {
  // The keys' tooltip, while open, stays: the map's own waits until it closes.
  if (tipEl.classList.contains('help')) return
  const found = pointer && tipAt(box, pointer.x, pointer.y)
  tipEl.style.display = found ? 'block' : 'none'
  if (!found) return
  tipEl.classList.remove('help')
  tipEl.classList.toggle('rich', found.tip !== undefined)
  if (found.tip) tipEl.innerHTML = found.tip.kind === 'usage' ? usageHtml(found.tip) : tipHtml(found.tip, found.glyph)
  else tipEl.textContent = found.text
  // Beside the pointer, flipped to the other side near an edge of the window.
  const left = pointer.x + 16 + tipEl.offsetWidth > innerWidth - 8 ? pointer.x - 16 - tipEl.offsetWidth : pointer.x + 16
  const top = pointer.y + 18 + tipEl.offsetHeight > innerHeight - 8 ? pointer.y - 12 - tipEl.offsetHeight : pointer.y + 18
  tipEl.style.left = `${Math.max(8, left)}px`
  tipEl.style.top = `${Math.max(8, top)}px`
}

/** `text`'s parts between ' · ' as spans that never break inside, joined again by ' · ': it wraps only between them. */
function parted(el, text) {
  String(text)
    .split(' · ')
    .forEach((part, i) => {
      if (i > 0) el.append(' · ')
      const span = document.createElement('span')
      span.textContent = part
      el.append(span)
    })
}

/**
 * Draws the lines under the map (lines.mjs feedLines) into `box`, each in its tone, the top line bold. A plan line
 * wraps between its parts, its later lines under the words rather than the mark; every other line keeps to one.
 */
/** The lines under the map: a call's row in four aligned columns (mark, station, what, time), every other line as text. */
export function drawLines(box, lines) {
  // The station column is as wide as the longest station name among the rows.
  const widest = Math.max(4, ...lines.filter(l => l.cols).map(l => [...l.cols[1]].length))
  box.style.setProperty('--station', `${widest}ch`)
  box.replaceChildren(
    ...lines.map(l => {
      const div = document.createElement('div')
      div.className = l.isNow ? `n-${l.tone}` : l.isLegend ? 'legend' : `t-${l.tone}${l.isBold ? ' b' : ''}${l.isPlan ? ' wrap' : ''}${l.cols ? ' row' : ''}`
      if (l.isPlan) parted(div, l.line)
      else if (l.cols) {
        for (const text of l.cols) {
          const span = document.createElement('span')
          span.textContent = text
          div.append(span)
        }
      } else div.textContent = String(l.line)
      return div
    }),
  )
}

/**
 * A handle between the map and the lines: dragging it sets how tall the lines are, `onDrag(px)` while it moves and
 * `onDone(px)` when it is let go.
 */
export function wireSplit(handle, onDrag, onDone) {
  let height
  handle.addEventListener('pointerdown', e => {
    handle.setPointerCapture(e.pointerId)
    const move = ev => {
      height = Math.round(innerHeight - ev.clientY - handle.offsetHeight / 2)
      onDrag(height)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      if (height !== undefined) onDone(height)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  })
}

/** The `?` button's icon: a question mark in a circle. */
// The ? in the upper right corner, on a faint ground: the window's keys.
const HELP_ICON = svgIcon(
  '<circle cx="12" cy="12" r="10" fill="currentColor" fill-opacity="0.12"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  26,
  '0 0 24 24',
  1.8,
)

/** The arrow keys drawn in their caps, by the names keyHelp gives them. */
const ARROWS = {
  ArrowUp: ['Up', 'M12 19V5M5 12l7-7 7 7'],
  ArrowDown: ['Down', 'M12 5v14M19 12l-7 7-7-7'],
}
const keyCap = key =>
  ARROWS[key] ? `<kbd class="arrow" aria-label="${ARROWS[key][0]}">${svgIcon(`<path d="${ARROWS[key][1]}"/>`)}</kbd>` : `<kbd>${esc(key)}</kbd>`

/** The session's keyHelp: the window's keys, each with what it does. */
function helpHtml(help) {
  const rows = help.keys.map(
    k => `<div class="k">${k.keys.map(keyCap).join(' ')}</div><div>${esc(k.label)}${k.note ? `<small>${esc(k.note)}</small>` : ''}</div>`,
  )
  return `<div class="tip-head">${HELP_ICON}<strong>${esc(help.title)}</strong></div><div class="keys">${rows.join('')}</div>`
}

/** Shows the keys under `button`, their right edges together; hides them when `help` is undefined. */
function showHelp(tipEl, button, help) {
  tipEl.style.display = help ? 'block' : 'none'
  tipEl.classList.toggle('help', Boolean(help))
  if (!help) return
  tipEl.classList.remove('rich')
  tipEl.innerHTML = helpHtml(help)
  const at = button.getBoundingClientRect()
  tipEl.style.left = `${Math.max(8, at.right - tipEl.offsetWidth)}px`
  tipEl.style.top = `${at.bottom + 6}px`
}

/** The ? button: shows the keys of `help()` while hovered or focused. `setHelp` shows it once the session sends its keyHelp. */
export function wireHelp(tipEl, button, help) {
  button.innerHTML = HELP_ICON
  const show = () => showHelp(tipEl, button, help())
  const hide = () => showHelp(tipEl, button, undefined)
  button.addEventListener('mouseenter', show)
  button.addEventListener('focus', show)
  button.addEventListener('mouseleave', hide)
  button.addEventListener('blur', hide)
}
export function setHelp(button, help) {
  button.hidden = help === undefined
  if (help) button.setAttribute('aria-label', help.title)
}

// ---- local servers -------------------------------------------------------------------------------

/** Whether each local server answered when last asked: true, false, or not yet asked. */
const answered = new Map()

/** Asks `host` whether anything answers there; an opaque answer is an answer. Loopback only, never another address. */
async function isUp(host) {
  if (!/^localhost(:\d{1,5})?$/.test(host)) return false
  return fetch(`http://${host}/`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2000) }).then(
    () => true,
    () => false,
  )
}

/**
 * The line of local servers Claude's calls used (the feed's `local`): each a link that opens it, with a dot, green while it
 * answers. Hidden when there are none. Returns whether the line shows, so the page can give the map the room.
 */
export function drawLocal(box, local) {
  const hosts = local?.hosts ?? []
  box.hidden = hosts.length === 0
  if (box.hidden) return false
  const links = hosts.map(host => {
    const state = answered.get(host)
    return `<a href="http://${esc(host)}/" target="_blank" rel="noopener" data-host="${esc(host)}"><i class="dot${state === undefined ? '' : state ? ' up' : ' down'}"></i>${esc(host)}</a>`
  })
  box.innerHTML = `<span class="local-title">${esc(local.title)}</span>${links.join('')}`
  return true
}

/** Asks every local server in `box` now and every five seconds, while the page is in view, and colours its dot. */
export function watchLocal(box) {
  const ask = async () => {
    if (document.hidden) return
    for (const link of box.querySelectorAll('a[data-host]')) {
      const host = link.dataset.host
      const up = await isUp(host)
      answered.set(host, up)
      link.querySelector('.dot')?.classList.toggle('up', up)
      link.querySelector('.dot')?.classList.toggle('down', !up)
    }
  }
  void ask()
  setInterval(ask, 5000)
  return ask
}
