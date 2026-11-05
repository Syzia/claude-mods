import { describe, expect, mock, test } from 'claude-code/testing'

import type { Agent } from '../types'
import { IDLE_LEAD, NO_CAREER, applyPlan, dayReport, describeCall, emptyDay, finish, hire, levelOf, mergeDay, readUsage, seating, statusLine, touch } from '../hooks/model'
import { scene } from '../hooks/scene'

const PANE = {
  component: 'Pane',
  requestId: 'agent-office',
  props: {
    title: 'Office',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 80 },
    view: {},
  },
  viewport: { columns: 120, rows: 80, isFullscreen: true },
} as const

const SPAWN = {
  tool_use_id: 'tu1',
  prompt: 'Find where the scene is drawn',
  description: 'Find the scene code',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'test-model',
  background: false,
  fork: false,
} as const

test('a helper takes a desk, shows its work when clicked, and rests in the lounge when done', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'a1' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.agent.spawn(SPAWN)
  await clock.advance(95_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-office', surface, ...PANE })
    expect(await ui.find({ key: 'staff-a1', text: /Ada/ })).toBeDefined()
    await ui.press({ key: 'staff-a1' })
    expect(await ui.find({ type: 'Text', text: 'Find the scene code' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Working for 1m 35s/ })).toBeDefined()
    await ui.press({ key: 'card-close' })
    expect(await ui.find({ key: 'card' })).toBeUndefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'Found it in scene.ts',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    agentId: 'a1',
    reason: 'answer',
  })
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Lounge: ☕ Ada/ })).toBeDefined()
  await ui.press({ key: 'staff-a1' })
  expect(await ui.find({ type: 'Text', text: /Found it in scene.ts/ })).toBeDefined()
  await ui.unmount()
})

test('the plan fills the task board and the progress line', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Draw the office', status: 'in_progress' },
      { content: 'Test it', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /1 of 2 tasks done/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ Test it/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.press({ key: 'staff-lead' })
  expect(await ui.find({ type: 'Text', text: /Updating the task list/ })).toBeDefined()
  await ui.unmount()
})

test('a measurement past 95% shows the stop line in the panel', async ($, on) => {
  mock.clock(on)
  on('session.measure', () => ({ changed: ['rateLimits'] }))
  await $.session.measure({
    context: { window: 200000, percent: 40 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 96, resetsAt: '2026-10-20T03:00:00Z' },
      { kind: 'seven_day', percentUsed: 61 },
    ],
    changed: ['rateLimits'],
  })
  const ui = await $.ui.mount({ plugin: 'agent-office', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Session 96% · Week 61%: past 95%/ })).toBeDefined()
  await ui.unmount()
})

describe('the office model', () => {
  test('two sessions logging the same day add up', async () => {
    const a = { ...emptyDay('2026-10-20'), hired: 2, roles: { Explore: 2 }, steps: 30 }
    const b = { ...emptyDay('2026-10-20'), hired: 1, roles: { Explore: 1, Plan: 1 }, finished: 1, done: [{ name: 'Ada', role: 'Explore', task: 'Map it', ok: true }] }
    const both = mergeDay(a, b)
    expect(both.hired).toBe(3)
    expect(both.roles).toEqual({ Explore: 3, Plan: 1 })
    expect(both.steps).toBe(30)
    expect(both.done).toHaveLength(1)
  })

  test('the daily report tells the numbers, then what got done', async () => {
    const day = {
      ...emptyDay('2026-10-20'),
      hired: 3,
      roles: { Explore: 2, Plan: 1 },
      finished: 2,
      failed: 1,
      tasksDone: 4,
      plans: 1,
      steps: 120,
      turns: 6,
      done: [{ name: 'Ada', role: 'Explore', task: 'Find the rooms', ok: true }],
    }
    const usage = { session: 41.6, week: 63, sessionResetsAt: null, weekResetsAt: null, context: 20, warned: [] }
    const text = dayReport(day, '2026-10-20', 'JJKgame.md', usage)
    expect(text).toContain('Hired 3: 2 researchers, 1 strategist')
    expect(text).toContain('Finished 2 · ⚠️ 1 hit a problem')
    expect(text).toContain('Plans completed: 1')
    expect(text).toContain('session 42% · week 63%')
    expect(text).toContain('✅ Ada (researcher): Find the rooms')
    expect(dayReport(null, '2026-10-20', 'JJKgame.md', null)).toContain('Nothing recorded')
  })

  test('the status line counts the busy and the resting, and flags usage past 95%', async () => {
    let staff: Agent[] = []
    staff = hire(staff, { id: 'x', role: 'Explore', task: 'one' }, 0, 0)
    staff = hire(staff, { id: 'y', role: 'Plan', task: 'two' }, 0, 1)
    staff = finish(staff, 'y', { reason: 'answer', isAborted: false, answer: 'ok', isTeammate: false }, 1)
    const usage = { session: 96, week: 50, sessionResetsAt: null, weekResetsAt: null, context: 10, warned: [] }
    expect(statusLine(staff, IDLE_LEAD, usage)).toBe('🏢 1 working · ☕ 1 on a break · 🔴 96% · wk 50%')
    expect(statusLine(staff, IDLE_LEAD, { ...usage, session: 92 })).toBe('🏢 1 working · ☕ 1 on a break · ⚡ 92% · wk 50%')
    expect(statusLine([], IDLE_LEAD, null)).toBe('🏢 Office quiet')
  })

  test('each usage window warns once at 95%, and again after it resets', async () => {
    const at = (session: number, resetsAt = 'r1') => ({
      context: { percent: 10 },
      rateLimits: [{ kind: 'five_hour', percentUsed: session, resetsAt }],
    })
    const quiet = readUsage(at(92), null)
    expect(quiet.alerts).toHaveLength(0)
    const crossed = readUsage(at(95.5), quiet.usage)
    expect(crossed.alerts).toHaveLength(1)
    expect(crossed.usage.session).toBe(95.5)
    expect(readUsage(at(98), crossed.usage).alerts).toHaveLength(0)
    expect(readUsage(at(96, 'r2'), crossed.usage).alerts).toHaveLength(1)
  })

  test('levels follow the XP', async () => {
    expect(levelOf(NO_CAREER).name).toBe('Garage')
    expect(levelOf({ hired: 6, tasksDone: 0, turns: 0 }).name).toBe('Starter office')
    expect(levelOf({ hired: 6, tasksDone: 0, turns: 0 }).xp).toBe(60)
    expect(levelOf({ hired: 100, tasksDone: 200, turns: 0 }).next).toBeNull()
  })

  test('the plan advances, checks off and starts steps', async () => {
    const plan = applyPlan([], {
      items: [
        { content: 'a', status: 'in_progress' },
        { content: 'b', status: 'pending' },
        { content: 'c', status: 'pending' },
      ],
    })
    const advanced = applyPlan(plan, { advance: true })
    expect(advanced.map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
    const jumped = applyPlan(advanced, { done: [2], start: 3 })
    expect(jumped.map(t => t.status)).toEqual(['completed', 'completed', 'in_progress'])
  })

  test('the finished leave their desks for the lounge', async () => {
    let staff: Agent[] = []
    staff = hire(staff, { id: 'x', role: 'Explore', task: 'one' }, 0, 0)
    staff = hire(staff, { id: 'y', role: 'Plan', task: 'two' }, 0, 1)
    staff = touch(staff, 'x', describeCall('Read', { file_path: '/a/b/scene.ts' }))
    expect(staff[0]!.doing.text).toBe('Reading scene.ts')
    staff = finish(staff, 'x', { reason: 'answer', isAborted: false, answer: 'ok', isTeammate: false }, 5)
    staff = hire(staff, { id: 'z', role: 'Explore', task: 'three' }, 0, 2)
    const seats = seating(staff)
    expect(seats.atDesks.map(a => a.id)).toEqual(['y', 'z'])
    expect(seats.lounge.map(a => a.name)).toEqual(['Ada'])
  })

  test('a big office still fits in one picture', async () => {
    let staff: Agent[] = []
    for (let i = 0; i < 30; i += 1) staff = hire(staff, { id: `a${i}`, role: 'Explore', task: 'work' }, 0, i)
    const view = {
      project: 'JJKgame.md',
      level: levelOf({ hired: 200, tasksDone: 100, turns: 0 }),
      lead: IDLE_LEAD,
      agents: staff,
      tasks: [],
      selected: 'a3',
    }
    const { source } = scene(view)
    expect(source.length).toBeLessThan(131072)
    expect(source).toStartWith('<svg')
  })
})
