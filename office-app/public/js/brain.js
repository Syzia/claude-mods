// How people behave. Each person runs one behaviour at a time (arriving,
// working, reporting, on a break, leaving); a new one cancels the old.
// Behaviours are async functions that await walks and waits, checking after
// every await that they are still the current one.

import * as THREE from 'three'
import { ITEM_NAMES } from './economy.js'
import { makeBubble, makeTag, setBubble } from './labels.js'
import { animate, buildPerson, wear } from './people.js'
import { dampAngle, rand, weighted } from './util.js'

const WALK = 1.8
const HURRY = 3.1

export class Person {
  constructor(world, { key, kind, sessionId = null, name, staffName = name, dept = null, team = '', look }) {
    // `staffName` keys the wallet and wardrobe: the same name is the same person in every session.
    Object.assign(this, { world, key, kind, sessionId, name, staffName, dept, team })
    this.model = buildPerson(look)
    this.root = this.model.root
    this.root.traverse(o => {
      o.userData.personKey = key
    })
    this.bubble = makeBubble()
    this.bubble.position.y = 2.35
    this.root.add(this.bubble)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: '#2bf3ff', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.065
    ring.visible = false
    this.root.add(ring)
    this.ring = ring
    this.tag = null
    this.pos = { x: 0, z: 0 }
    this.yaw = Math.PI
    this.targetYaw = Math.PI
    this.pose = 'stand'
    this.sitting = false
    this.seatY = 0
    this.phase = 0
    this.action = null
    this.epoch = 0
    this.state = 'new'
    this.activity = ''
    this.icon = null
    this.atSpot = null
    this.spotKey = null
    this.deskKey = null
    this.sayIcon = null
    this.sayUntil = 0
    this.override = null
    this.data = null
    this.failed = false
    this.lastShop = -999
    this.lastActivity = null
    this.fading = 0
    this.removed = false
    this.selected = false
    this.hovered = false
    world.scene.add(this.root)
  }

  get now() {
    return this.world.time
  }

  begin(state, activity = '') {
    this.epoch += 1
    this.cancelAction()
    this.state = state
    this.activity = activity
    this.icon = null
    return this.epoch
  }

  alive(run) {
    return run === this.epoch && !this.removed
  }

  cancelAction() {
    if (!this.action) return
    const { resolve } = this.action
    this.action = null
    resolve(false)
  }

  finishAction(ok) {
    if (!this.action) return
    const { resolve } = this.action
    this.action = null
    resolve(ok)
  }

  place(p) {
    this.pos = { x: p.x, z: p.z }
    this.root.position.set(p.x, 0, p.z)
  }

  walkTo(p, { hurry = false } = {}) {
    const path = this.world.office.nav.find(this.pos, p)
    return new Promise(resolve => {
      this.cancelAction()
      if (!path || path.length === 0) {
        this.place(p)
        resolve(true)
        return
      }
      path.push({ x: p.x, z: p.z })
      this.action = { type: 'walk', points: path, i: 1, hurry, resolve }
    })
  }

  wait(seconds) {
    return new Promise(resolve => {
      this.cancelAction()
      this.action = { type: 'wait', left: seconds, resolve }
    })
  }

  tweenTo(p, duration = 0.4) {
    return new Promise(resolve => {
      this.cancelAction()
      this.action = { type: 'tween', from: { ...this.pos }, to: { x: p.x, z: p.z }, t: 0, duration, resolve }
    })
  }

  /** Walks to a spot the caller reserved and settles into it: sits, stands or steps on. */
  async takeSpot(spot, run, { hurry = false } = {}) {
    this.spotKey = spot.key
    if (!(await this.walkTo(spot.approach, { hurry })) || !this.alive(run)) return false
    if (!(await this.tweenTo(spot, 0.45)) || !this.alive(run)) return false
    this.targetYaw = spot.face
    this.sitting = spot.pose === 'sit'
    this.seatY = spot.seatY
    this.atSpot = spot.key
    return true
  }

  /** Gets up from wherever they are; gives the spot back unless it is their own desk. */
  async standUp(run, { keepDesk = true } = {}) {
    const office = this.world.office
    const key = this.spotKey
    const wasThere = this.atSpot === key
    this.atSpot = null
    if (!key) {
      this.sitting = false
      return this.alive(run)
    }
    const spot = office.spot(key)
    this.sitting = false
    this.spotKey = null
    if (!(keepDesk && key === this.deskKey)) office.release(key, this.key)
    if (spot && wasThere && Math.hypot(spot.approach.x - this.pos.x, spot.approach.z - this.pos.z) > 0.05) {
      if (!(await this.tweenTo(spot.approach, 0.35))) return false
    }
    return this.alive(run)
  }

  say(icon, seconds = 3) {
    this.sayIcon = icon
    this.sayUntil = this.now + seconds
  }

  gesture(pose, seconds = 2) {
    this.override = { pose, until: this.now + seconds }
  }

  /** The icon over their head when they are not saying anything in particular. */
  baseIcon() {
    if (this.state === 'working' || this.state === 'managing') {
      if (this.kind === 'lead' && this.data?.status !== 'working') return '💬'
      return this.data?.doing?.icon ?? '💻'
    }
    if (this.state === 'idle') return '💤'
    if (this.state === 'remote') return '🛰️'
    if (this.state === 'leisure' || this.state === 'party') return this.icon
    if (this.state === 'reception') return null
    return null
  }

  update(dt, t) {
    const a = this.action
    let moving = false
    let hurry = false
    if (a?.type === 'wait') {
      a.left -= dt
      if (a.left <= 0) this.finishAction(true)
    } else if (a?.type === 'walk') {
      const target = a.points[a.i]
      const dx = target.x - this.pos.x
      const dz = target.z - this.pos.z
      const distance = Math.hypot(dx, dz)
      const step = (a.hurry ? HURRY : WALK) * dt
      moving = true
      hurry = a.hurry
      this.phase += step * 5.4
      if (distance <= step || distance < 1e-6) {
        this.pos = { x: target.x, z: target.z }
        a.i += 1
        if (a.i >= a.points.length) this.finishAction(true)
      } else {
        this.pos.x += (dx / distance) * step
        this.pos.z += (dz / distance) * step
        this.targetYaw = Math.atan2(dx, dz)
      }
    } else if (a?.type === 'tween') {
      a.t += dt / a.duration
      const k = Math.min(1, a.t)
      const e = k * k * (3 - 2 * k)
      const dx = a.to.x - a.from.x
      const dz = a.to.z - a.from.z
      this.pos = { x: a.from.x + dx * e, z: a.from.z + dz * e }
      if (Math.hypot(dx, dz) > 0.15 && k < 0.6) this.targetYaw = Math.atan2(dx, dz)
      this.phase += dt * 6
      moving = Math.hypot(dx, dz) > 0.05
      if (k >= 1) this.finishAction(true)
    }
    this.yaw = dampAngle(this.yaw, this.targetYaw, 10, dt)
    this.root.position.set(this.pos.x, 0, this.pos.z)
    this.root.rotation.y = this.yaw

    let pose = this.pose
    if (this.override && this.override.until > t) pose = this.override.pose
    if (moving) pose = hurry ? 'hurry' : 'walk'
    animate(this.model, { pose, sitting: this.sitting && !moving, seatY: this.seatY, phase: this.phase }, t, dt)

    const icon = this.sayUntil > t ? this.sayIcon : this.baseIcon()
    setBubble(this.bubble, icon, this.failed && this.state !== 'working' ? 'sad' : 'plain')
    this.bubble.position.y = this.sitting && !moving ? 2.0 : 2.4
    this.ring.visible = this.selected
    if (this.tag) this.tag.visible = this.selected || this.hovered

    if (this.fading > 0) {
      this.fading += dt
      const s = Math.max(0.001, 1 - this.fading / 0.6)
      this.root.scale.setScalar(s)
      if (s <= 0.001) this.world.remove(this)
    }
  }

  showTag(text) {
    if (!this.tag) {
      this.tag = makeTag(text)
      this.tag.position.y = 2.85
      this.root.add(this.tag)
    }
  }

  restyle(look) {
    wear(this.model, look)
    this.root.traverse(o => {
      o.userData.personKey = this.key
    })
  }

  vanish() {
    this.fading = 0.0001
  }
}

// ---------------------------------------------------------------- behaviours

/** Starts whatever the feed says this person should be doing now. */
export function follow(p) {
  if (p.kind === 'lead') return manage(p)
  if (p.kind === 'receptionist') return reception(p)
  const status = p.data?.status
  if (status === 'remote') return remote(p)
  if (status === 'done' || status === 'failed') return report(p)
  if (status === 'idle') return work(p, { idle: true })
  return work(p)
}

export async function arrive(p) {
  const w = p.world
  const office = w.office
  const run = p.begin('arriving', 'Arriving at the office')
  const entrance = office.entrance
  // People hired together arrive one after another, not stacked on one spot.
  p.place({ x: entrance.street.x + rand(-1.5, 1.5), z: entrance.street.z + rand(-0.3, 0.3) })
  p.root.visible = false
  if (!(await p.wait(w.arrivalDelay(p))) || !p.alive(run)) return
  p.root.visible = true
  if (!(await p.walkTo({ x: entrance.outside.x + rand(-0.6, 0.6), z: entrance.outside.z + rand(-0.4, 0.4) })) || !p.alive(run)) return
  if (!(await p.walkTo(entrance.inside)) || !p.alive(run)) return
  w.welcome(p)
  const team = w.teamOf(p)
  const seat = team.length >= 3 && office.room('meeting') ? office.spots({ act: 'meet', free: true })[0] : null
  if (seat && office.reserve(seat.key, p.key)) {
    p.activity = 'At the team kickoff'
    if (!(await p.takeSpot(seat, run))) return
    p.pose = 'listen'
    p.say('🗣️', 3)
    if (!(await p.wait(rand(6, 9))) || !p.alive(run)) return
  } else {
    const lead = w.leadFor(p.sessionId)
    const spot = lead ? w.freeReportSpot(lead) : null
    if (spot && office.reserve(spot.key, p.key)) {
      p.activity = `Getting a briefing from ${lead.name}`
      if (!(await p.takeSpot(spot, run))) return
      p.pose = 'listen'
      p.say('👋', 2.5)
      lead.say('📋', 2.8)
      lead.gesture('talk', 2.8)
      if (!(await p.wait(2.8)) || !p.alive(run)) return
    }
  }
  if (!(await p.standUp(run))) return
  return follow(p)
}

export async function work(p, { idle = false } = {}) {
  const w = p.world
  const office = w.office
  const run = p.begin(idle ? 'idle' : 'working', idle ? 'Waiting for a message' : 'Working')
  const desk = (p.deskKey && office.spot(p.deskKey)) || w.assignDesk(p)
  if (!desk) {
    p.activity = 'Waiting for a free desk'
    if (!(await p.standUp(run))) return
    const room = office.room(p.dept) ?? office.room('lobby')
    if (!(await p.walkTo({ x: room.cx + rand(-2, 2), z: (room.z0 + room.z1) / 2 + rand(-1, 1) })) || !p.alive(run)) return
    p.pose = 'phone'
    return
  }
  if (p.spotKey !== desk.key || p.atSpot !== desk.key) {
    if (!(await p.standUp(run))) return
    if (!(await p.takeSpot(desk, run))) return
  }
  p.pose = idle ? 'sleep' : 'type'
  if (idle) return
  let first = true
  for (;;) {
    if (!(await p.wait(first ? rand(6, 16) : rand(14, 34))) || !p.alive(run)) return
    first = false
    const roll = Math.random()
    if (roll < 0.42) {
      const mate = w.pickTeammate(p)
      if (mate) {
        await pairUp(p, mate, desk, run)
        if (!p.alive(run)) return
        continue
      }
    }
    if (roll > 0.86) {
      await quickBreak(p, desk, run, 'coffee', 'drink', '☕', 'Grabbing a coffee')
      if (!p.alive(run)) return
    }
  }
}

async function pairUp(p, mate, desk, run) {
  const office = p.world.office
  const mateDesk = office.spot(mate.deskKey)
  const visit = mateDesk && office.siblings(mateDesk).find(s => s.act === 'visit')
  if (!visit || !office.reserve(visit.key, p.key)) return
  if (!(await p.standUp(run))) return
  p.activity = `Pairing with ${mate.name}`
  if (!(await p.takeSpot(visit, run))) return
  p.pose = 'talk'
  p.say('💬', 4)
  mate.say('💡', 4)
  mate.gesture('talk', 5)
  if (!(await p.wait(rand(5, 9))) || !p.alive(run)) return
  if (!(await p.standUp(run))) return
  if (!(await p.takeSpot(desk, run))) return
  p.pose = 'type'
  p.activity = 'Working'
}

async function quickBreak(p, desk, run, act, pose, icon, label) {
  const office = p.world.office
  const spot = nearest(p, office.spots({ act, free: true }))
  if (!spot || !office.reserve(spot.key, p.key)) return
  if (!(await p.standUp(run))) return
  p.activity = label
  if (!(await p.takeSpot(spot, run))) return
  p.pose = pose
  p.say(icon, 3)
  if (!(await p.wait(rand(5, 8))) || !p.alive(run)) return
  if (!(await p.standUp(run))) return
  if (!(await p.takeSpot(desk, run))) return
  p.pose = 'type'
  p.activity = 'Working'
}

export async function report(p) {
  const w = p.world
  const office = w.office
  p.failed = p.data?.status === 'failed'
  const run = p.begin('reporting', p.failed ? 'Explaining what went wrong' : 'Handing in the report')
  if (!(await p.standUp(run, { keepDesk: false }))) return
  w.releaseDesk(p)
  const lead = w.leadFor(p.sessionId)
  const spot = lead ? w.freeReportSpot(lead) : null
  if (spot && office.reserve(spot.key, p.key)) {
    if (!(await p.takeSpot(spot, run))) return
    p.pose = 'talk'
    p.say(p.failed ? '😓' : '📄', 3)
    lead.say(p.failed ? '🤝' : '👍', 3)
    lead.gesture('talk', 3)
    if (!(await p.wait(3)) || !p.alive(run)) return
  }
  w.payout(p)
  p.reported = true
  p.pose = p.failed ? 'sad' : 'cheer'
  if (!(await p.wait(p.failed ? 1.4 : 1.8)) || !p.alive(run)) return
  return leisure(p)
}

/** Things to do once the work is done. `pair` ones need a partner on the other side. */
export const ACTIVITIES = [
  { act: 'coffee', weight: 2, pose: 'drink', icon: '☕', label: 'Having a coffee', time: [10, 18] },
  { act: 'couch', weight: 2.2, pose: 'lean', icon: '😌', label: 'Relaxing on the couch', time: [18, 36] },
  { act: 'beanbag', weight: 1.4, pose: 'sleep', icon: '😴', label: 'Napping on a beanbag', time: [18, 40] },
  { act: 'pingpong', weight: 2.6, pair: true, pose: 'pingpong', icon: '🏓', label: 'Playing ping-pong', time: [18, 34] },
  { act: 'foosball', weight: 1.8, pair: true, pose: 'foosball', icon: '⚽', label: 'Playing foosball', time: [16, 30] },
  { act: 'chat', weight: 1.7, pair: true, pose: 'talk', icon: '💬', label: 'Chatting at the water cooler', time: [10, 20] },
  { act: 'brainstorm', weight: 0.7, pair: true, pose: 'present', icon: '💡', label: 'Sketching ideas on the whiteboard', time: [10, 18] },
  { act: 'arcade', weight: 1.6, pose: 'arcade', icon: '🕹️', label: 'Chasing a high score', time: [15, 30] },
  { act: 'read', weight: 1.1, pose: 'read', icon: '📖', label: 'Reading a book', time: [15, 30] },
  { act: 'run', weight: 1.1, pose: 'run', icon: '💪', label: 'Running on the treadmill', time: [15, 28] },
  { act: 'snack', weight: 0.9, pose: 'drink', icon: '🍫', label: 'Grabbing a snack', time: [6, 10] },
  { act: 'fish', weight: 0.8, pose: 'stand', icon: '🐠', label: 'Watching the fish', time: [10, 20] },
  { act: 'shop', weight: 0, pose: 'shop', icon: '🛍️', label: 'Shopping for a new look', time: [4, 7] },
]

function nearest(p, spots) {
  let best = null
  let bestDistance = Infinity
  for (const spot of spots) {
    const d = Math.hypot(spot.x - p.pos.x, spot.z - p.pos.z)
    if (d < bestDistance) {
      bestDistance = d
      best = spot
    }
  }
  return best
}

function chooseActivity(p) {
  const w = p.world
  const office = w.office
  const options = []
  for (const activity of ACTIVITIES) {
    const free = office.spots({ act: activity.act, free: true })
    if (free.length === 0) continue
    let weight = activity.weight
    let spots = free
    if (activity.pair) {
      const waiting = free.filter(spot => office.siblings(spot).some(s => s.act === activity.act && w.isWaitingFor(s.key)))
      if (waiting.length > 0) {
        weight *= 4
        spots = waiting
      }
    }
    if (activity.act === 'shop') weight = w.time - p.lastShop > 90 && w.economy.wishFor(p.staffName) ? 3 : 0
    if (activity.act === p.lastActivity) weight *= 0.25
    if (weight > 0) options.push({ weight, activity, spot: nearest(p, spots) })
  }
  return weighted(options)
}

export async function leisure(p) {
  const w = p.world
  const office = w.office
  const run = p.begin('leisure', 'On a break')
  let rounds = 0
  for (;;) {
    if (!(await p.standUp(run))) return
    if (w.shouldGoHome(p, rounds)) return leave(p)
    const choice = chooseActivity(p)
    if (!choice || !office.reserve(choice.spot.key, p.key)) {
      p.activity = 'Taking a stroll'
      p.icon = '🚶'
      if (!(await p.walkTo(w.strollPoint())) || !p.alive(run)) return
      p.pose = 'stand'
      if (!(await p.wait(rand(3, 7))) || !p.alive(run)) return
      rounds += 1
      continue
    }
    const { activity, spot } = choice
    p.activity = activity.label
    p.icon = activity.icon
    p.lastActivity = activity.act
    if (!(await p.takeSpot(spot, run))) return
    if (activity.act === 'shop') await shop(p, run)
    else if (activity.pair) await playPair(p, spot, activity, run)
    else {
      p.pose = activity.pose
      if (!(await p.wait(rand(...activity.time)))) return
    }
    if (!p.alive(run)) return
    rounds += 1
  }
}

async function playPair(p, spot, activity, run) {
  const w = p.world
  const office = w.office
  const partnerSpot = office.siblings(spot).find(s => s.act === activity.act)
  const length = rand(...activity.time)
  let played = 0
  let alone = 0
  p.pose = 'stand'
  while (played < length) {
    if (!(await p.wait(0.5)) || !p.alive(run)) return
    const partner = partnerSpot && w.people.get(office.occupant(partnerSpot.key))
    if (partner && partner.atSpot === partnerSpot.key) {
      played += 0.5
      p.pose = activity.pose
      p.activity = `${activity.label} with ${partner.name}`
    } else {
      alone += 0.5
      p.pose = 'stand'
      p.activity = `Waiting for someone to join (${activity.icon})`
      if (played > 0 || alone > 14) return
    }
  }
}

async function shop(p, run) {
  const w = p.world
  p.pose = 'shop'
  p.say('🛍️', 3)
  if (!(await p.wait(rand(4, 7))) || !p.alive(run)) return
  p.lastShop = w.time
  const wish = w.economy.wishFor(p.staffName)
  if (!wish) {
    p.say('🤷', 2)
    await p.wait(1.5)
    return
  }
  const result = w.economy.dress(p.staffName, wish.slot, wish.value)
  if (!result.ok) return
  p.restyle(result.look)
  w.ticker('🛍️', `${p.name} bought ${ITEM_NAMES[wish.value] ?? wish.value} for $${wish.price}`)
  w.refreshInspector(p)
  p.say('✨', 3)
  p.pose = 'cheer'
  await p.wait(2.4)
}

/** Back to whatever they were doing before a party or a move: a finished worker goes back on a break. */
export function resume(p) {
  const finished = p.data?.status === 'done' || p.data?.status === 'failed'
  if (p.kind === 'agent' && finished && p.reported) return leisure(p)
  return follow(p)
}

/**
 * The pizza party: gather round the table, eat, chat and cheer until it ends.
 * `stay` limits a busy guest to a quick slice before going back to work.
 */
export async function party(p, { delay = 0, stay = null } = {}) {
  const w = p.world
  const office = w.office
  const run = p.begin('party', 'At the pizza party')
  p.icon = '🍕'
  if (delay > 0 && (!(await p.wait(delay)) || !p.alive(run))) return
  if (!(await p.standUp(run))) return
  const spot = nearest(p, office.spots({ act: 'party', free: true }))
  if (spot && office.reserve(spot.key, p.key)) {
    if (!(await p.takeSpot(spot, run, { hurry: true }))) return
  } else {
    const table = w.partyTable()
    if (!table) return resume(p)
    const a = Math.random() * Math.PI * 2
    if (!(await p.walkTo({ x: table.x + Math.sin(a) * 2.1, z: table.z + Math.cos(a) * 2.1 }, { hurry: true })) || !p.alive(run)) return
    p.targetYaw = a + Math.PI
  }
  p.activity = stay ? 'Grabbing a slice at the pizza party' : 'Celebrating at the pizza party'
  const until = stay ? w.time + stay : Infinity
  const moves = [
    ['eat', '🍕', 4],
    ['talk', '😄', 3],
    ['cheer', '🎉', 1.6],
    ['eat', '🍕', 3.5],
    ['drink', '🥤', 3],
  ]
  let i = Math.floor(Math.random() * moves.length)
  while (w.partyActive() && w.time < until) {
    const [pose, icon, seconds] = moves[i % moves.length]
    i += 1
    p.pose = pose
    p.icon = icon
    p.say(icon, seconds)
    if (!(await p.wait(seconds)) || !p.alive(run)) return
  }
  return resume(p)
}

export async function remote(p) {
  const w = p.world
  const office = w.office
  const run = p.begin('remote', 'On a call from their own session')
  const desk = (p.deskKey && office.spot(p.deskKey)) || w.assignDesk(p)
  if (!desk) return
  if (p.atSpot !== desk.key) {
    if (!(await p.standUp(run))) return
    if (!(await p.takeSpot(desk, run))) return
  }
  for (;;) {
    p.pose = p.pose === 'type' ? 'phone' : 'type'
    if (!(await p.wait(rand(6, 12))) || !p.alive(run)) return
  }
}

export async function leave(p) {
  const w = p.world
  const office = w.office
  const run = p.begin('leaving', 'Heading home')
  if (!(await p.standUp(run, { keepDesk: false }))) return
  w.releaseDesk(p)
  const entrance = office.entrance
  p.icon = '👋'
  p.say('👋', 3)
  if (!(await p.walkTo(entrance.inside)) || !p.alive(run)) return
  if (!(await p.walkTo(entrance.outside)) || !p.alive(run)) return
  if (!(await p.walkTo(entrance.street)) || !p.alive(run)) return
  p.vanish()
}

export async function manage(lead) {
  const w = lead.world
  const office = w.office
  const run = lead.begin('managing', 'At the desk')
  const desk = w.managerDesk(lead)
  if (!desk) return
  if (lead.atSpot !== desk.key) {
    if (!(await lead.standUp(run))) return
    if (!(await lead.takeSpot(desk, run, { hurry: lead.data?.status === 'working' }))) return
  }
  let waited = 0
  for (;;) {
    const working = lead.data?.status === 'working'
    lead.pose = working ? 'type' : 'lean'
    lead.activity = working ? lead.data?.doing?.text ?? 'Working' : 'Waiting for your next message'
    if (!(await lead.wait(1)) || !lead.alive(run)) return
    waited = working ? 0 : waited + 1
    if (waited > 18 && Math.random() < 0.05) {
      waited = 0
      const coffee = nearest(lead, office.spots({ act: 'coffee', free: true }))
      if (!coffee || !office.reserve(coffee.key, lead.key)) continue
      if (!(await lead.standUp(run))) return
      lead.activity = 'Coffee break'
      if (!(await lead.takeSpot(coffee, run))) return
      lead.pose = 'drink'
      lead.say('☕', 3)
      for (let i = 0; i < 16 && lead.data?.status !== 'working'; i += 1) {
        if (!(await lead.wait(0.5)) || !lead.alive(run)) return
      }
      const hurry = lead.data?.status === 'working'
      if (hurry) lead.say('❗', 2)
      if (!(await lead.standUp(run))) return
      if (!(await lead.takeSpot(desk, run, { hurry }))) return
    }
  }
}

export async function reception(p) {
  const office = p.world.office
  const run = p.begin('reception', 'Running the front desk')
  const desk = office.spots({ act: 'reception' })[0]
  if (!desk || !office.reserve(desk.key, p.key)) return
  if (!(await p.takeSpot(desk, run))) return
  for (;;) {
    p.pose = Math.random() < 0.3 ? 'phone' : 'type'
    if (!(await p.wait(rand(6, 14))) || !p.alive(run)) return
  }
}
