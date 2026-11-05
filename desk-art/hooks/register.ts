// desk-art: the hooks module.
//
// Registers six tools (mcp__desk-art__status, codex_image, agy_image, ingest, wait_new,
// clip_image) and the /desk-art command when the session starts, and serves each one by
// running the helper bin/desk_art.py through $.process.run. All checking and all wording
// live in ./tools so they can be tested without the engine.
//
// No state is kept here: the only things read from outside are the two settings, inboxDir
// ("Art inbox folder") and refFolders ("Folders pictures may be sent from").

import type { EngineInterface, Register } from 'claude-code'

import {
  COMMAND_DESCRIPTION,
  COMMAND_HINT,
  HELP_TEXT,
  SETUP_TEXT,
  STATUS_FOOTER,
  TOOL_SPECS,
  commandArg,
  errorText,
  helperFailedText,
  inboxOf,
  interpret,
  parseRefFolders,
  plain,
  prepare,
  toastText,
  unknownCommandText,
} from './tools'
import type { Outcome, Prepared, ToolName } from './tools'

type Ready = Extract<Prepared, { ok: true }>

/** The two settings, read once when the module is registered. */
type Settings = { inbox: string; refRoots: readonly string[] }

/** A status line or a toast that cannot be shown must never stop a tool or undo its answer. */
function show(draw: () => void): void {
  try {
    draw()
  } catch {
    // cosmetic only
  }
}

/** Runs the helper. A long run shows a status line that is always cleared again. */
async function runHelper($: EngineInterface, tool: ToolName, call: Ready, settings: Settings): Promise<Outcome> {
  show(() => $.ui.status(`desk-art: ${tool} running`))
  try {
    const run = await $.process.run(call.argv, { stdin: call.stdin, timeoutMs: call.timeoutMs })
    return interpret(tool, run, { refFolders: settings.refRoots })
  } catch (error) {
    return { kind: 'deny', text: helperFailedText(tool, errorText(error)) }
  } finally {
    show(() => $.ui.status(undefined))
  }
}

/** Answers one tool call: `{ result: text }` for the model, or `{ deny: text }` as an error. */
async function serve(
  $: EngineInterface,
  tool: ToolName,
  args: Readonly<Record<string, unknown>>,
  settings: Settings,
): Promise<{ result: string } | { deny: string }> {
  const call = prepare(tool, args, settings.inbox, $.plugin.root, settings.refRoots)
  if (!call.ok) return { deny: call.deny }
  const outcome = await runHelper($, tool, call, settings)
  if (outcome.kind === 'deny') return { deny: outcome.text }
  const toast = toastText(outcome)
  if (toast !== undefined) show(() => $.ui.toast(toast))
  return { result: outcome.text }
}

/** What a tool hook says if it fails in a way nobody planned. */
const unexpected = (tool: ToolName) => ({
  deny: `desk-art ${tool}: helper failed: the tool hook stopped unexpectedly; try again, and run /desk-art status`,
})

export const register: Register = (on, options) => {
  const refFolders = parseRefFolders(options.refFolders)
  const settings: Settings = { inbox: inboxOf(options.inboxDir), refRoots: refFolders.roots }

  on('session.start', async ($, e, next) => {
    // One tool or the command failing to register must not stop the rest, or the session.
    const failed: string[] = []
    let why = ''
    for (const spec of TOOL_SPECS) {
      try {
        await $.tool.register(spec)
      } catch (error) {
        failed.push(spec.name)
        why = why || errorText(error)
      }
    }
    try {
      await $.command.register({ name: 'desk-art', description: COMMAND_DESCRIPTION, argumentHint: COMMAND_HINT })
    } catch (error) {
      failed.push('/desk-art')
      why = why || errorText(error)
    }
    if (failed.length > 0) $.ui.log(`desk-art: could not register ${failed.join(', ')}: ${plain(why, 200)}`)
    // A refFolders setting that was ignored is said once, so the owner is not left guessing which folders count.
    if (refFolders.problem !== undefined) $.ui.log(`desk-art: ${refFolders.problem}`)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__desk-art__status' }, ($, e) => serve($, 'status', e, settings)).catch(() => unexpected('status'))
  on('tool.call', { tool: 'mcp__desk-art__codex_image' }, ($, e) => serve($, 'codex_image', e, settings)).catch(() => unexpected('codex_image'))
  on('tool.call', { tool: 'mcp__desk-art__agy_image' }, ($, e) => serve($, 'agy_image', e, settings)).catch(() => unexpected('agy_image'))
  on('tool.call', { tool: 'mcp__desk-art__ingest' }, ($, e) => serve($, 'ingest', e, settings)).catch(() => unexpected('ingest'))
  on('tool.call', { tool: 'mcp__desk-art__wait_new' }, ($, e) => serve($, 'wait_new', e, settings)).catch(() => unexpected('wait_new'))
  on('tool.call', { tool: 'mcp__desk-art__clip_image' }, ($, e) => serve($, 'clip_image', e, settings)).catch(() => unexpected('clip_image'))

  on('command.run', { command: 'desk-art' }, async ($, e) => {
    const arg = commandArg(e.args)
    if (arg.kind === 'setup') return { text: SETUP_TEXT }
    if (arg.kind === 'help') return { text: HELP_TEXT }
    if (arg.kind === 'unknown') return { text: unknownCommandText(arg.given) }

    const call = prepare('status', {}, settings.inbox, $.plugin.root, settings.refRoots)
    if (!call.ok) return { text: call.deny }
    const outcome = await runHelper($, 'status', call, settings)
    return { text: outcome.kind === 'deny' ? outcome.text : `${outcome.text}\n\n${STATUS_FOOTER}` }
  }).catch(() => ({ text: 'desk-art: the command stopped unexpectedly; try /desk-art help.' }))
}
