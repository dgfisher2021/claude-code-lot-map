# lot-map improvements: the map and the task list

Status: proposal, no code. Written 2026-11-16 against lot-map 0.9.0 (fork `main`). The items are in three waves, numbered in the order they would be built.

## Goal

Make lot-map the one place to glance at for any Claude Code session. Within two seconds it should answer:

1. **Is it working, stuck, or waiting on me?**
2. **What is it doing right now, and for how long?**
3. **How far through the plan is it?**
4. **What has it changed?**
5. **What is it costing:** context, rate limits, money?

Today it answers question 2 well. It answers questions 1, 4 and 5 only in part, through faults, worn spokes and the context ring. It doesn't answer question 3 at all.

## Principles to keep

- **Names, never content.** This is the README's existing rule. Anything that would show content (error text, prompts) is an option and off by default.
- **Local only.** No model calls, no network, and no change to any call, permission or context.
- **Glance first, detail on demand.** The default view stays calm, and detail comes from a key, a command or a hover.
- **One model, every surface.** The app, the docked pane, the cell map and the Sixel window all show the same state.

## Today, in brief

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

- **Wave 1, now (1–10):** `/workmap` command, core state, needs you, exit codes, blocked vs failed, subagent failures, legend, background pinned, plan checklist, window favours the map.
- **Wave 2, next (11–17):** session fault total, this turn's `+N`, rows by turn, files changed, stuck warnings, usage gauges, every session at a glance.
- **Wave 3, later (18–28):** error first line, more rows on demand, session recap, timeline, context cost per call, subagents apart, MCP station, time share, file satellites, accessibility, full rename to workmap.

## Wave 1: now

The biggest glance value for the least work. Every item uses data the mod already sees, and the small fixes come before the legend that explains them.

### 1. `/workmap` as a second command name (command · effort small)

- Register `/workmap` as a second command name. `/lot-map` keeps working.
- The plugin stays `lot-map`, and upstream updates keep merging.

Items below write `/workmap`; `/lot-map` works the same.

### 2. The core shows the session's state (map · value highest · effort small)

**What:** the core reads one word in a matching colour: thinking, running, waiting for you, compacting, idle or done. "Waiting for you" pulses amber.

**Why:** the single most useful glance signal. It pairs with 3.

**Data:** the same events as 3, plus `turn.step` and `session.compact`.

### 3. "Needs you" (list · value high · effort small)

**What:**

- The top line becomes a banner when Claude is waiting on you, with how long it has waited. That covers:
  - a permission prompt
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

## Wave 2: next

What changed and what it costs, and help for people running many sessions.

### 11. A session total of faults (list and map · effort small)

**What:** the red badge still clears on your next message. The count line keeps a session total beside it, for example `Shell 27 · 4✕`, so the history isn't lost.

### 12. This turn beside the totals (list and map · effort small)

**What:** a faint `+3` beside a station's session count shows what this turn added.

### 13. Rows grouped by turn (list · value medium · effort small)

**What:**

- A header for each of your messages, for example `Turn 4 · 1m 32s · 23 calls · 1 error`.
- The current turn stays open, and older turns collapse to their header.

**Why:** with 16 rows of one turn, you can't see what earlier turns did or cost.

**Data:** `turn.start` and `turn.complete`.

### 14. Files changed (list · value medium · effort small)

**What:**

- A "Changed" list: each file written, edited or deleted this session, with its edit count, by name only.
- Reads aren't listed.

**Why:** answers question 4 at the end of a session, before you look at the diff.

**Data:**

- Write, Edit and NotebookEdit
- shell commands already classed as file edits (`sed -i`, `mv`, `rm`)

### 15. Stuck and loop warnings (list · value high · effort medium)

**What:** an amber row and an amber station when:

- the same command fails 3 times in a row
- a call runs far past that station's usual time this session
- nothing has happened (no call, no model step) for a few minutes while the turn is still running

**Why:** catches a stuck session without reading the transcript.

**Data:** the existing rows, their timings and statuses.

### 16. Usage gauges (map · value high · effort small)

**What:**

- Beside the context ring, two thin arcs for the 5-hour and weekly rate-limit windows, plus the session's cost as `/cost` gives it.
- Amber and red thresholds, as the context ring has.
- On demand, the context broken down: system, tools, MCP, memory, messages.

**Data:** `$.session.usage()` (`rateLimits`, `cost`, `context` with `breakdown`), pushed by `session.measure`.

### 17. Every session at a glance (map · value high · effort medium)

**What:**

- One window shows every running session, background ones included, as tiles. Each tile has the session's name, its state (working, waiting for you, done, failed), its current action, context % and elapsed time.
- A number key opens one tile's full map.

**Why:** for anyone running several background sessions, one place answers "which needs me" without cycling through tabs.

**Data:**

- Each session already writes a live folder; it would add a small `status.json`.
- The viewer reads every `lot-map-live-*` folder. All local.

## Wave 3: later

Larger, or useful in fewer sessions. The full rename comes last, once upstream updates are no longer wanted.

### 18. Error first line (list · value medium · effort small)

**What:** an option, `errorReasons`, modelled on `hookReasons`. It shows the first line of a tool's error, up to 72 characters. Off by default, since an error can quote content.

### 19. More than 16 rows, on demand (list · value low to medium · effort medium)

**What:**

- In the window:
  - keys to scroll back
  - `e` for errors only
  - `1`–`9` for one station
  - `/` to search labels
- Anywhere: `/workmap log` answers with the session's full list.

### 20. Session recap (list · value medium · effort small)

**What:** at the end of a session, or on `/workmap recap`, a short recap:

- turns and wall time
- calls by station
- files changed
- errors
- cost, and the peak context

It's the answer of a command, so it doesn't enter the model's context.

### 21. Timeline strip (map · value high · effort medium)

**What:**

- A thin strip under the map with one tick per call, coloured by station.
- It also marks turn boundaries, idle gaps and waits for you.
- In the window, scrubbing the strip replays the map to that moment.

**Why:** shows where the time went, for example "most of it waiting on the test run".

### 22. Context cost per call (map · value medium · effort medium)

**What:** a pulse's width shows how much of the context its result took, and the largest calls are named. This is upstream issue #80, `contextCost`.

### 23. Subagents you can tell apart (map · value medium · effort medium)

**What:**

- Each subagent's dot carries its short label and its own clock.
- A key expands one subagent's route and calls.
- A failed subagent turns red.
- A workflow shows as a cluster with progress, for example `4/9`.

### 24. MCP station per server (map · value medium · effort medium)

Upstream issue #55: an MCP station with a small mark per server that lights when one of its tools is called.

### 25. Time share, not only counts (map · value low · effort small)

**What:** spokes thicken by number of calls today. Add a choice to thicken them by share of wall time, with the percentage beside each station on demand.

### 26. File satellites (map · value low · effort medium)

**What:** the most-touched files sit as small labelled dots around Files, with edited files marked.

### 27. Accessibility (map · value medium · effort small)

**What:**

- Shapes as well as colour for errors and waits.
- A high-contrast palette preset.
- Reduced motion, which upstream's `next` branch already has as the `motion` option (#40). This fork's `main` doesn't have it yet.

### 28. Rename to workmap and own the repo (repo · effort medium)

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

- Upstream fixes stop merging cleanly, since every renamed line conflicts. They come in by hand or by cherry-pick.
- You own the maintenance.
- Versions can carry on, for example `1.0.0` as the first workmap release.

**Recommendation:** do item 1 first. Do this one once you no longer want upstream's updates, as one pull request: the rename, the docs and a CHANGELOG entry.

## Data sources

| Need                            | Source                                     | Local only |
| ------------------------------- | ------------------------------------------ | ---------- |
| Calls, inputs, results, timings | `tool.call`                                | yes        |
| Turns                           | `turn.start`, `turn.step`, `turn.complete` | yes        |
| Waiting on permission           | `tool.check`                               | yes        |
| Plan                            | TaskCreate and TaskUpdate inputs           | yes        |
| Context, rate limits, cost      | `$.session.usage()`, `session.measure`     | yes        |
| Notifications                   | `ui.notify`                                | yes        |
| Every session                   | the live folders under `TMPDIR`            | yes        |

## Not in scope

- Reading file contents, or showing prompts or answers.
- Any network request, any model call.
- Changing calls, permissions or context.

## Open questions

1. Should "needs you" notifications (3) be on by default for background sessions only?
2. Every session at a glance (17): one window for all sessions, or keep a window per session and add the overview as a key?
3. Recap (20): only on request, or every time a session ends?
4. Which of these go upstream to `alexeyw/lot-map`, whose pull requests go to `next`, and which stay in this fork?
5. The full rename to workmap (28): when, and do you still want upstream's updates after it?
