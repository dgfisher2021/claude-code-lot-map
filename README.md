# lot-map

***L**ive **O**verview of **T**ools*

A mod for Claude Code: a live map of the work, in a pane beside the chat. Every tool call, model step, hook and skill sends a pulse from the centre to its station, so you see memory, files, shell, web and agents at work instead of reading a list of commands.

![The map during a work session](docs/demo.gif)

*A made-up session replayed through the mod's own drawing code. [Video (MP4)](docs/demo.mp4).*

## Install

At the prompt of a terminal session:

```
/plugin install lot-map --marketplace alexeyw/lot-map
```

Answer `y` to add the marketplace, then choose a scope. From a shell:

```bash
claude plugin install lot-map --marketplace alexeyw/lot-map
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `alexeyw/lot-map`, then **Add plugin**.

The pane opens by itself when a session starts; in Windows Terminal from WSL the map is [a window of its own](#a-window-of-its-own) instead. In a terminal the pane needs at least 144 columns; otherwise type `/lot-map` or `/workmap`. A terminal draws the same map in coloured cells, moving as it does in the app: see [In a terminal](#in-a-terminal). Built and tested on Claude Code 2.1.321 on macOS; users report it working on Windows as well. The terminal map is tested on 2.1.322.

## Updating

From a shell:

```bash
claude plugin marketplace update lot-map
claude plugin update lot-map@lot-map
```

Then start a new session. The first command is needed: without it the second one reports the installed version as the latest.

What each version changed is in [CHANGELOG.md](CHANGELOG.md).

## What lights up

| Station | When |
| --- | --- |
| You | your messages, questions and files sent to you, the task list, the plan, and what you are asked to approve |
| Model | each model request, context compaction |
| Memory | Claude Code's memory folder, plus whatever you name in the options |
| Files | Read, Write, Edit, Grep, Glob, a language server's code intelligence, and shell commands that work on files and nothing else: they read, search, move, delete or edit in place (`cat`, `grep`, `mv`, `rm`, `sed`, `tee`, `find … -delete`) |
| Shell | every other shell command |
| Network | web fetch and search, MCP servers, work kept on claude.ai (artifacts, projects, designs), and shell commands known to reach the network: `curl`, `gh`, `ssh`, `rsync`, `git push`, `npm install`, `docker pull` and the like, also inside `$(…)` |
| Browser | browser tools |
| Agents | subagents, workflows, schedules, and waiting on background work; their own calls start from this station |
| Skills | skills, tool search, and the skill, plugin and connector catalogue |
| Hooks | settings hooks that refuse a call, ask for permission, add context or take a moment |

On Windows the PowerShell tool is read the same way as Bash, with PowerShell's own names: `Get-Content` and `Select-String` light Files, `Invoke-WebRequest` lights Network. A program run by its full path is read by its name, also from a quoted path with a space, and `CURL.EXE` is `curl`.

The shell stations go by the command's name, not by what it does: a script that opens a connection itself, such as `python -c "…"`, shows as Shell. A command behind `sudo`, `env`, `timeout`, `nohup`, `xargs` and the like is read as the command it runs, and `find … -exec` as the command it is told to run. So is a command inside a loop or a condition (`for … do`, `if … then`, `while`, `!`, `{ … }`), a line handed to a shell or to `eval` (`bash -c "…"`), a script handed to a shell in a here-document (`bash <<EOF`), and the command `docker exec` or `docker run` runs in a container. A separator inside quotes parts nothing. The text of any other here-document is not read, so a file written through one shows as Files whatever the text says. A line is read up to its first 8,000 characters. `npx` counts as Network only with `-y`, since without it it mostly runs what is installed already.

A pulse flies out when something starts and returns when it ends. Refusals and errors turn red.

## Reading the map

`/workmap help` (or `/lot-map help`) says what each mark means. In the window, `?` puts that legend where the rows are. In the app, hovering a station names its figures.

- **The route.** A thin line joins the last few stations the main loop went through, in order, and its newest leg draws itself. A leg stays for 40 seconds and then fades over 20, so a minute after the work stops only the spokes are left; their thickness keeps where the work went. Model steps are left out, or every leg would pass through Model.
- **Worn spokes.** A spoke grows thicker and brighter the more its station is used, so at the end of a session the map shows where the work went.
- **How long.** Two clock hands grow around a station while a call runs: the inner one goes round in a minute, the outer one in ten.
- **Claude's plan.** When Claude keeps a task list (TaskCreate and TaskUpdate, or TodoWrite), it shows under the top line as a checklist:
  - progress, such as `Plan 3/7 ████░░░░░░`
  - the last two tasks done, with the calls and time each took
  - the task in progress, in bold
  - the next two
  - every other call counts as work on the task in progress
- **Background work.** A command sent to the background, a monitor, a background subagent or a workflow stays lit on its station after the turn that started it is over, with the clock hands growing, until the task reports that it ended. Under the top line it stays pinned, the newest five, with its time so far (`↻ Shell  Build the site  2 min 10 s`), instead of scrolling away among the rows. A task that failed leaves the red dot. The report itself is not shown as a message of yours.
- **Several at once.** Calls that start together fly side by side, and the station carries their number, such as `×3`.
- **What went wrong.** A red dot with a count stays on a station from an error until your next message. A call refused there, by a hook or a permission prompt, counts apart in an outlined badge at the station's lower left (in the cells, in red beside the dot): a rule at work rather than something broken.
- **The session's errors, and this turn's calls.** Under a station the count carries two more figures. A faint `+3` is what the calls since your last message added, shown once the count holds more than that turn's. A red `· 4✕` (`4✕` in the cells) is the errors there in the whole session: the red dot goes at your next message, this stays. In the cells they are dropped when the figures would pass ten cells, the `+3` first. With no map the line of counts reads `Shell 27 · 4✕`, and hovering a station in the app names both.
- **Memory.** It has a colour of its own. A solid pulse is a memory Claude asked for; a hollow one on a dashed line is what a hook brought unasked. Under the station, the plain number counts the first and `↓` the second.
- **What the session is doing.** One word under the centre: `thinking` from your message, `running` while a call works, `needs you` (blinking) while Claude waits on you, `compacting`, `done` when the answer is ready, and `idle` before the first message. Background work doesn't count as running.
- **The context window.** The ring around the centre fills as the session goes, with the percentage above the name. It turns amber at 70% and red at 90%.
- **A change of model.** The centre and the Model station ring for a few seconds, and the feed gets a row such as `opus 5.5 → fable 5.2`. This also happens when a session starts on a different model from the last session in the same folder.
- **Subagents.** Each one still at work circles the Agents station as a small dot, and its calls start from there. Its rows carry its name, the short description it was started with, as in `↳ explore auth · Run the tests`. Its dot turns red when one of its calls fails or is refused; the count lands on the station of the call, as any other.
- **The answer.** One wide ring leaves the centre when the answer is ready.

Below the map is the current action with the context percentage. While Claude waits on you, with a question or a plan for your approval, that line reads `Needs you:` and what for, counting the time in the warning colour. Once the answer is ready it reads `Done … ago · your turn`. A permission prompt isn't shown: Claude Code tells a mod when it might ask, not when you answer. Under it are the last 16 rows: `●` running, `·` done, `✕` failed, `⊘` refused, `◆` a change of model. A failed shell command shows its exit code, such as `exit 1`: a `grep` that finds nothing, a `diff` that finds differences and a failed test run all count as failures. Finished calls that follow one another at one station fold into one row, marked `+2` for the two it stands for besides the one named. A call still running is never pushed out of the list by what came after it: it stays as the last row until it ends. Such rows take half the list at most; with more still running than that, the last one is marked `+22` for the rest.

| At work | Subagents | A hook refuses |
| --- | --- | --- |
| ![At work](docs/map-working.png) | ![Subagents](docs/map-agents.png) | ![A hook refuses](docs/map-blocked.png) |

| A change of model | After the answer | Light colours |
| --- | --- | --- |
| ![A change of model](docs/map-switch.png) | ![After the answer](docs/map-after.png) | ![Light colours](docs/map-light.png) |

## In a terminal

A terminal shows no drawing of the app's kind, so the map is painted into the pane's cells instead: each cell is split in four with the block characters `▘▝▀▖▌▞▛▗▚▐▜▄▙▟█` and given the two colours that fit it best, and the names and counts are written over it as text. Everything the drawing shows is there: the stations, the worn spokes, the route, the pulses and the rings, the clock hands, the context ring, the subagents circling their station.

<img src="docs/map-terminal.png" width="480" alt="The map painted in terminal cells, 60 columns by 28 rows">

*A made-up session through the mod's own painting code, drawn as a terminal would show its cells.*

Docked beside the conversation (the fullscreen layout) the map sits above the rows. Inline above the prompt (the main screen, and tmux by default) it sits at the left with the rows beside it.

It moves because the mod repaints it in place, about 25 times a second while something flies, 11 while something runs, and 4 while the map only breathes. A frame that would look the same is not sent. A frame takes a few milliseconds.

- The pane asks for 60 columns when it docks and 22 rows when it opens inline. In a short dock the rows under the map give way before the map does. Below 44 columns, or 20 rows for the map, the pane keeps the rows of text and one line of counts, as before.
- A docked pane keeps the width you last dragged it to, and that wins over what the pane asks for. When it is too narrow for the map, the pane says how wide to make it: drag its edge.
- It needs a terminal with 24-bit colour: Windows Terminal, iTerm2, kitty, WezTerm, Ghostty, GNOME Terminal and most others have it. Where block characters show gaps between them, turn on the terminal's own drawing of box and block characters if it has one.
- `theme` set to `auto` paints dark in a terminal, which does not say what colour it is: on a light terminal set `theme` to `light`.
- `background` set to `transparent` leaves the terminal's own background showing.
- Set `terminalMap` to `false` to keep only the rows of text.

### Pictures

A terminal that shows pictures gets the map exactly as the app draws it: kitty 0.28 and later and Ghostty, the terminals in which Claude Code draws a mod's `Image`. There `renderer/render.mjs` paints the map's own SVG in headless Chromium, animations and all, and the pane shows each frame it paints. The cells stay for every other terminal, and take over at once if anything about the pictures fails. They stay in iTerm2 too: it keeps every picture it is sent until its tab is closed (about 2 MB a frame in 3.7.7), so there the picture is off. The mod knows iTerm2 by `TERM_PROGRAM`, and by `LC_TERMINAL` over ssh or inside tmux.

- It needs Node 22 or later and a Chromium that runs: the first of `chromium`, `chromium-browser`, `google-chrome` on your PATH, or the one `LOT_MAP_CHROMIUM` names.
- The animations are paused in Chromium and stepped by the renderer: up to 15 frames a second for four seconds after the map changes, 4 for the next sixteen, 2 while a call runs, and one every two seconds after that. On a WSL laptop that came to about a quarter of one core while busy and 6% at rest.
- A picture of 12 by 24 pixels per cell is sharp on a terminal at normal scaling.
- Inside tmux, Claude Code draws no pictures unless it is told to with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` and tmux has `allow-passthrough` on; lot-map follows the same rule.
- Windows Terminal shows no pictures of this kind: use [a window of its own](#a-window-of-its-own) beside the session, or run kitty inside WSL (`sudo apt install kitty`, then `kitty`), which WSLg shows as an ordinary window.
- Set `terminalPicture` to `off` to keep the cells in every terminal.

### A window of its own

`/lot-map window` shows the map, as the app draws it, in a pane of its own beside the session, for a terminal that shows Sixel pictures but not a mod's: Windows Terminal 1.22 and later, foot, mlterm, WezTerm.

In Windows Terminal from WSL the window is the map: the session opens no pane, and the window opens the first time you write in the session, when its tab is the one in front. A session can start in the background, so it does not open at the start. `/lot-map` opens it again after `q`, and opens no second one while it shows. Where it cannot open, the pane opens instead. A terminal that shows pictures (kitty) keeps its pane. Set `terminalWindow` to `off` to keep the pane.

- From WSL in Windows Terminal it splits the current tab (`wt.exe -w 0 split-pane`) and starts the window there. Anywhere else it answers with the line to run in a pane of your own: `node <plugin>/renderer/view.mjs <folder>`.
- The session keeps its live map and the rows under it in a temporary folder of its own while the window is wanted. The window runs the same renderer as [Pictures](#pictures), at the size of its pane, draws each frame as Sixel, at most ten a second, and under it the action now and the last rows, as the pane does. In a short pane the rows give way before the map does.
- The map takes the room first: as large as the pane's width allows while the list under it keeps `windowRows` rows (10 by default), and never fewer than 12 rows in a short pane.
- `m` goes round the map with the list, the map alone, and the list alone.
- `?` swaps the rows for the legend, and back.
- It closes when the session ends, or on `q` or ctrl+c. Closing it leaves the session as it was; `/lot-map window` opens it again. A session switched away from in its tab keeps its window there until it ends or `q`.
- It needs Node 22 and a Chromium, as pictures do.

## Options

The install offers them on a screen. Later, use `/config` in a terminal or `claude plugin configure`, then restart the session.

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | `en` | `en`, `ru`, `es`, `fr`, `de`, `it` or `pt` |
| `coreName` | `CLAUDE` | what the circle in the middle says, up to ten characters |
| `memoryServers` | `memory` | MCP servers whose tools light Memory |
| `memoryCommands` | none | shell commands or scripts that light Memory; a name counts when it is the command itself or begins with it and `-`, `_` or `.`, so `recall` also names `recall-sync.py` |
| `memorySubcommands` | none | words after a memory command that the map may show, such as `add` or `search`; without them the command goes by its own name |
| `memoryPaths` | none | parts of a path that make a file a memory |
| `memoryLabels` | none | short names for memory tools, each as `tool=name` |
| `serverStations` | none | put an MCP server's tools on a station of your choice, each as `server=station`, with `files`, `shell`, `web`, `browser`, `agents`, `skills` or `you`; the row still reads `server: tool`. What you set wins over the mod's own routes for the servers it knows. Memory keeps `memoryServers`, which wins if a server is in both; an unknown station is ignored |
| `hookRecords` | `false` | turn on if a hook of yours adds memory records numbered like `[#123]`; they appear on Memory by number only. Such a number in the text of any hook counts, not only a memory hook's |
| `hookReasons` | `false` | show the first line of a hook's refusal, up to 72 characters; off, the map says only which tool was stopped |
| `guardedHooks` | `true` | turn off on a Team or Enterprise login where the transcript gets notices like `lot-map: its classic.PreToolUse hook was skipped`. An organisation's guard keeps mods away from five events there, and with this off the mod adds no hook on them. The map then loses the Hooks station, the records a hook adds, the row of a typed slash command and the mark of a compaction (it marks a sharp fall of the context in its place); a call a hook refused still gets its `✕`, as a failed call and not as a blocked one |
| `theme` | `auto` | the map's colours: `dark`, `light`, or `auto`, which is dark on a dark surface and light on a light one |
| `background` | `solid` | the map's own background, or `transparent`, which lets the pane behind it show through. The rim around the labels keeps the background's colour, so on a surface of another shade it shows as a faint halo |
| `colors` | none | colours of your own, each as `name=#rrggbb`; see [Colours of your own](#colours-of-your-own) |
| `terminalMap` | `true` | in a terminal, paint the map in cells above the rows; `false` keeps the rows and one line of counts |
| `terminalPicture` | `auto` | in a terminal that shows pictures, `auto` has headless Chromium paint the map as the app draws it; `off` keeps the cells. See [Pictures](#pictures) |
| `terminalWindow` | `auto` | in Windows Terminal from WSL, `auto` makes the map [a window of its own](#a-window-of-its-own) in place of the pane; `off` keeps the pane |
| `windowRows` | `10` | the rows [the map window](#a-window-of-its-own) keeps for the list under the map, 3 to 30; the map takes the rest |
| `notify` | `false` | raise a notification when Claude asks you a question or puts a plan to you, and when a turn ends: useful for sessions in the background |
| `layout` | `you-top` | where you are on the map: `you-top`, or `you-bottom`, which turns the ring half a turn so that you are at the bottom and the network and the browser at the top |

For example, Russian labels and your own memory server:

```bash
echo '{"language":"ru","memoryServers":"my-memory"}' | claude plugin configure lot-map@lot-map --values-stdin
```

Lists are written with commas.

| Russian labels | `layout` set to `you-bottom` |
| --- | --- |
| <img src="docs/map-russian.png" width="320" alt="The map with Russian labels"> | <img src="docs/map-turned.png" width="320" alt="The map turned, with the person at the bottom"> |

## Colours of your own

`colors` replaces the map's colours one by one. Set one, a few, or all thirteen; what you leave out stays as it is.

```bash
echo '{"theme":"dark","colors":"accent=#7fb4ff,active=#b8d6ff,text=#e6edf7"}' | claude plugin configure lot-map@lot-map --values-stdin
```

| Name | What it colours |
| --- | --- |
| `background` | the map's ground, and the rim around the labels |
| `node` | the inside of a station and of the centre |
| `line`, `spoke` | the dashed contours and the idle spokes |
| `text`, `label`, `faint` | the name in the centre and lit labels, the other labels, the counts |
| `accent`, `active` | the main colour, and a station at work |
| `error` | errors and refusals |
| `memory`, `memoryActive` | the Memory station and its spoke |
| `route` | the route between stations |

<img src="docs/map-colors.png" width="640" alt="The map in two palettes of one's own: a cool blue one and a green one">

- Only `#rgb` and `#rrggbb` are taken. Anything else, and any other name, counts as not set.
- With `theme` left on `auto`, a colour of your own holds on a light surface as well, and the rest is repainted as before. With a whole palette of your own, set `theme` to `dark` or `light`.
- With `background` set to `transparent`, still give `background` here the colour of your pane: the rim around the labels takes it, and the halo is gone.

## What it shows and what it keeps

The mod makes no network requests, reads no files, runs no processes, calls no model and adds nothing to the conversation. The exceptions are [picture mode](#pictures) in a terminal that shows pictures and [the map window](#a-window-of-its-own) when you ask for it, where it runs a local renderer and writes its drawing and frames to a temporary folder. Its rows live only for the session. The same on one page: [Privacy](PRIVACY.md).

Like any mod that follows tool calls, it is handed every call's whole input, including command lines and the text written to files. It takes names from that and nothing else; the code that does so is `classify` in `hooks/map.ts`. A marketplace added from this repository follows its `main` branch, so an update brings whatever is there: read the diff before updating if that matters to you.

It asks Claude Code for one thing: how full the context window is, after each model step. Between sessions it keeps one thing, the name of the model last used in each folder, so that it can show a change. Each is stored under the folder's full path, in Claude Code's own store for the plugin.

What its hooks do. The mod listens to the session's start, prompts, turns, model steps, tool calls, skills, compaction, and to three events of settings hooks: `PreToolUse`, where it sees whether a hook refused the call, asked for permission or took a moment, and `UserPromptSubmit` and `SessionStart`, where it sees the context a hook added. Each of its hooks passes the event on as it came and returns what came back as it was: it changes no input, no result, no context and no permission decision, and makes none of its own. Its one command, `/lot-map`, also called `/workmap`, opens the pane, or in Windows Terminal from WSL the window; `/lot-map window` opens [a window of its own](#a-window-of-its-own).

A label holds a name, never content:

- a file: the last two parts of its path;
- a web address: the host alone, without a login, password, path or query; an address that can be read two ways shows only its scheme;
- a shell command: the short description Claude wrote for it, or the command's name, never the command line. The description is the model's own words, and the mod shows them as written. A failed one also shows its exit code, read from the first line of its answer, never its output;
- a memory call: the tool's name and a record number or short identifier, never the text or the query;
- a memory command: its name, and the word after it only if you listed that word in `memorySubcommands`;
- a subagent: the short description it was started with;
- a task of Claude's plan: its subject as Claude wrote it, cut to sixty characters, never its description;
- a background task's report: that the task ended and whether it failed, never its summary or its output;
- a hook's refusal: the name of the tool it stopped. Its first line shows only with `hookReasons` on, because a refusal may quote what the hook found.

Control characters are taken out of every label before it is drawn.

A fault on the map never reaches a tool call or a model turn.

## Developing

```bash
claude plugin test .
claude plugin validate .
```

The terminal's map is painted by `hooks/raster.ts` from the same geometry and timings as the drawing in `hooks/map.ts`. Its pictures come from `renderer/render.mjs`, which takes `map.svg` and gives back `frame.png`, one line on its output for each: run it by hand with `node renderer/render.mjs` and write a map into the folder its first line names.

Words live in `hooks/text.ts`; a new language is one more table there and one more value of `language` in `.claude-plugin/plugin.json`.

Before you send a change, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
