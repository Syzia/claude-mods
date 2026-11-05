// The street around the office: a dark wet plaza and road that hold the city's
// light, lamp posts throwing cones into the rain, a transit stop and a row of
// low shops across the road, parked cars, trees in uplit planters, a still
// water channel behind the building and steam rising from the street vents.
// Static parts are merged by material and every repeated light shape is
// instanced, so the whole street costs about twenty draw calls.
//
// Ground levels (metres): plaza -0.05 and road -0.03 (the plaza is cut away
// under the road, so they never overlap), road puddles -0.01 (2 cm over the
// road: a tyre standing in one sinks no deeper than that), vent tops 0.0, road
// marks 0.02 (5 cm over the road, which runs far into the fog), office pavement
// 0.01 (office.js), pavement puddles 0.025, kerb tops 0.045, additive light on
// the ground 0.055 (so light pools run over the kerbs instead of being cut by them).
// Every overlapping layer is at least a centimetre from the next near the
// office and five centimetres apart where it reaches far away.
//
// Footprint: the skyline's flank towers begin 12 m out from either side of the
// office (skyline.js flanks()), so nothing here west, east or north of the
// building reaches further than EDGE (10.5 m) out from it.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { COLUMNS, OUTSIDE } from '../layout.js'
import { hash } from '../util.js'

// ------------------------------------------------------------------ palette and levels

const Y = {
  plaza: -0.05,
  road: -0.03,
  marks: 0.02,
  roadPuddle: -0.01,
  plazaPuddle: -0.035,
  pavePuddle: 0.025,
  water: 0,
  light: 0.055,
  kerb: 0.045,
}

/** How far west of x 0 and east of the office's far wall the street may reach (the flank towers start at 12). */
const EDGE = 10.5

const NEON = { magenta: '#ff2bd6', cyan: '#2bf3ff', green: '#3bff9d', amber: '#ffb02b', red: '#ff3b5c' }
const LAMP = '#dff1ff'
const UPLIGHT = '#3b74ff'
const WARM = '#ffcf8a'
const AMBER_WINDOW = '#ffb45c'
const COOL = '#9fe8ff'
const VIOLET = '#c9b6ff'
const BARK = '#2b2421'
const LEAVES = ['#1c3a2a', '#21422f', '#183326', '#284a33', '#1f3d2c', '#1a3530']
const GRASS = ['#1f3b26', '#25462c', '#2c5232', '#1a3322']
const FONT = '"Avenir Next Condensed", "Avenir Next", "Helvetica Neue", Arial, sans-serif'
const KANA = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif'

/** The transit stop's invented name. */
const STOP = { name: 'LOOP 24', kana: 'のりば' }

/** Shops across the road: plain words for what they sell, and the kind of room behind the glass. */
const SHOPS = [
  { name: 'RAMEN', kana: 'ラーメン', color: NEON.red, room: 'counter' },
  { name: 'KARAOKE', kana: 'カラオケ', color: NEON.magenta, room: 'booths' },
  { name: 'NOODLE BAR', kana: 'めん', color: NEON.amber, room: 'counter' },
  { name: 'ARCADE', kana: 'ゲーム', color: NEON.cyan, room: 'arcade' },
  { name: 'COFFEE 24H', kana: 'コーヒー', color: NEON.green, room: 'cafe' },
  { name: 'LAUNDRY', kana: 'ランドリー', color: COOL, room: 'laundry' },
  { name: 'HOTEL', kana: 'ホテル', color: VIOLET, room: 'cafe' },
  { name: 'MARKET', kana: 'いちば', color: WARM, room: 'market' },
  { name: 'DUMPLINGS', kana: 'ぎょうざ', color: NEON.amber, room: 'counter' },
  { name: 'REPAIR', kana: 'しゅうり', color: NEON.cyan, room: 'market' },
]
const ROOMS = ['counter', 'cafe', 'booths', 'arcade', 'laundry', 'market']
/** The colour each kind of room throws onto the pavement. */
const ROOM_LIGHT = { counter: AMBER_WINDOW, cafe: WARM, booths: NEON.magenta, arcade: '#8f7bff', laundry: COOL, market: '#e8f6ff' }
/** Signs on the shop roofs, facing the office side of the city. */
const ROOF_SIGNS = [
  { name: 'ROOMS', kana: 'ホテル', color: VIOLET },
  { name: 'OPEN LATE', kana: 'えいぎょうちゅう', color: NEON.green },
  { name: 'BAR', kana: 'バー', color: NEON.magenta },
]
/** Windows of the flats over the shops: curtains, blinds, a plant on the sill. */
const FLATS = [
  { light: ['#ffd49a', '#c77a3a'] },
  { light: ['#cfefff', '#6f9fc0'] },
  { light: ['#d9c4ff', '#6a4a9a'] },
]
const VENDING = [
  { label: 'COLD', kana: 'つめたい', banner: '#1f62d8', body: '#c9ced8', light: '#cfe6ff' },
  { label: 'HOT', kana: 'あたたかい', banner: '#d8243c', body: '#a31e33', light: '#ffd9c4' },
  { label: 'SODA', kana: 'のみもの', banner: '#14a86a', body: '#1d2a3a', light: '#d4ffe9' },
]

// ------------------------------------------------------------------ small helpers

/** A seeded random stream: the same street on every load. */
function stream(key) {
  let a = hash(key)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A scale at or above this marks a part that is meant to bloom. */
const BLOOM_K = 1.5
/**
 * The least linear luminance a blooming part is given. The bloom pass thresholds Rec. 709 luminance at
 * 0.82 on the linear target; this leaves room for the fog to thin a far part and still clear it.
 */
const BLOOM_LUMA = 1.2

/** Rec. 709 luminance of a linear colour: what the bloom pass measures. */
function luminance(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/**
 * A colour, optionally whitened toward a lit tube's hot core, then scaled. At a scale of BLOOM_K or more
 * the part is meant to glow, so its luminance is lifted to at least BLOOM_LUMA: a deep red or magenta
 * scaled like a cyan one would otherwise stay under the bloom threshold and render flat.
 */
function tone(color, k = 1, white = 0) {
  const c = color?.isColor ? color.clone() : new THREE.Color(color)
  if (white) c.lerp(new THREE.Color(1, 1, 1), white)
  c.multiplyScalar(k)
  if (k >= BLOOM_K) {
    const l = luminance(c)
    if (l > 0 && l < BLOOM_LUMA) c.multiplyScalar(BLOOM_LUMA / l)
  }
  return c
}

/** A CSS colour part way between two others. */
function mixHex(a, b, t) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`
}

/** A placement matrix from a position, a rotation (radians, XYZ order) and a scale. */
function at(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  )
}

/** Whether x is within `gap` of any of the given positions. */
function near(x, list, gap) {
  return list.some(other => Math.abs(other - x) < gap)
}

const ATTRIBUTES = ['position', 'normal', 'uv', 'color']

/** Static parts that share one material, merged into a single mesh: one draw call however many parts. */
class Batch {
  constructor() {
    this.parts = []
  }

  /** Adds `geometry` placed by `matrix`, tinted `color` scaled by `k` (above 1 glows on an unlit material). */
  add(geometry, matrix, color = '#ffffff', k = 1, white = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    for (const name of Object.keys(g.attributes)) if (!ATTRIBUTES.includes(name)) g.deleteAttribute(name)
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (!g.attributes.normal) g.computeVertexNormals()
    g.applyMatrix4(matrix)
    const c = tone(color, k, white)
    const colors = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r
      colors[i + 1] = c.g
      colors[i + 2] = c.b
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    g.clearGroups()
    this.parts.push(g)
    if (geometry !== g) geometry.dispose()
    return g
  }

  box(w, h, d, color, x, y, z, { rx = 0, ry = 0, rz = 0, k = 1, white = 0 } = {}) {
    return this.add(new THREE.BoxGeometry(w, h, d), at(x, y, z, rx, ry, rz), color, k, white)
  }

  cyl(rTop, rBottom, h, color, x, y, z, { segments = 10, rx = 0, ry = 0, rz = 0, k = 1, white = 0, open = false } = {}) {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open), at(x, y, z, rx, ry, rz), color, k, white)
  }

  /** A rectangle lying flat at height y: `w` along x, `d` along z, turned by `ry`. */
  flat(w, d, color, x, y, z, { ry = 0, k = 1, white = 0 } = {}) {
    return this.add(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), at(x, y, z, 0, ry), color, k, white)
  }

  /** An upright rectangle facing the direction `ry` (0 faces +z, PI faces -z). */
  quad(w, h, color, x, y, z, { rx = 0, ry = 0, k = 1, white = 0 } = {}) {
    return this.add(new THREE.PlaneGeometry(w, h), at(x, y, z, rx, ry), color, k, white)
  }

  /** A tapered limb from point a to point b: trunks, branches, pipes. */
  limb(a, b, rA, rB, color, segments = 6) {
    const dir = new THREE.Vector3().subVectors(b, a)
    const length = dir.length()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))
    return this.add(new THREE.CylinderGeometry(rB, rA, length, segments, 1, true), m, color)
  }

  /** The merged mesh, or null when nothing was added. */
  mesh(material, name) {
    if (!this.parts.length) return null
    const merged = mergeGeometries(this.parts)
    for (const part of this.parts) part.dispose()
    this.parts = []
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = name
    return mesh
  }
}

/** A plane whose texture coordinates point at one cell of the atlas. */
function atlasPlane(w, h, cell) {
  const g = new THREE.PlaneGeometry(w, h)
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0))
  }
  return g
}

/** A repeating canvas texture, mipmapped (sizes are powers of two). */
function canvasTexture(w, h, paint, { srgb = true, renderer = null } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  paint(canvas.getContext('2d'), w, h)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4)
  return texture
}

// ------------------------------------------------------------------ canvas painting

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** The largest font size up to `max` at which `text` fits in `width` pixels. */
function fit(g, text, width, max, font, weight = 700) {
  g.font = `${weight} ${max}px ${font}`
  const measured = g.measureText(text).width
  return measured > width ? Math.floor((max * width) / measured) : max
}

/** Lettering that looks lit: a wide coloured glow, then a hot near-white core. */
function glowText(g, text, x, y, size, color, { font = FONT, weight = 700, tube = false, core = 0.55, align = 'center' } = {}) {
  g.save()
  g.font = `${weight} ${size}px ${font}`
  g.textAlign = align
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = Math.max(2, size * 0.08)
  const draw = () => (tube ? g.strokeText(text, x, y) : g.fillText(text, x, y))
  g.shadowColor = color
  g.strokeStyle = color
  g.fillStyle = color
  g.shadowBlur = size * 0.55
  draw()
  g.shadowBlur = size * 0.2
  draw()
  g.shadowBlur = 0
  g.strokeStyle = mixHex(color, '#ffffff', core)
  g.fillStyle = g.strokeStyle
  if (tube) g.lineWidth = Math.max(1.5, size * 0.035)
  draw()
  g.restore()
}

/** Kana stacked top to bottom, the long-vowel bar turned upright as signs write it. */
function verticalText(g, text, x, top, bottom, size, color, options) {
  const chars = [...text]
  const step = (bottom - top) / chars.length
  const s = Math.min(size, step * 0.84)
  chars.forEach((c, i) => {
    const y = top + step * (i + 0.5)
    if (c === 'ー') {
      g.save()
      g.translate(x, y)
      g.rotate(Math.PI / 2)
      glowText(g, c, 0, 0, s, color, { font: KANA, ...options })
      g.restore()
    } else glowText(g, c, x, y, s, color, { font: KANA, ...options })
  })
}

/** A dark sign board with a neon tube running round its edge. */
function board(g, w, h, color, inset = 12, radius = 14) {
  g.fillStyle = '#04050a'
  g.fillRect(0, 0, w, h)
  const panel = g.createLinearGradient(0, 0, 0, h)
  panel.addColorStop(0, '#121423')
  panel.addColorStop(1, '#07080f')
  g.fillStyle = panel
  roundRect(g, inset / 2, inset / 2, w - inset, h - inset, radius)
  g.fill()
  g.save()
  g.shadowColor = color
  g.shadowBlur = 14
  g.strokeStyle = mixHex(color, '#ffffff', 0.35)
  g.lineWidth = 4
  roundRect(g, inset + 2, inset + 2, w - inset * 2 - 4, h - inset * 2 - 4, radius - 2)
  g.stroke()
  g.restore()
}

function paintShopSign(g, w, h, shop, style) {
  board(g, w, h, shop.color)
  if (style === 0) {
    // A lit kana block on the left, the name in solid glowing letters beside it.
    const bw = h * 1.3
    g.fillStyle = mixHex(shop.color, '#000000', 0.3)
    roundRect(g, 26, 26, bw, h - 52, 8)
    g.fill()
    g.fillStyle = '#0b0c14'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `800 ${fit(g, shop.kana, bw - 18, 44, KANA, 800)}px ${KANA}`
    g.fillText(shop.kana, 26 + bw / 2, h / 2 + 2)
    const room = w - bw - 76
    glowText(g, shop.name, 26 + bw + 24 + room / 2, h / 2 + 3, fit(g, shop.name, room, 68, FONT, 800), shop.color, { weight: 800 })
  } else {
    // Tube lettering with the kana underneath.
    glowText(g, shop.name, w / 2, h * 0.42, fit(g, shop.name, w - 80, 60, FONT, 700), shop.color, { tube: true })
    glowText(g, shop.kana, w / 2, h * 0.77, 22, shop.color, { font: KANA, core: 0.4 })
  }
}

function paintBlade(g, w, h, shop) {
  board(g, w, h, shop.color, 10, 16)
  verticalText(g, shop.kana, w / 2, 36, h - 36, w * 0.6, shop.color, { weight: 800, tube: false, core: 0.6 })
}

function paintRoofSign(g, w, h, sign) {
  g.fillStyle = '#07050d'
  g.fillRect(0, 0, w, h)
  // A marquee of bulbs round the edge, all steadily lit.
  g.save()
  g.shadowColor = '#ffd9a0'
  g.shadowBlur = 8
  g.fillStyle = '#fff1d6'
  for (let x = 14; x < w - 8; x += 22) {
    g.beginPath()
    g.arc(x, 10, 4, 0, Math.PI * 2)
    g.arc(x, h - 10, 4, 0, Math.PI * 2)
    g.fill()
  }
  for (let y = 32; y < h - 20; y += 22) {
    g.beginPath()
    g.arc(10, y, 4, 0, Math.PI * 2)
    g.arc(w - 10, y, 4, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
  glowText(g, sign.name, w / 2, h * 0.43, fit(g, sign.name, w - 70, 76, FONT, 800), sign.color, { tube: true, weight: 800 })
  glowText(g, sign.kana, w / 2, h * 0.78, 24, sign.color, { font: KANA, core: 0.45 })
}

function paintStopSign(g, w, h) {
  const panel = g.createLinearGradient(0, 0, 0, h)
  panel.addColorStop(0, '#ffd866')
  panel.addColorStop(0.72, '#f0a01c')
  panel.addColorStop(1, '#d4800e')
  g.fillStyle = panel
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#0e3a40'
  g.fillRect(0, h * 0.79, w, h * 0.21)
  g.fillStyle = '#8ffaff'
  g.fillRect(0, h * 0.79 - 4, w, 4)
  // Speed lines running into the name.
  g.fillStyle = 'rgba(255,255,255,0.9)'
  for (let i = 0; i < 4; i += 1) g.fillRect(h * 1.02 + i * 20, h * (0.22 + i * 0.12), w * 0.13 - i * 22, 6)
  g.save()
  g.font = `italic 900 ${h * 0.58}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 12
  g.strokeStyle = '#3a1d00'
  g.strokeText(STOP.name, w * 0.56, h * 0.42)
  g.fillStyle = '#ffffff'
  g.fillText(STOP.name, w * 0.56, h * 0.42)
  g.restore()
  // The route badge.
  g.fillStyle = '#0e3a40'
  g.beginPath()
  g.arc(h * 0.52, h * 0.4, h * 0.31, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#ffffff'
  g.lineWidth = 5
  g.stroke()
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `800 ${h * 0.15}px ${KANA}`
  g.fillText(STOP.kana, h * 0.52, h * 0.4)
  g.fillStyle = '#d9fbff'
  g.font = `700 ${h * 0.12}px ${FONT}`
  g.fillText('NIGHT SERVICE  ·  EVERY 6 MIN  ·  STOP 7', w / 2, h * 0.9)
}

function paintHeader(g, w, h) {
  g.fillStyle = '#0e3a40'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#f2a21f'
  g.fillRect(0, 0, w, h * 0.12)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `italic 900 ${h * 0.4}px ${FONT}`
  g.fillText(STOP.name, w / 2, h * 0.46)
  g.fillStyle = '#9ff6ff'
  g.font = `700 ${h * 0.16}px ${KANA}`
  g.fillText(`${STOP.kana}  ·  NEXT`, w / 2, h * 0.8)
}

function paintTeaPoster(g, w, h) {
  const bg = g.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#0d2a3a')
  bg.addColorStop(0.55, '#7a3a2a')
  bg.addColorStop(1, '#ff8a3d')
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  // A cup with its steam.
  g.fillStyle = '#f4efe6'
  roundRect(g, w * 0.3, h * 0.5, w * 0.4, h * 0.24, 18)
  g.fill()
  g.strokeStyle = '#f4efe6'
  g.lineWidth = 10
  g.beginPath()
  g.arc(w * 0.72, h * 0.6, h * 0.05, -Math.PI / 2, Math.PI / 2)
  g.stroke()
  g.fillStyle = '#c4621e'
  g.beginPath()
  g.ellipse(w * 0.5, h * 0.5, w * 0.19, h * 0.025, 0, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.75)'
  g.lineWidth = 6
  for (let i = 0; i < 3; i += 1) {
    const x = w * (0.4 + i * 0.1)
    g.beginPath()
    g.moveTo(x, h * 0.46)
    g.bezierCurveTo(x - 18, h * 0.4, x + 18, h * 0.36, x, h * 0.3)
    g.stroke()
  }
  glowText(g, 'HOT TEA', w / 2, h * 0.12, 46, '#ffd9a8', { weight: 800, core: 0.8 })
  glowText(g, 'おちゃ', w / 2, h * 0.22, 30, '#ffb45c', { font: KANA, core: 0.6 })
  g.fillStyle = 'rgba(0,0,0,0.45)'
  g.fillRect(0, h * 0.86, w, h * 0.14)
  g.fillStyle = '#fff3e0'
  g.font = `700 20px ${FONT}`
  g.textAlign = 'center'
  g.fillText('24H  ·  WARM INSIDE', w / 2, h * 0.93)
}

function paintHarborPoster(g, w, h) {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.62)
  sky.addColorStop(0, '#1a1040')
  sky.addColorStop(0.75, '#c02a9a')
  sky.addColorStop(1, '#ffb02b')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h * 0.62)
  g.fillStyle = '#0a1030'
  g.fillRect(0, h * 0.62, w, h * 0.38)
  // A low sun cut by bands, and its light on the water.
  const sun = g.createLinearGradient(0, h * 0.4, 0, h * 0.62)
  sun.addColorStop(0, '#ffe08a')
  sun.addColorStop(1, '#ff2bd6')
  g.fillStyle = sun
  g.beginPath()
  g.arc(w / 2, h * 0.62, w * 0.26, Math.PI, 0)
  g.fill()
  g.fillStyle = '#7a1e7a'
  for (let i = 0; i < 4; i += 1) g.fillRect(0, h * (0.54 + i * 0.022), w, 3 + i)
  g.fillStyle = 'rgba(255,190,120,0.7)'
  for (let i = 0; i < 9; i += 1) {
    const half = w * (0.22 - i * 0.02)
    g.fillRect(w / 2 - half, h * (0.65 + i * 0.03), half * 2, 3)
  }
  glowText(g, 'HARBOR', w / 2, h * 0.12, 48, '#ffffff', { weight: 800, core: 0.9 })
  glowText(g, 'みなと', w / 2, h * 0.23, 30, '#9fe8ff', { font: KANA, core: 0.6 })
  g.fillStyle = '#d9e6ff'
  g.font = `700 20px ${FONT}`
  g.textAlign = 'center'
  g.fillText('LINE 3  ·  12 MIN', w / 2, h * 0.93)
}

/** What can be seen through a shop window: a lit room with simple shapes in it. */
function paintRoom(g, w, h, room) {
  const rnd = stream(`room:${room}`)
  const [top, bottom] = {
    counter: ['#ffe2b0', '#d9822e'],
    cafe: ['#ffd49a', '#7a3f22'],
    booths: ['#ff7ae0', '#2a0c48'],
    arcade: ['#1d0f3a', '#05030c'],
    laundry: ['#e4f6ff', '#86b4cc'],
    market: ['#f4fbff', '#b4d0de'],
  }[room]
  const light = g.createLinearGradient(0, 0, 0, h)
  light.addColorStop(0, top)
  light.addColorStop(1, bottom)
  g.fillStyle = light
  g.fillRect(0, 0, w, h)
  const dot = (x, y, r, color) => {
    g.save()
    g.shadowColor = color
    g.shadowBlur = r * 3
    g.fillStyle = color
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  /** A plain silhouette: a round head over rounded shoulders. */
  const person = (x, y, s, color) => {
    g.fillStyle = color
    g.beginPath()
    g.arc(x, y - s * 1.25, s * 0.42, 0, Math.PI * 2)
    g.fill()
    roundRect(g, x - s * 0.62, y - s * 0.8, s * 1.24, s * 1.6, s * 0.45)
    g.fill()
  }
  if (room === 'counter') {
    g.fillStyle = '#a3192f'
    g.fillRect(0, 0, w, h * 0.2)
    g.fillStyle = 'rgba(0,0,0,0.35)'
    for (let i = 1; i < 5; i += 1) g.fillRect((w * i) / 5 - 2, 0, 4, h * 0.2)
    g.fillStyle = '#fff3e0'
    g.font = `700 ${h * 0.11}px ${KANA}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('めし', w / 2, h * 0.1)
    for (let i = 0; i < 4; i += 1) dot(w * (0.16 + i * 0.23), h * 0.3, 7, '#fff4d6')
    person(w * 0.3, h * 0.66, 30, 'rgba(58,30,16,0.85)')
    person(w * 0.63, h * 0.67, 27, 'rgba(58,30,16,0.85)')
    g.fillStyle = '#4a2612'
    g.fillRect(0, h * 0.64, w, h * 0.08)
    g.fillStyle = '#2a140a'
    g.fillRect(0, h * 0.72, w, h * 0.28)
    g.fillStyle = '#160a04'
    for (let x = w * 0.12; x < w; x += w * 0.17) {
      g.beginPath()
      g.ellipse(x, h * 0.84, 20, 7, 0, 0, Math.PI * 2)
      g.fill()
      g.fillRect(x - 3, h * 0.84, 6, h * 0.16)
    }
  } else if (room === 'cafe') {
    for (let i = 0; i < 5; i += 1) dot(w * (0.1 + i * 0.2), h * 0.18, 6, '#ffe9c4')
    g.fillStyle = '#3a2416'
    for (let i = 0; i < 3; i += 1) g.fillRect(w * 0.06, h * (0.3 + i * 0.1), w * 0.24, 5)
    g.fillStyle = '#f2e6d0'
    for (let i = 0; i < 9; i += 1) g.fillRect(w * 0.07 + (i % 3) * 36, h * (0.25 + Math.floor(i / 3) * 0.1), 14, 12)
    g.fillStyle = '#1d3a22'
    for (const x of [w * 0.86, w * 0.94]) {
      g.beginPath()
      g.ellipse(x, h * 0.55, 30, 50, 0, 0, Math.PI * 2)
      g.fill()
    }
    person(w * 0.52, h * 0.78, 26, 'rgba(40,20,12,0.8)')
    g.fillStyle = '#2a170c'
    g.fillRect(w * 0.36, h * 0.72, w * 0.36, 10)
    g.fillRect(w * 0.4, h * 0.72, 8, h * 0.28)
    g.fillRect(w * 0.66, h * 0.72, 8, h * 0.28)
  } else if (room === 'booths') {
    for (let i = 0; i < 3; i += 1) {
      const x = w * (0.08 + i * 0.31)
      g.fillStyle = '#1a0628'
      roundRect(g, x, h * 0.18, w * 0.24, h * 0.82, 12)
      g.fill()
      g.fillStyle = i === 1 ? '#7ff8ff' : '#ffb0f0'
      g.fillRect(x + 16, h * 0.28, w * 0.24 - 32, h * 0.18)
    }
    for (let i = 0; i < 30; i += 1) dot(rnd() * w, rnd() * h * 0.16, 2 + rnd() * 2, rnd() < 0.5 ? '#ffffff' : '#7ff8ff')
  } else if (room === 'arcade') {
    const screens = ['#2bf3ff', '#ff2bd6', '#ffb02b', '#3bff9d', '#7b5cff']
    for (let i = 0; i < 6; i += 1) {
      const x = w * (0.04 + i * 0.16)
      g.fillStyle = '#120a22'
      g.fillRect(x, h * 0.22, w * 0.13, h * 0.78)
      g.fillStyle = screens[i % screens.length]
      g.fillRect(x + 8, h * 0.3, w * 0.13 - 16, h * 0.24)
      g.fillStyle = 'rgba(0,0,0,0.45)'
      for (let k = 0; k < 4; k += 1) g.fillRect(x + 12 + rnd() * 30, h * 0.33 + rnd() * h * 0.16, 10, 6)
    }
    g.fillStyle = '#3a1866'
    for (let i = 0; i < 40; i += 1) g.fillRect(rnd() * w, h * 0.9 + rnd() * h * 0.08, 6, 3)
  } else if (room === 'laundry') {
    for (let row = 0; row < 2; row += 1) {
      for (let i = 0; i < 6; i += 1) {
        const x = w * (0.1 + i * 0.16)
        const y = h * (0.38 + row * 0.34)
        g.fillStyle = '#f4fbff'
        g.fillRect(x - 34, y - 36, 68, 72)
        g.fillStyle = '#6f97b4'
        g.beginPath()
        g.arc(x, y, 24, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#1d4f8a'
        g.beginPath()
        g.arc(x, y + 6, 18, 0, Math.PI)
        g.fill()
      }
    }
  } else {
    // A market: shelves of brightly packed goods and a cold case.
    for (let row = 0; row < 4; row += 1) {
      const y = h * (0.24 + row * 0.19)
      g.fillStyle = '#8aa2b2'
      g.fillRect(0, y + 22, w * 0.72, 6)
      for (let x = 10; x < w * 0.7; x += 16) {
        g.fillStyle = ['#ff3b5c', '#ffb02b', '#3bff9d', '#2b7bff', '#ff2bd6', '#ffffff'][Math.floor(rnd() * 6)]
        g.fillRect(x, y, 11, 20)
      }
    }
    g.fillStyle = '#dff8ff'
    g.fillRect(w * 0.76, h * 0.12, w * 0.2, h * 0.88)
    g.fillStyle = '#9fd8ef'
    for (let i = 0; i < 5; i += 1) g.fillRect(w * 0.77, h * (0.2 + i * 0.15), w * 0.18, 4)
  }
  // Mullions, the frame, and a soft sheen across the glass.
  g.fillStyle = '#05060a'
  g.fillRect(0, 0, w, 8)
  g.fillRect(0, h - 10, w, 10)
  g.fillRect(0, 0, 8, h)
  g.fillRect(w - 8, 0, 8, h)
  for (const x of [w * 0.34, w * 0.67]) g.fillRect(x - 3, 0, 6, h)
  g.globalAlpha = 0.1
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.moveTo(w * 0.12, 0)
  g.lineTo(w * 0.24, 0)
  g.lineTo(w * 0.14, h)
  g.lineTo(w * 0.02, h)
  g.fill()
  g.globalAlpha = 1
}

function paintFlat(g, w, h, index) {
  const [top, bottom] = FLATS[index].light
  const light = g.createLinearGradient(0, 0, 0, h)
  light.addColorStop(0, top)
  light.addColorStop(1, bottom)
  g.fillStyle = light
  g.fillRect(0, 0, w, h)
  g.fillStyle = 'rgba(30,14,8,0.55)'
  if (index === 0) {
    // Curtains drawn back to either side, with their folds.
    g.fillRect(8, 8, 26, h - 16)
    g.fillRect(w - 34, 8, 26, h - 16)
    g.fillStyle = 'rgba(0,0,0,0.25)'
    for (const x of [14, 22, 30, w - 28, w - 20, w - 12]) g.fillRect(x, 8, 2, h - 16)
  } else if (index === 1) {
    g.fillStyle = 'rgba(20,40,60,0.35)'
    for (let y = 12; y < h - 10; y += 9) g.fillRect(8, y, w - 16, 3)
  } else {
    g.fillStyle = 'rgba(10,30,14,0.9)'
    g.beginPath()
    g.ellipse(w * 0.3, h * 0.72, 20, 26, 0, 0, Math.PI * 2)
    g.ellipse(w * 0.42, h * 0.62, 16, 20, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#2a140a'
    g.fillRect(w * 0.22, h * 0.82, 34, 16)
  }
  g.fillStyle = '#05060a'
  g.fillRect(0, 0, w, 8)
  g.fillRect(0, h - 8, w, 8)
  g.fillRect(0, 0, 8, h)
  g.fillRect(w - 8, 0, 8, h)
  g.fillRect(w / 2 - 3, 0, 6, h)
  g.fillRect(0, h * 0.45, w, 5)
}

function paintVending(g, w, h, kind) {
  const rnd = stream(`vend:${kind.label}`)
  g.fillStyle = '#c4d0dc'
  g.fillRect(0, 0, w, h)
  g.fillStyle = kind.banner
  g.fillRect(0, 0, w, 46)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `800 22px ${FONT}`
  g.fillText(kind.label, w / 2, 16)
  g.font = `700 13px ${KANA}`
  g.fillText(kind.kana, w / 2, 35)
  const cans = ['#ff3b5c', '#2b7bff', '#ffb02b', '#3bff9d', '#ffffff', '#ff2bd6', '#1d2a3a', '#c9b6ff']
  for (let row = 0; row < 3; row += 1) {
    const y = 58 + row * 52
    g.fillStyle = '#e8f2fb'
    g.fillRect(6, y - 4, w - 12, 44)
    for (let i = 0; i < 4; i += 1) {
      g.fillStyle = cans[Math.floor(rnd() * cans.length)]
      roundRect(g, 12 + i * 28, y, 20, 32, 5)
      g.fill()
      g.fillStyle = rnd() < 0.8 ? '#3bff9d' : '#ff3b5c'
      g.fillRect(17 + i * 28, y + 35, 10, 3)
    }
  }
  g.fillStyle = '#20262f'
  g.fillRect(14, h - 40, w - 28, 26)
}

/** The departures list on the stop's screen: rows that scroll up and wrap round. */
function timetableTexture(renderer) {
  const routes = [
    ['7', 'HARBOR', 'みなと', 2, NEON.cyan],
    ['3', 'NORTH GATE', 'きたぐち', 5, NEON.amber],
    ['12', 'OLD MARKET', 'いちば', 7, NEON.magenta],
    ['7', 'TOWER 9', 'タワー', 11, NEON.cyan],
    ['5', 'RIVERSIDE', 'かわぞい', 14, NEON.green],
    ['3', 'DEPOT', 'しゃこ', 18, NEON.amber],
    ['12', 'CENTRAL', 'ちゅうおう', 21, NEON.magenta],
    ['9', 'HILLTOP', 'おか', 26, VIOLET],
  ]
  const texture = canvasTexture(256, 512, (g, w, h) => {
    routes.forEach(([line, place, kana, minutes, color], i) => {
      const y = i * 64
      g.fillStyle = i % 2 ? '#04131c' : '#061a24'
      g.fillRect(0, y, w, 64)
      g.fillStyle = color
      g.beginPath()
      g.arc(28, y + 32, 17, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#04131c'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = `800 16px ${FONT}`
      g.fillText(line, 28, y + 33)
      g.textAlign = 'left'
      g.fillStyle = '#e6fbff'
      g.font = `700 22px ${FONT}`
      g.fillText(place, 54, y + 25)
      g.fillStyle = '#7fd8e8'
      g.font = `600 13px ${KANA}`
      g.fillText(kana, 54, y + 47)
      g.textAlign = 'right'
      g.fillStyle = '#ffcf5a'
      g.font = `800 20px ${FONT}`
      g.fillText(`${minutes} MIN`, w - 10, y + 32)
      g.fillStyle = '#0c3a48'
      g.fillRect(0, y + 62, w, 2)
    })
    g.fillStyle = 'rgba(0,0,0,0.16)'
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1)
  }, { renderer })
  texture.repeat.set(1, 0.5)
  return texture
}

/** Lit and dark windows on a 1.5 m by 3 m grid, for the low blocks to the south. */
function windowGridTexture(renderer) {
  return canvasTexture(256, 256, (g, w, h) => {
    const rnd = stream('district-windows')
    g.fillStyle = '#04050a'
    g.fillRect(0, 0, w, h)
    const lit = [WARM, AMBER_WINDOW, COOL, VIOLET, '#fff0c2', WARM]
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const on = rnd() < 0.48
        g.globalAlpha = on ? 0.4 + rnd() * 0.6 : 1
        g.fillStyle = on ? lit[Math.floor(rnd() * lit.length)] : '#0b0e16'
        g.fillRect(x * 32 + 5, y * 32 + 9, 22, 15)
      }
    }
    g.globalAlpha = 1
  }, { renderer })
}

/** Paving slabs for the plaza, and a separate map of where the water lies glossiest. */
function plazaTextures(renderer) {
  const map = canvasTexture(512, 512, (g, w, h) => {
    const rnd = stream('plaza-slabs')
    g.fillStyle = '#151820'
    g.fillRect(0, 0, w, h)
    const cell = 128
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const t = 0.8 + rnd() * 0.32
        g.fillStyle = `rgb(${Math.round(48 * t)}, ${Math.round(54 * t)}, ${Math.round(66 * t)})`
        g.fillRect(x + 3, y + 3, cell - 6, cell - 6)
      }
    }
    for (let i = 0; i < 2600; i += 1) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.14)'
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2)
    }
  }, { renderer })
  const rough = canvasTexture(256, 256, (g, w, h) => {
    const rnd = stream('plaza-wet')
    g.fillStyle = 'rgb(190,190,190)'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 46; i += 1) {
      const x = rnd() * w
      const y = rnd() * h
      const r = 10 + rnd() * 40
      const v = rnd() < 0.6 ? 110 : 255
      // Drawn on every side as well, so the tile repeats without a seam.
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
          grad.addColorStop(0, `rgba(${v},${v},${v},0.85)`)
          grad.addColorStop(1, `rgba(${v},${v},${v},0)`)
          g.fillStyle = grad
          g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2)
        }
      }
    }
  }, { srgb: false, renderer })
  return { map, rough }
}

/** Asphalt for the road and its parking lane (16 m of it per tile), with glossier tyre tracks. */
function roadTextures(renderer, street, near, far) {
  const span = far - near
  const tracks = [street - 1.75 - 0.8, street - 1.75 + 0.8, street + 1.75 - 0.8, street + 1.75 + 0.8]
  const map = canvasTexture(1024, 512, (g, w, h) => {
    const rnd = stream('road-asphalt')
    const py = z => ((z - near) / span) * h
    g.fillStyle = '#23272f'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#292d36'
    g.fillRect(0, py(street + 3.5), w, h)
    for (let i = 0; i < 9000; i += 1) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.16)'
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2)
    }
    g.fillStyle = 'rgba(10,12,16,0.35)'
    for (const z of tracks) g.fillRect(0, py(z) - 12, w, 24)
    for (let i = 0; i < 4; i += 1) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '40,44,54' : '28,31,38'},0.7)`
      g.fillRect(40 + rnd() * (w - 240), rnd() * (h - 80), 60 + rnd() * 140, 30 + rnd() * 50)
    }
  }, { renderer })
  const rough = canvasTexture(512, 256, (g, w, h) => {
    const rnd = stream('road-wet')
    const py = z => ((z - near) / span) * h
    g.fillStyle = 'rgb(225,225,225)'
    g.fillRect(0, 0, w, h)
    for (const z of tracks) {
      const grad = g.createLinearGradient(0, py(z) - 9, 0, py(z) + 9)
      grad.addColorStop(0, 'rgba(120,120,120,0)')
      grad.addColorStop(0.5, 'rgba(120,120,120,1)')
      grad.addColorStop(1, 'rgba(120,120,120,0)')
      g.fillStyle = grad
      g.fillRect(0, py(z) - 9, w, 18)
    }
    for (let i = 0; i < 2400; i += 1) {
      const v = rnd() < 0.5 ? 255 : 130
      g.fillStyle = `rgba(${v},${v},${v},0.5)`
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2)
    }
  }, { srgb: false, renderer })
  return { map, rough }
}

/** One big canvas holding every sign, window, poster and vending front, so they all draw in one call. */
class Atlas {
  constructor(size) {
    this.size = size
    this.canvas = document.createElement('canvas')
    this.canvas.width = size
    this.canvas.height = size
    this.g = this.canvas.getContext('2d')
    this.g.fillStyle = '#000000'
    this.g.fillRect(0, 0, size, size)
    this.shelves = []
    this.bottom = 0
  }

  /** Reserves a w by h pixel cell (callers go tallest first), paints it and returns its texture rectangle. */
  cell(w, h, paint) {
    const gap = 12
    let shelf = this.shelves.find(s => h <= s.h && s.x + w <= this.size)
    if (!shelf) {
      shelf = { x: 0, y: this.bottom, h }
      this.bottom += h + gap
      if (this.bottom > this.size + gap) throw new Error('street.js: the sign atlas is full')
      this.shelves.push(shelf)
    }
    const x = shelf.x
    shelf.x += w + gap
    const g = this.g
    g.save()
    g.translate(x, shelf.y)
    g.beginPath()
    g.rect(0, 0, w, h)
    g.clip()
    paint(g, w, h)
    g.restore()
    const s = this.size
    return { u0: (x + 0.5) / s, u1: (x + w - 0.5) / s, v0: 1 - (shelf.y + h - 0.5) / s, v1: 1 - (shelf.y + 0.5) / s }
  }

  texture(renderer) {
    const texture = new THREE.CanvasTexture(this.canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4)
    return texture
  }
}

/** The city's lights as still water holds them: thin upright smears, warm and cool, with a few neon blurs. */
function cityShineTexture(renderer) {
  return canvasTexture(1024, 128, (g, w, h) => {
    const rnd = stream('water-lights')
    g.fillStyle = '#000000'
    g.fillRect(0, 0, w, h)
    const colors = [WARM, AMBER_WINDOW, COOL, VIOLET, '#fff0c2', WARM, COOL]
    const smear = (x, y, sw, sh, color, alpha) => {
      const grad = g.createLinearGradient(0, y, 0, y + sh)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.5, color)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.globalAlpha = alpha
      g.fillStyle = grad
      // Drawn again one tile over, so the strip repeats without a seam.
      for (const ox of [-w, 0, w]) g.fillRect(x + ox, y, sw, sh)
    }
    for (let i = 0; i < 14; i += 1) smear(rnd() * w, rnd() * 20, 18 + rnd() * 30, 90 + rnd() * 30, [NEON.magenta, NEON.cyan, NEON.amber, VIOLET][Math.floor(rnd() * 4)], 0.2)
    for (let i = 0; i < 150; i += 1) smear(rnd() * w, rnd() * (h - 60), 2 + rnd() * 2, 36 + rnd() * 60, colors[Math.floor(rnd() * colors.length)], 0.3 + rnd() * 0.5)
    g.globalAlpha = 1
  }, { renderer })
}

/** Paints the whole atlas, tallest cells first, and returns where each picture landed. */
function paintAtlas(renderer) {
  const atlas = new Atlas(2048)
  const cells = { blade: [], poster: [], room: {}, vend: [], roof: [], sign: [], flat: [] }
  for (const shop of SHOPS) cells.blade.push(atlas.cell(128, 512, (g, w, h) => paintBlade(g, w, h, shop)))
  cells.poster.push(atlas.cell(256, 384, paintTeaPoster), atlas.cell(256, 384, paintHarborPoster))
  for (const room of ROOMS) cells.room[room] = atlas.cell(512, 256, (g, w, h) => paintRoom(g, w, h, room))
  for (const kind of VENDING) cells.vend.push(atlas.cell(128, 256, (g, w, h) => paintVending(g, w, h, kind)))
  cells.stop = atlas.cell(1024, 192, paintStopSign)
  for (const sign of ROOF_SIGNS) cells.roof.push(atlas.cell(512, 160, (g, w, h) => paintRoofSign(g, w, h, sign)))
  SHOPS.forEach((shop, i) => cells.sign.push(atlas.cell(512, 128, (g, w, h) => paintShopSign(g, w, h, shop, i % 2))))
  cells.header = atlas.cell(256, 128, paintHeader)
  cells.flat = FLATS.map((_, i) => atlas.cell(128, 128, (g, w, h) => paintFlat(g, w, h, i)))
  cells.texture = atlas.texture(renderer)
  return cells
}

// ------------------------------------------------------------------ light shapes (shaders)

const MASK_GLSL = /* glsl */ `
  uniform vec4 uMask;
  bool insideOffice(vec3 p) {
    return p.x > uMask.x && p.x < uMask.z && p.z > uMask.y && p.z < uMask.w;
  }
`
const SEED_GLSL = /* glsl */ `
  float seedOf(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }
`

/**
 * How much of an added light survives the haze. Ordinary fog mixes a colour toward the fog's own, but
 * added light must simply thin out, or a far glow would brighten the haze instead of sinking into it.
 * The vertex shader sets vFogDepth with <fog_vertex> (it needs a `mvPosition` in view space).
 */
const FOG_FADE_GLSL = /* glsl */ `
  #include <fog_pars_fragment>
  float fogFade() {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        return 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #else
      return 1.0;
    #endif
  }
`

/** Additive, never writes depth: light added on top of whatever is behind. */
const ADDITIVE = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }

/** Additive and fading into the scene's fog: the shader's uniforms gain the fog's, kept current by three. */
function fogged(uniforms) {
  return { ...ADDITIVE, fog: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms } }
}

/**
 * A soft glow card that always faces the eye, breathing slowly (6 to 12 seconds a cycle). It thins out
 * in the fog like the block or post it surrounds, so the far district's beacons sink into the haze.
 */
function haloMaterial(uTime) {
  return new THREE.ShaderMaterial({
    ...fogged({ uTime }),
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      #include <fog_pars_vertex>
      ${SEED_GLSL}
      void main() {
        vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec4 center = viewMatrix * vec4(origin, 1.0);
        float size = length(instanceMatrix[0].xyz);
        // Drawn a little toward the eye, so the card never cuts into the light it surrounds.
        center.xyz += normalize(-center.xyz) * min(size * 0.5, 0.8);
        center.xy += position.xy * size;
        float seed = seedOf(origin.xz);
        vColor = instanceColor * (0.92 + 0.08 * sin(uTime * (0.5 + 0.5 * seed) + seed * 6.2832));
        vUv = uv;
        vec4 mvPosition = center;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      ${FOG_FADE_GLSL}
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 >= 1.0) discard;
        float a = (exp(-r2 * 4.0) * 0.8 + exp(-r2 * 24.0) * 0.5) * (1.0 - r2);
        gl_FragColor = vec4(vColor * a * fogFade(), 1.0);
      }`,
  })
}

/** A beam of light in the wet air: soft at its edges, fading along its length, haze drifting through it. */
function coneMaterial(uTime) {
  return new THREE.ShaderMaterial({
    ...ADDITIVE,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying float vFacing;
      varying float vSeed;
      varying vec3 vColor;
      ${SEED_GLSL}
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float sx = length(instanceMatrix[0].xyz);
        float sy = length(instanceMatrix[1].xyz);
        vec3 n = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * (normal / vec3(sx * sx, sy * sy, sx * sx)));
        vFacing = abs(dot(n, normalize(cameraPosition - world.xyz)));
        vAlong = -position.y;
        vSeed = seedOf((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz);
        vColor = instanceColor;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vAlong;
      varying float vFacing;
      varying float vSeed;
      varying vec3 vColor;
      void main() {
        float body = mix(1.0, 0.12, vAlong) * smoothstep(0.0, 0.06, vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong));
        // Haze sinking through the beam: slow bands, about seven seconds a cycle.
        float haze = 0.84 + 0.16 * sin(vAlong * 9.0 - uTime * 0.9 + vSeed * 6.2832);
        // Clamped: multisampling can extrapolate a varying past zero, and pow() of a negative is NaN.
        gl_FragColor = vec4(vColor * pow(clamp(vFacing, 0.0, 1.0), 2.4) * body * haze, 1.0);
      }`,
  })
}

/** A soft round patch of light lying on the ground, thinning out in the fog. */
function poolMaterial(mask) {
  return new THREE.ShaderMaterial({
    ...fogged({ uMask: { value: mask } }),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vUv = uv;
        vColor = instanceColor;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorld;
      ${MASK_GLSL}
      ${FOG_FADE_GLSL}
      void main() {
        if (insideOffice(vWorld)) discard;
        vec2 p = vUv * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 >= 1.0) discard;
        gl_FragColor = vec4(vColor * exp(-r2 * 3.0) * (1.0 - r2) * fogFade(), 1.0);
      }`,
  })
}

/**
 * A light's reflection smeared down the wet ground. Each streak turns to face the eye and sits where
 * a mirror image of the light would meet the ground, so it stays right from every side of the orbit.
 * Far ones thin out in the fog.
 */
function streakMaterial(uTime, mask) {
  return new THREE.ShaderMaterial({
    ...fogged({ uTime, uMask: { value: mask }, uY: { value: Y.light } }),
    vertexShader: /* glsl */ `
      attribute vec4 aSrc;   // foot x, foot z, height of the light, width
      attribute vec2 aShape; // phase, length scale
      uniform float uY;
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying float vPhase;
      #include <fog_pars_vertex>
      void main() {
        vec2 foot = aSrc.xy;
        vec2 toEye = cameraPosition.xz - foot;
        float dist = max(length(toEye), 0.01);
        vec2 dir = toEye / dist;
        vec2 side = vec2(-dir.y, dir.x);
        float h = aSrc.z;
        float eyeH = max(cameraPosition.y - uY, 0.5);
        float hit = h * dist / (h + eyeH);
        float len = (1.2 + h * 1.5) * aShape.y;
        float along = clamp(hit + position.y * len, 0.0, dist * 0.9);
        vec2 p = foot + dir * along + side * position.x * aSrc.w * (0.8 + 0.5 * uv.y);
        vWorld = (modelMatrix * vec4(p.x, uY, p.y, 1.0)).xyz;
        // Seen from high above, wet ground mirrors less.
        float steep = eyeH / length(vec2(dist, eyeH));
        vColor = instanceColor * (1.5 - 1.1 * steep);
        vPhase = aShape.x;
        vUv = uv;
        vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorld;
      varying float vPhase;
      ${MASK_GLSL}
      ${FOG_FADE_GLSL}
      void main() {
        if (insideOffice(vWorld)) discard;
        float x = vUv.x * 2.0 - 1.0;
        x += 0.2 * vUv.y * sin(vUv.y * 11.0 + uTime * 0.9 + vPhase * 6.2832);
        float core = exp(-x * x * 6.0);
        float ends = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.4, 1.0, vUv.y));
        // The wet film breaks the reflection into slow sliding bands: five to nine seconds a cycle.
        float bands = 0.65 * sin(vUv.y * 19.0 - uTime * 1.2 + vPhase * 9.0) + 0.35 * sin(vUv.y * 7.0 + uTime * 0.7 + vPhase * 4.0);
        float ripple = 0.25 + 0.75 * smoothstep(-0.6, 0.9, bands);
        gl_FragColor = vec4(vColor * core * ends * ripple * fogFade(), 1.0);
      }`,
  })
}

/** The city's lights lying on the still channel, swaying slowly sideways (four to eight seconds a sway). */
function waterShineMaterial(uTime, map, repeat) {
  return new THREE.ShaderMaterial({
    ...ADDITIVE,
    uniforms: { uTime, uMap: { value: map }, uRepeat: { value: repeat } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uRepeat;
      uniform sampler2D uMap;
      varying vec2 vUv;
      void main() {
        vec2 uv = vec2(vUv.x * uRepeat, vUv.y);
        uv.x += 0.0012 * sin(vUv.y * 9.0 + uTime * 0.8) + 0.0006 * sin(vUv.y * 23.0 - uTime * 1.3);
        float edge = smoothstep(0.0, 0.12, vUv.y) * smoothstep(0.0, 0.12, 1.0 - vUv.y);
        gl_FragColor = vec4(texture2D(uMap, uv).rgb * edge * 0.42, 1.0);
      }`,
  })
}

/** Rain rings spreading on puddles and the channel: each ring swells in over half a second and fades, 2.2 seconds a ring. */
function rippleMaterial(uTime) {
  return new THREE.ShaderMaterial({
    ...ADDITIVE,
    uniforms: { uTime, uY: { value: Y.light }, uColor: { value: new THREE.Color('#b8c8ff').multiplyScalar(0.22) } },
    vertexShader: /* glsl */ `
      attribute vec4 aRip; // x, z, patch radius, phase
      uniform float uY;
      varying vec2 vLocal;
      varying float vRadius;
      varying float vPhase;
      varying float vFade;
      void main() {
        vec4 world = modelMatrix * vec4(aRip.x + position.x * aRip.z, uY, aRip.y + position.z * aRip.z, 1.0);
        vLocal = position.xz * aRip.z;
        vRadius = aRip.z;
        vPhase = aRip.w;
        vFade = 1.0 - smoothstep(30.0, 60.0, distance(cameraPosition, world.xyz));
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vLocal;
      varying float vRadius;
      varying float vPhase;
      varying float vFade;
      float ring(float t, float seed) {
        float cycle = floor(t);
        float f = t - cycle;
        vec2 jitter = vec2(fract(sin(cycle * 12.9898 + seed) * 43758.5453), fract(sin(cycle * 78.233 + seed * 1.7) * 24634.6345)) - 0.5;
        float d = length(vLocal - jitter * vRadius * 1.2);
        float edge = fwidth(d) + 0.02;
        float band = 1.0 - smoothstep(0.0, edge, abs(d - f * 0.32));
        return band * smoothstep(0.0, 0.25, f) * (1.0 - f) * (1.0 - f);
      }
      void main() {
        float a = 0.0;
        for (int k = 0; k < 3; k++) {
          float fk = float(k);
          a += ring(uTime * 0.45 + vPhase + fk * 0.37, vPhase * 31.0 + fk * 7.0);
        }
        a *= 1.0 - smoothstep(0.75, 1.0, length(vLocal) / vRadius);
        gl_FragColor = vec4(uColor * a * vFade, 1.0);
      }`,
  })
}

/** Steam from a vent: soft puffs that rise, spread and fade over seven seconds, then start again unseen. */
function steamMaterial(uTime) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      attribute vec4 aPuff; // x, z, phase, scale
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        float f = fract(uTime / 7.0 + aPuff.z);
        float s = aPuff.w;
        vec3 base = vec3(aPuff.x + f * f * 1.0 * s, 0.15 + f * 3.4 * s, aPuff.y + sin(f * 3.0 + aPuff.z * 20.0) * 0.25 * s);
        vec4 center = viewMatrix * modelMatrix * vec4(base, 1.0);
        center.xy += position.xy * (0.45 + f * 1.5) * s;
        vAlpha = pow(max(sin(3.14159 * f), 0.0), 1.5) * 0.22;
        vColor = instanceColor;
        vSeed = aPuff.z;
        vUv = uv;
        gl_Position = projectionMatrix * center;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSeed;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 >= 1.0) discard;
        float lump = 0.8 + 0.2 * sin(p.x * 5.0 + vSeed * 40.0) * sin(p.y * 4.0 + vSeed * 17.0);
        gl_FragColor = vec4(vColor, exp(-r2 * 2.6) * (1.0 - r2) * lump * vAlpha);
      }`,
  })
}

/** Low-poly leaves, lit from below by the blue uplights in their planters. */
function canopyMaterial() {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true })
  material.onBeforeCompile = shader => {
    shader.uniforms.uUplight = { value: tone(UPLIGHT, 0.5) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUnder;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 upNormal = normalize(mat3(instanceMatrix) * objectNormal);
          float lift = (instanceMatrix * vec4(transformed, 1.0)).y;
        #else
          vec3 upNormal = objectNormal;
          float lift = transformed.y;
        #endif
        vUnder = clamp(-upNormal.y, 0.0, 1.0) * exp(-max(lift - 1.2, 0.0) * 0.3);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUnder;\nuniform vec3 uUplight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uUplight * vUnder * vUnder;')
  }
  material.customProgramCacheKey = () => 'street-canopy'
  return material
}

// ------------------------------------------------------------------ gathering the light shapes

/** Every soft light shape on the street, gathered while building and instanced at the end. */
class Glows {
  constructor(spots) {
    this.halos = []
    this.cones = []
    this.pools = []
    this.streaks = []
    this.ripples = []
    this.puffs = []
    this.spots = spots
  }

  /** A soft glow in the wet air around a light, `r` metres across its radius. */
  halo(x, y, z, r, color, k) {
    this.halos.push({ x, y, z, r, color: tone(color, k) })
  }

  /** A cone of light from (x, y, z) down to the ground, or up into the trees for an uplight. */
  cone(x, y, z, r, h, color, k, up = false) {
    this.cones.push({ x, y, z, r, h, up, color: tone(color, k) })
  }

  /** Light lying on the ground: an ellipse rx by rz turned by ry. */
  pool(x, z, rx, rz, color, k, ry = 0) {
    this.pools.push({ x, z, rx, rz, ry, color: tone(color, k) })
  }

  /** The wet ground's reflection of a light `h` metres up and `w` wide. */
  streak(x, z, h, w, color, k, length = 1) {
    this.streaks.push({ x, z, h, w, length, phase: (hash(`${x.toFixed(2)}:${z.toFixed(2)}`) % 1000) / 1000, color: tone(color, k) })
  }

  /** A patch of rain rings `r` metres across. */
  ripple(x, z, r) {
    this.ripples.push({ x, z, r, phase: (hash(`r${x.toFixed(2)}:${z.toFixed(2)}`) % 1000) / 1000 })
  }

  /** A vent breathing steam, tinted by the light nearest it. */
  vent(x, z, tint, scale = 1) {
    const rnd = stream(`vent${x.toFixed(1)}:${z.toFixed(1)}`)
    for (let i = 0; i < 7; i += 1) {
      this.puffs.push({ x: x + (rnd() - 0.5) * 0.5, z: z + (rnd() - 0.5) * 0.3, phase: i / 7 + rnd() * 0.05, scale: scale * (0.85 + rnd() * 0.3), color: tone(tint, 1) })
    }
  }

  /** Tells the rain about a light. */
  spot(x, y, z, color, radius) {
    this.spots.push({ position: new THREE.Vector3(x, y, z), color: new THREE.Color(color), radius })
  }
}

/** One InstancedMesh for a list of shapes; `place` fills each instance's matrix and colour. */
function instanced(geometry, material, items, place, name) {
  if (!items.length) return null
  const mesh = new THREE.InstancedMesh(geometry, material, items.length)
  const m = new THREE.Matrix4()
  const c = new THREE.Color()
  items.forEach((item, i) => {
    m.identity()
    c.setRGB(1, 1, 1)
    place(item, m, c)
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, c)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.instanceColor.needsUpdate = true
  // The shaders move vertices themselves, so the usual bounds do not apply.
  mesh.frustumCulled = false
  mesh.name = name
  return mesh
}

/** A per-instance attribute read from each item. */
function perInstance(geometry, name, items, size, read) {
  const array = new Float32Array(items.length * size)
  items.forEach((item, i) => array.set(read(item), i * size))
  geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size))
}

const UP = new THREE.Quaternion()
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)

function glowMeshes(glows, uTime, mask) {
  const v = new THREE.Vector3()
  const s = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const meshes = []
  meshes.push(instanced(new THREE.PlaneGeometry(2, 2), haloMaterial(uTime), glows.halos, (it, m, c) => {
    m.makeScale(it.r, it.r, it.r).setPosition(it.x, it.y, it.z)
    c.copy(it.color)
  }, 'street:halos'))
  meshes.push(instanced(new THREE.CylinderGeometry(0.14, 1, 1, 28, 1, true).translate(0, -0.5, 0), coneMaterial(uTime), glows.cones, (it, m, c) => {
    m.compose(v.set(it.x, it.y, it.z), it.up ? FLIP : UP, s.set(it.r, it.h, it.r))
    c.copy(it.color)
  }, 'street:cones'))
  meshes.push(instanced(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), poolMaterial(mask), glows.pools, (it, m, c) => {
    m.compose(v.set(it.x, Y.light, it.z), q.setFromAxisAngle(yAxis, it.ry), s.set(it.rx, 1, it.rz))
    c.copy(it.color)
  }, 'street:pools'))
  if (glows.streaks.length) {
    const geometry = new THREE.PlaneGeometry(1, 1)
    perInstance(geometry, 'aSrc', glows.streaks, 4, it => [it.x, it.z, it.h, it.w])
    perInstance(geometry, 'aShape', glows.streaks, 2, it => [it.phase, it.length])
    meshes.push(instanced(geometry, streakMaterial(uTime, mask), glows.streaks, (it, m, c) => c.copy(it.color), 'street:reflections'))
  }
  if (glows.ripples.length) {
    const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
    perInstance(geometry, 'aRip', glows.ripples, 4, it => [it.x, it.z, it.r, it.phase])
    meshes.push(instanced(geometry, rippleMaterial(uTime), glows.ripples, () => {}, 'street:ripples'))
  }
  if (glows.puffs.length) {
    const geometry = new THREE.PlaneGeometry(2, 2)
    perInstance(geometry, 'aPuff', glows.puffs, 4, it => [it.x, it.z, it.phase, it.scale])
    meshes.push(instanced(geometry, steamMaterial(uTime), glows.puffs, (it, m, c) => c.copy(it.color), 'street:steam'))
  }
  return meshes.filter(Boolean)
}

// ------------------------------------------------------------------ street furniture

/** A lamp post: a slim pole, a T-bar with two cool-white heads, their beams, halos and the light they leave below. */
function lamp(p, x, z) {
  const { metal, glow } = p.batches
  metal.box(0.34, 0.36, 0.34, '#1b1f29', x, 0.12, z)
  metal.cyl(0.065, 0.085, 4.0, '#252a34', x, 2.15, z, { segments: 10 })
  metal.box(1.75, 0.09, 0.12, '#252a34', x, 4.18, z)
  glow.cyl(0.098, 0.098, 0.05, NEON.cyan, x, 2.7, z, { segments: 12, k: 1.5, white: 0.2 })
  for (const dx of [-0.74, 0.74]) {
    metal.box(0.58, 0.11, 0.26, '#2c313c', x + dx, 4.13, z)
    // The lit lens wraps the lower 7 cm of the head, a centimetre proud of it all round: the orbit camera
    // always looks down, so a lens only under the head would show as a one-pixel rim.
    glow.box(0.6, 0.08, 0.28, LAMP, x + dx, 4.105, z, { k: 2.8 })
    p.glows.cone(x + dx, 4.06, z, 1.35, 4.06, LAMP, 0.06)
    p.glows.halo(x + dx, 4.0, z, 0.75, LAMP, 0.5)
    p.glows.streak(x + dx, z, 4.05, 0.34, LAMP, 0.34)
  }
  p.glows.halo(x, 3.85, z, 2.6, LAMP, 0.1)
  p.glows.pool(x, z, 3.4, 2.6, LAMP, 0.2)
  // One rain spot per post, between the heads (1.48 m apart) and wide enough to take in both: one per
  // head would double the lamps' share of the 16 spots weather.js lights, crowding out signs and the stop.
  p.glows.spot(x, 4.05, z, LAMP, 3)
}

/** A short post with a glowing ring, along the far kerb. */
function bollard(p, x, z, color) {
  p.batches.metal.cyl(0.08, 0.09, 0.91, '#232833', x, 0.395, z, { segments: 8 })
  p.batches.glow.cyl(0.095, 0.095, 0.06, color, x, 0.72, z, { segments: 10, k: 1.8, white: 0.2 })
  p.glows.halo(x, 0.72, z, 0.32, color, 0.18)
  p.glows.streak(x, z, 0.72, 0.14, color, 0.25, 0.7)
}

/** A vending machine with its lit front facing `ry`. */
function vending(p, x, z, ry, kind, index) {
  const { metal, glow, signs } = p.batches
  const m = at(x, 0, z, 0, ry)
  const local = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(m)
  metal.add(new THREE.BoxGeometry(0.95, 1.91, 0.75), m.clone().multiply(at(0, 0.895, 0)), kind.body)
  signs.add(atlasPlane(0.7, 1.4, p.cells.vend[index]), m.clone().multiply(at(0, 1.12, 0.387)), '#ffffff', 0.95)
  metal.add(new THREE.BoxGeometry(0.6, 0.16, 0.04), m.clone().multiply(at(0, 0.28, 0.39)), '#101318')
  glow.add(new THREE.BoxGeometry(0.88, 0.12, 0.02), m.clone().multiply(at(0, 1.78, 0.39)), kind.banner, 1.6, 0.3)
  const front = local(0, 1.1, 0.6)
  p.glows.halo(front.x, front.y, front.z, 0.95, kind.light, 0.1)
  const foot = local(0, 0, 1.0)
  p.glows.pool(foot.x, foot.z, 1.1, 0.9, kind.light, 0.22, ry)
  const face = local(0, 0, 0.4)
  p.glows.streak(face.x, face.z, 1.1, 0.4, kind.light, 0.3, 0.8)
  p.glows.spot(front.x, front.y, front.z, kind.light, 1.5)
}

/** The transit stop: a long curved roof with a lit name board, a bright shelter under it, posters and a departures screen. */
function transitStop(p, kx, kz0) {
  const { matte, metal, glow, signs, glass } = p.batches
  const depth = 2.8
  const length = 10.4
  const kc = kz0 + depth / 2
  const roofY = 2.9
  const R = 1.55
  matte.box(length + 0.4, 0.06, depth + 0.3, '#2c303b', kx, -0.02, kc)
  matte.box(length, 0.03, 0.3, '#6d5f1e', kx, 0.015, kz0 + 0.2)
  // Posts: red and white, the front ones with a lit red stripe.
  for (const [i, px] of [-4.9, -1.65, 1.65, 4.9].entries()) {
    const paint = i % 2 ? '#d9dee8' : '#b0213a'
    metal.box(0.16, roofY, 0.16, paint, kx + px, roofY / 2, kz0 + 0.15)
    metal.box(0.16, roofY, 0.16, paint, kx + px, roofY / 2, kz0 + depth - 0.15)
    glow.box(0.05, 2.2, 0.02, NEON.red, kx + px, 1.5, kz0 + 0.15 - 0.092, { k: 1.8, white: 0.2 })
  }
  // The curved roof: half a cylinder lying along the street, closed at both ends.
  metal.add(new THREE.CylinderGeometry(R, R, length + 0.6, 28, 1, false, 0, Math.PI), at(kx, roofY, kc, 0, 0, Math.PI / 2), '#16363c')
  metal.add(new THREE.PlaneGeometry(length + 0.5, R * 2 - 0.05).rotateX(Math.PI / 2), at(kx, roofY - 0.004, kc), '#0d1418')
  for (const px of [-3.3, 0, 3.3]) {
    glow.add(new THREE.PlaneGeometry(2.4, 0.5).rotateX(Math.PI / 2), at(kx + px, roofY - 0.018, kc), LAMP, 1.7)
    p.glows.halo(kx + px, roofY - 0.3, kc, 1.4, LAMP, 0.1)
  }
  for (const side of [-1, 1]) glow.box(length + 0.6, 0.12, 0.12, NEON.cyan, kx, roofY - 0.04, kc + side * R, { k: 2, white: 0.3 })
  // The name board sits on the front and back of the curve, tilted back with it.
  const y1 = 0.12
  const y2 = 1.32
  const z1 = Math.sqrt(R * R - y1 * y1)
  const z2 = Math.sqrt(R * R - y2 * y2)
  const tilt = Math.atan2(z1 - z2, y2 - y1)
  const chord = Math.hypot(z1 - z2, y2 - y1)
  const sag = R - Math.abs(z1 * y2 - z2 * y1) / chord
  const midY = (y1 + y2) / 2
  const midZ = (z1 + z2) / 2
  for (const side of [-1, 1]) {
    const out = sag + 0.06
    const by = roofY + midY + Math.sin(tilt) * out
    const bz = kc + side * (midZ + Math.cos(tilt) * out)
    const rx = side < 0 ? tilt : -tilt
    const ry = side < 0 ? Math.PI : 0
    metal.box(5.8, 1.12, 0.12, '#1d2328', kx, by, bz, { rx, ry })
    const face = 0.06 + 0.012
    signs.add(atlasPlane(5.6, 1.05, p.cells.stop), at(kx, by + Math.sin(tilt) * face, bz + side * Math.cos(tilt) * face, rx, ry), '#ffffff', 1.25)
    for (const px of [-1.9, 0, 1.9]) p.glows.halo(kx + px, by, bz + side * 0.3, 1.5, NEON.amber, 0.07)
  }
  // Back wall with backlit posters on both faces, glass at the ends, a bench and two vending machines.
  const wallZ = kz0 + depth - 0.1
  metal.box(length - 0.4, 2.7, 0.08, '#1a2228', kx, 1.4, wallZ)
  for (const [i, px] of [-3.3, -0.9].entries()) {
    signs.add(atlasPlane(1.3, 1.95, p.cells.poster[i]), at(kx + px, 1.45, wallZ - 0.052, 0, Math.PI), '#ffffff', 1)
    signs.add(atlasPlane(1.3, 1.95, p.cells.poster[1 - i]), at(kx + px, 1.45, wallZ + 0.052), '#ffffff', 1)
    p.glows.halo(kx + px, 1.45, wallZ + 0.4, 1.0, i ? NEON.magenta : AMBER_WINDOW, 0.06)
  }
  for (const side of [-1, 1]) glass.quad(depth - 0.6, 2.5, '#ffffff', kx + side * (length / 2 - 0.05), 1.35, kc, { ry: Math.PI / 2 })
  metal.box(2.2, 0.07, 0.45, '#c9ced8', kx + 1.3, 0.46, wallZ - 0.32)
  for (const dx of [-0.9, 0.9]) metal.box(0.06, 0.44, 0.4, '#2a2f3a', kx + 1.3 + dx, 0.22, wallZ - 0.32)
  vending(p, kx + 3.45, wallZ - 0.47, Math.PI, VENDING[0], 0)
  vending(p, kx + 4.45, wallZ - 0.47, Math.PI, VENDING[2], 2)
  // The departures totem at the west end: header board above, the scrolling list on both faces.
  const tx = kx - length / 2 - 1.0
  const tz = kz0 + 0.9
  metal.box(1.1, 2.6, 0.28, '#1d2328', tx, 1.3, tz)
  for (const side of [-1, 1]) {
    signs.add(atlasPlane(1.0, 0.5, p.cells.header), at(tx, 2.3, tz + side * 0.152, 0, side < 0 ? Math.PI : 0), '#ffffff', 1.15)
    p.screens.push(at(tx, 1.25, tz + side * 0.152, 0, side < 0 ? Math.PI : 0))
  }
  p.glows.halo(tx, 1.6, tz, 1.1, NEON.cyan, 0.1)
  // Light the shelter throws: on the ground, into the rain, and down the wet road.
  p.glows.pool(kx, kc, 6.4, 3.3, LAMP, 0.3)
  p.glows.pool(kx, kz0 - 1.3, 5.6, 1.8, NEON.amber, 0.12)
  p.glows.streak(kx, kc, roofY - 0.1, 1.6, LAMP, 0.22)
  for (const px of [-1.9, 0, 1.9]) p.glows.streak(kx + px, kz0 - 0.1, roofY + 0.75, 0.8, NEON.amber, 0.4)
  for (const px of [-3.4, 3.4]) p.glows.streak(kx + px, kz0 - 0.1, roofY, 0.5, NEON.cyan, 0.32)
  p.glows.spot(kx, roofY - 0.2, kc, '#cfeaff', 5)
  p.glows.spot(kx, roofY + 0.75, kz0 - 0.2, NEON.amber, 4)
}

/** A row of low shops facing the road, each with a lit window, an awning, a sign, and life on the roof and at the back. */
function shopRow(p, x0, x1, zf) {
  const { matte, metal, glow, signs } = p.batches
  const rnd = stream('shops')
  const walls = ['#141823', '#1a1520', '#11161f', '#18171c', '#0f1419']
  const shops = []
  let order = 0
  for (let x = x0, i = 0; x < x1; i += 1) {
    const w = 6 + Math.floor(rnd() * 5)
    const h = 4.3 + rnd() * 1.1
    const d = 4 + rnd() * 1.5
    const cx = x + w / 2
    const zb = zf + d
    const typeIndex = (order + Math.floor(rnd() * 3)) % SHOPS.length
    order = typeIndex + 1
    const shop = SHOPS[typeIndex]
    const light = ROOM_LIGHT[shop.room]
    matte.box(w, h + 0.06, d, walls[i % walls.length], cx, (h - 0.06) / 2, zf + d / 2)

    // The window and an open lit doorway.
    const ww = Math.min(w * 0.58, 4.6)
    const wx = cx - w * 0.12
    signs.add(atlasPlane(ww, 1.9, p.cells.room[shop.room]), at(wx, 1.2, zf - 0.012, 0, Math.PI), '#ffffff', 0.95)
    glow.quad(0.95, 2.1, light, cx + w * 0.34, 1.05, zf - 0.012, { ry: Math.PI, k: 0.55 })
    p.glows.pool(wx, zf - 1.3, ww * 0.55, 1.3, light, 0.2)
    p.glows.streak(wx, zf - 0.05, 1.3, ww * 0.3, light, 0.16, 0.8)

    // Awning with a neon front edge.
    metal.box(w * 0.92, 0.07, 0.95, '#20252f', cx, 2.45, zf - 0.475)
    glow.box(w * 0.92, 0.12, 0.12, shop.color, cx, 2.45, zf - 1.0, { k: 1.7, white: 0.25 })

    // The name board above it.
    const sw = Math.min(w * 0.7, 5.6)
    const sh = sw / 4
    const sy = 2.8 + sh / 2
    metal.box(sw + 0.16, sh + 0.12, 0.06, '#0b0d14', cx, sy, zf - 0.03)
    signs.add(atlasPlane(sw, sh, p.cells.sign[typeIndex]), at(cx, sy, zf - 0.072, 0, Math.PI), '#ffffff', 1.25)
    p.glows.halo(cx, sy, zf - 0.35, sw * 0.42, shop.color, 0.07)
    p.glows.streak(cx, zf - 0.1, sy, Math.min(sw * 0.28, 1.1), shop.color, 0.42)
    p.glows.spot(cx, sy, zf - 0.4, shop.color, 2.5)

    // Every other shop hangs a vertical blade sign out over the pavement.
    if (i % 2 === 0) {
      const bx = cx + w / 2 - 0.45
      metal.box(0.08, 2.5, 0.75, '#0b0d14', bx, 3.95, zf - 0.55)
      metal.box(0.06, 0.06, 0.25, '#2a2f3a', bx, 4.9, zf - 0.12)
      for (const side of [-1, 1]) signs.add(atlasPlane(0.62, 2.4, p.cells.blade[typeIndex]), at(bx + side * 0.052, 3.95, zf - 0.55, 0, side * Math.PI / 2), '#ffffff', 1.3)
      p.glows.halo(bx, 3.95, zf - 0.55, 1.2, shop.color, 0.09)
      p.glows.streak(bx, zf - 0.55, 3.95, 0.28, shop.color, 0.45)
    }

    // The roof: neon trim along its edges, plant, and now and then a sign facing the far side of the city.
    if (rnd() < 0.55) glow.box(w, 0.12, 0.12, shop.color, cx, h + 0.06, zf + 0.06, { k: 1.6, white: 0.25 })
    if (rnd() < 0.5) glow.box(w, 0.12, 0.12, pickColor(rnd), cx, h + 0.06, zb - 0.06, { k: 1.5, white: 0.25 })
    metal.box(1.0, 0.6, 0.8, '#3a404c', cx - w * 0.25, h + 0.3, zf + d * 0.45)
    if (rnd() < 0.6) metal.box(0.8, 0.5, 0.7, '#2f343f', cx + w * 0.2, h + 0.25, zf + d * 0.35)
    if (h <= 4.7 && rnd() < 0.5) {
      const sign = ROOF_SIGNS[i % ROOF_SIGNS.length]
      const rz = zb - 0.9
      for (const dx of [-1.2, 1.2]) metal.box(0.08, 1.2, 0.08, '#2a2f3a', cx + dx, h + 0.6, rz - 0.05)
      metal.box(2.92, 0.98, 0.06, '#0b0d14', cx, h + 0.75, rz - 0.03)
      signs.add(atlasPlane(2.8, 0.875, p.cells.roof[i % ROOF_SIGNS.length]), at(cx, h + 0.75, rz + 0.012), '#ffffff', 1.2)
      p.glows.halo(cx, h + 0.75, rz + 0.3, 1.5, sign.color, 0.07)
    } else if (h <= 4.6 && rnd() < 0.6) {
      metal.cyl(0.5, 0.5, 1.0, '#2c2f36', cx + w * 0.28, h + 0.8, zb - 1.2, { segments: 12 })
      for (const dx of [-0.3, 0.3]) metal.box(0.06, 0.3, 0.06, '#2a2f3a', cx + w * 0.28 + dx, h + 0.15, zb - 1.2)
    }

    // The back: flats over the shop with some windows lit, a pipe, a lamp over the back door.
    for (const wy of [1.5, 3.4]) {
      for (let k = 0; k < 3; k += 1) {
        const wxk = cx - w * 0.3 + k * w * 0.3
        if (rnd() < 0.4) {
          metal.quad(0.85, 0.85, '#07090e', wxk, wy, zb + 0.012)
          continue
        }
        const flat = rnd() < 0.6 ? 0 : rnd() < 0.5 ? 1 : 2
        signs.add(atlasPlane(0.85, 0.85, p.cells.flat[flat]), at(wxk, wy, zb + 0.012), '#ffffff', 0.7 + rnd() * 0.25)
      }
    }
    // Skylights glowing up through the roof, and on the lower roofs a mast with a steady red light.
    for (let k = 0; k < 1 + Math.floor(rnd() * 2); k += 1) {
      glow.flat(1.1, 0.7, rnd() < 0.7 ? WARM : COOL, cx + (rnd() - 0.5) * w * 0.5, h + 0.012, zf + d * (0.55 + rnd() * 0.2), { k: 0.55 })
    }
    if (h <= 4.8 && rnd() < 0.5) {
      const mx = cx - w * 0.4
      metal.cyl(0.03, 0.03, 1.1, '#3a404c', mx, h + 0.55, zb - 0.5, { segments: 6 })
      glow.box(0.1, 0.1, 0.1, NEON.red, mx, h + 1.12, zb - 0.5, { k: 2, white: 0.3 })
      p.glows.halo(mx, h + 1.12, zb - 0.5, 0.45, NEON.red, 0.22)
    }
    metal.cyl(0.05, 0.05, h, '#2a2f3a', cx + w * 0.44, h / 2, zb + 0.08, { segments: 6 })
    glow.box(0.3, 0.12, 0.1, WARM, cx - w * 0.38, 2.4, zb + 0.06, { k: 1.8 })
    p.glows.halo(cx - w * 0.38, 2.35, zb + 0.3, 0.6, WARM, 0.14)
    p.glows.pool(cx - w * 0.38, zb + 1.2, 1.4, 1.0, WARM, 0.12)

    shops.push({ cx, w, h, zf, color: shop.color })
    x += w + (rnd() < 0.3 ? 1.2 : 0.25)
  }
  return shops
}

/** One of the neon colours, drawn from a seeded stream. */
function pickColor(rnd) {
  const list = Object.values(NEON)
  return list[Math.floor(rnd() * list.length)]
}

/** A parked car: low and wedge shaped, red light bar at the back, white lamps at the front, both steady. */
function car(p, x, z, yaw, paint) {
  const { metal, matte, glow } = p.batches
  const m = at(x, Y.road, z, 0, yaw)
  const place = local => m.clone().multiply(local)
  const point = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(m)
  const profile = [
    [-2.2, 0.3], [2.2, 0.3], [2.25, 0.55], [2.12, 0.74], [1.25, 0.86],
    [0.55, 1.28], [-0.75, 1.3], [-1.55, 0.92], [-2.18, 0.86], [-2.25, 0.55],
  ]
  const shape = new THREE.Shape(profile.map(([px, py]) => new THREE.Vector2(px, py)))
  metal.add(new THREE.ExtrudeGeometry(shape, { depth: 1.76, bevelEnabled: false }).translate(0, 0, -0.88), m, paint)
  const cabin = new THREE.Shape([[-1.45, 0.9], [1.15, 0.9], [0.5, 1.24], [-0.7, 1.26]].map(([px, py]) => new THREE.Vector2(px, py)))
  metal.add(new THREE.ExtrudeGeometry(cabin, { depth: 1.8, bevelEnabled: false }).translate(0, 0, -0.9), m, '#0a0e16')
  // Windscreen and rear window, a centimetre proud of the body.
  const glassOn = (ax, ay, bx, by, width) => {
    const dir = new THREE.Vector3(bx - ax, by - ay, 0)
    const len = dir.length()
    dir.normalize()
    const normal = new THREE.Vector3(-dir.y, dir.x, 0)
    if (normal.x * (ax + bx) < 0) normal.negate()
    const across = new THREE.Vector3().crossVectors(dir, normal).normalize()
    const basis = new THREE.Matrix4().makeBasis(across, dir, normal)
    basis.setPosition((ax + bx) / 2 + normal.x * 0.012, (ay + by) / 2 + normal.y * 0.012, 0)
    metal.add(new THREE.PlaneGeometry(width, len * 0.86), place(basis), '#0a0e16')
  }
  glassOn(1.25, 0.86, 0.55, 1.28, 1.5)
  glassOn(-1.55, 0.92, -0.75, 1.3, 1.45)
  for (const wx of [-1.38, 1.38]) {
    for (const wz of [-0.8, 0.8]) matte.add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), place(at(wx, 0.34, wz, Math.PI / 2)), '#0a0b0e')
  }
  glow.add(new THREE.BoxGeometry(0.03, 0.07, 1.5), place(at(-2.235, 0.72, 0)), NEON.red, 2.4, 0.15)
  for (const side of [-1, 1]) glow.add(new THREE.BoxGeometry(0.03, 0.06, 0.34), place(at(2.215, 0.62, side * 0.58)), '#f2f7ff', 3)
  for (const side of [-1, 1]) {
    const tail = point(-2.3, 0.72, side * 0.6)
    p.glows.halo(tail.x, tail.y, tail.z, 0.45, NEON.red, 0.3)
    p.glows.streak(tail.x, tail.z, 0.72, 0.28, NEON.red, 0.5, 0.75)
    const head = point(2.3, 0.62, side * 0.58)
    p.glows.halo(head.x, head.y, head.z, 0.5, '#f2f7ff', 0.3)
    p.glows.streak(head.x, head.z, 0.62, 0.3, '#f2f7ff', 0.4, 0.75)
  }
  const back = point(-3.0, 0, 0)
  p.glows.pool(back.x, back.z, 1.2, 0.75, NEON.red, 0.25, yaw)
  const ahead = point(3.5, 0, 0)
  p.glows.pool(ahead.x, ahead.z, 2.2, 0.95, '#e8f2ff', 0.2, yaw)
  const glowAt = point(-2.3, 0.72, 0)
  p.glows.spot(glowAt.x, glowAt.y, glowAt.z, NEON.red, 1.2)
}

/** A raised planter with grass in it and blue uplights on its rim. */
function planter(p, x, z, w, d, key, beams = 2) {
  const { matte, glow } = p.batches
  const rnd = stream(key)
  matte.box(w, 0.61, d, '#222631', x, 0.245, z)
  matte.box(w - 0.3, 0.04, d - 0.3, '#11140f', x, 0.555, z)
  const tufts = Math.round(w * d * 2.2)
  for (let i = 0; i < tufts; i += 1) {
    const h = 0.25 + rnd() * 0.3
    const r = 0.06 + rnd() * 0.07
    matte.add(new THREE.ConeGeometry(r, h, 5), at(x + (rnd() - 0.5) * (w - 0.45), 0.575 + h / 2, z + (rnd() - 0.5) * (d - 0.45), 0, rnd() * 3), GRASS[Math.floor(rnd() * GRASS.length)])
  }
  const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]]
  corners.forEach(([sx, sz], i) => {
    const lx = x + sx * (w / 2 - 0.09)
    const lz = z + sz * (d / 2 - 0.09)
    glow.box(0.12, 0.03, 0.12, UPLIGHT, lx, 0.565, lz, { k: 2.4, white: 0.35 })
    p.glows.halo(lx, 0.6, lz, 0.3, UPLIGHT, 0.4)
    if (i < beams) p.glows.cone(lx, 0.58, lz, 0.55, 2.4, UPLIGHT, 0.06, true)
  })
}

/** A tree in the style of a garden pine: a curving trunk and layered pads of dark leaves on short branches. */
function tree(p, x, z, height, key, keep) {
  const { matte } = p.batches
  const rnd = stream(key)
  const s = height / 7
  const lean = (rnd() - 0.5) * 0.9 * s
  const pts = [
    new THREE.Vector3(x, 0.5, z),
    new THREE.Vector3(x + lean * 0.35, height * 0.36, z + (rnd() - 0.5) * 0.4 * s),
    new THREE.Vector3(x + lean * 0.85, height * 0.64, z + (rnd() - 0.5) * 0.5 * s),
    new THREE.Vector3(x + lean * 0.55, height * 0.88, z + (rnd() - 0.5) * 0.3 * s),
  ]
  const radii = [0.2, 0.15, 0.11, 0.07].map(r => r * (0.7 + s * 0.3))
  for (let i = 0; i < 3; i += 1) matte.limb(pts[i], pts[i + 1], radii[i], radii[i + 1], BARK)
  const along = t => {
    const f = t * 3
    const i = Math.min(2, Math.floor(f))
    return pts[i].clone().lerp(pts[i + 1], f - i)
  }
  const pad = (v, sx, sy, sz) => p.pads.push({ x: v.x, y: v.y, z: v.z, sx, sy, sz, ry: rnd() * Math.PI, color: LEAVES[Math.floor(rnd() * LEAVES.length)] })
  const n = 4 + Math.floor(rnd() * 3)
  for (let k = 0; k < n; k += 1) {
    const t = 0.38 + (k / (n - 1)) * 0.5
    const base = along(t)
    const angle = k * 2.39996 + rnd() * 0.8
    const reach = (1.0 + rnd() * 0.8) * (1.15 - t * 0.6) * s * 1.4
    const size = (0.85 + rnd() * 0.5) * s * (1.2 - t * 0.35)
    const end = new THREE.Vector3(base.x + Math.cos(angle) * reach, base.y + (0.2 + rnd() * 0.4) * s, base.z + Math.sin(angle) * reach)
    keep(end, size * 1.3)
    matte.limb(base, end, 0.07 * s, 0.035 * s, BARK, 5)
    pad(end, size * 1.25, size * (0.42 + rnd() * 0.12), size * (1.0 + rnd() * 0.3))
    const upper = end.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.3 * s, size * 0.42, (rnd() - 0.5) * 0.3 * s))
    keep(upper, size)
    pad(upper, size * 0.8, size * 0.36, size * 0.75)
  }
  const top = pts[3].clone().add(new THREE.Vector3(0, 0.25 * s, 0))
  keep(top, 1.1 * s)
  pad(top, 1.05 * s, 0.5 * s, 0.95 * s)
}

/** A bench facing `dir` along x (+1 faces east). */
function bench(p, x, z, dir) {
  const { matte, metal } = p.batches
  matte.box(0.5, 0.07, 1.7, '#3a2c22', x, 0.45, z)
  matte.box(0.06, 0.42, 1.7, '#3a2c22', x - dir * 0.24, 0.72, z)
  for (const dz of [-0.7, 0.7]) metal.box(0.44, 0.48, 0.06, '#2a2f3a', x, 0.18, z + dz)
}

/** A street vent: a dark grate with a warm glow under its slats, breathing steam. */
function vent(p, x, z, ground, tint) {
  const { matte, glow } = p.batches
  const top = ground + 0.03
  matte.box(1.0, 0.03, 0.62, '#0b0d12', x, ground + 0.015, z)
  for (let i = 0; i < 4; i += 1) glow.flat(0.82, 0.04, '#ff7a2b', x, top + 0.012, z - 0.21 + i * 0.14, { k: 0.9 })
  p.glows.halo(x, 0.25, z, 0.7, '#ff7a2b', 0.12)
  p.glows.pool(x, z, 0.9, 0.7, '#ff7a2b', 0.12)
  p.glows.vent(x, z, tint)
}

/** Puddles scattered over a rectangle, avoiding spots where they would look wrong. */
function puddles(p, key, { x0, x1, z0, z1, y, count, rMin, rMax, avoid = () => false }) {
  const rnd = stream(key)
  for (let i = 0; i < count; i += 1) {
    let tries = 0
    let r
    let x
    let z
    do {
      r = rMin + rnd() * (rMax - rMin)
      x = x0 + r + rnd() * Math.max(0, x1 - x0 - r * 2)
      z = z0 + r * 0.7 + rnd() * Math.max(0, z1 - z0 - r * 1.4)
      tries += 1
    } while (avoid(x, z, r) && tries < 6)
    if (avoid(x, z, r)) continue
    const stretch = 1 + rnd() * 0.7
    // A soft blob: a circle pushed in and out by two slow waves round its edge.
    const points = []
    const sides = 22
    const w2 = rnd() * 6.28
    const w3 = rnd() * 6.28
    for (let k = 0; k < sides; k += 1) {
      const a = (k / sides) * Math.PI * 2
      const rad = r * (0.86 + 0.2 * Math.sin(a * 2 + w2) + 0.1 * Math.sin(a * 3 + w3))
      points.push(new THREE.Vector2(Math.cos(a) * rad * stretch, Math.sin(a) * rad * 0.7))
    }
    p.batches.puddles.add(new THREE.ShapeGeometry(new THREE.Shape(points), 1).rotateX(-Math.PI / 2), at(x, y, z, 0, (rnd() - 0.5) * 0.6), '#ffffff', 0.85 + rnd() * 0.15)
    p.glows.ripple(x, z, r * 0.8)
  }
}

/** Gives every face of a block texture coordinates in metres, so windows keep one size; roofs get none. */
function scaleBoxUv(geometry, w, h, d) {
  const uv = geometry.attributes.uv
  const faces = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]]
  faces.forEach(([fw, fh], f) => {
    for (let k = 0; k < 4; k += 1) {
      const i = f * 4 + k
      uv.setXY(i, (uv.getX(i) * fw) / 12, (uv.getY(i) * fh) / 24)
    }
  })
}

// ------------------------------------------------------------------ the street

/** Builds the street level around an office `ctx.extent` metres wide into `group`. */
export function buildStreet(group, ctx) {
  const { extent, street } = ctx
  const cx = extent / 2
  const lobbyX = COLUMNS[0].x0 + 4.5
  const kerbNear = OUTSIDE.z1 - 0.05
  const roadNear = street - 3.5
  const laneFar = street + 3.5
  const parkFar = street + 5.8
  const pave = parkFar + 0.25
  const spots = ctx.lightSpots ?? []
  const wet = ctx.wetMaterials ?? []
  const renderer = ctx.renderer ?? null
  const uTime = { value: 0 }
  // Light lying on the ground stops at the building's slab: its floors are dry.
  const mask = new THREE.Vector4(-0.6, -0.6, extent + 0.6, OUTSIDE.z0)
  const owned = { textures: [], materials: [] }

  const cells = paintAtlas(renderer)
  owned.textures.push(cells.texture)
  const p = {
    batches: { matte: new Batch(), metal: new Batch(), glow: new Batch(), signs: new Batch(), glass: new Batch(), puddles: new Batch(), blocks: new Batch() },
    glows: new Glows(spots),
    cells,
    pads: [],
    screens: [],
  }
  const { matte, glow } = p.batches

  // ---- Ground: the plaza and the road, both wet.
  // The plaza stops at the kerbs on either side of the road, so the two never lie one over the other.
  const roadZ0 = kerbNear
  const roadZ1 = parkFar + 0.1
  const slab = (z0, z1) => {
    const g = new THREE.PlaneGeometry(800, z1 - z0).rotateX(-Math.PI / 2).translate(cx, Y.plaza, (z0 + z1) / 2)
    const pos = g.attributes.position
    const uv = g.attributes.uv
    // Texture coordinates in units of 8 m, so both pieces share one paving grid.
    for (let i = 0; i < pos.count; i += 1) uv.setXY(i, pos.getX(i) / 8, -pos.getZ(i) / 8)
    return g
  }
  const plazaTex = plazaTextures(renderer)
  plazaTex.rough.repeat.set(8 / 26, 8 / 26)
  const plazaMat = new THREE.MeshStandardMaterial({ map: plazaTex.map, roughness: 0.28, roughnessMap: plazaTex.rough, metalness: 0.6 })
  const plaza = new THREE.Mesh(mergeGeometries([slab(-460, roadZ0), slab(roadZ1, 340)]), plazaMat)
  plaza.receiveShadow = true
  plaza.name = 'street:plaza'

  // As long as the plaza, so no strip of sky shows between them when the camera looks down the road.
  const roadLength = 800
  const roadTex = roadTextures(renderer, street, roadZ0, roadZ1)
  roadTex.map.repeat.set(roadLength / 16, 1)
  roadTex.rough.repeat.set(roadLength / 16, 1)
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex.map, roughness: 0.26, roughnessMap: roadTex.rough, metalness: 0.65 })
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadLength, roadZ1 - roadZ0), roadMat)
  road.rotation.x = -Math.PI / 2
  road.position.set(cx, Y.road, (roadZ0 + roadZ1) / 2)
  road.receiveShadow = true
  road.name = 'street:road'
  owned.textures.push(plazaTex.map, plazaTex.rough, roadTex.map, roadTex.rough)

  // Kerbs from the plaza's level up to Y.kerb: they cover the plaza's cut edges and the road puddles' near
  // rims, keep the clear zone clear, and stand a centimetre under the light pools, which run over them.
  const kerbH = Y.kerb - Y.plaza
  matte.box(roadLength, kerbH, 0.25, '#2a2f3a', cx, Y.plaza + kerbH / 2, kerbNear)
  matte.box(roadLength, kerbH, 0.25, '#2a2f3a', cx, Y.plaza + kerbH / 2, roadZ1)

  // ---- Road marks: a glowing centre line, an amber edge line, the crossing at the lobby, the parking lane.
  const crossing = x => Math.abs(x - lobbyX) < 2.6
  for (let x = cx - 300; x < cx + 300; x += 5) if (!crossing(x)) glow.flat(2.4, 0.14, NEON.cyan, x, Y.marks, street, { k: 1.5, white: 0.1 })
  for (const [a, b] of [[cx - 300, lobbyX - 1.9], [lobbyX + 1.9, cx + 300]]) glow.flat(b - a, 0.12, NEON.amber, (a + b) / 2, Y.marks, roadNear + 0.45, { k: 1.05 })
  for (let z = roadNear + 0.55; z < parkFar - 0.3; z += 0.9) glow.flat(3.2, 0.45, '#c9d2e6', lobbyX, Y.marks, z, { k: 0.42 })
  glow.flat(0.35, 3.3, '#c9d2e6', lobbyX - 2.5, Y.marks, street - 1.75, { k: 0.42 })
  glow.flat(0.35, 3.3, '#c9d2e6', lobbyX + 2.5, Y.marks, street + 1.75, { k: 0.42 })
  for (let x = cx - 160; x < cx + 160; x += 2.2) if (Math.abs(x - lobbyX) > 2.2) glow.flat(1.1, 0.12, '#b8c0d4', x, Y.marks, laneFar, { k: 0.3 })
  const bays = []
  for (let x = Math.round((cx - 150) / 6) * 6; x < cx + 150; x += 6) {
    if (Math.abs(x - lobbyX) < 3.4) continue
    glow.flat(0.12, parkFar - laneFar - 0.3, '#b8c0d4', x, Y.marks, (laneFar + parkFar) / 2, { k: 0.3 })
    bays.push(x + 3)
  }

  // ---- Lamps along the office pavement, and opposite them across the road.
  // Spaced evenly from x -4 to extent + 4, about 8 m apart, so both corners are lit at every width. A post
  // that would stand at the head of the lobby crossing steps aside, out of the walk from the door.
  const lampCount = Math.max(1, Math.round((extent + 8) / 8))
  const lampStep = (extent + 8) / lampCount
  for (let i = 0; i <= lampCount; i += 1) {
    let x = -4 + i * lampStep
    if (Math.abs(x - lobbyX) < 2.5) x = x <= lobbyX ? lobbyX - 2.5 : lobbyX + 2.5
    lamp(p, x, OUTSIDE.z1 - 0.4)
  }

  // ---- The transit stop across from the lobby side of the office.
  const kx = lobbyX + 11
  const kz0 = pave + 0.55
  transitStop(p, kx, kz0)

  // ---- Shops behind it, with vending machines between some of them.
  const zf = kz0 + 2.8 + 1.1
  const shops = shopRow(p, -34, extent + 34, zf)

  const farZ = pave + 0.25
  const farLamps = []
  for (let x = -20; x <= extent + 20; x += 8) {
    if (Math.abs(x - kx) < 6 || Math.abs(x - lobbyX) < 2.5) continue
    lamp(p, x, farZ)
    farLamps.push(x)
  }

  // Machines stand against the party wall between two shops, clear of both windows.
  const machines = []
  shops.forEach((shop, i) => {
    if (i % 3 !== 1) return
    const prev = shops[i - 1]
    const vx = (prev.cx + prev.w / 2 + shop.cx - shop.w / 2) / 2
    if (Math.abs(vx - kx) < 6.5) return
    vending(p, vx, zf - 0.42, Math.PI, VENDING[i % VENDING.length], i % VENDING.length)
    machines.push(vx)
  })

  // ---- Parked cars in the lane by the far kerb.
  const carStream = stream('parked-cars')
  const paints = ['#141a26', '#2a1220', '#0e2626', '#2b2f38', '#3a2a10', '#b9bec8']
  let parked = 0
  const parkedAt = []
  for (const bx of bays) {
    if (bx < -22 || bx > extent + 22 || Math.abs(bx - lobbyX) < 5.5) continue
    if (carStream() > 0.42) continue
    car(p, bx, (laneFar + parkFar) / 2, carStream() < 0.5 ? 0 : Math.PI, paints[parked % paints.length])
    parkedAt.push(bx)
    parked += 1
  }

  // ---- Bollards along the far kerb, off the crossing and clear of the stop and the lamps.
  for (let x = -24, i = 0; x <= extent + 24; x += 3, i += 1) {
    if (Math.abs(x - lobbyX) < 2.4 || Math.abs(x - kx) < 5.6 || near(x, farLamps, 0.9)) continue
    bollard(p, x, pave + 0.15, i % 2 ? NEON.cyan : NEON.amber)
  }

  // ---- Greenery: a row of garden pines behind the office, more down both sides, a few across the road.
  // Leaves keep out of the office's clear zone on one side and short of the flank towers on the other.
  const withinEdge = (v, r) => {
    v.x = Math.min(Math.max(v.x, r - EDGE), extent + EDGE - r)
  }
  const keepNorth = (v, r) => {
    v.z = Math.min(v.z, -4.15 - r)
    withinEdge(v, r)
  }
  const keepWest = (v, r) => {
    v.x = Math.min(v.x, -6.15 - r)
    withinEdge(v, r)
  }
  const keepEast = (v, r) => {
    v.x = Math.max(v.x, extent + 6.15 + r)
    withinEdge(v, r)
  }
  const crossings = [-3, cx, extent + 3]
  // The north row: pines spaced evenly from x -9 to extent + 9 (about 8 m apart), a long bed between each
  // pair, every planter inside the EDGE span.
  const north = stream('north-trees')
  const northCount = Math.max(1, Math.round((extent + 18) / 8.2))
  const northStep = (extent + 18) / northCount
  for (let i = 0; i <= northCount; i += 1) {
    const x = -9 + i * northStep
    const tx = Math.min(Math.max(x + (north() - 0.5) * 1.6, 1.2 - EDGE), extent + EDGE - 1.2)
    const tz = -6.4 + (north() - 0.5) * 0.5
    if (!near(tx, crossings, 1.8)) {
      planter(p, tx, tz, 2.4, 2.4, `north-planter${i}`, 2)
      tree(p, tx, tz, 5.6 + north() * 2.6, `north-tree${i}`, keepNorth)
    }
    const bedX = x + northStep / 2
    if (i < northCount && !near(bedX, crossings, 2.6)) planter(p, bedX, -6.4, northStep - 4.2, 1.3, `north-bed${i}`, 1)
  }
  for (const [i, z] of [-1.5, 6, 13.5, 21].entries()) {
    planter(p, -8.7, z, 2.2, 2.2, `west-planter${i}`, 2)
    tree(p, -8.7, z, 4.6 + (hash(`west${i}`) % 100) / 55, `west-tree${i}`, keepWest)
    planter(p, extent + 8.7, z, 2.2, 2.2, `east-planter${i}`, 2)
    tree(p, extent + 8.7, z, 4.6 + (hash(`east${i}`) % 100) / 55, `east-tree${i}`, keepEast)
  }
  for (const z of [2.2, 9.8]) {
    bench(p, -6.9, z, 1)
    bench(p, extent + 6.9, z, -1)
  }
  // Across the road the trees are short (under 5.5 m, so low enough for the south); their leaves keep to
  // the road side of the shop awnings' neon edge (zf - 1.06), clear of the awnings, blade signs and fronts.
  const keepShopSide = (v, r) => {
    v.z = Math.min(v.z, zf - 1.1 - r)
  }
  for (const [i, tx] of [lobbyX - 4.5, kx + 8, 32, -16, extent + 26].entries()) {
    if (tx < -30 || tx > extent + 30 || near(tx, farLamps, 1.6) || near(tx, machines, 1.4)) continue
    if (Math.abs(tx - lobbyX) < 3.2 || Math.abs(tx - kx) < 7) continue
    planter(p, tx, pave + 2.3, 1.8, 1.8, `far-planter${i}`, 2)
    tree(p, tx, pave + 2.3, 4.2 + (hash(`far${i}`) % 60) / 100, `far-tree${i}`, keepShopSide)
  }

  // ---- Small blue lights set in the paving along the walks beside and behind the building.
  for (let x = -10; x <= extent + 10; x += 2.5) {
    glow.cyl(0.07, 0.07, 0.03, UPLIGHT, x, Y.plaza + 0.02, -4.6, { segments: 10, k: 2.4, white: 0.3 })
    p.glows.halo(x, 0.12, -4.6, 0.32, UPLIGHT, 0.28)
  }
  for (const lx of [-6.5, extent + 6.5]) {
    for (let z = -3; z <= 18; z += 2.5) {
      glow.cyl(0.07, 0.07, 0.03, UPLIGHT, lx, Y.plaza + 0.02, z, { segments: 10, k: 2.4, white: 0.3 })
      p.glows.halo(lx, 0.12, z, 0.32, UPLIGHT, 0.28)
    }
  }

  // ---- The still water channel along the north edge, with stepping stones across it.
  // Its coping ends at the EDGE span, short of the flank towers.
  const wx0 = 0.35 - EDGE
  const wx1 = extent + EDGE - 0.35
  const wzN = -11.0
  const wzS = -8.6
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2a3a58', roughness: 0.04, metalness: 0.8, emissive: '#0c1130', emissiveIntensity: 1 })
  const water = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wzS - wzN), waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set((wx0 + wx1) / 2, Y.water, (wzN + wzS) / 2)
  water.name = 'street:water'
  matte.box(wx1 - wx0 + 0.7, 0.16, 0.35, '#1f232d', (wx0 + wx1) / 2, 0.03, wzS + 0.175)
  matte.box(wx1 - wx0 + 0.7, 0.16, 0.35, '#1f232d', (wx0 + wx1) / 2, 0.03, wzN - 0.175)
  for (const ex of [wx0 - 0.175, wx1 + 0.175]) matte.box(0.35, 0.16, wzS - wzN, '#1f232d', ex, 0.03, (wzN + wzS) / 2)
  const stones = stream('stepping-stones')
  for (const sx of crossings) {
    for (const sz of [wzN + 0.45, (wzN + wzS) / 2, wzS - 0.45]) {
      matte.box(0.85, 0.1, 0.6, '#3a3f4a', sx + (stones() - 0.5) * 0.3, 0.01, sz, { ry: (stones() - 0.5) * 0.5 })
    }
  }
  for (let x = wx0 + 1; x < wx1; x += 3) {
    glow.box(0.1, 0.02, 0.1, UPLIGHT, x, 0.12, wzS + 0.175, { k: 2.4, white: 0.3 })
    p.glows.halo(x, 0.2, wzS + 0.175, 0.3, UPLIGHT, 0.25)
  }
  // Rain rings on the open water only: a patch over the stepping stones would lie half a centimetre under
  // their tops (the stones reach 0.65 m either side of a crossing, a patch 1 m).
  for (let x = wx0 + 2; x < wx1 - 1; x += 4.5) {
    if (!near(x, crossings, 1.7)) p.glows.ripple(x, (wzN + wzS) / 2, 1.0)
  }
  const shineTex = cityShineTexture(renderer)
  owned.textures.push(shineTex)
  const shine = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wzS - wzN - 0.1).rotateX(-Math.PI / 2), waterShineMaterial(uTime, shineTex, (wx1 - wx0) / 24))
  shine.position.set((wx0 + wx1) / 2, Y.water + 0.02, (wzN + wzS) / 2)
  shine.name = 'street:water-lights'

  // ---- Puddles: on the office pavement, the road, the far pavement, and the plaza round the sides.
  const lobbyMat = (x, z, r) => Math.abs(x - lobbyX) < 1.6 + r && z < 20.8 + r
  puddles(p, 'pavement-puddles', { x0: -5.5, x1: extent + 5.5, z0: 20.6, z1: kerbNear - 0.2, y: Y.pavePuddle, count: Math.round((extent + 11) / 7), rMin: 0.35, rMax: 0.85, avoid: lobbyMat })
  // Road puddles keep out from under the parked cars (4.5 m by 1.8 m); a blob reaches about 2r along x
  // and 0.8r across. A turned blob can reach 0.27r past its band, so the band keeps every rim under a kerb.
  const parkZ = (laneFar + parkFar) / 2
  const underCar = (x, z, r) => Math.abs(z - parkZ) < 0.95 + r * 0.82 && near(x, parkedAt, 2.3 + r * 2)
  puddles(p, 'road-puddles', { x0: cx - 34, x1: cx + 34, z0: roadNear + 0.6, z1: parkFar - 0.3, y: Y.roadPuddle, count: 16, rMin: 0.5, rMax: 1.7, avoid: underCar })
  puddles(p, 'far-puddles', { x0: cx - 30, x1: cx + 30, z0: pave + 0.3, z1: zf - 0.5, y: Y.plazaPuddle, count: 7, rMin: 0.4, rMax: 1.0 })
  puddles(p, 'west-puddles', { x0: -13, x1: -6.4, z0: -3.5, z1: 22, y: Y.plazaPuddle, count: 4, rMin: 0.4, rMax: 0.9 })
  puddles(p, 'east-puddles', { x0: extent + 6.4, x1: extent + 13, z0: -3.5, z1: 22, y: Y.plazaPuddle, count: 4, rMin: 0.4, rMax: 0.9 })
  puddles(p, 'back-puddles', { x0: -4, x1: extent + 4, z0: -4.4, z1: -1.2, y: Y.plazaPuddle, count: Math.round((extent + 8) / 12), rMin: 0.35, rMax: 0.8 })

  // ---- Vents breathing steam: on the road, by the stop, and in the side plazas.
  // A puff can drift 0.45 m and grow to 2.2 m across, leaning north as the camera looks down, so a vent in
  // front of the office keeps to the far lane (z over 26.6) and its steam stays out of the clear zone.
  vent(p, cx - 9, street + 1.5, Y.road, '#8f97b8')
  vent(p, cx + 7, street + 1.7, Y.road, '#a79bc4')
  vent(p, -12, street - 1.0, Y.road, '#8f97b8')
  vent(p, extent + 14, street + 0.8, Y.road, '#9aa6c8')
  vent(p, kx - 7.5, pave + 1.1, Y.plaza, '#b49a8a')
  vent(p, -9.9, 4.0, Y.plaza, '#8f9fc4')

  // ---- The lobby's magenta sign and door posts (office.js) shine on the wet pavement in front.
  p.glows.streak(lobbyX, OUTSIDE.z0 + 0.2, 2.5, 3.0, NEON.magenta, 0.35)
  for (const px of [COLUMNS[0].x0 + 1.4, COLUMNS[0].x0 + 7.6]) p.glows.streak(px, OUTSIDE.z0 + 0.15, 1.6, 0.18, NEON.magenta, 0.3, 0.8)
  p.glows.pool(lobbyX, OUTSIDE.z0 + 1.6, 2.4, 1.1, NEON.magenta, 0.08)
  p.glows.spot(lobbyX, 2.5, OUTSIDE.z0 + 0.4, NEON.magenta, 2.5)

  // ---- Far beyond the shops: low blocks of flats, lit window by window, never over 6 m.
  const district = stream('district')
  const tints = ['#151923', '#1a1722', '#121820', '#191a1f']
  for (let row = 0; row < 3; row += 1) {
    const z = zf + 14 + row * 14
    for (let x = cx - 110; x < cx + 110; ) {
      const w = 9 + district() * 9
      const d = 8 + district() * 4
      const h = 3 + district() * (row === 0 ? 2 : 2.8)
      const geometry = new THREE.BoxGeometry(w, h - Y.plaza, d)
      scaleBoxUv(geometry, w, h, d)
      p.batches.blocks.add(geometry, at(x + w / 2, (h + Y.plaza) / 2, z + d / 2), tints[Math.floor(district() * tints.length)])
      if (district() < 0.35) glow.box(w, 0.14, 0.14, pickColor(district), x + w / 2, h + 0.07, z + 0.07, { k: 1.5, white: 0.25 })
      if (district() < 0.25) {
        glow.box(0.2, 0.2, 0.2, NEON.red, x + 0.4, h + 0.1, z + 0.4, { k: 2, white: 0.3 })
        p.glows.halo(x + 0.4, h + 0.15, z + 0.4, 0.6, NEON.red, 0.25)
      }
      x += w + 3 + district() * 4
    }
  }

  // ---- Materials and meshes.
  const matteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.08 })
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.62 })
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  const signMat = new THREE.MeshBasicMaterial({ map: cells.texture, vertexColors: true, toneMapped: false })
  const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#8fc8e8', transparent: true, opacity: 0.14, roughness: 0.06, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true })
  // A faint blue-violet sheen: the night sky lying in the water, so puddles never read as holes.
  const puddleMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#3a4456', roughness: 0.05, metalness: 0.7, emissive: '#0b0f26', emissiveIntensity: 1 })
  const windowsTex = windowGridTexture(renderer)
  const blockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2, emissive: '#ffffff', emissiveMap: windowsTex, emissiveIntensity: 1 })
  const timetableTex = timetableTexture(renderer)
  const screenMat = new THREE.MeshBasicMaterial({ map: timetableTex, toneMapped: false, color: new THREE.Color(1.1, 1.1, 1.1) })
  owned.textures.push(windowsTex, timetableTex)

  const screenBatch = new Batch()
  for (const m of p.screens) screenBatch.add(new THREE.PlaneGeometry(0.95, 1.4), m)
  const canopyMat = canopyMaterial()
  const canopy = instanced(new THREE.IcosahedronGeometry(1, 1), canopyMat, p.pads, (it, m, c) => {
    m.compose(new THREE.Vector3(it.x, it.y, it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry), new THREE.Vector3(it.sx, it.sy, it.sz))
    c.set(it.color)
  }, 'street:leaves')
  if (canopy) canopy.frustumCulled = true
  canopy?.computeBoundingSphere()

  const meshes = [
    plaza,
    road,
    water,
    shine,
    p.batches.matte.mesh(matteMat, 'street:stone'),
    p.batches.metal.mesh(metalMat, 'street:metal'),
    p.batches.glow.mesh(glowMat, 'street:neon'),
    p.batches.signs.mesh(signMat, 'street:signs'),
    p.batches.glass.mesh(glassMat, 'street:glass'),
    p.batches.puddles.mesh(puddleMat, 'street:puddles'),
    p.batches.blocks.mesh(blockMat, 'street:district'),
    screenBatch.mesh(screenMat, 'street:departures'),
    canopy,
    ...glowMeshes(p.glows, uTime, mask),
  ].filter(Boolean)
  for (const mesh of meshes) {
    mesh.castShadow = false
    if (mesh.material.isMeshStandardMaterial) mesh.receiveShadow = true
    group.add(mesh)
  }
  owned.materials.push(plazaMat, roadMat, waterMat, matteMat, metalMat, glowMat, signMat, glassMat, puddleMat, blockMat, screenMat, canopyMat)
  for (const mesh of meshes) if (!owned.materials.includes(mesh.material)) owned.materials.push(mesh.material)

  // The wet surfaces take the city's reflection from the integrator.
  wet.push(plazaMat, roadMat, puddleMat, waterMat)

  // ---- Real lights: the shelter, and the shop facing the middle of the office. Never shadow casting.
  if (ctx.claimLight?.()) {
    const light = new THREE.PointLight('#bfe6ff', 9, 13, 2)
    light.position.set(kx, 2.5, kz0 + 1.4)
    light.castShadow = false
    light.name = 'street:stop-light'
    group.add(light)
  }
  const middle = shops.reduce((best, s) => (Math.abs(s.cx - cx) < Math.abs(best.cx - cx) ? s : best), shops[0])
  if (middle && ctx.claimLight?.()) {
    const light = new THREE.PointLight(tone(middle.color, 1, 0.35), 7, 11, 2)
    light.position.set(middle.cx, 3.0, zf - 1.6)
    light.castShadow = false
    light.name = 'street:shop-light'
    group.add(light)
  }

  return {
    /** Moves the light shapes on and scrolls the departures list. No canvas is redrawn. */
    update(dt, t) {
      uTime.value = t
      timetableTex.offset.y = 1 - ((t * 0.025) % 1)
    },

    /** Frees what the street made; the caller removes the group. */
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose()
      for (const material of owned.materials) material.dispose()
      for (const texture of owned.textures) texture.dispose()
    },
  }
}
