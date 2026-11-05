import type { Act, Agent, Career, Lead, Task, TaskStatus, Usage } from '../types'

/** The office grows through these, by the XP the project has earned. */
export const LEVELS = [
  { xp: 0, name: 'Garage', desks: 2 },
  { xp: 60, name: 'Starter office', desks: 4 },
  { xp: 180, name: 'Studio', desks: 6 },
  { xp: 400, name: 'Agency floor', desks: 8 },
  { xp: 800, name: 'Headquarters', desks: 12 },
  { xp: 1500, name: 'Tower', desks: 16 },
] as const

export const XP = { hire: 10, task: 5, turn: 2 } as const

/** The owner's stop rule: past this share of a usage window, wrap up. */
export const WARN_AT = 95
/** From here the usage shows in the warning colour, a heads-up before the stop line. */
export const HEADS_UP = 80

type RateWindow = { kind: string; percentUsed: number; resetsAt?: string }
type Figures = { context: { percent?: number }; rateLimits: readonly RateWindow[] }

/**
 * Reads the status line's figures into the snapshot's usage, and says which
 * windows just crossed the warning line (each window, until it resets, once).
 */
export function readUsage(figures: Figures, previous: Usage | null): { usage: Usage; alerts: string[] } {
  const find = (kind: string) => figures.rateLimits.find(window => window.kind === kind)
  const session = find('five_hour')
  const week = find('seven_day')
  const warned = new Set(previous?.warned ?? [])
  const alerts: string[] = []
  for (const [label, window] of [['this 5-hour session', session], ['this week', week]] as const) {
    if (!window || window.percentUsed < WARN_AT) continue
    const key = `${window.kind}:${window.resetsAt ?? ''}`
    if (warned.has(key)) continue
    warned.add(key)
    alerts.push(`⚡ Usage at ${Math.round(window.percentUsed)}% of ${label}: time to wrap up`)
  }
  return {
    usage: {
      session: session?.percentUsed ?? null,
      week: week?.percentUsed ?? null,
      sessionResetsAt: session?.resetsAt ?? null,
      weekResetsAt: week?.resetsAt ?? null,
      context: figures.context.percent ?? null,
      warned: [...warned].slice(-10),
    },
    alerts,
  }
}

/** How many finished workers the lounge seats before the rest go home. */
export const LOUNGE_SEATS = 5
const LOG_SIZE = 8
const KEEP_AGENTS = 40

const NAMES = [
  'Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lia', 'Max',
  'Noa', 'Oti', 'Pia', 'Quin', 'Rae', 'Sol', 'Tao', 'Uma', 'Vic', 'Wren', 'Xia', 'Yuri', 'Zoe',
]

export const IDLE_LEAD: Lead = {
  status: 'waiting',
  doing: { icon: '💬', text: 'Waiting for you' },
  log: [],
  tools: 0,
}

export const NO_CAREER: Career = { hired: 0, tasksDone: 0, turns: 0 }

export function xpOf(career: Career): number {
  return career.hired * XP.hire + career.tasksDone * XP.task + career.turns * XP.turn
}

export function levelOf(career: Career) {
  const xp = xpOf(career)
  let index = 0
  LEVELS.forEach((level, i) => {
    if (xp >= level.xp) index = i
  })
  const level = LEVELS[index]!
  const next = LEVELS[index + 1]

  return { index, xp, floor: level.xp, name: level.name, desks: level.desks, next: next ?? null }
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function base(path: unknown): string {
  const text = String(path ?? '')

  return text.split('/').filter(Boolean).pop() ?? text
}

function host(url: unknown): string {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(String(url ?? ''))

  return match?.[1] ?? 'a page'
}

/** What a tool call looks like from across the office: an icon for the bubble and a short line. */
export function describeCall(tool: string, input: Record<string, unknown>): Act {
  const s = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')

  switch (tool) {
    case 'Read':
      return { icon: '📖', text: `Reading ${base(input.file_path)}` }
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✏️', text: `Editing ${base(input.file_path)}` }
    case 'NotebookEdit':
      return { icon: '✏️', text: `Editing ${base(input.notebook_path)}` }
    case 'Write':
      return { icon: '📝', text: `Writing ${base(input.file_path)}` }
    case 'Bash':
      return { icon: '💻', text: clip(s('description') || `Running ${s('command')}`, 60) }
    case 'Grep':
      return { icon: '🔍', text: clip(`Searching for "${s('pattern')}"`, 60) }
    case 'Glob':
      return { icon: '🔍', text: clip(`Looking for ${s('pattern')}`, 60) }
    case 'WebFetch':
      return { icon: '🌐', text: `Reading ${host(input.url)}` }
    case 'WebSearch':
      return { icon: '🌐', text: clip(`Searching the web: ${s('query')}`, 60) }
    case 'Agent':
    case 'Task':
      return { icon: '🤝', text: clip(`Briefing a helper: ${s('description')}`, 60) }
    case 'Skill':
      return { icon: '📚', text: `Using the ${s('skill')} skill` }
    case 'TodoWrite':
    case 'mcp__ccd_turn__update_plan':
      return { icon: '📋', text: 'Updating the task list' }
    case 'mcp__ccd_turn__wrap_up':
      return { icon: '🏁', text: 'Wrapping up' }
    case 'mcp__ccd_session__start_session':
      return { icon: '🚀', text: clip(`Starting a session: ${s('title')}`, 60) }
    case 'AskUserQuestion':
      return { icon: '❓', text: 'Asking you a question' }
    case 'Workflow':
      return { icon: '🗂️', text: 'Running a workflow' }
  }
  if (tool.startsWith('mcp__Claude_Browser__')) return { icon: '🧭', text: 'Using the browser' }
  if (tool.startsWith('mcp__')) {
    const name = tool.split('__').pop() ?? tool

    return { icon: '🔌', text: `Using ${name.replace(/_/g, ' ')}` }
  }

  return { icon: '⚙️', text: `Using ${tool}` }
}

/** The task list as the desktop app's update_plan call leaves it. */
export function applyPlan(tasks: readonly Task[], input: Record<string, unknown>): Task[] {
  if (Array.isArray(input.items)) {
    return input.items.flatMap(item => {
      const one = item as { content?: unknown; status?: unknown }
      if (typeof one.content !== 'string') return []

      return [{ content: one.content, status: asStatus(one.status) }]
    })
  }
  const list = tasks.map(task => ({ ...task }))
  if (input.advance === true) {
    const at = list.findIndex(task => task.status === 'in_progress')
    if (at >= 0) list[at]!.status = 'completed'
    const next = list.findIndex((task, i) => i > at && task.status === 'pending')
    if (next >= 0) list[next]!.status = 'in_progress'
  }
  if (Array.isArray(input.done)) {
    for (const n of input.done) {
      const task = list[Number(n) - 1]
      if (task) task.status = 'completed'
    }
  }
  if (typeof input.start === 'number') {
    const task = list[input.start - 1]
    if (task) task.status = 'in_progress'
  }

  return list
}

/** wrap_up checks off the step in progress. */
export function finishPlan(tasks: readonly Task[]): Task[] {
  return tasks.map(task => (task.status === 'in_progress' ? { ...task, status: 'completed' } : task))
}

export function fromTodos(input: Record<string, unknown>): Task[] {
  if (!Array.isArray(input.todos)) return []

  return input.todos.flatMap(item => {
    const one = item as { content?: unknown; status?: unknown }

    return typeof one.content === 'string' ? [{ content: one.content, status: asStatus(one.status) }] : []
  })
}

function asStatus(value: unknown): TaskStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'pending'
}

export function countDone(tasks: readonly Task[]): number {
  return tasks.filter(task => task.status === 'completed').length
}

export type Hire = { id: string; role: string; task: string; name?: string; team?: string; isRemote?: boolean }

export function hire(agents: readonly Agent[], one: Hire, now: number, hiredBefore: number): Agent[] {
  if (agents.some(a => a.id === one.id)) return [...agents]
  const name = one.name ? clip(one.name, 18) : NAMES[hiredBefore % NAMES.length]!
  const agent: Agent = {
    id: one.id,
    name,
    role: one.role,
    team: one.team ?? '',
    task: clip(one.task, 120),
    status: one.isRemote ? 'remote' : 'working',
    startedAt: now,
    endedAt: null,
    doing: one.isRemote
      ? { icon: '🛰️', text: 'Working in a session of its own' }
      : { icon: '☕', text: 'Settling in at the desk' },
    log: [],
    tools: 0,
    report: '',
  }

  return [...agents, agent].slice(-KEEP_AGENTS)
}

export function touch(agents: readonly Agent[], id: string, act: Act): Agent[] {
  return agents.map(agent => {
    if (agent.id !== id) return agent
    const isBack = agent.status === 'idle'

    return {
      ...agent,
      status: isBack || agent.status === 'working' ? 'working' : agent.status,
      doing: act,
      log: [...agent.log, act].slice(-LOG_SIZE),
      tools: agent.tools + 1,
    }
  })
}

export type Ending = { reason: string; isAborted: boolean; answer: string; isTeammate: boolean }

export function finish(agents: readonly Agent[], id: string, end: Ending, now: number): Agent[] {
  return agents.map(agent => {
    if (agent.id !== id) return agent
    const isFailed = end.isAborted || end.reason === 'error' || end.reason === 'refusal'
    if (end.isTeammate && !isFailed) {
      return { ...agent, status: 'idle', doing: { icon: '💤', text: 'Waiting for a message' } }
    }

    return {
      ...agent,
      status: isFailed ? 'failed' : 'done',
      endedAt: now,
      doing: isFailed
        ? { icon: '😵', text: end.isAborted ? 'Stopped early' : 'Hit a problem' }
        : { icon: '☕', text: 'Done, relaxing in the lounge' },
      report: clip(end.answer, 400),
    }
  })
}

export function leadDoes(lead: Lead, act: Act): Lead {
  return { status: 'working', doing: act, log: [...lead.log, act].slice(-LOG_SIZE), tools: lead.tools + 1 }
}

/** One day's work in one project, as `/office-report` tells it. Kept in the mod's store, one key per day. */
export type DoneJob = { name: string; role: string; task: string; ok: boolean }
export type DayLog = {
  date: string
  hired: number
  roles: Record<string, number>
  finished: number
  failed: number
  tasksDone: number
  plans: number
  steps: number
  turns: number
  done: DoneJob[]
}

export function emptyDay(date: string): DayLog {
  return { date, hired: 0, roles: {}, finished: 0, failed: 0, tasksDone: 0, plans: 0, steps: 0, turns: 0, done: [] }
}

export function isEmptyDay(day: DayLog): boolean {
  return day.hired + day.finished + day.failed + day.tasksDone + day.plans + day.steps + day.turns === 0
}

/** Adds what one session noted to what is stored, so sessions running at once never overwrite each other. */
export function mergeDay(a: DayLog, b: DayLog): DayLog {
  const roles = { ...a.roles }
  for (const [role, n] of Object.entries(b.roles)) roles[role] = (roles[role] ?? 0) + n
  return {
    date: a.date,
    hired: a.hired + b.hired,
    roles,
    finished: a.finished + b.finished,
    failed: a.failed + b.failed,
    tasksDone: a.tasksDone + b.tasksDone,
    plans: a.plans + b.plans,
    steps: a.steps + b.steps,
    turns: a.turns + b.turns,
    done: [...a.done, ...b.done].slice(-60),
  }
}

/** The local calendar day of a moment, as YYYY-MM-DD. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ROLE_WORDS: Record<string, string> = {
  Explore: 'researcher',
  Plan: 'strategist',
  'general-purpose': 'engineer',
  workflow: 'workflow agent',
  session: 'side session',
  fork: 'clone',
  teammate: 'teammate',
}

export function roleWord(role: string, count = 1): string {
  const word = ROLE_WORDS[role] ?? role.split(':').pop() ?? role
  return count === 1 ? word : `${word}s`
}

function dayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  try {
    return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  } catch {
    return date
  }
}

/** The report `/office-report` prints: the day's numbers, then what got done. */
export function dayReport(day: DayLog | null, date: string, project: string, usage: Usage | null): string {
  const title = `**🏢 Office report: ${dayName(date)}** · ${project}`
  if (!day || isEmptyDay(day)) return `${title}

Nothing recorded for that day yet.`
  const roles = Object.entries(day.roles)
    .sort((a, b) => b[1] - a[1])
    .map(([role, n]) => `${n} ${roleWord(role, n)}`)
    .join(', ')
  const lines = [
    title,
    '',
    `- 👥 Hired ${day.hired}${roles ? `: ${roles}` : ''}`,
    `- ✅ Finished ${day.finished}${day.failed ? ` · ⚠️ ${day.failed} hit a problem` : ''}`,
    `- 📋 Tasks checked off: ${day.tasksDone}${day.plans ? ` · 🍕 Plans completed: ${day.plans}` : ''}`,
    `- 💻 Steps taken: ${day.steps} · 💬 Turns: ${day.turns}`,
  ]
  if (usage && (usage.session !== null || usage.week !== null)) {
    const parts = [
      usage.session !== null ? `session ${Math.round(usage.session)}%` : null,
      usage.week !== null ? `week ${Math.round(usage.week)}%` : null,
    ].filter(Boolean)
    lines.push(`- ⚡ Usage now: ${parts.join(' · ')}`)
  }
  if (day.done.length) {
    lines.push('', '**Done today**')
    for (const job of day.done.slice(-15)) lines.push(`- ${job.ok ? '✅' : '⚠️'} ${job.name} (${roleWord(job.role)}): ${job.task}`)
  }
  return lines.join('\n')
}

/** The status line: who is busy, who is resting, and the usage. */
export function statusLine(agents: readonly Agent[], lead: Lead, usage: Usage | null): string {
  const { atDesks, lounge } = seating(agents)
  const working = atDesks.filter(a => a.status === 'working').length
  const parts = [
    working || lounge.length
      ? `🏢 ${working} working${lounge.length ? ` · ☕ ${lounge.length} on a break` : ''}`
      : `🏢 ${lead.status === 'working' ? 'Claude at work' : 'Office quiet'}`,
  ]
  if (usage && (usage.session !== null || usage.week !== null)) {
    const top = Math.max(usage.session ?? 0, usage.week ?? 0)
    const bits = [usage.session !== null ? `${Math.round(usage.session)}%` : null, usage.week !== null ? `wk ${Math.round(usage.week)}%` : null].filter(Boolean)
    parts.push(`${top >= WARN_AT ? '🔴' : '⚡'} ${bits.join(' · ')}`)
  }
  return parts.join(' · ')
}

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The staff as the office seats them: desks for the working, the lounge for the finished. */
export function seating(agents: readonly Agent[]) {
  const atDesks = agents.filter(a => a.status === 'working' || a.status === 'idle')
  const finished = agents.filter(a => a.status === 'done' || a.status === 'failed')
  const lounge = finished.slice(-LOUNGE_SEATS)

  return {
    atDesks,
    lounge,
    wentHome: finished.length - lounge.length,
    remote: agents.filter(a => a.status === 'remote'),
  }
}

/** A stable small number from a string, for colours and animation offsets. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return h >>> 0
}
