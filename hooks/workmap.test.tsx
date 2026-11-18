import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'
import type { Entry, TurnSummary } from '../types'
import {
  COLOR_NAMES,
  TRAIL_FADE_MS,
  TRAIL_HOLD_MS,
  classify,
  clean,
  drawMap,
  firstLine,
  foldRows,
  formatMs,
  keepNewest,
  memoryIds,
  setupFrom,
  taskNotice,
  taskOf,
} from './map'
import { mapSize, paceOf, paintMap } from './raster'
import { stringsFor } from './text'
import { tileText, tilesFrom } from './overview'

const PANE = {
  plugin: 'workmap',
  component: 'Pane',
  requestId: 'workmap',
  props: { title: 'Map', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Someone's own setup as it stands in settings: Russian labels and a memory of their own.
const OWN = {
  language: 'ru',
  coreName: 'ДОМ',
  memoryServers: ['recall'],
  memoryCommands: ['recall', 'check_recall'],
  memorySubcommands: ['add', 'memory'],
  memoryPaths: ['/.recall/'],
  memoryLabels: ['search=поиск', 'get_note=чтение записи'],
  hookRecords: true,
} as const
const SETUP = setupFrom(OWN)
const STRANGER = setupFrom({ language: 'en', coreName: 'CLAUDE', memoryServers: ['memory'], hookRecords: false })

test('every kind of call lands on its station', () => {
  const at = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).station
  expect(at('Bash', { command: 'recall memory journal --last 30' })).toBe('memory')
  expect(at('Bash', { command: 'python3 ~/.claude/scripts/recall-sync.py --apply' })).toBe('memory')
  expect(at('Bash', { command: 'python3 scripts/check_recall.py' })).toBe('memory')
  expect(at('Bash', { command: 'D=/tmp; cat $D/a | grep x; echo done' })).toBe('files')
  expect(at('Bash', { command: 'cat ~/.claude/projects/-Users-a/memory/x.md' })).toBe('memory')
  expect(at('Bash', { command: 'cat ~/.recall/x.md' })).toBe('memory')
  expect(at('Bash', { command: 'git push origin main' })).toBe('web')
  expect(at('Bash', { command: 'gh pr list' })).toBe('web')
  expect(at('Bash', { command: 'git status' })).toBe('shell')
  expect(at('Bash', { command: 'python3 _src/build.py' })).toBe('shell')
  expect(at('Read', { file_path: '/a/b/c/content.py' })).toBe('files')
  expect(at('Grep', { pattern: 'x' })).toBe('files')
  expect(at('Glob', { pattern: 'x' })).toBe('files')
  expect(at('Edit', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory')
  expect(at('mcp__recall__search', { query: 'x' })).toBe('memory')
  expect(at('mcp__Claude_Browser__navigate', { url: 'https://a.b/c' })).toBe('browser')
  expect(at('WebFetch', { url: 'https://a.b/c' })).toBe('web')
  expect(at('Agent', { description: 'x' })).toBe('agents')
  expect(at('Skill', { skill: 'pdf' })).toBe('skills')
  expect(at('AskUserQuestion', {})).toBe('you')
})

test('a command behind a wrapper is read as the command it runs', () => {
  const at = (command: string) => classify('Bash', { command }, STRANGER).station
  for (const command of [
    'sudo curl https://x.y',
    'sudo -u deploy curl https://x.y',
    'cat urls | xargs curl',
    'cat urls | xargs -n 1 -P 4 curl -s',
    'env A=1 curl x',
    'timeout 5 curl x',
    'timeout -s KILL 5 curl x',
    'time curl x',
    'nohup wget x',
    'sudo env A=1 nice -n 5 curl x',
    'git -C dir push',
    'git -c http.proxy=p --git-dir=.git fetch',
    'python -m pip install x',
    'python3.12 -m pip install x',
    'uv pip install x',
    'uv add x',
    'pipx install x',
    'poetry install',
    'npx -y create-foo',
    'pnpm dlx foo',
    'docker compose pull',
    'docker --context prod compose -f a.yml pull',
    'go get x',
    'go mod download',
    'apt-get install x',
    'sudo apt install x',
    'find . -exec curl {} ;',
    'find . -name "*.url" -exec sudo curl {} +',
  ])
    expect(`${at(command)} ${command}`).toBe(`web ${command}`)

  for (const command of [
    'sudo cat /etc/hosts',
    'find . -name "*.tmp" -exec rm {} ;',
    'find . -type f | xargs grep x',
    'rm -rf build',
    'rmdir build',
    'env A=1 ls',
  ])
    expect(`${at(command)} ${command}`).toBe(`files ${command}`)

  for (const command of [
    'find . -exec make {} ;',
    'sudo make install',
    'command -v curl',
    'npx tsc',
    'git -C dir status',
    'python -m http.server',
    'docker compose up',
    'go build ./...',
    'xargs',
    'timeout 5',
  ])
    expect(`${at(command)} ${command}`).toBe(`shell ${command}`)

  // The label is still the first word of the line, never one found further in.
  expect(classify('Bash', { command: 'sudo --preserve-env=HOME -u bob curl x' }, STRANGER).label).toBe('sudo')
  // A memory command behind a wrapper is the memory command.
  expect(classify('Bash', { command: 'timeout 30 recall memory journal' }, SETUP)).toEqual({ station: 'memory', label: 'memory' })
})

test('an MCP name with doubled underscores reads with single spaces', () => {
  expect(classify('mcp__my__server__tool', {}, STRANGER).label).toBe('my: server tool')
})

test('out of the box, memory is only what every install has', () => {
  const at = (tool: string, input: Record<string, unknown>) => classify(tool, input, STRANGER).station
  expect(at('Read', { file_path: '/Users/a/.claude/projects/p/memory/n.md' })).toBe('memory')
  expect(at('Read', { file_path: '/Users/a/.recall/n.md' })).toBe('files')
  expect(at('mcp__memory__search_nodes', {})).toBe('memory')
  expect(at('mcp__recall__search', {})).toBe('skills')
  expect(at('Bash', { command: 'recall memory journal' })).toBe('shell')
  expect(classify('mcp__memory__search_nodes', {}, STRANGER).label).toBe('search nodes')
})

test('labels never carry what was written or searched', () => {
  const label = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).label
  expect(label('Read', { file_path: '/a/b/c/content.py' })).toBe('c/content.py')
  expect(label('Bash', { command: 'recall add "private text" --category journal' })).toBe('add')
  expect(label('Bash', { command: 'recall memory journal --last 30' })).toBe('memory')
  expect(label('Bash', { command: 'recall add private words here' })).toBe('add')
  expect(label('Bash', { command: 'recall private words here' })).toBe('recall')
  expect(label('Bash', { command: 'recall "private text"' })).toBe('recall')
  expect(label('mcp__recall__search', { query: 'private' })).toBe('поиск')
  expect(label('mcp__recall__get_note', { id: 7 })).toBe('чтение записи #7')
  expect(label('WebFetch', { url: 'https://a.b/secret?x=1' })).toBe('a.b')
  expect(label('WebFetch', { url: 'https://user:private@a.b/x' })).toBe('a.b')
  expect(label('WebFetch', { url: 'a.b/reset?token=private' })).toBe('a.b')
  expect(label('WebFetch', { url: 'file:///Users/a/private.txt' })).toBe('file')
  expect(label('mcp__Claude_Browser__navigate', { url: 'https://user:private@a.b/x' })).toBe('a.b')
  expect(label('Grep', { pattern: 'private' })).toBe('Grep')
  expect(label('WebSearch', { query: 'private' })).toBe('поиск в сети')
})

test('a password never reaches a label, even with a slash, a question mark or a hash in it', () => {
  const label = (url: string) => classify('WebFetch', { url }, SETUP).label
  expect(label('https://user:pa/ss@host.com/x')).toBe('host.com')
  expect(label('https://user:pa?ss@host.com')).toBe('host.com')
  expect(label('https://user:p#w@host.com')).toBe('host.com')
  expect(label('https://u:p%40ss@h.com')).toBe('h.com')
  expect(label('postgres://admin:hunter2@db.internal:5432/prod')).toBe('db.internal:5432')
  // A number after the colon may be a port or a password: neither reading is shown.
  expect(label('https://user:12345/x@host.com')).toBe('https')
  expect(label('https://host.com:8080/x?mail=a@b.com')).toBe('https')
  expect(label('https://host.com/x?mail=a@b.com')).toBe('host.com')
  expect(label('https://[::1]:8080/x')).toBe('[::1]:8080')
  expect(label('https://[::1]/x?tok=@secret')).toBe('[::1]')
  expect(label('https://[::1]/x?mail=a@b.com')).toBe('[::1]')
  expect(label('https://[::1]:8080/x?mail=a@b.com')).toBe('[::1]:8080')
  expect(label('https://[u:pa/ss@host.com/x')).toBe('https')
  expect(label('https://пример.рф/x')).toBe('пример.рф')
  expect(label('https://bad host/x')).toBe('https')
})

test('a Windows path is read like any other: the last two parts, memory folders, command names', () => {
  const label = (tool: string, input: Record<string, unknown>) => classify(tool, input, SETUP).label
  const at = (tool: string, input: Record<string, unknown>, setup = SETUP) => classify(tool, input, setup).station
  expect(label('Read', { file_path: 'C:\\Users\\a\\private\\c\\content.py' })).toBe('c/content.py')
  expect(label('Edit', { file_path: 'C:\\Users\\a\\b/mixed\\n.md' })).toBe('mixed/n.md')
  expect(at('Read', { file_path: 'C:\\Users\\a\\.claude\\projects\\C--Users-a-p\\memory\\n.md' }, STRANGER)).toBe('memory')
  expect(at('Read', { file_path: 'C:\\Users\\a\\.recall\\n.md' })).toBe('memory')
  expect(at('Read', { file_path: 'C:\\Users\\a\\recall\\n.md' })).toBe('files')
  expect(at('Bash', { command: 'C:\\tools\\curl.exe -s https://a.b/list' })).toBe('web')
  expect(at('Bash', { command: 'C:\\Git\\cmd\\git.exe push origin main' })).toBe('web')
  expect(at('Bash', { command: 'C:\\tools\\grep.exe x C:\\Users\\a\\.recall\\n.md' })).toBe('memory')
  expect(label('Bash', { command: 'C:\\Users\\a\\private\\python.exe build.py' })).toBe('python')
  expect(label('Bash', { command: 'C:\\Users\\a\\private\\recall.exe add private words' })).toBe('add')
})

test('a memory command shows a word after it only when that word is a listed subcommand', () => {
  const label = (command: string) => classify('Bash', { command }, SETUP).label
  expect(label('recall add private words')).toBe('add')
  expect(label('recall hello world')).toBe('recall')
  expect(label('recall search private')).toBe('recall')
  expect(classify('mcp__recall__get_note', { id: 'note-7' }, SETUP).label).toBe('чтение записи #note-7')
  expect(classify('mcp__recall__get_note', { id: 'private words under id' }, SETUP).label).toBe('чтение записи')
})

test('a memory command is matched by its whole name, not by how any name starts', () => {
  const short = setupFrom({ memoryCommands: ['m', 'recall'] })
  const at = (command: string) => classify('Bash', { command }, short).station
  expect(at('mv a b')).toBe('files')
  expect(at('mkdir x')).toBe('files')
  expect(at('make all')).toBe('shell')
  expect(at('recallable --now')).toBe('shell')
  expect(at('m note')).toBe('memory')
  expect(at('recall-sync.py --apply')).toBe('memory')
  expect(at('python3 scripts/recall_check.py')).toBe('memory')
})

test('commands that reach the network light Network, also from inside another command', () => {
  const at = (command: string) => classify('Bash', { command }, SETUP).station
  expect(at('rsync -a a/ host:b/')).toBe('web')
  expect(at('nc -z host 80')).toBe('web')
  expect(at('npm install')).toBe('web')
  expect(at('npm test')).toBe('shell')
  expect(at('docker pull image')).toBe('web')
  expect(at('docker ps')).toBe('shell')
  expect(at('cat $(curl -s https://a.b/list)')).toBe('web')
  expect(at('cat `curl -s https://a.b/list`')).toBe('web')
  expect(at('cat "$(dirname x)/a"')).toBe('files')
})

test('a label loses what a terminal would act on', () => {
  expect(clean('a\u001b[31mred\u0007 b')).toBe('a [31mred b')
  expect(clean('line\nnext\ttab')).toBe('line next tab')
  expect(clean('x\u202egnp.exe')).toBe('x gnp.exe')
  expect(clean('я'.repeat(200)).length).toBe(120)
})

test('hook helpers', () => {
  expect(memoryIds('• [#1971 excerpt] and [now #45] and [todo #3] and [#1971 again]')).toEqual(['1971', '45', '3'])
  expect(firstLine('\nBlocked by x: rule.\nCommand: secret')).toBe('Blocked by x: rule.')
  expect(formatMs(1500, stringsFor('en'))).toBe('1.5 s')
  expect(formatMs(1500, stringsFor('ru'))).toBe('1.5 с')
  expect(formatMs(1500, stringsFor('de'))).toBe('1,5 s')
  expect(stringsFor('en').records(1, '#7')).toBe('1 record: #7')
  expect(stringsFor('en').stations.web).toBe('Network')
})

const LANGUAGES = ['en', 'ru', 'es', 'fr', 'de', 'it', 'pt'] as const

test('every language has every word, in a table of its own', () => {
  const en = stringsFor('en')
  for (const language of LANGUAGES) {
    const t = stringsFor(language)
    expect(Object.keys(t).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(t.stations).sort()).toEqual(Object.keys(en.stations).sort())
    expect(Object.values(t.stations).every(name => name !== '')).toBe(true)
  }
  expect(new Set(LANGUAGES.map(language => stringsFor(language).title)).size).toBe(LANGUAGES.length)
  expect(stringsFor('constructor').title).toBe(en.title)
})

test('options that make no sense count as not set', () => {
  const odd = setupFrom({ language: 'xx', coreName: '   ', memoryServers: 7, memoryLabels: ['no-equals', '=x', 'y='], hookRecords: 'yes' })
  expect(odd.t.idle).toBe(stringsFor('en').idle)
  expect(odd.core).toBe('CLAUDE')
  expect(odd.memoryServers.size).toBe(0)
  expect(odd.memoryLabels.size).toBe(0)
  expect(odd.hookRecords).toBe(false)
})

test('the drawing stays within what Svg accepts at its fullest', () => {
  const now = 1_000_000
  const stations = ['you', 'model', 'memory', 'files', 'shell', 'web', 'browser', 'agents', 'skills', 'hooks'] as const
  const board: Board = {
    model: 'claude-opus-5-5',
    step: 12,
    counts: { files: 12345 },
    entries: Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      station: stations[i % stations.length] as (typeof stations)[number],
      label: 'x'.repeat(70),
      from: 'core' as const,
      startedAt: now - 100 - i,
      status: 'run' as const,
    })),
  }
  const svg = drawMap(board, now, SETUP)
  expect(svg.length).toBeLessThan(131072)
  expect(svg).toContain('<animateMotion')
  expect(svg).toContain('OPUS 5.5')
  expect(svg).not.toContain('xxxxx')
  expect(svg).not.toContain('NaN')
  // Attributes are well formed: none empty, none run into the next.
  expect(svg).not.toContain('=""')
  expect(/"[a-z-]+="/.test(svg)).toBe(false)
  expect(svg).toContain('font-family="SF Mono, ui-monospace, Menlo, monospace"')
  expect(svg).not.toContain('Infinity')
})

test('with no options set the map speaks English and shows no record numbers', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => ({ result: {} }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#12 excerpt] text of a note'] }))

  await $.classic.UserPromptSubmit({ prompt: 'hi', permission_mode: 'default' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  await $.tool.call({ tool: 'Bash', command: 'recall add note', description: 'Save a note' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /[а-яё]/i })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /added context to the message/ }))?.text).toContain('Hooks')
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Files')
    expect((await ui.find({ type: 'Text', text: /Save a note/ }))?.text).toContain('Shell')
    expect(await ui.find({ type: 'Text', text: /#12/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a call shows on the pane, on every surface', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'workmap' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Файлы')
    await ui.unmount()
  }
})

test('a call a settings hook refused reads as blocked, with the hook lit and its words kept back', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: found key sk-private\nCommand: secret' }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /остановил Bash/ }))?.text).toContain('Хуки')
  expect((await ui.find({ type: 'Text', text: /Показать статус/ }))?.text).toMatch(/^⊘ /)
  expect(await ui.find({ type: 'Text', text: /JUDGE|sk-private|secret/ })).toBeUndefined()
  await ui.unmount()
})

test('with hookReasons on, the first line of a refusal shows and the rest does not', { options: { ...OWN, hookReasons: true } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: нельзя\nCommand: secret' }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /JUDGE/ }))?.text).toContain('Хуки')
  expect(await ui.find({ type: 'Text', text: /secret/ })).toBeUndefined()
  await ui.unmount()
})

test('an error of the tool itself is no refusal: the hooks station stays dark', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => ({ result: {}, isError: true, text: 'Exit code 1\nls: /nowhere: No such file or directory' }))

  await $.tool.call({ tool: 'Bash', command: 'ls /nowhere', description: 'Показать папку' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /остановил Bash/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /Показать папку/ }))?.text).toContain('✕')
  await ui.unmount()
})

const failing = (text: string) => ({ result: {}, isError: true as const, text })

test('with errorReasons off a failed call shows no reason', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('tool.call', () => failing('Exit code 2\nls: /nowhere: No such file or directory'))

  await $.tool.call({ tool: 'Bash', command: 'ls /nowhere', description: 'Показать папку' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = (await ui.find({ type: 'Text', text: /Показать папку/ }))?.text ?? ''
  expect(row).toContain('✕')
  expect(row).not.toContain('—')
  expect(await ui.find({ type: 'Text', text: /nowhere/ })).toBeUndefined()
  await ui.unmount()
})

test(
  'with errorReasons on a failed call shows its first line, cleaned and cut to 72',
  { options: { ...OWN, errorReasons: true, notify: true } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, { ...RUNTIME, TMPDIR: '/tmp' })
    fakeHost(on)
    const written: string[] = []
    on('fs.write', (_, e) => {
      written.push(e.text)
      return { value: undefined }
    })
    const notes: string[] = []
    on('ui.notify', (_, e) => {
      notes.push(e.text)
      return { value: { isSent: true, channel: 'client' } } as never
    })
    on('session.id', () => ({ value: 'abc-123' }) as never)
    on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', () => ({ text: '' }))
    on('command.register', () => ({ value: { command: 'workmap' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    const texts = [
      'cannot\u0000open\u0007file\nsecret sk-private-1234',
      `\n  fail ${'y'.repeat(5000)}\nsecret sk-private-1234`,
      'Exit code 3\nstat: no such file\nsecret sk-private-1234',
    ]
    on('tool.call', () => failing(texts.shift() ?? ''))

    await $.session.start({ cwd: '/home/u/projects/workmap', surface: 'terminal', isInteractive: true })
    await $.turn.start({ text: 'hello', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'a', description: 'Первая' })
    await $.tool.call({ tool: 'Bash', command: 'b', description: 'Вторая' })
    await $.tool.call({ tool: 'Bash', command: 'c', description: 'Третья' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(6000)

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const first = (await ui.find({ type: 'Text', text: /Первая/ }))?.text ?? ''
    expect(first).toContain(' — cannot open file')
    const second = (await ui.find({ type: 'Text', text: /Вторая/ }))?.text ?? ''
    expect(second).toContain(` — fail ${'y'.repeat(66)}…`)
    expect(second).not.toContain('y'.repeat(67))
    const third = (await ui.find({ type: 'Text', text: /Третья/ }))?.text ?? ''
    expect(third).toMatch(/код 3.* — stat: no such file/)
    for (const row of [first, second, third]) expect(row).not.toMatch(/[\u0000-\u001f]|sk-private/)
    await ui.unmount()

    // Never in a notification nor in the status file.
    expect(written.length).toBeGreaterThan(0)
    for (const text of [...written, ...notes]) expect(text).not.toMatch(/cannot|fail y|no such file|sk-private/)
  },
)

test('memory a hook adds shows as numbers, never as its text', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#1971 excerpt] тайный текст записи\n• [#277 excerpt] ещё'] }))

  await $.classic.UserPromptSubmit({ prompt: 'привет', permission_mode: 'default' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /записей 2/ }))?.text).toContain('#1971 #277')
  expect(await ui.find({ type: 'Text', text: /тайный/ })).toBeUndefined()
  await ui.unmount()
})

test('a broken board never stops the tool', async ($, on) => {
  on('state.get', () => {
    throw new Error('no state')
  })
  on('state.set', () => {
    throw new Error('no state')
  })
  on('tool.call', () => ({ result: { ok: true } }))

  const ran = await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(ran.deny).toBeUndefined()
  expect(ran.result).toEqual({ ok: true })
})

test('what an earlier version stored is declined', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('state.get', () => ({ value: { value: { rows: 1 }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Пока ничего/ }))?.text).toBe('Пока ничего не было.')
  await ui.unmount()
})

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as const

test('a model step streams through untouched and shows on the map', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'первый' } as never
    yield { kind: 'text', index: 0, text: 'второй' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })

  const seen: unknown[] = []
  const stream = $.turn.step(STEP)
  for await (const chunk of stream) seen.push(chunk)
  expect(seen).toEqual([
    { kind: 'text', index: 0, text: 'первый' },
    { kind: 'text', index: 0, text: 'второй' },
  ])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /шаг 1/ })
  expect(row?.text).toContain('Модель')
  expect(row?.text).toContain('opus 5.5')
  await ui.unmount()
})

test('a broken board never stops a model step', async ($, on) => {
  on('state.get', () => {
    throw new Error('no state')
  })
  on('state.set', () => {
    throw new Error('no state')
  })
  on('clock.now', () => {
    throw new Error('no clock')
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'дошло' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })

  const seen: unknown[] = []
  for await (const chunk of $.turn.step(STEP)) seen.push(chunk)
  expect(seen).toEqual([{ kind: 'text', index: 0, text: 'дошло' }])
})

test('the end of a turn settles a call that never reported back', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'и всё' } as never
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })
  // A step that was never read to its end stays "running", as an interrupted call does.
  const hanging = $.turn.step(STEP)[Symbol.asyncIterator]()
  await hanging.next()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ход прерван/ }))?.text).toContain(stringsFor('ru').stations.you)
  expect(await ui.find({ type: 'Text', text: /идёт/ })).toBeUndefined()
  await ui.unmount()
})

// ---- what the second version added ---------------------------------------------------------------

const entry = (station: Entry['station'], startedAt: number, more: Partial<Entry> = {}): Entry => ({
  id: `${station}${startedAt}`,
  station,
  label: station,
  from: 'core',
  startedAt,
  endedAt: startedAt + 10,
  status: 'ok',
  ...more,
})

test('finished calls in a row at one station fold into one row, anything else stands alone', () => {
  const rows = foldRows([
    entry('files', 1),
    entry('files', 20),
    entry('files', 40),
    entry('shell', 60, { status: 'err' }),
    entry('shell', 80, { status: 'err' }),
    entry('model', 100, { mark: 'switch' }),
    entry('files', 120, { status: 'run', endedAt: undefined }),
    entry('files', 140),
  ])
  expect(rows.map(row => `${row.entry.station} ${row.times} ${row.tookMs}`)).toEqual([
    'files 1 10',
    'files 1 0',
    'model 1 10',
    'shell 1 10',
    'shell 1 10',
    'files 3 30',
  ])
  expect(foldRows(Array.from({ length: 40 }, (_, i) => entry(i % 2 ? 'files' : 'shell', i * 20))).length).toBe(16)
})

test('a long call shows two clock hands, several at once a count, a fault a dot until the next message', () => {
  const now = 1_000_000
  const running = (startedAt: number): Entry => entry('shell', startedAt, { status: 'run', endedAt: undefined })
  const one = drawMap({ entries: [running(now - 90_000)], counts: { shell: 1 } }, now, STRANGER)
  expect(one).toContain('begin="-30.000s" dur="60.000s" repeatCount="indefinite"')
  expect(one).toContain('begin="-90.000s" dur="600.000s" fill="freeze"')
  expect(one).not.toContain('×')
  const three = drawMap({ entries: [running(now - 300), running(now - 200), running(now - 100)], counts: { shell: 3 } }, now, STRANGER)
  expect(three).toContain('>×3<')
  expect(drawMap({ entries: [], counts: {}, faults: { shell: 2 } }, now, STRANGER)).toContain('font-weight="700" fill="#0a0c11">2<')
  expect(drawMap({ entries: [], counts: {} }, now, STRANGER)).not.toContain('font-weight="700"')
})

const stepOn = (model: string) => ({ turnId: 't1', index: 0, model, messageCount: 1 }) as const

test('a model that changes mid-session is a row of its own, and the first model of a session is not', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })
  for (const model of ['claude-opus-5-5', 'claude-opus-5-5', 'claude-fable-5-2']) {
    for await (const _ of $.turn.step(stepOn(model))) void _
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /→/ })
  expect(row?.text).toContain('◆ Модель')
  expect(row?.text).toContain('opus 5.5 → fable 5.2')
  expect((await ui.find({ type: 'Text', text: /\+1/ }))?.text).toContain('opus 5.5 · шаг 1')
  await ui.unmount()
})

test('what goes wrong stays on its station until the next message; an interrupted turn is no fault', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: {}, isError: true }) as never)

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' } as never)

  const dots = async (): Promise<number> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    return source.split('font-weight="700"').length - 1
  }
  expect(await dots()).toBe(1)
  await $.turn.start({ text: 'дальше', turnId: 't2' } as never)
  expect(await dots()).toBe(0)
})

test('the context window shows as soon as the engine tells how full it is', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 37 } } }) as never)
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
  })
  for await (const _ of $.turn.step(stepOn('claude-opus-5-5'))) void _

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('>37%<')
  expect((await ui.find({ type: 'Text', text: /контекст 37%/ }))?.text).toContain('Сейчас ничего не выполняется')
  await ui.unmount()
})

test('the map paints its ground unless told to leave the surface showing', () => {
  const board = { entries: [], counts: {} } as never
  const ground = /<rect width="460" height="\d+" rx="12"/
  expect(drawMap(board, 0, SETUP)).toMatch(ground)
  expect(drawMap(board, 0, setupFrom({ ...OWN, background: 'clear' }))).toMatch(ground)
  const bare = drawMap(board, 0, setupFrom({ ...OWN, background: 'transparent' }))
  expect(bare).not.toMatch(ground)
  expect(bare).toContain('ДОМ')
  // The setting does not leak into the next drawing.
  expect(drawMap(board, 0, SETUP)).toMatch(ground)
})

test('a quoted path with a space is one command, and a Windows program is read whatever its capitals', () => {
  const at = (command: string) => classify('Bash', { command }, SETUP).station
  const label = (command: string) => classify('Bash', { command }, SETUP).label
  expect(at('"C:\\Program Files\\Git\\cmd\\git.exe" push origin main')).toBe('web')
  expect(label('"C:\\Program Files\\Git\\cmd\\git.exe" status')).toBe('git')
  expect(at("'/Applications/My Tools/bin/curl' -s https://a.b/x")).toBe('web')
  expect(at('C:\\tools\\CURL.EXE -s https://a.b/x')).toBe('web')
  expect(at('npm.cmd install')).toBe('web')
  expect(at('NPM.CMD test')).toBe('shell')
  // Without a Windows ending a name keeps its case: on other systems `Curl` is another program.
  expect(at('Curl -s https://a.b/x')).toBe('shell')
  // A quote left open does not swallow the line into nothing.
  expect(label('grep "unfinished x.txt')).toBe('grep')
  expect(at('cat "my notes.txt" | grep "two words"')).toBe('files')
})

test('the PowerShell tool is read like the shell: its description as the label, its commands by their own names', () => {
  const ps = (command: string, description = '') => classify('PowerShell', { command, description }, SETUP)
  expect(ps('Get-Content C:\\Users\\a\\private\\notes.txt', 'Read the notes').label).toBe('Read the notes')
  expect(ps('Get-Content C:\\Users\\a\\private\\notes.txt').label).toBe('Get-Content')
  expect(ps('Get-Content notes.txt | Select-String todo').station).toBe('files')
  expect(ps('get-childitem -Recurse | Where-Object { $_.Length -gt 1kb } | Sort-Object Length').station).toBe('files')
  expect(ps('$text = Get-Content notes.txt; Write-Host done').station).toBe('files')
  expect(ps('Get-Content C:\\Users\\a\\.recall\\n.md').station).toBe('memory')
  expect(ps('Invoke-WebRequest https://a.b/x -OutFile x.zip').station).toBe('web')
  expect(ps('IRM https://a.b/x').station).toBe('web')
  expect(ps('& "C:\\Program Files\\Git\\cmd\\git.exe" push origin main').station).toBe('web')
  expect(ps('git status').station).toBe('shell')
  expect(ps('Get-Process | Stop-Process').station).toBe('shell')
  expect(ps('recall add private words').label).toBe('add')
  expect(ps('Invoke-WebRequest https://user:private@a.b/secret?x=1').label).toBe('Invoke-WebRequest')
  // The same names mean nothing to the Bash tool.
  expect(classify('Bash', { command: 'Get-Content notes.txt' }, SETUP).station).toBe('shell')
})

test('the route is soft on a light surface and each leg fades by itself after a while', () => {
  const walk = [entry('you', 1000, { from: 'inbound' }), entry('memory', 2000), entry('files', 3000), entry('shell', 4000)]
  const legs = (svg: string) => svg.split('<path d="M').length - 1
  const fresh = 5000

  // Three legs, each carrying the animation that takes it away: it starts when the hold is over.
  const dark = drawMap({ entries: walk, counts: {} }, fresh, setupFrom({ theme: 'dark' }))
  expect(legs(dark)).toBe(3)
  expect(dark.split('attributeName="opacity" values="').length - 1).toBeGreaterThanOrEqual(3)
  expect(dark).toContain(`begin="${((TRAIL_HOLD_MS - (fresh - 4000)) / 1000).toFixed(3)}s" dur="${(TRAIL_FADE_MS / 1000).toFixed(3)}s"`)
  expect(dark).toContain('stroke="#ebe6dd"')

  // On a light surface the route is a grey of its own, not the ink of the words.
  const light = drawMap({ entries: walk, counts: {} }, fresh, setupFrom({ theme: 'light' }))
  expect(light).toContain('stroke="#9c978b"')
  expect(light).not.toMatch(/<path d="M[^>]*stroke="#1f2228"[^>]*stroke-linecap="round" opacity=/)
  // Left to itself the map repaints the route with the rest.
  expect(drawMap({ entries: walk, counts: {} }, fresh, STRANGER)).toContain('[stroke="#ebe6dd"]{stroke:#9c978b}')

  // A leg in the middle of its fading starts the animation in the past, so it is drawn part-way gone.
  // The two older legs are gone by then; the newest has a second left.
  const almost = 3000 + TRAIL_HOLD_MS + TRAIL_FADE_MS
  const fading = drawMap({ entries: walk, counts: {} }, almost, setupFrom({ theme: 'dark' }))
  expect(legs(fading)).toBe(1)
  expect(fading).toContain(`begin="${((TRAIL_HOLD_MS - (almost - 4000)) / 1000).toFixed(3)}s"`)

  // After the hold and the fade nothing of the route is left; the spokes still say where the work went.
  const later = drawMap({ entries: walk, counts: { shell: 1 } }, 4000 + TRAIL_HOLD_MS + TRAIL_FADE_MS, setupFrom({ theme: 'dark' }))
  expect(legs(later)).toBe(0)
  expect(later).not.toContain('stroke="#ebe6dd"')
})

test('colors of your own replace their places in the palette, and nothing but a hex color gets into the drawing', () => {
  const board = { entries: [entry('you', 1000, { from: 'inbound' }), entry('files', 2000), entry('shell', 3000)], counts: { files: 1, shell: 1 } }
  const draw = (options: Record<string, unknown>) => drawMap(board, 4000, setupFrom(options))

  const own = draw({ theme: 'dark', colors: ['accent=#FF9900', 'background = #123', 'route=#00ff88'] })
  expect(own).toContain('#ff9900')
  expect(own).not.toContain('#e1ac6e')
  expect(own).toContain('<rect width="460" height="442" rx="12" fill="#112233"/>')
  expect(own).toContain('stroke="#00ff88"')
  // The rest of the palette is as it was.
  expect(own).toContain('#ebe6dc')

  // Written as one line with commas, as `claude plugin configure` takes lists.
  expect(setupFrom({ colors: 'accent=#ff9900, text=#ffffff' }).colors).toEqual({ accent: '#ff9900', bone: '#ffffff' })

  // Anything that is not a hex color, and any unknown name, counts as not set.
  const hostile = [
    'accent="/><script>alert(1)</script>',
    'accent=red',
    'accent=#12345',
    'accent=#1234567',
    'accent=url(#x)',
    'accent=#ff9900"',
    'nonsense=#ffffff',
    '=#ffffff',
    'accent',
    'text=rgb(1,2,3)',
  ]
  expect(setupFrom({ colors: hostile }).colors).toEqual({})
  expect(draw({ theme: 'dark', colors: hostile })).toBe(draw({ theme: 'dark' }))
  expect(draw({ theme: 'dark', colors: 12 })).toBe(draw({ theme: 'dark' }))

  // Left on `auto`, a color of your own holds on a light surface too; the rest is still repainted.
  const auto = draw({ colors: ['accent=#ff9900'] })
  expect(auto).not.toContain('[fill="#ff9900"]')
  expect(auto).not.toContain('[fill="#e1ac6e"]')
  expect(auto).toContain('[fill="#0a0c11"]{fill:#f5f2ea}')
  // A color that takes the value of another place keeps that place from being repainted with it.
  expect(draw({ colors: ['accent=#ebe6dc'] })).not.toContain('[fill="#ebe6dc"]')

  // Every place of the palette has a name, and no two names share a place.
  expect(new Set(Object.values(COLOR_NAMES)).size).toBe(14)
  // The setting does not leak into the next drawing.
  expect(draw({ theme: 'dark' })).toContain('#e1ac6e')
})

const NOTICE = (id: string, status: string): string =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/secret-place/${id}.output</output-file>\n<status>${status}</status>\n<summary>Background command "private words" ${status}</summary>\n</task-notification>`

test('a background task is read from the answer that started it, and its notification for the id and the ending alone', () => {
  expect(taskOf({ stdout: '', backgroundTaskId: 'bqf7movxe' })).toBe('bqf7movxe')
  expect(taskOf({ status: 'async_launched', agentId: 'a1', description: 'x' })).toBe('a1')
  expect(taskOf({ status: 'async_launched', taskId: 'w1' })).toBe('w1')
  expect(taskOf({ taskId: 'm1', timeoutMs: 300000 })).toBe('m1')
  expect(taskOf({ stdout: 'done' })).toBeUndefined()
  expect(taskOf({ taskId: 'x', status: 'completed' })).toBeUndefined()
  expect(taskOf({ backgroundTaskId: 'a b <c>' })).toBeUndefined()
  expect(taskOf(undefined)).toBeUndefined()

  expect(taskNotice(NOTICE('b1', 'completed'))).toEqual({ id: 'b1', status: 'ok' })
  expect(taskNotice(NOTICE('b1', 'killed'))).toEqual({ id: 'b1', status: 'ok' })
  expect(taskNotice(NOTICE('b1', 'failed'))).toEqual({ id: 'b1', status: 'err' })
  expect(taskNotice('<task-notification>\n<task-id>m1</task-id>\n<summary>line</summary>\n</task-notification>')).toEqual({ id: 'm1' })
  expect(taskNotice('please read <task-notification><task-id>b1</task-id>')).toBeUndefined()
  expect(taskNotice('привет')).toBeUndefined()
})

test('a command sent to the background stays on the map until its task reports back', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }) as never)

  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Ждать сборку', run_in_background: true })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const seen = async (): Promise<{ running: boolean; text: string }> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // Work in the background is pinned above the rows while it goes on.
    const running = (await ui.find({ type: 'Text', text: /^↻ .*Ждать сборку/ })) !== undefined
    const source = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    return { running, text: source }
  }
  // The turn is over and the command is not.
  expect((await seen()).running).toBe(true)

  // Another task's notification leaves it alone.
  await $.turn.start({ text: NOTICE('other', 'completed'), turnId: 't2' } as never)
  expect((await seen()).running).toBe(true)

  await $.turn.start({ text: NOTICE('b1', 'completed'), turnId: 't3' } as never)
  const after = await seen()
  expect(after.running).toBe(false)
  // Nothing of the notification but the fact gets onto the map, and it is not read as the person's message.
  expect(after.text).not.toContain('private words')
  expect(after.text).not.toContain('secret-place')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /новое сообщение/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /private words/ })).toBeUndefined()
  await ui.unmount()
})

test('a background task that failed leaves a fault on its station', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Сборка', run_in_background: true })
  await $.turn.start({ text: NOTICE('b2', 'failed'), turnId: 't2' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const source = String((await ui.find({ type: 'Svg' }))?.props.source)
  await ui.unmount()
  expect(source.split('font-weight="700"').length - 1).toBe(1)
})

test('a typed slash command keeps a background task that is older than the rows kept, and its name is cleaned', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('skill.prompt', (_, e) => ({ text: e.text }) as never)
  let n = 0
  on('tool.call', () => ({ result: n++ === 0 ? { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b9' } : {} }) as never)

  await $.tool.call({ tool: 'Bash', command: 'sleep 600', description: 'Ждать сборку', run_in_background: true })
  for (let i = 0; i < 90; i++) await $.tool.call({ tool: i % 2 === 0 ? 'Read' : 'Bash', file_path: `/a/b/${i}.py`, command: 'make', description: `шаг ${i}` })
  await $.skill.prompt({ skill: 'de\u001b[31mploy', text: '' } as never)

  const running = async (): Promise<boolean> => {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const found = (await ui.find({ type: 'Text', text: /Ждать сборку/ })) !== undefined
    await ui.unmount()
    return found
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /de \[31mploy/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\u001b/ })).toBeUndefined()
  await ui.unmount()
  expect(await running()).toBe(true)
  await $.turn.start({ text: NOTICE('b9', 'completed'), turnId: 't2' } as never)
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /идёт/ })).toBeUndefined()
  await after.unmount()
})

// ---- the map in a terminal ----------------------------------------------------------------------

const NOW = 1_000_000
test('a failed shell row shows its exit code, and nothing of its output', async ($, on) => {
  mock.clock(on, { now: NOW })
  const failures: Record<string, unknown> = { Bash: { result: {}, isError: true, text: 'Exit code 2\nsecret line' } }
  on('tool.call', (_, e) => (failures[e.tool] ?? { result: {}, isError: true, text: 'File does not exist.' }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' } as never)
  // A command that works on files alone lands on Files, and its exit code shows there too.
  await $.tool.call({ tool: 'Bash', command: 'grep -r needle .', description: 'Look for the needle' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/c.py' } as never)
  const shell = (await ui.find({ type: 'Text', text: /Run the tests/ }))?.text ?? ''
  expect(shell).toMatch(/^✕ Shell +Run the tests {2}exit 2/)
  expect(shell).not.toContain('secret')
  expect((await ui.find({ type: 'Text', text: /Look for the needle/ }))?.text).toMatch(/^✕ Files +Look for the needle {2}exit 2/)
  expect((await ui.find({ type: 'Text', text: /b\/c\.py/ }))?.text).not.toContain('exit')
  await ui.unmount()
})

type Called = { tool: { check: (input: never) => Promise<unknown>; run: (input: never) => Promise<unknown> } }

/** A renderer that says it is ready, then writes the frames it is told to, and stays until `end` is called. */
function fakeRenderer(on: On, dir = '/tmp/workmap-test') {
  const lines: string[] = [`ready ${dir}`]
  let wake = () => {}
  let isOver = false
  const spawned: string[][] = []
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    while (!isOver) {
      const line = lines.shift()
      if (line !== undefined) yield { stream: 'stdout' as const, text: `${line}\n` }
      else await new Promise<void>(resolve => (wake = resolve))
    }
    return { value: { code: 0, signal: null } }
  })
  return {
    spawned,
    say: (line: string) => {
      lines.push(line)
      wake()
    },
    end: () => {
      isOver = true
      wake()
    },
  }
}

/** Answers `$.process.run` as a host with node and a chromium launcher on the session's PATH, and keeps each argv. */
function fakeHost(on: On): string[][] {
  const runs: string[][] = []
  on('session.end', () => ({ sessionId: 'test' }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const script = e.argv[0] === 'sh' ? (e.argv[2] ?? '') : ''
    const stdout = script.includes('node') ? '/usr/bin/node\n' : script.includes('chromium') ? '/home/u/.local/bin/chromium\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return runs
}

test('/workmap window keeps the live map for a window of its own and splits the Windows Terminal tab for it, from WSL', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { WSL_DISTRO_NAME: 'Ubuntu', TMPDIR: '/tmp' })
  on('tool.call', () => ({ result: {} }))
  const runs = fakeHost(on)
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })

  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  const answer = await $.command.run({ command: 'workmap', args: 'window' } as never)
  expect(answer.text).toBe('Map window opened beside this one.')
  // The tab is split for renderer/view.mjs on the live folder, with the Node and Chromium found here; Edge is not opened.
  const split = runs.find(argv => argv[0] === 'wt.exe') ?? []
  expect(split.slice(0, 7)).toEqual(['wt.exe', '-w', '0', 'split-pane', '--vertical', '--size', '0.45'])
  expect(split).toContain('WORKMAP_CHROMIUM=/home/u/.local/bin/chromium')
  expect(split.at(-2)).toMatch(/\/renderer\/view\.mjs$/)
  expect(split.at(-1)).toMatch(/^\/tmp\/workmap-live-[a-z0-9]+$/)
  expect(runs.some(argv => argv[1]?.endsWith('/renderer/serve.mjs'))).toBe(false)
  const dir = split.at(-1) ?? ''
  const maps = () => written.filter(w => w.path === `${dir}/map.svg`)
  expect(maps().length).toBe(1)
  expect(maps()[0]?.text).toMatch(/^<svg [^>]*width="920" height="884"/)
  expect(written.some(w => w.path === `${dir}/alive`)).toBe(true)
  // The rows under the map go with it, as the pane writes them.
  const feed = JSON.parse(written.find(w => w.path === `${dir}/feed.json`)?.text ?? '{}')
  expect(feed.rows).toMatchObject([{ tone: 'ok', cols: ['·', 'Files', 'b/content.py', ''] }])
  expect(typeof feed.now).toBe('string')
  expect(feed.changed).toBeNull()

  // An unchanged board is not written again; a new call is.
  await clock.advance(1000)
  expect(maps().length).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'make test', description: 'Run the tests' })
  await clock.advance(300)
  expect(maps().length).toBe(2)
  expect(maps()[1]?.text).not.toBe(maps()[0]?.text)

  // A /clear keeps the window; the end of the session takes its folder away.
  await $.session.end({ reason: 'clear' } as never)
  expect(runs.some(argv => argv[0] === 'rm')).toBe(false)
  await $.session.end({ reason: 'other' } as never)
  expect(runs.at(-1)).toEqual(['rm', '-rf', '--', dir])
})

/** A session in Windows Terminal from WSL, as one in the background sees it: the profile is set, the tab is not. */
const IN_WINDOWS_TERMINAL = { WSL_DISTRO_NAME: 'Ubuntu', WT_PROFILE_ID: '{51855cb2}', TMPDIR: '/tmp' }

/** Answers the session's start, its turns and the pane, and keeps the id of each pane opened. */
function fakeSession(on: On): string[] {
  const panes: string[] = []
  on('ui.open', (_, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('command.register', () => ({ value: { command: 'workmap' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  return panes
}

test('when the tab cannot be split, the window opens in Edge instead', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, IN_WINDOWS_TERMINAL)
  const runs: string[][] = []
  on('session.end', () => ({ sessionId: 'test' }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const exitCode = e.argv[0] === 'wt.exe' ? 1 : 0
    return { value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', () => ({ value: undefined }))
  const panes = fakeSession(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await clock.settle()
  // renderer/serve.mjs starts the local server unless one runs and opens Edge on the live folder, by its name.
  const open = runs.find(argv => argv[1]?.endsWith('/renderer/serve.mjs')) ?? []
  expect(open[2]).toBe('--open')
  expect(open[3]).toMatch(/^[a-z0-9]+$/)
  expect(runs.findIndex(argv => argv[0] === 'wt.exe')).toBeLessThan(runs.indexOf(open))
  expect(panes).toEqual([])
  await $.session.end({ reason: 'other' } as never)
})

test(
  'with guardedHooks off no hook of the five leaves a row, and a refused call reads as failed',
  { options: { ...OWN, guardedHooks: false } },
  async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('classic.PreToolUse', () => ({ deny: 'JUDGE: found key sk-private\nCommand: secret' }))
    on('classic.UserPromptSubmit', () => ({ additionalContext: ['• [#1971 excerpt] тайный текст записи'] }))
    on('classic.SessionStart', () => ({ additionalContext: ['• [#277 excerpt] ещё'] }))
    on('skill.prompt', (_, e) => ({ text: e.text }) as never)
    on('session.compact', () => ({ skip: 'test' }) as never)
    on('tool.call', () => ({ result: {} }))
    let kept: Board = { entries: [], counts: {} }
    on('state.set', ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept = e.value?.value ?? kept), next(e))) as never)

    await $.classic.SessionStart({ source: 'startup' } as never)
    await $.classic.UserPromptSubmit({ prompt: 'привет', permission_mode: 'default' } as never)
    await $.skill.prompt({ skill: 'deploy', text: '' } as never)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'kept', toolUses: [] }] } as never)
    await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

    // Without its hook on classic.PreToolUse the mod cannot tell a refusal from an error.
    expect(kept.entries.filter(e => e.station === 'shell').map(e => e.status)).toEqual(['err'])

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /Показать статус/ }))?.text).toMatch(/^✕ /)
    expect(await ui.find({ type: 'Text', text: /Хуки|deploy|#1971|#277|JUDGE|sk-private/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(SETUP.t.compacting) })).toBeUndefined()
    await ui.unmount()
  },
)

const keepBoard = (on: (event: 'state.set' | 'session.measure', hook: never) => void) => {
  const kept: { board: Board } = { board: { entries: [], counts: {} } }
  on(
    'state.set',
    ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept.board = e.value?.value ?? kept.board), next(e))) as never,
  )
  on('session.measure', ((_: unknown, e: { changed: unknown }) => ({ changed: e.changed })) as never)
  return kept
}
/** The core's usage tooltip as the drawn map carries it. */
function usageTipIn(
  svg: string,
):
  | { name: string; rows: { label: string; value: string; note?: string; isReached?: true }[]; billed?: string; why?: string; near?: unknown[]; full?: unknown }
  | undefined {
  const unescape = (text: string) =>
    text
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  return [...svg.matchAll(/<g data-tip="([^"]*)"/g)].map(m => JSON.parse(unescape(m[1] ?? '{}'))).find(t => t.kind === 'usage')
}

test('the limits the engine reports are kept, and from 90% they read as nearly full, with when they reset', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const kept = keepBoard(on as never)
  const limits = [
    { kind: 'five_hour', percentUsed: 92, resetsAt: new Date(1_000_000 + 130 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 40 },
    { kind: 'spend_limit', percentUsed: 5 },
  ]
  await $.session.measure({ context: { percent: 95 }, rateLimits: limits, cost: { usd: 1.234 }, changed: ['rateLimits'] } as never)
  expect(kept.board.limits?.map(l => [l.kind, l.percent])).toEqual([
    ['five_hour', 92],
    ['seven_day', 40],
  ])
  expect(kept.board.cost).toBe(1.234)
  const t = SETUP.t
  const tip = usageTipIn(drawMap({ ...kept.board, context: 95 }, 1_000_000, SETUP))
  expect(tip?.rows).toMatchObject([
    { label: t.usage.session, value: '95%' },
    { label: t.limitNames.five_hour, value: '92%', note: t.resetsIn(t.hoursMinutes(2, 10)) },
    { label: t.limitNames.seven_day, value: '40%' },
    { label: t.usage.atApi, value: '$1.23', note: t.usage.covered },
  ])
  // The context and the five-hour limit past 90%: both nearly full, the limit with when it resets; nothing billed yet.
  expect(tip?.near).toEqual([{ label: t.usage.fiveLimit, value: '92%', hint: t.resetsIn(t.hoursMinutes(2, 10)) }])
  expect(tip?.full).toMatchObject({ value: '95%' })
  expect(tip?.billed).toBeUndefined()
  // Under 90% nothing is nearly full.
  const calm = usageTipIn(drawMap({ ...kept.board, context: 40, limits: [{ kind: 'seven_day', percent: 40.6 }] }, 1_000_000, SETUP))
  expect(calm?.near).toBeUndefined()
  expect(calm?.full).toBeUndefined()
})

test('once a plan limit is reached, usage is billed: the dollars since then, and why', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const kept = keepBoard(on as never)
  const measure = (weekly: number, usd: number) =>
    $.session.measure({ context: { percent: 20 }, rateLimits: [{ kind: 'seven_day', percentUsed: weekly }], cost: { usd }, changed: ['rateLimits'] } as never)
  await measure(80, 1)
  await measure(100, 1.5)
  await measure(100, 4)
  // The plan covered what came before the limit: the dollars count from it.
  expect(kept.board.paidFrom).toBe(1)
  const t = SETUP.t
  const svg = drawMap(kept.board, 1_000_000, SETUP)
  const tip = usageTipIn(svg)
  expect(tip?.billed).toBe('$3.00')
  expect(tip?.why).toBe(t.usage.weekReached)
  expect(tip?.rows.at(-1)).toEqual({ color: '', label: t.usage.extra, value: '$3.00', note: `${t.usage.billed} · ${t.usage.estimate}`, isReached: true })
  // No plan limits at all, as on an API key: the session's dollars are billed.
  expect(usageTipIn(drawMap({ entries: [], counts: {}, cost: 2 }, 1_000_000, SETUP))).toMatchObject({ billed: '$2.00', why: t.usage.apiKey })
})

test('built-in tools land by what they are for, labelled by their name alone', () => {
  // Every input carries words of its own: none of them may reach the label.
  const content = {
    subject: 'private',
    description: 'private',
    prompt: 'private',
    plan: 'private',
    query: 'private',
    message: 'private',
    uri: 'private',
    server: 'private',
  }
  const seen = (tool: string) => {
    const { station, label } = classify(tool, content, STRANGER)
    return `${station} ${label}`
  }

  for (const tool of [
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
    'TodoWrite',
    'EnterPlanMode',
    'PushNotification',
    'ReportFindings',
    'SendUserMessage',
    'FetchInboxMessage',
    'SendFeedback',
    'ProposeGoal',
    'propose_skills',
    'WrapUp',
    'ShowOnboardingRolePicker',
    'OfferChromeSetup',
    'ReadWidgetContext',
    'EndConversation',
  ])
    expect(seen(tool)).toBe(`you ${tool}`)
  // The fork's own: a plan for approval reads in words, not by the tool's name.
  expect(seen('ExitPlanMode')).toBe(`you ${STRANGER.t.planForYou}`)

  for (const tool of [
    'CronCreate',
    'CronDelete',
    'CronList',
    'ScheduleWakeup',
    'RemoteTrigger',
    'ListAgents',
    'SubagentHandback',
    'SendFile',
    'Poll',
    'Yield',
    'ReadNotifications',
  ])
    expect(seen(tool)).toBe(`agents ${tool}`)

  for (const tool of [
    'ListSkills',
    'SearchSkills',
    'SuggestSkills',
    'ListPlugins',
    'SearchPlugins',
    'SuggestPluginInstall',
    'ListConnectors',
    'SearchMcpRegistry',
    'SuggestConnectors',
    'WaitForMcpServers',
  ])
    expect(seen(tool)).toBe(`skills ${tool}`)

  for (const tool of [
    'ArtifactComments',
    'ArtifactData',
    'SendToProject',
    'SendToProjectContext',
    'Projects',
    'ClaudeDesign',
    'DesignSync',
    'ShareOnboardingGuide',
    'PublishPlugin',
  ])
    expect(seen(tool)).toBe(`web ${tool}`)

  // An MCP server's resources sit with the server, with the skills.
  for (const tool of ['ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool']) expect(seen(tool)).toBe(`skills ${tool}`)

  for (const tool of ['LSP']) expect(seen(tool)).toBe(`files ${tool}`)

  // They work with git, or run code: Shell, as before.
  for (const tool of ['EnterWorktree', 'ExitWorktree', 'REPL', 'AppifactRepl']) expect(seen(tool)).toBe(`shell ${tool}`)
})

test("an MCP server's resources are memory when the server is a memory server, and never show the resource's address", () => {
  const seen = (tool: string, server: string, setup = STRANGER) => {
    const { station, label } = classify(tool, { server, uri: 'file:///Users/a/private.md' }, setup)
    return `${station} ${label}`
  }
  for (const tool of ['ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool']) {
    expect(seen(tool, 'memory')).toBe(`memory ${tool}`)
    expect(seen(tool, 'github')).toBe(`skills ${tool}`)
    // A server named in the person's options counts as theirs.
    expect(seen(tool, 'recall', SETUP)).toBe(`memory ${tool}`)
  }
  // Listing every server's resources names none: the call is no memory call.
  expect(classify('ListMcpResourcesTool', {}, STRANGER).station).toBe('skills')
})

test('what is remembered between two events is held to a count, the oldest dropped first', () => {
  const refused = new Set<string>()
  for (let i = 0; i < 100; i++) {
    refused.add(`call-${i}`)
    keepNewest(refused, 64)
  }
  expect(refused.size).toBe(64)
  expect(refused.has('call-35')).toBe(false)
  expect(refused.has('call-36')).toBe(true)
  expect(refused.has('call-99')).toBe(true)
  const crew = new Map([
    ['a', 'one'],
    ['b', 'two'],
    ['c', 'three'],
  ])
  keepNewest(crew, 2)
  expect([...crew.keys()]).toEqual(['b', 'c'])
  keepNewest(crew, 2)
  expect(crew.size).toBe(2)
})

for (const [what, variables] of [
  ['TERM_PROGRAM iTerm.app', { TERM: 'xterm-kitty', TERM_PROGRAM: 'iTerm.app' }],
  ['LC_TERMINAL iTerm2 over ssh', { LC_TERMINAL: 'iTerm2', TERM: 'xterm-kitty' }],
  ['LC_TERMINAL iTerm2 inside tmux', { LC_TERMINAL: 'iTerm2', TERM: 'xterm-kitty', TERM_PROGRAM: 'tmux' }],
] as const) {
  test(`iTerm2 keeps the map in cells: ${what}`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, variables)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('command.register', () => ({ value: { command: 'workmap' } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('fs.write', () => ({ value: undefined }))
    on('ui.blit', () => ({ value: {} }))
    const renderer = fakeRenderer(on)

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await clock.settle()
    expect(renderer.spawned.length).toBe(0)
    expect(await ui.find({ type: 'Raster' })).toBeDefined()
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    await ui.unmount()
  })
}

/** The person's own runtime folder, where the sessions' status files go. */
const RUNTIME = { XDG_RUNTIME_DIR: '/run/user/1000', HOME: '/home/u' }
test('a tile cannot drive the terminal: control characters are taken out of its words', () => {
  const t = stringsFor('en')
  const [tile] = tilesFrom([JSON.stringify({ name: 'a\x1b[2Jb', word: 'x\x07', now: 'n\x9b', state: 'idle', startedAt: NOW, updatedAt: NOW })], NOW)
  expect(tileText(tile as never, NOW, t)).toBe('a[2Jb  x  n  0 s')
})

// ---- contextCost: what each call added to the context -----------------------------------------------
