// A pretend session for when no real one is running, so the office is never
// empty: the lead plans, hires helpers, they work and finish, and the plan
// gets checked off. Same shape as the snapshots the mod writes.

import { rand, chance, pick } from './util.js'

const NAMES = ['Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lia', 'Max', 'Noa', 'Oti', 'Pia', 'Quin', 'Rae', 'Sol', 'Tao', 'Uma', 'Vic', 'Wren', 'Xia', 'Yuri', 'Zoe']
const STEPS = [
  { icon: '📖', text: 'Reading layout.js' },
  { icon: '🔍', text: 'Searching for "desk"' },
  { icon: '✏️', text: 'Editing office.js' },
  { icon: '💻', text: 'Running the tests' },
  { icon: '🌐', text: 'Reading docs.threejs.org' },
  { icon: '📝', text: 'Writing notes.md' },
  { icon: '🔍', text: 'Looking for *.png' },
  { icon: '💻', text: 'Building the app' },
]
const TASKS = [
  'Sketch the floor plan',
  'Build the furniture',
  'Teach the staff to walk',
  'Open the break room',
  'Pay everyone',
  'Throw a launch party',
]
const JOBS = {
  Explore: ['Find where the desks are drawn', 'Map the hallway code', 'Look for unused rooms'],
  'general-purpose': ['Fix the coffee machine', 'Wire up the elevator', 'Add a ping-pong score'],
  Plan: ['Plan the second floor', 'Draft the hiring plan'],
  workflow: ['Review the lobby', 'Test every chair', 'Audit the snack budget', 'Check the fire exits'],
}

export class Demo {
  constructor() {
    this.clock = Date.now()
    this.hired = 0
    this.turns = 0
    this.tasksDone = 0
    this.nextHire = 3
    this.leadUntil = 30
    this.session = {
      version: 1,
      sessionId: 'demo',
      project: 'Demo Co.',
      root: 'demo',
      updatedAt: this.clock,
      isEnded: false,
      goal: 'Build a cosy office for the agents',
      lead: { status: 'working', doing: { icon: '🧠', text: 'Thinking it over' }, log: [], tools: 0 },
      agents: [],
      tasks: TASKS.map((content, i) => ({ content, status: i === 0 ? 'in_progress' : 'pending' })),
      career: { hired: 0, tasksDone: 0, turns: 0 },
      level: { index: 1, name: 'Starter office', xp: 80 },
      isDemo: true,
    }
    this.elapsed = 0
    this.planDoneAt = null
  }

  /** Pretend usage for the meter: climbs past the stop line every few minutes, then the window resets. */
  pretendUsage() {
    const session = 28 + ((this.elapsed * 0.32) % 70)
    return { session, week: 52 + session * 0.12, sessionResetsAt: null, weekResetsAt: null, context: 30, warned: [] }
  }

  hire(role, team = '') {
    const name = NAMES[this.hired % NAMES.length]
    this.hired += 1
    this.session.agents.push({
      id: `demo-${this.hired}`,
      name,
      role,
      team,
      task: pick(JOBS[role], this.hired),
      status: 'working',
      startedAt: Date.now(),
      endedAt: null,
      doing: { icon: '☕', text: 'Settling in at the desk' },
      log: [],
      tools: 0,
      report: '',
      ends: this.elapsed + rand(70, 160),
      nextStep: this.elapsed + rand(2, 5),
    })
  }

  /** Moves the pretend session on by `dt` seconds; returns it as a snapshot. */
  tick(dt) {
    this.elapsed += dt
    const s = this.session
    const working = s.agents.filter(a => a.status === 'working')
    if (this.elapsed > this.nextHire && working.length < 9) {
      this.nextHire = this.elapsed + rand(10, 22)
      if (chance(0.25)) {
        const team = `wf_${this.hired}`
        const size = 3 + Math.floor(Math.random() * 2)
        for (let i = 0; i < size; i += 1) this.hire('workflow', team)
      } else {
        const count = chance(0.4) ? 2 : 1
        for (let i = 0; i < count; i += 1) this.hire(pick(['Explore', 'general-purpose', 'general-purpose', 'Plan'], Math.floor(Math.random() * 100)))
      }
      s.lead.status = 'working'
      this.leadUntil = this.elapsed + rand(20, 40)
    }
    for (const agent of working) {
      if (this.elapsed >= agent.nextStep) {
        const step = pick(STEPS, Math.floor(Math.random() * 1000))
        agent.doing = step
        agent.log = [...agent.log, step].slice(-8)
        agent.tools += 1
        agent.nextStep = this.elapsed + rand(2, 6)
      }
      if (this.elapsed >= agent.ends) {
        const ok = chance(0.9)
        agent.status = ok ? 'done' : 'failed'
        agent.endedAt = Date.now()
        agent.doing = ok ? { icon: '☕', text: 'Done, relaxing' } : { icon: '😵', text: 'Hit a problem' }
        agent.report = ok ? `All done: ${agent.task.toLowerCase()} is sorted.` : 'Ran into a wall and stopped.'
        const at = s.tasks.findIndex(t => t.status === 'in_progress')
        if (ok && at >= 0 && chance(0.5)) {
          s.tasks[at].status = 'completed'
          this.tasksDone += 1
          const next = s.tasks.findIndex(t => t.status === 'pending')
          if (next >= 0) s.tasks[next].status = 'in_progress'
          else this.planDoneAt = this.elapsed
        }
      }
    }
    if (s.lead.status === 'working') {
      if (chance(dt / 3)) {
        const step = pick(STEPS, Math.floor(Math.random() * 1000))
        s.lead.doing = step
        s.lead.log = [...s.lead.log, step].slice(-8)
        s.lead.tools += 1
      }
      if (this.elapsed > this.leadUntil) {
        s.lead.status = 'waiting'
        s.lead.doing = { icon: '💬', text: 'Waiting for you' }
        this.turns += 1
      }
    }
    // A finished plan stays up for a while (the office throws a party), then a new one starts.
    if (this.planDoneAt !== null && this.elapsed - this.planDoneAt > 45) {
      this.planDoneAt = null
      this.round = (this.round ?? 1) + 1
      s.tasks = TASKS.map((content, i) => ({ content: `${content} (round ${this.round})`, status: i === 0 ? 'in_progress' : 'pending' }))
    }
    s.usage = this.pretendUsage()
    s.agents = s.agents.slice(-24)
    s.career = { hired: this.hired, tasksDone: this.tasksDone, turns: this.turns }
    s.level = { index: Math.min(5, 1 + Math.floor(this.hired / 12)), name: '', xp: this.hired * 10 + this.tasksDone * 5 }
    s.updatedAt = Date.now()
    return s
  }
}
