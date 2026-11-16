# lot-map improvements: the map and the task list

Status: proposal, no code. Written 2026-11-16 against lot-map 0.9.0 (fork `main`).

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

## Task list: proposals

### T1. The plan as a checklist (high value, medium effort)

**What:**

- Pin Claude's own task list above the rows: `◻` pending, `◼` in progress, `✓` done.
- Show "3 of 7" and a thin progress bar, with the task in progress in bold.
- Tag each row with the task that was in progress when it ran.
- Collapse a finished task into one line, for example `✓ Fix dock sizing · 14 calls · 2m 10s`.

**Why:** answers question 3, which nothing answers today, and turns a stream of calls into progress against a plan.

**Data:** the TaskCreate and TaskUpdate calls (TodoWrite on older versions), from their inputs in `tool.call`. A task's subject is the model's own words, shown as shell descriptions already are.

### T2. Rows grouped by turn (medium, small)

**What:**

- A header for each of your messages, for example `Turn 4 · 1m 32s · 23 calls · 1 error`.
- The current turn stays open, and older turns collapse to their header.

**Why:** with 16 rows of one turn, you can't see what earlier turns did or cost.

**Data:** `turn.start` and `turn.complete`.

### T3. "Needs you" (high, small)

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

### T4. Stuck and loop warnings (high, medium)

**What:** an amber row and an amber station when:

- the same command fails 3 times in a row
- a call runs far past that station's usual time this session
- nothing has happened (no call, no model step) for a few minutes while the turn is still running

**Why:** catches a stuck session without reading the transcript.

**Data:** the existing rows, their timings and statuses.

### T5. Background work pinned (high, small)

**What:** running background shells, monitors, subagents and workflows each get a pinned line with elapsed time and status. Today they scroll out of the 16 rows while their station stays lit.

**Data:** already tracked by `taskOf` and `taskNotice` in `hooks/map.ts`.

### T6. Files changed (medium, small)

**What:**

- A "Changed" list: each file written, edited or deleted this session, with its edit count, by name only.
- Reads aren't listed.

**Why:** answers question 4 at the end of a session, before you look at the diff.

**Data:**

- Write, Edit and NotebookEdit
- shell commands already classed as file edits (`sed -i`, `mv`, `rm`)

### T7. Error first line (medium, small)

**What:** an option, `errorReasons`, modelled on `hookReasons`. It shows the first line of a tool's error, up to 72 characters. Off by default, since an error can quote content.

### T8. More than 16 rows, on demand (low to medium, medium)

**What:**

- In the window:
  - keys to scroll back
  - `e` for errors only
  - `1`–`9` for one station
  - `/` to search labels
- Anywhere: `/lot-map log` answers with the session's full list.

### T9. Session recap (medium, small)

**What:** at the end of a session, or on `/lot-map recap`, a short recap:

- turns and wall time
- calls by station
- files changed
- errors
- cost, and the peak context

It's the answer of a command, so it doesn't enter the model's context.

## Map: proposals

### V1. The core shows the session's state (highest value, small)

**What:** the core reads one word in a matching colour: thinking, running, waiting for you, compacting, idle or done. "Waiting for you" pulses amber.

**Why:** the single most useful glance signal. It pairs with T3.

**Data:** the same events as T3, plus `turn.step` and `session.compact`.

### V2. Usage gauges (high, small)

**What:**

- Beside the context ring, two thin arcs for the 5-hour and weekly rate-limit windows, plus the session's cost as `/cost` gives it.
- Amber and red thresholds, as the context ring has.
- On demand, the context broken down: system, tools, MCP, memory, messages.

**Data:** `$.session.usage()` (`rateLimits`, `cost`, `context` with `breakdown`), pushed by `session.measure`.

### V3. Context cost per call (medium, medium)

**What:** a pulse's width shows how much of the context its result took, and the largest calls are named. This is upstream issue #80, `contextCost`.

### V4. MCP station per server (medium, medium)

Upstream issue #55: an MCP station with a small mark per server that lights when one of its tools is called.

### V5. Timeline strip (high, medium)

**What:**

- A thin strip under the map with one tick per call, coloured by station.
- It also marks turn boundaries, idle gaps and waits for you.
- In the window, scrubbing the strip replays the map to that moment.

**Why:** shows where the time went, for example "most of it waiting on the test run".

### V6. Time share, not only counts (low, small)

**What:** spokes thicken by number of calls today. Add a choice to thicken them by share of wall time, with the percentage beside each station on demand.

### V7. Subagents you can tell apart (medium, medium)

**What:**

- Each subagent's dot carries its short label and its own clock.
- A key expands one subagent's route and calls.
- A failed subagent turns red.
- A workflow shows as a cluster with progress, for example `4/9`.

### V8. File satellites (low, medium)

**What:** the most-touched files sit as small labelled dots around Files, with edited files marked.

### V9. A window that favours the map (high, small)

**What:**

- In a short window the rows shrink to a 3–5 line ticker before the map shrinks.
- A key switches between map only, list only and both.
- An option, `windowRows`, sets how many rows to keep.

**Why:** in a 53x31 split today the map gets 12 rows and the list 18, so the picture the window exists for is small.

### V10. Every session at a glance (high, medium)

**What:**

- One window shows every running session, background ones included, as tiles. Each tile has the session's name, its state (working, waiting for you, done, failed), its current action, context % and elapsed time.
- A number key opens one tile's full map.

**Why:** for anyone running several background sessions, one place answers "which needs me" without cycling through tabs.

**Data:**

- Each session already writes a live folder; it would add a small `status.json`.
- The viewer reads every `lot-map-live-*` folder. All local.

### V11. Accessibility (medium, small)

**What:**

- Shapes as well as colour for errors and waits.
- A high-contrast palette preset.
- Reduced motion, which upstream's `next` branch already has as the `motion` option (#40). This fork's `main` doesn't have it yet.

## Order

| When  | Items                                                                                                                                             | Why first                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Now   | V1 core state, T3 needs you, T1 plan checklist, T5 background pinned, V9 window layout                                                            | The biggest glance value for the least work; all use data the mod already sees    |
| Next  | T2 turns, T6 files changed, V2 usage gauges, T4 stuck warnings, V10 every session                                                                 | Answer "what changed" and "what it costs", and serve people running many sessions |
| Later | V5 timeline, V3 (#80), V4 (#55), V7 subagents, T8 log and filters, T9 recap, T7 error lines, V6 time share, V8 file satellites, V11 accessibility | Larger, or useful in fewer sessions                                               |

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

1. Should "needs you" notifications (T3) be on by default for background sessions only?
2. Every session at a glance (V10): one window for all sessions, or keep a window per session and add the overview as a key?
3. Recap (T9): only on request, or every time a session ends?
4. Which of these go upstream to `alexeyw/lot-map`, whose pull requests go to `next`, and which stay in this fork?
