# Privacy

lot-map is a mod for Claude Code that draws a map of the work in a pane beside the chat. It runs inside Claude Code on your computer. There is no lot-map service, no account and no server: nothing the mod sees leaves your machine through it.

This page describes version 0.7.0. It changes only together with the code, and the [changelog](CHANGELOG.md) says when it did.

## What the mod is handed

Claude Code passes a mod that follows tool calls the whole input of every call: command lines, file paths, web addresses, the text written to files, the prompts of subagents. It also passes the text that your settings hooks add to a session or a message. Any of that can hold personal data, such as a name in a path or an address in a file.

The mod does not look for personal data and has no use for it. It takes a name for the row it draws and drops the rest:

- a file: the last two parts of its path;
- a web address: the host alone, without a login, password, path or query;
- a shell command: the short description Claude wrote for it, or the command's name, never the command line;
- a memory call: the tool's name and a record number or short identifier, never the text or the query;
- a subagent: the short description it was started with;
- those two descriptions are written by the model, and the mod shows them as written, up to 120 characters: it does not check what they say;
- a background task's report: that it ended and whether it failed;
- a hook's refusal: the name of the tool it stopped, and its first line only if you turn `hookReasons` on;
- context a hook added: that it was added, and record numbers only if you turn `hookRecords` on.

## What it keeps

- **During a session:** the rows of the map, the counters under the stations and the last model step, in Claude Code's state for the session. They are gone when the session ends.
- **Between sessions:** one value per folder, the name of the model last used there, so that the map can show a change of model. It is stored under the folder's full path in Claude Code's own store for the plugin, on your computer. A folder's path usually contains your account name.
- **Your options** (language, colours, memory servers and the rest) are kept by Claude Code in your settings, as for any plugin.

To remove what it keeps, uninstall the plugin.

## What it does not do

- It makes no network requests and has no telemetry, analytics or crash reports.
- It reads no files. It runs no processes and writes no files, except in picture mode, below.
- It calls no model and adds nothing to the conversation.
- It changes no tool call, result, prompt or context. It sees what your settings hooks decide about a call, hands that decision on as it was, and decides nothing about permissions itself.

The code that takes names from a call is `classify` in [`hooks/map.ts`](hooks/map.ts); the hooks are in [`hooks/register.tsx`](hooks/register.tsx).

## Picture mode

In a terminal that shows pictures (kitty, Ghostty, iTerm2 3.5 and later, or with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`), with `terminalPicture` on `auto`, the default, the map is painted by a browser. While the pane is open:

- The mod starts `node renderer/render.mjs` from its own folder, and that starts headless Chromium: the first of `chromium`, `chromium-browser`, `google-chrome` on your PATH that runs, or `LOT_MAP_CHROMIUM`.
- The mod writes the map's drawing, the same SVG the app's pane shows (station names, counts and the labels described above), to `map.svg` in a temporary folder of its own, `lot-map-*` in your temporary directory. The renderer writes each frame there as `frame.png`, which the terminal reads to show it.
- Chromium shows only that drawing, from a `data:` address with nothing outside it, with its background networking, component updates, sync and pings turned off. Its profile lives in the same folder.
- The renderer, Chromium and the folder go when the pane closes or the session ends. A folder left by a renderer that was killed is removed the next time one starts.

The mod reads five environment variables to tell whether the terminal shows pictures: `TERM`, `TERM_PROGRAM`, `KITTY_WINDOW_ID`, `TMUX` and `CLAUDE_CODE_FORCE_TERMINAL_IMAGES`. With `terminalPicture` on `off`, or in any other terminal, none of this runs.

## Where the code comes from

Installed from this repository, the mod follows its `main` branch, so an update brings whatever is there. Read the diff before updating if that matters to you. Claude Code, the model and any catalogue you installed the mod from have their own terms, and this page does not speak for them.

## Questions

Open an issue: <https://github.com/alexeyw/lot-map/issues>.
