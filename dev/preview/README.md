# Preview

A page for working on how the map looks without a Claude Code session: the real drawing code from `hooks/` runs in a browser and the page reloads on every save. Nothing here touches an installed workmap.

```bash
node dev/preview/server.mjs
```

Then open http://localhost:4747. It needs Node 22.13 or later, which strips the types from `hooks/*.ts` as it serves them; there is nothing to install.

## What it shows

The page draws what the map window draws: the map, the top line, the plan, the pinned lines and the rows under it, with a hint line at the bottom. Drag the pane's lower right corner to resize it; the map is laid out again as it is in a terminal pane.

- **Made-up session.** An 80-second loop of a turn: reading files, two subagents (one refused), a question for you, a failed test run, edits and the answer, after an earlier turn that gives the map its history. Play, pause, scrub, or jump to a moment.
- **Rings and figures.** Sliders for the context, the five-hour and weekly limits and the cost; switches for the plan, the subagents and the satellites.
- **Options.** The plugin's own options that change the drawing, passed to `setupFrom` as a session would.
- **Live sessions.** Every session of yours with a map window is listed as a source: the page then shows that session's own `map.svg` and `feed.json`, drawn by the installed workmap, read-only.

## Tooltips

Hovering the map shows the title of whatever is under the pointer, in a box of the page's own, since the map is redrawn four times a second and a browser's own tooltip would not stay. Only parts of the map that carry a `<title>` have one.

## Notes

Shift+click the map to pin a note on that spot. Notes are numbered on the map and listed beside it, and kept one JSON object a line in `claude/preview-notes.jsonl` (ignored by git) with the point in the map's own coordinates, what was under it, the moment of the loop and the options at the time, for Claude to read. **Clear notes** empties the file.

## Files

| File         | What is in it                                                                          |
| ------------ | -------------------------------------------------------------------------------------- |
| `server.mjs` | the server: the page, `hooks/*.ts` without types, live sessions, notes, reload on save |
| `scene.js`   | the made-up session, as the board at any second of the loop                            |
| `app.js`     | the page: drawing, playback, controls, tooltips and notes                              |
| `index.html` | the page's layout and styles                                                           |

The server listens on 127.0.0.1 only; `PREVIEW_PORT` picks another port.
