// screen-light: every word the person reads from the /screen-light command, kept in one place.
// The two texts Claude reads when a call is refused because screen control is paused live here too.

import type { PauseVerdict, PauseWhy } from './light'

export const COMMAND_DESCRIPTION = 'Show or test the light on the edge of your screen, and pause or resume Claude’s control of your Mac'
export const COMMAND_HINT = '[demo | status | pause | resume | build | help]'

/**
 * Said in the help and in the demo reply. A Claude session that was already open when the mod was updated keeps the old
 * mod (hooks load when a session starts), and the old mod never checks the pause, so only a restart fixes that.
 */
export const RESTART_NOTE = 'If a Claude session was already open when you updated Screen Light, restart it. Until you do, the pause cannot stop it.'

export const HELP_TEXT = [
  'Screen Light shows a small light on the right edge of your screen while Claude has control of your Mac.',
  '',
  'What you will see:',
  '- Orange, "Claude has your screen": Claude is using your whole screen, mouse and keyboard. Keep your hands off.',
  '- Blue, "Claude is in <app>": Claude is working inside one app in the background. You can keep using your Mac.',
  '- Green, "Claude gave control back": shown for a few seconds when Claude lets go or finishes.',
  '- Red, "Screen control is paused": you stopped Claude on purpose, and it stays stopped until you resume.',
  'The clock on the right counts how long this stretch of control (or this pause) has lasted.',
  '',
  'The round button on the light is the pause button. Press it and Claude is refused its computer-use tools (the ones that work your screen) until you press the button again (it shows a play triangle while paused) or type /screen-light resume.',
  'The pause stops those tools and asks Claude not to find another way. It is a stop sign, not a lock, and a step Claude has already started may still finish.',
  'The green notes have no button, because Claude has already let go. To pause before Claude starts, type /screen-light pause.',
  RESTART_NOTE,
  '',
  'Apart from that button, clicks go straight through the light to whatever is under it.',
  "Besides the pause, the light never changes what Claude does or sees. It only watches Claude's computer-use tools, so it stays dark while Claude is only reading files, running commands or browsing in Claude's own browser (unless you have paused).",
  '',
  'Commands:',
  '/screen-light demo    show all three looks for about 13 seconds',
  '/screen-light pause   stop Claude from using your screen until you resume',
  '/screen-light resume  let Claude use your screen again',
  '/screen-light status  say whether the light program is built and running, and whether Claude is paused',
  '/screen-light build   build the light program (it is built by itself the first time; needs the Mac’s Command Line Tools)',
].join('\n')

export const NOT_BUILT_TEXT =
  'The light program is not built yet. Run /screen-light build (it takes a few seconds), then try again. ' +
  'If the build fails, the Mac probably has no Command Line Tools: run "xcode-select --install" in Terminal first.'

export const DEMO_TEXT =
  'Showing the light on the right edge of your screen for about 13 seconds: orange (Claude has your whole screen), then blue ' +
  '(Claude is working inside an app), then green (Claude gave control back). Nothing is being controlled: this is only a demo. ' +
  `The round button works for real: pressing it pauses Claude until you press it again. ${RESTART_NOTE}`

/** The demo is not played while the light can only show red (paused, or a pause file that cannot be read): nobody would see it. */
export const DEMO_PAUSED_TEXT = 'Claude is paused, so the light would only show red. Type /screen-light resume (or press Resume), then try the demo again.'
export const DEMO_UNKNOWN_TEXT = 'The light would only show red, because its pause file cannot be read. Type /screen-light resume to fix it, then try the demo again.'

export const NO_HOME_TEXT = 'Screen Light could not find your home folder, so it cannot run.'

// What Claude reads when a computer-use call is refused. These two are exact (the contract fixes every word).

/** The pause file says paused. */
export const PAUSED_TEXT =
  'Screen control is paused. The owner pressed the pause button on the Screen Light (or ran /screen-light pause), so you may not use any computer-use tool right now. ' +
  'Do not try another way to control the screen. Stop what you were doing, tell the owner in one short sentence that you are paused, and wait. ' +
  'They will press Resume on the light (or run /screen-light resume) and then tell you to continue.'

/** The pause file could not be read or understood, so the call is stopped to be safe. `reason` is one short plain phrase. */
export const CHECK_FAILED_TEXT = (reason: string): string =>
  "Screen control could not be checked just now, so this call was stopped to be safe: the Screen Light's pause file could not be read " +
  `(${reason}). Try once more in a moment. If it happens again, stop and ask the owner to press Resume on the light or run /screen-light resume.`

const REASONS: Record<PauseWhy, string> = {
  unreadable: 'it could not be opened',
  empty: 'it is empty',
  garbled: 'its contents are garbled',
  shape: 'it is not in the expected form',
  unclear: 'it does not say clearly whether control is paused',
  folder: 'the folder for the light could not be found',
}

/** One short plain phrase (well under 80 characters) for why the pause file could not be understood. */
export function pauseReason(why: PauseWhy): string {
  return REASONS[why]
}

// What the person reads after /screen-light pause and /screen-light resume.

export const PAUSE_DONE_TEXT = 'Paused. Claude cannot use your screen until you resume. Press the button on the light, or type /screen-light resume.'
export const PAUSE_ALREADY_TEXT = 'Already paused. Press the button on the light, or type /screen-light resume, to let Claude use your screen again.'
export const RESUME_DONE_TEXT = 'Resumed. Claude can use your screen again. Tell it to carry on.'
export const RESUME_NOT_PAUSED_TEXT = 'Screen control was not paused.'
/** Added after a pause (or "already paused") when the light program is not built: the reply's "press the button" has no button behind it. */
export const PAUSE_NO_LIGHT_TEXT = 'The light program is not built yet, so there is no button. Type /screen-light resume when you want Claude back (/screen-light build builds it).'

/** The file could not be written, so nothing changed: said plainly, with what that means for Claude. */
export function pauseWriteFailedText(wantPaused: boolean, why: string): string {
  return wantPaused
    ? `Screen Light could not write its pause file (${why}), so Claude is NOT paused.`
    : `Screen Light could not write its pause file (${why}), so Claude may still be paused.`
}

export type CommandArg = { kind: 'demo' | 'status' | 'pause' | 'resume' | 'build' | 'help' } | { kind: 'unknown'; given: string }

/** What the person typed after /screen-light. Nothing at all means the demo: that is what they came to see. */
export function commandArg(args: string): CommandArg {
  const word = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (word === '' || word === 'demo' || word === 'test') return { kind: 'demo' }
  if (word === 'status') return { kind: 'status' }
  if (word === 'pause') return { kind: 'pause' }
  if (word === 'resume') return { kind: 'resume' }
  if (word === 'build') return { kind: 'build' }
  if (word === 'help' || word === '--help' || word === '-h') return { kind: 'help' }
  return { kind: 'unknown', given: word.slice(0, 40) }
}

export function unknownCommandText(given: string): string {
  return `/screen-light does not know "${given}". Try demo, status, pause, resume, build or help.`
}

/** A length of time in the fewest plain words: "45s", "2m", "3h", "1h 5m". */
export function spanText(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** The words after "- Pause: " in the status. */
export function pauseStatusText(verdict: PauseVerdict, now: number): string {
  if (verdict.kind === 'free') return 'not paused'
  if (verdict.kind === 'paused') {
    const how = verdict.at === undefined ? 'paused' : `paused for ${spanText(now - verdict.at)}`
    return `${how} (press the button on the light or type /screen-light resume)`
  }
  return 'unknown, the pause file cannot be read (type /screen-light resume to fix it)'
}

/**
 * `stopped` is true while Claude is held back by the pause (paused, or a pause file that cannot be read). Then Claude cannot
 * take control, so the light starts again at the next refused call, or when the person types pause or resume.
 */
export function statusText(input: { built: boolean; running: boolean; stopped: boolean; holding: string; pause: string; stateDir: string; app: string }): string {
  const startsWhen = input.stopped
    ? 'it starts again when Claude tries to use the screen, or when you type /screen-light pause or resume'
    : 'it starts by itself the next time Claude takes control'
  return [
    'Screen Light',
    `- The light program: ${input.built ? 'built' : 'NOT built (run /screen-light build)'}`,
    `- Running now: ${input.running ? 'yes' : `no (${startsWhen})`}`,
    `- This session: ${input.holding}`,
    `- Pause: ${input.pause}`,
    `- Program: ${input.app}`,
    `- State files: ${input.stateDir}`,
  ].join('\n')
}

export function holdingText(mode: 'screen' | 'app' | 'idle', app: string | undefined): string {
  if (mode === 'screen') return 'Claude has your whole screen'
  if (mode === 'app') return app === undefined ? 'Claude is working in an app in the background' : `Claude is working in ${app} in the background`
  return 'Claude holds nothing right now'
}

export function buildText(input: { ok: boolean; detail: string }): string {
  return input.ok
    ? `Built the light program. ${input.detail}`
    : `The light program did not build. ${input.detail}\nIf the Mac has no Command Line Tools, run "xcode-select --install" in Terminal and try again.`
}
