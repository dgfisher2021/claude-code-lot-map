# Privacy

workmap is a mod for Claude Code that draws a map of the work in a pane beside the chat. It runs inside Claude Code on your computer. There is no workmap service, no account and no server: nothing the mod sees leaves your machine through it.

This page describes version 1.1.1. It changes only together with the code, and the [changelog](CHANGELOG.md) says when it did.

## What the mod is handed

Claude Code passes a mod that follows tool calls the whole input of every call: command lines, file paths, web addresses, the text written to files, the prompts of subagents. It also passes the text that your settings hooks add to a session or a message. Any of that can hold personal data, such as a name in a path or an address in a file.

The mod does not look for personal data and has no use for it. It takes a name for the row it draws and drops the rest:

- a file: the last two parts of its path; the files Claude wrote or edited are kept by that name with a count, never by their content;
- a web address: the host alone, without a login, password, path or query;
- a local server: `localhost` and the port of a localhost address in a call, nothing else of it;
- a shell command: the short description Claude wrote for it, or the command's name, never the command line; a failed one also its exit code, never its output;
- a memory call: the tool's name and a record number or short identifier, never the text or the query;
- a subagent: the short description it was started with, cut to 24 characters, in its rows and in Agents' tooltip, never its prompt or output; the board also keeps its id, its parent's id and its agent type's name, no content;
- a task of Claude's plan: its subject as Claude wrote it, cut to 60 characters, never its description;
- those descriptions and subjects are written by the model, and the mod shows them as written: it does not check what they say;
- a background task's report: that it ended and whether it failed;
- a hook's refusal: the name of the tool it stopped, and its first line only if you turn `hookReasons` on;
- a failed call's error: that it failed, and for a shell command its exit code; its first line with text only if you turn `errorReasons` on, cleaned and cut to 72 characters, on its row in the pane and the window (whose feed file holds the rows), never in the `/workmap all` status file nor a notification;
- context a hook added: that it was added, and record numbers only if you turn `hookRecords` on.

## What it keeps

- **During a session:** the rows of the map, the counters of the stations and the last model step, in Claude Code's state for the session. With `contextCost` on, also a number of tokens on a row and a sum per station, and the labels of the three calls that added the most: how much the context grew, taken from the same figure as the ring's percentage. They are gone when the session ends.
- **Most used:** for the session, the last two parts of the path of each file you read or edit, the name of each MCP server you call, and for each a use count and the time of its last use, twelve per station, of which a station's tooltip lists five. Never file contents or tool arguments. Nothing goes to disk beyond the files described below.
- **Local servers:** for the session, the localhost addresses a call names, in a URL it was given or written in its command (`localhost`, `127.0.0.1`, `0.0.0.0` or `[::1]`, read as `localhost`): the port and nothing else of the call, six at most, each with the time it was last named. Browser shows them under its name and in its tooltip, and `feed.json` carries them for the map window.
- **Usage figures:** the context's fill and the categories of its window, the five-hour and weekly rate-limit windows with their reset times, and the session's estimated cost. The mod reads them and keeps the windows and the cost with the rows for the session, and the cost at the moment a plan limit was first seen reached, so that it can show what was billed since. The map's drawing carries the cost and the windows' figures and reset times, as the pane shows them, so `map.svg` in picture mode and for the map window holds them too; the overview's status file holds the context's fill. It sends none of them anywhere.
- **Between sessions:** one value per folder, the name of the model last used there, so that the map can show a change of model. It is stored under the folder's full path in Claude Code's own store for the plugin, on your computer. A folder's path usually contains your account name.
- **Your options** (language, colours, memory servers and the rest) are kept by Claude Code in your settings, as for any plugin.

To remove what it keeps, uninstall the plugin.

## What it does not do

- It makes no network requests and has no telemetry, analytics or crash reports. The map window's server, from WSL, listens on this computer's loopback alone and asks nothing of any other; the window's page asks only the local servers Claude used, on this computer (below).
- It reads no files but the status files of the overview. It runs no processes and writes no files, except in picture mode, for the map window (including one `git rev-parse` every half minute while it is wanted) and for those status files, below.
- It calls no model and adds nothing to the conversation.
- It raises no notification unless you turn `notify` on. Then it raises one when Claude asks you a question or puts a plan to you, saying only that it needs you and for what kind of thing ("question for you"), never the question; one when a permission prompt has waited on you for a second, with the call's label as its row shows it ("Needs you: permission for Shell: Run the tests"); and one when a turn ends.
- It changes no tool call, result, prompt or context. It sees what your settings hooks decide about a call, hands that decision on as it was, and decides nothing about permissions itself.

The code that takes names from a call is `classify` in [`hooks/classify.ts`](hooks/classify.ts); the hooks are in [`hooks/register.tsx`](hooks/register.tsx).

## Picture mode

In a terminal that shows pictures (kitty, Ghostty, or with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`), with `terminalPicture` on `auto`, the default, the map is painted by a browser. While the pane is open:

- The mod starts `node renderer/render.mjs` from its own folder, and that starts headless Chromium: the first of `chromium`, `chromium-browser`, `google-chrome` on your PATH that runs, or `WORKMAP_CHROMIUM`.
- The mod writes the map's drawing, the same SVG the app's pane shows (station names, counts and the labels described above), to `map.svg` in a temporary folder of its own, `workmap-*` in your temporary directory. The renderer writes each frame there as `frame.png`, which the terminal reads to show it.
- Chromium shows only that drawing, from a `data:` address with nothing outside it, with its background networking, component updates, sync and pings turned off. Its profile lives in the same folder.
- The renderer, Chromium and the folder go when the pane closes or the session ends. A folder left by a renderer that was killed is removed the next time one starts.

The mod reads six environment variables to tell whether the terminal shows pictures: `TERM`, `TERM_PROGRAM`, `LC_TERMINAL`, `KITTY_WINDOW_ID`, `TMUX` and `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`. With `terminalPicture` on `off`, or in any other terminal, none of this runs. In iTerm2, named by `TERM_PROGRAM` or `LC_TERMINAL`, the picture stays off, since iTerm2 keeps every frame it is sent in memory.

## The map window

Only when you type `/workmap window`, or in Windows Terminal from WSL (`WSL_DISTRO_NAME` set, and `WT_SESSION` or `WT_PROFILE_ID`) the first time you write in a session, unless `terminalWindow` is `off`:

- The mod keeps the session's live map, the same drawing as above, in `map.svg` in a folder of its own, `workmap-live-*` in your temporary directory (`TMPDIR`, else `/tmp`), readable by you alone, with the pane's rows (the action now and the last sixteen rows, the same labels) in `feed.json`, which also holds the board's kept calls (names only) for the window's scrolling, each subagent's id and name, the window's keys and their words, the local servers (host and port) and the repository's name, branch and worktree (below), and a heartbeat in `alive` every few seconds.
- It runs `sh -c 'command -v node'` and `sh -c 'command -v chromium || command -v google-chrome'` to find Node and Chromium.
- In WSL (`WSL_DISTRO_NAME` set), unless `terminalWindow` is `edge`, it runs `wt.exe -w 0 split-pane ... wsl.exe -d <distro> -- env WORKMAP_CHROMIUM=<chromium> node renderer/view.mjs <folder>`, which opens a pane in your current Windows Terminal tab; elsewhere it only answers with that last command for you to run. That window starts the server below unless one answers, and runs the renderer of picture mode on the server's page for the session (`http://127.0.0.1:47470/?live=<name>`), at its own size, writing Sixel to its own pane. From WSL the renderer gives Chromium your Windows fonts (Segoe UI, Cascadia, Consolas), through links to them in `C:\Windows\Fonts` from its own temporary folder, which goes when it ends. The window reads its pane's mouse and keys and hands them to that page alone, as a browser would; a click on a local server under Browser opens `http://localhost:<port>/` in your default browser (`cmd.exe /c start`), and no other address.
- When the split cannot open, or with `terminalWindow` set to `edge` first, it runs `node renderer/serve.mjs --open <name>`, the folder's name after `workmap-live-`. That starts the server unless one already answers, and runs `cmd.exe /c start "" msedge --user-data-dir=%LOCALAPPDATA%\workmap\edge --no-first-run --no-default-browser-check --app=http://localhost:47470/?live=<name> --window-size=600,960`. Edge keeps that profile folder, with the window's size and place and the share between map and list you drag, as it keeps any profile; nothing else is put in it.
- The server listens on `127.0.0.1` port 47470 (or `WORKMAP_PORT`), reachable from this computer only. It serves the page of `renderer/window`, and for a name of letters and digits the `map.svg` and `feed.json` of that `workmap-live-` folder, the folder's name from the session's status file (see [The overview of sessions](#the-overview-of-sessions)), and an event when either file changes. It reads nothing else and writes only `shown` in that folder, every two seconds while a page for it is open. It ends when no session's heartbeat has been fresh for a minute and no page is open.
- Either window takes keys to close on `q` and to move through its list: `m`, `?`, `a`, `e`, the digits, the arrows and a typed search, which stays in the window and is never written anywhere. While a window shows, the time goes to `shown` in that folder every two seconds, and the mod reads that file's age so as not to open a second window.
- While the window is wanted, every half minute, it runs `git -C <folder> rev-parse --path-format=absolute --git-common-dir --show-toplevel --abbrev-ref HEAD` in the session's folder, and puts in `feed.json` the repository's folder name, the branch and the worktree's folder name, for the window's title; nothing else of the answer is kept.
- The Edge window's page asks each of those local servers whether it answers, every five seconds while the window is in view: a request to `http://localhost:<port>/` on this computer, whose answer it does not read, to show under Browser only those that answer. It asks no other address.
- When the session ends the mod removes the folder (`rm -rf` of that folder alone); a window still open closes when the heartbeat stops. A folder whose heartbeat stopped more than ten minutes ago is removed the next time a renderer starts.

## Where the code comes from

Installed from this repository, the mod follows its `main` branch, so an update brings whatever is there. Read the diff before updating if that matters to you. Claude Code, the model and any catalogue you installed the mod from have their own terms, and this page does not speak for them.

## Questions

Open an issue: <https://github.com/dgfisher2021/workmap/issues>.

## The overview of sessions

Every session with a surface, a terminal or the app (not a `-p` or SDK run, which draws nowhere), keeps a status file so that `/workmap all` can show them side by side:

- The folder is your own: `workmap-sessions` in `XDG_RUNTIME_DIR` when that is set, else `.cache/workmap/sessions` in `HOME`, the only two variables it reads for this. With neither, as on Windows, no status is written and `/workmap all` has no session to show. Before the first write the mod runs `mkdir -p -m 700 -- <folder>`, so that a folder it makes is readable by you alone. One `<session id>.json` a session. Each holds the name of the session's folder (the last part of its path), the state word (idle, thinking, running, needs you, compacting, done), the top line's text (which holds only labels and times, as the rows do), the context's fill in percent, the time the session started and the time of the last write, whether any station has errors, and, when the session has a map window, the path of that window's folder.
- It is written when one of those changes and at least every five seconds.
- The session removes its file when it ends, but not at a `/clear` or a resume, after which the session goes on. When a session starts, files in that folder not written for an hour (sessions killed without an end) are removed; no other file is touched, by `rm -f` of each file alone.
- `/workmap all` reads the folder. In Windows Terminal from WSL (`WSL_DISTRO_NAME` set, and `WT_SESSION` or `WT_PROFILE_ID`) it runs `wt.exe -w 0 split-pane ... node renderer/view.mjs --all <folder>`, which reads the files younger than 15 seconds and, on a key, the rows in the chosen session's own map window folder; elsewhere it answers the tiles as text.
