import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// The crab itself is a small native overlay app (overlay/CrabBuddy.swift) that
// floats above the desktop. This module starts it and tells it what Claude is
// doing by writing one small status file per chat, which the app reads.

// 'waiting': the chat needs the person; 'away': this chat sent the crab off;
// 'gone': this chat has ended. The overlay ignores the last two.
type Mood =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'away'
  | 'gone'

// What a wait is for. Once the person has seen a 'permission' wait the tool is
// taken to be running; a 'question' stays a wait until it is answered.
type Wait = 'permission' | 'question'

const OLD_PANE = 'crab'

// Whether this chat sent the crab away; kept for the session, across reloads.
const isAway = atom({ plugin: 'crab-buddy', key: 'isAway' } as const, false)
// The chat's latest prompt, cut short: how the crab's menu names this chat.
const title = atom({ plugin: 'crab-buddy', key: 'title' } as const, '')

// Tool calls that are themselves a wait for the person.
const QUESTIONS: Record<string, string> = {
  AskUserQuestion: 'Has a question',
  ExitPlanMode: 'Plan ready for you',
}

let home: string | undefined
let sessionId: string | undefined
let facts: { folder: string; host?: string; pid?: number } | undefined

const base = async ($: any) => {
  home ??= (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/crab-buddy`
}

// What does not change while the chat lives: its folder, the desktop app's id
// for it (which opens it from the crab) and the process the crab can check is
// still alive.
const about = async ($: any) => {
  if (facts === undefined) {
    const cwd: string = await $.session.cwd()
    const host: string | undefined = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
    const socket: string | undefined = await $.env.get('CLAUDE_CODE_MESSAGING_SOCKET')
    const pid = Number(/(\d+)\.sock$/.exec(socket ?? '')?.[1])

    facts = {
      folder: cwd.split('/').filter(Boolean).pop() ?? '',
      host: host || undefined,
      pid: Number.isInteger(pid) && pid > 1 ? pid : undefined,
    }
  }

  return facts
}

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}

// Never let the crab break a turn or a tool call: every failure is swallowed.
// A chat the crab was sent away from stays quiet.
const say = async ($: any, state: Mood, label: string, kind?: Wait) => {
  try {
    if (state !== 'away' && state !== 'gone' && (await read($, isAway))) {
      return
    }

    sessionId ??= await $.session.id()
    const updated = await $.clock.now()
    const status = { state, label, kind, title: await read($, title), ...(await about($)), updated }
    await $.fs.write(`${await base($)}/sessions/${sessionId}.json`, JSON.stringify(status))
  } catch {
    // the overlay just keeps its last state
  }
}

// What the crab's pill says while a tool runs.
const describe = (tool: string): string => {
  if (tool === 'Bash') return 'Running a command'
  if (tool === 'Read') return 'Reading'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'Editing'
  if (tool === 'Grep' || tool === 'Glob') return 'Searching'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'Browsing'
  if (tool === 'Agent' || tool === 'Workflow') return 'Delegating'
  if (tool.startsWith('mcp__')) return 'Using a tool'

  return `Running ${tool}`
}

// Builds the overlay app when it is missing or older than the source this mod
// ships, then starts it (a no-op when it is already floating).
const wake = async ($: any): Promise<string> => {
  try {
    const app = `${await base($)}/Crab Buddy.app`
    const wanted = (await $.fs.read(`${$.plugin.root}/overlay/VERSION`)).trim()
    let built = ''
    try {
      built = (await $.fs.read(`${await base($)}/version`)).trim()
    } catch {
      // never built
    }

    if (built !== wanted || !(await $.fs.exists(`${app}/Contents/MacOS/CrabBuddy`))) {
      const build = await $.process.run(
        ['/bin/sh', `${$.plugin.root}/overlay/build.sh`],
        { timeoutMs: 300000 },
      )

      if (build.exitCode !== 0) {
        return `Crab Buddy could not be built: ${build.stderr.slice(0, 300)}`
      }
    }

    const opened = await $.process.run(['/usr/bin/open', '-g', app])

    return opened.exitCode === 0
      ? 'The crab is on your desktop. Click it to jump to the chat, drag it to move it, right-click for the chat list and settings.'
      : `Crab Buddy could not start: ${opened.stderr.slice(0, 300)}`
  } catch (error) {
    return `Crab Buddy could not start: ${String(error)}`
  }
}

// Puts the crab in this chat (and on the desktop when he is not there yet, or
// was hidden for an hour).
const invite = async ($: any): Promise<string> => {
  await update($, isAway, () => false)
  await say($, 'idle', '')
  try {
    await $.fs.write(`${await base($)}/show`, '')
  } catch {
    // he shows up when the hour is over
  }

  return wake($)
}

// Takes the crab out of this chat; with no other chat using him, off the
// desktop too.
const dismiss = async ($: any): Promise<string> => {
  await update($, isAway, () => true)
  await say($, 'away', '')

  try {
    const dir = `${await base($)}/sessions`
    const now = await $.clock.now()
    let others = 0

    for (const entry of await $.fs.list(dir)) {
      const isOther = entry.name.endsWith('.json') && entry.name !== `${sessionId}.json`

      if (!isOther || now - entry.mtimeMs > 12 * 3600 * 1000) {
        continue
      }

      try {
        const { state } = JSON.parse(await $.fs.read(`${dir}/${entry.name}`))
        others += state === 'away' || state === 'gone' ? 0 : 1
      } catch {
        // half-written or not ours
      }
    }

    if (others > 0) {
      return `The crab has left this chat. He stays on your desktop for ${others} other ${others === 1 ? 'chat' : 'chats'}. /crab brings him back here.`
    }

    await $.process.run(['/usr/bin/pkill', '-x', 'CrabBuddy'])

    return 'The crab has left this chat and, with no other chat using him, your desktop. /crab brings him back.'
  } catch (error) {
    return `The crab has left this chat, but could not be taken off the desktop: ${String(error)}`
  }
}

export const register: Register = on => {
  let isTurnRunning = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'crab',
      description: 'Add the desktop crab to this chat',
      argumentHint: '[away]',
    })
    await $.command.register({
      name: 'crab-away',
      description: 'Take the desktop crab out of this chat',
    })
    // The first version drew the crab in a pane; the desktop crab replaces it.
    void $.ui.close({ id: OLD_PANE }).catch(() => undefined)

    if (!(await read($, isAway))) {
      void say($, 'idle', '').then(() => wake($))
    }

    return next(e)
  })

  on('command.run', { command: 'crab' }, async ($, e) => {
    const wantsAway = ['away', 'off', 'hide', 'bye'].includes(e.args.trim().toLowerCase())

    return { text: wantsAway ? await dismiss($) : await invite($) }
  })

  on('command.run', { command: 'crab-away' }, async $ => ({ text: await dismiss($) }))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = true

      if (e.text.trim() !== '') {
        await update($, title, () => clip(e.text))
      }

      await say($, 'running', 'Thinking…')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const question = QUESTIONS[e.tool]

    if (question === undefined) {
      await say($, 'running', describe(e.tool))
    } else {
      await say($, 'waiting', question, 'question')
    }

    const ran = await next(e)
    // back to thinking once the tool answers; a background agent's late call
    // must not leave the crab working after the turn is over
    await say($, isTurnRunning ? 'running' : 'idle', isTurnRunning ? 'Thinking…' : '')

    return ran
  })

  // The permission dialog is up: the chat can not go on until it is answered.
  // The tool call it belongs to is still open above, and clears this when it
  // settles.
  on('classic.PermissionRequest', async ($, e, next) => {
    await say($, 'waiting', 'Needs your OK', 'permission')

    return next(e)
  })

  // A connected tool is asking the person something.
  on('classic.Elicitation', async ($, e, next) => {
    await say($, 'waiting', 'Has a question', 'question')

    return next(e)
  })

  on('classic.ElicitationResult', async ($, e, next) => {
    await say($, isTurnRunning ? 'running' : 'idle', isTurnRunning ? 'Thinking…' : '')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = false

      if (e.reason === 'answer') {
        await say($, 'done', 'Done')
      } else if (e.reason === 'aborted') {
        await say($, 'stopped', 'Stopped')
      } else {
        await say($, 'failed', e.reason === 'refusal' ? 'Could not continue' : 'Hit an error')
      }
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await say($, 'gone', '')

    return next(e)
  })
}
