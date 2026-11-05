// The office app: sets up the 3D scene and camera, listens to the live feed
// of Claude sessions, keeps the people in step with it, and runs the frame loop.

import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { BuildMode } from './build.js'
import { City } from './city.js'
import { Person, arrive, follow, leave, leisure, party as partyTime, report, resume, work } from './brain.js'
import { Demo } from './demo.js'
import { Economy, PAY, RANKS, STOP_AT } from './economy.js'
import { makeFloater } from './labels.js'
import { DEPT_COLOR, HALL, ROOM_INFO, deptOf, roleLabel } from './layout.js'
import { FURNITURE } from './models.js'
import { Office } from './office.js'
import { LEAD_LOOK, defaultLook } from './people.js'
import * as sfx from './sound.js'
import { UI } from './ui.js'
import { clip, duration, escapeHtml as esc, money, rand } from './util.js'

// ------------------------------------------------------------------ scene

const stage = document.getElementById('stage')
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
stage.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#0a0b14')
// Haze: blue-violet, thin enough that the far towers still read, thick enough that they fade.
scene.fog = new THREE.FogExp2('#1a1638', 0.0045)
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.3

/**
 * The night sky underneath the weather's: deep blue overhead, blue-violet, a magenta glow and a low
 * band of warm smog at the horizon, dark below it. The weather's own sky (scenery/weather.js) covers
 * it down to 14 degrees under the horizon; this shows below that, and if the weather is missing.
 */
function skyDome() {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const g = canvas.getContext('2d')
  // Top to bottom: zenith to nadir, the horizon at 0.5. The dome's centre is on the ground, so its
  // horizon shows a little under the eye's; the smog band sits just below it to meet the skyline.
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#070a1c')
  grad.addColorStop(0.25, '#0c1030')
  grad.addColorStop(0.4, '#1a1f4a')
  grad.addColorStop(0.47, '#3a2558')
  grad.addColorStop(0.5, '#5a2a6a')
  grad.addColorStop(0.515, '#a8432c')
  grad.addColorStop(0.535, '#3a1c3e')
  grad.addColorStop(0.56, '#1a1638')
  grad.addColorStop(1, '#0b0a18')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }))
  dome.renderOrder = -1
  return dome
}
const sky = skyDome()
scene.add(sky)

// The near plane sits at half a metre (the camera never gets closer than six): depth stays precise, so
// close-lying surfaces never fight each other when zoomed out.
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 600)
const controls = new MapControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.09
controls.screenSpacePanning = false
controls.minDistance = 6
controls.maxDistance = 64
// Low enough to tilt up to the horizon and see the city, the moon and the searchlights.
controls.maxPolarAngle = 1.48
controls.minPolarAngle = 0.28
controls.zoomToCursor = true

const HEMI = 0.75
const MOON = 0.9
const hemi = new THREE.HemisphereLight('#6a78b8', '#24121e', HEMI)
scene.add(hemi)
// Moonlight: cool blue, the one light that casts the office's shadows.
const sun = new THREE.DirectionalLight('#9fb8ff', MOON)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.03
scene.add(sun, sun.target)

// Neon glow: everything bright enough blooms softly.
// Rendered through a multisampled buffer: the glow pass would otherwise switch off anti-aliasing,
// and thin neon lines would shimmer as the camera moves.
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 }),
)
composer.setPixelRatio(renderer.getPixelRatio())
composer.setSize(window.innerWidth, window.innerHeight)
composer.addPass(new RenderPass(scene, camera))
// Soft and wide, at full resolution: a half-resolution glow pulses as thin neon lines slide between
// pixels. Measured: as steady as no glow at all while the camera moves.
const BLOOM = 0.4
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio()),
  BLOOM,
  0.75,
  0.82,
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})

// ------------------------------------------------------------------ state

const saved = await fetch('/api/save')
  .then(r => r.json())
  .catch(() => ({}))
const economy = new Economy(saved)
const office = new Office(scene)
const city = new City(scene, renderer, camera)
// Far sheet lightning in the clouds is followed by a quiet, distant roll of thunder.
city.onLightning = strength => sfx.thunder(strength)
let cityExtent = 0
sfx.setVolume(economy.save.settings?.volume ?? 35)
sfx.setEnabled(economy.save.settings?.sound !== false)
for (const kind of ['pointerdown', 'keydown']) window.addEventListener(kind, () => sfx.wake(), { once: true })
const demo = new Demo()
let feed = await fetch('/api/feed')
  .then(r => r.json())
  .then(data => data.sessions ?? [])
  .catch(() => [])
let projectKey = null
let userPicked = false
let selectedKey = null
let following = false
let wardrobeFor = null
let giftMode = false
const synced = new Set()
/** The pizza party under way: its table and when it ends. */
let party = null
/** Usage windows already warned about here, so each crossing warns once. */
const warnedWindows = new Set()
let flicker = 0
const floaters = []
const statusOf = new Map()

const world = {
  scene,
  office,
  economy,
  people: new Map(),
  time: 0,
  receptionist: null,

  leadFor(sessionId) {
    return this.people.get(`lead:${sessionId}`) ?? null
  },
  managerDesk(lead) {
    const current = lead.deskKey && office.spot(lead.deskKey)
    if (current) return current
    const desk = office.spots({ act: 'manage', free: true }).sort((a, b) => a.key.localeCompare(b.key))[0]
    if (!desk || !office.reserve(desk.key, lead.key)) return null
    lead.deskKey = desk.key
    return desk
  },
  freeReportSpot(lead) {
    const desk = lead.deskKey && office.spot(lead.deskKey)
    if (!desk) return null
    return office.siblings(desk).find(s => s.act === 'report' && !office.occupant(s.key)) ?? null
  },
  assignDesk(p) {
    const room = office.room(p.dept) ? p.dept : 'engineering'
    const desks = office.spots({ act: 'work', room })
    let free = desks.filter(d => !office.occupant(d.key))
    if (free.length === 0) {
      free = office.spots({ act: 'work', free: true })
      if (free.length === 0) return null
    }
    const matePods = new Set()
    for (const q of this.people.values()) {
      if (q !== p && q.teamKey === p.teamKey && q.deskKey) matePods.add(office.spot(q.deskKey)?.pod)
    }
    const podBusy = pod => desks.some(d => d.pod === pod && office.occupant(d.key))
    const desk = free.find(d => matePods.has(d.pod)) ?? free.find(d => !podBusy(d.pod)) ?? free[0]
    office.reserve(desk.key, p.key)
    p.deskKey = desk.key
    return desk
  },
  releaseDesk(p) {
    if (p.deskKey) office.release(p.deskKey, p.key)
    p.deskKey = null
  },
  teamOf(p) {
    return [...this.people.values()].filter(q => q.kind === 'agent' && q.teamKey === p.teamKey && ['new', 'arriving', 'working'].includes(q.state))
  },
  pickTeammate(p) {
    const ready = [...this.people.values()].filter(
      q =>
        q !== p &&
        q.kind === 'agent' &&
        q.state === 'working' &&
        q.deskKey &&
        q.atSpot === q.deskKey &&
        (q.teamKey === p.teamKey || q.dept === p.dept),
    )
    const team = ready.filter(q => q.teamKey === p.teamKey)
    const pool = team.length ? team : ready
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
  },
  partyActive() {
    return Boolean(party)
  },
  partyTable() {
    return party?.item ?? null
  },
  isWaitingFor(spotKey) {
    const q = this.people.get(office.occupant(spotKey))
    return Boolean(q && q.atSpot === spotKey && q.state === 'leisure')
  },
  shouldGoHome(p, rounds) {
    if (p.gone) return true
    const resting = [...this.people.values()].filter(q => q.state === 'leisure').length
    if (resting > 12 && Math.random() < 0.5) return true
    if (this.time - (p.finishedAt ?? this.time) > 480 && Math.random() < 0.3) return true
    return rounds >= 7 && Math.random() < 0.3
  },
  strollPoint() {
    const rooms = ['break', 'lobby', 'hall'].map(id => (id === 'hall' ? { x0: 0.5, x1: office.extent - 0.5, z0: HALL.z0, z1: HALL.z1 } : office.room(id)))
    const r = rooms[Math.floor(Math.random() * rooms.length)]
    return { x: rand(r.x0 + 0.8, r.x1 - 0.8), z: rand(r.z0 + 0.8, r.z1 - 0.8) }
  },
  /** Spaces out a group's arrival: each newcomer waits a little longer than the one before. */
  arrivalDelay() {
    const now = this.time
    this.nextArrival = Math.max(now, (this.nextArrival ?? 0) + 1.6)
    return this.nextArrival - now
  },
  welcome() {
    const r = this.receptionist
    if (!r) return
    r.say('👋', 2.2)
    r.gesture('wave', 2.2)
  },
  payout(p) {
    const pay = p.pending
    p.pending = null
    if (!pay) return
    floatText(p, `+${money(pay.company)}`, '#3bff9d')
    setTimeout(() => !p.removed && floatText(p, `👛 +${money(pay.wallet)}`, '#ffb02b'), 700)
    sfx.payday()
  },
  ticker(icon, text, amount) {
    ui.tick({ icon, text, money: amount })
  },
  refreshInspector(p) {
    if (p.key === selectedKey) renderInspector()
  },
  remove(p) {
    p.removed = true
    for (const [key, who] of [...office.occupancy]) if (who === p.key) office.occupancy.delete(key)
    scene.remove(p.root)
    this.people.delete(p.key)
    if (selectedKey === p.key) select(null)
  },
}

// ------------------------------------------------------------------ projects

function liveSessions() {
  const now = Date.now()
  return feed.filter(s => !s.isEnded || now - s.seenAt < 10 * 60 * 1000)
}

function projectList() {
  const map = new Map()
  for (const s of liveSessions()) {
    const key = s.root || s.project
    if (!map.has(key)) map.set(key, { key, name: s.project, sessions: [], seenAt: 0 })
    const entry = map.get(key)
    entry.sessions.push(s)
    entry.seenAt = Math.max(entry.seenAt, s.seenAt ?? 0)
  }
  const list = [...map.values()].sort((a, b) => b.seenAt - a.seenAt)
  list.push({ key: 'demo', name: '🎮 Demo Co. (pretend team)', sessions: [demo.session] })
  return list
}

/** The newest project with a session still running, if any. */
function liveProject() {
  return projectList().find(p => p.key !== 'demo' && p.sessions.some(s => !s.isEnded)) ?? null
}

function project() {
  return economy.project(projectKey)
}

function sessionsNow() {
  return projectList().find(p => p.key === projectKey)?.sessions ?? []
}

function rankIndex() {
  return Math.max(0, ...sessionsNow().map(s => s.level?.index ?? 0))
}

/** The wallet a name uses here: the pretend team keeps its own, apart from your real staff. */
function walletName(name) {
  return projectKey === 'demo' ? `demo:${name}` : name
}

function teamKeyOf(session, agent) {
  if (agent.team) return `${session.sessionId}:${agent.team}`
  return `${session.sessionId}:batch:${Math.floor((agent.startedAt ?? 0) / 20000)}`
}

function switchProject(key) {
  if (key === projectKey) return
  for (const p of [...world.people.values()]) world.remove(p)
  world.receptionist = null
  office.occupancy.clear()
  office.built = new Set()
  projectKey = key
  synced.delete(key)
  party = null
  statusOf.clear()
  select(null)
  rebuild()
  spawnReceptionist()
  sync()
  focusHome(true)
}

/** Rooms this project needs now: the standing ones, ones bought or opened before, and each busy department. */
function neededRooms(sessions) {
  const needed = new Set(['lead', 'lobby', 'break', ...project().built])
  const teams = new Map()
  for (const s of sessions) {
    for (const a of s.agents) {
      if (a.status === 'done' || a.status === 'failed') continue
      needed.add(deptOf(a.role))
      const team = teamKeyOf(s, a)
      teams.set(team, (teams.get(team) ?? 0) + 1)
    }
  }
  if ([...teams.values()].some(n => n >= 3)) needed.add('meeting')
  return needed
}

function rebuild() {
  const sessions = sessionsNow()
  const needed = neededRooms(sessions)
  const fresh = [...needed].filter(id => !office.built.has(id) && office.built.size > 0)
  project().built = [...needed].filter(id => !ROOM_INFO[id]?.always)
  economy.dirty = true
  office.build({ built: needed, managers: Math.max(2, Math.min(4, sessions.length)), purchases: project().purchases })
  for (const id of fresh) {
    ui.toast(`🏗️ New room: ${ROOM_INFO[id].name}`)
    ui.tick({ icon: '🏗️', text: `The ${ROOM_INFO[id].name} opened` })
  }
  const cityBuilt = office.extent !== cityExtent
  if (cityBuilt) {
    cityExtent = office.extent
    city.build(office.extent)
    sky.position.set(office.extent / 2, 0, 0)
  }
  const cx = office.extent / 2
  sun.position.set(cx + 18, 34, 30)
  sun.target.position.set(cx, 0, 9)
  const cam = sun.shadow.camera
  cam.left = -office.extent / 2 - 12
  cam.right = office.extent / 2 + 12
  cam.top = 26
  cam.bottom = -26
  cam.near = 1
  cam.far = 120
  cam.updateProjectionMatrix()
  // With the office, the city, the sky and the moonlight all in place, the wet ground takes their reflection.
  if (cityBuilt) city.captureReflections()
  ui.renderDock([...office.rooms].sort((a, b) => a.x0 - b.x0 || a.z0 - b.z0))
}

function spawnReceptionist() {
  const name = 'Remi'
  const staff = economy.staff(name, defaultLook(name, '#2f6f73'))
  const p = new Person(world, { key: 'npc:reception', kind: 'receptionist', name, look: staff.look })
  p.data = null
  world.people.set(p.key, p)
  world.receptionist = p
  const spot = office.spots({ act: 'reception' })[0]
  if (spot) p.place(spot.approach)
  follow(p)
}

// ------------------------------------------------------------------ the sync

/** Brings the office in step with the sessions: new hires, finished work, leavers, pay. */
function sync() {
  const sessions = sessionsNow()
  const first = !synced.has(projectKey)
  synced.add(projectKey)
  const needed = neededRooms(sessions)
  const managers = Math.max(2, Math.min(4, sessions.length))
  if ([...needed].some(id => !office.built.has(id)) || managers !== office.managers) rebuild()

  const present = new Set(['npc:reception'])
  sessions.forEach((session, i) => {
    const sid = session.sessionId
    const leadKey = `lead:${sid}`
    if (!session.isEnded) {
      present.add(leadKey)
      let lead = world.people.get(leadKey)
      if (!lead) {
        const name = sessions.length > 1 ? `Claude ${i + 1}` : 'Claude'
        const staffName = walletName('Claude')
        const staff = economy.staff(staffName, LEAD_LOOK)
        lead = new Person(world, { key: leadKey, kind: 'lead', sessionId: sid, name, staffName, look: staff.look })
        lead.data = session.lead
        lead.session = session
        world.people.set(leadKey, lead)
        const desk = world.managerDesk(lead)
        lead.place(desk ? desk.approach : office.entrance.inside)
        follow(lead)
      }
      lead.data = session.lead
      lead.session = session
    }
    const finished = session.agents.filter(a => a.status === 'done' || a.status === 'failed')
    for (const agent of session.agents) {
      const key = `agent:${sid}:${agent.id}`
      // A session that ended sends everyone home: leaving them out of `present` does that below.
      if (session.isEnded) {
        statusOf.set(key, agent.status)
        continue
      }
      let p = world.people.get(key)
      if (!p) {
        // Someone who finished long ago, or already went home, stays home.
        const isOld = first && finished.includes(agent) && finished.indexOf(agent) < finished.length - 6
        const wentHome = statusOf.has(key) && (agent.status === 'done' || agent.status === 'failed')
        if (session.isEnded || isOld || wentHome) {
          statusOf.set(key, agent.status)
          continue
        }
        const dept = deptOf(agent.role)
        const staffName = walletName(agent.name)
        const staff = economy.staff(staffName, defaultLook(agent.name, DEPT_COLOR[dept]))
        p = new Person(world, { key, kind: 'agent', sessionId: sid, name: agent.name, staffName, dept, look: staff.look })
        p.teamKey = teamKeyOf(session, agent)
        p.data = agent
        world.people.set(key, p)
        if (first) placeOnOpen(p, agent)
        else arrive(p)
        statusOf.set(key, agent.status)
        if (!first) {
          ui.tick({ icon: '🆕', text: `${agent.name} joined ${ROOM_INFO[dept].name}: ${clip(agent.task, 60)}` })
          sfx.blip()
        }
      }
      present.add(key)
      p.data = agent
      const before = statusOf.get(key)
      if (before !== agent.status) {
        statusOf.set(key, agent.status)
        if (p.state !== 'arriving' && p.state !== 'leaving') {
          if (agent.status === 'done' || agent.status === 'failed') {
            p.finishedAt = world.time
            report(p)
          } else if (agent.status === 'idle') work(p, { idle: true })
          else if (agent.status === 'working') work(p)
        }
      }
    }
  })
  for (const p of world.people.values()) {
    if (!present.has(p.key) && p.state !== 'leaving' && !p.removed) {
      p.gone = true
      if (p.state !== 'leisure') leave(p)
    }
  }

  const { payouts, lines } = economy.credit(projectKey, sessions, { walletOf: walletName })
  for (const [key, pay] of payouts) {
    const p = world.people.get(key)
    if (p) p.pending = pay
  }
  if (!first) for (const line of lines) ui.tick(line)
  const p = project()
  const rank = rankIndex()
  if ((p.rankSeen ?? rank) < rank) {
    ui.toast(`🎉 Rank up: ${RANKS[rank]}! New things in the shop`)
    sfx.fanfare()
    ui.tick({ icon: '⭐', text: `The office reached ${RANKS[rank]}` })
  }
  p.rankSeen = rank
  checkParties(sessions, first)
}

// ------------------------------------------------------------------ the pizza party

/** A plan with every task checked off earns a party, once per plan. On opening the office, finished plans just count. */
function checkParties(sessions, first) {
  const p = project()
  p.parties ??= []
  for (const s of sessions) {
    const tasks = s.tasks ?? []
    if (tasks.length < 2 || !tasks.every(t => t.status === 'completed')) continue
    const signature = `${s.sessionId}:${tasks.map(t => t.content).join('|')}`
    if (p.parties.includes(signature)) continue
    p.parties = [...p.parties, signature].slice(-50)
    economy.dirty = true
    if (!first) startParty()
  }
}

/** The open floor nearest a room's middle where the party table and all its guests fit. */
function findPartySpot() {
  const { spots } = FURNITURE.partyTable
  for (const id of ['break', 'gameroom', 'meeting', 'lobby']) {
    const room = office.room(id)
    if (!room) continue
    const cx = room.cx
    const cz = (room.z0 + room.z1) / 2
    const candidates = []
    for (let x = room.x0 + 2; x <= room.x1 - 2; x += 0.5) {
      for (let z = room.z0 + 2; z <= room.z1 - 2; z += 0.5) candidates.push({ x, z, d: (x - cx) ** 2 + (z - cz) ** 2 })
    }
    candidates.sort((a, b) => a.d - b.d)
    for (const c of candidates) {
      if (!office.canPlace('partyTable', c.x, c.z, 0).ok) continue
      const fits = spots.every(s => {
        const [col, row] = office.nav.cellOf(c.x + s.x, c.z + s.z)
        return office.nav.walkable(col, row) && office.nav.regionOf(c.x + s.x, c.z + s.z) === id
      })
      if (fits) return { x: c.x, z: c.z, room: id }
    }
  }
  return null
}

function startParty() {
  economy.earn(projectKey, PAY.partyBonus)
  ui.tick({ icon: '🍕', text: 'Every task on the plan is done: pizza party!', money: PAY.partyBonus })
  ui.toast('🍕 Pizza party! Every task on the plan is done')
  if (party) return
  sfx.fanfare()
  const at = findPartySpot()
  if (!at) return
  const item = { id: 'party:table', type: 'partyTable', x: at.x, z: at.z, rot: 0, room: at.room }
  office.place(item)
  party = { until: world.time + 55, item, confetti: 0 }
  burst(at.x, at.z)
  let n = 0
  for (const p of world.people.values()) {
    if (p.removed || ['leaving', 'arriving', 'reporting', 'new'].includes(p.state)) continue
    if (p.kind === 'lead' && p.data?.status === 'working') {
      p.say('🍕', 3)
      continue
    }
    const busy = p.kind !== 'lead' && (p.state === 'working' || p.state === 'remote' || p.state === 'idle' || p.kind === 'receptionist')
    partyTime(p, { delay: n * 0.35, stay: busy ? rand(12, 18) : null })
    n += 1
  }
}

function endParty() {
  const { item } = party
  party = null
  for (const p of world.people.values()) if (p.state === 'party') resume(p)
  evict(item.id)
  office.remove(item.id)
  ui.tick({ icon: '🧹', text: 'Party over: back to it' })
}

// ------------------------------------------------------------------ the power meter

/**
 * The newest usage any session reported (it is your account's, whichever
 * project), or the pretend team's while only the demo is running.
 */
function usageNow() {
  const real = feed.filter(s => s.usage && (s.usage.session !== null || s.usage.week !== null)).sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0))[0]
  if (real) return { ...real.usage, pretend: false }
  if (projectKey === 'demo' && demo.session.usage) return { ...demo.session.usage, pretend: true }
  return null
}

/** Reads the meter, and raises the alarm once for each window that passed the stop line. */
function checkUsage() {
  const usage = usageNow()
  office.drawMeter(usage && { session: usage.session, week: usage.week, pretend: usage.pretend })
  if (!usage) return null
  for (const [label, value, resets] of [
    ['this 5-hour session', usage.session, usage.sessionResetsAt],
    ['this week', usage.week, usage.weekResetsAt],
  ]) {
    if (typeof value !== 'number' || value < STOP_AT) continue
    const key = `${usage.pretend ? 'pretend' : 'real'}:${label}:${resets ?? Math.floor(value / 100)}`
    if (warnedWindows.has(key)) continue
    warnedWindows.add(key)
    ui.toast(`⚡ Usage at ${Math.round(value)}% of ${label}${usage.pretend ? ' (pretend)' : ''}: time to wrap up`)
    ui.tick({ icon: '⚡', text: `Power past ${STOP_AT}% for ${label}${usage.pretend ? ' (pretend)' : ''}` })
    for (const p of world.people.values()) if (p.kind === 'lead') p.say('⚠️', 4)
    sfx.alarm()
  }
  // A pretend window that reset may warn again on its next climb.
  if (usage.pretend && (usage.session ?? 0) < 60) for (const key of [...warnedWindows]) if (key.startsWith('pretend:')) warnedWindows.delete(key)
  return usage
}

/** On opening the office, everyone starts where they are, rather than all walking in at once. */
function placeOnOpen(p, agent) {
  if (agent.status === 'done' || agent.status === 'failed') {
    p.failed = agent.status === 'failed'
    p.finishedAt = world.time - rand(0, 200)
    p.reported = true
    p.place(world.strollPoint())
    leisure(p)
    return
  }
  const desk = world.assignDesk(p)
  if (desk) p.place(desk.approach)
  follow(p)
}

/** Stands up everyone using a piece that is about to move or be sold, and sends them on their way. */
function evict(furnitureId) {
  for (const p of world.people.values()) {
    const spot = p.spotKey && office.spot(p.spotKey)
    const desk = p.deskKey && office.spot(p.deskKey)
    if (desk?.furnitureId === furnitureId) world.releaseDesk(p)
    if (spot?.furnitureId === furnitureId) {
      office.release(spot.key, p.key)
      p.spotKey = null
      p.atSpot = null
      p.sitting = false
      if (p.state === 'leisure') leisure(p)
      else resume(p)
    }
  }
}

// ------------------------------------------------------------------ the feed

function connect() {
  const stream = new EventSource('/api/stream')
  stream.addEventListener('feed', event => {
    feed = JSON.parse(event.data).sessions ?? []
    needsSync = true
  })
  stream.onerror = () => {
    stream.close()
    setTimeout(connect, 3000)
  }
}

// ------------------------------------------------------------------ camera

let focus = null

function focusOn(x, z, distance = null) {
  const offset = camera.position.clone().sub(controls.target)
  if (distance) offset.setLength(distance)
  focus = { from: controls.target.clone(), to: new THREE.Vector3(x, 0, z), offset, t: 0 }
}

function focusHome(instant = false) {
  const cx = office.extent / 2
  // A low, cinematic angle: the whole office in front, the neon city rising behind it.
  const target = new THREE.Vector3(cx, 5, 7)
  const offset = new THREE.Vector3(0, 11, 42).setLength(Math.max(42, office.extent * 0.86))
  if (instant) {
    controls.target.copy(target)
    camera.position.copy(target).add(offset)
    controls.update()
  } else {
    focus = { from: controls.target.clone(), to: target, offset, t: 0 }
  }
}

const keys = new Set()
window.addEventListener('keydown', event => {
  if (event.target.closest?.('input, select, textarea')) return
  keys.add(event.key.toLowerCase())
  if (event.key === 'Escape') {
    if (!ui.refs.modal.hidden) ui.closeModal()
    else if (build.placing) {
      build.cancel()
      build.render()
    } else if (build.active) build.toggle()
    else select(null)
  }
  if (event.key.toLowerCase() === 'r') build.rotate()
  if (event.key.toLowerCase() === 'b') build.toggle()
  if (event.key.toLowerCase() === 'f' && selectedKey) toggleFollow()
})
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()))

function keyboardPan(dt) {
  const forward = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))
  const move = new THREE.Vector3()
  if (keys.has('w') || keys.has('arrowup')) move.add(forward)
  if (keys.has('s') || keys.has('arrowdown')) move.sub(forward)
  if (keys.has('d') || keys.has('arrowright')) move.add(right)
  if (keys.has('a') || keys.has('arrowleft')) move.sub(right)
  const speed = camera.position.distanceTo(controls.target) * 0.9 * dt
  if (move.lengthSq() > 0) {
    move.setLength(speed)
    controls.target.add(move)
    camera.position.add(move)
    following = false
  }
  const turn = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0)
  if (turn) {
    const offset = camera.position.clone().sub(controls.target)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn * dt * 1.2)
    camera.position.copy(controls.target).add(offset)
  }
}

// ------------------------------------------------------------------ picking

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
let down = null
let hoverKey = null

function pick(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
}

function personAt() {
  const roots = [...world.people.values()].filter(p => !p.removed).map(p => p.root)
  const hit = raycaster.intersectObjects(roots, true).find(h => h.object.userData.personKey && h.object.type === 'Mesh')
  return hit ? hit.object.userData.personKey : null
}

function furnitureAt() {
  const hit = raycaster.intersectObject(office.root, true).find(h => h.object.userData.furnitureId)
  return hit?.object.userData.furnitureId ?? null
}

function groundAt() {
  const point = new THREE.Vector3()
  return raycaster.ray.intersectPlane(ground, point) ? point : null
}

renderer.domElement.addEventListener('pointerdown', event => {
  down = { x: event.clientX, y: event.clientY, at: performance.now(), button: event.button }
})

renderer.domElement.addEventListener('pointermove', event => {
  pick(event)
  if (build.placing) {
    build.hover(groundAt())
    return
  }
  const key = personAt()
  if (key !== hoverKey) {
    const before = world.people.get(hoverKey)
    if (before) before.hovered = false
    hoverKey = key
  }
  const p = world.people.get(key)
  renderer.domElement.style.cursor = p ? 'pointer' : ''
  if (p) {
    p.hovered = true
    p.showTag(p.name)
    const what = p.state === 'working' ? p.data?.doing?.text : p.activity
    ui.tooltip(event.clientX, event.clientY, `<b>${esc(p.name)}</b>${esc(clip(what ?? '', 80))}`)
  } else ui.tooltip(0, 0, null)
})

renderer.domElement.addEventListener('pointerup', event => {
  if (!down) return
  const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
  const wasClick = moved < 6 && performance.now() - down.at < 450
  const button = down.button
  down = null
  if (!wasClick) return
  pick(event)
  if (button === 2 && build.placing) {
    build.cancel()
    build.render()
    return
  }
  if (button !== 0) return
  if (build.active) {
    build.click(groundAt(), furnitureAt())
    return
  }
  select(personAt())
})

renderer.domElement.addEventListener('dblclick', () => {
  if (selectedKey) toggleFollow(true)
})
renderer.domElement.addEventListener('contextmenu', event => event.preventDefault())

function select(key) {
  for (const p of world.people.values()) p.selected = p.key === key
  selectedKey = key
  if (!key) following = false
  const p = world.people.get(key)
  if (p) {
    p.showTag(p.name)
    focusOn(p.pos.x, p.pos.z, Math.min(camera.position.distanceTo(controls.target), 22))
  }
  renderInspector()
  renderStaff()
}

function toggleFollow(on = !following) {
  following = on
  renderInspector()
}

function floatText(p, text, color) {
  const sprite = makeFloater(text, color)
  sprite.position.set(p.pos.x, 2.6, p.pos.z)
  scene.add(sprite)
  floaters.push(sprite)
}

/** A puff of confetti where something was just built. */
function burst(x, z) {
  for (let i = 0; i < 18; i += 1) {
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6) }))
    bit.position.set(x, 0.6, z)
    bit.userData.v = new THREE.Vector3(rand(-1.5, 1.5), rand(2, 4), rand(-1.5, 1.5))
    bit.userData.age = 0
    bit.userData.confetti = true
    scene.add(bit)
    floaters.push(bit)
  }
}

// ------------------------------------------------------------------ panels

function personColor(p) {
  if (p.kind === 'lead') return '#d97757'
  if (p.kind === 'receptionist') return '#2f6f73'
  return DEPT_COLOR[p.dept] ?? '#5b6b7c'
}

function cardFor(p) {
  const staff = economy.save.staff[p.staffName]
  const base = {
    name: p.name,
    color: personColor(p),
    activity: p.state === 'leisure' || p.state === 'arriving' || p.state === 'reporting' ? p.activity : '',
    following,
    canDress: Boolean(staff),
    wallet: staff?.wallet,
    earned: staff?.earned ?? 0,
    bought: staff?.bought ?? 0,
  }
  if (p.kind === 'receptionist') return { ...base, role: 'Receptionist', status: '🛎️ Runs the front desk and waves at every new hire' }
  if (p.kind === 'lead') {
    const lead = p.data ?? {}
    return {
      ...base,
      role: 'Lead',
      status: lead.status === 'working' ? '💻 Working on your request' : '💬 Waiting for your next message',
      task: p.session?.goal ? `Goal: ${p.session.goal}` : '',
      now: lead.doing ? `${lead.doing.icon} ${lead.doing.text}` : '',
      steps: [...(lead.log ?? [])].reverse().map(s => `${s.icon} ${s.text}`),
      stepCount: lead.tools ?? 0,
      activity: lead.status === 'working' ? '' : p.activity,
    }
  }
  const a = p.data ?? {}
  const epoch = (a.startedAt ?? 0) > 1e12
  const status = {
    working: `💻 Working${epoch ? ` for ${duration(Date.now() - a.startedAt)}` : ''}`,
    idle: '💤 Waiting for a message',
    remote: '🛰️ Working in a session of its own',
    done: `✅ Finished${epoch && a.endedAt ? ` in ${duration(a.endedAt - a.startedAt)}` : ''}`,
    failed: '😵 Hit a problem',
  }[a.status] ?? ''
  return {
    ...base,
    role: `${roleLabel(a.role ?? '')} · ${ROOM_INFO[p.dept]?.name ?? ''}`,
    status,
    task: a.task,
    now: a.status === 'working' && a.doing ? `${a.doing.icon} ${a.doing.text}` : '',
    steps: [...(a.log ?? [])].reverse().map(s => `${s.icon} ${s.text}`),
    stepCount: a.tools ?? 0,
    report: a.report,
  }
}

function renderInspector() {
  const p = world.people.get(selectedKey)
  ui.renderInspector(p ? cardFor(p) : null)
}

function renderStaff() {
  const groups = []
  const people = [...world.people.values()].filter(p => !p.removed && p.state !== 'leaving')
  const row = p => ({
    key: p.key,
    name: p.name,
    color: personColor(p),
    icon: (p.sayUntil > world.time ? p.sayIcon : p.baseIcon()) ?? '🙂',
    what: p.kind === 'lead' ? (p.data?.status === 'working' ? p.data?.doing?.text : 'Waiting for you') : p.state === 'working' ? p.data?.doing?.text ?? 'Working' : p.activity,
  })
  const leads = people.filter(p => p.kind !== 'agent')
  if (leads.length) groups.push({ name: 'Front office', color: '#d97757', teams: [{ label: '', people: leads.map(row) }] })
  for (const dept of Object.keys(DEPT_COLOR)) {
    const here = people.filter(p => p.kind === 'agent' && p.dept === dept && ['new', 'arriving', 'working', 'idle', 'remote'].includes(p.state))
    if (!here.length) continue
    const teams = new Map()
    for (const p of here) {
      if (!teams.has(p.teamKey)) teams.set(p.teamKey, [])
      teams.get(p.teamKey).push(p)
    }
    groups.push({
      name: ROOM_INFO[dept].name,
      color: DEPT_COLOR[dept],
      teams: [...teams.entries()].map(([key, members]) => ({
        label: members.length > 1 ? (key.includes(':wf_') ? `Workflow crew · ${members.length}` : key.includes(':batch:') ? `Hired together · ${members.length}` : `Team · ${members.length}`) : '',
        people: members.map(row),
      })),
    })
  }
  const resting = people.filter(p => p.kind === 'agent' && ['reporting', 'leisure'].includes(p.state))
  if (resting.length) groups.push({ name: 'On a break', color: '#e4862a', teams: [{ label: '', people: resting.map(row) }] })
  ui.renderStaff(groups, selectedKey)
}

function renderTop() {
  const sessions = sessionsNow()
  const goal = sessions.find(s => s.goal)?.goal ?? ''
  const tasks = sessions.flatMap(s => s.tasks ?? [])
  ui.renderTop({
    projectKey,
    projects: projectList().map(p => ({ key: p.key, name: p.name })),
    rankIndex: rankIndex(),
    cash: economy.cash(projectKey),
    goal,
    done: tasks.filter(t => t.status === 'completed').length,
    total: tasks.length,
    building: build.active,
    usage: currentUsage,
    sound: sfx.isEnabled(),
    volume: economy.save.settings?.volume ?? 35,
  })
  const live = projectList().length > 1
  const warn = currentUsage && Math.max(currentUsage.session ?? 0, currentUsage.week ?? 0) >= STOP_AT
  ui.renderBanner(
    warn
      ? `⚡ Power past ${STOP_AT}%${currentUsage.pretend ? ' (pretend)' : ''}: time to wrap up. That's your stop rule.`
      : projectKey === 'demo'
      ? live
        ? '🎮 You are watching the pretend team. Pick your project at the top left to see your real agents.'
        : '🎮 No Claude session is writing to the office yet, so a pretend team is working here. Start a new Claude session (or type <b>/reload-plugins</b>) and your agents will show up.'
      : '',
  )
}

// ------------------------------------------------------------------ wardrobe

function openWardrobe() {
  const p = world.people.get(selectedKey)
  if (!p) return
  const name = p.staffName
  const staff = economy.save.staff[name]
  if (!staff) return
  wardrobeFor = p.key
  ui.openWardrobe({
    name: p.kind === 'lead' ? 'Claude' : p.name,
    wallet: staff.wallet,
    cash: economy.cash(projectKey),
    look: staff.look,
    owned: staff.owned,
    gift: giftMode,
    price: (slot, value) => economy.priceOf(name, slot, value),
  })
}

function dress({ slot, value }) {
  const p = world.people.get(wardrobeFor)
  if (!p) return
  const name = p.staffName
  const result = economy.dress(name, slot, value, { gift: giftMode, project: projectKey })
  if (!result.ok) {
    ui.toast(result.reason === 'wallet' ? `${p.name} needs ${money(result.cost)} for that. Tick "The company pays" to gift it.` : `The company needs ${money(result.cost)} for that`)
    return
  }
  for (const q of world.people.values()) if (q.staffName === name) q.restyle(result.look)
  if (result.cost > 0) {
    p.say('✨', 2.5)
    p.gesture('cheer', 1.6)
  }
  openWardrobe()
  renderInspector()
}

// ------------------------------------------------------------------ boot

const ui = new UI(document.getElementById('hud'), {
  project: key => {
    userPicked = true
    switchProject(key)
  },
  select: ({ key }) => select(key),
  deselect: () => select(null),
  focus: () => {
    const p = world.people.get(selectedKey)
    if (p) focusOn(p.pos.x, p.pos.z, 14)
  },
  follow: () => toggleFollow(),
  wardrobe: () => openWardrobe(),
  dress,
  gift: checked => {
    giftMode = Boolean(checked)
    openWardrobe()
  },
  closeModal: () => ui.closeModal(),
  modalClosed: () => {
    wardrobeFor = null
  },
  build: () => build.toggle(),
  pick: ({ type }) => build.pick(type),
  move: () => build.startMove(),
  sell: () => build.sell(),
  buyRoom: ({ id }) => build.buyRoom(id),
  toggleStaff: () => ui.toggleStaff(),
  recenter: () => focusHome(),
  volume: value => {
    const volume = Math.max(0, Math.min(100, Number(value) || 0))
    sfx.setVolume(volume)
    economy.save.settings = { ...economy.save.settings, volume }
    economy.dirty = true
  },
  sound: () => {
    const on = !sfx.isEnabled()
    sfx.setEnabled(on)
    economy.save.settings = { ...economy.save.settings, sound: on }
    economy.dirty = true
    renderTop()
  },
  room: ({ id }) => {
    const room = office.room(id)
    if (room) focusOn(room.cx, (room.z0 + room.z1) / 2, 18)
  },
})

const app = {
  scene,
  ui,
  office,
  economy,
  get projectKey() {
    return projectKey
  },
  project,
  rankIndex,
  rebuild,
  evict,
  burst,
}
const build = new BuildMode(app)

projectKey = liveProject()?.key ?? 'demo'
rebuild()
focusHome(true)
spawnReceptionist()
sync()
connect()
const loading = document.getElementById('loading')
loading.classList.add('done')
setTimeout(() => loading.remove(), 700)

let needsSync = false
let currentUsage = null
let last = performance.now()
let slow = 0
let demoClock = 0
let saving = false

/** Moves the whole office on by `dt` seconds: the feed, the camera, everyone, the furniture, the popups. */
function advance(dt) {
  world.time += dt
  slow += dt
  demoClock += dt

  if (projectKey === 'demo' && demoClock > 0.5) {
    demo.tick(demoClock)
    demoClock = 0
    needsSync = true
  }
  if (needsSync) {
    needsSync = false
    // Watching the pretend team when a real session starts: go and see your own agents.
    const live = !userPicked && projectKey === 'demo' ? liveProject() : null
    if (live) {
      switchProject(live.key)
      ui.toast(`👋 ${live.name} is live: here are your agents`)
    } else sync()
  }

  keyboardPan(dt)
  if (focus) {
    focus.t = Math.min(1, focus.t + dt / 0.7)
    const k = 1 - (1 - focus.t) ** 3
    controls.target.lerpVectors(focus.from, focus.to, k)
    camera.position.copy(controls.target).add(focus.offset)
    if (focus.t >= 1) focus = null
  } else if (following && selectedKey) {
    const p = world.people.get(selectedKey)
    if (p) {
      const target = new THREE.Vector3(p.pos.x, 0, p.pos.z)
      const delta = target.sub(controls.target).multiplyScalar(1 - Math.exp(-4 * dt))
      controls.target.add(delta)
      camera.position.add(delta)
    }
  }
  controls.target.x = Math.min(office.extent + 8, Math.max(-8, controls.target.x))
  controls.target.z = Math.min(28, Math.max(-8, controls.target.z))
  controls.update()

  const busy = new Set()
  for (const p of world.people.values()) {
    p.update(dt, world.time)
    if (p.atSpot && ['type', 'pingpong', 'foosball', 'arcade', 'run', 'phone'].includes(p.pose)) busy.add(p.atSpot)
  }
  office.animate(dt, busy)
  city.update(dt, world.time, controls.target)

  for (let i = floaters.length - 1; i >= 0; i -= 1) {
    const f = floaters[i]
    f.userData.age = (f.userData.age ?? 0) + dt
    if (f.userData.confetti) {
      f.userData.v.y -= 9 * dt
      f.position.addScaledVector(f.userData.v, dt)
      f.rotation.x += dt * 6
      if (f.position.y < 0.02) f.position.y = 0.02
    } else {
      f.position.y += dt * 0.9
      f.material.opacity = Math.max(0, 1 - f.userData.age / 1.8)
    }
    if (f.userData.age > (f.userData.confetti ? 1.6 : 1.8)) {
      scene.remove(f)
      floaters.splice(i, 1)
    }
  }

  if (party) {
    party.confetti -= dt
    if (party.confetti <= 0) {
      party.confetti = 2.5
      burst(party.item.x + rand(-1, 1), party.item.z + rand(-1, 1))
    }
    if (world.time > party.until) endParty()
  }

  // Past the stop line, the lights dim and brighten in a slow four-second pulse (never a hard blink).
  const alarm = currentUsage && Math.max(currentUsage.session ?? 0, currentUsage.week ?? 0) >= STOP_AT
  flicker = alarm ? flicker + dt : 0
  const pulse = alarm ? 0.5 - 0.5 * Math.cos((flicker * Math.PI) / 2) : 0
  hemi.intensity = HEMI * (1 - 0.55 * pulse)
  sun.intensity = MOON * (1 - 0.6 * pulse)
  bloom.strength = BLOOM * (1 - 0.35 * pulse)

  if (slow > 0.5) {
    currentUsage = checkUsage()
    slow = 0
    renderTop()
    renderStaff()
    if (selectedKey && ui.refs.modal.hidden) renderInspector()
    if (economy.dirty && !saving) {
      saving = true
      economy.dirty = false
      fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(economy.save) })
        .catch(() => {
          economy.dirty = true
        })
        .finally(() => {
          saving = false
        })
    }
  }
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
  last = now
  advance(dt)
  composer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// For checking from the browser console.
window.office = {
  world,
  office,
  camera,
  controls,
  composer,
  economy,
  demo,
  select,
  focusOn,
  /**
   * Fast-forwards `seconds` of office life in small steps, letting behaviours
   * run between steps as real frames would, then draws one frame.
   */
  async advance(seconds, step = 1 / 30) {
    const tick = () => new Promise(resolve => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => resolve()
      channel.port2.postMessage(0)
    })
    for (let t = 0; t < seconds; t += step) {
      advance(step)
      await tick()
    }
    composer.render()
  },
}
