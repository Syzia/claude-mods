// Furniture, built from rounded boxes and cylinders in a toy-like style.
// Each kind has a footprint (cells it blocks) and spots: where a person
// sits, stands or plays, with the activity that spot is for.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { hash, pick } from './util.js'

const materials = new Map()

/** One shared material per colour and finish. */
export function mat(color, { emissive = null, rough = 0.78, metal = 0, opacity = 1 } = {}) {
  const key = `${color}|${emissive}|${rough}|${metal}|${opacity}`
  if (!materials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
    if (emissive) {
      m.emissive = new THREE.Color(emissive)
      m.emissiveIntensity = 0.9
    }
    if (opacity < 1) {
      m.transparent = true
      m.opacity = opacity
    }
    materials.set(key, m)
  }
  return materials.get(key)
}

const geometries = new Map()
function shared(key, make) {
  if (!geometries.has(key)) geometries.set(key, make())
  return geometries.get(key)
}

export function rbox(w, h, d, color, r = 0.035, options) {
  const radius = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)
  const geometry = shared(`rb${w}|${h}|${d}|${radius}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, radius)))
  const mesh = new THREE.Mesh(geometry, typeof color === 'string' ? mat(color, options) : color)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function box(w, h, d, color, options) {
  const geometry = shared(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d))
  const mesh = new THREE.Mesh(geometry, typeof color === 'string' ? mat(color, options) : color)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function cyl(rTop, rBottom, h, color, segments = 16, options) {
  const geometry = shared(`c${rTop}|${rBottom}|${h}|${segments}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, segments))
  const mesh = new THREE.Mesh(geometry, typeof color === 'string' ? mat(color, options) : color)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function ball(r, color, options, segments = 16) {
  const geometry = shared(`s${r}|${segments}`, () => new THREE.SphereGeometry(r, segments, Math.max(8, segments * 0.75)))
  const mesh = new THREE.Mesh(geometry, typeof color === 'string' ? mat(color, options) : color)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** Adds `mesh` to `group` at (x, y, z) and returns it. */
export function put(group, mesh, x, y, z) {
  mesh.position.set(x, y, z)
  group.add(mesh)
  return mesh
}

/** A plane showing a canvas drawing (signs, screens, charts). */
export function canvasPlane(width, height, draw, { px = 256, emissive = false } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = Math.round((px * height) / width)
  draw(canvas.getContext('2d'), canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const material = emissive
    ? new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    : new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  mesh.userData.canvas = canvas
  mesh.userData.texture = texture
  return mesh
}

const DARK_WOOD = '#2a2f3a'
const METAL = '#3a404c'
const WHITE = '#2a2f3a'
const CYAN = '#2bf3ff'
const MAGENTA = '#ff2bd6'
/** A thin glowing strip, the office's signature trim. */
function glow(group, w, h, d, x, y, z, color = CYAN) {
  return put(group, box(w, h, d, color, { emissive: color }), x, y, z)
}

function chair(group, z, color, { exec = false } = {}) {
  const seat = put(group, rbox(0.5, 0.09, 0.48, color, 0.04), 0, 0.46, z)
  put(group, rbox(0.48, exec ? 0.72 : 0.5, 0.08, color, 0.04), 0, exec ? 0.9 : 0.78, z + 0.24)
  put(group, cyl(0.035, 0.035, 0.36, '#555b66'), 0, 0.24, z)
  put(group, cyl(0.26, 0.26, 0.04, '#3d424b', 5), 0, 0.05, z)
  return seat
}

function monitor(group, x, z, screens) {
  put(group, box(0.05, 0.16, 0.05, '#3d424b'), x, 0.84, z)
  put(group, box(0.22, 0.02, 0.14, '#3d424b'), x, 0.76, z)
  put(group, rbox(0.62, 0.38, 0.04, '#23262d', 0.02), x, 1.08, z - 0.01)
  const screen = new THREE.Mesh(
    shared('screen', () => new THREE.PlaneGeometry(0.56, 0.32)),
    new THREE.MeshBasicMaterial({ color: '#111318', toneMapped: false }),
  )
  screen.position.set(x, 1.08, z + 0.012)
  group.add(screen)
  screens.push(screen)
}

/** The kinds of furniture: footprint [w, d], what it costs to place, and how to build it. */
export const FURNITURE = {
  desk: {
    size: [1.4, 0.7],
    spots: [
      { x: 0, z: 0.62, face: Math.PI, pose: 'sit', act: 'work', approach: [0, 1.2], seatY: 0.5 },
      { x: 0, z: 1.25, face: Math.PI, pose: 'stand', act: 'visit', approach: [0, 1.25] },
    ],
    build(group, { seed, accent }) {
      const screens = []
      put(group, rbox(1.4, 0.05, 0.7, WHITE, 0.02), 0, 0.74, 0)
      put(group, box(0.05, 0.72, 0.62, METAL), -0.66, 0.36, 0)
      put(group, box(0.05, 0.72, 0.62, METAL), 0.66, 0.36, 0)
      put(group, box(1.28, 0.32, 0.03, '#1f232c'), 0, 0.56, -0.32)
      glow(group, 1.38, 0.018, 0.02, 0, 0.745, 0.355)
      monitor(group, 0, -0.2, screens)
      put(group, rbox(0.44, 0.025, 0.15, '#3a404c', 0.01), 0, 0.775, 0.1)
      put(group, rbox(0.06, 0.025, 0.09, '#3a404c', 0.01), 0.32, 0.775, 0.12)
      if (seed % 3 === 0) put(group, cyl(0.04, 0.035, 0.1, pick(['#f2c14e', '#e86f6f', '#6fb3e8', WHITE], seed >> 4)), -0.5, 0.82, 0.05)
      if (seed % 3 === 1) plantPot(group, -0.52, 0.765, -0.15, 0.35)
      chair(group, 0.62, accent ?? '#4a4f5c')
      group.userData.screens = screens
    },
  },
  managerDesk: {
    size: [1.8, 0.8],
    spots: [
      { x: 0, z: 0.72, face: Math.PI, pose: 'sit', act: 'manage', approach: [0, 1.35], seatY: 0.5 },
      { x: 0, z: -1.0, face: 0, pose: 'stand', act: 'report', approach: [0, -1.0] },
      { x: 0.75, z: -1.05, face: -0.3, pose: 'stand', act: 'report', approach: [0.75, -1.05] },
    ],
    build(group) {
      const screens = []
      put(group, rbox(1.8, 0.07, 0.8, DARK_WOOD, 0.03), 0, 0.75, 0)
      put(group, rbox(1.7, 0.66, 0.06, '#1f232c', 0.02), 0, 0.38, -0.36)
      put(group, rbox(0.4, 0.66, 0.7, '#1f232c', 0.02), -0.68, 0.38, 0)
      put(group, rbox(0.4, 0.66, 0.7, '#1f232c', 0.02), 0.68, 0.38, 0)
      glow(group, 1.76, 0.025, 0.02, 0, 0.71, -0.4, MAGENTA)
      monitor(group, -0.36, -0.2, screens)
      monitor(group, 0.36, -0.2, screens)
      put(group, rbox(0.44, 0.025, 0.15, '#3a404c', 0.01), 0, 0.8, 0.12)
      put(group, cyl(0.045, 0.04, 0.11, '#e0e6f0'), 0.72, 0.84, 0.1)
      const plate = put(group, rbox(0.36, 0.08, 0.04, '#d8b24a', 0.01, { metal: 0.6, rough: 0.35 }), 0, 0.82, -0.38)
      plate.rotation.x = -0.3
      chair(group, 0.72, '#3a1f2e', { exec: true })
      group.userData.screens = screens
    },
  },
  bookshelf: {
    size: [1.6, 0.4],
    spots: [{ x: 0, z: 0.85, face: Math.PI, pose: 'stand', act: 'read' }],
    build(group, { seed }) {
      put(group, rbox(1.6, 1.9, 0.4, '#1f232c', 0.02), 0, 0.95, 0)
      put(group, box(1.5, 1.8, 0.02, '#151820'), 0, 0.95, 0.19)
      glow(group, 1.56, 0.02, 0.02, 0, 1.88, 0.21, '#7b5cff')
      for (let s = 0; s < 4; s += 1) {
        const y = 0.12 + s * 0.45
        put(group, box(1.5, 0.03, 0.36, '#2a2f3a'), 0, y, 0.02)
        let x = -0.68
        let n = seed + s * 7
        while (x < 0.62) {
          n = (n * 1103515245 + 12345) >>> 0
          const w = 0.05 + (n % 5) * 0.015
          const h = 0.24 + ((n >> 5) % 6) * 0.025
          put(group, box(w, h, 0.26, pick(['#b8326f', '#2a8fb8', '#b88a2a', '#2ab89a', '#6a4ab8', '#c8ced8', '#b83a4a'], n >> 9)), x + w / 2, y + 0.015 + h / 2, 0.04)
          x += w + 0.012
        }
      }
    },
  },
  rug: {
    size: [0, 0],
    walkOver: true,
    build(group, { seed, scale = 1 }) {
      const color = pick(['#7a1f5c', '#1f5c7a', '#4a2a7a', '#7a4a1f'], seed)
      // Each layer clearly above the last, so they never flicker against each other from afar.
      put(group, rbox(3 * scale, 0.02, 2 * scale, color, 0.009), 0, 0.012, 0)
      put(group, rbox(2.6 * scale, 0.02, 1.6 * scale, '#14161c', 0.009), 0, 0.027, 0)
      put(group, rbox(2.2 * scale, 0.02, 1.2 * scale, color, 0.009), 0, 0.042, 0)
    },
  },
  plant: {
    size: [0.5, 0.5],
    build(group, { seed }) {
      plantPot(group, 0, 0, 0, 1, seed)
    },
  },
  whiteboard: {
    size: [1.6, 0.2],
    spots: [
      { x: -0.45, z: 0.85, face: Math.PI - 0.2, pose: 'stand', act: 'brainstorm' },
      { x: 0.45, z: 0.85, face: Math.PI + 0.2, pose: 'stand', act: 'brainstorm' },
    ],
    build(group) {
      put(group, rbox(1.6, 1.05, 0.05, '#2a2f3a', 0.02), 0, 1.35, 0)
      const board = canvasPlane(1.5, 0.95, (g, w, h) => {
        g.fillStyle = '#081420'
        g.fillRect(0, 0, w, h)
        g.lineWidth = 3
        const colors = ['#ff2bd6', '#2bf3ff', '#3bff9d', '#ffb02b']
        for (let i = 0; i < 7; i += 1) {
          g.strokeStyle = colors[i % colors.length]
          g.beginPath()
          const y = 20 + i * 22
          g.moveTo(14, y)
          for (let x = 14; x < w * (0.4 + (i % 3) * 0.2); x += 12) g.lineTo(x, y + Math.sin(x * 0.2 + i) * 3)
          g.stroke()
        }
        g.strokeStyle = '#2bf3ff'
        g.strokeRect(w * 0.65, 20, w * 0.28, h * 0.45)
      }, { emissive: true })
      put(group, board, 0, 1.35, 0.03)
      put(group, box(0.04, 0.85, 0.04, METAL), -0.7, 0.42, 0.05)
      put(group, box(0.04, 0.85, 0.04, METAL), 0.7, 0.42, 0.05)
    },
  },
  reception: {
    size: [1.8, 0.7],
    spots: [{ x: 0, z: 0.6, face: Math.PI, pose: 'sit', act: 'reception', approach: [0, 1.1], seatY: 0.5 }],
    build(group) {
      const screens = []
      put(group, rbox(1.8, 1.05, 0.25, '#14303a', 0.05), 0, 0.53, -0.25)
      put(group, rbox(1.9, 0.06, 0.4, '#2a2f3a', 0.02), 0, 1.08, -0.22)
      glow(group, 1.86, 0.03, 0.03, 0, 1.11, -0.43)
      glow(group, 1.7, 0.03, 0.03, 0, 0.05, -0.39)
      put(group, rbox(1.8, 0.05, 0.7, WHITE, 0.02), 0, 0.74, 0)
      monitor(group, 0.3, -0.05, screens)
      put(group, ball(0.06, '#d8b24a', { metal: 0.7, rough: 0.3 }), -0.5, 1.13, -0.22)
      chair(group, 0.6, '#14303a')
      const sign = canvasPlane(1.2, 0.25, (g, w, h) => {
        g.fillStyle = '#0a1418'
        g.fillRect(0, 0, w, h)
        g.shadowColor = '#2bf3ff'
        g.shadowBlur = 14
        g.fillStyle = '#2bf3ff'
        g.font = `bold ${h * 0.6}px ui-rounded, system-ui, sans-serif`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('WELCOME', w / 2, h / 2)
      }, { emissive: true })
      sign.rotation.y = Math.PI
      put(group, sign, 0, 0.65, -0.38)
      group.userData.screens = screens
    },
  },
  styleShop: {
    size: [1.4, 0.5],
    spots: [{ x: 0, z: 0.95, face: Math.PI, pose: 'stand', act: 'shop' }],
    build(group) {
      put(group, cyl(0.025, 0.025, 1.6, METAL), -0.65, 0.8, 0)
      put(group, cyl(0.025, 0.025, 1.6, METAL), 0.65, 0.8, 0)
      const rod = put(group, cyl(0.02, 0.02, 1.32, METAL), 0, 1.55, 0)
      rod.rotation.z = Math.PI / 2
      const colors = ['#ff2bd6', '#ffb02b', '#2b6bff', '#2bf3ff', '#7b5cff', '#e0e6f0', '#1c1f26']
      colors.forEach((c, i) => {
        const shirt = put(group, rbox(0.14, 0.42, 0.34, c, 0.03), -0.5 + i * 0.165, 1.28, 0)
        shirt.rotation.y = 0.15
      })
      put(group, rbox(1.4, 0.08, 0.5, '#1f232c', 0.02), 0, 0.04, 0)
      glow(group, 1.36, 0.02, 0.02, 0, 0.09, 0.26, MAGENTA)
      const sign = canvasPlane(1.0, 0.28, (g, w, h) => {
        g.fillStyle = '#14060f'
        g.beginPath()
        g.roundRect(0, 0, w, h, 18)
        g.fill()
        g.shadowColor = '#ff2bd6'
        g.shadowBlur = 16
        g.fillStyle = '#ff7ae6'
        g.font = `bold ${h * 0.55}px ui-rounded, system-ui, sans-serif`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('✨ STYLE SHOP', w / 2, h / 2)
      }, { emissive: true })
      put(group, sign, 0, 1.92, 0.02)
      const mirror = put(group, rbox(0.5, 1.1, 0.04, '#cfe7f5', 0.02, { metal: 0.6, rough: 0.1 }), 0.95, 0.75, 0.1)
      mirror.rotation.y = -0.5
    },
  },
  couch: {
    size: [2.0, 0.85],
    spots: [-0.62, 0, 0.62].map(x => ({ x, z: 0.08, face: 0, pose: 'sit', act: 'couch', approach: [x, 0.95], seatY: 0.42 })),
    build(group, { seed }) {
      const color = pick(['#3b2a5c', '#1f3a4a', '#4a1f3a', '#1f4a3a', '#2a2f4a'], seed)
      put(group, rbox(2.0, 0.3, 0.85, color, 0.08), 0, 0.2, 0)
      put(group, rbox(2.0, 0.55, 0.22, color, 0.09), 0, 0.55, -0.32)
      put(group, rbox(0.2, 0.5, 0.85, color, 0.08), -0.92, 0.42, 0)
      put(group, rbox(0.2, 0.5, 0.85, color, 0.08), 0.92, 0.42, 0)
      for (const x of [-0.42, 0.42]) put(group, rbox(0.8, 0.1, 0.6, shade(color), 0.05), x, 0.39, 0.06)
    },
  },
  beanbag: {
    size: [0.9, 0.9],
    spots: [{ x: 0, z: 0.05, face: 0, pose: 'sit', act: 'beanbag', approach: [0, 0.95], seatY: 0.3 }],
    build(group, { seed }) {
      const bag = put(group, ball(0.5, pick(['#7a1f5c', '#1f6a7a', '#6a4a1f', '#3a2a7a', '#7a2a3a'], seed), { rough: 0.95 }, 20), 0, 0.22, 0)
      bag.scale.set(1, 0.48, 1)
      const back = put(group, ball(0.36, bag.material, undefined, 16), 0, 0.42, -0.22)
      back.scale.set(1.1, 0.8, 0.7)
    },
  },
  coffee: {
    size: [1.6, 0.6],
    spots: [
      { x: -0.4, z: 0.85, face: Math.PI, pose: 'stand', act: 'coffee' },
      { x: 0.45, z: 0.85, face: Math.PI, pose: 'stand', act: 'coffee' },
    ],
    build(group) {
      put(group, rbox(1.6, 0.86, 0.6, '#1f232c', 0.03), 0, 0.43, 0)
      put(group, rbox(1.66, 0.05, 0.64, '#2a2f3a', 0.02), 0, 0.88, 0)
      glow(group, 1.6, 0.025, 0.025, 0, 0.04, 0.31, '#ffb02b')
      put(group, rbox(0.42, 0.5, 0.36, '#c0c6cc', 0.04, { metal: 0.6, rough: 0.35 }), -0.4, 1.16, -0.05)
      put(group, rbox(0.3, 0.12, 0.05, '#23262d', 0.02), -0.4, 1.3, 0.13)
      put(group, ball(0.025, '#ff5a5a', { emissive: '#ff3030' }), -0.3, 1.3, 0.16)
      for (let i = 0; i < 4; i += 1) put(group, cyl(0.04, 0.035, 0.09, pick(['#ffffff', '#f2c14e', '#e86f6f', '#6fb3e8'], i)), 0.2 + i * 0.12, 0.95, 0.05)
      put(group, rbox(0.3, 0.32, 0.3, '#3d424b', 0.03), 0.62, 1.07, -0.08)
    },
  },
  waterCooler: {
    size: [0.4, 0.4],
    spots: [
      { x: -0.45, z: 0.75, face: Math.PI * 0.75, pose: 'stand', act: 'chat' },
      { x: 0.45, z: 0.75, face: -Math.PI * 0.75, pose: 'stand', act: 'chat' },
    ],
    build(group) {
      put(group, rbox(0.38, 0.9, 0.38, '#2a2f3a', 0.04), 0, 0.45, 0)
      put(group, cyl(0.16, 0.16, 0.42, '#2bf3ff', 20, { opacity: 0.55, rough: 0.1, emissive: '#1a8fa8' }), 0, 1.12, 0)
      put(group, box(0.06, 0.04, 0.05, '#3f7fd8'), -0.07, 0.72, 0.2)
      put(group, box(0.06, 0.04, 0.05, '#d64545'), 0.07, 0.72, 0.2)
    },
  },
  pingpong: {
    size: [2.6, 1.4],
    spots: [
      { x: -1.75, z: 0, face: Math.PI / 2, pose: 'stand', act: 'pingpong' },
      { x: 1.75, z: 0, face: -Math.PI / 2, pose: 'stand', act: 'pingpong' },
    ],
    build(group) {
      put(group, rbox(2.6, 0.06, 1.4, '#0f2a3a', 0.02), 0, 0.76, 0)
      glow(group, 2.6, 0.004, 0.02, 0, 0.792, 0)
      glow(group, 0.02, 0.004, 1.4, 0, 0.792, 0)
      put(group, box(0.02, 0.16, 1.5, '#2bf3ff', { opacity: 0.35 }), 0, 0.86, 0)
      for (const x of [-1.1, 1.1]) for (const z of [-0.55, 0.55]) put(group, box(0.06, 0.74, 0.06, '#3d424b'), x, 0.37, z)
      const pong = put(group, ball(0.03, '#ff9d2e', undefined, 10), 0, 0.95, 0)
      pong.visible = false
      group.userData.ball = pong
    },
  },
  tv: {
    size: [2.2, 0.35],
    build(group) {
      put(group, rbox(1.8, 0.45, 0.35, '#3d424b', 0.03), 0, 0.23, 0)
      put(group, box(0.1, 0.5, 0.06, '#23262d'), 0, 0.7, -0.05)
      put(group, rbox(2.2, 1.25, 0.08, '#16181d', 0.03), 0, 1.45, -0.05)
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.08, 1.13), new THREE.MeshBasicMaterial({ color: '#3a6ea5', toneMapped: false }))
      screen.position.set(0, 1.45, -0.005)
      group.add(screen)
      group.userData.tv = screen
    },
  },
  arcade: {
    size: [0.75, 0.75],
    spots: [{ x: 0, z: 0.8, face: Math.PI, pose: 'stand', act: 'arcade' }],
    build(group, { seed }) {
      const color = pick(['#7a3bd2', '#d23b6f', '#2b7bd2', '#e08a2e'], seed)
      put(group, rbox(0.72, 1.75, 0.72, color, 0.05), 0, 0.88, -0.02)
      put(group, rbox(0.62, 0.2, 0.3, '#23262d', 0.03), 0, 1.0, 0.3)
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), new THREE.MeshBasicMaterial({ color: '#ffd75e', toneMapped: false }))
      screen.position.set(0, 1.38, 0.345)
      screen.rotation.x = -0.15
      group.add(screen)
      put(group, ball(0.035, '#ff5a5a'), -0.12, 1.12, 0.38)
      put(group, ball(0.03, '#5ab8ff'), 0.06, 1.12, 0.4)
      put(group, ball(0.03, '#5aff8a'), 0.15, 1.12, 0.4)
      put(group, box(0.6, 0.16, 0.02, '#ffd75e', { emissive: '#ffb800' }), 0, 1.68, 0.35)
      group.userData.tv = screen
    },
  },
  foosball: {
    size: [1.3, 0.8],
    spots: [
      { x: 0, z: -0.8, face: 0, pose: 'stand', act: 'foosball' },
      { x: 0, z: 0.8, face: Math.PI, pose: 'stand', act: 'foosball' },
    ],
    build(group) {
      put(group, rbox(1.3, 0.25, 0.75, '#1f232c', 0.03), 0, 0.82, 0)
      put(group, box(1.18, 0.01, 0.63, '#0f3a2a'), 0, 0.95, 0)
      glow(group, 1.3, 0.02, 0.02, 0, 0.7, 0.38, '#3bff9d')
      for (const x of [-0.45, -0.15, 0.15, 0.45]) {
        const rod = put(group, cyl(0.012, 0.012, 1.1, METAL), x, 1.0, 0)
        rod.rotation.x = Math.PI / 2
        for (const z of [-0.15, 0.15]) put(group, box(0.04, 0.12, 0.04, x < 0 ? '#d64545' : '#3f7fd8'), x, 0.96, z)
      }
      for (const x of [-0.55, 0.55]) put(group, box(0.08, 0.7, 0.6, '#2a2f3a'), x, 0.35, 0)
    },
  },
  treadmill: {
    size: [0.8, 1.8],
    spots: [{ x: 0, z: 0.15, face: Math.PI, pose: 'run', act: 'run', approach: [0, 1.3] }],
    build(group) {
      put(group, rbox(0.8, 0.14, 1.8, '#3d424b', 0.04), 0, 0.07, 0)
      put(group, box(0.6, 0.02, 1.6, '#23262d'), 0, 0.15, 0.05)
      for (const x of [-0.36, 0.36]) put(group, box(0.05, 1.1, 0.05, METAL), x, 0.62, -0.78)
      put(group, rbox(0.8, 0.3, 0.12, '#5b6b7c', 0.03), 0, 1.2, -0.78)
      put(group, box(0.3, 0.12, 0.02, '#5aff8a', { emissive: '#30d060' }), 0, 1.24, -0.71)
    },
  },
  vending: {
    size: [0.95, 0.75],
    spots: [{ x: 0, z: 0.85, face: Math.PI, pose: 'stand', act: 'snack' }],
    build(group) {
      put(group, rbox(0.95, 1.9, 0.75, '#1f232c', 0.04), 0, 0.95, 0)
      glow(group, 0.04, 1.8, 0.04, 0.46, 0.95, 0.36, MAGENTA)
      put(group, box(0.6, 1.3, 0.02, '#cfe7f5', { opacity: 0.7, rough: 0.1 }), -0.1, 1.15, 0.38)
      for (let r = 0; r < 5; r += 1) for (let c = 0; c < 4; c += 1) put(group, box(0.1, 0.12, 0.1, pick(['#f2c14e', '#3f7fd8', '#21a39a', '#ff9d2e', '#8a5fd6'], r * 4 + c)), -0.32 + c * 0.15, 0.62 + r * 0.24, 0.25)
      put(group, box(0.18, 0.4, 0.02, '#23262d'), 0.33, 1.25, 0.38)
    },
  },
  meetingTable: {
    size: [3.0, 1.2],
    spots: [
      ...[-0.95, 0, 0.95].map(x => ({ x, z: -0.95, face: 0, pose: 'sit', act: 'meet', approach: [x, -1.5], seatY: 0.5 })),
      ...[-0.95, 0, 0.95].map(x => ({ x, z: 0.95, face: Math.PI, pose: 'sit', act: 'meet', approach: [x, 1.5], seatY: 0.5 })),
    ],
    build(group) {
      put(group, rbox(3.0, 0.07, 1.2, '#1a1d24', 0.05, { metal: 0.6, rough: 0.25 }), 0, 0.75, 0)
      glow(group, 2.9, 0.015, 0.02, 0, 0.72, 0.6)
      glow(group, 2.9, 0.015, 0.02, 0, 0.72, -0.6)
      put(group, box(0.18, 0.72, 0.6, '#2a2f3a'), -1.0, 0.36, 0)
      put(group, box(0.18, 0.72, 0.6, '#2a2f3a'), 1.0, 0.36, 0)
      for (const x of [-0.95, 0, 0.95]) {
        const a = new THREE.Group()
        chair(a, 0, '#3d424b')
        a.position.set(x, 0, -0.95)
        a.rotation.y = Math.PI
        group.add(a)
        const b = new THREE.Group()
        chair(b, 0, '#3d424b')
        b.position.set(x, 0, 0.95)
        group.add(b)
      }
    },
  },
  screenWall: {
    size: [3.0, 0.3],
    build(group, { seed }) {
      put(group, rbox(3.0, 1.5, 0.1, '#16181d', 0.03), 0, 1.45, 0)
      const chart = canvasPlane(2.86, 1.36, (g, w, h) => {
        g.fillStyle = '#0f1d2e'
        g.fillRect(0, 0, w, h)
        g.strokeStyle = '#21a39a'
        g.lineWidth = 3
        g.beginPath()
        let y = h * 0.7
        for (let x = 10; x < w * 0.55; x += 8) {
          y = Math.min(h - 10, Math.max(10, y + Math.sin(x * 0.07 + seed) * 6 - 1.2))
          g.lineTo(x, y)
        }
        g.stroke()
        const bars = ['#3f7fd8', '#e4862a', '#8a5fd6', '#3faa5c', '#d64545']
        bars.forEach((c, i) => {
          g.fillStyle = c
          const bh = h * (0.2 + ((seed >> i) % 5) * 0.1)
          g.fillRect(w * 0.62 + i * 26, h - 12 - bh, 18, bh)
        })
      }, { px: 512, emissive: true })
      put(group, chart, 0, 1.45, 0.055)
      put(group, box(0.1, 0.7, 0.1, '#23262d'), -1.1, 0.35, 0)
      put(group, box(0.1, 0.7, 0.1, '#23262d'), 1.1, 0.35, 0)
    },
  },
  partyTable: {
    size: [1.6, 1.6],
    spots: Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2
      return { x: Math.sin(a) * 1.3, z: Math.cos(a) * 1.3, face: a + Math.PI, pose: 'stand', act: 'party' }
    }),
    build(group) {
      put(group, cyl(0.82, 0.82, 0.02, '#e05a6a', 28), 0, 0.735, 0)
      put(group, cyl(0.8, 0.8, 0.05, '#f4f1ea', 28), 0, 0.76, 0)
      put(group, cyl(0.07, 0.11, 0.72, '#9aa3ad', 12), 0, 0.37, 0)
      put(group, cyl(0.35, 0.35, 0.03, '#9aa3ad', 16), 0, 0.02, 0)
      for (const [x, z, turn] of [
        [-0.28, -0.12, 0.25],
        [0.3, 0.16, -0.35],
      ]) {
        const pizzaBox = new THREE.Group()
        pizzaBox.position.set(x, 0.8, z)
        pizzaBox.rotation.y = turn
        put(pizzaBox, rbox(0.5, 0.04, 0.5, '#d9b27c', 0.01), 0, 0.01, 0)
        const lid = put(pizzaBox, rbox(0.5, 0.02, 0.5, '#d9b27c', 0.01), 0, 0.2, -0.33)
        lid.rotation.x = -1.25
        put(pizzaBox, cyl(0.21, 0.21, 0.025, '#e2a14a', 24), 0, 0.04, 0)
        put(pizzaBox, cyl(0.185, 0.185, 0.03, '#f6c445', 24), 0, 0.046, 0)
        for (let i = 0; i < 7; i += 1) {
          const a = (i / 7) * Math.PI * 2
          put(pizzaBox, cyl(0.028, 0.028, 0.034, '#b5302a', 10), Math.cos(a) * 0.11, 0.052, Math.sin(a) * 0.11)
        }
        group.add(pizzaBox)
      }
      for (const [x, z, c] of [
        [0.5, -0.42, '#3f7fd8'],
        [-0.55, 0.36, '#3faa5c'],
        [0.08, 0.58, '#f2c14e'],
        [-0.15, -0.6, '#e05a6a'],
      ]) put(group, cyl(0.045, 0.035, 0.12, c, 10), x, 0.85, z)
      const balloons = []
      ;[
        ['#e05a6a', -0.55, 0.15],
        ['#3f7fd8', 0.45, -0.45],
        ['#f2c14e', 0.15, 0.55],
        ['#8a5fd6', -0.15, -0.55],
        ['#3faa5c', 0.6, 0.35],
      ].forEach(([c, x, z], i) => {
        const y = 2.35 + (i % 3) * 0.14
        const b = put(group, ball(0.18, c, { rough: 0.3 }, 16), x, y, z)
        b.scale.set(1, 1.2, 1)
        b.userData.baseY = y
        put(group, cyl(0.004, 0.004, y - 0.95, '#ffffff', 4), x, (y + 0.78) / 2, z)
        balloons.push(b)
      })
      group.userData.balloons = balloons
    },
  },
  aquarium: {
    size: [1.6, 0.55],
    spots: [{ x: 0, z: 0.85, face: Math.PI, pose: 'stand', act: 'fish' }],
    build(group) {
      put(group, rbox(1.6, 0.7, 0.55, '#3d424b', 0.03), 0, 0.35, 0)
      put(group, box(1.5, 0.8, 0.45, '#5ec4f0', { opacity: 0.45, rough: 0.05 }), 0, 1.12, 0)
      put(group, box(1.5, 0.12, 0.45, '#e6d3a3'), 0, 0.78, 0)
      const fish = []
      for (let i = 0; i < 5; i += 1) {
        const f = put(group, rbox(0.12, 0.07, 0.03, pick(['#ff9d2e', '#ffd75e', '#e05a6a', '#5ab8ff'], i), 0.02), 0, 1.0 + i * 0.1, 0)
        fish.push(f)
      }
      plantPot(group, -0.5, 0.84, 0.05, 0.4)
      group.userData.fish = fish
    },
  },
}

function plantPot(group, x, y, z, scale = 1, seed = 1) {
  const s = scale
  put(group, cyl(0.2 * s, 0.15 * s, 0.36 * s, pick(['#1f232c', '#2a2f3a', '#14303a'], seed)), x, y + 0.18 * s, z)
  put(group, cyl(0.205 * s, 0.205 * s, 0.02 * s, '#2bf3ff', 16, { emissive: '#2bf3ff' }), x, y + 0.34 * s, z)
  const leaf = pick(['#2f7a5a', '#226a4f', '#3a8a6a'], seed >> 3)
  const crown = put(group, ball(0.32 * s, leaf, { rough: 0.9 }, 12), x, y + 0.62 * s, z)
  crown.scale.set(1, 1.15, 1)
  put(group, ball(0.2 * s, shade(leaf, 1.12), { rough: 0.9 }, 10), x + 0.14 * s, y + 0.82 * s, z + 0.06 * s)
  put(group, ball(0.18 * s, shade(leaf, 0.9), { rough: 0.9 }, 10), x - 0.15 * s, y + 0.76 * s, z - 0.05 * s)
}

export function shade(hex, factor = 0.82) {
  const c = new THREE.Color(hex)
  c.multiplyScalar(factor)
  return `#${c.getHexString()}`
}

/** Builds one piece: a group placed and turned in the world, with its spots in world coordinates. */
export function buildFurniture(item, accent) {
  const kind = FURNITURE[item.type]
  const group = new THREE.Group()
  const seed = hash(item.id ?? `${item.type}${item.x}${item.z}`)
  kind.build(group, { seed, accent, scale: item.scale })
  const yaw = (item.rot ?? 0) * (Math.PI / 2)
  group.position.set(item.x, 0, item.z)
  group.rotation.y = yaw
  group.traverse(o => {
    o.userData.furnitureId = item.id
  })
  const spots = (kind.spots ?? []).map((spot, i) => {
    const at = toWorld(item.x, item.z, yaw, spot.x, spot.z)
    const approach = spot.approach ? toWorld(item.x, item.z, yaw, spot.approach[0], spot.approach[1]) : at
    return {
      key: `${item.id}#${i}`,
      furnitureId: item.id,
      type: item.type,
      index: i,
      act: spot.act,
      pose: spot.pose,
      seatY: spot.seatY ?? 0,
      x: at.x,
      z: at.z,
      approach,
      face: yaw + spot.face,
      pod: item.pod ?? null,
      room: item.room,
    }
  })
  return { ...item, group, spots, kind }
}

export function toWorld(x, z, yaw, lx, lz) {
  return { x: x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: z - lx * Math.sin(yaw) + lz * Math.cos(yaw) }
}
