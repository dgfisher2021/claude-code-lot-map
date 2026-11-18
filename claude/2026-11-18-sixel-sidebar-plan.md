# Sixel sidebar: the Edge page in the Windows Terminal split

Goal: the split beside Claude in Windows Terminal shows the exact page the Edge window shows (`renderer/window/`), drawn as Sixel. The Edge window keeps working as it does today.

## Reused as is

- `renderer/window/*`, the page: header, `?`, title, chips, tooltips, list, handle, local servers.
- `renderer/serve.mjs`: the server on `127.0.0.1:47470` and how it opens Edge.
- `renderer/view.mjs`: the Sixel encoder (`decodePng`, `sixel`), the cell-size query, the alternate screen, the heartbeat, `shown`, `quit`, the frame throttle in `draw`, `--all`.
- `renderer/render.mjs`: Chromium over the DevTools pipe, `resize`, `captureScreenshot`, `pace`.
- `hooks/register.tsx`: `splitTab` (`wt.exe -w 0 split-pane … view.mjs <live folder>`).

## Order: a trial first

Steps 1–3 run first as a trial, from this worktree on port 47471 in a separate Windows Terminal window against a live session, nothing installed. Steps 4–7 only once Dustin has looked at it. The trial settles what reading the code cannot:

1. mouse reports reach `view.mjs` in a Windows Terminal split from WSL;
2. CDP mouse events fire the page's tooltips, the `?` and the handle;
3. full-pane Sixel is quick enough in Windows Terminal 1.25.3131;
4. the Windows fonts load into the hidden Chromium;
5. a tooltip hides when the mouse leaves the pane.

Prior art: [termium](https://github.com/codr1/termium) does the same (Chromium as Sixel in Windows Terminal from WSL2, mouse by cell). Not usable as the sidebar itself (its own bar and Vimium keys over the page's, a 216-colour palette by default, its own Chromium by `curl | bash`, no session lifecycle), but two lessons: re-send only the Sixel bands that changed and skip unchanged frames; its ceiling is 24 fps, so 10 is a setting, not a limit.

## Steps

1. **`serve.mjs`**: split `open(name)` into `ensureServer()` (the start-unless-it-answers loop) and the Edge launch; export `PORT` and `ensureServer`. Edge behaves as now.
2. **`render.mjs`, a page mode** (`render.mjs --page <url>`), beside the SVG mode the kitty picture keeps:
   - navigate to the page's URL instead of the blank `data:` page;
   - before it loads, a small script makes `window.open` and `window.close` report to the renderer (a DevTools binding) instead of acting;
   - step every `#map svg` the page puts in, as `SHOW`/`STEP` do for `#m svg` now; a MutationObserver says when the page changed, for `pace`;
   - read lines from `view.mjs` on stdin: `size`, `mouse`, `key`, sent on as `setDeviceMetricsOverride`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`;
   - say `open <url>` and `close` besides `ready` and `frame`;
   - capture right after a mouse or key event, so a tooltip shows with the next frame;
   - the page's fonts: Chromium on Linux has neither `system-ui` as Edge has it (Segoe UI, the tooltips and header) nor Cascadia Mono (the list), so page mode gives it a fontconfig file naming those from `/mnt/c/Windows/Fonts`.
3. **`view.mjs`, the page in a pane**:
   - start the server (`ensureServer`), then `render.mjs --page http://127.0.0.1:<PORT>/?live=<name>`;
   - the picture is the whole pane less its last row (a picture reaching the last row scrolls the screen), drawn at `1;1`; that row takes the page's background;
   - mouse reports on (`?1003h`, `?1006h`): a cell becomes a pixel at its centre, sent as move, press, release, wheel; keys go through the existing `KEY_NAMES`; Ctrl+C still quits here;
   - tooltips need nothing new: the page draws its own (`untitle`, `showTip` in `ui.js`) from `mousemove`/`mouseenter`, which the mouse events fire. The terminal never says the mouse left the pane, so a move onto the pane's edge cell, or focus leaving the pane (`?1004h`), sends the page a move outside it and the tooltip hides;
   - `open <url>`: a `http://localhost:<port>/` address only, opened in the Windows browser (`cmd.exe /c start`); `close`: quit;
   - delete what the page now does: the text rows, the hint line, the legend's wrapping, the list's state, `m`, the SVG copy (`feed`), and `layout.mjs` with `layout.d.mts`, which nothing else uses.
4. **The default** (`register.tsx` `openWindow`, `map.ts` `setupFrom`, `plugin.json`): from WSL the split first, Edge when it cannot open; `terminalWindow` is `auto` (split, Edge as fallback), `edge` (Edge first) or `off`. A stored `pane` reads as `auto`.
5. **Words**: README (window section, options table), CHANGELOG 1.2.0, PRIVACY (the split starts the same server and loads its page in the hidden Chromium; a clicked local server opens in the default browser), version 1.2.0.
6. **Tests**: none new. Three existing ones assert Edge first and change: `workmap.test.tsx` `/workmap window … opens it in Edge` (now the split), `when Edge cannot open, the window splits…` (now: when the split cannot, Edge opens), `local.test.tsx` (finds the live folder from the `wt.exe` call). The suite once.
7. **The check that matters**: the worktree's version on port 47471 in a test Windows Terminal window, against a live session, beside the Edge window. Then PR, merge, install.

## Not touched

The page, the Edge launch and its profile, the server running on 47470, the preview on 4747, the installed plugin until approved.

## Later, its own step: the block-character map

`hooks/raster.ts` (668 lines), the `terminalMap` option, the pane's cell drawing in `register.tsx` (402, 1459–1488), the kitty picture's sizing (`PICTURE_CELL`), the narrow-dock message, README's "In a terminal" and its translations. A terminal without pictures then keeps the rows and one line of counts.
