// The building: floors, low cut-away walls with doors, signs, empty lots,
// the furniture in every room, and the walking grid that goes with them.

import * as THREE from 'three'
import { COLUMNS, DEPT_COLOR, HALL, NORTH, OUTSIDE, ROOM_INFO, SOUTH, DOOR_WIDTH, extentOf, lotsOf, planRooms, roomFurniture } from './layout.js'
import { neonSign } from './city.js'
import { STOP_AT, WARN_FROM } from './economy.js'
import { makeSign } from './labels.js'
import { FURNITURE, ball, box, buildFurniture, canvasPlane, cyl, mat, put, rbox } from './models.js'
import { Nav } from './nav.js'

const WALL_H = 1.15
const WALL_T = 0.14
const WALL = '#1c2029'
/** Neon caps: cyan along the hall, magenta on the outside, violet between rooms. */
const CAP_HALL = '#2bf3ff'
const CAP_OUTER = '#ff2bd6'
const CAP_INNER = '#7b5cff'
/** Each room's own light colour. */
const ROOM_LIGHT = {
  lead: '#ffb02b',
  lobby: '#2bf3ff',
  break: '#ff2bd6',
  engineering: '#3f8cff',
  research: '#2bffd0',
  planning: '#a35cff',
  ops: '#ff8a2b',
  remote: '#3bff9d',
  meeting: '#2bf3ff',
  gameroom: '#ff3b5c',
}

const floorTextures = new Map()

function floorTexture(kind, tint = '#999999') {
  const key = `${kind}:${tint}`
  if (floorTextures.has(key)) return floorTextures.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const g = canvas.getContext('2d')
  if (kind === 'wood' || kind === 'oak') {
    const base = kind === 'wood' ? ['#3b2a21', '#35251d', '#402e24', '#31221b'] : ['#4a3a2e', '#433429', '#4f3f32', '#3e3026']
    for (let i = 0; i < 8; i += 1) {
      g.fillStyle = base[i % base.length]
      g.fillRect(0, i * 32, 256, 32)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(0, i * 32 + 31, 256, 1)
      const cut = (i * 97) % 256
      g.fillRect(cut, i * 32, 1, 32)
      g.fillRect((cut + 128) % 256, i * 32, 1, 32)
    }
  } else if (kind === 'tile' || kind === 'hall') {
    const [a, b] = kind === 'tile' ? ['#23262e', '#1c1f26'] : ['#191c23', '#16191f']
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        g.fillStyle = (x + y) % 2 ? a : b
        g.fillRect(x * 64, y * 64, 64, 64)
      }
    }
    g.strokeStyle = kind === 'hall' ? 'rgba(43,243,255,0.18)' : 'rgba(255,255,255,0.05)'
    for (let i = 0; i <= 4; i += 1) {
      g.beginPath()
      g.moveTo(i * 64, 0)
      g.lineTo(i * 64, 256)
      g.moveTo(0, i * 64)
      g.lineTo(256, i * 64)
      g.stroke()
    }
  } else if (kind === 'lot') {
    g.fillStyle = '#14161c'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = 'rgba(255,176,43,0.16)'
    for (let i = -256; i < 256; i += 48) {
      g.beginPath()
      g.moveTo(i, 256)
      g.lineTo(i + 24, 256)
      g.lineTo(i + 280, 0)
      g.lineTo(i + 256, 0)
      g.fill()
    }
    for (let i = 0; i < 900; i += 1) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }
  } else {
    const c = new THREE.Color(tint).multiplyScalar(0.32)
    g.fillStyle = `#${c.getHexString()}`
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2600; i += 1) {
      const shade = Math.random() > 0.5 ? 255 : 0
      g.fillStyle = `rgba(${shade},${shade},${shade},${Math.random() * 0.07})`
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  floorTextures.set(key, tex)
  return tex
}

function floor(x0, x1, z0, z1, kind, tint, tile = 2) {
  const tex = floorTexture(kind, tint).clone()
  tex.needsUpdate = true
  tex.repeat.set((x1 - x0) / tile, (z1 - z0) / tile)
  const glossy = kind === 'tile' || kind === 'hall' || kind === 'wood'
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, z1 - z0),
    new THREE.MeshStandardMaterial({ map: tex, roughness: glossy ? 0.32 : 0.85, metalness: glossy ? 0.35 : 0.05 }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2)
  mesh.receiveShadow = true
  mesh.userData.isFloor = true
  return mesh
}

/** A wall along x at `z` from x0 to x1, leaving gaps (doors). */
function wallAlongX(group, x0, x1, z, gaps = [], cap = CAP_INNER) {
  let start = x0
  const cuts = [...gaps].sort((a, b) => a[0] - b[0])
  for (const [a, b] of [...cuts, [x1, x1]]) {
    if (a - start > 0.05) {
      put(group, box(a - start, WALL_H, WALL_T, WALL, { metal: 0.4, rough: 0.5 }), (start + a) / 2, WALL_H / 2, z)
      put(group, box(a - start, 0.05, WALL_T + 0.03, cap, { emissive: cap }), (start + a) / 2, WALL_H + 0.025, z)
    }
    start = Math.max(start, b)
  }
}

function wallAlongZ(group, z0, z1, x, cap = CAP_INNER) {
  put(group, box(WALL_T, WALL_H, z1 - z0, WALL, { metal: 0.4, rough: 0.5 }), x, WALL_H / 2, (z0 + z1) / 2)
  put(group, box(WALL_T + 0.03, 0.05, z1 - z0, cap, { emissive: cap }), x, WALL_H + 0.025, (z0 + z1) / 2)
}

function doorPosts(group, x, z) {
  for (const dx of [-DOOR_WIDTH / 2, DOOR_WIDTH / 2]) {
    put(group, box(0.16, WALL_H + 0.5, 0.2, '#2a2f3a', { metal: 0.6, rough: 0.35 }), x + dx, (WALL_H + 0.5) / 2, z)
    put(group, box(0.04, WALL_H + 0.45, 0.22, CAP_HALL, { emissive: CAP_HALL }), x + dx, (WALL_H + 0.45) / 2, z)
  }
}

function cone(group, x, z) {
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 12), mat('#ff7a1a'))
  c.position.set(x, 0.24, z)
  c.castShadow = true
  group.add(c)
  put(group, cyl(0.12, 0.12, 0.05, '#ffffff', 12), x, 0.3, z)
  put(group, box(0.36, 0.03, 0.36, '#ff7a1a'), x, 0.015, z)
}

export class Office {
  constructor(scene) {
    this.scene = scene
    this.root = new THREE.Group()
    scene.add(this.root)
    this.occupancy = new Map()
    this.built = new Set()
    this.rooms = []
    this.furniture = []
    this.byId = new Map()
    this.spotsByKey = new Map()
    this.growing = []
    this.time = 0
  }

  /** Builds (or rebuilds) the whole floor for these rooms, the leads' desks and the bought furniture. */
  build({ built, managers = 2, purchases = [] }) {
    const previous = this.built
    this.built = new Set(built)
    this.managers = managers
    this.purchases = purchases
    for (const child of [...this.root.children]) this.root.remove(child)
    this.rooms = planRooms(this.built)
    this.extent = extentOf(this.built)
    this.nav = new Nav(this.rooms, this.extent)
    this.furniture = []
    this.byId = new Map()
    this.spotsByKey = new Map()
    this.roomGroups = new Map()

    this.buildGrounds()
    this.buildHall()
    for (const room of this.rooms) this.buildRoom(room, !previous.has(room.id) && previous.size > 0)
    for (const lot of lotsOf(this.built)) this.buildLot(lot)
    this.buildWalls()
    for (const item of purchases) {
      if (this.built.has(item.room)) this.place({ ...item })
    }
    for (const key of [...this.occupancy.keys()]) if (!this.spotsByKey.has(key)) this.occupancy.delete(key)
  }

  /** The building's footprint on the plaza: a dark slab with a glowing edge, the pavement, and the neon sign over the door. */
  buildGrounds() {
    const g = new THREE.Group()
    g.add(floor(-6, this.extent + 6, OUTSIDE.z0, OUTSIDE.z1, 'hall', null, 1.5))
    put(g, box(this.extent + 1.2, 0.08, 19.6, '#15181f', { metal: 0.5, rough: 0.4 }), this.extent / 2, -0.05, 9.5)
    for (const z of [-0.6, 19.6]) put(g, box(this.extent + 1.3, 0.04, 0.08, '#2bf3ff', { emissive: '#2bf3ff' }), this.extent / 2, 0.0, z)
    for (const x of [-0.6, this.extent + 0.6]) put(g, box(0.08, 0.04, 20.2, '#2bf3ff', { emissive: '#2bf3ff' }), x, 0.0, 9.5)
    const banner = neonSign('AGENT OFFICE', '#ff2bd6', { width: 6.4, height: 1.3 })
    banner.position.set(COLUMNS[0].x0 + 4.5, 2.5, SOUTH.z1 + 0.14)
    g.add(banner)
    for (const x of [COLUMNS[0].x0 + 1.4, COLUMNS[0].x0 + 7.6]) {
      put(g, box(0.12, 3.2, 0.12, '#2a2f3a', { metal: 0.7, rough: 0.3 }), x, 1.6, SOUTH.z1 + 0.12)
      put(g, box(0.04, 3.1, 0.14, '#ff2bd6', { emissive: '#ff2bd6' }), x, 1.6, SOUTH.z1 + 0.13)
    }
    this.root.add(g)
  }

  /** The power meter on the lead office's hall wall: usage of the session and the week, with an alarm light. */
  buildMeter(g) {
    const x = 1.75
    const z = HALL.z0 + 0.16
    const meter = new THREE.Group()
    meter.position.set(x, 0, z)
    for (const dx of [-0.6, 0.6]) put(meter, box(0.08, 1.2, 0.08, '#2a2f3a'), dx, 0.6, 0)
    put(meter, rbox(1.6, 1.15, 0.14, '#12151c', 0.05), 0, 1.75, 0)
    put(meter, box(1.64, 0.03, 0.16, '#2bf3ff', { emissive: '#2bf3ff' }), 0, 2.33, 0)
    const face = canvasPlane(1.48, 1.03, () => {}, { px: 512, emissive: true })
    face.position.set(0, 1.75, 0.075)
    meter.add(face)
    const beacon = put(meter, ball(0.11, '#5aff8a', { emissive: '#30d060' }, 16), 0, 2.45, 0)
    beacon.material = beacon.material.clone()
    put(meter, cyl(0.07, 0.09, 0.08, '#3d424b', 12), 0, 2.33, 0)
    g.add(meter)
    this.nav.block(x, z, 1.4, 0.3, 0)
    this.meter = { face, beacon, signature: null, warn: false }
    this.drawMeter(this.meterReading ?? null)
  }

  /** Redraws the meter's face for a reading `{ session, week, sessionResetsAt, pretend }`, or a blank one. */
  drawMeter(reading) {
    this.meterReading = reading
    const meter = this.meter
    if (!meter) return
    const signature = JSON.stringify(reading)
    if (signature === meter.signature) return
    meter.signature = signature
    const canvas = meter.face.userData.canvas
    const g = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    g.fillStyle = '#10151d'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#ffd23f'
    g.font = 'bold 44px ui-rounded, system-ui, sans-serif'
    g.textBaseline = 'middle'
    g.fillText(reading?.pretend ? '⚡ POWER (pretend)' : '⚡ POWER', 24, 46)
    const bars = [
      ['SESSION', reading?.session],
      ['WEEK', reading?.week],
    ]
    bars.forEach(([label, value], i) => {
      const y = 112 + i * 112
      g.fillStyle = '#c9d3df'
      g.font = 'bold 30px ui-rounded, system-ui, sans-serif'
      g.fillText(label, 24, y)
      const pct = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : null
      g.fillStyle = '#26303d'
      g.beginPath()
      g.roundRect(24, y + 22, w - 48, 40, 14)
      g.fill()
      if (pct !== null) {
        g.fillStyle = pct >= STOP_AT ? '#ff4d4d' : pct >= WARN_FROM ? '#ffb22e' : '#3fd27a'
        g.beginPath()
        g.roundRect(24, y + 22, Math.max(28, ((w - 48) * pct) / 100), 40, 14)
        g.fill()
        g.fillStyle = '#ffffff'
        g.font = 'bold 34px ui-rounded, system-ui, sans-serif'
        g.textAlign = 'right'
        g.fillText(`${Math.round(pct)}%`, w - 30, y)
        g.textAlign = 'left'
      }
      g.fillStyle = 'rgba(255,255,255,0.5)'
      // The stop line.
      g.fillRect(24 + ((w - 48) * STOP_AT) / 100, y + 16, 4, 52)
    })
    meter.warn = Math.max(reading?.session ?? 0, reading?.week ?? 0) >= STOP_AT
    if (!reading) {
      g.fillStyle = '#8a94a3'
      g.font = '28px ui-rounded, system-ui, sans-serif'
      g.fillText('No reading yet', 24, h - 40)
    } else if (meter.warn) {
      g.fillStyle = '#ff6b6b'
      g.font = 'bold 30px ui-rounded, system-ui, sans-serif'
      g.fillText(`PAST ${STOP_AT}%: TIME TO WRAP UP`, 24, h - 40)
    }
    meter.face.userData.texture.needsUpdate = true
  }

  buildHall() {
    const g = new THREE.Group()
    g.add(floor(0, this.extent, HALL.z0, HALL.z1, 'hall', null, 1))
    // A glowing guide line down the middle of the hall.
    put(g, box(this.extent - 0.4, 0.012, 0.05, '#2bf3ff', { emissive: '#2bf3ff' }), this.extent / 2, 0.02, (HALL.z0 + HALL.z1) / 2)
    this.buildMeter(g)
    for (const column of COLUMNS) {
      if (column.x1 > this.extent || column.x0 === 0) continue
      for (const z of [HALL.z0 + 0.35, HALL.z1 - 0.35]) {
        const item = { id: `hall:${column.x0}:${z}`, type: 'plant', x: column.x0, z, rot: 0, room: 'hall' }
        this.addFurniture(item, g)
      }
    }
    this.root.add(g)
  }

  buildRoom(room, isNew) {
    const g = new THREE.Group()
    g.add(floor(room.x0, room.x1, room.z0, room.z1, room.floor, room.tint, room.floor === 'carpet' ? 3 : 2))
    const accent = DEPT_COLOR[room.id]
    const items = roomFurniture(room, { managers: this.managers })
    items.forEach((item, i) => this.addFurniture({ ...item, id: `${room.id}:${i}`, room: room.id }, g, accent))
    const signColor = ROOM_LIGHT[room.id] ?? accent ?? '#2bf3ff'
    const door = room.doors[0]
    const sign = makeSign(room.name, signColor)
    const facing = room.row === 'north' ? 1 : -1
    sign.position.set(door.x, 1.72, door.z + facing * 0.1)
    sign.rotation.y = room.row === 'north' ? 0 : Math.PI
    g.add(sign)
    for (const dx of [-0.9, 0.9]) put(g, box(0.05, 0.6, 0.05, '#2a2f3a'), door.x + dx, 1.42, door.z)
    // The room's own coloured light, high up, so each room has its mood.
    const light = new THREE.PointLight(ROOM_LIGHT[room.id] ?? '#ffffff', 26, 15, 1.6)
    light.position.set(room.cx, 3.4, (room.z0 + room.z1) / 2)
    g.add(light)
    if (isNew) {
      g.scale.set(1, 0.01, 1)
      this.growing.push({ group: g, t: 0 })
    }
    this.roomGroups.set(room.id, g)
    this.root.add(g)
  }

  buildLot(lot) {
    const g = new THREE.Group()
    g.add(floor(lot.x0, lot.x1, lot.z0, lot.z1, 'lot', null, 2))
    const info = ROOM_INFO[lot.id]
    const cx = (lot.x0 + lot.x1) / 2
    const cz = (lot.z0 + lot.z1) / 2
    const label = info.price ? `For sale: ${info.name}` : `Opens when needed: ${info.name}`
    const board = canvasPlane(3.4, 0.9, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,12,18,0.9)'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#ffb02b'
      ctx.lineWidth = 6
      ctx.shadowColor = '#ffb02b'
      ctx.shadowBlur = 16
      ctx.strokeRect(6, 6, w - 12, h - 12)
      ctx.fillStyle = '#ffb02b'
      ctx.font = `bold ${h * 0.3}px "Avenir Next Condensed", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label.toUpperCase(), w / 2, h / 2)
    }, { px: 512, emissive: true })
    board.position.set(cx, 1.1, cz)
    board.rotation.x = -0.5
    g.add(board)
    put(g, box(0.06, 0.8, 0.06, '#2a2f3a'), cx - 1.2, 0.4, cz - 0.2)
    put(g, box(0.06, 0.8, 0.06, '#2a2f3a'), cx + 1.2, 0.4, cz - 0.2)
    cone(g, lot.x0 + 0.8, lot.z0 + 0.8)
    cone(g, lot.x1 - 0.8, lot.z1 - 0.8)
    cone(g, lot.x0 + 0.8, lot.z1 - 0.8)
    const hallZ = lot.row === 'north' ? HALL.z0 : HALL.z1
    for (let x = lot.x0 + 0.5; x < lot.x1; x += 1) {
      put(g, box(0.9, 0.1, 0.05, Math.round(x) % 2 ? '#ffb02b' : '#1c2029', Math.round(x) % 2 ? { emissive: '#ffb02b' } : undefined), x + 0.45, 0.75, hallZ)
      put(g, box(0.05, 0.75, 0.05, '#2a2f3a'), x, 0.375, hallZ)
    }
    this.root.add(g)
  }

  buildWalls() {
    const g = new THREE.Group()
    const built = id => this.built.has(id)
    for (const row of ['north', 'south']) {
      const band = row === 'north' ? NORTH : SOUTH
      const hallZ = row === 'north' ? HALL.z0 : HALL.z1
      const outerZ = row === 'north' ? NORTH.z0 : SOUTH.z1
      COLUMNS.forEach((column, i) => {
        if (column.x1 > this.extent) return
        const id = column[row]
        const left = i > 0 ? COLUMNS[i - 1][row] : null
        if (built(id) || (left && built(left))) wallAlongZ(g, band.z0, band.z1, column.x0, i === 0 ? CAP_OUTER : CAP_INNER)
        if (!built(id)) return
        const cx = (column.x0 + column.x1) / 2
        const door = [cx - DOOR_WIDTH / 2, cx + DOOR_WIDTH / 2]
        wallAlongX(g, column.x0, column.x1, hallZ, [door], CAP_HALL)
        doorPosts(g, cx, hallZ)
        const entrance = id === 'lobby' ? [door] : []
        wallAlongX(g, column.x0, column.x1, outerZ, entrance, CAP_OUTER)
        if (id === 'lobby') doorPosts(g, cx, outerZ)
        if (column.x1 === this.extent) wallAlongZ(g, band.z0, band.z1, column.x1, CAP_OUTER)
      })
    }
    wallAlongZ(g, HALL.z0, HALL.z1, 0, CAP_OUTER)
    wallAlongZ(g, HALL.z0, HALL.z1, this.extent, CAP_OUTER)
    // Glass doors at the entrance.
    const lobby = this.rooms.find(r => r.id === 'lobby')
    if (lobby) {
      for (const dx of [-0.48, 0.48]) put(g, rbox(0.9, 1.0, 0.04, '#5fdcff', 0.02, { opacity: 0.25, rough: 0.05, metal: 0.4 }), lobby.cx + dx * 1.6, 0.55, SOUTH.z1)
      put(g, box(2.4, 0.02, 1.2, '#1c2029'), lobby.cx, 0.02, SOUTH.z1 + 0.7)
      put(g, box(2.2, 0.025, 0.04, '#ff2bd6', { emissive: '#ff2bd6' }), lobby.cx, 0.03, SOUTH.z1 + 1.28)
    }
    this.root.add(g)
  }

  addFurniture(item, parent, accent) {
    const piece = buildFurniture(item, accent)
    parent.add(piece.group)
    this.furniture.push(piece)
    this.byId.set(item.id, piece)
    for (const spot of piece.spots) this.spotsByKey.set(spot.key, spot)
    const [w, d] = piece.kind.size
    if (!piece.kind.walkOver && w > 0) this.nav.block(item.x, item.z, w, d, item.rot ?? 0)
    return piece
  }

  /** Places a bought piece into its room. */
  place(item) {
    const parent = this.roomGroups.get(item.room) ?? this.root
    return this.addFurniture(item, parent)
  }

  /** Takes a piece out of the world (selling or moving it); everyone on its spots must stand up first. */
  remove(id) {
    const piece = this.byId.get(id)
    if (!piece) return
    piece.group.parent?.remove(piece.group)
    this.furniture = this.furniture.filter(f => f !== piece)
    this.byId.delete(id)
    for (const spot of piece.spots) {
      this.spotsByKey.delete(spot.key)
      this.occupancy.delete(spot.key)
    }
    const [w, d] = piece.kind.size
    if (!piece.kind.walkOver && w > 0) this.nav.block(piece.x, piece.z, w, d, piece.rot ?? 0, 0)
    // Re-block anything that shared those cells.
    for (const other of this.furniture) {
      const [ow, od] = other.kind.size
      if (!other.kind.walkOver && ow > 0) this.nav.block(other.x, other.z, ow, od, other.rot ?? 0)
    }
  }

  room(id) {
    return this.rooms.find(r => r.id === id)
  }

  roomAt(x, z) {
    return this.nav.regionOf(x, z)
  }

  spot(key) {
    return this.spotsByKey.get(key)
  }

  /** Spots for an activity, optionally only in one room, optionally only free ones. */
  spots({ act, room, free = false, type } = {}) {
    const out = []
    for (const spot of this.spotsByKey.values()) {
      if (act && spot.act !== act) continue
      if (room && spot.room !== room) continue
      if (type && spot.type !== type) continue
      if (free && this.occupancy.has(spot.key)) continue
      out.push(spot)
    }
    return out
  }

  occupant(key) {
    return this.occupancy.get(key) ?? null
  }

  reserve(key, who) {
    const holder = this.occupancy.get(key)
    if (holder && holder !== who) return false
    this.occupancy.set(key, who)
    return true
  }

  release(key, who) {
    if (this.occupancy.get(key) === who) this.occupancy.delete(key)
  }

  /** The same piece's other spots: a partner's place at the ping-pong table or the water cooler. */
  siblings(spot) {
    const piece = this.byId.get(spot.furnitureId)
    return piece ? piece.spots.filter(s => s.key !== spot.key) : []
  }

  get entrance() {
    const lobby = this.room('lobby')
    return { outside: { x: lobby.cx, z: OUTSIDE.z0 + 1.6 }, inside: { x: lobby.cx, z: SOUTH.z1 - 1.5 }, street: { x: lobby.cx + 4, z: OUTSIDE.z1 - 0.6 } }
  }

  /** Per frame: rooms rising, screens lit for whoever is working, the TV, the ping-pong ball, the fish. */
  animate(dt, busy) {
    this.time += dt
    const t = this.time
    if (this.meter) {
      const beacon = this.meter.beacon.material
      if (this.meter.warn) {
        beacon.color.set('#ff3030')
        beacon.emissive.set('#ff2020')
        beacon.emissiveIntensity = 0.3 + (Math.sin(t * 9) > 0 ? 1.6 : 0)
      } else {
        beacon.color.set('#5aff8a')
        beacon.emissive.set('#30d060')
        beacon.emissiveIntensity = 0.7
      }
    }
    this.growing = this.growing.filter(g => {
      g.t += dt / 1.1
      const k = Math.min(1, g.t)
      g.group.scale.y = 0.01 + (1 - (1 - k) ** 3) * 0.99
      return k < 1
    })
    for (const piece of this.furniture) {
      const data = piece.group.userData
      if (data.screens) {
        const lit = piece.spots.some(s => busy.has(s.key))
        // A steady glow while someone works: no blinking.
        for (const screen of data.screens) screen.material.color.set(lit ? '#2f78a6' : '#111318')
      }
      if (data.tv) data.tv.material.color.setHSL((t * 0.04 + piece.x * 0.1) % 1, 0.55, 0.5 + Math.sin(t * 3) * 0.05)
      if (data.ball) {
        const playing = piece.spots.every(s => busy.has(s.key))
        data.ball.visible = playing
        if (playing) {
          const p = (t * 1.3) % 2
          const along = p < 1 ? p : 2 - p
          data.ball.position.set(-1.2 + along * 2.4, 0.82 + Math.abs(Math.sin(along * Math.PI * 2)) * 0.25, Math.sin(t * 2.1) * 0.25)
        }
      }
      if (data.balloons) {
        data.balloons.forEach((b, i) => {
          b.position.y = b.userData.baseY + Math.sin(t * 1.6 + i) * 0.06
        })
      }
      if (data.fish) {
        data.fish.forEach((f, i) => {
          const a = t * (0.4 + i * 0.07) + i
          f.position.x = Math.sin(a) * 0.6
          f.position.z = Math.cos(a * 1.3) * 0.12
          f.rotation.y = Math.cos(a) > 0 ? 0 : Math.PI
        })
      }
    }
  }

  /** Whether a bought piece fits at (x, z): inside a room, on free floor, off doors and others' spots. */
  canPlace(type, x, z, rot, ignoreId = null) {
    const kind = FURNITURE[type]
    const [w, d] = kind.size
    const room = this.nav.regionOf(x, z)
    if (!room || room === 'hall' || room === 'outside') return { ok: false, room: null }
    const cells = this.nav.cellsUnder(x, z, Math.max(w, 0.5), Math.max(d, 0.5), rot)
    const reserved = new Set()
    for (const spot of this.spotsByKey.values()) {
      if (ignoreId && spot.furnitureId === ignoreId) continue
      for (const p of [spot, spot.approach]) {
        const [c, r] = this.nav.cellOf(p.x, p.z)
        reserved.add(this.nav.index(c, r))
      }
    }
    for (const r of this.rooms) {
      for (const door of r.doors) {
        for (let dx = -1.25; dx <= 1.25; dx += 0.5) {
          for (const dz of [-0.75, -0.25, 0.25, 0.75]) {
            const [c, rr] = this.nav.cellOf(door.x + dx, door.z + dz)
            reserved.add(this.nav.index(c, rr))
          }
        }
      }
    }
    const ignored = ignoreId ? this.byId.get(ignoreId) : null
    const ignoredCells = new Set()
    if (ignored && !ignored.kind.walkOver) {
      const [iw, id] = ignored.kind.size
      for (const [c, r] of this.nav.cellsUnder(ignored.x, ignored.z, iw, id, ignored.rot ?? 0)) ignoredCells.add(this.nav.index(c, r))
    }
    for (const [c, r] of cells) {
      if (!this.nav.inside(c, r)) return { ok: false, room }
      const i = this.nav.index(c, r)
      if (this.nav.region[i] !== room) return { ok: false, room }
      if (kind.walkOver) continue
      if (this.nav.blocked[i] && !ignoredCells.has(i)) return { ok: false, room }
      if (reserved.has(i)) return { ok: false, room }
    }
    return { ok: true, room }
  }
}
