import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, TextProps } from 'claude-code'

import type { Agent, Career, Lead, Task, Usage } from '../types'
import {
  IDLE_LEAD,
  LEVELS,
  NO_CAREER,
  HEADS_UP,
  WARN_AT,
  applyPlan,
  clip,
  countDone,
  dayReport,
  describeCall,
  duration,
  emptyDay,
  finish,
  finishPlan,
  fromTodos,
  hire,
  isEmptyDay,
  leadDoes,
  levelOf,
  localDate,
  mergeDay,
  readUsage,
  seating,
  statusLine,
  touch,
} from './model'
import type { DayLog } from './model'
import { roleLabel, scene, textScene } from './scene'
import type { SceneView } from './scene'

const PANE = 'agent-office'
const TITLE = 'Office'

const agentsAtom = atom({ plugin: 'agent-office', key: 'agents' } as const, [])
const leadAtom = atom({ plugin: 'agent-office', key: 'lead' } as const, IDLE_LEAD)
const tasksAtom = atom({ plugin: 'agent-office', key: 'tasks' } as const, [])
const goalAtom = atom({ plugin: 'agent-office', key: 'goal' } as const, '')
const selectedAtom = atom({ plugin: 'agent-office', key: 'selected' } as const, null)
const careerAtom = atom({ plugin: 'agent-office', key: 'career' } as const, NO_CAREER)
const projectAtom = atom({ plugin: 'agent-office', key: 'project' } as const, '')
const usageAtom = atom({ plugin: 'agent-office', key: 'usage' } as const, null)

/** The store key for this project's career, set when the session starts. */
let careerKey = ''
/** Where this session's live snapshot goes for the 3D office app; empty until the session starts. */
let feedPath = ''
let projectRoot = ''
let home = ''
/** The sounds setting (on unless turned off in the config menu). */
let soundsOn = true
/** What this session noted today and has not yet added to the stored day. */
let pending: DayLog = emptyDay('')

/** Plays one of the mod's sounds, unless sounds are off; one that cannot play is skipped. */
function chime($: EngineInterface, name: 'finish' | 'hire' | 'party' | 'alarm') {
  if (!soundsOn) return
  try {
    void $.audio.play({ asset: `sounds/${name}.wav` }, { gain: 0.7 }).catch(() => {})
  } catch {
    // No player here (a test, a terminal without one): silence is fine.
  }
}

/** Notes a change in today's log; a new day starts at local midnight. */
async function note($: EngineInterface, change: (day: DayLog) => void) {
  const today = localDate(await $.clock.now())
  if (pending.date && pending.date !== today) await flush($)
  if (pending.date !== today) pending = emptyDay(today)
  change(pending)
}

/** Adds what this session noted to the stored day, so sessions running at once all count. */
async function flush($: EngineInterface) {
  if (!projectRoot || !pending.date || isEmptyDay(pending)) return
  const noted = pending
  pending = emptyDay(noted.date)
  const key = `day:${projectRoot}:${noted.date}`
  try {
    const stored = (await $.store.get(key)) as DayLog | undefined
    await $.store.set(key, mergeDay(stored ?? emptyDay(noted.date), noted))
  } catch {
    pending = mergeDay(pending, noted)
  }
}

/** The status line at the bottom of Claude: who is busy, who is resting, the usage. */
async function showStatus($: EngineInterface) {
  try {
    const [agents, lead, usage] = await Promise.all([read($, agentsAtom), read($, leadAtom), read($, usageAtom)])
    $.ui.status(statusLine(agents, lead, usage))
  } catch {
    // A surface without a status line: nothing to show.
  }
}

/** Writes the session as the 3D office app reads it. Never fails a hook: a snapshot missed is the next one's. */
async function publish($: EngineInterface, isEnded = false) {
  await showStatus($)
  if (!feedPath) return
  try {
    const [agents, lead, tasks, goal, career, project, usage, now] = await Promise.all([
      read($, agentsAtom),
      read($, leadAtom),
      read($, tasksAtom),
      read($, goalAtom),
      read($, careerAtom),
      read($, projectAtom),
      read($, usageAtom),
      $.clock.now(),
    ])
    const level = levelOf(career)
    const snapshot = {
      version: 1,
      sessionId: feedPath.split('/').pop()?.replace(/\.json$/, '') ?? '',
      project: project || 'Project',
      root: projectRoot,
      updatedAt: now,
      isEnded,
      goal,
      lead,
      agents,
      tasks,
      career,
      level: { index: level.index, name: level.name, xp: level.xp },
      usage,
    }
    await $.fs.write(feedPath, JSON.stringify(snapshot))
  } catch {
    // The feed is a view: the panel and the session carry on without it.
  }
}

/** Takes in the status line's figures, and warns once when a window passes the stop line. */
async function applyUsage($: EngineInterface, figures: Parameters<typeof readUsage>[0]) {
  const { usage, alerts } = readUsage(figures, await read($, usageAtom))
  await update($, usageAtom, () => usage)
  for (const alert of alerts) $.ui.toast(alert, { timeoutMs: 10000 })
  if (alerts.length) chime($, 'alarm')
}

/**
 * Opens the 3D office: the Agent Office app (its own window) when it is built,
 * else the launcher, which starts the local server and opens the browser.
 */
async function openApp($: EngineInterface): Promise<string> {
  if (!home) return 'The 3D office could not find your home folder.'
  const app = `${home}/Applications/Agent Office.app`
  if (await $.fs.exists(app)) {
    const { exitCode, stderr } = await $.process.run(['open', app], { timeoutMs: 15000 })

    return exitCode === 0 ? 'The office is opening in its own window.' : `The office app did not open: ${stderr.trim()}`
  }
  const launcher = `${home}/claude-mods/office-app/Open Office.command`
  if (!(await $.fs.exists(launcher))) return `The 3D office is not installed: ${launcher} is missing.`
  const { exitCode, stderr } = await $.process.run(['open', launcher], { timeoutMs: 15000 })

  return exitCode === 0 ? 'The 3D office is opening in your browser.' : `The 3D office did not open: ${stderr.trim()}`
}

/** Adds to what the project has earned, keeps it past the session, and cheers an upgrade. */
async function earn($: EngineInterface, change: (career: Career) => Career) {
  const before = levelOf(await read($, careerAtom))
  await update($, careerAtom, career => change(career ?? NO_CAREER))
  const after = await read($, careerAtom)
  if (careerKey) await $.store.set(careerKey, after)
  const now = levelOf(after)
  if (now.index > before.index) $.ui.toast(`🎉 The office grew: welcome to the ${now.name}!`)
}

function isPlanDone(tasks: readonly Task[]): boolean {
  return tasks.length >= 2 && tasks.every(task => task.status === 'completed')
}

async function setTasks($: EngineInterface, change: (tasks: readonly Task[]) => Task[]) {
  const was = await read($, tasksAtom)
  await update($, tasksAtom, tasks => change(tasks ?? []))
  const now = await read($, tasksAtom)
  const gained = countDone(now) - countDone(was)
  if (gained > 0) {
    await earn($, career => ({ ...career, tasksDone: career.tasksDone + gained }))
    await note($, day => {
      day.tasksDone += gained
    })
  }
  if (isPlanDone(now) && !isPlanDone(was)) {
    await note($, day => {
      day.plans += 1
    })
    $.ui.toast('🍕 Plan complete: every task is done!', { timeoutMs: 8000 })
    chime($, 'party')
  }
  if (gained > 0) await flush($)
}

export const register: Register = (on, options) => {
  soundsOn = options.sounds !== false

  on('session.start', async ($, e, next) => {
    const root = (await $.session.repo())?.root ?? (await $.session.root())
    careerKey = `career:${root}`
    projectRoot = root
    home = (await $.env.get('HOME')) ?? ''
    feedPath = home ? `${home}/claude-mods/office-feed/${await $.session.id()}.json` : ''
    const saved = (await $.store.get(careerKey)) as Partial<Career> | undefined
    await update($, projectAtom, () => root.split('/').filter(Boolean).pop() ?? 'Project')
    await update($, careerAtom, () => ({ ...NO_CAREER, ...saved }))
    await $.command.register({
      name: 'office',
      description: 'Open the agent office: every agent at a desk, the goal and the task board',
    })
    await $.command.register({
      name: 'office-3d',
      description: 'Open the 3D office app: the agents walking around a tycoon office',
    })
    await $.command.register({
      name: 'office-report',
      description: "Sum up the team's day: hires, finished work, tasks, steps and usage",
      argumentHint: '[yesterday | YYYY-MM-DD]',
    })
    try {
      await applyUsage($, await $.session.usage())
    } catch {
      // No figures yet: the first measurement brings them.
    }
    await publish($)
    // Unasked only where the panel sits beside the chat; a terminal opens it with /office.
    const isInApp = (await $.session.surfaces()).some(surface => surface !== 'terminal')
    if (isInApp) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.attach', async ($, e, next) => {
    if (e.surface !== 'terminal') void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'The office is open in its panel.' }
  })

  on('command.run', { command: 'office-3d' }, async $ => ({ text: await openApp($) }))

  on('command.run', { command: 'office-report' }, async ($, e) => {
    await flush($)
    const now = await $.clock.now()
    const asked = e.args.trim().toLowerCase()
    const date = asked === 'yesterday' ? localDate(now - 86400000) : /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : localDate(now)
    const day = projectRoot ? (((await $.store.get(`day:${projectRoot}:${date}`)) as DayLog | undefined) ?? null) : null
    const [project, usage] = await Promise.all([read($, projectAtom), read($, usageAtom)])

    return { text: dayReport(day, date, project || 'Project', usage) }
  })

  on('session.measure', async ($, e, next) => {
    await applyUsage($, e)
    await publish($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await flush($)
    await publish($, true)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()
    const goal = await read($, goalAtom)
    if (text && !text.startsWith('<') && (text.length >= 20 || !goal)) {
      await update($, goalAtom, () => clip(text.split('\n')[0] ?? text, 160))
    }
    await update($, leadAtom, lead => ({
      ...(lead ?? IDLE_LEAD),
      status: 'working' as const,
      doing: { icon: '🧠', text: 'Thinking it over' },
    }))
    await publish($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const act = describeCall(tool, input)
    const agentId = e.agentId
    await note($, day => {
      day.steps += 1
    })
    if (agentId) {
      await update($, agentsAtom, list => touch(list ?? [], agentId, act))
    } else {
      await update($, leadAtom, lead => leadDoes(lead ?? IDLE_LEAD, act))
      if (tool === 'mcp__ccd_turn__update_plan') await setTasks($, tasks => applyPlan(tasks, input))
      if (tool === 'mcp__ccd_turn__wrap_up') await setTasks($, finishPlan)
      if (tool === 'TodoWrite') await setTasks($, () => fromTodos(input))
    }
    await publish($)
    const result = await next(e)
    const isStarted = input.initiation === 'user_asked' || typeof input.proposal_id === 'string'
    if (tool === 'mcp__ccd_session__start_session' && !agentId && isStarted && !result.deny && !result.isError) {
      const title = typeof input.title === 'string' ? input.title : 'A side session'
      const name = typeof input.name === 'string' ? input.name : title
      const career = await read($, careerAtom)
      const now = await $.clock.now()
      await update($, agentsAtom, list =>
        hire(list ?? [], { id: e.tool_use_id, role: 'session', task: title, name, isRemote: true }, now, career.hired),
      )
      await earn($, c => ({ ...c, hired: c.hired + 1 }))
      await publish($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.deny) return result
    const id = result.agentId ?? `${e.tool_use_id}#${e.workflow?.agentIndex ?? 0}`
    const role = e.workflow ? 'workflow' : e.fork ? 'fork' : e.isTeammate ? 'teammate' : e.subagentType
    const team = e.workflow?.runId || e.parentAgentId || ''
    const career = await read($, careerAtom)
    const now = await $.clock.now()
    await update($, agentsAtom, list =>
      hire(list ?? [], { id, role, task: e.description || e.prompt, name: e.name, team }, now, career.hired),
    )
    await earn($, c => ({ ...c, hired: c.hired + 1 }))
    await note($, day => {
      day.hired += 1
      day.roles[role] = (day.roles[role] ?? 0) + 1
    })
    chime($, 'hire')
    await flush($)
    await publish($)

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (agentId) {
      const now = await $.clock.now()
      const isTeammate = (await read($, agentsAtom)).some(a => a.id === agentId && a.role === 'teammate')
      await update($, agentsAtom, list =>
        finish(list ?? [], agentId, { reason: e.reason, isAborted: e.isAborted, answer: e.answer, isTeammate }, now),
      )
      const agent = (await read($, agentsAtom)).find(a => a.id === agentId)
      if (agent && (agent.status === 'done' || agent.status === 'failed')) {
        const ok = agent.status === 'done'
        await note($, day => {
          if (ok) day.finished += 1
          else day.failed += 1
          day.done = [...day.done, { name: agent.name, role: agent.role, task: agent.task, ok }].slice(-60)
        })
        $.ui.toast(ok ? `✅ ${agent.name} finished: ${clip(agent.task, 70)}` : `⚠️ ${agent.name} hit a problem: ${clip(agent.task, 60)}`)
        if (ok) chime($, 'finish')
        await flush($)
      }
    } else {
      await update($, leadAtom, lead => ({
        ...(lead ?? IDLE_LEAD),
        status: 'waiting' as const,
        doing: { icon: '💬', text: e.isAborted ? 'Stopped: waiting for you' : 'Waiting for you' },
      }))
      await earn($, c => ({ ...c, turns: c.turns + 1 }))
      await note($, day => {
        day.turns += 1
      })
      await flush($)
    }
    await publish($)

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [agents, lead, tasks, goal, selected, career, project, usage] = await Promise.all([
      read($, agentsAtom),
      read($, leadAtom),
      read($, tasksAtom),
      read($, goalAtom),
      read($, selectedAtom),
      read($, careerAtom),
      read($, projectAtom),
      read($, usageAtom),
    ])
    const now = await $.clock.now()
    const level = levelOf(career)
    const view: SceneView = { project: project || 'Project', level, lead, agents, tasks, selected }
    const done = countDone(tasks)
    const select = (id: string) => () => update($, selectedAtom, current => (current === id ? null : id))
    const { atDesks, lounge, remote } = seating(agents)

    let picture
    if (e.surface === 'terminal') {
      picture = (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          {textScene(view).map(line => (
            <Text>{line}</Text>
          ))}
        </Box>
      )
    } else {
      const { Svg } = $.ui.resolve(e)
      picture = (
        <Svg
          source={scene(view).source}
          alt={`The office: ${atDesks.length} working, ${lounge.length} in the lounge`}
          isInteractive
        />
      )
    }

    const staff = [...atDesks, ...remote, ...[...lounge].reverse()]
    const card = selected === 'lead' ? leadCard(lead) : agentCard(agents.find(a => a.id === selected))

    function leadCard(one: Lead) {
      return (
        <Box key="card" flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>✳ Claude · lead</Text>
          <Text>
            {one.status === 'working' ? '💻 Working on your request' : '💬 Waiting for your next message'}
          </Text>
          <Text>
            <Text bold>Now:</Text> {one.doing.icon} {one.doing.text}
          </Text>
          {steps(one.log, one.tools)}
          <Button key="card-close" role="dismiss" onPress={() => update($, selectedAtom, () => null)}>
            Close
          </Button>
        </Box>
      )
    }

    function agentCard(one: Agent | undefined) {
      if (!one) return null
      const status =
        one.status === 'working'
          ? `💻 Working for ${duration(now - one.startedAt)}`
          : one.status === 'idle'
            ? '💤 Waiting for a message'
            : one.status === 'remote'
              ? '🛰️ Working in its own session: open it from the sidebar'
              : one.status === 'failed'
                ? `😵 ${one.doing.text} after ${duration((one.endedAt ?? now) - one.startedAt)}`
                : `☕ Finished in ${duration((one.endedAt ?? now) - one.startedAt)}, relaxing in the lounge`

      return (
        <Box key="card" flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>
            {one.name} · {roleLabel(one.role)}
          </Text>
          <Text>{status}</Text>
          <Text>
            <Text bold>Task:</Text> {one.task}
          </Text>
          {one.status !== 'remote' && (
            <Text>
              <Text bold>Now:</Text> {one.doing.icon} {one.doing.text}
            </Text>
          )}
          {steps(one.log, one.tools)}
          {one.report && (
            <Text>
              <Text bold>Report:</Text> {one.report}
            </Text>
          )}
          <Button key="card-close" role="dismiss" onPress={() => update($, selectedAtom, () => null)}>
            Close
          </Button>
        </Box>
      )
    }

    function steps(log: readonly { icon: string; text: string }[], tools: number) {
      if (log.length === 0) return null

      return (
        <Box flexDirection="column">
          <Text dimColor>
            Recent steps ({tools} in all), newest first:
          </Text>
          {[...log].reverse().map(act => (
            <Text dimColor>
              {'  '}
              {act.icon} {act.text}
            </Text>
          ))}
        </Box>
      )
    }

    const board = (['in_progress', 'pending', 'completed'] as const).map(status => {
      const list = tasks.filter(task => task.status === status)
      if (list.length === 0) return null
      const head = status === 'in_progress' ? 'Doing' : status === 'pending' ? 'To do' : 'Done'
      const mark = status === 'in_progress' ? '▶' : status === 'pending' ? '○' : '✓'

      return (
        <Box flexDirection="column">
          <Text bold>
            {head} ({list.length})
          </Text>
          {list.map(task => (
            <Text dimColor={status === 'completed'}>
              {'  '}
              {mark} {task.content}
            </Text>
          ))}
        </Box>
      )
    })

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>
            🏢 {view.project} · {level.name}
          </Text>
          <Text dimColor>
            Level {level.index + 1} of {LEVELS.length} · {level.xp} XP
            {level.next ? ` · ${level.next.xp - level.xp} XP to the ${level.next.name}` : ' · top floor'}
          </Text>
          {usageLine(usage, Text)}
          <Button key="open-3d" onPress={async () => $.ui.toast(await openApp($))}>
            🏢 Open the 3D office
          </Button>
        </Box>
        <Text>
          🎯 <Text bold>Goal:</Text> {goal || 'Send a prompt and it shows here'}
        </Text>
        <Text>
          {bar(done, tasks.length)} {tasks.length ? `${done} of ${tasks.length} tasks done` : 'No task list yet'}
        </Text>
        {picture}
        <Box flexDirection="column">
          <Text bold>Staff</Text>
          <Text dimColor>Click someone to see what they are doing.</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key="staff-lead" onPress={select('lead')}>
              {lead.doing.icon} Claude <Text dimColor>lead</Text>
            </Button>
            {staff.map(agent => (
              <Button key={`staff-${agent.id}`} onPress={select(agent.id)}>
                {badge(agent)} {agent.name} <Text dimColor>{roleLabel(agent.role)}</Text>
              </Button>
            ))}
          </Box>
        </Box>
        {card}
        <Box flexDirection="column">
          <Text bold>📋 Task board</Text>
          {tasks.length === 0 ? <Text dimColor>No task list yet. It fills in when a job is planned.</Text> : board}
        </Box>
      </Box>
    )
  })
}

/** "⚡ Session 42% · Week 63%", in the warning colour from the stop line up. */
function usageLine(usage: Usage | null, Text: ElementConstructor<TextProps>) {
  if (!usage || (usage.session === null && usage.week === null)) return null
  const parts = [
    usage.session !== null ? `Session ${Math.round(usage.session)}%` : null,
    usage.week !== null ? `Week ${Math.round(usage.week)}%` : null,
  ].filter(Boolean)
  const top = Math.max(usage.session ?? 0, usage.week ?? 0)
  if (top >= WARN_AT) return <Text color="error">⚡ {parts.join(' · ')}: past {WARN_AT}%, time to wrap up</Text>
  return <Text color={top >= HEADS_UP ? 'warning' : undefined} dimColor={top < HEADS_UP}>⚡ {parts.join(' · ')}</Text>
}

function badge(agent: Agent): string {
  if (agent.status === 'working') return agent.doing.icon
  if (agent.status === 'idle') return '💤'
  if (agent.status === 'remote') return '🛰️'
  if (agent.status === 'failed') return '😵'

  return '☕'
}

function bar(done: number, total: number): string {
  const width = 16
  const filled = total ? Math.round((width * done) / total) : 0

  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)}`
}
