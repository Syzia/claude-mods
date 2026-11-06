// Tests for the screen-light hooks module. The light program is never started here: `process.run`, `fs.write` and the
// clock are answered by hooks of the test, which stand for the engine, so each test sees exactly which files the mod
// writes, what it asks the Mac to open, and when.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { IDLE_RELEASE_MS, RELAUNCH_MS, Tracker, appVerb, classify, learnNames, plain, prettyApp, safeId, screenVerb, summaryOf } from '../hooks/light'
import type { Call, CallInput, Io, LightState } from '../hooks/light'
import { HELP_TEXT, commandArg } from '../hooks/text'

const T0 = 1_800_000_000_000
const GEMINI = 'com.google.GeminiMacOS'

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

describe('classify: which tools are control', () => {
  const kinds: [string, string][] = [
    // Names seen in real sessions of the desktop app's computer-use server.
    ['mcp__computer-use__app_click', 'app'],
    ['mcp__computer-use__app_screenshot', 'app'],
    ['mcp__computer-use__app_ax_find', 'app'],
    ['mcp__computer-use__app_batch', 'app'],
    ['mcp__computer-use__app_list_windows', 'app'],
    ['mcp__computer-use__app_menu', 'app'],
    ['mcp__computer-use__open_application', 'app'],
    ['mcp__computer-use__computer_batch', 'screen'],
    ['mcp__computer-use__read_clipboard', 'screen'],
    ['mcp__computer-use__write_clipboard', 'screen'],
    ['mcp__computer-use__switch_display', 'screen'],
    ['mcp__computer-use__request_full_control', 'full-on'],
    ['mcp__computer-use__release_full_control', 'full-off'],
    ['mcp__computer-use__app_release', 'app-off'],
    ['mcp__computer-use__list_apps', 'info'],
    ['mcp__computer-use__list_granted_applications', 'info'],
    ['mcp__computer-use__request_access', 'info'],
    ['mcp__computer-use__request_teach_access', 'info'],
    ['mcp__computer-use__teach_step', 'info'],
    ['mcp__computer-use__teach_batch', 'info'],
    // The linked-computer spelling and the plain full-screen tools the skill names.
    ['mcp__remote-devices__computer_app_screenshot', 'app'],
    ['mcp__remote-devices__computer_batch', 'screen'],
    ['mcp__remote-devices__computer_resolve_access', 'info'],
    ['mcp__remote-devices__computer_request_access', 'info'],
    ['mcp__computer-use__screenshot', 'screen'],
    ['mcp__computer-use__left_click', 'screen'],
    ['mcp__computer-use__type', 'screen'],
    // A tool this list has never heard of counts as control: a stray light beats a dark one.
    ['mcp__computer-use__frobnicate', 'screen'],
  ]
  for (const [tool, kind] of kinds) {
    test(`${tool} is ${kind}`, () => {
      expect(classify(tool)?.kind).toBe(kind)
    })
  }

  test('a tool of any other server or kind is left alone', () => {
    for (const tool of ['Bash', 'Read', 'mcp__desk-art__status', 'mcp__Claude_Browser__computer', 'mcp__claude-in-chrome__computer']) {
      expect(classify(tool)).toBeUndefined()
    }
  })
})

describe('words', () => {
  test('plain makes one short line', () => {
    expect(plain('Types\nthe\tprompt   now\u0007', 50)).toBe('Types the prompt now')
    expect(plain('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`)
    expect(plain('   ', 10)).toBeUndefined()
    expect(plain(42, 10)).toBeUndefined()
  })

  test('summaryOf takes the call’s own description, from the call or its first action that has one', () => {
    expect(summaryOf({ app: GEMINI, action_summary: 'Opens the "+" menu in the Gemini prompt box' })).toBe('Opens the "+" menu in the Gemini prompt box')
    expect(summaryOf({ actions: [{ action: 'screenshot' }, { action: 'left_click', action_summary: 'Presses Send' }] })).toBe('Presses Send')
    expect(summaryOf({ actions: [{ action: 'screenshot' }] })).toBeUndefined()
    expect(summaryOf({})).toBeUndefined()
  })

  test('screenVerb says what a full-screen call does, click first', () => {
    expect(screenVerb('computer_batch', { actions: [{ action: 'screenshot' }, { action: 'wait' }] })).toBe('Looking at the screen')
    expect(screenVerb('computer_batch', { actions: [{ action: 'mouse_move' }, { action: 'zoom' }] })).toBe('Moving the mouse')
    expect(screenVerb('computer_batch', { actions: [{ action: 'type' }, { action: 'left_click' }] })).toBe('Clicking on the screen')
    expect(screenVerb('computer_batch', { actions: [{ action: 'key' }] })).toBe('Pressing keys')
    expect(screenVerb('computer_batch', { actions: [{ action: 'type' }] })).toBe('Typing on the keyboard')
    expect(screenVerb('left_click', {})).toBe('Clicking on the screen')
    expect(screenVerb('write_clipboard', {})).toBe('Using the clipboard')
  })

  test('appVerb names the app when it can', () => {
    expect(appVerb('app_click', 'Gemini')).toBe('Clicking in Gemini')
    expect(appVerb('app_screenshot', 'Gemini')).toBe('Looking at Gemini')
    expect(appVerb('app_type', undefined)).toBe('Typing in an app')
    expect(appVerb('app_batch', 'Gemini')).toBe('Working in Gemini')
    expect(appVerb('computer_app_screenshot', 'Gemini')).toBe('Looking at Gemini')
    expect(appVerb('open_application', 'Gemini')).toBe('Opening Gemini')
  })

  test('prettyApp uses the reported name, else the last part of the bundle id', () => {
    expect(prettyApp(GEMINI, new Map())).toBe('Gemini')
    expect(prettyApp(GEMINI, new Map([[GEMINI, 'Gemini Pro']]))).toBe('Gemini Pro')
    expect(prettyApp('com.electron.ollama', new Map())).toBe('ollama')
    expect(prettyApp('Safari', new Map())).toBe('Safari')
  })

  test('learnNames reads the names out of the answers the tools really give', () => {
    const access = '{"granted":[{"bundleId":"com.google.GeminiMacOS","displayName":"Gemini","grantedAt":1793875393290,"tier":"full"}],"denied":[]}'
    const apps = '{"apps":[{"bundleId":"com.google.GeminiMacOS","displayName":"Gemini","isRunning":true,"pid":381}]}'
    expect(learnNames(access)).toEqual([[GEMINI, 'Gemini']])
    expect(learnNames(apps)).toEqual([[GEMINI, 'Gemini']])
    expect(learnNames('no names here')).toEqual([])
  })

  test('safeId keeps a safe session id and replaces anything else', () => {
    expect(safeId('f098d4ac-028a-4a40-b6af-902f914115dc')).toBe('f098d4ac-028a-4a40-b6af-902f914115dc')
    expect(safeId('../../etc/passwd')).toBe('session')
    expect(safeId(undefined)).toBe('session')
  })

  test('commandArg: nothing means the demo', () => {
    expect(commandArg('')).toEqual({ kind: 'demo' })
    expect(commandArg(' DEMO ')).toEqual({ kind: 'demo' })
    expect(commandArg('status')).toEqual({ kind: 'status' })
    expect(commandArg('build now')).toEqual({ kind: 'build' })
    expect(commandArg('--help')).toEqual({ kind: 'help' })
    expect(commandArg('explode')).toEqual({ kind: 'unknown', given: 'explode' })
  })
})

// ---------------------------------------------------------------------------
// The tracker, with an engine made of lists
// ---------------------------------------------------------------------------

function rig(startAt = T0) {
  let now = startAt
  const writes: LightState[] = []
  const launches: number[] = []
  const problems: string[] = []
  let failWrites = false
  const io: Io = {
    now: async () => now,
    write: async text => {
      if (failWrites) throw new Error('disk full')
      writes.push(JSON.parse(text) as LightState)
    },
    launch: async () => {
      launches.push(now)
    },
    problem: text => problems.push(text),
  }
  return {
    io,
    writes,
    launches,
    problems,
    last: (): LightState => writes[writes.length - 1] as LightState,
    tick: (ms: number) => {
      now += ms
    },
    failWrites: (on: boolean) => {
      failWrites = on
    },
  }
}

const call = (tool: string): Call => classify(`mcp__computer-use__${tool}`) as Call
const ok = { ok: true, text: 'ok' }

describe('Tracker', () => {
  test('a background call lights the light and names the app and what Claude is doing', async () => {
    const r = rig()
    const t = new Tracker('s1')
    const input: CallInput = { app: GEMINI, element_index: 67, action_summary: 'Opens the "+" menu in the Gemini prompt box' }
    const token = await t.begin(r.io, call('app_click'), input)
    expect(r.last()).toMatchObject({ v: 1, session: 's1', mode: 'app', busy: true, app: 'Gemini', what: 'Opens the "+" menu in the Gemini prompt box', since: T0, last: T0, beat: T0 })
    expect(r.launches).toEqual([T0])
    r.tick(1_200)
    await t.finish(r.io, call('app_click'), input, token, ok)
    expect(r.last()).toMatchObject({ mode: 'app', busy: false, last: T0 + 1_200, since: T0 })
    expect(r.launches.length).toBe(1)
  })

  test('with no description of its own a call is described from its name', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.begin(r.io, call('app_screenshot'), { app: GEMINI, window_id: 1 })
    expect(r.last().what).toBe('Looking at Gemini')
  })

  test('a full-screen call takes the whole screen and outranks the background', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.begin(r.io, call('app_click'), { app: GEMINI })
    expect(r.last().mode).toBe('app')
    r.tick(100)
    await t.begin(r.io, call('computer_batch'), { actions: [{ action: 'left_click', coordinate: [1, 2] }] })
    expect(r.last()).toMatchObject({ mode: 'screen', what: 'Clicking on the screen' })
    expect(r.last().app).toBeUndefined()
  })

  test('releasing full-screen control falls back to the app, or hands control back', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.begin(r.io, call('app_click'), { app: GEMINI })
    const full = await t.begin(r.io, call('computer_batch'), { actions: [{ action: 'screenshot' }] })
    await t.finish(r.io, call('computer_batch'), {}, full, ok)
    r.tick(50)
    await t.finish(r.io, call('release_full_control'), {}, { before: 'screen', counted: false }, { ok: true, text: 'Released full-screen control.' })
    expect(r.last()).toMatchObject({ mode: 'app', app: 'Gemini' })
    r.tick(50)
    await t.finish(r.io, call('app_release'), { app: GEMINI }, { before: 'app', counted: false }, { ok: true, text: 'Released com.google.GeminiMacOS.' })
    expect(r.last()).toMatchObject({ mode: 'idle', ended: T0 + 100, reason: 'released' })
  })

  test('a granted request for full control turns the light on; a declined one does not', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.finish(r.io, call('request_full_control'), {}, { before: 'idle', counted: false }, { ok: true, text: 'The user declined.' })
    expect(t.isHolding()).toBe(false)
    await t.finish(r.io, call('request_full_control'), {}, { before: 'idle', counted: false }, { ok: true, text: 'Full-screen control is already available; it does not need to be approved again.' })
    expect(r.last()).toMatchObject({ mode: 'screen', what: 'Took over the screen' })
    expect(r.launches.length).toBe(1)
  })

  test('a call that failed before Claude had any control leaves the light off, with no note', async () => {
    const r = rig()
    const t = new Tracker('s1')
    const token = await t.begin(r.io, call('computer_batch'), { actions: [{ action: 'screenshot' }] })
    await t.finish(r.io, call('computer_batch'), {}, token, { ok: false, text: '' })
    expect(r.last()).toMatchObject({ mode: 'idle' })
    expect(r.last().ended).toBeUndefined()
    // The same failure while control was already held changes nothing.
    await t.begin(r.io, call('app_click'), { app: GEMINI })
    const second = await t.begin(r.io, call('app_click'), { app: GEMINI })
    await t.finish(r.io, call('app_click'), { app: GEMINI }, second, { ok: false, text: '' })
    expect(r.last().mode).toBe('app')
  })

  test('the end of a turn hands control back, and a stop says so', async () => {
    const r = rig()
    const t = new Tracker('s1')
    const token = await t.begin(r.io, call('app_click'), { app: GEMINI })
    await t.finish(r.io, call('app_click'), { app: GEMINI }, token, ok)
    r.tick(3_000)
    await t.endTurn(r.io, 'turn-ended')
    expect(r.last()).toMatchObject({ mode: 'idle', ended: T0 + 3_000, reason: 'turn-ended' })
    const again = await t.begin(r.io, call('app_click'), { app: GEMINI })
    expect(r.last().ended).toBeUndefined()
    expect(again.before).toBe('idle')
    await t.endTurn(r.io, 'stopped')
    expect(r.last()).toMatchObject({ mode: 'idle', reason: 'stopped' })
  })

  test('only the loop that last used control can end it', async () => {
    const r = rig()
    const t = new Tracker('s1')
    const token = await t.begin(r.io, call('app_click'), { app: GEMINI }, 'agent-7')
    await t.finish(r.io, call('app_click'), { app: GEMINI }, token, ok)
    await t.endTurn(r.io, 'turn-ended')
    expect(t.isHolding()).toBe(true)
    await t.endTurn(r.io, 'turn-ended', 'agent-7')
    expect(t.isHolding()).toBe(false)
  })

  test('a turn that ends with a call still running is not an end, unless it was stopped', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.begin(r.io, call('app_click'), { app: GEMINI })
    await t.endTurn(r.io, 'turn-ended')
    expect(t.isHolding()).toBe(true)
    await t.endTurn(r.io, 'stopped')
    expect(t.isHolding()).toBe(false)
  })

  test('a beat keeps a quiet hold alive and lets go of one nobody has used for ten minutes', async () => {
    const r = rig()
    const t = new Tracker('s1')
    const token = await t.begin(r.io, call('app_click'), { app: GEMINI })
    await t.finish(r.io, call('app_click'), { app: GEMINI }, token, ok)
    const before = r.writes.length
    r.tick(5_000)
    await t.beat(r.io)
    expect(r.writes.length).toBe(before + 1)
    expect(r.last()).toMatchObject({ mode: 'app', beat: T0 + 5_000 })
    r.tick(IDLE_RELEASE_MS)
    await t.beat(r.io)
    expect(r.last()).toMatchObject({ mode: 'idle', reason: 'turn-ended' })
    const quiet = r.writes.length
    r.tick(5_000)
    await t.beat(r.io)
    expect(r.writes.length).toBe(quiet)
  })

  test('the light program is started again now and then while control is held, not on every call', async () => {
    const r = rig()
    const t = new Tracker('s1')
    for (let i = 0; i < 4; i++) {
      const token = await t.begin(r.io, call('app_click'), { app: GEMINI })
      r.tick(1_000)
      await t.finish(r.io, call('app_click'), { app: GEMINI }, token, ok)
    }
    expect(r.launches.length).toBe(1)
    r.tick(RELAUNCH_MS)
    await t.beat(r.io)
    expect(r.launches.length).toBe(2)
  })

  test('names the tools reported are used for the app', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.finish(r.io, call('request_access'), {}, { before: 'idle', counted: false }, {
      ok: true,
      text: '{"granted":[{"bundleId":"com.example.Foo","displayName":"Foo Studio","tier":"full"}],"denied":[]}',
    })
    await t.begin(r.io, call('app_click'), { app: 'com.example.Foo' })
    expect(r.last().app).toBe('Foo Studio')
  })

  test('stopping the session clears the light at once, with no note', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.begin(r.io, call('app_click'), { app: GEMINI })
    await t.stop(r.io)
    expect(r.last()).toMatchObject({ mode: 'idle', busy: false })
    expect(r.last().ended).toBeUndefined()
  })

  test('a session that never held control leaves no file behind when it ends', async () => {
    const r = rig()
    const t = new Tracker('s1')
    await t.stop(r.io)
    expect(r.writes.length).toBe(0)
  })

  test('a write that fails is said once and never thrown, and later writes still go out', async () => {
    const r = rig()
    const t = new Tracker('s1')
    r.failWrites(true)
    await t.begin(r.io, call('app_click'), { app: GEMINI })
    await t.beat(r.io)
    expect(r.problems.length).toBe(1)
    expect(r.problems[0]).toContain('disk full')
    r.failWrites(false)
    r.tick(1_000)
    await t.beat(r.io)
    expect(r.last()).toMatchObject({ mode: 'app' })
  })
})

// ---------------------------------------------------------------------------
// The hooks, through the engine
// ---------------------------------------------------------------------------

type Run = readonly string[]

async function boot($: Engine, on: On, options: { built?: boolean; running?: boolean; start?: boolean } = {}) {
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, { HOME: '/Users/hunter' })
  const writes: { path: string; state: LightState }[] = []
  const runs: Run[] = []
  const logs: string[] = []
  const commands: string[] = []
  const flags = { built: options.built ?? true, running: options.running ?? false, failWrites: false, buildOk: true }
  const engine = { answer: (): Record<string, unknown> => ({ result: { ok: true }, text: 'ok' }) as Record<string, unknown> }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: flags.built }))
  on('fs.write', (_, e) => {
    if (flags.failWrites) return { deny: 'disk full' }
    writes.push({ path: e.path, state: JSON.parse(e.text) as LightState })
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const base = { stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (e.argv[0] === '/usr/bin/pgrep') return { value: { ...base, exitCode: flags.running ? 0 : 1 } }
    if (e.argv[0] === '/bin/bash') return { value: { ...base, exitCode: flags.buildOk ? 0 : 1, stdout: flags.buildOk ? 'built /x/Screen Light.app' : '', stderr: flags.buildOk ? '' : 'swiftc: command not found' } }
    return { value: { ...base, exitCode: 0 } }
  })
  on('tool.call', () => engine.answer() as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  if (options.start !== false) await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const states = () => writes.filter(w => w.path.endsWith('/sess-1.json')).map(w => w.state)
  return { clock, writes, runs, logs, commands, flags, engine, states }
}

const control = (tool: string, args: Record<string, unknown> = {}) => ({ ...args, tool: `mcp__computer-use__${tool}` as const })
const COMPLETE = { answer: '', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('a session registers /screen-light and does not build when the program is there', async ($, on) => {
  const h = await boot($, on)
  expect(h.commands).toEqual(['screen-light'])
  expect(h.runs.length).toBe(0)
})

test('a session without the program builds it in the background, by itself', async ($, on) => {
  const h = await boot($, on, { built: false })
  expect(h.runs.length).toBe(1)
  expect(h.runs[0]?.slice(0, 3)).toEqual(['/bin/sh', '-c', 'nohup "$0" >/dev/null 2>&1 &'])
  expect(h.runs[0]?.[3]?.endsWith('/app/build.sh')).toBe(true)
})

test('a computer-use call writes the light on, runs, and writes it settled, and the answer comes back untouched', async ($, on) => {
  const h = await boot($, on)
  const answer = { result: { ok: true }, text: 'ok (AXPress on AXButton)' }
  h.engine.answer = () => answer
  const got = await $.tool.call(control('app_click', { app: GEMINI, element_index: 8, action_summary: 'Chooses "Create images"' }))
  expect(got).toEqual(answer)
  const states = h.states()
  expect(states.length).toBe(2)
  expect(states[0]).toMatchObject({ mode: 'app', busy: true, app: 'Gemini', what: 'Chooses "Create images"' })
  expect(states[1]).toMatchObject({ mode: 'app', busy: false })
  expect(h.writes[0]?.path).toBe('/Users/hunter/.claude/screen-light/state/sess-1.json')
  expect(h.runs.filter(run => run[0] === '/usr/bin/open').map(run => run.slice(0, 2))).toEqual([['/usr/bin/open', '-g']])
  expect(h.runs.find(run => run[0] === '/usr/bin/open')?.[2]?.endsWith('/app/Screen Light.app')).toBe(true)
})

test('a tool that is not a computer-use tool writes nothing', async ($, on) => {
  const h = await boot($, on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'mcp__desk-art__status' })
  await $.tool.call(control('list_apps'))
  expect(h.writes.length).toBe(0)
})

test('the names the tools report are learned from their answers', async ($, on) => {
  const h = await boot($, on)
  h.engine.answer = () => ({ result: {}, text: '{"granted":[{"bundleId":"com.google.GeminiMacOS","displayName":"Gemini Pro","tier":"full"}],"denied":[]}' })
  await $.tool.call(control('request_access', { apps: [GEMINI], reason: 'test' }))
  expect(h.writes.length).toBe(0)
  h.engine.answer = () => ({ result: {}, text: 'ok' })
  await $.tool.call(control('app_click', { app: GEMINI }))
  expect(h.states()[0]?.app).toBe('Gemini Pro')
})

test('a refused or failed call leaves the light off and the refusal comes back untouched', async ($, on) => {
  const h = await boot($, on)
  h.engine.answer = () => ({ deny: 'not allowed' })
  const refused = await $.tool.call(control('computer_batch', { actions: [{ action: 'screenshot' }] }))
  expect(refused).toEqual({ deny: 'not allowed' })
  expect(h.states().at(-1)?.mode).toBe('idle')
  h.engine.answer = () => ({ result: {}, text: 'boom', isError: true })
  await $.tool.call(control('app_click', { app: GEMINI }))
  expect(h.states().at(-1)?.mode).toBe('idle')
})

test('the end of the turn writes the green note, and an interrupted turn says it was stopped', async ($, on) => {
  const h = await boot($, on)
  await $.tool.call(control('app_click', { app: GEMINI }))
  await h.clock.advance(2_000)
  await $.turn.complete({ ...COMPLETE })
  expect(h.states().at(-1)).toMatchObject({ mode: 'idle', reason: 'turn-ended', ended: T0 + 2_000 })
  await $.tool.call(control('app_click', { app: GEMINI }))
  await $.turn.complete({ ...COMPLETE, isAborted: true, reason: 'aborted' })
  expect(h.states().at(-1)).toMatchObject({ mode: 'idle', reason: 'stopped' })
})

test('a beat every five seconds keeps the hold alive, and stops when nothing is held', async ($, on) => {
  const h = await boot($, on)
  await $.tool.call(control('app_click', { app: GEMINI }))
  const settled = h.states().length
  await h.clock.advance(5_000)
  expect(h.states().length).toBe(settled + 1)
  expect(h.states().at(-1)).toMatchObject({ mode: 'app', beat: T0 + 5_000 })
  await $.turn.complete({ ...COMPLETE })
  const after = h.states().length
  await h.clock.advance(15_000)
  expect(h.states().length).toBe(after)
})

test('ending the session clears the light and stops the beat', async ($, on) => {
  const h = await boot($, on)
  await $.tool.call(control('app_click', { app: GEMINI }))
  await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: {} as never })
  expect(h.states().at(-1)).toMatchObject({ mode: 'idle' })
  expect(h.states().at(-1)?.ended).toBeUndefined()
  const count = h.states().length
  await h.clock.advance(20_000)
  expect(h.states().length).toBe(count)
})

test('a session that never used the screen writes nothing, not even when it ends', async ($, on) => {
  const h = await boot($, on)
  await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: {} as never })
  expect(h.writes.length).toBe(0)
})

test('a light that cannot be written never breaks the call, and is reported once', async ($, on) => {
  const h = await boot($, on)
  h.flags.failWrites = true
  const answer = { result: { ok: true }, text: 'ok' }
  h.engine.answer = () => answer
  expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(answer)
  expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(answer)
  expect(h.logs.filter(line => line.startsWith('screen-light: could not update the light')).length).toBe(1)
})

test('a module loaded into a session that was already running lights the light on its first call, with no start', async ($, on) => {
  const h = await boot($, on, { start: false })
  await $.tool.call(control('app_click', { app: GEMINI }))
  expect(h.states().length).toBe(2)
  expect(h.states()[0]).toMatchObject({ mode: 'app', busy: true, app: 'Gemini' })
  await h.clock.advance(5_000)
  expect(h.states().at(-1)).toMatchObject({ beat: T0 + 5_000 })
})

test('a /clear ends the old session\u2019s hold but keeps the beat going for the new one', async ($, on) => {
  const h = await boot($, on)
  await $.tool.call(control('app_click', { app: GEMINI }))
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: {} as never })
  expect(h.states().at(-1)).toMatchObject({ mode: 'idle' })
  await $.tool.call(control('app_click', { app: GEMINI }))
  const count = h.states().length
  await h.clock.advance(5_000)
  expect(h.states().length).toBe(count + 1)
  expect(h.states().at(-1)).toMatchObject({ mode: 'app' })
})

describe('/screen-light', () => {
  const slash = async ($: Engine, args: string): Promise<string | undefined> =>
    (await $.command.run({ command: 'screen-light', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })).text

  test('help explains the three looks and the commands', async ($, on) => {
    await boot($, on)
    expect(await slash($, 'help')).toBe(HELP_TEXT)
    expect(HELP_TEXT).toContain('Orange')
    expect(HELP_TEXT).toContain('Blue')
    expect(HELP_TEXT).toContain('Green')
  })

  test('an unknown word is said plainly', async ($, on) => {
    await boot($, on)
    expect(await slash($, 'explode')).toBe('/screen-light does not know "explode". Try demo, status, build or help.')
  })

  test('the demo opens the light and plays orange, blue, green, then goes dark', async ($, on) => {
    const h = await boot($, on)
    const text = await slash($, '')
    expect(text).toContain('13 seconds')
    const demo = () => h.writes.filter(w => w.path.endsWith('/demo.json')).map(w => w.state)
    expect(demo().length).toBe(1)
    expect(demo()[0]).toMatchObject({ mode: 'screen', busy: true, what: 'Clicks the Send button', session: 'demo' })
    expect(h.runs.some(run => run[0] === '/usr/bin/open')).toBe(true)
    await h.clock.advance(4_000)
    expect(demo()[1]).toMatchObject({ mode: 'app', app: 'Gemini', since: T0 })
    await h.clock.advance(4_000)
    expect(demo()[2]).toMatchObject({ mode: 'idle', reason: 'turn-ended', ended: T0 + 8_000 })
    await h.clock.advance(5_500)
    expect(demo()[3]).toMatchObject({ mode: 'idle', beat: 0 })
  })

  test('the demo says so when the program is not built', async ($, on) => {
    const h = await boot($, on, { built: false })
    const text = await slash($, 'demo')
    expect(text).toContain('not built yet')
    expect(h.writes.length).toBe(0)
  })

  test('status says whether it is built, running, and what this session holds', async ($, on) => {
    const h = await boot($, on, { running: true })
    await $.tool.call(control('app_click', { app: GEMINI }))
    const text = (await slash($, 'status')) ?? ''
    expect(text).toContain('built')
    expect(text).toContain('Running now: yes')
    expect(text).toContain('Claude is working in Gemini in the background')
    h.flags.running = false
    expect((await slash($, 'status')) ?? '').toContain('Running now: no')
  })

  test('build runs the build script and says how it went', async ($, on) => {
    const h = await boot($, on)
    expect(await slash($, 'build')).toContain('Built the light program.')
    expect(h.runs.some(run => run[0] === '/bin/bash' && run[1]?.endsWith('/app/build.sh') === true)).toBe(true)
    h.flags.buildOk = false
    const failed = (await slash($, 'build')) ?? ''
    expect(failed).toContain('did not build')
    expect(failed).toContain('swiftc: command not found')
  })
})
