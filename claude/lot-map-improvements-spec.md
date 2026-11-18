# lot-map improvements: the map and the task list

Status: wave 1 shipped in 0.10.0 (PR #5, 2026-11-16). Wave 2 shipped in 0.11.0 (2026-11-17), with what wave 1 left and upstream's fixes; see [Left after wave 1](#left-after-wave-1) and [Left after wave 2](#left-after-wave-2). Wave 3 shipped in 0.12.0 (2026-11-17), items 21–30; item 31, the rename, waits for the person's word. See [Left after wave 3](#left-after-wave-3). Written 2026-11-16 against lot-map 0.9.0 (fork `main`). The items are in three waves, numbered in the order they would be built.

## Goal

Make lot-map the one place to glance at for any Claude Code session. Within two seconds it should answer:

1. **Is it working, stuck, or waiting on me?**
2. **What is it doing right now, and for how long?**
3. **How far through the plan is it?**
4. **What has it changed?**
5. **What is it costing:** context, rate limits, money?

Before wave 1 it answered question 2 well, questions 1, 4 and 5 only in part, and question 3 not at all. Since 0.10.0 it answers questions 1 to 3, and since 0.11.0 a permission prompt waiting on you (item 13) and questions 4 and 5 as well: the changed files, the usage gauges and the cost.

## Principles to keep

- **Names, never content.** This is the README's existing rule. Anything that would show content (error text, prompts) is an option and off by default.
- **Local only.** No model calls, no network, and no change to any call, permission or context.
- **Glance first, detail on demand.** The default view stays calm, and detail comes from a key, a command or a hover.
- **One model, every surface.** The app, the docked pane, the cell map and the Sixel window all show the same state.

## Before wave 1 (0.9.0), in brief

**Map:**

- 10 stations around the core.
- Pulses out and back, worn spokes, and the route of the last few stations.
- Clock hands while a call runs.
- Red fault dots and a context ring.
- Subagent dots, a model-change ring and an answer ring.

**List:**

- The action now, with context %.
- The last 16 rows (`●` running, `·` done, `✕` failed, `◆` model change).
- Repeats at one station fold into `+N`.

**Counts and badges:** The number under a station is a session total, the red badge counts faults since your last message, and `×3` counts calls running at once. None of this is labelled. Any shell command that exits non-zero counts as a fault, and a subagent's failures land on the station of the call that failed, not on Agents.

## The waves

- **Wave 1, done in 0.10.0 (1–10):** `/workmap` command, core state, needs you, exit codes, blocked vs failed, subagent failures, legend, background pinned, plan checklist, window favours the map.
- **Wave 2, done in 0.11.0 (11–20):** quiet under an organisation's guard, upstream's fixes ported, permission prompts as needs you, session fault total, this turn's `+N`, rows by turn, files changed, stuck warnings, usage gauges, every session at a glance.
- **Wave 3, done in 0.12.0 (21–30; 31 waits):** error first line, more rows on demand, session recap, timeline, context cost per call, subagents apart, MCP station, time share, file satellites, accessibility, full rename to workmap.

## Wave 1: done in 0.10.0

The biggest glance value for the least work. Every item uses data the mod already sees, and the small fixes come before the legend that explains them.

### 1. `/workmap` as a second command name (command · effort small)

- Register `/workmap` as a second command name. `/lot-map` keeps working.
- The plugin stays `lot-map`. Upstream's updates no longer merge cleanly anyway (see [Upstream since the fork](#upstream-since-the-fork)).

Items below write `/workmap`; `/lot-map` works the same.

### 2. The core shows the session's state (map · value highest · effort small)

**What:** the core reads one word in a matching colour: thinking, running, waiting for you, compacting, idle or done. "Waiting for you" pulses amber.

**Why:** the single most useful glance signal. It pairs with 3.

**Data:** the same events as 3, plus `turn.step` and `session.compact`.

### 3. "Needs you" (list · value high · effort small)

**What:**

- The top line becomes a banner when Claude is waiting on you, with how long it has waited. That covers:
  - a permission prompt (left out of 0.10.0; now item 13)
  - a question (AskUserQuestion)
  - a plan waiting for approval
  - a finished turn
- Optionally, a notification when a background session needs you or finishes. Off by default.

**Why:** answers question 1. With several background sessions, the costliest moment is one sitting idle waiting for you unseen.

**Data:**

- `tool.check` (where permission is decided)
- `tool.call` for AskUserQuestion and ExitPlanMode
- `turn.complete`
- `ui.notify` for the notification

### 4. Exit codes in the list (list and map · effort small)

**What:** a failed shell row shows its exit code, for example `✕ Shell  npm test  exit 1`. This tells "grep found nothing" from "it crashed".

**Data:** the exit code in the shell tool's result. It's a number, not content.

### 5. Blocked looks different from failed (list and map · effort small)

**What:**

- A call refused by a hook or a permission prompt gets its own mark (a lock, or an outlined badge) instead of the red count.
- The row reads `⊘` instead of `✕`.

**Why:** a refusal is a rule working, not something broken.

### 6. A subagent's failures show on the subagent (list and map · effort small)

**What:**

- When a subagent's call fails, its dot at Agents turns red as well as the station of the call.
- The row carries the subagent's label, for example `↳ explore-auth · Shell ✕ npm test`.

**Why:** today a subagent's failing command looks like the main session's.

### 7. A legend on demand (list and map · effort small)

**What:** `?` in the window and `/workmap help` explain the count under a station, the red badge, `×N`, `+N` and `↓`. In the app, hovering a station shows the same.

### 8. Background work pinned (list · value high · effort small)

**What:** running background shells, monitors, subagents and workflows each get a pinned line with elapsed time and status. Today they scroll out of the 16 rows while their station stays lit.

**Data:** already tracked by `taskOf` and `taskNotice` in `hooks/map.ts`.

### 9. The plan as a checklist (list · value high · effort medium)

**What:**

- Pin Claude's own task list above the rows: `◻` pending, `◼` in progress, `✓` done.
- Show "3 of 7" and a thin progress bar, with the task in progress in bold.
- Tag each row with the task that was in progress when it ran.
- Collapse a finished task into one line, for example `✓ Fix dock sizing · 14 calls · 2m 10s`.

**Why:** answers question 3, which nothing answers today, and turns a stream of calls into progress against a plan.

**Data:** the TaskCreate and TaskUpdate calls (TodoWrite on older versions), from their inputs in `tool.call`. A task's subject is the model's own words, shown as shell descriptions already are.

### 10. A window that favours the map (map · value high · effort small)

**What:**

- In a short window the rows shrink to a 3–5 line ticker before the map shrinks.
- A key switches between map only, list only and both.
- An option, `windowRows`, sets how many rows to keep.

**Why:** in a 53x31 split today the map gets 12 rows and the list 18, so the picture the window exists for is small.

### Left after wave 1

Checked on 2026-11-17 against fork `main` at 0.10.0 (91 tests pass) and upstream `alexeyw/lot-map` `next` at #94.

- **A permission prompt isn't "needs you"** (item 3). Wave 1 used only `tool.check`, which reports an ask before the mode settles it and says nothing when you answer. Now item 13.
- **Claude's task tools count on Shell.** TaskCreate, TaskUpdate, TaskList, TaskGet and TodoWrite fall through to Shell, as do 47 other built-in tools that upstream now places. Now item 12.
- **Under an organisation's guard, four marks never show.** On a Team or Enterprise login the organisation's guard (`cc-plugin-sec-default` here) runs ahead of every mod and sends five events past lot-map: `classic.PreToolUse`, `classic.UserPromptSubmit`, `classic.SessionStart`, `skill.prompt` and `session.compact`. It posts a notice for each, about once per hook per session plus once per skill run and per compaction. So on this machine:

  - the core never says "compacting" (item 2)
  - a call a settings hook refused reads as failed, not blocked (item 5)
  - a typed slash command makes no row
  - a record a hook adds to the context makes no row

  Now item 11.

- **Rows aren't tagged with their task** (item 9). The wave 1 plan decided that each task's count of calls and time stands in, since a tag on every row would crowd a 60-column pane. Not carried over.
- **The dock screenshot** at 60x24, the plan's last check, isn't among the PR's checks. Item 11 changes when the pane opens, so its checks take it.

### Upstream since the fork

The fork took its last upstream commit at #37 (2026-11-12). Since then it is 22 commits ahead of upstream `main` and 43 behind `next`.

**A merge is no longer cheap:**

- Upstream split `hooks/map.ts` into `classify`, `draw`, `feed`, `palette` and `setup`, while wave 1 added 418 lines to `map.ts`.
- Both sides added a `hooks/raster.ts`, with different code (upstream's 1,305 lines, the fork's 634).
- Both rewrote `register.tsx`, `text.ts`, the tests, the README and PRIVACY.
- Upstream drew its own map in a terminal (`terminalView`, with braille), beside the fork's cell map, picture mode and window.

So upstream's fixes come in by hand, with their tests, and the fork's own design stays.

| Upstream                     | What                                                                                                         | Here                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| #89, #90, #91 `guardedHooks` | leave out the five hooks an organisation's guard skips; open the pane once a surface is attached             | item 11                                    |
| #60, #66                     | built-in tools land by what they're for, not on Shell                                                        | item 12                                    |
| #50, #73, #92, #94           | shell commands land where they belong: constructs, nested shells, quotes, scripts, containers; cloud browser | item 12                                    |
| #72                          | a call still running stays in the list until it ends                                                         | item 12                                    |
| #93                          | the remembered refusals are held to the newest 64                                                            | item 12                                    |
| #82                          | no picture in iTerm2, which keeps every frame in memory                                                      | item 12                                    |
| #83 `contextCost`            | what each call added to the context                                                                          | item 25                                    |
| #86 `serverStations`         | an MCP server's tools on a station you choose                                                                | item 12 (ported with classify.ts)          |
| #40 `motion`                 | reduced motion                                                                                               | item 30                                    |
| #77                          | a running row coloured apart from a failed one                                                               | not needed: the fork already does          |
| #71 `subagentNames`          | a subagent's model step names the subagent                                                                   | not needed: item 6 names a subagent's rows |
| #33, #45, #46, #68, #41, #88 | terminal picture and braille, the `map.ts` split, the rows reworked, the model on the idle line, pane colour | not ported: the fork has its own           |

## Wave 2: done in 0.11.0

What changed and what it costs, and help for people running many sessions. It starts with what wave 1 left (11–13). Each new mark gets a line in the legend (item 7), in all seven languages.

### 11. Quiet under an organisation's guard (all surfaces · value high on Team and Enterprise logins · effort small)

**What:**

- Port upstream's `guardedHooks` option (#89, #91). It's on by default. Turned off, the mod adds no hook on the five guarded events, so the guard has nothing to skip and posts no notice.
- Port #90: the pane opens once a surface is attached, not before. This is the `ui.open` fault from the same upstream issue, #54.
- With it off, the README's options table says what's lost: the compacting state, the Hooks station's rows, a typed slash command's row, and blocked rows for a hook's refusals, which read as failed.
- A spike: whether `session.measure` still marks a compaction after the fact, when the context falls sharply. If it does, the map can still say a compaction happened.
- Turn `guardedHooks` off on this machine once it ships.

**Why:** on this machine the guard skips those hooks on every session, so they cost notices and add nothing.

**Data:** upstream #89, #90 and #91, with their tests.

### 12. Upstream's fixes, ported by hand (list and map · value medium · effort small to medium)

**What:**

- **Built-in tools land by what they're for** (#60, #66). Today 52 of them count on Shell. With the port:
  - Claude's task tools, TodoWrite, EnterPlanMode, PushNotification and the like go to You. The task tools' own calls then stop crowding Shell's count, and the plan checklist (item 9) already shows the plan they keep.
  - Schedules, wakeups and agent messages go to Agents.
  - LSP goes to Files.
  - The skill and connector catalogues go to Skills.
  - claude.ai work (artifacts' comments and data, projects, designs) goes to Web.
- **Shell commands land where they belong** (#50, #73, #92, #94):
  - a command inside a shell construct, a nested shell or a here-document
  - a separator inside quotes
  - a script handed to a shell
  - a command run in a container
  - the browser reached from a cloud session
- **A running call stays in the list until it ends** (#72). Today only background work is kept past the last rows, so a long foreground call can scroll out while subagents add rows.
- **The remembered refusals are held to the newest 64** (#93). Today a refusal whose call never comes back is kept all session.
- **No picture in iTerm2** (#82). It keeps every frame in memory, and the fork's picture mode lists iTerm2 3.5 as a picture terminal.

**Why:** these are bug fixes that apply to the fork's code as it is, and the fork stopped taking upstream's commits at #37.

**Data:** upstream's commits and tests, adapted to the fork's `map.ts`.

### 13. A permission prompt as "needs you" (list and map · value high · effort medium)

**What:** completes item 3. While a permission prompt waits on you, the core reads "needs you", and the top line reads `Needs you: permission for Shell` with its timer. With `notify` on, it notifies once.

**How:**

- A `tool.check` hook reads the verdict from `next(e)`. An `ask` marks the call as maybe waiting.
- If `tool.judge` fires, auto mode's classifier settles the ask, not you, so the mark clears.
- `tool.run` firing means the call was allowed; a refusal in the `tool.call` answer means it was denied. Either clears the mark.
- The wait shows only after the ask has stood unsettled for one second. A mode that settles asks at once (`acceptEdits`, `bypassPermissions`, `dontAsk`) never flickers.
- Not `classic.PermissionRequest`: it would name the prompt exactly, but the guard skips `classic.*` hooks (item 11).

**Spike first:** in a real session in `default` mode, confirm that `tool.run` fires only after you answer, and that a denied prompt reaches `tool.call` as a refusal.

**Data:** `tool.check`, `tool.judge`, `tool.run` and `tool.call`.

### 14. A session total of faults (list and map · effort small)

**What:** the red badge still clears on your next message. The count line keeps a session total beside it, for example `Shell 27 · 4✕`, so the history isn't lost.

### 15. This turn beside the totals (list and map · effort small)

**What:** a faint `+3` beside a station's session count shows what this turn added.

### 16. Rows grouped by turn (list · value medium · effort small)

**What:**

- A header for each of your messages, for example `Turn 4 · 1m 32s · 23 calls · 1 error`.
- The current turn stays open, and older turns collapse to their header.

**Why:** with 16 rows of one turn, you can't see what earlier turns did or cost.

**Data:** `turn.start` and `turn.complete`.

### 17. Files changed (list · value medium · effort small)

**What:**

- A "Changed" list: each file written, edited or deleted this session, with its edit count, by name only.
- Reads aren't listed.

**Why:** answers question 4 at the end of a session, before you look at the diff.

**Data:**

- Write, Edit and NotebookEdit
- shell commands already classed as file edits (`sed -i`, `mv`, `rm`)

### 18. Stuck and loop warnings (list · value high · effort medium)

**What:** an amber row and an amber station when:

- the same command fails 3 times in a row
- a call runs far past that station's usual time this session
- nothing has happened (no call, no model step) for a few minutes while the turn is still running

**Why:** catches a stuck session without reading the transcript.

**Data:** the existing rows, their timings and statuses.

### 19. Usage gauges (map · value high · effort small)

**What:**

- Beside the context ring, two thin arcs for the 5-hour and weekly rate-limit windows, plus the session's cost as `/cost` gives it.
- Amber and red thresholds, as the context ring has.
- On demand, the context broken down: system, tools, MCP, memory, messages.

**Data:** `$.session.usage()` (`rateLimits`, `cost`, `context` with `breakdown`), pushed by `session.measure`.

### 20. Every session at a glance (map · value high · effort medium)

**What:**

- One window shows every running session, background ones included, as tiles. Each tile has the session's name, its state (working, waiting for you, done, failed), its current action, context % and elapsed time.
- A number key opens one tile's full map.

**Why:** for anyone running several background sessions, one place answers "which needs me" without cycling through tabs.

**Data:**

- Each session already writes a live folder; it would add a small `status.json`.
- The viewer reads every `lot-map-live-*` folder. All local.

### Left after wave 2

Checked on 2026-11-17 against the `wave-2` branch at 0.11.0 (155 tests pass), with real Windows Terminal probes of the window and of `/workmap all`.

**Built differently from the text above:**

- **Compacting under the guard** (item 11): the live "compacting" word needs `session.compact`, which the guard skips. With `guardedHooks` off, a fall of the context by 30 points or more marks "compacted" afterwards instead.
- **A refusal by a hook under the guard** (item 11) still reads as failed: the mod learns of it only from `classic.PreToolUse`. A person's "No" at a permission prompt now reads as refused (item 13), from the ask that was never settled.
- **Every session at a glance** (item 20):
  - Each session writes `<id>.json` in a folder of the person's own, not a file in its live folder, so sessions without a window show too.
  - The folder is `$XDG_RUNTIME_DIR/lot-map-sessions`, else `~/.cache/lot-map/sessions`; with neither variable set, nothing is written.
  - A number key shows that session's rows, not its full map.
- **Nothing happening** (item 18): the warning comes only when nothing at all is at work, no call and no model step, for three minutes. A model request that hangs while it streams doesn't warn.
- **A warned station in cells** (item 18): its sign turns amber; the ring is drawn in the app and the window only.

**Left for later:**

- **Shell edits in "changed"** (item 17): `sed -i`, `mv` and `rm` are not listed, since their file names would mean reading the command's arguments.
- **More than nine sessions** (item 20): the window shows nine tiles with no "+N more"; `/workmap all` as text lists them all.
- **Earlier turns** (item 16): an error on a turn older than the last twelve kept no longer reaches a header, though the session totals count it.
- **The cost in cells** (item 19): at the dock's size the cost sits over the bottom of the arcs. It stays readable.
- **A message typed while a turn runs** (item 16): when the engine hands it into the running turn instead of starting a new one, what a settings hook added for it waits for the next message's turn.
- **SECURITY.md** still counts any file read or process started as a vulnerability. Since 0.7 the mod starts a renderer, and since 0.11 it reads its status folder; the page needs a rewrite for what the mod does now.

## Wave 3: done in 0.12.0

Larger, or useful in fewer sessions. The full rename comes last, once upstream updates are no longer wanted.

### 21. Error first line (list · value medium · effort small)

**What:** an option, `errorReasons`, modelled on `hookReasons`. It shows the first line of a tool's error, up to 72 characters. Off by default, since an error can quote content.

### 22. More than 16 rows, on demand (list · value low to medium · effort medium)

**What:**

- In the window:
  - keys to scroll back
  - `e` for errors only
  - `1`–`9` for one station
  - `/` to search labels
- Anywhere: `/workmap log` answers with the session's full list.

### 23. Session recap (list · value medium · effort small)

**What:** at the end of a session, or on `/workmap recap`, a short recap:

- turns and wall time
- calls by station
- files changed
- errors
- cost, and the peak context

It's the answer of a command, so it doesn't enter the model's context.

### 24. Timeline strip (map · value high · effort medium)

**What:**

- A thin strip under the map with one tick per call, coloured by station.
- It also marks turn boundaries, idle gaps and waits for you.
- In the window, scrubbing the strip replays the map to that moment.

**Why:** shows where the time went, for example "most of it waiting on the test run".

### 25. Context cost per call (map · value medium · effort medium)

**What:** a pulse's width shows how much of the context its result took, and the largest calls are named. This is upstream issue #80, `contextCost`.

**Upstream:** `contextCost` shipped in upstream 0.9.0 (#83): what each call added, on its row, and each station's sum on the desktop map. Port it, then add the pulse width.

### 26. Subagents you can tell apart (map · value medium · effort medium)

**What:**

- Each subagent's dot carries its short label and its own clock.
- A key expands one subagent's route and calls.
- A failed subagent turns red.
- A workflow shows as a cluster with progress, for example `4/9`.

### 27. MCP station per server (map · value medium · effort medium)

Upstream issue #55: an MCP station with a small mark per server that lights when one of its tools is called.

**Upstream:** #86 answered #55 another way: `serverStations` puts a server's tools on an existing station you choose. It came in with `classify.ts` in 0.11.0 (item 12); what is left here is deciding whether a per-server mark is still wanted.

### 28. Time share, not only counts (map · value low · effort small)

**What:** spokes thicken by number of calls today. Add a choice to thicken them by share of wall time, with the percentage beside each station on demand.

### 29. File satellites (map · value low · effort medium)

**What:** the most-touched files sit as small labelled dots around Files, with edited files marked.

### 30. Accessibility (map · value medium · effort small)

**What:**

- Shapes as well as colour for errors and waits.
- A high-contrast palette preset.
- Reduced motion, which upstream has as the `motion` option (#40), on its `main` since 0.9.0. This fork's `main` doesn't have it yet.

### Left after wave 3

Checked on 2026-11-17 against the `wave-3` branch at 0.12.0, with a real Windows Terminal probe of the window.

**Built differently from the text above:**

- **Timeline strip** (item 24): scrubbing it to replay the map is left out, since the board keeps no past maps. Under reduced motion the strip steps every five seconds, as the clock hands do.
- **Satellites** (items 27 and 29) are one mechanism: up to five labelled dots per station, for the most-touched files at Files and the MCP servers at their station. In cells a station shows only their count, `·N`.
- **The recap** (item 23) answers `/workmap recap` only, never on its own at a session's end (open question 3).
- **Subagents** (item 26): names and clocks are drawn in the SVG only. A Workflow's agents are grouped by being spawned while its call runs, which an Agent call made at the same time would join too.

**Left for later:**

- The window's station filter reaches the first nine stations, so Hooks can't be picked.
- A cell glow can outlast its time by up to five seconds under reduced motion.
- A workflow cluster counts at most 24 agents.

### 31. Rename to workmap and own the repo (repo · effort medium)

**Allowed:** the licence is MIT, copyright Aleksei Volodin. You may rename, change and publish it as your own, as long as `LICENSE` with his notice stays. Add your own copyright line for your changes.

- **What changes:** the name appears on 92 lines in 15 files:
  - the plugin and marketplace names in `.claude-plugin/`, so the install id becomes `workmap@workmap`
  - the command
  - the store key (`plugin: 'lot-map'` in `hooks/register.tsx`)
  - the temporary folders `lot-map-live-*` and `lot-map-*`, and the renderer's sweep that matches them
  - the variables `LOT_MAP_CHROMIUM` and `LOT_MAP_CELL`
  - the tests, README, PRIVACY, CONTRIBUTING, SECURITY and the issue templates
- **Repo:** rename `dgfisher2021/claude-code-lot-map` to `workmap`; GitHub redirects the old address. It stays marked as a fork of `alexeyw/lot-map`. To make it stand alone, either ask GitHub Support to detach it, or create a new repo and push the full history.
- **Switching over:**
  1. Uninstall `lot-map@lot-map` and remove its marketplace.
  2. Add the new marketplace and install `workmap@workmap`.
  3. Set the options again, since they're stored under the plugin id.
  4. The last model used in each folder is forgotten once, which is harmless.
- **Docs:** CONTRIBUTING sends pull requests to upstream's `next`, and the issue templates point upstream. Both get rewritten for your repo.

**Trade-offs:**

- Upstream fixes stop merging cleanly, since every renamed line conflicts. They come in by hand or by cherry-pick. As of 2026-11-17 they already do (see [Upstream since the fork](#upstream-since-the-fork)), so the rename adds little to that cost.
- You own the maintenance.
- Versions can carry on, for example `1.0.0` as the first workmap release.

**Recommendation:** item 1 is done. Since upstream's fixes come in by hand either way, do this one whenever it suits, as one pull request: the rename, the docs and a CHANGELOG entry.

## Data sources

| Need                            | Source                                     | Local only |
| ------------------------------- | ------------------------------------------ | ---------- |
| Calls, inputs, results, timings | `tool.call`                                | yes        |
| Turns                           | `turn.start`, `turn.step`, `turn.complete` | yes        |
| Waiting on permission           | `tool.check`, `tool.judge`, `tool.run`     | yes        |
| Plan                            | TaskCreate and TaskUpdate inputs           | yes        |
| Context, rate limits, cost      | `$.session.usage()`, `session.measure`     | yes        |
| Notifications                   | `ui.notify`                                | yes        |
| Every session                   | the live folders under `TMPDIR`            | yes        |

## Not in scope

- Reading file contents, or showing prompts or answers.
- Any network request, any model call.
- Changing calls, permissions or context.

## Open questions

1. Should "needs you" notifications (3) be on by default for background sessions only? 0.10.0 ships `notify`, off for every session.
2. Every session at a glance (20): one window for all sessions, or keep a window per session and add the overview as a key?
3. Recap (23): only on request, or every time a session ends?
4. Which of these go upstream to `alexeyw/lot-map`, whose pull requests go to `next`, and which stay in this fork? Upstream's `classify.ts` treats a task's subject as content and shows only the tool's name, so the plan checklist (9) likely stays here.
5. The full rename to workmap (31): when? Upstream's updates already come by hand (see [Upstream since the fork](#upstream-since-the-fork)).
