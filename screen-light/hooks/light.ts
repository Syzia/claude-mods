// screen-light: the logic, kept apart from the engine so the tests can run it without one.
//
// The mod watches the computer-use tools (the ones that let Claude work in other apps on this Mac) and keeps
// one small state file per session. The Screen Light program (app/ScreenLight.swift) reads those files and
// draws a light on the right edge of the screen. Nothing here ever changes a tool call or its answer.

export type Mode = 'screen' | 'app' | 'idle'
export type EndReason = 'released' | 'turn-ended' | 'stopped'

/** What the light program reads: one file per session. Every time is milliseconds since 1970. */
export type LightState = {
  v: 1
  session: string
  /** screen: Claude has the whole screen; app: Claude works inside an app in the background; idle: neither. */
  mode: Mode
  /** A control call is running right now. */
  busy: boolean
  app?: string
  what?: string
  /** When this stretch of control began. */
  since: number
  /** The last control call. */
  last: number
  /** The last time this file was written while control was held; the program drops a file that goes quiet. */
  beat: number
  /** When control was handed back, so the light can say so for a few seconds. */
  ended?: number
  reason?: EndReason
}

/** The program drops a session that has not written for 20 s; a beat every 5 s keeps a quiet one alive. */
export const BEAT_MS = 5_000
/** Control nobody has used for this long is let go, in case an end-of-turn event never came. */
export const IDLE_RELEASE_MS = 10 * 60_000
/** While control is held the program is started again at most this often, in case it was quit. */
export const RELAUNCH_MS = 30_000

/** The tools that give Claude control of the Mac: the desktop app's computer-use tools, and the same tools of a linked computer. */
export const CONTROL_TOOLS = /^mcp__(computer-use|remote-devices)__/

export type Kind = 'screen' | 'app' | 'full-on' | 'full-off' | 'app-off' | 'info'
export type Call = { kind: Kind; name: string }
export type CallInput = Readonly<Record<string, unknown>>
export type Outcome = { ok: boolean; text: string }

const SERVER = /^mcp__(?:computer-use|remote-devices)__(.+)$/
const FULL_ON = /^(?:computer_)?request_full_control$/
const FULL_OFF = /^(?:computer_)?release_full_control$/
const APP_OFF = /^(?:computer_)?app_release$/
/** Looking around the setup, asking the person for access, a guided tour: none of it is control. */
const INFO = /^(?:computer_)?(?:list_|request_access$|request_teach_access$|resolve_access$|teach_)/
const APP = /^(?:computer_)?(?:app_|open_application$)/
const DECLINED = /declin|denied|refus|not approved|cancel|reject|not allowed/i
const NAME_PAIR = /"bundleId"\s*:\s*"([^"\\]{1,120})"\s*,\s*"displayName"\s*:\s*"([^"\\]{1,60})"/g

/**
 * Says what a call to a computer-use tool means for control, or undefined for a tool of any other server.
 * A tool this list does not know counts as full-screen control: a light that comes on for nothing is a smaller
 * mistake than one that stays dark while Claude has the mouse.
 */
export function classify(tool: string): Call | undefined {
  const match = SERVER.exec(tool)
  if (match === null) return undefined
  const name = match[1] ?? ''
  if (FULL_ON.test(name)) return { kind: 'full-on', name }
  if (FULL_OFF.test(name)) return { kind: 'full-off', name }
  if (APP_OFF.test(name)) return { kind: 'app-off', name }
  if (INFO.test(name)) return { kind: 'info', name }
  if (APP.test(name)) return { kind: 'app', name }
  return { kind: 'screen', name }
}

/** One line of plain text: control characters and runs of spaces become one space, and long text is cut. */
export function plain(text: unknown, max: number): string | undefined {
  if (typeof text !== 'string') return undefined
  const one = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (one === '') return undefined
  return one.length > max ? `${one.slice(0, max)}\u2026` : one
}

export function appOf(input: CallInput): string | undefined {
  const app = input['app']
  return typeof app === 'string' && app.trim() !== '' ? app.trim() : undefined
}

/** The call's own description of what it does ("Opens the + menu in the prompt box"), when it gave one. */
export function summaryOf(input: CallInput): string | undefined {
  const direct = plain(input['action_summary'], 90)
  if (direct !== undefined) return direct
  const actions = input['actions']
  if (Array.isArray(actions)) {
    for (const item of actions) {
      if (item !== null && typeof item === 'object') {
        const summary = plain((item as Record<string, unknown>)['action_summary'], 90)
        if (summary !== undefined) return summary
      }
    }
  }
  return undefined
}

/** A few plain words for what a full-screen call does, from the actions it carries. */
export function screenVerb(name: string, input: CallInput): string {
  const actions: string[] = []
  const list = input['actions']
  if (Array.isArray(list)) {
    for (const item of list) {
      const action = item !== null && typeof item === 'object' ? (item as Record<string, unknown>)['action'] : undefined
      if (typeof action === 'string') actions.push(action)
    }
  } else {
    actions.push(name)
  }
  const has = (pattern: RegExp): boolean => actions.some(action => pattern.test(action))
  if (has(/click|drag/)) return 'Clicking on the screen'
  if (has(/^type$/)) return 'Typing on the keyboard'
  if (has(/key/)) return 'Pressing keys'
  if (has(/scroll/)) return 'Scrolling'
  if (has(/move|hover/)) return 'Moving the mouse'
  if (has(/clipboard/)) return 'Using the clipboard'
  return 'Looking at the screen'
}

/** A few plain words for what a background call does in an app. */
export function appVerb(name: string, app: string | undefined): string {
  const n = name.replace(/^computer_/, '')
  if (/^app_(?:screenshot|zoom|ax_find|list_windows|screens)$/.test(n)) return app === undefined ? 'Looking at an app' : `Looking at ${app}`
  if (n === 'app_click') return app === undefined ? 'Clicking in an app' : `Clicking in ${app}`
  if (n === 'app_type') return app === undefined ? 'Typing in an app' : `Typing in ${app}`
  if (n === 'app_key') return app === undefined ? 'Pressing keys' : `Pressing keys in ${app}`
  if (n === 'app_menu') return app === undefined ? 'Using an app\u2019s menus' : `Using ${app}\u2019s menus`
  if (n === 'app_scroll') return app === undefined ? 'Scrolling' : `Scrolling ${app}`
  if (n === 'app_drag') return app === undefined ? 'Dragging' : `Dragging in ${app}`
  if (n === 'app_focus' || n === 'app_bring_to_current_space') return app === undefined ? 'Bringing an app forward' : `Bringing ${app} forward`
  if (n === 'open_application') return app === undefined ? 'Opening an app' : `Opening ${app}`
  return app === undefined ? 'Working in an app' : `Working in ${app}`
}

/** An app as the person knows it: the name the tools reported, else the last part of the bundle id. */
export function prettyApp(app: string, names: ReadonlyMap<string, string>): string | undefined {
  const known = names.get(app)
  if (known !== undefined) return known
  if (!app.includes('.')) return plain(app, 40)
  const last = app.split('.').filter(part => part !== '').pop() ?? app
  return plain(last.replace(/MacOS$/i, '') || last, 40)
}

/** Reads (bundle id, display name) pairs out of an answer such as request_access's or list_apps's. */
export function learnNames(text: string): [string, string][] {
  const found: [string, string][] = []
  for (const match of text.matchAll(NAME_PAIR)) {
    const id = match[1]
    const name = plain(match[2], 40)
    if (id !== undefined && name !== undefined) found.push([id, name])
  }
  return found
}

/** The parts of the engine the tracker needs; each call hands in its own, so nothing outlives a dispatch. */
export type Io = {
  now: () => Promise<number>
  write: (text: string) => Promise<void>
  launch: () => Promise<void>
  /** Said once if a write or launch fails; the light is a view, so nothing else stops. */
  problem?: (text: string) => void
}

/** What begin() remembers for finish(). */
export type Token = { before: Mode; counted: boolean }

/** Keeps what one session holds and writes it where the light program reads it. */
export class Tracker {
  private screen = false
  private readonly apps = new Set<string>()
  private readonly names = new Map<string, string>()
  private recentApp: string | undefined
  private inFlight = 0
  private what: string | undefined
  private since = 0
  private last = 0
  private ended: { at: number; reason: EndReason } | undefined
  private lastAgent: string | undefined
  private lastLaunch = Number.NEGATIVE_INFINITY
  private chain: Promise<void> = Promise.resolve()
  private reported = false
  /** Whether this session ever wrote a file; one that never did has nothing to clear. */
  private published = false

  constructor(private readonly session: string) {}

  mode(): Mode {
    return this.screen ? 'screen' : this.apps.size > 0 ? 'app' : 'idle'
  }

  isHolding(): boolean {
    return this.mode() !== 'idle'
  }

  /** The state as the light program would read it now (what is written, without writing it). */
  snapshot(now: number): LightState {
    const mode = this.mode()
    const state: LightState = { v: 1, session: this.session, mode, busy: this.inFlight > 0, since: this.since, last: this.last, beat: now }
    if (mode !== 'idle' && this.what !== undefined) state.what = this.what
    if (mode === 'app') {
      const key = this.recentApp !== undefined && this.apps.has(this.recentApp) ? this.recentApp : [...this.apps].pop()
      const app = key === undefined || key === '' ? undefined : prettyApp(key, this.names)
      if (app !== undefined) state.app = app
    }
    if (this.ended !== undefined && mode === 'idle') {
      state.ended = this.ended.at
      state.reason = this.ended.reason
    }
    return state
  }

  /** A control call is about to run. */
  async begin(io: Io, call: Call, input: CallInput, agentId?: string): Promise<Token> {
    const before = this.mode()
    if (call.kind !== 'screen' && call.kind !== 'app') return { before, counted: false }
    const now = await io.now()
    this.inFlight += 1
    this.last = now
    this.lastAgent = agentId
    if (call.kind === 'screen') {
      this.screen = true
      this.what = summaryOf(input) ?? screenVerb(call.name, input)
    } else {
      const app = appOf(input)
      this.apps.add(app ?? '')
      this.recentApp = app ?? ''
      this.what = summaryOf(input) ?? appVerb(call.name, prettyApp(app ?? '', this.names))
    }
    if (before === 'idle') {
      this.since = now
      this.ended = undefined
      this.lastLaunch = Number.NEGATIVE_INFINITY
    }
    await this.publish(io, now)
    return { before, counted: true }
  }

  /** The call came back (or failed, or was refused). */
  async finish(io: Io, call: Call, input: CallInput, token: Token, outcome: Outcome): Promise<void> {
    for (const [id, name] of learnNames(outcome.text)) this.names.set(id, name)
    // Looking around the setup is not control: nothing to write.
    if (call.kind === 'info') return
    const now = await io.now()
    if (token.counted) {
      this.inFlight = Math.max(0, this.inFlight - 1)
      this.last = now
    }
    if (call.kind === 'screen' || call.kind === 'app') {
      // A call that failed before Claude had any control leaves nothing on.
      if (!outcome.ok && token.before === 'idle' && this.inFlight === 0) this.clear()
    } else if (call.kind === 'full-on') {
      if (outcome.ok && !DECLINED.test(outcome.text)) {
        const wasIdle = !this.isHolding()
        this.screen = true
        this.what = 'Took over the screen'
        this.last = now
        this.lastAgent = undefined
        if (wasIdle) {
          this.since = now
          this.ended = undefined
          this.lastLaunch = Number.NEGATIVE_INFINITY
        }
      }
    } else if (call.kind === 'full-off') {
      if (outcome.ok) {
        this.screen = false
        this.what = undefined
        if (!this.isHolding()) this.ended = { at: now, reason: 'released' }
      }
    } else if (call.kind === 'app-off') {
      if (outcome.ok) {
        const app = appOf(input)
        if (app === undefined) this.apps.clear()
        else this.apps.delete(app)
        if (!this.isHolding()) {
          this.what = undefined
          this.ended = { at: now, reason: 'released' }
        }
      }
    }
    await this.publish(io, now)
  }

  /** A turn ended: Claude can no longer act, so control is handed back. Only the loop that last used it ends it. */
  async endTurn(io: Io, reason: EndReason, agentId?: string): Promise<void> {
    if (!this.isHolding() || agentId !== this.lastAgent) return
    if (reason !== 'stopped' && this.inFlight > 0) return
    const now = await io.now()
    this.release(now, reason)
    await this.publish(io, now)
  }

  /** The session is ending: the light goes at once, with no note. */
  async stop(io: Io): Promise<void> {
    if (!this.published) return
    const now = await io.now()
    this.screen = false
    this.apps.clear()
    this.inFlight = 0
    this.what = undefined
    this.ended = undefined
    await this.publish(io, now)
  }

  /** Called every BEAT_MS: keeps a quiet hold alive, and lets go of one nobody has used for a long time. */
  async beat(io: Io): Promise<void> {
    if (!this.isHolding()) return
    const now = await io.now()
    if (this.inFlight === 0 && now - this.last > IDLE_RELEASE_MS) this.release(now, 'turn-ended')
    await this.publish(io, now)
  }

  private clear(): void {
    this.screen = false
    this.apps.clear()
    this.what = undefined
    this.ended = undefined
  }

  private release(now: number, reason: EndReason): void {
    this.screen = false
    this.apps.clear()
    this.inFlight = 0
    this.what = undefined
    this.ended = { at: now, reason }
  }

  /** Writes the state; writes run one after another so an old one never lands after a newer one. */
  private publish(io: Io, now: number): Promise<void> {
    this.published = true
    const launch = this.isHolding() && now - this.lastLaunch >= RELAUNCH_MS
    if (launch) this.lastLaunch = now
    const text = JSON.stringify(this.snapshot(now))
    this.chain = this.chain
      .then(async () => {
        await io.write(text)
        if (launch) await io.launch()
      })
      .catch((error: unknown) => {
        if (!this.reported) {
          this.reported = true
          io.problem?.(`could not update the light: ${plain(error instanceof Error ? error.message : String(error), 160) ?? 'unknown error'}`)
        }
      })
    return this.chain
  }
}

/** A session id that is safe to use in a file name. */
export function safeId(id: unknown): string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : 'session'
}
