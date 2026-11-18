# Changelog

What changed in each version of lot-map, newest first. To get a new version, see [Updating](README.md#updating).

## 0.12.0 (2026-11-17)

- New option `motion`, from upstream's #40: `reduced` shows the same state with nothing moving by itself. The map draws no pulse, ripple, beam, blink or spin; a lit station or a leg of the route is on until its time is up and then off, never faded; a running station keeps its ring, and its clock hands step every five seconds; the cells repaint every five seconds at most; the picture is painted once for each map and not stepped for animation.
- New `theme` value `contrast`: the dark palette on black, words at 7:1 or more against the ground, marks, lines and spokes at 4.5:1 or more. Colours of your own still win.
- Shapes tell what colour alone should not: an error badge is a filled square (the refusal stays an outlined circle, `×N` a round one), and a wait on you adds a dashed ring just inside the core's edge to its blinking word. The legend has one more line.
- New option `errorReasons`, off by default: a failed call's row shows the first line of its error after the label, ` — cannot open file`, cleaned and cut to 72 characters. A refused call shows none; the `/workmap all` status file and notifications never carry it.

- New option `contextCost`, from upstream's #83, off by default: a row says about how many tokens the context grew by with its call's answer, after its time (`85 ms +42k`, `~+14k` when a step's growth is shared by two or three calls; more get no row figure), and a station's count line adds its sum (`9 · 180k`). It is an estimate shown one step late; a subagent's calls get none. A pulse's width grows with its call's tokens, from a radius of 3 at none to 7 from 50k. `/workmap usage` names the three calls that added the most. The legend has one more line.

## 0.11.0 (2026-11-17)

- New option `guardedHooks`, on by default. On a Team or Enterprise login an organisation's guard skips five of the mod's hooks and the transcript gets a notice each time; turn it off and the mod adds no hook on them. The map then loses the Hooks station, the records a hook adds, the row of a typed slash command and the mark of a compaction, which it takes in its place from a sharp fall of the context (never at a `/clear`, nor at a switch to a model with a larger window).
- Classification follows upstream's, now kept in `hooks/classify.ts`:
  - Built-in tools land by what they are for, by name alone: the task list, the plan and notifications on You; schedules, `ScheduleWakeup` and background waits on Agents; the skill, plugin and connector catalogues on Skills; work kept on claude.ai on Network; `LSP` on Files. An MCP server's resources follow the server.
  - The browser reached from a cloud session lands on Browser.
  - Shell commands are read where they belong: a command inside a loop, a condition or a group, one handed to `bash -c` or `eval`, a script given to a shell in a here-document, and the command `docker exec` or `docker run` runs in a container. A separator inside quotes parts nothing, and the text of a here-document is no command. More network commands are known by name or subcommand. A line is read up to its first 8,000 characters.
- A station keeps the session's errors under its count, `· 4✕` in red (`4✕` in the cells, and in the line of counts with no map), which a new message does not clear as it does the red dot. A faint `+3` shows what the calls since your last message added, once the count holds more than that. In the cells the figures stay within ten cells, the `+3` dropped first. The hover title names both, and the legend has two more lines.
- New option `serverStations`: put an MCP server's tools on a station of your choice, each as `server=station`. Memory keeps `memoryServers`.
- Fixed: a call still running stays in the list of rows however many came after it, as its last rows, taking half the list at most; the map and the list now say the same.
- Fixed: the refusals the mod remembers until their calls come by are held to the newest 64, so a call that never comes cannot stay for the session.
- In iTerm2 the picture is off and the map stays in cells (`terminalPicture`): iTerm2 keeps every frame it is sent in memory. The mod knows it by `TERM_PROGRAM`, or `LC_TERMINAL` over ssh or in tmux.
- A permission prompt that has waited on you for a second reads as needs you: the top line says `Needs you: permission for Shell: the call`, and with `notify` on you are told once. A mode that settles it at once (accept edits, bypass permissions, auto mode's classifier) never shows it. A call you refuse at the prompt now reads as refused, not as a failure, and counts with the refusals.
- Fixed: where no surface is attached at the start, as in the desktop app, the pane is no longer opened into nothing; it opens when a surface attaches.
- The rows are grouped by turn. Your message opens a turn, whose bold header (`Turn 3 · 12.4 s · 7 calls · 1 error`) leads the list with the turn's rows under it; the four turns before it shrink to dim headers. The list stays within 16 lines. What a settings hook or a typed skill adds at your message lands on that message's turn. A turn a background task's notification starts opens no header. The legend has one more line.
- A line under the top line, `✎ 3 files changed: map.ts ×7, text.ts ×2, README.md`, lists the files Claude wrote or edited, by name with their edits, the most edited first, within 100 characters, the rest counted. A call that was refused or failed counts for nothing. `/workmap changed` answers the 40 most recently changed, one a line. The legend has one more line.
- Warnings when a session looks stuck, in amber under the top line, with a dashed amber ring at the station (the sign in amber in the cells, and in the window): the same command failing three or more times in a row in one loop, a call running past 60 seconds and five times its station's usual time, and a thinking or running turn with nothing at work, no call and no model step, for three minutes. A call's time runs from when it was allowed, so a long permission prompt never reads as running long. A background task and a wait on you never warn. The legend has one more line.
- Usage gauges: two thin arcs outside the context ring show how much of the five-hour and the weekly limit is used (the inner one the five-hour), in the ring's colours: amber from 70%, red from 90%. Hovering one in the app names the window and when it resets. The session's cost, an estimate, stands under the word below the centre as `$1.23`, nothing under a cent; its hover title and the legend say it is an estimate. `/workmap usage` answers the context's fill and its categories, each as a share of the window, then each window with its reset, then the cost; a figure the engine lacks is left out. The legend has one more line.
- Every session at a glance: `/workmap all` shows each session with a surface as a tile, the ones that need you first (amber, and red for errors), with its folder's name, its state word, the top line, the context and its time. In Windows Terminal from WSL it opens a window beside this one (`view.mjs --all`; keys `1` to `9` show a session's rows, `Esc` goes back, `q` closes); elsewhere it answers the tiles as text. Each session keeps a status file in a folder of the person's own, `$XDG_RUNTIME_DIR/lot-map-sessions`, else `~/.cache/lot-map/sessions` (none with neither, as on Windows), removed when it ends (not at a `/clear` or a resume), and files an hour old are swept at a session's start. See PRIVACY. The legend has one more line.

## 0.10.0 (2026-11-16)

- `/workmap` is a second name for `/lot-map`: the same pane or window, and `/workmap window` as `/lot-map window`.
- The map window gives the map its room first:
  - The map is as large as the pane's width allows while the list keeps `windowRows` rows, a new option, 10 by default.
  - The map never has fewer than 12 rows. In a 53x31 split it grew from 12 rows to 19.
  - `m` goes round the map with the list, the map alone, and the list alone.
- Fixed: after a resize the picture could keep its old size until the map next changed, since Chromium went on capturing the viewport it had. The renderer now captures the map's own size every time, in the window and in picture mode alike.
- One word under the centre says what the session is doing: thinking, running, needs you, compacting, done or idle. In the cells it sits under the model's name.
- Needs you:
  - While Claude asks you a question or puts a plan to you, the top line reads `Needs you:`, counting the time in the warning colour.
  - After the answer it reads `Done … ago · your turn`.
  - `ExitPlanMode` now lands on You, not Shell.
  - New option `notify`, off by default, raises a notification for each.
- A failed shell command's row shows its exit code, such as `exit 1`, and nothing of its output.
- Claude's plan as a checklist under the top line, when it keeps one (TaskCreate and TaskUpdate, or TodoWrite):
  - progress, and the last two tasks done with the calls and time each took
  - the task in progress, in bold
  - the next two
  - every other call counts as work on the task in progress
- Background work stays pinned under the top line with its time so far, instead of scrolling away among the rows.
- A legend:
  - `/workmap help` says what each mark means, in the session's language.
  - `?` in the window puts it where the rows are.
  - In the app, hovering a station names its calls, errors and refusals.
- A subagent's failures show on the subagent: its dot at Agents turns red, and its rows carry its name (`↳ explore auth · …`).
- A refused call looks different from a failed one:
  - Its row reads `⊘` in the warning colour.
  - Its count stands apart from the red dot, in an outline at the station's lower left. In the cells it's red, beside the dot.

## 0.9.1 (2026-11-16)

- Fixed: the map window grew by a whole screen at each resize. Windows Terminal answers a clear of the screen (`ESC [ 2 J`) by moving the screen, pictures and all, into the scrollback. The window now draws in the alternate screen, which keeps no scrollback, clears in place, and gives the pane back as it was when it closes.
- Fixed: after a resize a frame painted at the old size could be drawn over the rows. The window now draws only frames of its current size.

## 0.9.0 (2026-11-16)

- In Windows Terminal from WSL the map is [a window of its own](README.md#a-window-of-its-own), in place of the pane: the picture, as the app draws it, with the rows under it. It opens the first time you write in a session, when its tab is the one in front, since a session can start in the background. `/lot-map` opens it again after `q`, and no second one while it shows. Where it cannot open, the pane opens instead; kitty keeps its pane.
- New option `terminalWindow`, `auto` by default; `off` keeps the pane.

## 0.8.3 (2026-11-16)

- Fixed: a docked pane under 28 rows dropped the map and kept only the rows, as in a terminal window about 31 rows tall. It held eight rows for the feed even when that left the map too short. Now the rows give way first: the map stays while its 20 rows fit, and the rows take what is left.

## 0.8.2 (2026-11-12)

- The map window shows the rows under the map, as the pane does: the action now, then the last sixteen rows, at work in the accent, faults in red. They take the room under the picture, and in a short window give way before the map.

## 0.8.1 (2026-11-12)

- Fixed: the map window opened black and closed. A pane Windows Terminal starts through `wsl.exe` has a bare PATH, without `~/.local/bin`, so the renderer found no Chromium, after waiting on the snap `chromium-browser`, whose `--version` never returns on WSL. `/lot-map window` now hands the window the Chromium the session finds, and the renderer also looks in `~/.local/bin` and `~/bin` before `chromium-browser`, waiting at most five seconds on each.
- The window says "Starting the map…" until the first picture, and when the map cannot be drawn it says why and stays until `q`.

## 0.8.0 (2026-11-12)

- `/lot-map window`: the map, as the app draws it, in a pane of its own beside the session, for a terminal that shows Sixel pictures but not a mod's, such as Windows Terminal. From WSL it splits the current Windows Terminal tab; elsewhere it gives the line to run. See [A window of its own](README.md#a-window-of-its-own).
- The window closes when the session ends, or on `q` or ctrl+c; a `/clear` keeps it.
- [PRIVACY.md](PRIVACY.md) says what the window writes and runs.

## 0.7.1 (2026-11-12)

- Fixed: when a renderer starts it clears up after renderers that were killed, and it could also remove a `lot-map-*` file or folder in the temporary directory that was not one of theirs. Now it removes only a folder holding a renderer's pid file whose process is gone.

## 0.7.0 (2026-11-12)

- Pictures in a terminal that shows them (kitty, Ghostty, iTerm2 3.5 and later): headless Chromium paints the map exactly as the app draws it, and the pane shows each frame. Everywhere else, and whenever a picture is refused, the map stays in cells. See [Pictures](README.md#pictures).
- New option `terminalPicture`, `auto` by default; `off` keeps the cells in every terminal.
- Picture mode runs a local renderer (Node and headless Chromium) and writes the drawing and its frames to a temporary folder that goes with the session. [PRIVACY.md](PRIVACY.md) says what it does and does not do.

## 0.6.0 (2026-11-12)

- The map in a terminal: the pane paints the same map in coloured cells, split in four with block characters, and repaints it in place so that it moves as it does in the app. Docked beside the conversation the map sits above the rows; inline above the prompt it sits at the left with the rows beside it. See [In a terminal](README.md#in-a-terminal).
- The pane asks for 60 columns when it docks and 22 rows when it opens inline, room for the map's labels.
- New option `terminalMap`, on by default: off, a terminal shows the rows and one line of counts, as before.

## 0.5.3 (2026-11-12)

- Portuguese labels: `language` takes `pt`. Contributed by Obsessi0n. (#31)
- A shell command behind `sudo`, `env`, `time`, `timeout`, `nohup`, `nice`, `xargs`, `command` or `exec` is read as the command it runs: `sudo curl` lights Network, where it used to light Shell.
- Fixed: `find … -exec curl` lit Files, the station for commands that work on files and nothing else. `find` with `-exec` is now read by the command it runs.
- More commands light Network: `git -C dir push`, `python -m pip install`, `uv`, `pipx`, `poetry`, `pnpm dlx`, `npx -y`, `docker compose pull`, `go get`, `apt install`.
- `rm` and `rmdir` light Files.
- Fixed: a typed slash command could drop the row of a background task still running, once more than 80 rows had passed since it began.
- Control characters are taken out of a typed slash command's name, as out of every other label.
- An MCP tool's name with doubled underscores reads with single spaces.

## 0.5.2 (2026-11-12)

- Fixed: for a web address with an IPv6 host and an `@` in its path or query, the label could show the text after the `@` instead of the host: `https://[::1]/x?tok=@secret` was drawn as `secret`. It now shows `[::1]`, and `[::1]:8080` keeps its port. Contributed by markedwardcampos. (#29)

## 0.5.1 (2026-11-11)

- The MP4 copy of the demo is back at `docs/demo.mp4`, where links from outside point; it was removed in 0.3.9. The README links to it again.

## 0.5.0 (2026-11-11)

- Back on the Hooks station: the rows for a hook that asked for permission and for a check that took a moment. They went in 0.4.0, when the hook that sees them was removed for a plugin catalogue's rules; that catalogue takes mods only from organizations it has verified, so the hook is back as it was in 0.3.9.
- The README and the privacy page say what that hook does: it reads what settings hooks decided and hands the decision on unchanged.

## 0.4.2 (2026-11-11)

- A privacy page, [PRIVACY.md](PRIVACY.md): what the mod is handed, what it keeps and what it does not do. `plugin.json` links to it. The map itself is unchanged.

## 0.4.1 (2026-11-11)

- More for a plugin catalogue's listing: a support link to this repository's issues, and keywords. The map itself is unchanged.

## 0.4.0 (2026-11-11)

- The mod no longer has a hook on permission checks. A settings hook's refusal is read from the error the refused call returns, so a refused call and the hook that stopped it still show, with the first line of the reason when `hookReasons` is on.
- Gone with that hook: the rows for a hook that asked for permission and for a check that took a moment.
- The README says what each of the mod's hooks does.

## 0.3.9 (2026-11-11)

- What a plugin catalogue shows about the mod: an icon, the author, and links to this repository. The map itself is unchanged.
- The MP4 copy of the demo is no longer in the repository; the GIF in the README shows the same session.

## 0.3.8 (2026-11-11)

- Italian labels: `language` takes `it`. Contributed by kesi26. (#20)

## 0.3.7 (2026-11-11)

- Background work stays on the map until it ends: a command sent to the background, a monitor, a background subagent or a workflow keeps its row open, and the row closes when the task reports back. A task that failed leaves a fault on its station. (#17)
- A background task's report is no longer drawn as a new message of yours.
- Monitor has its own label on the Shell station.

## 0.3.6 (2026-11-11)

- New option `colors`: colours of your own, by name, as `name=#rrggbb`. (#15)

## 0.3.5 (2026-11-11)

- The route is softer on a light surface, and each leg fades by itself: it stays for 40 seconds and fades over 20. (#14)

## 0.3.4 (2026-11-11)

- The PowerShell tool is read the same way as Bash, with PowerShell's own command names. (#13)
- A quoted path with a space is read as one word, and a Windows program is read by its name: `CURL.EXE` is `curl`.

## 0.3.3 (2026-11-11)

- Windows paths with backslashes are read: the label of a file, the memory folders and the names of commands. Contributed by davidkinsler. (#11)

## 0.3.2 (2026-11-11)

- New option `background`: with `transparent` the map leaves its ground out and the surface shows through. (#10)

## 0.3.1 (2026-11-11)

- Fixed: a password in a web address could reach a label when the address was written in an unusual way. An address that can be read two ways now shows only its scheme. (#6)
- A hook's refusal shows the name of the tool it stopped; its first line shows only with the new option `hookReasons`.
- The word after a memory command shows only if it is listed in the new option `memorySubcommands`.
- A name in `memoryCommands` counts when it is the command itself or begins with it and `-`, `_` or `.`.
- More commands light Network: `rsync`, `nc`, `sftp`, `npm install`, `docker pull` and the like, also inside `$(…)`.
- Control characters are taken out of every label.

## 0.3.0 (2026-11-10)

- New option `layout`: `you-bottom` turns the ring so that you are at the bottom and the network at the top.

## 0.2.0 (2026-11-10)

- The route: a thin line joins the last stations in order.
- Spokes wear in with use, and two clock hands grow around a station while a call runs.
- Memory has a colour of its own; what a hook brought unasked is drawn and counted apart.
- A ring around the centre shows how full the context window is.
- A change of model rings at the centre and gets a row of its own.
- Subagents circle the Agents station.
- Calls that start together fly side by side; a fault leaves a dot until the next message; finished calls at one station fold into one row.
- A light palette and the option `theme`; with `auto` the map follows a light or a dark surface by itself.

## 0.1.0 (2026-11-09)

- The first version: a pane beside the chat with ten stations that light up as memory, files, shell, the network, the model, agents, skills and hooks are used.
- Labels in English, Russian, Spanish, French and German.
