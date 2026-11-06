// Tests for the screen-light hooks module. The light program is never started here: `process.run`, `fs.write` and the
// clock are answered by hooks of the test, which stand for the engine, so each test sees exactly which files the mod
// writes, what it asks the Mac to open, and when.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  IDLE_RELEASE_MS,
  RELAUNCH_MS,
  Tracker,
  appVerb,
  classify,
  learnNames,
  mayRunWhilePaused,
  pauseFileText,
  plain,
  prettyApp,
  readPause,
  safeId,
  screenVerb,
  summaryOf,
} from '../hooks/light'
import type { Call, CallInput, Io, Kind, LightState, PauseVerdict, PauseWhy } from '../hooks/light'
import {
  CHECK_FAILED_TEXT,
  DEMO_PAUSED_TEXT,
  DEMO_TEXT,
  DEMO_UNKNOWN_TEXT,
  HELP_TEXT,
  PAUSED_TEXT,
  PAUSE_ALREADY_TEXT,
  PAUSE_DONE_TEXT,
  PAUSE_NO_LIGHT_TEXT,
  RESTART_NOTE,
  RESUME_DONE_TEXT,
  RESUME_NOT_PAUSED_TEXT,
  commandArg,
  pauseReason,
  pauseStatusText,
  spanText,
} from '../hooks/text'

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
    // The two ways of letting go on a linked computer carry the computer_ prefix too; they must stay recognised, or they would be refused while paused.
    ['mcp__remote-devices__computer_release_full_control', 'full-off'],
    ['mcp__remote-devices__computer_app_release', 'app-off'],
    ['mcp__remote-devices__computer_request_full_control', 'full-on'],
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

  test('commandArg knows pause and resume, and a bare /screen-light is still the demo', () => {
    expect(commandArg('pause')).toEqual({ kind: 'pause' })
    expect(commandArg(' PAUSE ')).toEqual({ kind: 'pause' })
    expect(commandArg('resume')).toEqual({ kind: 'resume' })
    expect(commandArg('Resume now please')).toEqual({ kind: 'resume' })
    expect(commandArg('')).toEqual({ kind: 'demo' })
  })
})

// ---------------------------------------------------------------------------
// The pause file, read by itself
// ---------------------------------------------------------------------------

describe('readPause: what the pause file says', () => {
  const unknown = (why: PauseWhy): PauseVerdict => ({ kind: 'unknown', why })
  const cases: [string, unknown, PauseVerdict][] = [
    ['paused: true, as the light writes it', '{"v":1,"paused":true,"at":1793938000000,"by":"light"}', { kind: 'paused', at: 1793938000000 }],
    ['paused: true with no time', '{"paused":true}', { kind: 'paused' }],
    ['paused: true with a time that is not a number', '{"paused":true,"at":"yesterday"}', { kind: 'paused' }],
    ['paused: true with a time that is negative', '{"paused":true,"at":-5}', { kind: 'paused' }],
    ['paused: false, an explicit resume', '{"v":1,"paused":false,"at":1793938000000,"by":"command"}', { kind: 'free' }],
    ['paused: false and nothing else', '{"paused":false}', { kind: 'free' }],
    ['an empty file', '', unknown('empty')],
    ['a file of only spaces', ' \n ', unknown('empty')],
    ['a file written only half way', '{"v":1,"paused":tr', unknown('garbled')],
    ['words that are not JSON', 'paused', unknown('garbled')],
    ['a list', '[]', unknown('shape')],
    ['null', 'null', unknown('shape')],
    ['a bare true', 'true', unknown('shape')],
    ['a string', '"paused"', unknown('shape')],
    ['a number', '5', unknown('shape')],
    ['an object with no paused', '{}', unknown('unclear')],
    ['paused as a word', '{"paused":"yes"}', unknown('unclear')],
    ['paused as a number', '{"paused":1}', unknown('unclear')],
    ['paused as null', '{"paused":null}', unknown('unclear')],
    ['something that is not text at all', 42, unknown('unreadable')],
    // A parse keeps the last of two "paused" keys and the light program the first, so a file that says it twice cannot be trusted.
    ['"paused" twice, true then false', '{"paused":true,"paused":false}', unknown('unclear')],
    ['"paused" twice, false then true', '{"paused":false,"paused":true}', unknown('unclear')],
    ['"paused" twice with the same answer', '{"v":1,"paused":false,"at":5,"paused":false}', unknown('unclear')],
    ['"paused" twice with a space before the colon', '{"paused":true,"paused" :false}', unknown('unclear')],
    ['the word paused in a value is not a second key', '{"paused":false,"by":"paused"}', { kind: 'free' }],
    ['the word paused and a colon in a value is not a second key', '{"paused":true,"at":5,"by":"paused: yes"}', { kind: 'paused', at: 5 }],
    // A byte that was not valid text reaches the mod as U+FFFD; the light program refuses such a file, so the mod does too.
    ['a byte that was not text (U+FFFD) in a value', '{"v":1,"paused":false,"by":"�"}', unknown('garbled')],
    ['a byte that was not text (U+FFFD) anywhere', '�{"v":1,"paused":false}', unknown('garbled')],
    ['the escape for U+FFFD written out is fine text', '{"v":1,"paused":false,"by":"\\uFFFD"}', { kind: 'free' }],
    ['a byte-order mark in front of the JSON', '﻿{"v":1,"paused":false}', unknown('garbled')],
  ]
  for (const [label, text, verdict] of cases) {
    test(`${label}`, () => {
      expect(readPause(text)).toEqual(verdict)
    })
  }

  test('only letting go is allowed while paused', () => {
    const kinds: Kind[] = ['screen', 'app', 'full-on', 'full-off', 'app-off', 'info']
    expect(kinds.filter(mayRunWhilePaused)).toEqual(['full-off', 'app-off'])
  })

  test('the file the mod writes has the four fields of the contract, in order, and reads back', () => {
    expect(pauseFileText(true, T0, 'command')).toBe('{"v":1,"paused":true,"at":1800000000000,"by":"command"}')
    expect(pauseFileText(false, 5, 'light')).toBe('{"v":1,"paused":false,"at":5,"by":"light"}')
    expect(readPause(pauseFileText(true, T0, 'command'))).toEqual({ kind: 'paused', at: T0 })
    expect(readPause(pauseFileText(false, T0, 'command'))).toEqual({ kind: 'free' })
  })

  test('every reason is one short plain phrase', () => {
    const all: PauseWhy[] = ['unreadable', 'empty', 'garbled', 'shape', 'unclear', 'folder']
    for (const why of all) {
      const reason = pauseReason(why)
      expect(reason.length).toBeGreaterThan(0)
      expect(reason.length).toBeLessThanOrEqual(80)
      expect(reason).not.toMatch(/[\n\r{}[\]<>]/)
    }
  })

  test('spanText says seconds, minutes or hours', () => {
    expect(spanText(0)).toBe('0s')
    expect(spanText(999)).toBe('0s')
    expect(spanText(45_000)).toBe('45s')
    expect(spanText(60_000)).toBe('1m')
    expect(spanText(125_000)).toBe('2m')
    expect(spanText(3_599_000)).toBe('59m')
    expect(spanText(3_600_000)).toBe('1h')
    expect(spanText(3_900_000)).toBe('1h 5m')
    expect(spanText(-5_000)).toBe('0s')
    expect(spanText(Number.NaN)).toBe('0s')
  })

  test('the status line for each verdict', () => {
    expect(pauseStatusText({ kind: 'free' }, T0)).toBe('not paused')
    expect(pauseStatusText({ kind: 'paused', at: T0 - 125_000 }, T0)).toBe('paused for 2m (press the button on the light or type /screen-light resume)')
    expect(pauseStatusText({ kind: 'paused' }, T0)).toBe('paused (press the button on the light or type /screen-light resume)')
    expect(pauseStatusText({ kind: 'unknown', why: 'garbled' }, T0)).toBe('unknown, the pause file cannot be read (type /screen-light resume to fix it)')
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

  test('every state file says the mod that wrote it refuses calls while paused, so the light can tell an older mod from this one', async () => {
    const r = rig()
    const t = new Tracker('s1')
    const input: CallInput = { app: GEMINI, action_summary: 'Looks' }
    const token = await t.begin(r.io, call('app_click'), input)
    r.tick(500)
    await t.finish(r.io, call('app_click'), input, token, ok)
    r.tick(500)
    await t.beat(r.io)
    r.tick(500)
    await t.endTurn(r.io, 'turn-ended')
    r.tick(500)
    await t.stop(r.io)
    expect(r.writes.length).toBeGreaterThanOrEqual(5)
    for (const state of r.writes) expect(state.pause).toBe(1)
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

const HOME = '/Users/hunter'

type BootOptions = {
  built?: boolean
  running?: boolean
  start?: boolean
  /** The whole environment the mod can read (HOME alone by default); 'fails' makes every read of it fail. */
  env?: Record<string, string> | 'fails'
}

/**
 * The engine, as lists. Beneath the mod it answers `fs.exists`, `fs.read` and `fs.write` for the pause file from a
 * little in-memory folder (every other path exists only when `built`), and counts what the engine's tool really ran.
 */
async function boot($: Engine, on: On, options: BootOptions = {}) {
  const clock = mock.clock(on, { now: T0 })
  const env = options.env ?? { HOME }
  if (env === 'fails') on('env.get', () => ({ deny: 'the environment is not available' }))
  else mock.env(on, env)
  const asked = env === 'fails' ? undefined : env['SCREEN_LIGHT_DIR']
  const pauseFile = `${asked !== undefined && asked.startsWith('/') ? asked.replace(/\/+$/, '') : `${HOME}/.claude/screen-light`}/pause.json`
  const isPause = (path: string): boolean => path.endsWith('/pause.json')
  const writes: { path: string; state: LightState }[] = []
  const pauseWrites: string[] = []
  const files = new Map<string, string>()
  const exists: string[] = []
  const reads: string[] = []
  const ran: string[] = []
  const runs: Run[] = []
  const logs: string[] = []
  const commands: string[] = []
  const flags = {
    built: options.built ?? true,
    running: options.running ?? false,
    failWrites: false,
    buildOk: true,
    /** Makes a read of any file fail with this message. */
    readFails: undefined as string | undefined,
    /** Makes the look at whether the pause file exists fail. */
    existsFails: false,
    /** Makes starting the light program fail: the call is refused outright, or the program exits with an error. */
    openFails: undefined as 'reject' | 'exit' | undefined,
  }
  const engine = {
    answer: (): Record<string, unknown> => ({ result: { ok: true }, text: 'ok' }) as Record<string, unknown>,
    /** While set, the engine's tool waits for it before answering: a call that is still running. */
    hold: undefined as Promise<void> | undefined,
    /** While set, the engine waits for it before giving the session id: whoever asked for the id is still setting up. */
    holdId: undefined as Promise<void> | undefined,
  }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', async () => {
    await engine.holdId
    return { value: 'sess-1' }
  })
  on('command.register', (_, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => {
    exists.push(e.path)
    if (isPause(e.path) && flags.existsFails) return { deny: 'EACCES: permission denied' }
    return { value: isPause(e.path) ? files.has(e.path) : flags.built }
  })
  on('fs.read', (_, e) => {
    reads.push(e.path)
    if (flags.readFails !== undefined) return { deny: flags.readFails }
    const text = files.get(e.path)
    return text === undefined ? { deny: 'ENOENT: no such file' } : { value: text }
  })
  on('fs.write', (_, e) => {
    if (flags.failWrites) return { deny: 'disk full' }
    if (isPause(e.path)) {
      files.set(e.path, e.text)
      pauseWrites.push(e.text)
      return { value: undefined }
    }
    writes.push({ path: e.path, state: JSON.parse(e.text) as LightState })
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const base = { stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (e.argv[0] === '/usr/bin/pgrep') return { value: { ...base, exitCode: flags.running ? 0 : 1 } }
    if (e.argv[0] === '/bin/bash') return { value: { ...base, exitCode: flags.buildOk ? 0 : 1, stdout: flags.buildOk ? 'built /x/Screen Light.app' : '', stderr: flags.buildOk ? '' : 'swiftc: command not found' } }
    if (e.argv[0] === '/usr/bin/open' && flags.openFails === 'reject') return { deny: 'the program could not be opened' }
    if (e.argv[0] === '/usr/bin/open' && flags.openFails === 'exit') return { value: { ...base, exitCode: 1, stderr: 'no such app' } }
    return { value: { ...base, exitCode: 0 } }
  })
  on('tool.call', async (_, e) => {
    ran.push(e.tool)
    await engine.hold
    return engine.answer() as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  if (options.start !== false) await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const states = () => writes.filter(w => w.path.endsWith('/sess-1.json')).map(w => w.state)
  return {
    clock,
    writes,
    pauseWrites,
    runs,
    logs,
    commands,
    flags,
    engine,
    states,
    exists,
    reads,
    ran,
    pauseFile,
    /** The pause file as the folder holds it now (undefined: there is none). */
    pauseText: () => files.get(pauseFile),
    /** Puts the pause file there with this text, as if the light or an editor had written it. */
    setPause: (text: string) => void files.set(pauseFile, text),
    /** The pause file is gone. */
    clearPause: () => void files.delete(pauseFile),
    /** What the pause check has cost so far: looks at the pause file, and reads of any file. */
    checks: () => ({ exists: exists.filter(isPause).length, reads: reads.length }),
    /** Every time the light program was started, as the command line given to the Mac. */
    opens: () => runs.filter(run => run[0] === '/usr/bin/open'),
  }
}

type Boot = Awaited<ReturnType<typeof boot>>

const control = (tool: string, args: Record<string, unknown> = {}) => ({ ...args, tool: `mcp__computer-use__${tool}` as const })
const COMPLETE = { answer: '', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as const

const slash = async ($: Engine, args: string): Promise<string | undefined> =>
  (await $.command.run({ command: 'screen-light', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })).text

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

/** After the turn the light must clear and stay clear: one beat while held, none afterwards, so no second tracker is left writing. */
async function expectOneTracker($: Engine, h: Boot): Promise<void> {
  expect(h.states().at(-1)).toMatchObject({ mode: 'app', busy: false })
  const settled = h.states().length
  await h.clock.advance(5_000)
  expect(h.states().length).toBe(settled + 1) // a second tracker would write a second beat
  await $.turn.complete({ ...COMPLETE })
  expect(h.states().at(-1)).toMatchObject({ mode: 'idle', reason: 'turn-ended' })
  const after = h.states().length
  await h.clock.advance(60_000)
  expect(h.states().length).toBe(after) // and one left behind would keep the light on after the turn
  expect(h.states().at(-1)).toMatchObject({ mode: 'idle' })
}

test('two first calls at once with no session start make one tracker: one beat, and the light clears when the turn ends', async ($, on) => {
  const h = await boot($, on, { start: false })
  let release: () => void = () => {}
  h.engine.holdId = new Promise<void>(resolve => {
    release = resolve
  })
  const calls = [$.tool.call(control('app_click', { app: GEMINI })), $.tool.call(control('app_click', { app: GEMINI }))]
  await h.clock.settle() // both are now setting up, waiting for the session id
  release()
  await Promise.all(calls)
  await expectOneTracker($, h)
})

test('a session start while a first call is still setting up leaves one tracker and one beat', async ($, on) => {
  const h = await boot($, on, { start: false })
  let release: () => void = () => {}
  h.engine.holdId = new Promise<void>(resolve => {
    release = resolve
  })
  const first = $.tool.call(control('app_click', { app: GEMINI })) // setting up, waiting for the session id
  await h.clock.settle()
  const start = $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true }) // starts over and sets up too
  await h.clock.settle()
  release()
  await Promise.all([first, start])
  await expectOneTracker($, h)
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

// ---------------------------------------------------------------------------
// The pause, through the engine
// ---------------------------------------------------------------------------

/** A pause that began two minutes before T0, so the status says "2m". */
const PAUSED_FILE = '{"v":1,"paused":true,"at":1799999880000,"by":"light"}'
const FREE_FILE = '{"v":1,"paused":false,"at":1799999880000,"by":"light"}'

// The two texts Claude reads, copied here from the contract, so the source cannot drift from it without a test saying so.
const CONTRACT_PAUSED =
  'Screen control is paused. The owner pressed the pause button on the Screen Light (or ran /screen-light pause), so you may not use any computer-use tool right now. Do not try another way to control the screen. Stop what you were doing, tell the owner in one short sentence that you are paused, and wait. They will press Resume on the light (or run /screen-light resume) and then tell you to continue.'
const contractCheckFailed = (reason: string): string =>
  `Screen control could not be checked just now, so this call was stopped to be safe: the Screen Light's pause file could not be read (${reason}). Try once more in a moment. If it happens again, stop and ask the owner to press Resume on the light or run /screen-light resume.`

const ANSWER = { result: { ok: true }, text: 'ok' }
const denyOf = (got: unknown): string | undefined => (got as { deny?: string }).deny

// Every kind of thing the computer-use server offers: the ones that act, ask, look around or teach, and one nobody has heard of.
const EVERY_TOOL = [
  'app_click',
  'app_screenshot',
  'open_application',
  'computer_batch',
  'left_click',
  'read_clipboard',
  'request_full_control',
  'request_access',
  'request_teach_access',
  'list_apps',
  'list_granted_applications',
  'teach_step',
  'teach_batch',
  'frobnicate',
]

describe('the pause: the words', () => {
  test('what Claude reads when it is refused is the contract’s, word for word', () => {
    expect(PAUSED_TEXT).toBe(CONTRACT_PAUSED)
    expect(CHECK_FAILED_TEXT('it is empty')).toBe(contractCheckFailed('it is empty'))
  })

  test('what the person reads after pause and resume is the contract’s, word for word', () => {
    expect(PAUSE_DONE_TEXT).toBe('Paused. Claude cannot use your screen until you resume. Press the button on the light, or type /screen-light resume.')
    expect(PAUSE_ALREADY_TEXT).toBe('Already paused. Press the button on the light, or type /screen-light resume, to let Claude use your screen again.')
    expect(RESUME_DONE_TEXT).toBe('Resumed. Claude can use your screen again. Tell it to carry on.')
    expect(RESUME_NOT_PAUSED_TEXT).toBe('Screen control was not paused.')
  })
})

describe('the pause: refusing computer-use calls', () => {
  test('with no pause file a call runs, after one look at the file and no read', async ($, on) => {
    const h = await boot($, on)
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
    expect(h.ran).toEqual(['mcp__computer-use__app_click'])
    expect(h.checks()).toEqual({ exists: 1, reads: 0 })
  })

  test('a file that says "paused": false lets the call run, after one look and one read', async ($, on) => {
    const h = await boot($, on)
    h.setPause(FREE_FILE)
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
    expect(h.ran).toEqual(['mcp__computer-use__app_click'])
    expect(h.checks()).toEqual({ exists: 1, reads: 1 })
  })

  test('while paused every kind of computer-use call is refused, and not one of them runs or writes anything', async ($, on) => {
    const h = await boot($, on)
    h.setPause(PAUSED_FILE)
    for (const tool of EVERY_TOOL) {
      expect(await $.tool.call(control(tool, { app: GEMINI, actions: [{ action: 'left_click' }] })), tool).toEqual({ deny: PAUSED_TEXT })
    }
    // The same tools of a linked computer are refused too.
    expect(await $.tool.call({ tool: 'mcp__remote-devices__computer_batch', actions: [] })).toEqual({ deny: PAUSED_TEXT })
    expect(await $.tool.call({ tool: 'mcp__remote-devices__computer_app_screenshot', app: GEMINI })).toEqual({ deny: PAUSED_TEXT })
    expect(h.ran).toEqual([])
    expect(h.writes.length).toBe(0)
    expect(h.pauseWrites.length).toBe(0)
    expect(h.checks()).toEqual({ exists: EVERY_TOOL.length + 2, reads: EVERY_TOOL.length + 2 })
  })

  test('the two ways of letting go still run while paused, and still run when the pause file cannot be read, on this Mac and on a linked computer', async ($, on) => {
    const h = await boot($, on)
    const letGo = [
      control('app_release', { app: GEMINI }),
      control('release_full_control'),
      // The linked computer's spelling carries the computer_ prefix; losing it here would leave Claude unable to let go while paused.
      { tool: 'mcp__remote-devices__computer_app_release' as const, app: GEMINI },
      { tool: 'mcp__remote-devices__computer_release_full_control' as const },
    ]
    for (const file of [PAUSED_FILE, '{broken']) {
      h.setPause(file)
      for (const one of letGo) expect(await $.tool.call(one), one.tool).toEqual(ANSWER)
    }
    h.flags.readFails = 'EACCES: permission denied'
    for (const one of letGo) expect(await $.tool.call(one), one.tool).toEqual(ANSWER)
    expect(h.ran.length).toBe(letGo.length * 3)
    expect(h.ran.every(tool => /(?:app_release|release_full_control)$/.test(tool))).toBe(true)
    expect(h.ran.filter(tool => tool.startsWith('mcp__remote-devices__')).length).toBe(6)
    // Everything else of a linked computer is refused all the same.
    h.flags.readFails = undefined
    h.setPause(PAUSED_FILE)
    expect(await $.tool.call({ tool: 'mcp__remote-devices__computer_request_full_control' })).toEqual({ deny: PAUSED_TEXT })
    expect(h.ran.length).toBe(letGo.length * 3)
  })

  test('a call that is already running is not interrupted by a pause that begins while it runs', async ($, on) => {
    const h = await boot($, on)
    let release: () => void = () => {}
    h.engine.hold = new Promise<void>(resolve => {
      release = resolve
    })
    const running = $.tool.call(control('app_click', { app: GEMINI }))
    await h.clock.settle() // it has passed the pause check and waits inside the engine's tool
    expect(h.ran).toEqual(['mcp__computer-use__app_click'])
    h.setPause(PAUSED_FILE)
    release()
    expect(await running).toEqual(ANSWER)
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual({ deny: PAUSED_TEXT })
  })

  // A pause file that cannot be trusted stops the call, with the "could not be checked" text and one short plain reason.
  const BAD: [string, (h: Boot) => void, string][] = [
    [
      'a read that fails',
      h => {
        h.setPause(PAUSED_FILE)
        h.flags.readFails = 'EACCES: permission denied, open /Users/hunter/.claude/screen-light/pause.json'
      },
      'it could not be opened',
    ],
    [
      'a look at the file that fails',
      h => {
        h.flags.existsFails = true
      },
      'it could not be opened',
    ],
    ['an empty file', h => h.setPause(''), 'it is empty'],
    ['a file written only half way', h => h.setPause('{"v":1,"paused":tr'), 'its contents are garbled'],
    ['a file that is not JSON', h => h.setPause('{"secret": "TOPSECRET"'), 'its contents are garbled'],
    ['a list', h => h.setPause('[]'), 'it is not in the expected form'],
    ['null', h => h.setPause('null'), 'it is not in the expected form'],
    ['"paused" given as a word', h => h.setPause('{"paused":"yes"}'), 'it does not say clearly whether control is paused'],
    ['an object with no "paused"', h => h.setPause('{}'), 'it does not say clearly whether control is paused'],
    // The light program and a parse disagree about which of two "paused" keys counts, so neither is believed.
    ['a file that names "paused" twice, true then false', h => h.setPause('{"v":1,"paused":true,"paused":false,"at":1,"by":"light"}'), 'it does not say clearly whether control is paused'],
    ['a file that names "paused" twice, false then true', h => h.setPause('{"v":1,"paused":false,"paused":true,"at":1,"by":"light"}'), 'it does not say clearly whether control is paused'],
    ['a byte in the file that was not text', h => h.setPause('{"v":1,"paused":false,"at":1,"by":"�"}'), 'its contents are garbled'],
    ['a byte-order mark in front of the JSON', h => h.setPause('﻿{"v":1,"paused":false,"at":1,"by":"light"}'), 'its contents are garbled'],
  ]
  for (const [label, setup, reason] of BAD) {
    test(`${label} stops the call, to be safe`, async ($, on) => {
      const h = await boot($, on)
      setup(h)
      const got = await $.tool.call(control('app_click', { app: GEMINI }))
      expect(got).toEqual({ deny: contractCheckFailed(reason) })
      // The reason is a short phrase of ours: never the file's words, an error's, or a path.
      expect(reason.length).toBeLessThanOrEqual(80)
      expect(denyOf(got)).not.toContain('TOPSECRET')
      expect(denyOf(got)).not.toContain('EACCES')
      expect(denyOf(got)).not.toContain('/Users/hunter')
      expect(h.ran).toEqual([])
      expect(h.writes.length).toBe(0)
      expect(h.pauseWrites.length).toBe(0)
    })
  }

  test('a pause file that heals (the light finishes writing it) lets the next call through', async ($, on) => {
    const h = await boot($, on)
    h.setPause('{"v":1,"paused":fal')
    expect(denyOf(await $.tool.call(control('app_click', { app: GEMINI })))).toContain('could not be checked just now')
    h.setPause(FREE_FILE)
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
    h.clearPause()
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
    expect(h.ran.length).toBe(2)
  })

  test('a refusal starts the light program so the paused light shows, but only once in 30 seconds', async ($, on) => {
    const h = await boot($, on)
    h.setPause(PAUSED_FILE)
    const refuse = () => $.tool.call(control('app_click', { app: GEMINI }))
    await refuse()
    expect(h.opens().length).toBe(1)
    expect(h.opens()[0]).toHaveLength(3)
    expect(h.opens()[0]?.slice(0, 2)).toEqual(['/usr/bin/open', '-g'])
    expect(h.opens()[0]?.[2]?.endsWith('/app/Screen Light.app')).toBe(true)
    await refuse()
    await h.clock.advance(29_999)
    await refuse()
    expect(h.opens().length).toBe(1)
    await h.clock.advance(1)
    await refuse()
    expect(h.opens().length).toBe(2)
    await refuse()
    expect(h.opens().length).toBe(2)
  })

  test('a light program that will not start never changes the refusal', async ($, on) => {
    const h = await boot($, on)
    h.setPause(PAUSED_FILE)
    for (const how of ['reject', 'exit'] as const) {
      h.flags.openFails = how
      await h.clock.advance(30_000)
      expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual({ deny: PAUSED_TEXT })
    }
    expect(h.opens().length).toBe(2)
    expect(h.ran).toEqual([])
  })

  test('a refused call does not touch the tracker or write a state file', async ($, on) => {
    const h = await boot($, on)
    // At rest: a refusal leaves no file behind and the status still says nothing is held.
    h.setPause(PAUSED_FILE)
    await $.tool.call(control('computer_batch', { actions: [{ action: 'left_click' }] }))
    expect(h.writes.length).toBe(0)
    expect(await slash($, 'status')).toContain('Claude holds nothing right now')
    // Holding an app: a refused full-screen call does not take the screen, and writes nothing more.
    h.clearPause()
    await $.tool.call(control('app_click', { app: GEMINI }))
    const before = h.writes.length
    expect(h.states().at(-1)).toMatchObject({ mode: 'app', busy: false })
    h.setPause(PAUSED_FILE)
    await $.tool.call(control('computer_batch', { actions: [{ action: 'left_click' }] }))
    expect(h.writes.length).toBe(before)
    expect(await slash($, 'status')).toContain('Claude is working in Gemini in the background')
  })

  test('a tool that is not a computer-use tool is never checked, not even while paused', async ($, on) => {
    const h = await boot($, on)
    h.setPause(PAUSED_FILE)
    const before = { exists: h.exists.length, reads: h.reads.length }
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'mcp__desk-art__status' })
    await $.tool.call({ tool: 'mcp__Claude_Browser__computer' })
    expect(h.ran).toEqual(['Bash', 'mcp__desk-art__status', 'mcp__Claude_Browser__computer'])
    // Not one look at any file, the pause file or another.
    expect(h.exists.length).toBe(before.exists)
    expect(h.reads.length).toBe(before.reads)
    expect(h.opens().length).toBe(0)
  })

  test('the check costs one look and at most one read per control call, and nothing else', async ($, on) => {
    const h = await boot($, on)
    h.setPause(FREE_FILE)
    const start = { runs: h.runs.length, logs: h.logs.length }
    for (let i = 0; i < 3; i++) await $.tool.call(control('app_screenshot', { app: GEMINI }))
    expect(h.checks()).toEqual({ exists: 3, reads: 3 })
    expect(h.reads.every(path => path === h.pauseFile)).toBe(true)
    expect(h.runs.length - start.runs).toBe(1) // the tracker starts the light once, and the check starts nothing
    expect(h.logs.length).toBe(start.logs)
  })

  test('pause by command stops the next call, and resume lets the one after run', async ($, on) => {
    const h = await boot($, on)
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
    expect(await slash($, 'pause')).toBe(PAUSE_DONE_TEXT)
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual({ deny: PAUSED_TEXT })
    expect(await $.tool.call(control('computer_batch', { actions: [{ action: 'screenshot' }] }))).toEqual({ deny: PAUSED_TEXT })
    expect(h.ran).toEqual(['mcp__computer-use__app_click'])
    expect(await slash($, 'resume')).toBe(RESUME_DONE_TEXT)
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
    expect(h.ran).toEqual(['mcp__computer-use__app_click', 'mcp__computer-use__app_click'])
  })

  test('the light’s own button works the same way: its file pauses, and its file resumes', async ($, on) => {
    const h = await boot($, on)
    h.setPause('{"v":1,"paused":true,"at":1800000000000,"by":"light"}')
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual({ deny: PAUSED_TEXT })
    h.setPause('{"v":1,"paused":false,"at":1800000005000,"by":"light"}')
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
  })
})

describe('the pause: where the files are', () => {
  test('with SCREEN_LIGHT_DIR set, the state files and the pause file are in that folder, not the home folder', async ($, on) => {
    const h = await boot($, on, { env: { HOME, SCREEN_LIGHT_DIR: '/tmp/sl-test' } })
    expect(h.pauseFile).toBe('/tmp/sl-test/pause.json')
    await $.tool.call(control('app_click', { app: GEMINI }))
    await slash($, 'demo')
    expect(h.writes.map(w => w.path)).toEqual(['/tmp/sl-test/state/sess-1.json', '/tmp/sl-test/state/sess-1.json', '/tmp/sl-test/state/demo.json'])
    expect(h.exists).toContain('/tmp/sl-test/pause.json')
    expect(await slash($, 'pause')).toBe(PAUSE_DONE_TEXT)
    expect(h.pauseText()).toBe('{"v":1,"paused":true,"at":1800000000000,"by":"command"}')
    expect(denyOf(await $.tool.call(control('app_click', { app: GEMINI })))).toBe(PAUSED_TEXT)
    expect(await slash($, 'status')).toContain('- State files: /tmp/sl-test/state')
    expect(JSON.stringify([...h.exists, ...h.reads, ...h.writes.map(w => w.path)])).not.toContain('/Users/hunter/.claude')
  })

  test('every way of starting the light passes the chosen folder on to the program', async ($, on) => {
    const h = await boot($, on, { env: { HOME, SCREEN_LIGHT_DIR: '/tmp/sl-test' } })
    await $.tool.call(control('app_click', { app: GEMINI })) // the tracker starts it
    await slash($, 'demo') // the demo
    await slash($, 'pause') // pause
    await $.tool.call(control('app_click', { app: GEMINI })) // a refusal
    await slash($, 'resume') // resume
    expect(h.opens().length).toBe(5)
    const app = h.opens()[0]?.[2]
    expect(app?.endsWith('/app/Screen Light.app')).toBe(true)
    for (const open of h.opens()) expect(open).toEqual(['/usr/bin/open', '-g', app, '--args', '--dir', '/tmp/sl-test'])
  })

  test('without the override the program is started plainly, with no arguments of its own', async ($, on) => {
    const h = await boot($, on)
    await $.tool.call(control('app_click', { app: GEMINI }))
    await slash($, 'demo')
    await slash($, 'pause')
    await $.tool.call(control('app_click', { app: GEMINI }))
    await slash($, 'resume')
    expect(h.opens().length).toBe(5)
    for (const open of h.opens()) {
      expect(open).toHaveLength(3)
      expect(open.slice(0, 2)).toEqual(['/usr/bin/open', '-g'])
    }
    expect(h.pauseFile).toBe('/Users/hunter/.claude/screen-light/pause.json')
  })

  test('a trailing slash on the override makes no difference', async ($, on) => {
    const h = await boot($, on, { env: { HOME, SCREEN_LIGHT_DIR: '/tmp/sl-test//' } })
    await $.tool.call(control('app_click', { app: GEMINI }))
    expect(h.writes[0]?.path).toBe('/tmp/sl-test/state/sess-1.json')
    expect(h.exists).toContain('/tmp/sl-test/pause.json')
    expect(h.opens()[0]?.slice(3)).toEqual(['--args', '--dir', '/tmp/sl-test'])
  })

  test('an override that is not a full path is ignored, and said so once', async ($, on) => {
    const h = await boot($, on, { env: { HOME, SCREEN_LIGHT_DIR: 'relative/dir' } })
    await $.tool.call(control('app_click', { app: GEMINI }))
    await $.tool.call(control('app_click', { app: GEMINI }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    await slash($, 'pause')
    expect(h.logs.filter(line => line.includes('SCREEN_LIGHT_DIR')).length).toBe(1)
    expect(h.logs.find(line => line.includes('SCREEN_LIGHT_DIR'))).toContain('full path')
    expect(h.writes[0]?.path).toBe('/Users/hunter/.claude/screen-light/state/sess-1.json')
    expect(h.pauseFile).toBe('/Users/hunter/.claude/screen-light/pause.json')
    expect(h.pauseText()).toBeDefined()
    expect(h.opens()[0]).toHaveLength(3)
  })

  test('an override that is set to nothing is the same as no override, and says nothing', async ($, on) => {
    const h = await boot($, on, { env: { HOME, SCREEN_LIGHT_DIR: '' } })
    await $.tool.call(control('app_click', { app: GEMINI }))
    expect(h.logs.filter(line => line.includes('SCREEN_LIGHT_DIR')).length).toBe(0)
    expect(h.writes[0]?.path).toBe('/Users/hunter/.claude/screen-light/state/sess-1.json')
    expect(h.opens()[0]).toHaveLength(3)
  })

  test('with no home folder and no override the mod does nothing, as it always has', async ($, on) => {
    const h = await boot($, on, { env: {} })
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual(ANSWER)
    expect(h.ran.length).toBe(1)
    expect(h.writes.length).toBe(0)
    expect(h.exists.some(path => path.endsWith('pause.json'))).toBe(false)
    expect(await slash($, 'pause')).toBe('Screen Light could not find your home folder, so it cannot run.')
    expect(await slash($, 'resume')).toBe('Screen Light could not find your home folder, so it cannot run.')
    expect(h.commands).toEqual(['screen-light'])
  })

  test('if the environment cannot be read at all, calls are stopped to be safe, and letting go still works', async ($, on) => {
    const h = await boot($, on, { env: 'fails' })
    expect(await $.tool.call(control('app_click', { app: GEMINI }))).toEqual({ deny: contractCheckFailed('the folder for the light could not be found') })
    expect(h.ran).toEqual([])
    expect(await $.tool.call(control('app_release', { app: GEMINI }))).toEqual(ANSWER)
    expect(h.ran).toEqual(['mcp__computer-use__app_release'])
    expect(h.commands).toEqual(['screen-light'])
  })
})

describe('/screen-light', () => {
  test('help explains the looks, the pause button and the commands', async ($, on) => {
    await boot($, on)
    expect(await slash($, 'help')).toBe(HELP_TEXT)
    expect(HELP_TEXT).toContain('Orange')
    expect(HELP_TEXT).toContain('Blue')
    expect(HELP_TEXT).toContain('Green')
    expect(HELP_TEXT).toContain('Red')
    expect(HELP_TEXT).toContain('/screen-light pause')
    expect(HELP_TEXT).toContain('/screen-light resume')
    // It no longer says the light cannot be clicked: the button can.
    expect(HELP_TEXT).not.toContain('cannot be clicked')
    // The pause button is explained in two sentences.
    const line = HELP_TEXT.split('\n').find(text => text.includes('pause button')) ?? ''
    expect(line.split(/(?<=\.)\s+/).length).toBe(2)
  })

  test('help is honest about what the pause covers, and says what to do about the green notes and old sessions', async ($, on) => {
    await boot($, on)
    const help = (await slash($, 'help')) ?? ''
    // A stop sign for the computer-use tools, not a lock; a step already under way may finish.
    expect(help).toContain('It is a stop sign, not a lock')
    expect(help).toContain('asks Claude not to find another way')
    expect(help).toContain('a step Claude has already started may still finish')
    expect(help).not.toContain('so it cannot use your screen')
    // No button on the green notes, and how to pause before Claude starts.
    expect(help).toContain('The green notes have no button, because Claude has already let go.')
    expect(help).toContain('To pause before Claude starts, type /screen-light pause.')
    // Sessions that were open before the update still have the old mod.
    expect(help).toContain(RESTART_NOTE)
    // Still one short line per idea: nothing in the help is a wall of text.
    for (const line of help.split('\n')) expect(line.length).toBeLessThan(260)
  })

  test('an unknown word is said plainly', async ($, on) => {
    await boot($, on)
    expect(await slash($, 'explode')).toBe('/screen-light does not know "explode". Try demo, status, pause, resume, build or help.')
  })

  test('pause writes the pause file, starts the light and says so', async ($, on) => {
    const h = await boot($, on)
    expect(await slash($, 'pause')).toBe(PAUSE_DONE_TEXT)
    expect(h.pauseText()).toBe('{"v":1,"paused":true,"at":1800000000000,"by":"command"}')
    expect(h.pauseWrites.length).toBe(1)
    expect(h.opens().length).toBe(1)
    expect(h.writes.length).toBe(0)
  })

  test('pause when already paused says so, and leaves the file and its time alone', async ($, on) => {
    const h = await boot($, on)
    await slash($, 'pause')
    await h.clock.advance(60_000)
    expect(await slash($, 'pause')).toBe(PAUSE_ALREADY_TEXT)
    expect(h.pauseWrites.length).toBe(1)
    expect(h.pauseText()).toBe('{"v":1,"paused":true,"at":1800000000000,"by":"command"}')
    // The light is started again, in case it was quit, so the person sees the button.
    expect(h.opens().length).toBe(2)
  })

  test('resume writes "paused": false, starts the light and says so; a second resume says it was not paused', async ($, on) => {
    const h = await boot($, on)
    await slash($, 'pause')
    await h.clock.advance(5_000)
    expect(await slash($, 'resume')).toBe(RESUME_DONE_TEXT)
    expect(h.pauseText()).toBe('{"v":1,"paused":false,"at":1800000005000,"by":"command"}')
    expect(h.opens().length).toBe(2)
    expect(await slash($, 'resume')).toBe(RESUME_NOT_PAUSED_TEXT)
    expect(h.pauseWrites.length).toBe(2)
    expect(h.opens().length).toBe(2)
  })

  test('resume with no pause file, or one that already says "paused": false, writes nothing', async ($, on) => {
    const h = await boot($, on)
    expect(await slash($, 'resume')).toBe(RESUME_NOT_PAUSED_TEXT)
    h.setPause(FREE_FILE)
    expect(await slash($, 'resume')).toBe(RESUME_NOT_PAUSED_TEXT)
    expect(h.pauseWrites.length).toBe(0)
    expect(h.pauseText()).toBe(FREE_FILE)
    expect(h.opens().length).toBe(0)
  })

  test('a pause file that cannot be understood counts as paused: resume heals it, pause rewrites it as paused', async ($, on) => {
    const h = await boot($, on)
    for (const bad of ['{"paused":"yes"}', '', '{half', '[]']) {
      h.setPause(bad)
      expect(await slash($, 'resume'), bad).toBe(RESUME_DONE_TEXT)
      expect(readPause(h.pauseText())).toEqual({ kind: 'free' })
      h.setPause(bad)
      expect(await slash($, 'pause'), bad).toBe(PAUSE_DONE_TEXT)
      expect(readPause(h.pauseText())).toEqual({ kind: 'paused', at: T0 })
    }
    // A file that cannot even be read is rewritten the same way.
    h.setPause(PAUSED_FILE)
    h.flags.readFails = 'EACCES: permission denied'
    expect(await slash($, 'resume')).toBe(RESUME_DONE_TEXT)
    expect(h.pauseText()).toBe('{"v":1,"paused":false,"at":1800000000000,"by":"command"}')
  })

  test('a pause file that cannot be written is said plainly, never as a success', async ($, on) => {
    const h = await boot($, on)
    h.flags.failWrites = true
    const paused = (await slash($, 'pause')) ?? ''
    expect(paused).toContain('NOT paused')
    expect(paused).toContain('disk full')
    expect(paused).not.toContain('Paused.')
    h.setPause(PAUSED_FILE)
    const resumed = (await slash($, 'resume')) ?? ''
    expect(resumed).toContain('may still be paused')
    expect(resumed).not.toContain('Resumed.')
    expect(h.opens().length).toBe(0)
  })

  test('status has a pause line: not paused, paused for how long, or unknown', async ($, on) => {
    const h = await boot($, on)
    expect(await slash($, 'status')).toContain('\n- Pause: not paused\n')
    h.setPause(FREE_FILE)
    expect(await slash($, 'status')).toContain('\n- Pause: not paused\n')
    h.setPause(PAUSED_FILE)
    expect(await slash($, 'status')).toContain('\n- Pause: paused for 2m (press the button on the light or type /screen-light resume)\n')
    h.setPause('{"v":1,"paused":true,"at":1799996100000}')
    expect(await slash($, 'status')).toContain('\n- Pause: paused for 1h 5m (press the button on the light or type /screen-light resume)\n')
    h.setPause('{"paused":true}')
    expect(await slash($, 'status')).toContain('\n- Pause: paused (press the button on the light or type /screen-light resume)\n')
    h.setPause('{"v":1,"paused":tr')
    expect(await slash($, 'status')).toContain('\n- Pause: unknown, the pause file cannot be read (type /screen-light resume to fix it)\n')
    h.setPause(PAUSED_FILE)
    h.flags.readFails = 'EACCES: permission denied'
    expect(await slash($, 'status')).toContain('\n- Pause: unknown, the pause file cannot be read (type /screen-light resume to fix it)\n')
  })

  test('the demo opens the light and plays orange, blue, green, then goes dark', async ($, on) => {
    const h = await boot($, on)
    const text = await slash($, '')
    expect(text).toContain('13 seconds')
    const demo = () => h.writes.filter(w => w.path.endsWith('/demo.json')).map(w => w.state)
    expect(demo().length).toBe(1)
    expect(demo()[0]).toMatchObject({ mode: 'screen', busy: true, what: 'Clicks the Send button', session: 'demo' })
    for (const frame of demo()) expect(frame).toMatchObject({ pause: 1 })
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

  test('the demo reply says the round button is real, and to restart sessions that were open before the update', async ($, on) => {
    await boot($, on)
    const text = (await slash($, '')) ?? ''
    expect(text).toBe(DEMO_TEXT)
    expect(text).toContain('13 seconds')
    expect(text).toContain('Nothing is being controlled: this is only a demo.')
    expect(text).toContain('The round button works for real: pressing it pauses Claude until you press it again.')
    expect(text).toContain(RESTART_NOTE)
    expect(RESTART_NOTE).toContain('restart it')
  })

  test('the demo while paused says the light would only show red, plays nothing, and starts the light for its Resume button', async ($, on) => {
    const h = await boot($, on)
    h.setPause(PAUSED_FILE)
    expect(await slash($, '')).toBe(DEMO_PAUSED_TEXT)
    expect(await slash($, 'demo')).toBe(DEMO_PAUSED_TEXT)
    expect(DEMO_PAUSED_TEXT).toContain('/screen-light resume')
    expect(DEMO_PAUSED_TEXT).not.toContain('orange')
    expect(h.writes.length).toBe(0) // no demo file for the light to play
    await h.clock.advance(15_000)
    expect(h.writes.length).toBe(0) // and nothing was set to play later
    expect(h.opens().length).toBe(2) // the light is started so the red look is on the screen
    expect(h.pauseText()).toBe(PAUSED_FILE) // the demo never touches the pause
    // After a resume the demo plays again, as it did before.
    expect(await slash($, 'resume')).toBe(RESUME_DONE_TEXT)
    expect(await slash($, 'demo')).toBe(DEMO_TEXT)
    expect(h.writes.filter(w => w.path.endsWith('/demo.json')).length).toBe(1)
  })

  test('the demo with a pause file that cannot be read says so too, and plays nothing', async ($, on) => {
    const h = await boot($, on)
    for (const bad of ['{broken', '', '[]', '{"paused":"yes"}']) {
      h.setPause(bad)
      expect(await slash($, 'demo'), bad).toBe(DEMO_UNKNOWN_TEXT)
    }
    h.setPause(PAUSED_FILE)
    h.flags.readFails = 'EACCES: permission denied'
    expect(await slash($, 'demo')).toBe(DEMO_UNKNOWN_TEXT)
    expect(DEMO_UNKNOWN_TEXT).toContain('/screen-light resume')
    expect(h.writes.length).toBe(0)
  })

  test('the demo while paused with the program not built still says it is not built', async ($, on) => {
    const h = await boot($, on, { built: false })
    h.setPause(PAUSED_FILE)
    expect(await slash($, 'demo')).toContain('not built yet')
    expect(h.opens().length).toBe(0)
  })

  test('pause says plainly that there is no button when the light program is not built, and resume stays plain', async ($, on) => {
    const h = await boot($, on, { built: false })
    expect(await slash($, 'pause')).toBe(`${PAUSE_DONE_TEXT} ${PAUSE_NO_LIGHT_TEXT}`)
    expect(readPause(h.pauseText())).toEqual({ kind: 'paused', at: T0 })
    expect(await slash($, 'pause')).toBe(`${PAUSE_ALREADY_TEXT} ${PAUSE_NO_LIGHT_TEXT}`)
    expect(h.pauseWrites.length).toBe(1)
    expect(h.opens().length).toBe(0) // there is no program to start
    expect(PAUSE_NO_LIGHT_TEXT).toContain('no button')
    expect(PAUSE_NO_LIGHT_TEXT).toContain('/screen-light resume')
    expect(PAUSE_NO_LIGHT_TEXT).toContain('/screen-light build')
    // Resume does not talk about a button, so it has nothing to add.
    expect(await slash($, 'resume')).toBe(RESUME_DONE_TEXT)
    expect(await slash($, 'resume')).toBe(RESUME_NOT_PAUSED_TEXT)
    expect(readPause(h.pauseText())).toEqual({ kind: 'free' })
    expect(h.opens().length).toBe(0)
  })

  test('with the program built, the pause replies are exactly the contract’s, with no note about a missing button', async ($, on) => {
    const h = await boot($, on)
    expect(await slash($, 'pause')).toBe(PAUSE_DONE_TEXT)
    expect(await slash($, 'pause')).toBe(PAUSE_ALREADY_TEXT)
    expect(h.opens().length).toBe(2)
  })

  test('status says when the light starts again; while Claude is stopped that is not "when Claude takes control"', async ($, on) => {
    const h = await boot($, on)
    expect(await slash($, 'status')).toContain('- Running now: no (it starts by itself the next time Claude takes control)')
    const again = '- Running now: no (it starts again when Claude tries to use the screen, or when you type /screen-light pause or resume)'
    h.setPause(PAUSED_FILE)
    const paused = (await slash($, 'status')) ?? ''
    expect(paused).toContain(again)
    expect(paused).not.toContain('takes control')
    // A pause file that cannot be read stops Claude too, so the same words are true.
    h.setPause('{broken')
    expect(await slash($, 'status')).toContain(again)
    h.setPause(FREE_FILE)
    expect(await slash($, 'status')).toContain('takes control')
    // A light that is running says only that.
    h.setPause(PAUSED_FILE)
    h.flags.running = true
    const running = (await slash($, 'status')) ?? ''
    expect(running).toContain('- Running now: yes\n')
    expect(running).not.toContain('starts again')
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
