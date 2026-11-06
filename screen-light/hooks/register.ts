// screen-light: the hooks module.
//
// Watches the computer-use tools and keeps a state file per session in ~/.claude/screen-light/state, which the
// Screen Light program (app/) draws as a light on the right edge of the screen. It never changes a tool call, its
// answer or what Claude sees: every hook passes the call on untouched and only looks.
//
// All the deciding lives in ./light, all the words in ./text, so both can be tested without the engine.

import type { EngineInterface, Register } from 'claude-code'

import { BEAT_MS, CONTROL_TOOLS, Tracker, classify, plain, safeId } from './light'
import type { Io, LightState, Outcome, Token } from './light'
import {
  COMMAND_DESCRIPTION,
  COMMAND_HINT,
  DEMO_TEXT,
  HELP_TEXT,
  NOT_BUILT_TEXT,
  buildText,
  commandArg,
  holdingText,
  statusText,
  unknownCommandText,
} from './text'

type Paths = { stateDir: string; app: string; binary: string; build: string }

function pathsFor(home: string, root: string): Paths {
  return {
    stateDir: `${home}/.claude/screen-light/state`,
    app: `${root}/app/Screen Light.app`,
    binary: `${root}/app/Screen Light.app/Contents/MacOS/ScreenLight`,
    build: `${root}/app/build.sh`,
  }
}

const errorText = (error: unknown): string => plain(error instanceof Error ? error.message : String(error), 160) ?? 'unknown error'

/** The engine calls the tracker needs, made with this dispatch's `$`. */
function ioFor($: EngineInterface, paths: Paths, id: string): Io {
  return {
    now: () => $.clock.now(),
    write: text => $.fs.write(`${paths.stateDir}/${id}.json`, text),
    launch: async () => {
      const run = await $.process.run(['/usr/bin/open', '-g', paths.app], { timeoutMs: 10_000 })
      if (run.exitCode !== 0) throw new Error(`open: ${plain(run.stderr, 120) ?? `exit ${run.exitCode}`}`)
    },
    problem: text => {
      try {
        $.ui.log(`screen-light: ${text}`)
      } catch {
        // cosmetic only
      }
    },
  }
}

/** The light is a view: nothing it does may ever stop a tool call, a turn or the session. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // ignored on purpose
  }
}

/** What a tool call came to, as far as the light cares: did it run, and the text it answered with. */
function outcomeOf(result: unknown): Outcome {
  const r = (result ?? {}) as { deny?: unknown; isError?: unknown; text?: unknown; result?: unknown }
  let text = ''
  if (typeof r.text === 'string') {
    text = r.text
  } else if (r.result !== undefined) {
    try {
      text = JSON.stringify(r.result) ?? ''
    } catch {
      text = ''
    }
  }
  return { ok: typeof r.deny !== 'string' && r.isError !== true, text: text.slice(0, 20_000) }
}

/** Builds the light program in the background if it is not there yet; the shell returns at once. */
async function buildIfMissing($: EngineInterface, paths: Paths): Promise<void> {
  if (await $.fs.exists(paths.binary)) return
  await $.process.run(['/bin/sh', '-c', 'nohup "$0" >/dev/null 2>&1 &', paths.build], { timeoutMs: 10_000 })
}

/** Shows the three looks for about 13 seconds, through the same files and program a real session uses. */
async function runDemo($: EngineInterface, paths: Paths): Promise<string> {
  if (!(await $.fs.exists(paths.binary))) return NOT_BUILT_TEXT
  const file = `${paths.stateDir}/demo.json`
  const start = await $.clock.now()
  const frame = (now: number, over: Partial<LightState>): string =>
    JSON.stringify({ v: 1, session: 'demo', mode: 'idle', busy: false, since: start, last: now, beat: now, ...over })
  await $.fs.write(file, frame(start, { mode: 'screen', busy: true, what: 'Clicks the Send button' }))
  const run = await $.process.run(['/usr/bin/open', '-g', paths.app], { timeoutMs: 10_000 })
  if (run.exitCode !== 0) return `${NOT_BUILT_TEXT}\n(open said: ${plain(run.stderr, 160) ?? `exit ${run.exitCode}`})`
  const later = (ms: number, over: Partial<LightState>): void => {
    $.clock.after(ms, () => {
      void quietly(async () => $.fs.write(file, frame(await $.clock.now(), over)))
    })
  }
  later(4_000, { mode: 'app', app: 'Gemini', busy: true, what: 'Opens the + menu in the prompt box' })
  later(8_000, { mode: 'idle', ended: start + 8_000, reason: 'turn-ended' })
  later(13_500, { mode: 'idle', beat: 0 })
  return DEMO_TEXT
}

/** Builds the light program now and says how it went. */
async function runBuild($: EngineInterface, paths: Paths): Promise<string> {
  const run = await $.process.run(['/bin/bash', paths.build], { timeoutMs: 180_000 })
  const said = run.exitCode === 0 ? run.stdout : run.stderr.trim() !== '' ? run.stderr : run.stdout
  return buildText({ ok: run.exitCode === 0, detail: plain(said, 400) ?? '' })
}

// What the module keeps between hooks. A reload starts it over.
let tracker: Tracker | undefined
let paths: Paths | undefined
let id = 'session'
let stopBeat: (() => void) | undefined

/**
 * Sets the tracker up the first time it is needed: at the session's start, or on the first call if the module was
 * loaded into a session that was already running (a reload) and no start came.
 */
async function ensure($: EngineInterface): Promise<Tracker | undefined> {
  if (tracker !== undefined) return tracker
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') return undefined
  const here = pathsFor(home, $.plugin.root)
  id = safeId(await $.session.id())
  const mine = new Tracker(id)
  paths = here
  tracker = mine
  // While control is held a beat every few seconds tells the light the session is still alive.
  const timer = $.clock.every(BEAT_MS, () => {
    void quietly(() => mine.beat(ioFor($, here, id)))
  })
  stopBeat = () => timer.cancel()
  return mine
}

export const register: Register = on => {
  // Every hook here only looks. Each ends in a .catch that lets the call or event go on untouched, so a bug in the
  // light can never refuse, change or repeat anything (a call already made is replayed, never run twice).
  on('session.start', async ($, e, next) => {
    stopBeat?.()
    stopBeat = undefined
    tracker = undefined
    try {
      await ensure($)
      if (paths !== undefined) await quietly(() => buildIfMissing($, paths as Paths))
      await $.command.register({ name: 'screen-light', description: COMMAND_DESCRIPTION, argumentHint: COMMAND_HINT })
    } catch (error) {
      $.ui.log(`screen-light: setup problem: ${errorText(error)}`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: CONTROL_TOOLS }, async ($, e, next) => {
    const call = classify(e.tool)
    if (call === undefined) return next(e)
    let t = tracker
    if (t === undefined) await quietly(async () => void (t = await ensure($)))
    const here = paths
    if (t === undefined || here === undefined) return next(e)
    const tracked = t
    const io = ioFor($, here, id)
    const input = e as unknown as Record<string, unknown>
    let token: Token = { before: tracked.mode(), counted: false }
    await quietly(async () => {
      token = await tracked.begin(io, call, input, e.agentId)
    })
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } catch (error) {
      await quietly(() => tracked.finish(io, call, input, token, { ok: false, text: '' }))
      throw error
    }
    await quietly(() => tracked.finish(io, call, input, token, outcomeOf(result)))
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      const t = tracker
      const here = paths
      if (t !== undefined && here !== undefined) {
        await quietly(() => t.endTurn(ioFor($, here, id), e.isAborted ? 'stopped' : 'turn-ended', e.agentId))
      }
    }
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const t = tracker
    const here = paths
    if (t !== undefined && here !== undefined) await quietly(() => t.stop(ioFor($, here, id)))
    // After a /clear the process goes on under a new session id with no new start: keep the beat going then.
    if (e.reason !== 'clear') {
      stopBeat?.()
      stopBeat = undefined
      tracker = undefined
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'screen-light' }, async ($, e) => {
    const arg = commandArg(e.args)
    if (arg.kind === 'help') return { text: HELP_TEXT }
    if (arg.kind === 'unknown') return { text: unknownCommandText(arg.given) }
    try {
      const t = await ensure($)
      const here = paths
      if (t === undefined || here === undefined) return { text: 'Screen Light could not find your home folder, so it cannot run.' }
      if (arg.kind === 'demo') return { text: await runDemo($, here) }
      if (arg.kind === 'build') return { text: await runBuild($, here) }
      const built = await $.fs.exists(here.binary)
      let running = false
      await quietly(async () => {
        const run = await $.process.run(['/usr/bin/pgrep', '-x', 'ScreenLight'], { timeoutMs: 5_000 })
        running = run.exitCode === 0
      })
      const state = t.snapshot(await $.clock.now())
      return {
        text: statusText({ built, running, holding: holdingText(state.mode, state.app), stateDir: here.stateDir, app: here.app }),
      }
    } catch (error) {
      return { text: `Screen Light hit a problem: ${errorText(error)}` }
    }
  })
}
