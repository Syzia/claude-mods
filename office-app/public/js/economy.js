// Money. The company earns from the work your sessions do and spends it on
// furniture and rooms; every worker earns a wage into their own wallet and
// spends it on their look. Everything here is saved between visits.

export const RANKS = ['Garage', 'Starter office', 'Studio', 'Agency floor', 'Headquarters', 'Tower']

/** The owner's stop rule: past this share of a usage window, the office raises the alarm. */
export const STOP_AT = 95
/** From here the meter turns amber, a heads-up before the stop line. */
export const WARN_FROM = 80

export const PAY = {
  companyPerStep: 6,
  walletPerStep: 3,
  companyPerFinish: 150,
  walletPerFinish: 60,
  companyPerFailure: 40,
  walletPerFailure: 10,
  companyPerLeadStep: 3,
  companyPerTask: 60,
  companyPerTurn: 15,
  startingCash: 1000,
  partyBonus: 250,
}

/** What can be bought in build mode. `rank` is the office level the project must reach first. */
export const CATALOG = [
  { type: 'plant', name: 'Potted plant', icon: '🪴', price: 40, rank: 0, group: 'Decor' },
  { type: 'rug', name: 'Rug', icon: '🟥', price: 60, rank: 0, group: 'Decor' },
  { type: 'aquarium', name: 'Aquarium', icon: '🐠', price: 650, rank: 3, group: 'Decor' },
  { type: 'beanbag', name: 'Beanbag', icon: '🫘', price: 90, rank: 0, group: 'Chill' },
  { type: 'couch', name: 'Couch', icon: '🛋️', price: 220, rank: 0, group: 'Chill' },
  { type: 'bookshelf', name: 'Bookshelf', icon: '📚', price: 150, rank: 0, group: 'Chill' },
  { type: 'waterCooler', name: 'Water cooler', icon: '🚰', price: 80, rank: 0, group: 'Chill' },
  { type: 'coffee', name: 'Coffee bar', icon: '☕', price: 260, rank: 0, group: 'Chill' },
  { type: 'vending', name: 'Snack machine', icon: '🍫', price: 200, rank: 1, group: 'Chill' },
  { type: 'tv', name: 'Big TV', icon: '📺', price: 300, rank: 1, group: 'Chill' },
  { type: 'pingpong', name: 'Ping-pong table', icon: '🏓', price: 350, rank: 1, group: 'Games' },
  { type: 'arcade', name: 'Arcade cabinet', icon: '🕹️', price: 420, rank: 1, group: 'Games' },
  { type: 'foosball', name: 'Foosball table', icon: '⚽', price: 320, rank: 2, group: 'Games' },
  { type: 'treadmill', name: 'Treadmill', icon: '🏃', price: 450, rank: 2, group: 'Games' },
  { type: 'whiteboard', name: 'Whiteboard', icon: '📝', price: 120, rank: 0, group: 'Work' },
]

export const ROOMS_FOR_SALE = [{ id: 'gameroom', name: 'Game Room', icon: '🎮', price: 1500, rank: 2 }]

/** Wardrobe prices, paid from the worker's own wallet. Once bought, an item is theirs to wear again for free. */
export const WARDROBE = {
  hat: { none: 0, cap: 40, beanie: 50, party: 30, tophat: 140, crown: 400 },
  glasses: { none: 0, round: 45, shades: 70, visor: 90 },
  extra: { none: 0, headphones: 90, tie: 35, bowtie: 35, scarf: 40 },
  hair: 20,
  hairColor: 15,
  shirt: 12,
  pants: 10,
  skin: 0,
}

export const ITEM_NAMES = {
  cap: 'a cap',
  beanie: 'a beanie',
  party: 'a party hat',
  tophat: 'a top hat',
  crown: 'a crown',
  round: 'round glasses',
  shades: 'sunglasses',
  visor: 'a neon visor',
  headphones: 'headphones',
  tie: 'a tie',
  bowtie: 'a bow tie',
  scarf: 'a scarf',
}

export class Economy {
  constructor(save) {
    this.save = {
      version: 1,
      projects: {},
      staff: {},
      settings: { demo: true },
      ...(save && typeof save === 'object' ? save : {}),
    }
    this.dirty = false
  }

  project(key) {
    const projects = this.save.projects
    if (!projects[key]) {
      projects[key] = { cash: PAY.startingCash, built: [], purchases: [], nextId: 1, seen: {}, leads: {}, career: null }
      this.dirty = true
    }
    return projects[key]
  }

  staff(name, look) {
    const staff = this.save.staff
    if (!staff[name]) {
      staff[name] = { look, wallet: 0, owned: [], earned: 0, bought: 0 }
      this.dirty = true
    }
    if (!staff[name].look && look) staff[name].look = look
    return staff[name]
  }

  cash(key) {
    return this.project(key).cash
  }

  earn(key, amount) {
    this.project(key).cash += amount
    this.dirty = true
  }

  spend(key, amount) {
    const project = this.project(key)
    if (project.cash < amount) return false
    project.cash -= amount
    this.dirty = true
    return true
  }

  pay(name, amount) {
    const person = this.staff(name, null)
    person.wallet += amount
    person.earned += amount
    this.dirty = true
  }

  /** What changing one part of a look costs this worker right now (0 when owned, free or unchanged). */
  priceOf(name, slot, value) {
    const person = this.save.staff[name]
    if (!person) return 0
    if (person.look?.[slot] === value) return 0
    const table = WARDROBE[slot]
    if (typeof table === 'number') return table
    if (!table || value === 'none') return 0
    if (person.owned.includes(`${slot}:${value}`)) return 0
    return table[value] ?? 0
  }

  /**
   * Changes one part of a worker's look, paid from their wallet, or by the company as a gift.
   * Returns what happened so the caller can tell the player.
   */
  dress(name, slot, value, { gift = false, project = null } = {}) {
    const person = this.save.staff[name]
    if (!person) return { ok: false, reason: 'unknown' }
    const cost = this.priceOf(name, slot, value)
    if (cost > 0) {
      if (gift) {
        if (!project || !this.spend(project, cost)) return { ok: false, reason: 'company', cost }
      } else if (person.wallet < cost) {
        return { ok: false, reason: 'wallet', cost }
      } else {
        person.wallet -= cost
      }
    }
    if (typeof WARDROBE[slot] === 'object' && value !== 'none') {
      const id = `${slot}:${value}`
      if (!person.owned.includes(id)) person.owned.push(id)
    }
    person.look = { ...person.look, [slot]: value }
    if (cost > 0) person.bought += 1
    this.dirty = true
    return { ok: true, cost, look: person.look }
  }

  /** The cheapest accessory this worker does not own yet and can afford, picked at random among those. */
  wishFor(name) {
    const person = this.save.staff[name]
    if (!person) return null
    const options = []
    for (const slot of ['hat', 'glasses', 'extra']) {
      for (const [value, price] of Object.entries(WARDROBE[slot])) {
        if (value === 'none' || person.owned.includes(`${slot}:${value}`)) continue
        if (price <= person.wallet) options.push({ slot, value, price })
      }
    }
    if (options.length === 0) return null
    return options[Math.floor(Math.random() * options.length)]
  }

  /**
   * Pays for what the sessions did since the last look: steps, finished agents,
   * the lead's own steps, finished tasks and turns. The first look at a project
   * only sets the baseline, so opening the office mid-session is no windfall.
   * Returns payouts by person key (for the money popups) and lines for the ticker.
   */
  credit(key, sessions, { now = Date.now(), walletOf = name => name } = {}) {
    const project = this.project(key)
    const first = project.career === null
    const payouts = new Map()
    const lines = []
    let career = { hired: 0, tasksDone: 0, turns: 0 }
    for (const session of sessions) {
      const sid = session.sessionId
      for (const agent of session.agents) {
        const id = `${sid}:${agent.id}`
        const finished = agent.status === 'done' || agent.status === 'failed'
        let seen = project.seen[id]
        if (!seen) {
          seen = project.seen[id] = { tools: first ? agent.tools : 0, finished: first && finished, at: now }
        }
        const steps = Math.max(0, agent.tools - seen.tools)
        if (steps > 0) {
          project.cash += steps * PAY.companyPerStep
          this.pay(walletOf(agent.name), steps * PAY.walletPerStep)
          seen.tools = agent.tools
        }
        if (finished && !seen.finished) {
          const ok = agent.status === 'done'
          const company = ok ? PAY.companyPerFinish : PAY.companyPerFailure
          const wallet = ok ? PAY.walletPerFinish : PAY.walletPerFailure
          project.cash += company
          this.pay(walletOf(agent.name), wallet)
          seen.finished = true
          payouts.set(`agent:${sid}:${agent.id}`, { company, wallet })
          lines.push({ icon: ok ? '✅' : '⚠️', text: `${agent.name} ${ok ? 'finished' : 'gave up on'}: ${agent.task}`, money: company })
        }
        seen.at = now
      }
      const leadTools = session.lead?.tools ?? 0
      const before = project.leads[sid] ?? (first ? leadTools : 0)
      if (leadTools > before) project.cash += (leadTools - before) * PAY.companyPerLeadStep
      project.leads[sid] = Math.max(before, leadTools)
      const c = session.career ?? {}
      career = {
        hired: Math.max(career.hired, c.hired ?? 0),
        tasksDone: Math.max(career.tasksDone, c.tasksDone ?? 0),
        turns: Math.max(career.turns, c.turns ?? 0),
      }
    }
    if (project.career) {
      const tasks = Math.max(0, career.tasksDone - project.career.tasksDone)
      const turns = Math.max(0, career.turns - project.career.turns)
      if (tasks > 0) {
        project.cash += tasks * PAY.companyPerTask
        lines.push({ icon: '📋', text: `${tasks === 1 ? 'A task' : `${tasks} tasks`} checked off the plan`, money: tasks * PAY.companyPerTask })
      }
      if (turns > 0) project.cash += turns * PAY.companyPerTurn
    }
    project.career = {
      hired: Math.max(project.career?.hired ?? 0, career.hired),
      tasksDone: Math.max(project.career?.tasksDone ?? 0, career.tasksDone),
      turns: Math.max(project.career?.turns ?? 0, career.turns),
    }
    // Forget agents not seen for two days.
    for (const [id, seen] of Object.entries(project.seen)) if (now - seen.at > 2 * 86400000) delete project.seen[id]
    this.dirty = true
    return { payouts, lines }
  }
}
