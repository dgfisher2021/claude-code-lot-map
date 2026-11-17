import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Board } from '../types'
import type { Entry, TurnSummary } from '../types'
import { COLOR_NAMES, TRAIL_FADE_MS, TRAIL_HOLD_MS, changedLine, classify, clean, describeNow, drawMap, feedLines, firstLine, foldRows, formatMs, keepNewest, memoryIds, pinnedLines, routeOf, setupFrom, stateOf, taskNotice, taskOf, warningsOf } from './map'
import { mapSize, paceOf, paintMap } from './raster'
import { stringsFor } from './text'
import { layout } from '../renderer/layout.mjs'
import { tileText, tilesFrom } from './overview'

const PANE = {
  plugin: 'lot-map',
  component: 'Pane',
  requestId: 'lot-map',
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
    'find . -exec curl {} \;',
    'find . -name "*.url" -exec sudo curl {} +',
  ]) expect(`${at(command)} ${command}`).toBe(`web ${command}`)

  for (const command of [
    'sudo cat /etc/hosts',
    'find . -name "*.tmp" -exec rm {} \;',
    'find . -type f | xargs grep x',
    'rm -rf build',
    'rmdir build',
    'env A=1 ls',
  ]) expect(`${at(command)} ${command}`).toBe(`files ${command}`)

  for (const command of [
    'find . -exec make {} \;',
    'sudo make install',
    'command -v curl',
    'npx tsc',
    'git -C dir status',
    'python -m http.server',
    'docker compose up',
    'go build ./...',
    'xargs',
    'timeout 5',
  ]) expect(`${at(command)} ${command}`).toBe(`shell ${command}`)

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
  expect(at('mcp__recall__search', {})).toBe('web')
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

for (const [language, row] of [['es', 'Archivos  b/content.py'], ['fr', 'Fichiers   b/content.py'], ['de', 'Dateien    b/content.py'], ['it', 'File      b/content.py'], ['pt', 'Ficheiros b/content.py']] as const) {
  test(`the pane speaks ${language}, its columns even`, { options: { language } }, async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('tool.call', () => ({ result: {} }))
    await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain(row)
    await ui.unmount()
  })
}

test('options that make no sense count as not set', () => {
  const odd = setupFrom({ language: 'xx', coreName: '   ', memoryServers: 7, memoryLabels: ['no-equals', '=x', 'y='], hookRecords: 'yes' })
  expect(odd.t.idle).toBe(stringsFor('en').idle)
  expect(odd.core).toBe('CLAUDE')
  expect(odd.memoryServers.size).toBe(0)
  expect(odd.memoryLabels.size).toBe(0)
  expect(odd.hookRecords).toBe(false)
})

test('a long name shrinks inside the core and cannot break the drawing', () => {
  const svg = (name: string) => drawMap({ entries: [], counts: {} }, 1000, setupFrom({ coreName: name }))
  expect(svg('A<B&"C"DEFGHIJK')).toContain('A&lt;B&amp;&quot;C&quot;DEF<')
  expect(svg('ABC')).toContain('font-size="17" letter-spacing="2.5"')
  expect(svg('CLAUDE')).toContain('font-size="13.8"')
  expect(svg('')).toContain('>CLAUDE<')
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
  expect(svg).toContain('opus 5.5')
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
  on('command.register', () => ({ value: { command: 'lot-map' } }))
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
    on('command.register', () => ({ value: { command: 'lot-map' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    const texts = [
      'cannot\u0000open\u0007file\nsecret sk-private-1234',
      `\n  fail ${'y'.repeat(5000)}\nsecret sk-private-1234`,
      'Exit code 3\nstat: no such file\nsecret sk-private-1234',
    ]
    on('tool.call', () => failing(texts.shift() ?? ''))

    await $.session.start({ cwd: '/home/u/projects/lot-map', surface: 'terminal', isInteractive: true })
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

test('a refused call never shows a reason', { options: { ...OWN, errorReasons: true } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('classic.PreToolUse', () => ({ deny: 'JUDGE: нельзя\nCommand: secret' }))
  on('tool.call', () => failing('blocked by judge: sk-private'))

  await $.tool.call({ tool: 'Bash', command: 'git status', description: 'Показать статус' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = (await ui.find({ type: 'Text', text: /Показать статус/ }))?.text ?? ''
  expect(row).toMatch(/^⊘ /)
  expect(row).not.toContain('—')
  expect(await ui.find({ type: 'Text', text: /sk-private/ })).toBeUndefined()
  await ui.unmount()
})


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
  on('state.get', () => { throw new Error('no state') })
  on('state.set', () => { throw new Error('no state') })
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
  expect(seen).toEqual([{ kind: 'text', index: 0, text: 'первый' }, { kind: 'text', index: 0, text: 'второй' }])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /шаг 1/ })
  expect(row?.text).toContain('Модель')
  expect(row?.text).toContain('opus 5.5')
  await ui.unmount()
})

test('a broken board never stops a model step', async ($, on) => {
  on('state.get', () => { throw new Error('no state') })
  on('state.set', () => { throw new Error('no state') })
  on('clock.now', () => { throw new Error('no clock') })
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
  expect((await ui.find({ type: 'Text', text: /ход прерван/ }))?.text).toContain('Ты')
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

test('the route is the main loop\'s stations in order, repeats and model steps left out', () => {
  const entries = [
    entry('you', 1, { from: 'inbound' }),
    entry('model', 2),
    entry('memory', 3),
    entry('memory', 4),
    entry('model', 5),
    entry('files', 6),
    entry('shell', 7, { from: 'agents', agentId: 'a1' }),
    entry('shell', 8),
  ]
  expect(routeOf(entries).map(stop => stop.station)).toEqual(['you', 'memory', 'files', 'shell'])
  expect(routeOf(entries)[1]?.at).toBe(4)
  expect(routeOf(entries, 2).map(stop => stop.station)).toEqual(['files', 'shell'])

  const svg = drawMap({ entries, counts: {} }, 5000, STRANGER)
  expect(svg.split('<path d="M').length - 1).toBe(3)
  expect(svg).toContain('stroke-dashoffset')
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

test('a spoke wears in with use and memory has a colour of its own', () => {
  const quiet = drawMap({ entries: [], counts: {} }, 1000, STRANGER)
  const busy = drawMap({ entries: [], counts: { files: 200, memory: 9 }, pushed: 4 }, 1000, STRANGER)
  expect(quiet).not.toContain('stroke-width="3.6"')
  expect(busy).toContain('stroke-width="3.6"')
  expect(busy).toContain('>5 <tspan fill="#62c7ba">↓4</tspan>')
  expect(drawMap({ entries: [], counts: { memory: 4 }, pushed: 4 }, 1000, STRANGER)).toContain('><tspan fill="#62c7ba">↓4</tspan>')
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

test('the context ring, the crew, the model change and the light theme are drawn only when there is something to show', () => {
  const now = 1_000_000
  const bare = drawMap({ entries: [], counts: {} }, now, STRANGER)
  expect(bare).not.toContain('pathLength="100"')
  expect(bare).not.toContain('animateTransform')
  expect(bare).toContain('#0a0c11')

  const full = drawMap({ entries: [], counts: {}, model: 'claude-fable-5-2', context: 92.4, agents: ['a', 'b'], switchedAt: now - 2000 }, now, STRANGER)
  expect(full).toContain('stroke="#e8654f" pathLength="100" stroke-dasharray="92 100"')
  expect(full).toContain('>92%<')
  expect(full.split('<animateTransform').length - 1).toBe(2)
  expect(full).toContain('repeatCount="4" fill="freeze"')
  expect(drawMap({ entries: [], counts: {}, switchedAt: now - 9000 }, now, STRANGER)).not.toContain('repeatCount="1" fill="freeze"')

  // Left to itself the map is drawn dark and carries the rules that repaint it on a light surface; a set theme carries none.
  expect(bare).toContain('<style>@media (prefers-color-scheme: light){[fill="#0a0c11"]{fill:#f5f2ea}')
  expect(bare).toContain('<rect width="460" height="430" rx="12" fill="#0a0c11"/>')
  const dark = drawMap({ entries: [], counts: {} }, now, setupFrom({ theme: 'dark' }))
  expect(dark).not.toContain('<style>')
  expect(dark).not.toContain('#f5f2ea')
  const light = drawMap({ entries: [], counts: {} }, now, setupFrom({ theme: 'light' }))
  expect(light).not.toContain('<style>')
  expect(light).toContain('<rect width="460" height="430" rx="12" fill="#f5f2ea"/>')
  // Whatever is lit, every color the dark drawing uses is one the rules know.
  const lit = drawMap(
    { entries: [entry('memory', now - 100, { from: 'inbound' }), entry('shell', now - 50, { status: 'err' }), entry('files', now - 20, { status: 'run', endedAt: undefined })], counts: { files: 50, memory: 3 }, pushed: 1, faults: { shell: 1 }, context: 80, agents: ['a'], switchedAt: now - 10, model: 'claude-fable-5-2' },
    now,
    setupFrom({ theme: 'dark' }),
  )
  const known = new Set(['#0a0c11', '#12151c', '#272c36', '#1a1e27', '#ebe6dc', '#9ba1ab', '#6b7280', '#e1ac6e', '#f0c595', '#e8654f', '#62c7ba', '#a5e6dc', '#ebe6dd'])
  expect([...new Set(lit.match(/#[0-9a-f]{6}/g) ?? [])].filter(color => !known.has(color))).toEqual([])
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

test('a subagent circles the agents station until its loop ends, and its hanging call is settled then', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'x' } as never
    return { turnId: 't2', index: 0, answer: '', toolUses: [] } as never
  })
  const hanging = $.turn.step({ ...stepOn('claude-haiku-5-5'), turnId: 't2', agentId: 'a1' } as never)[Symbol.asyncIterator]()
  await hanging.next()

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /идёт/ }))?.text).toContain('субагент')
  expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('animateTransform')
  await ui.unmount()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' } as never)

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /идёт/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ответ готов/ })).toBeUndefined()
  expect((await ui.find({ type: 'Svg' }))?.props.source).not.toContain('animateTransform')
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

test('the ring can be turned so that the person is at the bottom and the network at the top', () => {
  const heightOf = (svg: string, name: string): number => Number(new RegExp(`y="([\\d.]+)"[^>]*>${name}<`).exec(svg)?.[1])
  const board: Board = { entries: [], counts: {} }
  const usual = drawMap(board, 1000, setupFrom({ theme: 'dark' }))
  const turned = drawMap(board, 1000, setupFrom({ theme: 'dark', layout: 'you-bottom' }))
  expect(heightOf(usual, 'You')).toBeLessThan(heightOf(usual, 'Network'))
  expect(heightOf(turned, 'You')).toBe(heightOf(usual, 'Network'))
  expect(heightOf(turned, 'Network')).toBe(heightOf(usual, 'You'))
  expect(heightOf(turned, 'Browser')).toBe(heightOf(usual, 'Model'))
  // A turned map does not leak into the next one drawn, and nonsense counts as not set.
  expect(drawMap(board, 1000, setupFrom({ theme: 'dark' }))).toBe(usual)
  expect(drawMap(board, 1000, setupFrom({ theme: 'dark', layout: 'sideways' }))).toBe(usual)
})

test('the map paints its ground unless told to leave the surface showing', () => {
  const board = { entries: [], counts: {} } as never
  const ground = /<rect width="460" height="430" rx="12"/
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
  expect(own).toContain('<rect width="460" height="430" rx="12" fill="#112233"/>')
  expect(own).toContain('stroke="#00ff88"')
  // The rest of the palette is as it was.
  expect(own).toContain('#ebe6dc')

  // Written as one line with commas, as `claude plugin configure` takes lists.
  expect(setupFrom({ colors: 'accent=#ff9900, text=#ffffff' }).colors).toEqual({ accent: '#ff9900', bone: '#ffffff' })

  // Anything that is not a hex color, and any unknown name, counts as not set.
  const hostile = ['accent="/><script>alert(1)</script>', 'accent=red', 'accent=#12345', 'accent=#1234567', 'accent=url(#x)', 'accent=#ff9900"', 'nonsense=#ffffff', '=#ffffff', 'accent', 'text=rgb(1,2,3)']
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
  expect(new Set(Object.values(COLOR_NAMES)).size).toBe(13)
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

/** A Raster's cells, three words each: the glyph, the foreground and the background. */
function wordsOf(cells: string): Uint32Array {
  const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const body = cells.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4))
  let acc = 0
  let bits = 0
  let o = 0
  for (const ch of body) {
    acc = ((acc << 6) | digits.indexOf(ch)) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[o++] = (acc >> bits) & 255
    }
  }
  return new Uint32Array(bytes.buffer)
}

/** A Raster's glyphs as lines of text, one per row. */
function linesOf(cells: string, columns: number): string[] {
  const words = wordsOf(cells)
  const lines: string[] = []
  for (let k = 0; k < words.length; k += columns * 3) {
    let line = ''
    for (let c = 0; c < columns; c++) line += String.fromCodePoint(words[k + c * 3] ?? 0x3f)
    lines.push(line)
  }
  return lines
}

const NOW = 1_000_000
const at = (station: Entry['station'], ago: number, more: Partial<Entry> = {}): Entry => ({
  id: `${station}${ago}`,
  station,
  label: station,
  from: 'core',
  startedAt: NOW - ago,
  endedAt: NOW - ago + 200,
  status: 'ok',
  ...more,
})
const BUSY: Board = {
  entries: [
    at('you', 9000, { from: 'inbound' }),
    at('memory', 8000, { from: 'inbound' }),
    at('files', 7000),
    at('hooks', 4000, { status: 'block' }),
    at('agents', 3000, { status: 'run', endedAt: undefined }),
    at('files', 2500, { from: 'agents', agentId: 'x1' }),
    at('shell', 1800, { status: 'run', endedAt: undefined }),
    at('shell', 1700, { status: 'run', endedAt: undefined }),
    at('web', 420),
  ],
  counts: { you: 3, model: 14, memory: 5, files: 9, shell: 6, web: 3, agents: 1, hooks: 2 },
  model: 'claude-opus-5-5',
  pushed: 2,
  faults: { hooks: 1 },
  agents: ['x1'],
  context: 74,
  switchedAt: NOW - 1000,
}

test('the terminal map takes the width of its pane, keeps the ring round, and gives way where it would not read', () => {
  expect(mapSize(60, 40, 'dock')).toEqual({ columns: 60, rows: 28, isBeside: false })
  expect(mapSize(60, 30, 'dock')).toEqual({ columns: 60, rows: 22, isBeside: false })
  expect(mapSize(200, 80, 'dock')).toEqual({ columns: 120, rows: 44, isBeside: false })
  expect(mapSize(40, 40, 'dock')).toBeUndefined()
  // A short dock keeps the map: the rows under it give way first.
  expect(mapSize(60, 24, 'dock')).toEqual({ columns: 60, rows: 20, isBeside: false })
  expect(mapSize(60, 20, 'dock')).toEqual({ columns: 60, rows: 20, isBeside: false })
  expect(mapSize(60, 19, 'dock')).toBeUndefined()
  // Inline above the prompt the pane is wide and short: the map keeps to the left, the rows beside it.
  expect(mapSize(168, 22, 'inline')).toEqual({ columns: 47, rows: 22, isBeside: true })
  expect(mapSize(168, 40, 'inline')).toEqual({ columns: 51, rows: 24, isBeside: true })
  expect(mapSize(168, 17, 'inline')).toBeUndefined()
  expect(mapSize(70, 22, 'inline')).toBeUndefined()
})

test('stateOf reads idle, thinking, running, compacting and done in that precedence', () => {
  const shell: Entry = { id: 'e1', station: 'shell', label: 'make', from: 'core', startedAt: NOW, status: 'run' }
  const step: Entry = { id: 'e2', station: 'model', label: 'opus 5.5 · step 1', from: 'core', startedAt: NOW, status: 'run' }
  const quiet: Board = { entries: [], counts: {} }
  expect(stateOf(quiet)).toBe('idle')
  expect(stateOf({ ...quiet, phase: 'thinking', entries: [step] })).toBe('thinking')
  expect(stateOf({ ...quiet, phase: 'done', entries: [shell] })).toBe('running')
  expect(stateOf({ ...quiet, phase: 'compacting', entries: [shell] })).toBe('compacting')
  // Work left running in the background is no work of the turn, and neither is a background subagent's call.
  expect(stateOf({ ...quiet, phase: 'done', entries: [{ ...shell, task: 'b1' }] })).toBe('done')
  expect(stateOf({ ...quiet, phase: 'done', entries: [{ ...shell, from: 'agents', agentId: 'a1' }] })).toBe('done')
})

test('an interrupted turn reads idle, not the last answer, and a turn a notification starts reads thinking', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(600_000)
  await $.turn.start({ text: 'and now this', turnId: 't2' } as never)
  await clock.advance(5_000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't2', reason: 'aborted' } as never)
  expect(await ui.find({ type: 'Text', text: /your turn/ })).toBeUndefined()
  expect(await svg()).toContain('>idle<')
  // A background task reporting back starts a turn of Claude's: it thinks, it is not the person's turn.
  await $.turn.start({ text: 'again', turnId: 't3' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' } as never)
  await $.turn.start({ text: NOTICE('b1', 'completed'), turnId: 't4' } as never)
  expect(await ui.find({ type: 'Text', text: /your turn/ })).toBeUndefined()
  expect(await svg()).toContain('>thinking<')
  await ui.unmount()
})

test('the core names the session state on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  const t = stringsFor('en')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(await svg()).toContain(`>${t.states.idle}<`)
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await clock.settle()
  expect(await svg()).toContain(`>${t.states.thinking}<`)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  expect(await svg()).toContain(`>${t.states.done}<`)
  await ui.unmount()

  // The cells carry the word on the row under the model's: calls still run on this board, whatever the turn says.
  const lines = linesOf(paintMap({ ...BUSY, phase: 'done' }, NOW, setupFrom({ theme: 'dark' }), 60, 28), 60)
  const model = lines.findIndex(line => line.includes('opus 5.5'))
  expect(lines[model + 1]).toContain(t.states.running)

  // Every state in every language is short enough to sit under the core.
  for (const language of ['en', 'ru', 'es', 'fr', 'de', 'it', 'pt']) {
    for (const word of Object.values(stringsFor(language).states)) expect(word.length).toBeLessThanOrEqual(14)
  }
})

test('an error and a refusal at one station keep two badges, and their rows two marks', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  const answers: unknown[] = [{ deny: 'not here' }, { result: {}, isError: true, text: 'Exit code 1' }]
  on('tool.call', () => (answers.shift() ?? { result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'Bash', command: 'make clean', description: 'Clear the build' } as never).catch(() => undefined)
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build it' } as never)
  expect((await ui.find({ type: 'Text', text: /Clear the build/ }))?.text).toMatch(/^⊘ Shell/)
  expect((await ui.find({ type: 'Text', text: /Build it/ }))?.text).toMatch(/^✕ Shell/)
  const svg = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  // A failure fills its badge; a refusal draws one in outline.
  expect(await svg()).toMatch(/r="7\.5" fill="#[0-9a-f]{6}"\/>/)
  expect(await svg()).toMatch(/r="7\.5" fill="none" stroke="#[0-9a-f]{6}"/)
  // The person's next message clears both.
  await $.turn.start({ text: 'again', turnId: 't2' } as never)
  expect(await svg()).not.toMatch(/r="7\.5"/)
  await ui.unmount()
})

/** Answers TaskCreate as Claude Code does, numbering the tasks; refuses or fails any tool listed in `bad`. */
function fakeTasks(on: On, bad: Record<string, unknown> = {}): void {
  let made = 0
  on('tool.call', (_, e) => {
    if (bad[e.tool] !== undefined) return bad[e.tool] as never
    if (e.tool !== 'TaskCreate') return { result: {} } as never
    made++
    return { result: { task: { id: String(made) } }, text: `Task #${made} created successfully` } as never
  })
}

test('the plan shows as a checklist with progress, and work counts against the task in progress', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  fakeTasks(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const subject of ['Fix sizing', 'Add the legend', 'Write the docs']) await $.tool.call({ tool: 'TaskCreate', subject, description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/c.ts' } as never)
  await clock.advance(2000)
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' } as never)
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  expect(await text(/^Plan /)).toBe('Plan 1/3 ███░░░░░░░')
  expect(await text(/Fix sizing/)).toBe('✓ Fix sizing · 2 calls · 2.0 s')
  expect(await text(/Add the legend/)).toBe('◐ Add the legend')
  expect(await text(/Write the docs/)).toBe('○ Write the docs')
  await ui.unmount()
})

test('TodoWrite replaces the plan', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  fakeTasks(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Old', description: 'x' } as never)
  const todos = [
    { content: 'One', status: 'completed', activeForm: 'Doing one' },
    { content: 'Two', status: 'in_progress', activeForm: 'Doing two' },
    { content: 'Three', status: 'pending', activeForm: 'Doing three' },
  ]
  await $.tool.call({ tool: 'TodoWrite', todos } as never)
  expect((await ui.find({ type: 'Text', text: /^Plan / }))?.text).toMatch(/^Plan 1\/3 /)
  expect((await ui.find({ type: 'Text', text: /Two/ }))?.text).toBe('◐ Two')
  expect(await ui.find({ type: 'Text', text: /Old/ })).toBeUndefined()
  // A task the list writes as done keeps the time it was in progress.
  await clock.advance(3_000)
  await $.tool.call({ tool: 'TodoWrite', todos: todos.map(todo => ({ ...todo, status: 'completed' })) } as never)
  expect((await ui.find({ type: 'Text', text: /Two/ }))?.text).toBe('✓ Two · 3.0 s')
  await ui.unmount()
})

test('a plan survives tools that misbehave, and an empty one shows nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeTasks(on, { TaskGet: { result: {}, isError: true, text: 'No such task' } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'zz', status: 'completed' } as never)
  expect(await ui.find({ type: 'Text', text: /^Plan / })).toBeUndefined()
  await $.tool.call({ tool: 'TaskCreate', subject: 'Real', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: 'zz', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskGet', taskId: '1' } as never)
  expect((await ui.find({ type: 'Text', text: /^Plan / }))?.text).toMatch(/^Plan 0\/1 /)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'deleted' } as never)
  expect(await ui.find({ type: 'Text', text: /^Plan / })).toBeUndefined()
  await $.tool.call({ tool: 'TodoWrite', todos: [] } as never)
  expect(await ui.find({ type: 'Text', text: /^Plan / })).toBeUndefined()
  await ui.unmount()
})

test('a long subject with emoji and CJK is cut to 60 characters and kept clean', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeTasks(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'TaskCreate', subject: `修正🙂\u0007${'界'.repeat(200)}`, description: 'x' } as never)
  const line = (await ui.find({ type: 'Text', text: /^○ 修正/ }))?.text ?? ''
  expect(line).toMatch(/^○ 修正🙂 界界/)
  expect(Array.from(line.slice(2)).length).toBeLessThanOrEqual(60)
  expect(line).not.toMatch(/[\u0000-\u001f]/)
  await ui.unmount()
})

test('files written and edited are listed by name with their edits; refused and failed ones are not', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  const answers: unknown[] = [{ result: {} }, { result: {} }, { result: {} }, { deny: 'not here' }, { result: {}, isError: true, text: 'no' }]
  on('tool.call', () => (answers.shift() ?? { result: {} }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^✎/ })).toBeUndefined()
  expect((await $.command.run({ command: 'workmap', args: 'changed' } as never)).text).toBe('No files changed yet.')
  await $.tool.call({ tool: 'Write', file_path: '/p/a/b.ts', content: 'x' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/a/b.ts', old_string: 'x', new_string: 'y' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/a/b.ts', old_string: 'y', new_string: 'z' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/p/c.ts', old_string: 'x', new_string: 'y' } as never).catch(() => undefined)
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/p/n.ipynb', new_source: 'x' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/p/d.ts' } as never)
  expect((await ui.find({ type: 'Text', text: /^✎/ }))?.text).toBe('✎ 1 file changed: a/b.ts ×3')
  expect((await $.command.run({ command: 'workmap', args: 'changed' } as never)).text).toBe('a/b.ts ×3')
  await ui.unmount()
})

test('a long or wide file name never widens the changed line', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('tool.call', () => ({ result: {} }) as never)
  const t = stringsFor('de')
  const wide = `${'界🙂'.repeat(100)}.ts`
  const long = changedLine({ [`d/${wide}`]: 4 }, t)
  expect(Array.from(long?.line ?? '').length).toBeLessThanOrEqual(100)
  expect(long?.line).toMatch(/^✎ 1 Datei geändert: d\/界🙂.*…$/u)
  // Many files: whole entries only, the rest counted, the line within 100 characters.
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/file-${i}.ts`, 30 - i]))
  const line = changedLine(many, t)?.line ?? ''
  expect(Array.from(line).length).toBeLessThanOrEqual(100)
  expect(line).toMatch(/src\/file-0\.ts ×30, src\/file-1\.ts ×29/)
  expect(line).toMatch(/ und \d+ weitere$/)
  expect(line).not.toMatch(/×1\b/)
  expect(changedLine({ 'a.ts': 1 }, stringsFor('en'))).toEqual({ line: '✎ 1 file changed: a.ts', tone: 'plain' })
  expect(changedLine({}, t)).toBeUndefined()
  expect(changedLine(undefined, t)).toBeUndefined()
  // In the pane, an emoji and CJK name 200 characters long stays within it.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'Write', file_path: `/p/${wide}`, content: 'x' } as never)
  const shown = (await ui.find({ type: 'Text', text: /^✎/ }))?.text ?? ''
  expect(Array.from(shown).length).toBeLessThanOrEqual(100)
  await ui.unmount()
})

test('past five pieces of background work, the rest are counted', () => {
  const job = (i: number): Entry => ({ id: `b${i}`, station: 'shell', label: `job ${i}`, from: 'core', startedAt: NOW, status: 'run', task: `t${i}` })
  const going = Array.from({ length: 7 }, (_, i) => job(i))
  const lines = pinnedLines(going, NOW + 1000, stringsFor('en')).map(l => l.line)
  expect(lines.length).toBe(6)
  expect(lines[0]).toMatch(/job 6/)
  expect(lines[5]).toBe('and 2 more')
})

test('background work stays pinned with its time while later rows scroll by', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: { backgroundTaskId: 'b9' } } : { result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build the site', run_in_background: true } as never)
  // Twenty calls on two stations, so that none of them fold into another.
  for (let i = 0; i < 10; i++) {
    await $.tool.call({ tool: 'Read', file_path: `/a/b/f${i}.ts` } as never)
    await $.tool.call({ tool: 'WebSearch', query: `q${i}` } as never)
  }
  await clock.advance(20_000)
  expect((await ui.find({ type: 'Text', text: /^↻ / }))?.text).toMatch(/^↻ Shell +Build the site {2}20 s$/)
  // It is pinned, not listed a second time among the rows.
  expect(await ui.find({ type: 'Text', text: /^● .*Build the site/ })).toBeUndefined()
  await ui.unmount()
})

test("a subagent's failed call marks its own dot and names it in the row", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
  const failures: Record<string, unknown> = { Bash: { result: {}, isError: true, text: 'Exit code 1' } }
  on('tool.call', (_, e) => (failures[e.tool] ?? { result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.agent.spawn({ prompt: 'Find the auth code.', description: 'explore auth' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/auth.py', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests', agentId: 'a1' } as never)
  expect((await ui.find({ type: 'Text', text: /Run the tests/ }))?.text).toMatch(/^✕ Shell +↳ explore auth · Run the tests {2}exit 1/)
  expect((await ui.find({ type: 'Text', text: /auth\.py/ }))?.text).toMatch(/^· Files +↳ explore auth · b\/auth\.py/)
  // Its dot at Agents turns red.
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/<circle [^>]*r="3" fill="#e8654f"\/>/)
  await ui.unmount()
})

test("a subagent's name is cut by characters, never through one", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a2' }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.agent.spawn({ prompt: 'x', description: `${'a'.repeat(23)}🙂 and more` } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/b/x.py', agentId: 'a2' } as never)
  expect((await ui.find({ type: 'Text', text: /x\.py/ }))?.text).toContain(`↳ ${'a'.repeat(23)}🙂 · b/x.py`)
  await ui.unmount()
})

test('a subagent never seen at agent.spawn still marks its dot, and its rows carry no name', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('tool.call', () => ({ result: {}, isError: true, text: 'Exit code 3' }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build it', agentId: 'w7' } as never)
  expect((await ui.find({ type: 'Text', text: /Build it/ }))?.text).toMatch(/^✕ Shell +Build it {2}exit 3/)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toMatch(/<circle [^>]*r="3" fill="#e8654f"\/>/)
  await ui.unmount()
})

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

/** A tool that answers only when `release` is called. */
function heldTool(on: On): { release: (answer?: object) => void } {
  const held: { release: (answer?: object) => void } = { release: () => {} }
  on('tool.call', () => new Promise(resolve => (held.release = answer => resolve(answer ?? { result: {} }))) as never)
  return held
}

type Called = { tool: { check: (input: never) => Promise<unknown>; run: (input: never) => Promise<unknown> } }

/**
 * A permission prompt. The call's own check allows and its run is held open; a release with `text` makes the tool fail; `ask` then answers a check with ask, and
 * `settle` is a run that answers at once, as the engine's does once the person has approved.
 */
function askedCall(on: On): { release: (answer?: object) => void; ask: ($: Called) => Promise<unknown>; settle: ($: Called) => Promise<unknown> } {
  let asking = false
  let settling = false
  let failure = ''
  const held = { release: (_answer?: object) => {} }
  on('tool.check', () => ({ decision: asking ? 'ask' : 'allow' }) as never)
  on('tool.judge', () => ({ decision: 'allow' }) as never)
  on('tool.run', () => {
    if (settling) return { result: {} } as never
    return new Promise((resolve, reject) => {
      held.release = answer => {
        if (answer && 'text' in answer) {
          failure = String(answer.text)
          reject(new Error(failure))
        } else resolve(answer ?? { result: {} })
      }
    }) as never
  })
  // A run that fails falls through to the tool's own answer: an error.
  on('tool.call', () => ({ result: {}, isError: true, text: failure }) as never)
  return {
    release: answer => held.release(answer),
    ask: $ => {
      asking = true
      return $.tool.check(ASK as never)
    },
    settle: async $ => {
      settling = true
      await $.tool.run(SHELL as never)
      settling = false
    },
  }
}

/** Whether the map says it needs you. */
const isWaiting = async (ui: { find: (q: object) => Promise<{ props: Record<string, unknown> } | undefined> }) =>
  String((await ui.find({ type: 'Svg' }))?.props.source).includes('>needs you<')

const SHELL = { tool: 'Bash', command: 'make build', description: 'Build it', tool_use_id: 'u1' } as never
const ASK = { tool: 'Bash', input: { command: 'make build', description: 'Build it' }, tool_use_id: 'u1' } as never

test('a permission prompt left a second reads as needs you, and clears when the call runs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const held = askedCall(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(999)
  expect(await isWaiting(ui)).toBe(false)
  expect(await ui.find({ type: 'Text', text: /^Needs you: / })).toBeUndefined()
  await clock.advance(1)
  await clock.settle()
  expect(await isWaiting(ui)).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Needs you: / }))?.text).toMatch(/^Needs you: permission for Shell: Build it · /)
  await held.settle($)
  expect(await isWaiting(ui)).toBe(false)
  held.release()
  await calling
  await ui.unmount()
})

test('an ask settled at once never shows', { options: { notify: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const notes: string[] = []
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'client' } } as never
  })
  const held = askedCall(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(5)
  await held.settle($)
  for (let ms = 0; ms < 2000; ms += 100) {
    await clock.advance(100)
    expect(await isWaiting(ui)).toBe(false)
  }
  expect(notes).toEqual([])
  held.release()
  await calling
  await ui.unmount()
})

test("auto mode's classifier settles the ask, not the person", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const held = askedCall(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(300)
  await $.tool.judge(ASK)
  await clock.advance(1700)
  expect(await isWaiting(ui)).toBe(false)
  held.release()
  await calling
  await ui.unmount()
})

test('a permission prompt left unanswered notifies once', { options: { notify: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const notes: string[] = []
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'client' } } as never
  })
  const held = askedCall(on)
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(5000)
  await clock.settle()
  expect(notes).toEqual(['Needs you: permission for Shell: Build it'])
  held.release()
  await calling
})

test('a second ask for one call notifies once', { options: { notify: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const notes: string[] = []
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'client' } } as never
  })
  const held = askedCall(on)
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(300)
  await held.ask($)
  await clock.advance(3000)
  await clock.settle()
  expect(notes).toEqual(['Needs you: permission for Shell: Build it'])
  held.release()
  await calling
})

test('a refused ask closes as blocked, not waiting', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const held = askedCall(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(1500)
  await clock.settle()
  held.release({ deny: 'no' })
  await calling
  await clock.settle()
  expect(await isWaiting(ui)).toBe(false)
  expect((await ui.find({ type: 'Text', text: /Build it/ }))?.text).toMatch(/^⊘ Shell/)
  await ui.unmount()
})

test("a person's no, an error answer after an unsettled ask, closes as blocked", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const held = askedCall(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(1500)
  await clock.settle()
  held.release({ isError: true, text: "The user doesn't want to proceed" })
  await calling
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /Build it/ }))?.text).toMatch(/^⊘ Shell/)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('1 refused')
  await ui.unmount()
})

test('a call that ran after the ask and then failed stays an error', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const held = askedCall(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(1500)
  await clock.settle()
  await held.settle($)
  held.release({ isError: true, text: 'Exit code 1' })
  await calling
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /Build it/ }))?.text).toMatch(/^✕ Shell/)
  await ui.unmount()
})

test('a call allowed after a long permission prompt runs long only from when it was allowed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const t = stringsFor('en')
  const kept = keepBoard(on as never)
  const held = askedCall(on)
  for (const id of ['d1', 'd2', 'd3']) {
    const done = $.tool.call({ tool: 'Bash', command: 'make lint', description: 'Lint', tool_use_id: id } as never)
    await clock.advance(1000)
    held.release()
    await done
  }
  const calling = $.tool.call(SHELL)
  await clock.settle()
  await held.ask($)
  await clock.advance(120_000)
  await held.settle($)
  const lines = () => warningsOf(kept.board, clock.now(), t).map(w => w.line)
  expect(lines()).toEqual([])
  await clock.advance(61_000)
  expect(lines()).toEqual([t.runningLong('Shell', 'Build it', '1 min 1 s', '1.0 s')])
  held.release()
  await calling
})

test('a question or a plan for the person makes the session wait on them, and the top line says for how long', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const held = heldTool(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.settle()
  await clock.advance(65_000)
  expect((await ui.find({ type: 'Text', text: /^Needs you: / }))?.text).toMatch(/^Needs you: question for you · 1 min 5 s/)
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('>needs you<')
  held.release()
  await asking
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /^Needs you: / })).toBeUndefined()

  // A plan waiting for approval is the person's too, not a shell command.
  const planning = $.tool.call({ tool: 'ExitPlanMode', plan: 'x' } as never)
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /^Needs you: / }))?.text).toMatch(/^Needs you: plan for your approval/)
  held.release()
  await planning
  await ui.unmount()
})

test('a finished turn reads as your turn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(30_000)
  expect((await ui.find({ type: 'Text', text: /your turn/ }))?.text).toMatch(/^Done 30 s ago · your turn/)
  // Past a minute it counts whole minutes.
  await clock.advance(95_000)
  expect((await ui.find({ type: 'Text', text: /your turn/ }))?.text).toMatch(/^Done 2 min ago · your turn/)
  await ui.unmount()
})

test('with notify on, a wait and a finished turn each notify once; with it off, never', { options: { notify: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const notes: string[] = []
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'client' } } as never
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  const held = heldTool(on)
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.settle()
  held.release()
  await asking
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  expect(notes).toEqual(['Needs you: question for you', 'Done: your turn'])
})

test('with notify off nothing is notified', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let notified = 0
  on('ui.notify', () => {
    notified++
    return { value: { isSent: true, channel: 'client' } } as never
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.settle()
  expect(notified).toBe(0)
})

test("every cell of the terminal map is one narrow glyph, and the terminal's own color is only ever a background", () => {
  const faults: string[] = []
  for (const options of [{}, { theme: 'light', layout: 'you-bottom' }, { background: 'transparent', language: 'ru' }, { coreName: '中文🙂ab' }]) {
    const setup = setupFrom(options)
    for (const later of [0, 300, 900, 5_000, 70_000]) {
      const words = wordsOf(paintMap(BUSY, NOW + later, setup, 60, 28))
      if (words.length !== 60 * 28 * 3) faults.push(`${words.length} words`)
      for (let k = 0; k < words.length; k += 3) {
        const [cp = 0, fg = 0, bg = 0] = [words[k], words[k + 1], words[k + 2]]
        if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp > 0xffff || (cp >= 0x300 && cp < 0x370) || (cp >= 0x1100 && cp < 0x2010)) faults.push(`glyph ${cp.toString(16)}`)
        if (fg >>> 24 !== 0) faults.push(`foreground ${fg.toString(16)}`)
        if (bg >>> 24 > 1) faults.push(`background ${bg.toString(16)}`)
      }
    }
  }
  expect(faults.slice(0, 5)).toEqual([])
  const wide = linesOf(paintMap(BUSY, NOW, setupFrom({ coreName: '中文🙂ab' }), 60, 28), 60).join('\n')
  expect(wide).toContain('···ab')
  expect(wide).not.toContain('中')
})

test('the terminal map names each station with its count, the core with its model and context, and a fault in red', () => {
  const cells = paintMap(BUSY, NOW, setupFrom({ theme: 'dark' }), 60, 28)
  const text = linesOf(cells, 60).join('\n')
  for (const label of ['You 3', 'Model 14', 'Memory 3 ↓2', 'Files 9', 'Shell 6', 'Network 3', 'Agents 1', 'Hooks 2', 'Browser', 'Skills', 'CLAUDE', 'opus 5.5', '74%', '×2']) {
    expect(text).toContain(label)
  }
  const words = wordsOf(cells)
  let isRedOne = false
  for (let k = 0; k < words.length; k += 3) if (words[k] === 0x31 && words[k + 2] === 0xe8654f) isRedOne = true
  expect(isRedOne).toBe(true)
})

test('the terminal map moves while something flies and only breathes when nothing does', () => {
  const setup = setupFrom({})
  const quiet: Board = { entries: [at('files', 90_000)], counts: { files: 1 } }
  expect(paceOf(BUSY, NOW)).toBe(40)
  expect(paceOf({ ...quiet, entries: [at('shell', 5_000, { status: 'run', endedAt: undefined })] }, NOW)).toBe(90)
  expect(paceOf(quiet, NOW)).toBe(250)
  // A pulse in flight is somewhere else a few frames later; a quiet map changes only with its breath.
  expect(paintMap(BUSY, NOW + 40, setup, 60, 28)).not.toBe(paintMap(BUSY, NOW + 160, setup, 60, 28))
  expect(paintMap(quiet, NOW, setup, 60, 28)).toBe(paintMap(quiet, NOW + 4_800, setup, 60, 28))
})

test('in a terminal the map is drawn in cells above the rows, and a narrow pane keeps the rows alone', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const map = await ui.find({ type: 'Raster' })
  expect(map?.props.columns).toBe(60)
  expect(map?.props.rows).toBe(28)
  const text = linesOf(String(map?.props.cells), 60).join('\n')
  expect(text).toContain('Файлы 1')
  expect(text).toContain('ДОМ')
  expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Файлы')
  await ui.unmount()

  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 26 }, surface: 'terminal' })
  expect(await narrow.find({ type: 'Raster' })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /Файлы 1/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /Расширьте панель до 46 столбцов/ })).toBeDefined()
  await narrow.unmount()

  const inline = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 168, placement: 'inline', scroll: { offset: 0, bodyRows: 22 } }, surface: 'terminal' })
  const beside = await inline.find({ type: 'Raster' })
  expect([beside?.props.columns, beside?.props.rows]).toEqual([47, 22])
  expect((await inline.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Файлы')
  await inline.unmount()
})

test('with the terminal map turned off a terminal shows the rows and a line of counts', { options: { terminalMap: false } }, async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 26 }, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Files 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Widen the pane/ })).toBeUndefined()
  await ui.unmount()
})

test('between drawings a timer paints the next frames into the mounted map, seldom once nothing flies', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('tool.call', () => ({ result: {} }))
  const frames: string[] = []
  on('ui.blit', (_, e) => {
    if ('cells' in e) frames.push(e.cells)
    return { value: {} }
  })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const first = String((await ui.find({ type: 'Raster' }))?.props.cells)

  await clock.advance(400)
  expect(frames.length).toBeGreaterThan(3)
  expect(new Set(frames).size).toBe(frames.length)
  expect(frames).not.toContain(first)

  // Once the pulse has landed and the glow is gone, only the core's breath is left to paint.
  await clock.advance(5_000)
  const before = frames.length
  await clock.advance(1_000)
  expect(frames.length - before).toBeLessThan(6)
  await ui.unmount()
})

/** A renderer that says it is ready, then writes the frames it is told to, and stays until `end` is called. */
function fakeRenderer(on: On, dir = '/tmp/lot-map-test') {
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

test('in a terminal that shows pictures the map is the drawing a renderer paints, each new frame swapped in place', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { TERM: 'xterm-kitty' })
  on('tool.call', () => ({ result: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const swapped: number[] = []
  on('ui.blit', (_, e) => {
    if ('source' in e && 'generation' in e.source) swapped.push(e.source.generation ?? 0)
    return { value: {} }
  })
  const renderer = fakeRenderer(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  expect(renderer.spawned[0]?.[0]).toBe('node')
  expect(renderer.spawned[0]?.[1]).toMatch(/renderer\/render\.mjs$/)
  // Until the first frame the map stays in cells, and the renderer is handed the map at the box's size.
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(written.at(-1)?.path).toBe('/tmp/lot-map-test/map.svg')
  expect(written.at(-1)?.text).toMatch(/^<svg [^>]*width="720" height="672"/)
  expect(written.at(-1)?.text).toContain('Files')

  renderer.say('frame 1')
  await clock.settle()
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.source).toEqual({ file: '/tmp/lot-map-test/frame.png', format: 'png', generation: 1 })
  expect([image?.props.columns, image?.props.rows]).toEqual([60, 28])
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /b\/content\.py/ }))?.text).toContain('Files')

  renderer.say('frame 2')
  renderer.say('frame 3')
  await clock.settle()
  expect(swapped).toEqual([2, 3])
  renderer.end()
  await clock.settle()
  await ui.unmount()
})

test('a terminal that shows the picture as words gets the map in cells for good, and so does one that shows no pictures', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { TERM: 'xterm-kitty' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.blit', (_, e) => ('source' in e ? { deny: 'the Image draws its alt here: no placeholder images' } : { value: {} }))
  const renderer = fakeRenderer(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  renderer.say('frame 1')
  await clock.settle()
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  renderer.say('frame 2')
  await clock.settle()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  renderer.end()
  await clock.settle()
  await ui.unmount()
})

test('pictures stay off where the terminal shows none or the option says off', { options: { terminalPicture: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { TERM: 'xterm-kitty' })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const renderer = fakeRenderer(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  expect(renderer.spawned).toEqual([])
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  renderer.end()
  await ui.unmount()
})

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

test('/lot-map window keeps the live map for a window of its own and opens it beside the session in Windows Terminal', async ($, on) => {
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
  const answer = await $.command.run({ command: 'lot-map', args: 'window' } as never)
  expect(answer.text).toBe('Map window opened beside this one.')
  const wt = runs.find(argv => argv[0] === 'wt.exe') ?? []
  const dir = wt.at(-1) ?? ''
  expect(dir).toMatch(/^\/tmp\/lot-map-live-[a-z0-9]+$/)
  // The pane starts with a bare PATH: node and Chromium go in as found in the session.
  expect(wt.slice(0, 14)).toEqual([
    'wt.exe',
    '-w',
    '0',
    'split-pane',
    '--vertical',
    '--size',
    '0.45',
    'wsl.exe',
    '-d',
    'Ubuntu',
    '--',
    'env',
    'LOT_MAP_CHROMIUM=/home/u/.local/bin/chromium',
    '/usr/bin/node',
  ])
  expect(wt[14]).toMatch(/\/renderer\/view\.mjs$/)
  const maps = () => written.filter(w => w.path === `${dir}/map.svg`)
  expect(maps().length).toBe(1)
  expect(maps()[0]?.text).toMatch(/^<svg [^>]*width="920" height="860"/)
  expect(written.some(w => w.path === `${dir}/alive`)).toBe(true)
  // The rows under the map go with it, as the pane writes them.
  const feed = JSON.parse(written.find(w => w.path === `${dir}/feed.json`)?.text ?? '{}')
  expect(feed.rows).toEqual([{ line: '· Files    b/content.py', tone: 'ok' }])
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

test('outside Windows Terminal /lot-map window says how to open the window by hand, and /lot-map still opens the pane', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { TMPDIR: '/tmp' })
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const answer = await $.command.run({ command: 'lot-map', args: 'window' } as never)
  expect(answer.text).toMatch(
    /^Run this in a pane of a terminal that shows Sixel pictures: env LOT_MAP_CHROMIUM=\/home\/u\/\.local\/bin\/chromium \/usr\/bin\/node \S+\/renderer\/view\.mjs \/tmp\/lot-map-live-[a-z0-9]+$/,
  )
  expect(runs.some(argv => argv[0] === 'wt.exe')).toBe(false)
  expect((await $.command.run({ command: 'lot-map', args: '' } as never)).text).toBe('Work map opened.')
  await $.session.end({ reason: 'other' } as never)
})

test('/workmap does what /lot-map does', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { TMPDIR: '/tmp' })
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  const names: string[] = []
  on('command.register', (_, e) => {
    names.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(names).toEqual(['lot-map', 'workmap'])
  expect((await $.command.run({ command: 'workmap', args: '' } as never)).text).toBe('Work map opened.')
  expect((await $.command.run({ command: 'workmap', args: 'window' } as never)).text).toMatch(/^Run this in a pane of a terminal that shows Sixel pictures: /)
  expect(runs.some(argv => argv[0] === 'wt.exe')).toBe(false)
  await $.session.end({ reason: 'other' } as never)
})

test("/workmap help and /lot-map help answer the legend in the session's language", { options: { language: 'ru' } }, async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const answer = String((await $.command.run({ command: 'workmap', args: 'help' } as never)).text)
  expect(answer.split('\n')).toEqual(stringsFor('ru').legend)
  expect(answer).toContain('Память')
  expect((await $.command.run({ command: 'lot-map', args: 'help' } as never)).text).toBe(answer)
  for (const language of ['en', 'ru', 'es', 'fr', 'de', 'it', 'pt']) expect(stringsFor(language).legend.length).toBe(15)
})

test("the count keeps the session's errors and shows what this turn added", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  const answers: unknown[] = [{ result: {} }, { result: {}, isError: true, text: 'Exit code 1' }]
  on('tool.call', () => (answers.shift() ?? { result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  await $.turn.start({ text: 'first', turnId: 't1' } as never)
  for (const command of ['make a', 'make b', 'make c']) await $.tool.call({ tool: 'Bash', command, description: command } as never)
  // The first turn's count is all of it.
  expect(await svg()).not.toMatch(/\+3/)
  await $.turn.start({ text: 'second', turnId: 't2' } as never)
  for (const command of ['make d', 'make e']) await $.tool.call({ tool: 'Bash', command, description: command } as never)
  const drawn = await svg()
  expect(drawn).toContain('5<tspan')
  // The turn's share is fainter than the count.
  expect(drawn).toContain('<tspan fill-opacity="0.55"> +2</tspan>')
  expect(drawn).toContain('1✕')
  // The red badge went with the message; the session's error stayed.
  expect(drawn).not.toMatch(/r="7\.5" fill="#[0-9a-f]{6}"\/>/)
  expect(drawn).toContain('<title>Shell: 5 calls this session · 2 this turn · 1 error in this session</title>')
  await ui.unmount()
})

test('every legend line is short, and holds no control character', () => {
  for (const language of ['en', 'ru', 'es', 'fr', 'de', 'it', 'pt']) {
    for (const line of stringsFor(language).legend) {
      expect(line.length).toBeLessThanOrEqual(110)
      expect(/[\u0000-\u001f\u007f-\u009f]/.test(line)).toBe(false)
    }
  }
})

test('a first turn shows no +N, its count being all of it', () => {
  const board: Board = { entries: [], counts: { shell: 4 }, turnCounts: { shell: 4 } }
  expect(drawMap(board, NOW, setupFrom({}))).not.toContain('+4')
  expect(drawMap({ ...board, turnCounts: { shell: 1 } }, NOW, setupFrom({}))).toContain('+1')
})

test('the count line in cells never passes ten cells', () => {
  const board: Board = { entries: [], counts: { shell: 999, files: 9 }, turnCounts: { shell: 99, files: 3 }, faultTotals: { shell: 99, files: 2 } }
  const text = linesOf(paintMap(board, NOW, setupFrom({}), 60, 28), 60).join('\n')
  // 999 and a turn of 99 and 99 errors: the turn's share goes first, the errors stay.
  expect(text).toMatch(/Shell 999 99✕/)
  expect(text).not.toContain('+99')
  // Room enough for all of it.
  expect(text).toMatch(/Files 9 \+3 2✕/)
})

test('the line of counts with no map names the errors of the session', { options: OWN }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: {}, isError: true, text: 'Exit code 1' }) as never)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 26 }, surface: 'terminal' })
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build it' } as never)
  expect(await ui.find({ type: 'Text', text: /Терминал 1 · 1✕/ })).toBeDefined()
  await ui.unmount()
})

test('each station carries a title for hovering: its calls, its errors and its refusals', () => {
  const svg = drawMap({ ...BUSY, blocks: { shell: 2 } }, NOW, setupFrom({}))
  expect(svg.match(/<title>/g)?.length).toBe(10)
  expect(svg).toContain('<title>Shell: 6 calls this session · 2 refused</title>')
  expect(svg).toContain('<title>Hooks: 2 calls this session · 1 error since your last message</title>')
})

test('the window gives the map its room before the list, down to twelve rows', () => {
  const cell = { w: 10, h: 20 }
  // The split beside a session in a window 31 rows tall: the map took 12 rows before, the list 18.
  expect(layout({ cols: 53, rows: 31, cell, listRows: 10, view: 'both' })).toMatchObject({ mapRows: 19, listTop: 21, listRows: 10 })
  // A tall pane: the map as wide as the pane, the list under it.
  const tall = layout({ cols: 90, rows: 50, cell, listRows: 10, view: 'both' })
  expect(tall.w).toBeLessThanOrEqual(900)
  expect(tall.listRows).toBe(10)
  // A short one: the map keeps twelve rows, and the list what is left.
  expect(layout({ cols: 53, rows: 20, cell, listRows: 10, view: 'both' })).toMatchObject({ mapRows: 12, listTop: 14, listRows: 6 })
  expect(layout({ cols: 53, rows: 13, cell, listRows: 10, view: 'both' }).listRows).toBe(0)
  // Shorter than twelve rows the map stays inside the window, above the hint: a taller picture would scroll it.
  for (const rows of [6, 8, 10, 12]) expect(layout({ cols: 53, rows, cell: { w: 8, h: 17 }, listRows: 10, view: 'both' }).mapRows).toBeLessThanOrEqual(rows - 1)
})

test('the window shows the map alone, or the list alone', () => {
  const cell = { w: 10, h: 20 }
  const map = layout({ cols: 53, rows: 31, cell, listRows: 10, view: 'map' })
  expect(map.mapRows).toBeGreaterThan(19)
  expect(map.listRows).toBe(0)
  expect(layout({ cols: 53, rows: 31, cell, listRows: 10, view: 'list' })).toMatchObject({ w: 0, h: 0, mapRows: 0, listTop: 1, listRows: 30 })
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
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  return panes
}

test('in Windows Terminal the map is a window: no pane, and the window opens beside the session when the person first writes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, IN_WINDOWS_TERMINAL)
  const runs = fakeHost(on)
  const splits = () => runs.filter(argv => argv[0] === 'wt.exe')
  on('fs.write', () => ({ value: undefined }))
  // The window's own heartbeat, while it shows the map.
  let shownAt: number | undefined
  on('fs.stat', (_, e) => (e.path.endsWith('/shown') && shownAt !== undefined ? { value: { kind: 'file', size: 13, mtimeMs: shownAt, isLink: false } } : { deny: 'ENOENT' }))
  const panes = fakeSession(on)

  // A session can start with no one looking, as one in the background does: nothing opens yet.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(panes).toEqual([])
  expect(splits()).toEqual([])

  // The person writes: their tab is the one in front, and the window splits it, once.
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await clock.settle()
  expect(splits().length).toBe(1)
  await $.turn.start({ text: 'and again', turnId: 't2' } as never)
  await clock.settle()
  expect(splits().length).toBe(1)

  // /lot-map opens the window, not the pane, and no second one while the first shows the map.
  shownAt = clock.now()
  expect((await $.command.run({ command: 'lot-map', args: '' } as never)).text).toBe('The map window is already open beside this one.')
  expect(splits().length).toBe(1)
  // Closed with q, its heartbeat stops: /lot-map opens it again.
  shownAt = clock.now() - 60_000
  expect((await $.command.run({ command: 'lot-map', args: '' } as never)).text).toBe('Map window opened beside this one.')
  expect(splits().length).toBe(2)
  expect(panes).toEqual([])
  await $.session.end({ reason: 'other' } as never)
})

test('with terminalWindow off Windows Terminal keeps the pane', { options: { terminalWindow: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, IN_WINDOWS_TERMINAL)
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  const panes = fakeSession(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await clock.settle()
  expect(panes).toEqual(['lot-map'])
  expect(runs.some(argv => argv[0] === 'wt.exe')).toBe(false)
  await $.session.end({ reason: 'other' } as never)
})

test('when the window cannot open the pane opens instead', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, IN_WINDOWS_TERMINAL)
  const runs: string[][] = []
  on('session.end', () => ({ sessionId: 'test' }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: e.argv[0] === 'wt.exe' ? 1 : 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', () => ({ value: undefined }))
  const panes = fakeSession(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(panes).toEqual([])
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await clock.settle()
  expect(runs.some(argv => argv[0] === 'wt.exe')).toBe(true)
  expect(panes).toEqual(['lot-map'])
  await $.session.end({ reason: 'other' } as never)
})

test('a terminal that shows pictures keeps its pane, from WSL as well', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { ...IN_WINDOWS_TERMINAL, TERM: 'xterm-kitty' })
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  const panes = fakeSession(on)
  const renderer = fakeRenderer(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  expect(panes).toEqual(['lot-map'])
  expect(runs.some(argv => argv[0] === 'wt.exe')).toBe(false)
  renderer.end()
  await $.session.end({ reason: 'other' } as never)
})

test('a map the terminal no longer holds stops asking to be painted', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('tool.call', () => ({ result: {} }))
  let asked = 0
  on('ui.blit', () => {
    asked++
    return { deny: 'nothing of this plugin is mounted there' }
  })
  await $.tool.call({ tool: 'Read', file_path: '/a/b/content.py' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.unmount()
  await clock.advance(30_000)
  const settled = asked
  expect(settled).toBeGreaterThan(0)
  expect(settled).toBeLessThan(25)
  await clock.advance(30_000)
  expect(asked).toBe(settled)
})

test('guardedHooks is on unless switched off, in either spelling', () => {
  expect(setupFrom({}).guardedHooks).toBe(true)
  expect(setupFrom({ guardedHooks: 'nonsense' }).guardedHooks).toBe(true)
  expect(setupFrom({ guardedHooks: false }).guardedHooks).toBe(false)
  expect(setupFrom({ guardedHooks: 'false' }).guardedHooks).toBe(false)
})

test('with guardedHooks off no hook of the five leaves a row, and a refused call reads as failed', { options: { ...OWN, guardedHooks: false } }, async ($, on) => {
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
})

test('with guardedHooks off a sharp fall of the context marks a compaction, and a /clear does not', { options: { ...OWN, guardedHooks: false } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'test' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  let kept: Board = { entries: [], counts: {} }
  on('state.set', ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept = e.value?.value ?? kept), next(e))) as never)
  const marks = () => kept.entries.filter(e => e.station === 'model' && e.label === SETUP.t.compacted)
  const measure = (percent: number) => $.session.measure({ context: { percent }, rateLimits: [], changed: ['context'] } as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await measure(80)
  await measure(60)
  expect(marks()).toHaveLength(0)
  await measure(20)
  expect(marks().map(e => e.status)).toEqual(['ok'])

  // A /clear raises session.end alone: the reset is there.
  await measure(80)
  await $.session.end({ reason: 'clear' } as never)
  await measure(0)
  expect(marks()).toHaveLength(1)
})

test('with guardedHooks off a switch to a model with a larger window is no compaction', { options: { ...OWN, guardedHooks: false } }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  const kept = keepBoard(on as never)
  const measure = (percent: number, window: number) => $.session.measure({ context: { percent, window }, rateLimits: [], changed: ['context'] } as never)
  await measure(80, 200_000)
  await measure(16, 1_000_000)
  expect(kept.board.entries.filter(e => e.label === SETUP.t.compacted)).toHaveLength(0)
  await measure(90, 1_000_000)
  await measure(20, 1_000_000)
  expect(kept.board.entries.filter(e => e.label === SETUP.t.compacted)).toHaveLength(1)
})

test('with guardedHooks on no row comes from session.measure', { options: OWN }, async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  let kept: Board = { entries: [], counts: {} }
  on('state.set', ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept = e.value?.value ?? kept), next(e))) as never)
  await $.session.measure({ context: { percent: 80 }, rateLimits: [], changed: ['context'] } as never)
  await $.session.measure({ context: { percent: 10 }, rateLimits: [], changed: ['context'] } as never)
  expect(kept.entries.filter(e => e.label === SETUP.t.compacted)).toHaveLength(0)
})

const keepBoard = (on: (event: 'state.set' | 'session.measure', hook: never) => void) => {
  const kept: { board: Board } = { board: { entries: [], counts: {} } }
  on(
    'state.set',
    ((_: unknown, e: { value?: { value?: Board } }, next: (e: unknown) => unknown) => ((kept.board = e.value?.value ?? kept.board), next(e))) as never,
  )
  on('session.measure', ((_: unknown, e: { changed: unknown }) => ({ changed: e.changed })) as never)
  return kept
}
const arcs = (svg: string) =>
  [...svg.matchAll(/<circle [^>]*stroke-width="1\.2"[^>]*r="(\d+)"[^>]*>|<circle [^>]*r="(\d+)"[^>]*stroke-width="1\.2"[^>]*>/g)].filter(
    m => Number(m[1] ?? m[2] ?? 0) >= 49,
  )

test('the rate-limit windows and the cost show around the core', async ($, on) => {
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
  const svg = drawMap({ ...kept.board, context: 95 }, 1_000_000, SETUP)
  const found = arcs(svg)
  expect(found).toHaveLength(4)
  const stroke = (m: RegExpMatchArray | undefined) => /stroke="(#[0-9a-fA-F]+|[^"]+)"/.exec(m?.[0] ?? '')?.[1]
  const contextRing = /<circle [^>]*r="45"[^>]*stroke="([^"]+)" pathLength="100" stroke-dasharray="95 100"/.exec(svg)?.[1]
  const fiveHour = found.filter(m => /pathLength/.test(m[0]))[0]
  expect(stroke(fiveHour)).toBe(contextRing)
  expect(svg).toContain(`<title>${SETUP.t.limitTitle('five_hour', 92, SETUP.t.hoursMinutes(2, 10))}</title>`)
  expect(svg).toContain('>$1.23<')
  expect(svg).toContain(`<title>${SETUP.t.estimatedCost('$1.23')}</title>`)
  expect(stringsFor('en').legend.some(line => line.includes('$') && line.includes('estimate'))).toBe(true)
  expect(drawMap({ ...kept.board, limits: [{ kind: 'seven_day', percent: 40.6 }] }, 1_000_000, SETUP)).toContain(SETUP.t.limitTitle('seven_day', 41))
})

test('/workmap usage answers the context, the windows and the cost', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  keepBoard(on as never)
  const category = (name: string, tokens: number, kind = 'used') => ({ name, tokens, color: 'x', isDeferred: false, kind })
  on(
    'session.usage',
    () =>
      ({
        value: {
          startedAt: 0,
          context: {
            window: 200000,
            tokens: 74000,
            percent: 37,
            breakdown: {
              rawMaxTokens: 200000,
              maxTokens: 200000,
              categories: [category('System prompt', 20000), category('Messages', 54000), category('Skills', 0)],
            },
          },
        },
      }) as never,
  )
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { percent: 37 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: new Date(1_000_000 + 130 * 60_000).toISOString() }],
    cost: { usd: 1.234 },
    changed: ['rateLimits'],
  } as never)
  const lines = String((await $.command.run({ command: 'workmap', args: 'usage' } as never)).text).split('\n')
  expect(lines[0]).toBe('Context: 37% · 74k of 200k tokens')
  expect(lines).toContain('System prompt: 10%')
  expect(lines).toContain('Messages: 27%')
  expect(lines.some(l => l.startsWith('Skills'))).toBe(false)
  expect(lines).toContain('Five-hour 92% · resets in 2 h 10 min')
  expect(lines.at(-1)).toBe('Cost so far, an estimate: $1.23')
})

test('/workmap usage still answers the windows and the cost when the engine cannot give the breakdown', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  keepBoard(on as never)
  on('session.usage', () => {
    throw new Error('no session')
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({
    context: { percent: 37 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 40 }],
    cost: { usd: 2 },
    changed: ['rateLimits'],
  } as never)
  expect(String((await $.command.run({ command: 'workmap', args: 'usage' } as never)).text).split('\n')).toEqual([
    'Weekly 40%',
    'Cost so far, an estimate: $2.00',
  ])
})

test('the terminal map paints the rate-limit arcs and the cost at the dock size, and nothing without them', () => {
  const setup = setupFrom({ theme: 'dark' })
  const bare: Board = { entries: [], counts: {} }
  const gauged: Board = { ...bare, limits: [{ kind: 'five_hour', percent: 92 }], cost: 1.234 }
  const isRed = (cells: string): boolean => {
    const words = wordsOf(cells)
    for (let k = 1; k < words.length; k++)
      if (k % 3 !== 0 && ((words[k] ?? 0) >> 16) - ((words[k] ?? 0) & 0xff) > 50 && ((words[k] ?? 0) >> 16) - (((words[k] ?? 0) >> 8) & 0xff) > 50) return true
    return false
  }
  const plain = paintMap(bare, NOW, setup, 60, 22)
  const drawn = paintMap(gauged, NOW, setup, 60, 22)
  expect(isRed(plain)).toBe(false)
  expect(isRed(drawn)).toBe(true)
  expect(linesOf(drawn, 60).join('\n')).toContain('$1.23')
  expect(linesOf(plain, 60).join('\n')).not.toMatch(/\$\d/)
  expect(linesOf(paintMap({ ...bare, cost: 0.004 }, NOW, setup, 60, 22), 60).join('\n')).not.toMatch(/\$\d/)
})

test('with no rate limits and no cost, nothing new is drawn', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  const kept = keepBoard(on as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 } } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { percent: 10 }, rateLimits: [], changed: ['context'] } as never)
  expect(kept.board.limits ?? []).toEqual([])
  const svg = drawMap({ ...kept.board, context: 10 }, 1_000_000, SETUP)
  expect(arcs(svg)).toHaveLength(0)
  expect(svg).not.toContain('$')
  expect(drawMap({ ...kept.board, cost: 0.004 }, 1_000_000, SETUP)).not.toContain('$0')
  expect((await $.command.run({ command: 'workmap', args: 'usage' } as never)).text).toBe(stringsFor('en').usageNothing)
})

test('a session that starts with no surface opens its pane when one attaches', async ($, on) => {
  const opens: string[] = []
  on('clock.now', () => ({ value: 1_000_000 }))
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.surfaces', () => ({ value: [] }) as never)
  on('ui.open', (_, e) => {
    opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }) as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens).toEqual([])
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  expect(opens).toEqual(['lot-map'])
})

test('the browser reached from a cloud session lands on Browser, with a label like the local one', () => {
  const seen = (tool: string, input: Record<string, unknown>) => classify(tool, input, STRANGER)
  expect(seen('mcp__remote-devices__Claude_Browser__navigate', { url: 'https://user:private@a.b/x?q=1' })).toEqual({ station: 'browser', label: 'a.b' })
  expect(seen('mcp__remote-devices__Claude_Browser__get_page_text', {})).toEqual({ station: 'browser', label: 'get page text' })
  expect(seen('mcp__remote-devices__Claude_Browser__computer', { action: 'type', text: 'private' })).toEqual({ station: 'browser', label: 'computer' })
  // Only the browser: the server's other tools stay where they were.
  expect(seen('mcp__remote-devices__computer_screenshot', {}).station).toBe('web')
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
    'ListMcpResourcesTool',
    'ReadMcpResourceTool',
    'ReadMcpResourceDirTool',
  ])
    expect(seen(tool)).toBe(`web ${tool}`)

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
    expect(seen(tool, 'github')).toBe(`web ${tool}`)
    // A server named in the person's options counts as theirs.
    expect(seen(tool, 'recall', SETUP)).toBe(`memory ${tool}`)
  }
  // Listing every server's resources names none: the call is no memory call.
  expect(classify('ListMcpResourcesTool', {}, STRANGER).station).toBe('web')
})

const stationOf = (command: string, tool = 'Bash') => classify(tool, { command }, STRANGER).station

test('a command inside a loop, a condition, a group or a negation is still the command', () => {
  expect(stationOf('for u in a b; do curl $u; done')).toBe('web')
  expect(stationOf('if curl -sf x; then echo ok; fi')).toBe('web')
  expect(stationOf('if test -f a; then echo ok; else wget x; fi')).toBe('web')
  expect(stationOf('while ! curl -sf x; do sleep 1; done')).toBe('web')
  expect(stationOf('until ping -c1 host; do sleep 1; done')).toBe('web')
  expect(stationOf('! curl x')).toBe('web')
  expect(stationOf('{ curl x; }')).toBe('web')
  expect(stationOf('(cd /tmp && curl x)')).toBe('web')
  // The words of the construct are no commands: a loop over files that only reads them is files.
  expect(stationOf('for f in *.md; do cat $f; done')).toBe('files')
  expect(stationOf('if grep -q x a.txt; then echo yes; fi')).toBe('files')
  expect(stationOf('while read line; do echo $line; done')).toBe('shell')
  expect(stationOf('for i in 1 2 3; do make test; done')).toBe('shell')
  // A file named like a keyword is an argument, not a construct.
  expect(stationOf('cat do then fi')).toBe('files')
})

test('a command handed to a shell, to eval or to watch is the command that counts', () => {
  expect(stationOf('bash -c "curl https://x.y"')).toBe('web')
  expect(stationOf("sh -c 'wget x'")).toBe('web')
  expect(stationOf('zsh -lc "git fetch && make"')).toBe('web')
  expect(stationOf('eval "curl x"')).toBe('web')
  expect(stationOf('watch -n 5 curl x')).toBe('web')
  expect(stationOf('find . -exec sh -c "curl x" ;')).toBe('web')
  expect(stationOf('sudo bash -c "apt-get update && apt-get install -y jq"')).toBe('web')
  expect(stationOf("bash -c 'cat a | sort'")).toBe('files')
  expect(stationOf('bash -c "make build"')).toBe('shell')
  // A script is not a command line: what it does is not read.
  expect(stationOf('bash deploy.sh curl')).toBe('shell')
  // Shells inside shells stop being read at some depth, and nothing breaks.
  expect(stationOf(`bash -c "bash -c 'bash -c \\"bash -c curl\\"'"`)).not.toBe('files')
})

test('the text of a here-document is no command, whatever it says', () => {
  expect(stationOf('cat <<EOF > f\ncurl x\nEOF')).toBe('files')
  expect(stationOf("cat <<'EOF' > notes.md\nsome text\nwget y\nEOF")).toBe('files')
  expect(stationOf('cat <<-EOF > f\n\tcurl x\n\tEOF')).toBe('files')
  expect(stationOf('python3 - <<"PY"\nimport os\ncurl = 1\nPY')).toBe('shell')
  // What follows the here-document is read again.
  expect(stationOf('cat <<EOF > f\ntext\nEOF\ncurl x')).toBe('web')
  expect(stationOf('cat <<A > a; cat <<B > b\none\nA\ncurl\nB\nls')).toBe('files')
  // One that never ends is all text.
  expect(stationOf('cat <<EOF > f\ncurl x')).toBe('files')
  // A here-string is one word, and a shift is arithmetic.
  expect(stationOf('grep x <<< "curl"')).toBe('files')
  expect(stationOf('echo $((1 << 2)); curl x')).toBe('web')
  // PowerShell has no here-documents of this kind.
  expect(stationOf('Get-Content a.txt', 'PowerShell')).toBe('files')
})

test('a command line is read up to a length, and a long one costs no more than that', () => {
  // Past the first eight thousand characters nothing is read: the label and the station come from what stands before.
  const long = `ls ${'a'.repeat(9000)}; curl x`
  expect(stationOf(long)).toBe('files')
  expect(stationOf(`curl x; ls ${'a'.repeat(9000)}`)).toBe('web')
  const pipes = 'x|'.repeat(100_000)
  for (let i = 0; i < 3; i++) stationOf(pipes)
  const t0 = performance.now()
  stationOf(pipes)
  const ms = performance.now() - t0
  // The cap is asserted above; these bounds only catch a quadratic blow-up, so they are loose.
  expect(ms).toBeLessThan(500)
  const doc = `cat <<EOF > f\n${'line of text here\n'.repeat(11_000)}EOF\ncurl x`
  for (let i = 0; i < 3; i++) stationOf(doc)
  const t1 = performance.now()
  // The command after a long here-document is still seen.
  expect(stationOf(doc)).toBe('web')
  const docMs = performance.now() - t1
  expect(docMs).toBeLessThan(500)
})

test('more commands that reach the network are known by name or by subcommand', () => {
  for (const c of [
    'pip3.12 install x',
    'pip3 download x',
    'bun i',
    'yarn',
    'yarn --frozen-lockfile',
    'git submodule update --init',
    'git remote update',
    'svn checkout u',
    'hg clone u',
    'kubectl get pods',
    'aws s3 ls',
    'gcloud auth list',
    'az login',
    'terraform apply',
    'helm install x ./chart',
    'nmap host',
    'http GET x.y',
    'openssl s_client -connect x:443',
    'deno install',
  ]) {
    expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // The same programs at work on what is already here stay on Shell.
  for (const c of [
    'yarn build',
    'git submodule status',
    'git remote -v',
    'terraform fmt',
    'helm template .',
    'openssl sha256 a.bin',
    'deno run a.ts',
    'svn status',
    'bunx cowsay',
    'npx cowsay',
  ]) {
    expect([c, stationOf(c)]).toEqual([c, 'shell'])
  }
})

test('serverStations puts a server on each station the person may name, and the row still reads server: tool', () => {
  const put = (station: string) => setupFrom({ serverStations: [`srv=${station}`] })
  for (const station of ['files', 'shell', 'web', 'browser', 'agents', 'skills', 'you']) {
    expect(classify('mcp__srv__list_things', { query: 'private' }, put(station))).toEqual({ station, label: 'srv: list things' })
  }
  // A string works as well as a list, and the other servers stay where they were.
  const two = setupFrom({ serverStations: 'srv=files, other = skills' })
  expect(classify('mcp__srv__read', {}, two).station).toBe('files')
  expect(classify('mcp__other__read', {}, two).station).toBe('skills')
  expect(classify('mcp__third__read', {}, two).station).toBe('web')
  // What the person sets wins over the mod's own route for a server it knows.
  expect(classify('mcp__Claude_Browser__navigate', { url: 'https://a.b/c' }, setupFrom({ serverStations: ['Claude_Browser=web'] }))).toEqual({
    station: 'web',
    label: 'Claude_Browser: navigate',
  })
  // The server's resources follow it.
  expect(classify('ReadMcpResourceTool', { server: 'srv', uri: 'private://x' }, put('files'))).toEqual({ station: 'files', label: 'ReadMcpResourceTool' })
})

test('serverStations ignores an entry whose station is unknown, or is memory, the model or hooks', () => {
  const odd = setupFrom({ serverStations: ['a=nowhere', 'b=memory', 'c=model', 'd=hooks', 'e=', '=files', 'no-equals', 'f=files'] })
  expect([...odd.serverStations]).toEqual([['f', 'files']])
  expect(classify('mcp__a__x', {}, odd).station).toBe('web')
  expect(classify('mcp__b__x', {}, odd).station).toBe('web')
  expect(setupFrom({}).serverStations.size).toBe(0)
  expect(setupFrom({ serverStations: 7 }).serverStations.size).toBe(0)
})

test('a server named in memoryServers and in serverStations goes to Memory', () => {
  const both = setupFrom({ memoryServers: ['recall'], serverStations: ['recall=files'] })
  expect(classify('mcp__recall__search', {}, both)).toEqual({ station: 'memory', label: 'search' })
  expect(classify('ReadMcpResourceTool', { server: 'recall' }, both).station).toBe('memory')
})

test('what parts two commands parts them only outside quotes', () => {
  // A pattern, a script or a filter with `|` or `;` in it is one argument of a command that works on files.
  for (const c of [
    'grep -E "ssh|curl" log.txt',
    'grep -rn "foo|bar" src',
    'rg "push|pull" .',
    'sed "s/a/b/; s/curl/x/" f',
    "awk '{print $1; }' f",
    "jq '.a | .b' f.json",
    'cat f | grep -E "wget|nc"',
    `bash -c "grep -E 'a|b' f"`,
    'find . -name "*.ts" -exec grep -l "a|b" {} \\;',
    "find . -exec grep -l 'a;b' {} ';'",
  ]) {
    expect([c, stationOf(c)]).toEqual([c, 'files'])
  }
  // Text that names a network command runs none.
  for (const c of [
    'git commit -m "fix: retry; curl fallback"',
    'echo "a; wget b"',
    'echo "for u; do curl; done"',
    `echo "it's; curl"`,
    'echo "a \\" ; curl x"',
    'echo a\\; curl',
    "echo $'it\\'s; curl x'",
    'make # then; curl x',
    "make # don't; curl x",
  ]) {
    expect([c, stationOf(c)]).toEqual([c, 'shell'])
  }
  // Outside the quotes the same characters still part commands, and a command after a comment's line is read.
  for (const c of [
    'grep "a" f && curl x',
    'echo "a"; curl x',
    "make # don't\ncurl x",
    'echo a\\\\; curl x',
    'bash -c "echo \\"hi\\"; curl x"',
    'sleep 5 & curl x',
    'make |& curl -T - x',
  ]) {
    expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // Sending output somewhere ends no command, and a backslash at a line's end joins two lines.
  expect(stationOf('ls a 2>&1')).toBe('files')
  expect(stationOf('ls a &> out.txt')).toBe('files')
  expect(stationOf('git \\\n  push origin main')).toBe('web')
  // Double quotes do not stop a command inside them from running; single quotes do.
  expect(stationOf('echo "$(curl x)"')).toBe('web')
  expect(stationOf('echo "now `curl x` done"')).toBe('web')
  expect(stationOf('git commit -m "$(date); $(curl x)"')).toBe('web')
  expect(stationOf("echo '$(curl x)'")).toBe('shell')
  expect(stationOf("echo '`curl x`'")).toBe('shell')
  // The text beside a command run inside quotes is still text.
  expect(stationOf('echo "$(date) curl x"')).toBe('shell')
  // A line handed to a shell in single quotes is run by that shell, and what it runs inside is found.
  expect(stationOf("bash -c 'echo $(curl x)'")).toBe('web')
  expect(stationOf('case $1 in a) curl x ;; esac')).toBe('web')
  // PowerShell: a backslash is a path's, and a backtick keeps the character after it.
  expect(stationOf('Select-String "a|b" f.txt', 'PowerShell')).toBe('files')
  expect(stationOf('Write-Host "a; curl b"', 'PowerShell')).toBe('shell')
  expect(stationOf('Get-Content "C:\\dir\\"; curl x', 'PowerShell')).toBe('web')
  expect(stationOf('Write-Host a`; curl', 'PowerShell')).toBe('shell')
  expect(stationOf('& "C:\\Program Files\\Git\\cmd\\git.exe" push', 'PowerShell')).toBe('web')
})

test("a here-document handed to a shell is that shell's script", () => {
  for (const c of [
    'bash <<EOF\ncurl x\nEOF',
    "bash -s <<'EOF'\nset -e\nwget y\nEOF",
    'sudo sh <<EOF\napt-get update\nEOF',
    'echo start && zsh <<-EOF\n\tgit push\n\tEOF',
    'bash <<EOF\necho hi',
  ]) {
    if (c.endsWith('hi')) expect([c, stationOf(c)]).toEqual([c, 'shell'])
    else expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // The word that ends it is no command, and what follows is read as before.
  expect(stationOf('bash <<EOF\necho hi\nEOF')).toBe('shell')
  expect(stationOf('bash <<EOF\necho hi\nEOF\ncurl x')).toBe('web')
  // A shell that was given a script, or a line with -c, reads the here-document as that script's input: text.
  expect(stationOf('bash deploy.sh <<EOF\ncurl x\nEOF')).toBe('shell')
  expect(stationOf('bash -c "cat > f" <<EOF\ncurl x\nEOF')).toBe('files')
  // Another language's script is not read, and neither is text piped on to a shell.
  expect(stationOf('python3 - <<PY\nimport os\ncurl = 1\nPY')).toBe('shell')
  expect(stationOf('cat <<EOF | bash\ncurl x\nEOF')).toBe('shell')
})

test('the command docker runs in a container is the command that counts', () => {
  for (const c of [
    'docker exec c curl x',
    'docker exec -it -u root c curl x',
    'docker run alpine wget x',
    'docker run --rm -v "$PWD:/w" -w /w alpine wget x',
    'docker run --rm alpine sh -c "curl x"',
    'docker compose exec web curl x',
    'docker compose run --rm web npm install',
    'docker -H tcp://h:2375 exec c curl y',
    'docker container exec c ping h',
    'sudo docker exec c curl x',
  ]) {
    expect([c, stationOf(c)]).toEqual([c, 'web'])
  }
  // A name or a value that reads like a command is not one, and a command that stays in the container is Shell.
  for (const c of [
    'docker exec c ls',
    'docker run --name curl alpine ls',
    'docker run -e A=1 --network=host img git status',
    'docker run alpine',
    'docker ps',
    'docker exec c cat /etc/hosts',
    'docker logs curl',
  ]) {
    expect([c, stationOf(c)]).toEqual([c, 'shell'])
  }
})

test('a call still running stays in the list past the newest rows', () => {
  const t = stringsFor('en')
  // Stations alternate so that nothing folds: every entry is a row of its own.
  const after = Array.from({ length: 20 }, (_, i) => entry(i % 2 === 0 ? 'files' : 'shell', 100 + i))
  const running = entry('shell', 1, { status: 'run', endedAt: undefined, label: 'Run the long build' })
  const rows = foldRows([entry('files', 0), running, ...after])
  expect(rows.length).toBe(16)
  expect(rows[15]?.entry.label).toBe('Run the long build')
  expect(rows.slice(0, 15).map(r => r.entry.startedAt)).toEqual(Array.from({ length: 15 }, (_, i) => 119 - i))
  expect(feedLines([entry('files', 0), running, ...after], t).at(-1)?.line).toContain('Run the long build')

  // Two of them: both stay, the newer above the older.
  const second = entry('agents', 2, { status: 'run', endedAt: undefined, label: 'Read the docs' })
  expect(foldRows([running, second, ...after]).slice(14).map(r => r.entry.label)).toEqual(['Read the docs', 'Run the long build'])

  // Ended, it is a row like any other and goes with the rest.
  const ended = { ...running, status: 'ok' as const, endedAt: 50 }
  expect(foldRows([ended, ...after]).some(r => r.entry.label === 'Run the long build')).toBe(false)

  // A background task is pinned above the rows, so it takes none of them.
  const task = entry('agents', 3, { status: 'run', endedAt: undefined, task: 'b1', label: 'Dev server' })
  expect(feedLines([task, ...after], t).some(l => l.line.includes('Dev server'))).toBe(false)
})

test('the last row of a full list folds only what stood next to it, not the same station further back', () => {
  const turns = Array.from({ length: 40 }, (_, i) => entry(i % 2 === 0 ? 'model' : 'shell', i))
  expect(foldRows(turns).map(r => r.times)).toEqual(Array.from({ length: 16 }, () => 1))
  // What stood next to it still folds in; a model call further back, past the cut, does not.
  const tail = [entry('model', 0), entry('model', 1), ...Array.from({ length: 15 }, (_, i) => entry(i % 2 === 0 ? 'shell' : 'files', 10 + i))]
  expect(foldRows([entry('model', -2), entry('shell', -1), ...tail])[15]?.times).toBe(2)
})

test('thirty calls still running take half the list, the last of them standing for the rest, and the newest calls keep the other half', () => {
  const tasks = Array.from({ length: 30 }, (_, i) => entry('agents', i, { status: 'run', endedAt: undefined, label: `task ${i}` }))
  const after = Array.from({ length: 20 }, (_, i) => entry(i % 2 === 0 ? 'files' : 'shell', 100 + i))
  const rows = foldRows([...tasks, ...after])
  expect(rows.length).toBe(16)
  expect(rows.slice(0, 8).map(r => r.entry.startedAt)).toEqual([119, 118, 117, 116, 115, 114, 113, 112])
  expect(rows.slice(8).map(r => r.entry.label)).toEqual(['task 29', 'task 28', 'task 27', 'task 26', 'task 25', 'task 24', 'task 23', 'task 22'])
  expect(rows.slice(8).map(r => r.times)).toEqual([1, 1, 1, 1, 1, 1, 1, 23])
  expect(rows.slice(8).reduce((n, r) => n + r.times, 0)).toBe(30)
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
    on('command.register', () => ({ value: { command: 'lot-map' } }))
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

test("the rows open with this turn's header and keep only headers of earlier turns", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  const answers: unknown[] = [{ result: {} }, { result: {}, isError: true, text: 'Exit code 1' }]
  on('tool.call', () => (answers.shift() ?? { result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  await $.turn.start({ text: 'first', turnId: 't1' } as never)
  for (const command of ['make a', 'make b', 'make c']) await $.tool.call({ tool: 'Bash', command, description: command } as never)
  await $.turn.start({ text: 'second', turnId: 't2' } as never)
  for (const file_path of ['/a/one.ts', '/a/two.ts']) await $.tool.call({ tool: 'Read', file_path } as never)
  expect(await text(/^Turn 2 · /)).toMatch(/ · 2 calls$/)
  expect(await text(/^Turn 1 · /)).toMatch(/ · 3 calls · 1 error$/)
  expect((await ui.find({ type: 'Text', text: /^Turn 2 · / }))?.props.bold).toBe(true)
  expect(await text(/two\.ts/)).toBeDefined()
  expect(await text(/make [abc]/)).toBeUndefined()
  await ui.unmount()
})

test("a turn a background task's notification starts opens no header", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  await $.turn.start({ text: 'first', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make a', description: 'make a' } as never)
  await $.turn.start({ text: NOTICE('b1', 'completed'), turnId: 't2' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make b', description: 'make b' } as never)
  // Both calls count on the person's turn, which stays the open one with its rows.
  expect(await text(/^Turn 1 · /)).toMatch(/ · 2 calls$/)
  expect(await text(/^Turn 2/)).toBeUndefined()
  expect(await text(/make b/)).toBeDefined()
  await ui.unmount()
})

test("what a settings hook or a typed skill adds at a message lands on that message's turn", { options: { hookRecords: true } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('skill.prompt', (_, e) => ({ text: e.text }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  const added = [['a note'], ['• [#12 excerpt] x']]
  on('classic.UserPromptSubmit', () => ({ additionalContext: added.shift() ?? [] }) as never)
  // As the engine has it: the prompt and its settings hooks, then a typed skill's text, then the turn.
  const message = async (text: string, turnId: string, skill?: string) => {
    await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
    await $.classic.UserPromptSubmit({ prompt: text, permission_mode: 'default' } as never)
    if (skill !== undefined) await $.skill.prompt({ skill, text: '' } as never)
    await $.turn.start({ text, turnId } as never)
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  await message('first', 't1')
  await $.tool.call({ tool: 'Read', file_path: '/a/one.ts' } as never)
  await message('/deploy', 't2', 'deploy')
  expect(await text(/^Turn 1 · /)).toMatch(/ · 2 calls$/)
  expect(await text(/^Turn 2 · /)).toMatch(/ · 3 calls$/)
  expect(await text(/added memory to the message/)).toBeDefined()
  expect(await text(/1 record: #12/)).toBeDefined()
  expect(await text(/Skills +deploy/)).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('<title>Hooks: 2 calls this session · 1 this turn</title>')
  // A background task's notification opens no turn.
  await $.prompt.submit({ text: NOTICE('b1', 'completed'), wait: false, origin: { kind: 'task-notification' } } as never)
  await $.turn.start({ text: NOTICE('b1', 'completed'), turnId: 't3' } as never)
  expect(await text(/^Turn 3/)).toBeUndefined()
  expect(await text(/^Turn 2 · /)).toMatch(/ · 3 calls$/)
  await ui.unmount()
})

test('the open-turn header goes first and bold, then its rows, then the last four earlier headers, dim, in 16 lines', () => {
  const t = stringsFor('en')
  const turn = (n: number, more: Partial<TurnSummary> = {}): TurnSummary => ({ n, startedAt: n * 1000, endedAt: n * 1000 + 500, calls: n, errors: 0, ...more })
  const turns = [1, 2, 3, 4, 5, 6, 7].map(n => turn(n))
  const mine = Array.from({ length: 20 }, (_, i) => entry(i % 2 === 0 ? 'files' : 'shell', 7000 + i, { turn: 7, label: `row ${i}` }))
  const old = entry('shell', 1500, { turn: 6, label: 'old row' })
  const lines = feedLines([old, ...mine], t, {}, turns)
  expect(lines.length).toBe(16)
  expect(lines[0]).toMatchObject({ tone: 'plain', isBold: true })
  expect(lines[0]?.line).toMatch(/^Turn 7 · .* · 7 calls$/)
  expect(lines.slice(1, 12).every(l => /row \d+/.test(l.line))).toBe(true)
  expect(lines.slice(12).map(l => l.line.split(' · ')[0])).toEqual(['Turn 6', 'Turn 5', 'Turn 4', 'Turn 3'])
  expect(lines.slice(12).every(l => l.tone === 'ok' && l.isBold === undefined)).toBe(true)
  expect(lines.some(l => l.line.includes('old row'))).toBe(false)
  // An open turn's time runs to its newest call's end; a header names its errors only when there are some.
  const two = [turn(1, { errors: 1, calls: 1 }), turn(2, { startedAt: 5000, endedAt: undefined })]
  const open = feedLines([entry('files', 5000, { turn: 2, endedAt: 5300 })], t, {}, two)
  expect(open[0]?.line).toBe('Turn 2 · 300 ms · 2 calls')
  expect(open[2]?.line).toBe('Turn 1 · 500 ms · 1 call · 1 error')
  // No turns: the rows are as before.
  expect(feedLines(mine.slice(0, 2), t).map(l => l.isBold)).toEqual([undefined, undefined])
})

test("a background task's failure counts on the turn that started it", async ($, on) => {
  mock.clock(on, { now: NOW })
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2' } }) as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
  await $.turn.start({ text: 'first', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'make', run_in_background: true } as never)
  await $.turn.start({ text: 'second', turnId: 't2' } as never)
  await $.turn.start({ text: NOTICE('b2', 'failed'), turnId: 't3' } as never)
  expect(await text(/^Turn 1 · /)).toMatch(/ · 1 call · 1 error$/)
  expect(await text(/^Turn 2 · /)).toMatch(/ · 0 calls$/)
  await ui.unmount()
})

const call = (id: string, station: Entry['station'], label: string, startedAt: number, extra: Partial<Entry> = {}): Entry => ({
  id,
  station,
  label,
  from: 'core',
  startedAt,
  status: 'ok',
  ...extra,
})

test('the same command failing three times in a row warns, and a success ends it', () => {
  const t = stringsFor('en')
  const fail = (id: string, at: number, extra: Partial<Entry> = {}) => call(id, 'shell', 'make build', at, { status: 'err', endedAt: at + 500, ...extra })
  const board = (entries: Entry[]): Board => ({ entries, counts: {}, phase: 'thinking', agents: ['a'] })
  expect(warningsOf(board([fail('1', 1000), fail('2', 2000)]), 5000, t)).toEqual([])
  expect(warningsOf(board([fail('1', 1000), fail('2', 2000), fail('3', 3000)]), 5000, t)).toEqual([
    { station: 'shell', line: t.failedInARow('Shell', 'make build', 3) },
  ])
  expect(warningsOf(board([fail('1', 1000), fail('2', 2000), fail('3', 3000), fail('4', 4000)]), 5000, t)[0]?.line).toBe(
    t.failedInARow('Shell', 'make build', 4),
  )
  // A success, another command, or another loop's call between them ends the streak; one subagent's streak is its own.
  const ok = call('o', 'shell', 'make build', 2500, { endedAt: 2600 })
  expect(warningsOf(board([fail('1', 1000), fail('2', 2000), ok, fail('3', 3000)]), 5000, t)).toEqual([])
  expect(warningsOf(board([fail('1', 1000), fail('2', 2000), fail('3', 3000, { label: 'make test' })]), 5000, t)).toEqual([])
  expect(warningsOf(board([fail('1', 1000, { agentId: 'a' }), fail('2', 2000), fail('3', 3000, { agentId: 'a' })]), 5000, t)).toEqual([])
  expect(
    warningsOf(board([fail('1', 1000, { agentId: 'a' }), fail('2', 2000), fail('3', 3000, { agentId: 'a' }), fail('4', 4000, { agentId: 'a' })]), 5000, t),
  ).toHaveLength(1)
})

test("a call running far past its station's usual time warns", () => {
  const t = stringsFor('en')
  const done = [0, 1, 2].map(i => call(`d${i}`, 'shell', 'ls', i * 2000, { endedAt: i * 2000 + 1000 }))
  const at = (started: number, extra: Partial<Entry> = {}) =>
    ({ entries: [...done, call('r', 'shell', 'make build', started, { status: 'run', ...extra })], counts: {} }) as Board
  const now = 100_000
  expect(warningsOf(at(now - 90_000), now, t)).toEqual([{ station: 'shell', line: t.runningLong('Shell', 'make build', '1 min 30 s', '1.0 s') }])
  expect(warningsOf(at(now - 50_000), now, t)).toEqual([])
  // Fewer than three finished calls there: no usual time to go by.
  expect(warningsOf({ entries: [...done.slice(0, 2), call('r', 'shell', 'x', now - 90_000, { status: 'run' })], counts: {} }, now, t)).toEqual([])
})

test('nothing happening for three minutes in a running turn warns', () => {
  const t = stringsFor('en')
  const entries = [call('1', 'files', 'a.ts', 1000, { endedAt: 2000 })]
  expect(warningsOf({ entries, counts: {}, phase: 'thinking' }, 2000 + 179_000, t)).toEqual([])
  expect(warningsOf({ entries, counts: {}, phase: 'thinking' }, 2000 + 180_000, t)).toEqual([{ line: t.quietFor(3) }])
  expect(warningsOf({ entries, counts: {}, phase: 'done' }, 2000 + 600_000, t)).toEqual([])
  expect(warningsOf({ entries, counts: {} }, 2000 + 600_000, t)).toEqual([])
})

test('background work and a wait on the person never warn', () => {
  const t = stringsFor('en')
  const done = [0, 1, 2].map(i => call(`d${i}`, 'shell', 'ls', i * 2000, { endedAt: i * 2000 + 1000 }))
  const now = 700_000
  const background = call('b', 'shell', 'npm run dev', 100_000, { status: 'run', task: 'bg1' })
  expect(warningsOf({ entries: [...done, background], counts: {}, phase: 'thinking' }, now, t)).toEqual([])
  const question = call('q', 'you', 'question for you', 100_000, { status: 'run', waits: true })
  expect(warningsOf({ entries: [...done, question], counts: {}, phase: 'thinking' }, now, t)).toEqual([])
  const prompt = call('p', 'shell', 'make build', 100_000, { status: 'run', asks: true })
  expect(warningsOf({ entries: [...done, prompt], counts: {}, phase: 'thinking' }, now, t)).toEqual([])
  // Finished background rows do not make the usual time.
  const slow = [0, 1, 2].map(i => call(`s${i}`, 'shell', 'dev', i, { endedAt: 600_000, task: 'x' }))
  expect(warningsOf({ entries: [...slow, call('r', 'shell', 'x', 0, { status: 'run' })], counts: {} }, 90_000, t)).toEqual([])
})

test("a call's usual time runs from when it was allowed, not from its permission prompt", () => {
  const t = stringsFor('en')
  // Each allowed after a two-minute prompt, then a second's work.
  const done = [0, 1, 2].map(i => call(`d${i}`, 'shell', 'ls', i * 200_000, { ranAt: i * 200_000 + 120_000, endedAt: i * 200_000 + 121_000 }))
  const now = 1_000_000
  const running = (extra: Partial<Entry>) => ({ entries: [...done, call('r', 'shell', 'make build', now - 90_000, { status: 'run', ...extra })], counts: {} })
  expect(warningsOf(running({}), now, t)).toEqual([{ station: 'shell', line: t.runningLong('Shell', 'make build', '1 min 30 s', '1.0 s') }])
  expect(warningsOf(running({ ranAt: now - 30_000 }), now, t)).toEqual([])
})

test('a warned station wears its ring on the map', () => {
  const fail = (id: string, at: number) => call(id, 'shell', 'make build', at, { status: 'err', endedAt: at + 500 })
  const warned = drawMap({ entries: [fail('1', 1000), fail('2', 2000), fail('3', 3000)], counts: {}, phase: 'thinking' }, 4000, STRANGER)
  const plain = drawMap({ entries: [fail('1', 1000), fail('2', 2000)], counts: {}, phase: 'thinking' }, 4000, STRANGER)
  const ring = /<circle [^>]*r="34"[^>]*stroke-dasharray="[^"]+"/
  expect(warned).toMatch(ring)
  expect(plain).not.toMatch(ring)
})

test('a running call, a model step or a subagent is no quiet turn and no long call', () => {
  const t = stringsFor('en')
  const now = 300_000
  const board = (entries: Entry[]): Board => ({ entries, counts: {}, phase: 'thinking' })
  expect(warningsOf(board([call('r', 'shell', 'npm test', 60_000, { status: 'run' })]), now, t)).toEqual([])
  expect(warningsOf(board([call('m', 'model', 'thinking', 60_000, { status: 'run' })]), now, t)).toEqual([])
  expect(warningsOf(board([call('d', 'files', 'a.ts', 0, { endedAt: 100 })]), now, t)).toEqual([{ line: t.quietFor(4) }])
  const short = [0, 1, 2].map(i => call(`g${i}`, 'agents', 'Agent', i * 2000, { endedAt: i * 2000 + 1000 }))
  expect(warningsOf(board([...short, call('r', 'agents', 'Agent', now - 120_000, { status: 'run' })]), now, t).filter(w => w.station === 'agents')).toEqual([])
})

test('a loop warns only while it goes on', () => {
  const t = stringsFor('en')
  const fails = [1, 2, 3].map(i => call(`f${i}`, 'shell', 'make build', i * 1000, { status: 'err', endedAt: i * 1000 + 500 }))
  expect(warningsOf({ entries: fails, counts: {}, phase: 'done' }, 5000, t)).toEqual([])
  expect(warningsOf({ entries: fails, counts: {}, phase: 'thinking' }, 5000, t)).toHaveLength(1)
  const sub = fails.map(e => ({ ...e, agentId: 'a' }))
  expect(warningsOf({ entries: sub, counts: {}, phase: 'thinking', agents: [] }, 5000, t)).toEqual([])
  expect(warningsOf({ entries: sub, counts: {}, phase: 'thinking', agents: ['a'] }, 5000, t)).toHaveLength(1)
})

/** A folder of sessions' status files, as the engine's fs sees it: file name to its text. Answers the folders listed. */
function fakeSessionFolder(on: On, files: Record<string, string>, mtimes: Record<string, number> = {}): string[] {
  const listed: string[] = []
  on('fs.list', (_, e) => {
    listed.push(e.path)
    return { value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: mtimes[name] ?? 0, isLink: false })) } as never
  })
  on('fs.read', (_, e) => ({ value: files[e.path.split('/').at(-1) ?? ''] ?? '' }) as never)
  return listed
}

/** The person's own runtime folder, where the sessions' status files go. */
const RUNTIME = { XDG_RUNTIME_DIR: '/run/user/1000', HOME: '/home/u' }
const SESSIONS = '/run/user/1000/lot-map-sessions'

test('each session writes its status for the overview, and takes it away when it ends', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { ...RUNTIME, TMPDIR: '/tmp' })
  const runs = fakeHost(on)
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'abc-123' }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const hour = 3_600_000
  fakeSessionFolder(on, {
    'old-1.json': JSON.stringify({ updatedAt: NOW - hour - 1000 }),
    'young-2.json': JSON.stringify({ updatedAt: NOW - 1000 }),
    'notes.txt': JSON.stringify({ updatedAt: 0 }),
  })
  const file = `${SESSIONS}/abc-123.json`
  const mine = () => written.filter(w => w.path === file).map(w => JSON.parse(w.text))

  await $.session.start({ cwd: '/home/u/projects/lot-map', surface: 'terminal', isInteractive: true })
  // The folder is made the person's alone before anything is written to it.
  expect(runs[0]).toEqual(['mkdir', '-p', '-m', '700', '--', SESSIONS])
  await clock.advance(1000)
  expect(mine().length).toBe(1)
  expect(mine()[0]).toMatchObject({ name: 'lot-map', state: 'idle', word: 'idle', startedAt: NOW, fault: false })
  expect(typeof mine()[0].now).toBe('string')
  // A session killed without an end leaves a file; an hour on, the next start takes it away, and nothing else.
  expect(runs.filter(argv => argv[0] === 'rm')).toEqual([['rm', '-f', '--', `${SESSIONS}/old-1.json`]])

  // Unchanged, it is written again only for the heartbeat, every five seconds.
  await clock.advance(3000)
  expect(mine().length).toBe(1)
  await clock.advance(2000)
  expect(mine().length).toBe(2)
  expect(mine()[1].updatedAt).toBeGreaterThan(mine()[0].updatedAt)
  // A change is written at once.
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await clock.advance(1000)
  expect(mine().at(-1)).toMatchObject({ state: 'thinking', word: 'thinking' })

  // A /clear and a /resume go on in the same process: the file stays.
  await $.session.end({ reason: 'clear' } as never)
  await $.session.end({ reason: 'resume' } as never)
  expect(runs.filter(argv => argv[0] === 'rm').length).toBe(1)
  await $.session.end({ reason: 'other' } as never)
  expect(runs.at(-1)).toEqual(['rm', '-f', '--', file])
  const count = mine().length
  await clock.advance(10_000)
  expect(mine().length).toBe(count)
})

test('a run with no surface writes no status', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, RUNTIME)
  fakeHost(on)
  const written: string[] = []
  on('fs.write', (_, e) => {
    written.push(e.path)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'abc-123' }) as never)
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/u/p', surface: null, isInteractive: false })
  await clock.advance(6000)
  expect(written).toEqual([])
})

test('/workmap all outside Windows Terminal answers the tiles as text, waiting first', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, RUNTIME)
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  // The top line as the session writes it: the context is the tile's own figure, so it is not in the words.
  const said = (board: Board) => describeNow(board, stringsFor('en'), NOW, false).text
  const tile = (name: string, state: string, word: string, now: string, ago: number) =>
    JSON.stringify({ name, state, word, now, context: 42, startedAt: NOW - 125_000, updatedAt: NOW - ago })
  const listed = fakeSessionFolder(on, {
    'a-1.json': tile('zeta', 'running', 'running', 'Shell: make', 1000),
    'b-2.json': tile('beta', 'idle', 'idle', said({ entries: [], counts: {}, context: 42 }), 2000),
    'c-3.json': tile('omega', 'waiting', 'needs you', 'Needs you: permission', 3000),
    'd-4.json': tile('alpha', 'running', 'running', 'Files: a.ts', 4000),
    'e-5.json': tile('gone', 'running', 'running', 'old', 16_000),
    'f-6.json': '{not json',
    'g-7.json': 'null',
  })
  const lines = String((await $.command.run({ command: 'workmap', args: 'all' } as never)).text).split('\n')
  expect(lines.map(line => line.split('  ')[0])).toEqual(['omega', 'alpha', 'zeta', 'beta'])
  expect(lines[0]).toBe('omega  needs you  Needs you: permission  42%  2 min 5 s')
  // The context shows once.
  expect(lines[3]).toBe('beta  idle  Nothing is running.  42%  2 min 5 s')
  expect(describeNow({ entries: [], counts: {}, context: 42 }, stringsFor('en'), NOW).text).toContain('context 42%')
  expect(runs.some(argv => argv[0] === 'wt.exe')).toBe(false)
  expect(listed).toEqual([SESSIONS])
})

test('/workmap all in Windows Terminal opens the overview window, with no Chromium', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { WSL_DISTRO_NAME: 'Ubuntu', WT_PROFILE_ID: '{51855cb2}', HOME: '/home/u', TMPDIR: '/tmp' })
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  fakeSessionFolder(on, {})
  const answer = await $.command.run({ command: 'workmap', args: 'all' } as never)
  expect(answer.text).toBe('Overview window opened beside this one.')
  const wt = runs.find(argv => argv[0] === 'wt.exe') ?? []
  expect(wt.slice(0, 13)).toEqual(['wt.exe', '-w', '0', 'split-pane', '--vertical', '--size', '0.45', 'wsl.exe', '-d', 'Ubuntu', '--', 'env', '/usr/bin/node'])
  expect(wt[13]).toMatch(/\/renderer\/view\.mjs$/)
  // Without XDG_RUNTIME_DIR the folder is in the person's own cache.
  expect(wt.slice(14)).toEqual(['--all', '/home/u/.cache/lot-map/sessions'])
})

test('/workmap all from WSL outside Windows Terminal answers the tiles as text', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { ...RUNTIME, WSL_DISTRO_NAME: 'Ubuntu' })
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  fakeSessionFolder(on, { 'a-1.json': JSON.stringify({ name: 'zeta', state: 'idle', word: 'idle', now: 'x', startedAt: NOW, updatedAt: NOW }) })
  expect((await $.command.run({ command: 'workmap', args: 'all' } as never)).text).toBe('zeta  idle  x  0 s')
  expect(runs.some(argv => argv[0] === 'wt.exe')).toBe(false)
})

test('with neither XDG_RUNTIME_DIR nor HOME no status is written, and /workmap all has no session to show', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { TMPDIR: '/tmp', WSL_DISTRO_NAME: 'Ubuntu', WT_PROFILE_ID: '{51855cb2}' })
  const runs = fakeHost(on)
  const written: string[] = []
  on('fs.write', (_, e) => {
    written.push(e.path)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'abc-123' }) as never)
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const listed = fakeSessionFolder(on, {})
  await $.session.start({ cwd: '/home/u/p', surface: 'terminal', isInteractive: true })
  await clock.advance(6000)
  expect(written).toEqual([])
  expect((await $.command.run({ command: 'workmap', args: 'all' } as never)).text).toBe('No sessions to show.')
  expect(listed).toEqual([])
  expect(runs.some(argv => argv[0] === 'wt.exe' || argv[0] === 'mkdir')).toBe(false)
  await $.session.end({ reason: 'other' } as never)
})

test('a corrupt file or one that fails does not stop the sweep, and an old corrupt file goes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, RUNTIME)
  const runs = fakeHost(on)
  on('fs.write', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'abc-123' }) as never)
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const stale = JSON.stringify({ updatedAt: NOW - 3_700_000 })
  fakeSessionFolder(
    on,
    {
      'bad-old.json': '{not json',
      'bad-new.json': '{not json',
      'null-old.json': 'null',
      'stale-3.json': stale,
      'young-4.json': JSON.stringify({ updatedAt: NOW - 1000 }),
    },
    { 'bad-old.json': NOW - 3_700_000, 'bad-new.json': NOW - 1000, 'null-old.json': NOW - 3_700_000 },
  )
  await $.session.start({ cwd: '/home/u/p', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const removed = runs.filter(argv => argv[0] === 'rm').map(argv => argv[3])
  expect(removed.sort()).toEqual([`${SESSIONS}/bad-old.json`, `${SESSIONS}/null-old.json`, `${SESSIONS}/stale-3.json`])
  await $.session.end({ reason: 'other' } as never)
})

test('a tile cannot drive the terminal: control characters are taken out of its words', () => {
  const t = stringsFor('en')
  const [tile] = tilesFrom([JSON.stringify({ name: 'a\x1b[2Jb', word: 'x\x07', now: 'n\x9b', state: 'idle', startedAt: NOW, updatedAt: NOW })], NOW)
  expect(tileText(tile as never, NOW, t)).toBe('a[2Jb  x  n  0 s')
})

test('a status write still running when the session ends does not bring the file back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, RUNTIME)
  const runs = fakeHost(on)
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  const written: string[] = []
  on('fs.write', async (_, e) => {
    await gate
    written.push(e.path)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'abc-123' }) as never)
  on('command.register', () => ({ value: { command: 'lot-map' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  fakeSessionFolder(on, {})
  await $.session.start({ cwd: '/home/u/p', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  await $.session.end({ reason: 'other' } as never)
  release()
  await clock.advance(1000)
  // Every write that landed after the end was taken away again (the end itself had no file yet to remove).
  const removals = runs.filter(argv => argv[0] === 'rm' && argv[3] === `${SESSIONS}/abc-123.json`).length
  expect(removals).toBe(written.length)
})
