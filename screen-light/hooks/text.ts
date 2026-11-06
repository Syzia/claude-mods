// screen-light: every word the person reads from the /screen-light command, kept in one place.

export const COMMAND_DESCRIPTION = 'Show or test the light on the edge of your screen that says when Claude has control of your Mac'
export const COMMAND_HINT = '[demo | status | build | help]'

export const HELP_TEXT = [
  'Screen Light shows a small light on the right edge of your screen while Claude has control of your Mac.',
  '',
  'What you will see:',
  '- Orange, "Claude has your screen": Claude is using your whole screen, mouse and keyboard. Keep your hands off.',
  '- Blue, "Claude is in <app>": Claude is working inside one app in the background. You can keep using your Mac.',
  '- Green, "Claude gave control back": shown for a few seconds when Claude lets go or finishes.',
  'The clock on the right counts how long this stretch of control has lasted.',
  '',
  'The light cannot be clicked (clicks go straight through it) and it never changes what Claude does or sees. It only watches',
  "Claude's computer-use tools, so it stays dark while Claude is only reading files, running commands or browsing in Claude's own browser.",
  '',
  'Commands:',
  '/screen-light demo    show all three looks for about 13 seconds',
  '/screen-light status  say whether the light program is built and running',
  '/screen-light build   build the light program (it is built by itself the first time; needs the Mac’s Command Line Tools)',
].join('\n')

export const NOT_BUILT_TEXT =
  'The light program is not built yet. Run /screen-light build (it takes a few seconds), then try again. ' +
  'If the build fails, the Mac probably has no Command Line Tools: run "xcode-select --install" in Terminal first.'

export const DEMO_TEXT =
  'Showing the light on the right edge of your screen for about 13 seconds: orange (Claude has your whole screen), then blue ' +
  '(Claude is working inside an app), then green (Claude gave control back). Nothing is being controlled: this is only a demo.'

export type CommandArg = { kind: 'demo' | 'status' | 'build' | 'help' } | { kind: 'unknown'; given: string }

/** What the person typed after /screen-light. Nothing at all means the demo: that is what they came to see. */
export function commandArg(args: string): CommandArg {
  const word = args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (word === '' || word === 'demo' || word === 'test') return { kind: 'demo' }
  if (word === 'status') return { kind: 'status' }
  if (word === 'build') return { kind: 'build' }
  if (word === 'help' || word === '--help' || word === '-h') return { kind: 'help' }
  return { kind: 'unknown', given: word.slice(0, 40) }
}

export function unknownCommandText(given: string): string {
  return `/screen-light does not know "${given}". Try demo, status, build or help.`
}

export function statusText(input: { built: boolean; running: boolean; holding: string; stateDir: string; app: string }): string {
  return [
    'Screen Light',
    `- The light program: ${input.built ? 'built' : 'NOT built (run /screen-light build)'}`,
    `- Running now: ${input.running ? 'yes' : 'no (it starts by itself the next time Claude takes control)'}`,
    `- This session: ${input.holding}`,
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
