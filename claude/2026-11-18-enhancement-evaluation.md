# workmap enhancements since the fork: are they worth it?

2026-11-18. Every addition from 0.9.0 to 1.0.0 that the review hasn't already settled, checked against what actually happens in Dustin's own sessions.

## Where the numbers come from

Dustin's Claude Code transcripts on this machine, last 30 days (`~/.claude/projects`, read locally, counts only): **120 working sessions, 412 subagent runs, 83,432 tool calls, 1,881 messages from him.** The script (`$CLAUDE_JOB_DIR/tmp/evidence.py`) keeps no text, commands or paths.

What's approximate:
- **Call times** run from the moment the call was written to its result, so they include input streaming. That's why some Edits show up as "long".
- **Sessions open at once** counts from a session's first record to its last, idle time included.
- **Window keys** (`m`, `e`, `/`, the digits) aren't recorded anywhere, so how often they're used can't be counted.
- **The `/workmap` commands added on Nov 16–17** have had only 1–2 days to be used.

## Summary

| # | Enhancement | Evidence (30 days) | Verdict |
|---|---|---|---|
| 1 | "Needs you" top line, incl. permission prompts | 143 waits: 26 questions/plans, 117 permission prompts | **KEEP** |
| 2 | `notify` (off by default) | 5 sessions/day, 283 h with 2+ sessions open | **Decide** |
| 3 | Background work pinned | 97 of 120 sessions run background work | **KEEP, shorten** |
| 4 | Plan checklist | 57 of 120 sessions keep a task list | **KEEP, shorten** |
| 5 | Rows grouped by turn | 9 calls per message typical, 73 at p90 | **SIMPLIFY** |
| 6 | ✎ files-changed line, `/workmap changed` | 109 of 120 sessions edit; median 38 files | **KEEP** |
| 7 | Stuck warnings: loop, running long, quiet | Loop: **0**. Running long: ~1,740 (~58/day) | **CUT two, decide one** |
| 8 | Exit codes on failed rows | 2,489 failed shell calls | **KEEP** |
| 9 | `errorReasons` (off) | 2,794 failed calls; never turned on | **Decide** |
| 10 | Subagent red "failed" dot | 299 of 412 subagents go red; 1 of 456 really failed | **SIMPLIFY** |
| 11 | `↳ name` on subagent rows | 456 subagents in 69 of 120 sessions | **KEEP** |
| 12 | Subagent name labels + clock arcs | 2+ launched at once 70 times, max 8 | **SIMPLIFY** |
| 13 | Workflow `4/9` clusters | **0** Workflow calls | **CUT** |
| 14 | `/workmap log` + scroll, filters, search | 38% of turns overflow the 16-row list | **KEEP** |
| 15 | `/workmap recap` | 0 uses; repeats the tooltips | **CUT** |
| 16 | `/workmap usage` | 0 uses; text twin of the ring tooltips | **KEEP** (cheap) |
| 17 | Cost `$` under the core | Subscription account: the `$` isn't billed | **SIMPLIFY** |
| 18 | `/workmap all` overview | Peak 7 sessions open; 0 uses; heaviest feature | **Decide** |
| 19 | `guardedHooks` | His only option set; 42 hook refusals | **KEEP** |
| 20 | Upstream shell-reading port | 14% of shell commands use what it reads | **KEEP** |
| 21 | `serverStations` | Never set; MCP is 0.15% of calls | **CUT** |
| 22 | `motion: reduced`, `contrast` theme | Never set by him | **Decide** |
| 23 | Dashed "needs you" ring in the core | Replaced by the User badge redesign | **CUT** (with redesign) |
| 24 | Window map-first sizing + `m` | Can't count key use; tiny code | **KEEP** |

## The space problem under the map

The window gives the list **10 lines** by default (`windowRows`). Before any call row shows, these can claim lines:

| Item | Lines |
|---|---|
| Top line | 1 |
| Stuck warnings | up to 3 |
| Plan checklist | up to 6 |
| Files-changed line | 1 |
| Pinned background work | up to 5 |
| Earlier turn headers | up to 4 |

That's up to 20 lines for 10. Plans show in half the sessions and background work in four out of five, so most of the time the actual calls get 2–3 lines; the preview showed exactly that. Items 3, 4, 5 and 7 below are about giving those lines back.

## Each item

### 1. "Needs you" top line, including permission prompts — KEEP
- **What:** when Claude waits on you (a question, a plan to approve, a permission prompt), the top line says so and counts the wait.
- **Evidence:** 25 questions and 1 plan in 19 of 120 sessions, plus 117 permission prompts (35 approved, 82 refused). About 5 a day, often in a session you aren't looking at.
- **Cost:** 1 line, which replaces the normal top line. About 70 lines of code.
- **Why:** a session silently waiting on you is the most expensive thing to miss.

### 2. `notify` — DECIDE
- **What:** a desktop notification when Claude needs you or a turn ends. Off by default.
- **Evidence:** a median of 5 sessions per working day (up to 13), 7 open at once at peak, and 283 hours in 30 days with 2+ sessions open. A notification is the only signal that reaches you in another window.
- **Cost:** no screen space. About 15 lines.

### 3. Background work pinned — KEEP, shorten to one line
- **What:** a background command, monitor or agent stays listed under the top line with its time so far.
- **Evidence:** 97 of 120 sessions ran background work (1,393 background commands and monitors).
- **Cost:** up to 5 lines. About 30 lines of code.
- **Why shorten:** one line like `↻ 2 running: dev server 52 s, tests 12 s` says the same in a fifth of the room.

### 4. Plan checklist — KEEP, shorten to two lines
- **What:** Claude's task list as a checklist: progress, the last two done, the current one, the next two.
- **Evidence:** 57 of 120 sessions keep a task list (1,357 task calls). TodoWrite was never used, only TaskCreate/TaskUpdate.
- **Cost:** up to 6 lines. About 75 lines of code.
- **Why shorten:** progress plus the current task (`Plan 3/7 ███░ · ◐ Label the limit arcs`) is what you glance at.

### 5. Rows grouped by turn — SIMPLIFY
- **What:** a bold header per message of yours (`Turn 3 · 12 s · 7 calls · 1 error`), plus up to four dim headers for earlier turns.
- **Evidence:** a turn typically has 9 calls (73 at p90, 466 at most), so the current turn alone usually fills the list.
- **Cost:** up to 5 lines. About 40 lines of code.
- **Why:** keep the current turn's header and drop the four earlier ones. They push out live rows to show history the log already has.

### 6. ✎ files-changed line and `/workmap changed` — KEEP
- **What:** one line naming the files Claude edited, most edited first.
- **Evidence:** 109 of 120 sessions edit files; a median of 38 files per session (p90 80, max 210).
- **Cost:** 1 line. About 35 lines of code.
- **Why:** almost always relevant, and it fits in one line.

### 7. Stuck warnings — CUT loop and running-long; DECIDE quiet
- **What:** amber lines plus a dashed ring for three cases: the same command failing 3 times in a row, a call past 60 s and 5× its usual time, and 3 minutes with nothing happening.
- **Loop:** **0 times in 30 days.** Claude never ran the exact same failing command three times running.
- **Running long:** about 1,740 times, roughly 58 a day. Of the 1,909 calls over a minute, 1,098 ran 1–2 minutes: ordinary test runs and builds. The clock hands on the station already show how long a call has run.
- **Quiet 3 minutes:** can't be measured from transcripts.
- **Cost:** up to 3 lines and a ring. About 50 lines of code.

### 8. Exit codes on failed rows — KEEP
- **What:** a failed shell row says `exit 1`.
- **Evidence:** 2,489 failed shell calls, 737 with a stated exit code.
- **Cost:** a few characters on rows that are already there. Under 10 lines of code.

### 9. `errorReasons` — DECIDE
- **What:** a failed row adds the first line of its error (`— cannot open file`). Off by default.
- **Evidence:** 2,794 failed calls in 30 days; never turned on. Most failures say only "failed" or an exit code today.
- **Cost:** no extra lines. About 15 lines of code.

### 10. Subagent red "failed" dot — SIMPLIFY
- **What:** a subagent's dot turns red when **any** of its calls fails.
- **Evidence:** 299 of 412 subagents (73%) had at least one failed call, usually a search that found nothing. But only **1** of 456 subagent launches actually failed. The red dot cries wolf.
- **Fix:** red only when the subagent itself fails. Its inner failures still count at their stations.

### 11. `↳ name` on subagent rows — KEEP
- **What:** a subagent's calls carry its short name.
- **Evidence:** 456 subagents in 69 of 120 sessions, up to 49 in one session.
- **Cost:** nothing extra.

### 12. Subagent name labels with clock arcs — SIMPLIFY
- **What:** beside Agents, a label per running subagent (up to 6) with a one-minute clock arc.
- **Evidence:** subagents launched 2+ at once 70 times (8 at most), so telling them apart matters. But labels on the map are the same kind of clutter as the satellites we just removed.
- **Fix:** keep the dots; put names and running times in the Agents tooltip. About 90 lines of code go.

### 13. Workflow `4/9` clusters — CUT
- **Evidence:** **0** Workflow calls in 30 days.
- **Cost:** part of the 90 lines above.

### 14. `/workmap log` and the window's scroll, filters and search — KEEP
- **What:** scroll back through every kept call; filter to errors, one station or one subagent; search.
- **Evidence:** 606 of 1,611 turns (38%) have more calls than the 16-row list shows, and 140 (9%) more than the 80 the log keeps.
- **Cost:** no screen space. About 125 lines of code.

### 15. `/workmap recap` — CUT
- **What:** the session in a few lines: turns, time by station, files, errors, cost.
- **Evidence:** 0 uses. Everything in it is now in the station tooltips, the files-changed line and `/workmap usage`.
- **Cost:** about 25 lines.

### 16. `/workmap usage` — KEEP
- **What:** context, limits and cost as text.
- **Evidence:** 0 uses so far, but it's the only way to read the rings without hovering. About 25 lines.

### 17. Cost estimate under the core — SIMPLIFY
- **What:** `$4.20` under the centre.
- **Evidence:** this is a subscription account (5-hour and weekly limits), so the dollar figure is an estimate of what the tokens would cost on the API, not money spent. The limit rings are what bind.
- **Fix:** move it into the rings' tooltip and `/workmap usage`.

### 18. `/workmap all` overview — DECIDE
- **What:** a tile per open session, the ones needing you first.
- **Evidence:** the need is real: peak 7 sessions open, 283 hours with 2+. But 0 uses since it shipped, and it's the heaviest addition: about 240 lines plus a status file per session.
- **Overlap:** item 2 (`notify`) answers the same need ("which session needs me?") with almost no code.

### 19. `guardedHooks` — KEEP
- **What:** stops the mod adding hooks an organisation's guard skips, which otherwise drop a notice in the transcript every time.
- **Evidence:** the only option Dustin has set (`false`); 42 hook refusals in 30 days.
- **Cost:** about 40 lines of code.

### 20. Upstream shell-reading port — KEEP
- **What:** commands inside loops, `bash -c`, here-documents, `sudo`/`env`/`timeout` and `docker exec` land on the right station.
- **Evidence:** 7,643 of 54,596 shell commands (14%) use one of these: loops 3,055, here-documents 2,607, wrappers 2,097, `bash -c`/`eval` 348, `docker` 13.
- **Cost:** no screen space. About 225 lines in `classify.ts`, part pre-existing.

### 21. `serverStations` — CUT
- **What:** an option to put an MCP server's calls on a station of your choice.
- **Evidence:** never set; 123 MCP calls in 30 days (0.15%) across 8 servers.
- **Cost:** about 10 lines. Harmless, but unproven.

### 22. `motion: reduced` and the `contrast` theme — DECIDE
- **What:** accessibility: nothing moves by itself; a high-contrast palette.
- **Evidence:** never set by Dustin. They matter only if workmap is shared with people who need them.
- **Cost:** reduced motion touches 54 lines across 4 files; contrast is about 15.

### 23. Dashed "needs you" ring inside the core — CUT with the redesign
The User station's badge, from the redesign under way, says the same thing where you'd look for it.

### 24. Window map-first sizing and `m` — KEEP
How often `m` is used can't be counted, but it's tiny code, and the Edge window keeps it.
