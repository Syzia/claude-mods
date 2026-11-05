/** Where a worker stands: at a desk, resting in the lounge, or off in a session of its own. */
export type AgentStatus = 'working' | 'idle' | 'done' | 'failed' | 'remote'

/** One thing a worker did, as its bubble and the card show it. */
export type Act = { icon: string; text: string }

/** A helper the lead hired: a subagent, a workflow agent or a separate session. */
export type Agent = {
  id: string
  name: string
  role: string
  /** Agents started together share one: a workflow run, or the agent that started them. */
  team: string
  task: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  doing: Act
  log: Act[]
  tools: number
  report: string
}

/** The main loop: Claude, in the corner office. */
export type Lead = {
  status: 'working' | 'waiting'
  doing: Act
  log: Act[]
  tools: number
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { content: string; status: TaskStatus }

/**
 * The account's usage as the status line has it: the five-hour window, the
 * week, and this session's context, in percent. `warned` holds the windows
 * already warned about at 90%, so each crossing warns once.
 */
export type Usage = {
  session: number | null
  week: number | null
  sessionResetsAt: string | null
  weekResetsAt: string | null
  context: number | null
  warned: string[]
}

/** What the project has earned across every session: the office's level comes from it. */
export type Career = { hired: number; tasksDone: number; turns: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      agents: Agent[]
      lead: Lead
      tasks: Task[]
      goal: string
      selected: string | null
      career: Career
      project: string
      usage: Usage | null
    }
  }
}
