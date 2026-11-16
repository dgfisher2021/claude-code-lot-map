# Changelog

What changed in each version of lot-map, newest first. To get a new version, see [Updating](README.md#updating).

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
