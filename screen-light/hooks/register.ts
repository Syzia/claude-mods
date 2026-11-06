// screen-light: the hooks module.
//
// Watches the computer-use tools and keeps a state file per session in ~/.claude/screen-light/state, which the
// Screen Light program (app/) draws as a light on the right edge of the screen. That part only looks: it never changes
// a tool call, its answer or what Claude sees.
//
// The one thing the mod does to a call is the PAUSE. While ~/.claude/screen-light/pause.json says paused (the button on
// the light, or /screen-light pause), or cannot be read, a call to any computer-use tool is refused before it runs,
// except the two that let go. The pause check fails closed (any doubt refuses); everything else here fails open.
//
// All the deciding lives in ./light, all the words in ./text, so both can be tested without the engine.

import type { EngineInterface, Register } from 'claude-code'

import { BEAT_MS, CONTROL_TOOLS, RELAUNCH_MS, Tracker, classify, mayRunWhilePaused, pauseFileText, plain, readPause, safeId } from './light'
import type { Io, LightState, Outcome, PauseVerdict, Token } from './light'
import {
  CHECK_FAILED_TEXT,
  COMMAND_DESCRIPTION,
  COMMAND_HINT,
  DEMO_PAUSED_TEXT,
  DEMO_TEXT,
  DEMO_UNKNOWN_TEXT,
  HELP_TEXT,
  NOT_BUILT_TEXT,
  NO_HOME_TEXT,
  PAUSED_TEXT,
  PAUSE_ALREADY_TEXT,
  PAUSE_DONE_TEXT,
  PAUSE_NO_LIGHT_TEXT,
  RESUME_DONE_TEXT,
  RESUME_NOT_PAUSED_TEXT,
  buildText,
  commandArg,
  holdingText,
  pauseReason,
  pauseStatusText,
  pauseWriteFailedText,
  statusText,
  unknownCommandText,
} from './text'

type Paths = {
  /** The folder the state files and the pause file live in: ~/.claude/screen-light, or SCREEN_LIGHT_DIR. */
  dir: string
  stateDir: string
  pauseFile: string
  /** True when SCREEN_LIGHT_DIR chose the folder; the light program is then told which with --dir. */
  custom: boolean
  app: string
  binary: string
  build: string
}

function pathsFor(dir: string, custom: boolean, pluginRoot: string): Paths {
  return {
    dir,
    stateDir: `${dir}/state`,
    pauseFile: `${dir}/pause.json`,
    custom,
    app: `${pluginRoot}/app/Screen Light.app`,
    binary: `${pluginRoot}/app/Screen Light.app/Contents/MacOS/ScreenLight`,
    build: `${pluginRoot}/app/build.sh`,
  }
}

const errorText = (error: unknown): string => plain(error instanceof Error ? error.message : String(error), 160) ?? 'unknown error'

// What the module keeps between hooks. A reload starts it over.
let tracker: Tracker | undefined
let paths: Paths | undefined
let id = 'session'
let stopBeat: (() => void) | undefined
/** SCREEN_LIGHT_DIR was set to something that is not a full path, and that has been said once. */
let overrideSaid = false
/** When a refused call last started the light program (the program is started again at most every RELAUNCH_MS). */
let lastRefusalLaunch = Number.NEGATIVE_INFINITY

/**
 * Where the mod keeps its files: SCREEN_LIGHT_DIR when it names a full path (the tests and the end-to-end checks use
 * this), else ~/.claude/screen-light. Undefined when there is neither, and then the mod does nothing.
 */
async function locate($: EngineInterface): Promise<Paths | undefined> {
  const asked = await $.env.get('SCREEN_LIGHT_DIR')
  if (asked !== undefined && asked !== '') {
    const dir = asked.replace(/\/+$/, '')
    if (asked.startsWith('/') && dir !== '') return pathsFor(dir, true, $.plugin.root)
    if (!overrideSaid) {
      overrideSaid = true
      try {
        $.ui.log('screen-light: ignoring SCREEN_LIGHT_DIR because it is not a full path (it must start with /); using the usual folder')
      } catch {
        // cosmetic only
      }
    }
  }
  const home = await $.env.get('HOME')
  if (home === undefined || home === '') return undefined
  return pathsFor(`${home}/.claude/screen-light`, false, $.plugin.root)
}

/** The paths, worked out once and kept until the next session start. Rejects only if the environment could not be read. */
async function where($: EngineInterface): Promise<Paths | undefined> {
  if (paths === undefined) paths = await locate($)
  return paths
}

/**
 * The one way the light program is started, whoever asks (the tracker, the demo, pause, resume, a refused call):
 * `open -g "<app>"`, and when SCREEN_LIGHT_DIR chose the folder, `--args --dir "<folder>"` so the program looks there too.
 * Note that `open` hands `--args` only to a program it starts fresh: while a light is already running (the person's own,
 * say), `open -g` just leaves it be, and it goes on reading its own folder. A second light for a test has to be started
 * by running the program's file directly with `--dir`, which also skips its one-copy check.
 */
function startLight($: EngineInterface, paths: Paths) {
  const argv = paths.custom ? ['/usr/bin/open', '-g', paths.app, '--args', '--dir', paths.dir] : ['/usr/bin/open', '-g', paths.app]
  return $.process.run(argv, { timeoutMs: 10_000 })
}

/** The engine calls the tracker needs, made with this dispatch's `$`. */
function ioFor($: EngineInterface, paths: Paths, id: string): Io {
  return {
    now: () => $.clock.now(),
    write: text => $.fs.write(`${paths.stateDir}/${id}.json`, text),
    launch: async () => {
      const run = await startLight($, paths)
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

/**
 * Shows the three looks for about 13 seconds, through the same files and program a real session uses. While the light can
 * only show red (paused, or a pause file it cannot read) nobody would see the demo, so it says so and plays nothing; the
 * light is started so the red look and its Resume button are on the screen the reply points to.
 */
async function runDemo($: EngineInterface, paths: Paths): Promise<string> {
  if (!(await $.fs.exists(paths.binary))) return NOT_BUILT_TEXT
  const verdict = await pauseVerdict($, paths)
  if (verdict.kind !== 'free') {
    await quietly(() => startLight($, paths))
    return verdict.kind === 'paused' ? DEMO_PAUSED_TEXT : DEMO_UNKNOWN_TEXT
  }
  const file = `${paths.stateDir}/demo.json`
  const start = await $.clock.now()
  const frame = (now: number, over: Partial<LightState>): string =>
    JSON.stringify({ v: 1, session: 'demo', mode: 'idle', busy: false, since: start, last: now, beat: now, pause: 1, ...over })
  await $.fs.write(file, frame(start, { mode: 'screen', busy: true, what: 'Clicks the Send button' }))
  const run = await startLight($, paths)
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

/**
 * Sets the tracker up the first time it is needed: at the session's start, or on the first call if the module was
 * loaded into a session that was already running (a reload) and no start came.
 *
 * Calls that arrive together before the tracker exists all wait here for the folder and the session id. The tracker is
 * looked for again after those waits, with nothing to wait on between that look and the assignment, so the first to
 * finish makes the one tracker (and its beat) and the rest take it. Without the second look each would make its own, and the
 * one that lost the race would keep the light on after the turn, because only the stored tracker is ended.
 */
async function ensure($: EngineInterface): Promise<Tracker | undefined> {
  if (tracker !== undefined) return tracker
  const here = await where($)
  if (here === undefined) return undefined
  const sessionId = safeId(await $.session.id())
  if (tracker !== undefined) return tracker
  id = sessionId
  const mine = new Tracker(id)
  tracker = mine
  // While control is held a beat every few seconds tells the light the session is still alive.
  const timer = $.clock.every(BEAT_MS, () => {
    void quietly(() => mine.beat(ioFor($, here, id)))
  })
  stopBeat = () => timer.cancel()
  return mine
}

// ---------------------------------------------------------------------------
// The pause
// ---------------------------------------------------------------------------

/**
 * What the pause file says right now. It never throws and fails closed: a file that is missing is free, and only an
 * object with "paused": false is free after that; every other thing, a read that fails included, is unknown.
 */
async function pauseVerdict($: EngineInterface, paths: Paths): Promise<PauseVerdict> {
  try {
    if (!(await $.fs.exists(paths.pauseFile))) return { kind: 'free' }
    return readPause(await $.fs.read(paths.pauseFile))
  } catch {
    return { kind: 'unknown', why: 'unreadable' }
  }
}

/** Starts the light program for a refused call, so the paused light and its Resume button show; at most once every RELAUNCH_MS. */
async function relaunchForRefusal($: EngineInterface, paths: Paths): Promise<void> {
  const now = await $.clock.now()
  if (now - lastRefusalLaunch < RELAUNCH_MS) return
  lastRefusalLaunch = now
  await startLight($, paths)
}

/**
 * What a computer-use call is refused with, or undefined when it may go on. Judged before the call runs.
 * A paused light and a pause file that cannot be understood both refuse (the second with a different text);
 * the mod's folder not being found at all (no home folder, no override) refuses nothing, as it never has.
 */
async function pauseRefusal($: EngineInterface): Promise<string | undefined> {
  let found: Paths | undefined
  try {
    found = await where($)
  } catch {
    return CHECK_FAILED_TEXT(pauseReason('folder'))
  }
  if (found === undefined) return undefined
  const here = found
  const verdict = await pauseVerdict($, here)
  if (verdict.kind === 'free') return undefined
  // A failure to start the light never changes the refusal.
  await quietly(() => relaunchForRefusal($, here))
  return verdict.kind === 'paused' ? PAUSED_TEXT : CHECK_FAILED_TEXT(pauseReason(verdict.why))
}

/** Whether the light program is there to start. A look that fails counts as yes: the notes that follow are for a program known to be missing. */
async function lightBuilt($: EngineInterface, paths: Paths): Promise<boolean> {
  try {
    return await $.fs.exists(paths.binary)
  } catch {
    return true
  }
}

/**
 * /screen-light pause and resume. Reads the file first, so the reply can say it was already so (and the clock of a
 * pause that is already running is not reset); a file that cannot be read counts as paused, so resume always heals it
 * and pause rewrites it. Then writes the file and starts the light, so the person sees the result. If the light
 * program is not built there is no button to press, and the pause reply says so (starting it could not work anyway).
 */
async function setPause($: EngineInterface, paths: Paths, wantPaused: boolean): Promise<string> {
  const before = await pauseVerdict($, paths)
  const built = await lightBuilt($, paths)
  const note = wantPaused && !built ? ` ${PAUSE_NO_LIGHT_TEXT}` : ''
  if (wantPaused ? before.kind === 'paused' : before.kind === 'free') {
    if (wantPaused && built) await quietly(() => startLight($, paths))
    return (wantPaused ? PAUSE_ALREADY_TEXT : RESUME_NOT_PAUSED_TEXT) + note
  }
  try {
    await $.fs.write(paths.pauseFile, pauseFileText(wantPaused, await $.clock.now(), 'command'))
  } catch (error) {
    return pauseWriteFailedText(wantPaused, errorText(error))
  }
  if (built) await quietly(() => startLight($, paths))
  return (wantPaused ? PAUSE_DONE_TEXT : RESUME_DONE_TEXT) + note
}

export const register: Register = on => {
  // The view hooks only look. Each ends in a .catch that lets the call or event go on untouched, so a bug in the
  // light can never refuse, change or repeat anything (a call already made is replayed, never run twice). The one
  // refusal is the pause, judged first in the tool.call hook.
  on('session.start', async ($, e, next) => {
    stopBeat?.()
    stopBeat = undefined
    tracker = undefined
    paths = undefined
    try {
      await ensure($)
      if (paths !== undefined) await quietly(() => buildIfMissing($, paths as Paths))
    } catch (error) {
      $.ui.log(`screen-light: setup problem: ${errorText(error)}`)
    }
    try {
      await $.command.register({ name: 'screen-light', description: COMMAND_DESCRIPTION, argumentHint: COMMAND_HINT })
    } catch (error) {
      $.ui.log(`screen-light: setup problem: ${errorText(error)}`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: CONTROL_TOOLS }, async ($, e, next) => {
    const call = classify(e.tool)
    if (call === undefined) return next(e)
    // The pause comes first, before anything is tracked or run. Letting go is always allowed.
    if (!mayRunWhilePaused(call.kind)) {
      const refusal = await pauseRefusal($)
      if (refusal !== undefined) return { deny: refusal }
    }
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
      if (arg.kind === 'pause' || arg.kind === 'resume') {
        const folder = await where($)
        if (folder === undefined) return { text: NO_HOME_TEXT }
        return { text: await setPause($, folder, arg.kind === 'pause') }
      }
      const t = await ensure($)
      const here = paths
      if (t === undefined || here === undefined) return { text: NO_HOME_TEXT }
      if (arg.kind === 'demo') return { text: await runDemo($, here) }
      if (arg.kind === 'build') return { text: await runBuild($, here) }
      const built = await $.fs.exists(here.binary)
      let running = false
      await quietly(async () => {
        const run = await $.process.run(['/usr/bin/pgrep', '-x', 'ScreenLight'], { timeoutMs: 5_000 })
        running = run.exitCode === 0
      })
      const now = await $.clock.now()
      const state = t.snapshot(now)
      const verdict = await pauseVerdict($, here)
      return {
        text: statusText({
          built,
          running,
          stopped: verdict.kind !== 'free',
          holding: holdingText(state.mode, state.app),
          pause: pauseStatusText(verdict, now),
          stateDir: here.stateDir,
          app: here.app,
        }),
      }
    } catch (error) {
      return { text: `Screen Light hit a problem: ${errorText(error)}` }
    }
  })
}
