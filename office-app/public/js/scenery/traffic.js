// Traffic in the air and on the road. Flying cars drop out of the sky along the street, slip up the
// narrow gaps beside the office, run the canyon behind it and climb away again; more weave through the
// corridors between the tower bands. Each throws a long soft headlight beam, drags a short light trail
// and breathes its navigation lights. Far off, streams of sky traffic give the city its scale, and on
// the wet street a few cars cruise both ways, pooling light on the road ahead of them and lighting
// the rain in front of their headlights (one ctx.lightSpots entry each, moved every frame). Everything
// is instanced (eleven draw calls in all) and nothing here is a real light.
//
// Integration: the flying lanes and the far streams steer round the towers and signs the earlier
// modules built, found by scanning their meshes once at build time. So either pass those groups as
// ctx.sceneryRoots (an array of Object3D; they may still be detached from the scene), or add the
// skyline, billboards and street groups to ctx.scene, visible, BEFORE buildTraffic runs. If the scan
// finds no tower taller than 20 m north of the office, buildTraffic warns in the console.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp, hash } from '../util.js'

// ------------------------------------------------------------------ rules

/** The view of the office, x from -6 to extent + 6: nothing of ours may stand or fly in here. */
const CLEAR = { x0: -6, pad: 6, z0: -4, z1: 24 }
/** Across the road everything stays low, so nothing flies, shines or trails south of this. */
const NO_FLY_SOUTH = 29.5
/** Flying traffic never drops below this nor climbs past this (the brief's band, 12 to 70 m), even to clear a tower. */
const SKY_LOW = 12
const SKY_HIGH = 70
/** How far a flying car (with its underglow) reaches along and across its heading. */
const REACH_ALONG = 3.6
const REACH_ACROSS = 1.75
/** Half the width of the car's solid body (hull and thruster pods). */
const BODY_ACROSS = 1.5
/** Points around (and inside) the car's body as [across, along]: none may touch a tower. */
const BODY_OUTLINE = [
  [0, 2.62], [-0.86, 2.05], [0.86, 2.05], [-1.08, 0.9], [1.08, 0.9], [-1.42, -0.2], [1.42, -0.2],
  [-1.42, -1.3], [1.42, -1.3], [-1.42, -2.5], [1.42, -2.5], [-1.15, -2.2], [1.15, -2.2], [0, -2.45], [0, 0], [0, 1.4], [0, -1.2],
]
/** Headlight beams: longest length, how wide they open per metre, where they start on the nose. */
const BEAM_LENGTH = 15
const BEAM_SPREAD = 0.16
const NOSE = 2.62
/** Light trails start at the tail and grow with speed up to this length. */
const TAIL = 2.47
const TRAIL_LENGTH = 12
/** Samples along each flying lane (under a metre apart near the office). */
const SAMPLES = 1024
/** Flying cars climb to an obstacle and dive after it at this slope (about 39 degrees), clearing its top by this much. */
const CLIMB = 0.8
const HEADROOM = 4
/** The height map's cell size, in metres, and the coarser one the far streams use over the whole city. */
const CELL = 0.5
const WIDE_CELL = 2
/** The far streams keep this much air over the roofs beneath them and never climb past this. */
const STREAM_AIR = 5
const STREAM_CEILING = 64

/** A number in [0, 1) that is the same on every load for the same key. */
const unit = key => hash(key) / 4294967296

/** A colour as a linear [r, g, b] list, scaled: past 1 it glows. */
function rgb(hex, k = 1) {
  const c = new THREE.Color(hex)
  return [c.r * k, c.g * k, c.b * k]
}

/** Smooth 0..1 ramp between a and b. */
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// ------------------------------------------------------------------ shaders

// Additive light shapes (beams, trails, pools, underglow). The vertex colour is the light. aMode.x
// fades a shape's silhouette: from 0 (solid) to 1 a cone of light seen side-on is brightest down its
// middle and two crossed ribbons sum to the same light from every side; 2 marks a flat sheet that
// dims away only when seen almost edge-on, so far off it never thins to a flickering sliver.
// aMode.y lets the instance colour tint it (each car's own underglow, a reflection's strength).
// Light thins out in the haze rather than turning fog-coloured, which would lay a grey film over the sky.
const GLOW_VERTEX = /* glsl */ `
  attribute vec2 aMode;
  uniform float uFade;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vSoft;
  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 objectNormal = normal;
    vColor = color;
    #ifdef USE_INSTANCING
      mat3 im = mat3(instanceMatrix);
      objectNormal = im * (objectNormal / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
      local = instanceMatrix * local;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vColor *= mix(vec3(1.0), instanceColor, aMode.y);
    #endif
    vec4 mv = modelViewMatrix * local;
    float haze = uFade * length(mv.xyz);
    vColor *= exp(-haze * haze);
    vNormal = normalMatrix * objectNormal;
    vView = -mv.xyz;
    vSoft = aMode.x;
    gl_Position = projectionMatrix * mv;
  }
`

const GLOW_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vSoft;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float edge = vSoft > 1.5 ? smoothstep(0.04, 0.3, facing) : mix(1.0, facing * facing, vSoft);
    gl_FragColor = vec4(vColor * edge, 1.0);
    #include <colorspace_fragment>
  }
`

// Round glows that always face the camera: lamp glare, navigation lights, far traffic. A glow never
// draws smaller than three pixels; below that it dims instead, so far lights never sparkle as they
// slide between pixels.
const DOT_VERTEX = /* glsl */ `
  attribute float aSize;
  uniform float uScale;
  uniform float uFade;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = aSize * uScale / max(0.5, -mv.z);
    float shown = clamp(px, 3.0, 240.0);
    float haze = uFade * length(mv.xyz);
    vColor = color * min(1.0, px * px / (shown * shown)) * exp(-haze * haze);
    gl_PointSize = shown;
    gl_Position = projectionMatrix * mv;
  }
`

const DOT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 >= 1.0) discard;
    float light = (exp(-r2 * 18.0) + 0.2 * exp(-r2 * 4.0)) * (1.0 - r2);
    gl_FragColor = vec4(vColor * light, 1.0);
    #include <colorspace_fragment>
  }
`

/** The additive material every beam, trail and pool shares. */
function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0.0045 } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  })
}

/** The additive material for camera-facing glows. */
function dotMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1000 }, uFade: { value: 0.0045 } },
    vertexShader: DOT_VERTEX,
    fragmentShader: DOT_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  })
}

// ------------------------------------------------------------------ shapes

/** A non-indexed copy of `geometry` in colour `color`, each vertex scaled by `shade(x, y, z)` if given. */
function coloured(geometry, color, shade = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  if (g.attributes.uv) g.deleteAttribute('uv')
  if (!g.attributes.normal) g.computeVertexNormals()
  const p = g.attributes.position
  const colors = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i += 1) {
    const k = shade ? shade(p.getX(i), p.getY(i), p.getZ(i)) : 1
    colors[i * 3] = color[0] * k
    colors[i * 3 + 1] = color[1] * k
    colors[i * 3 + 2] = color[2] * k
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

/** Marks a glow piece: `soft` fades its silhouette (beams), `tinted` lets the instance colour tint it. */
function moded(geometry, soft, tinted) {
  const n = geometry.attributes.position.count
  const modes = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    modes[i * 2] = soft
    modes[i * 2 + 1] = tinted
  }
  geometry.setAttribute('aMode', new THREE.BufferAttribute(modes, 2))
  return geometry
}

/** A box `w` x `h` x `d` centred at (x, y, z), all one colour. */
function block(w, h, d, x, y, z, color) {
  return coloured(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color)
}

/**
 * A faceted hull lofted through cross-sections, nose first. Each section is [z, halfWidth, bottom,
 * top, roof] (roof: how much of the width the flat top keeps). Faces are flat-shaded, and the roof,
 * flanks and keel take their own colours so the shape still reads in the dark.
 */
function loft(sections, { roof, flank, keel }) {
  const rings = sections.map(([z, w, y0, y1, r]) => {
    const belt = y0 + (y1 - y0) * 0.42
    return [[-w * 0.8, y0, z], [-w, belt, z], [-w * r, y1, z], [w * r, y1, z], [w, belt, z], [w * 0.8, y0, z]]
  })
  const positions = []
  const colors = []
  // Wind each face so it looks along `out`.
  const face = (a, b, c, color, out) => {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    const dot = (uy * vz - uz * vy) * out[0] + (uz * vx - ux * vz) * out[1] + (ux * vy - uy * vx) * out[2]
    positions.push(...a, ...(dot < 0 ? c : b), ...(dot < 0 ? b : c))
    colors.push(...color, ...color, ...color)
  }
  for (let s = 0; s < rings.length - 1; s += 1) {
    const A = rings[s]
    const B = rings[s + 1]
    const middle = (sections[s][2] + sections[s][3] + sections[s + 1][2] + sections[s + 1][3]) / 4
    for (let k = 0; k < 6; k += 1) {
      const j = (k + 1) % 6
      const color = k === 2 ? roof : k === 5 ? keel : flank
      const out = [(A[k][0] + A[j][0] + B[k][0] + B[j][0]) / 4, (A[k][1] + A[j][1] + B[k][1] + B[j][1]) / 4 - middle, 0]
      face(A[k], B[k], B[j], color, out)
      face(A[k], B[j], A[j], color, out)
    }
  }
  const ends = [
    [rings[0], 1],
    [rings[rings.length - 1], -1],
  ]
  for (const [ring, dir] of ends) {
    for (let k = 1; k < 5; k += 1) face(ring[0], ring[k], ring[k + 1], flank, [0, 0, dir])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** A flat ribbon down +z from 0 to `length`, `w0` wide narrowing to `w1`, bright down its middle and fading out along it. */
function ribbon(length, w0, w1, color, power = 2, rows = 6) {
  const positions = []
  const colors = []
  const across = [-0.5, 0, 0.5]
  const weight = [0, 1, 0]
  const corner = (row, col) => {
    const t = row / rows
    positions.push(across[col] * (w0 + (w1 - w0) * t), 0, t * length)
    const k = weight[col] * (1 - t) ** power
    colors.push(color[0] * k, color[1] * k, color[2] * k)
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      corner(row, col)
      corner(row + 1, col)
      corner(row + 1, col + 1)
      corner(row, col)
      corner(row + 1, col + 1)
      corner(row, col + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A soft flat ellipse of light, `rx` by `rz`, centred at (x, y, z) and brightest in the middle.
 * `taper` below 1 narrows its back end, making a fan of light that opens forwards (+z).
 */
function pool(rx, rz, x, y, z, color, power = 1.6, taper = 1) {
  const g = coloured(new THREE.CircleGeometry(1, 28), color, (px, py) => Math.max(0, 1 - Math.hypot(px, py)) ** power)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i += 1) p.setX(i, p.getX(i) * (taper + (1 - taper) * (1 - p.getY(i)) * 0.5))
  return g.rotateX(-Math.PI / 2).scale(rx, 1, rz).translate(x, y, z)
}

/** A cone of light one metre long down +z from the origin, opening `spread` per metre, fading towards its end. */
function cone(spread, color, power = 1.7) {
  return coloured(new THREE.CylinderGeometry(spread, 0.015, 1, 20, 10, true), color, (x, y) => {
    const t = y + 0.5
    return (1 - t) ** power * Math.min(1, 0.3 + t * 12)
  })
    .rotateX(Math.PI / 2)
    .translate(0, 0, 0.5)
}

// The flying car: an invented low wedge with two rear thruster pods, a bubble canopy and a spoiler.
// Sections are [z, halfWidth, bottom, top, roof]; +z is forward, +x is the car's left.
const SKYCAR_HULL = [
  [2.6, 0.4, 0.14, 0.3, 0.55],
  [2.05, 0.86, 0.02, 0.46, 0.62],
  [0.9, 1.02, -0.06, 0.58, 0.7],
  [-0.8, 1.08, -0.08, 0.64, 0.74],
  [-1.9, 1.02, -0.02, 0.64, 0.74],
  [-2.42, 0.9, 0.06, 0.58, 0.7],
]
const SKYCAR_POD = [
  [-0.2, 0.22, 0.02, 0.34, 0.75],
  [-1.2, 0.3, -0.04, 0.42, 0.8],
  [-2.5, 0.27, 0, 0.38, 0.8],
]
const SKYCAR_CANOPY = [
  [1.35, 0.5, 0.5, 0.56, 0.6],
  [0.7, 0.66, 0.52, 0.9, 0.62],
  [-0.4, 0.68, 0.56, 0.98, 0.6],
  [-1.15, 0.56, 0.58, 0.78, 0.6],
]
const POD_X = 1.12

/** The flying car's shell (painted per car by the instance colour). */
function skycarBody() {
  const parts = [loft(SKYCAR_HULL, { roof: [0.62, 0.64, 0.7], flank: [0.4, 0.42, 0.46], keel: [0.12, 0.12, 0.14] })]
  for (const side of [-1, 1]) {
    parts.push(loft(SKYCAR_POD, { roof: [0.36, 0.37, 0.4], flank: [0.24, 0.25, 0.28], keel: [0.1, 0.1, 0.12] }).translate(side * POD_X, 0, 0))
    parts.push(block(0.08, 0.16, 0.22, side * 0.72, 0.68, -2.12, [0.3, 0.3, 0.33]))
  }
  parts.push(block(2.3, 0.07, 0.42, 0, 0.77, -2.14, [0.45, 0.46, 0.5]))
  return mergeGeometries(parts)
}

/**
 * The flying car's lamps: they glow on their own. Every glowing edge is at least 12 cm thick, and
 * every lamp face stands at least 5 cm off the body behind it (these cars fly far from the office).
 */
function skycarLamps() {
  const head = rgb('#eef6ff', 3.2)
  const parts = [
    block(0.42, 0.13, 0.08, 0.5, 0.3, 2.17, head),
    block(0.42, 0.13, 0.08, -0.5, 0.3, 2.17, head),
    // The nose strip sinks 4 cm into the nose cap (z 2.6) and stands 6 cm proud of it.
    block(0.7, 0.12, 0.1, 0, 0.22, 2.61, rgb('#9fe8ff', 1.8)),
    block(1.76, 0.13, 0.08, 0, 0.46, -2.44, rgb('#ff2a44', 3.4)),
    loft(SKYCAR_CANOPY, { roof: rgb('#9fd8ff', 0.1), flank: rgb('#2bf3ff', 0.05), keel: rgb('#2bf3ff', 0.02) }),
  ]
  for (const side of [-1, 1]) {
    parts.push(block(0.12, 0.12, 1.8, side * 1.0, 0.27, 0.6, rgb('#ff2bd6', 1.9)))
    // Thruster discs 6 cm behind the pods' end caps (z -2.5).
    parts.push(coloured(new THREE.CircleGeometry(0.21, 6), rgb('#ff6a2b', 2.6)).rotateY(Math.PI).translate(side * POD_X, 0.18, -2.56))
  }
  return mergeGeometries(parts)
}

/** The soft underglow beneath a flying car, tinted per car: a flat sheet, so it dims away edge-on. */
function skycarUnderglow() {
  return moded(pool(1.7, 3.5, 0, -0.24, -0.1, [0.46, 0.46, 0.46], 2.2), 2, 1)
}

/**
 * A flying car's light trail and thruster wakes, one metre long behind the tail: stretched to length
 * every frame. Each is two ribbons crossed, so it never thins to a sliver seen edge-on; the wakes
 * fade each ribbon by how squarely it faces the camera, so the pair shines the same from every side.
 */
function skycarTrail() {
  const trail = rgb('#ff2b4a', 1.1)
  const wake = rgb('#ff8a3b', 0.9)
  const parts = [
    moded(ribbon(1, 0.6, 0.1, trail).rotateY(Math.PI).translate(0, 0.46, 0), 0, 0),
    moded(ribbon(1, 0.5, 0.08, trail).rotateZ(Math.PI / 2).rotateY(Math.PI).translate(0, 0.46, 0), 0, 0),
  ]
  for (const side of [-1, 1]) {
    parts.push(moded(ribbon(0.45, 0.36, 0.05, wake).rotateY(Math.PI).translate(side * POD_X, 0.18, -0.01), 1, 0))
    parts.push(moded(ribbon(0.45, 0.36, 0.05, wake).rotateZ(Math.PI / 2).rotateY(Math.PI).translate(side * POD_X, 0.18, -0.01), 1, 0))
  }
  return mergeGeometries(parts)
}

// The street car: a low invented saloon, 1.22 m tall. Painted per car by the instance colour.
const CAR_HULL = [
  [2.3, 0.8, 0.22, 0.5, 0.75],
  [1.9, 0.92, 0.18, 0.66, 0.85],
  [0.9, 0.95, 0.16, 0.72, 0.9],
  [-1.2, 0.96, 0.16, 0.76, 0.9],
  [-2.0, 0.93, 0.2, 0.74, 0.88],
  [-2.3, 0.86, 0.26, 0.68, 0.85],
]
const CAR_CABIN = [
  [1.25, 0.82, 0.66, 0.72, 0.85],
  [0.45, 0.8, 0.68, 1.2, 0.7],
  [-0.75, 0.8, 0.7, 1.22, 0.7],
  [-1.65, 0.78, 0.7, 0.82, 0.75],
]
// Lamp centres [side, up, forward]. The head lamps sit on the face of the nose cap (z 2.3, y 0.22 to
// 0.5): their 12 cm deep blocks stand 6 cm proud of it, so nothing of the body hides them.
const CAR_HEAD = [0.48, 0.4, 2.3]
const CAR_TAIL = [0.66, 0.6, -2.31]

/** The street car's shell, glass and wheels. */
function carBody() {
  const glass = [0.035, 0.04, 0.05]
  const parts = [
    loft(CAR_HULL, { roof: [0.9, 0.9, 0.9], flank: [0.72, 0.72, 0.72], keel: [0.12, 0.12, 0.12] }),
    loft(CAR_CABIN, { roof: [0.8, 0.8, 0.8], flank: glass, keel: glass }),
  ]
  for (const x of [-0.84, 0.84]) {
    for (const z of [-1.45, 1.45]) parts.push(coloured(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12).rotateZ(Math.PI / 2).translate(x, 0.34, z), [0.03, 0.03, 0.035]))
  }
  return mergeGeometries(parts)
}

/** The street car's head and tail lights (12 cm thick: the cars drive far from the office too). */
function carLamps() {
  const head = rgb('#f4f8ff', 3)
  return mergeGeometries([
    block(0.36, 0.12, 0.12, CAR_HEAD[0], CAR_HEAD[1], CAR_HEAD[2], head),
    block(0.36, 0.12, 0.12, -CAR_HEAD[0], CAR_HEAD[1], CAR_HEAD[2], head),
    block(1.6, 0.12, 0.08, 0, CAR_TAIL[1], CAR_TAIL[2], rgb('#ff2a44', 3.4)),
  ])
}

/**
 * The light a street car throws: a fan-shaped pool on the wet road ahead, a red glow behind, underglow,
 * and two thin level beams in the wet air that end before they would reach the road (a cone cut by the
 * road shows a hard edge).
 */
function carGlow() {
  const beam = rgb('#fff0d8', 0.06)
  const parts = []
  // Level from the lamp face, 7 m long: even its widest end (32 cm in radius) stays 5 cm over the road's puddles and marks.
  for (const side of [-1, 1]) {
    parts.push(moded(cone(0.045, beam).scale(7, 7, 7).translate(side * CAR_HEAD[0], CAR_HEAD[1], CAR_HEAD[2] + 0.06), 1, 0))
  }
  // Pools lie 8 cm over the road (6 cm over its marks), the underglow 2 cm above them and the
  // reflections (update()) 2 cm above that: layers stay at least 5 cm off anything solid.
  parts.push(moded(pool(2.0, 5.2, 0, 0.08, 7.4, rgb('#fff1dc', 0.2), 2, 0.35), 0, 0))
  parts.push(moded(pool(0.95, 1.4, 0, 0.08, -2.9, rgb('#ff2b40', 0.22), 2), 0, 0))
  parts.push(moded(pool(1.35, 2.7, 0, 0.1, 0, [0.34, 0.34, 0.34], 2), 0, 1))
  return mergeGeometries(parts)
}

// ------------------------------------------------------------------ what stands in the way

/** A grid holding the tallest thing in each `cell`-metre square of [x0, x1] x [z0, z1]. */
function heightGrid(x0, x1, z0, z1, cell) {
  const nx = Math.ceil((x1 - x0) / cell)
  const nz = Math.ceil((z1 - z0) / cell)
  const top = new Float32Array(nx * nz)
  return {
    /** Raises every cell [ax, bx] x [az, bz] touches to at least h. */
    mark(ax, az, bx, bz, h) {
      if (bx < x0 || ax >= x1 || bz < z0 || az >= z1) return
      const i0 = Math.max(0, Math.floor((ax - x0) / cell))
      const i1 = Math.min(nx - 1, Math.floor((bx - x0) / cell))
      const k0 = Math.max(0, Math.floor((az - z0) / cell))
      const k1 = Math.min(nz - 1, Math.floor((bz - z0) / cell))
      for (let k = k0; k <= k1; k += 1) {
        for (let i = i0; i <= i1; i += 1) if (top[k * nx + i] < h) top[k * nx + i] = h
      }
    },
    /** The tallest thing in the rectangle [ax, bx] x [az, bz] (0 off the grid). */
    box(ax, az, bx, bz) {
      const i0 = Math.max(0, Math.floor((ax - x0) / cell))
      const i1 = Math.min(nx - 1, Math.floor((bx - x0) / cell))
      const k0 = Math.max(0, Math.floor((az - z0) / cell))
      const k1 = Math.min(nz - 1, Math.floor((bz - z0) / cell))
      let h = 0
      for (let k = k0; k <= k1; k += 1) {
        for (let i = i0; i <= i1; i += 1) if (top[k * nx + i] > h) h = top[k * nx + i]
      }
      return h
    },
    /** The tallest thing within `r` metres (square) of (x, z). */
    at(x, z, r) {
      return this.box(x - r, z - r, x + r, z + r)
    },
  }
}

/**
 * The height of the tallest thing already standing in each cell: half-metre cells in `near` (round
 * the office, for the flying lanes) and two-metre cells in `wide` (the whole city, for the far
 * streams). The skyline and signs are built before the traffic, so the lanes can pick the open
 * corridors between the towers and climb over anything that still stands in the way. A wall marks the
 * cells behind it (inside its building), so a tower face exactly on a cell edge never spills into the
 * street beside it. Every visible mesh under `roots` is read in full and in scene order, with no time
 * limit, so the same scenery gives the same map, and the same lanes, on every load.
 */
function heightField(roots, keep, near, wide) {
  const fine = heightGrid(near.x0, near.x1, near.z0, near.z1, CELL)
  const coarse = heightGrid(wide.x0, wide.x1, wide.z0, wide.z1, WIDE_CELL)
  /** Marks [ax, bx] x [az, bz] at height h; a flat extent marks the cell on the side its face looks away from (sx, sz). */
  const mark = (ax, az, bx, bz, h, sx, sz) => {
    if (bx - ax < 0.02) ax = bx = (ax + bx) / 2 - sx * 0.01
    else {
      ax += 0.01
      bx -= 0.01
    }
    if (bz - az < 0.02) az = bz = (az + bz) / 2 - sz * 0.01
    else {
      az += 0.01
      bz -= 0.01
    }
    fine.mark(ax, az, bx, bz, h)
    coarse.mark(ax, az, bx, bz, h)
  }
  const world = new THREE.Matrix4()
  const instance = new THREE.Matrix4()
  const box = new THREE.Box3()
  const e = world.elements
  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const visit = o => {
    if (!o.isMesh) return
    const m = Array.isArray(o.material) ? o.material[0] : o.material
    // Light shapes, see-through holograms and the sky are not in the way.
    if (!m || m.blending === THREE.AdditiveBlending || m.depthWrite === false || m.side === THREE.BackSide) return
    if (m.transparent && m.opacity < 0.3) return
    const g = o.geometry
    const position = g?.attributes?.position
    if (!position) return
    if (!g.boundingBox) g.computeBoundingBox()
    const triangles = Math.floor((g.index ? g.index.count : position.count) / 3)
    const count = o.isInstancedMesh ? o.count : 1
    for (let n = 0; n < count; n += 1) {
      world.copy(o.matrixWorld)
      if (o.isInstancedMesh) {
        o.getMatrixAt(n, instance)
        world.multiply(instance)
      }
      box.copy(g.boundingBox).applyMatrix4(world)
      // Ground-level things (roads, kerbs, cars) and anything floating clear above every lane.
      if (box.max.y < 1.5 || box.min.y > SKY_HIGH + 2) continue
      if (box.min.x >= keep.x0 && box.max.x <= keep.x1 && box.min.z >= keep.z0 && box.max.z <= keep.z1) continue
      const area = (box.max.x - box.min.x) * (box.max.z - box.min.z)
      if (area <= 900 || triangles <= 12) {
        mark(box.min.x, box.min.z, box.max.x, box.max.z, box.max.y, 0, 0)
        continue
      }
      // A big merged mesh (a whole band of towers in one): mark it triangle by triangle.
      for (let t = 0; t < triangles; t += 1) {
        for (let c = 0; c < 3; c += 1) {
          const i = g.index ? g.index.getX(t * 3 + c) : t * 3 + c
          const px = position.getX(i)
          const py = position.getY(i)
          const pz = position.getZ(i)
          v[c * 3] = e[0] * px + e[4] * py + e[8] * pz + e[12]
          v[c * 3 + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13]
          v[c * 3 + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14]
        }
        const h = Math.max(v[1], v[4], v[7])
        if (h < 1.5) continue
        // The face's outward normal says which side of a wall the building is on.
        const ux = v[3] - v[0]
        const uy = v[4] - v[1]
        const uz = v[5] - v[2]
        const wx = v[6] - v[0]
        const wy = v[7] - v[1]
        const wz = v[8] - v[2]
        const nxs = Math.sign(uy * wz - uz * wy)
        const nzs = Math.sign(ux * wy - uy * wx)
        mark(Math.min(v[0], v[3], v[6]), Math.min(v[2], v[5], v[8]), Math.max(v[0], v[3], v[6]), Math.max(v[2], v[5], v[8]), Math.min(h, SKY_HIGH + HEADROOM), nxs, nzs)
      }
    }
  }
  for (const root of roots) {
    if (!root?.isObject3D) continue
    // Only what is shown: a hidden group (and everything in it) is not in the way.
    root.updateWorldMatrix(true, true)
    root.traverseVisible(visit)
  }
  fine.wide = coarse
  return fine
}

// ------------------------------------------------------------------ flying lanes

/**
 * The cheapest line through a grid, a step at a time: at each of `cols` steps it takes one of `rows`
 * positions side by side, where `price(j, i)` is what position i costs at step j and moving d
 * positions between steps costs 0.3 d (never more than `turn`). Returns the position at every step.
 */
function cheapestLine(cols, rows, turn, price) {
  const cost = new Float64Array(cols * rows)
  const from = new Int16Array(cols * rows)
  for (let j = 0; j < cols; j += 1) {
    for (let i = 0; i < rows; i += 1) {
      const here = price(j, i)
      if (j === 0) {
        cost[i] = here
        continue
      }
      let best = Infinity
      let pick = i
      for (let d = -turn; d <= turn; d += 1) {
        const k = i + d
        if (k < 0 || k >= rows) continue
        const c = cost[(j - 1) * rows + k] + Math.abs(d) * 0.3
        if (c < best) {
          best = c
          pick = k
        }
      }
      cost[j * rows + i] = best + here
      from[j * rows + i] = pick
    }
  }
  let i = 0
  for (let k = 1; k < rows; k += 1) if (cost[(cols - 1) * rows + k] < cost[(cols - 1) * rows + i]) i = k
  const line = new Int16Array(cols)
  for (let j = cols - 1; j >= 0; j -= 1) {
    line[j] = i
    i = from[j * rows + i]
  }
  return line
}

/**
 * A path straight across the city through a band of towers (z from zMin to zMax), found by searching
 * every 4 m of the way for the line where the least stands in the way of a car flying at height y:
 * it threads the streets between the towers, turning at most 2 m sideways per 4 m. Returns control
 * points [x, altitude, z], west to east (or east to west when `back`).
 */
function route(field, E, { zMin, zMax, prefer, y, back }) {
  const step = 4
  const cols = Math.ceil((E + 480) / step) + 1
  const rows = Math.round((zMax - zMin) / 0.5) + 1
  const clear = y - HEADROOM
  const line = cheapestLine(cols, rows, 4, (j, i) => {
    const x = -240 + j * step
    const z = zMin + i * 0.5
    // The car's footprint as it weaves (up to about 27 degrees off straight), with air round it.
    const h = field.box(x - 3, z - 2, x + 3, z + 2)
    const blocked = h > clear ? 100 + (h - clear) * 5 : 0
    return blocked + Math.abs(z - prefer) * 0.02
  })
  const points = []
  for (let j = 0; j < cols; j += 1) {
    const ends = 1 - smooth(0, 6, Math.min(j, cols - 1 - j))
    points.push([-240 + j * step, y + ends * 8, zMin + line[j] * 0.5])
  }
  return back ? points.reverse() : points
}

/**
 * The flying lanes. Each is an open path through control points [x, altitude, z] that starts and
 * ends far off to the side, where a car fades out and starts again. `points(k, field)` gives the path;
 * `shifts` are other corridors (in metres north or south) to try when towers stand in the first.
 */
function laneSpecs(E, street) {
  const cx = E / 2
  const st = street + 0.8
  // Down out of the sky along the street, up the gap beside the office, along the canyon behind it,
  // down the gap on the far side towards the camera, and out along the street climbing away.
  // `mirror` flies it the other way round; `y` is its height in the canyon.
  const canyon = (mirror, y) => () => {
    const west = [
      [-235, y + 34, st], [-150, y + 21, st], [-95, y + 9, st], [-45, y + 0.4, st], [-18, y, st], [-12, y, st],
      [-9.15, y, st - 1.3], [-8.15, y, st - 4.2], [-8.15, y, 14], [-8.15, y, 4], [-8.15, y, -3.1],
      [-7.2, y, -5.4], [-4.4, y, -6.2], [-1.5, y, -6.2],
    ]
    const points = [
      ...west,
      [cx, y, -6.2],
      ...west
        .slice()
        .reverse()
        .map(([x, h, z]) => [E - x, h, z]),
    ]
    return mirror ? points.map(([x, h, z]) => [E - x, h, z]) : points
  }
  // Across the city through a band of towers, threading its streets; `back` flies it westwards.
  const across = (zMin, zMax, y, back) => (k, field) => route(field, E, { zMin, zMax, prefer: (zMin + zMax) / 2, y, back })
  // Lanes come in pairs sharing a path, one each way: the second flies 6 m over the first, so the
  // first keeps a ceiling 6 m lower to leave it room.
  const low = SKY_HIGH - 6
  return [
    { cars: 3, speed: 12.5, ceiling: low, shifts: [0], points: canyon(false, 13.2) },
    { cars: 2, speed: 11.5, ceiling: SKY_HIGH, shifts: [0], points: canyon(true, 17.5) },
    // Between the near and the middle towers, both ways, low enough to see from the office.
    { cars: 2, speed: 14, ceiling: low, shifts: [0], bob: 1.2, wave: 60, points: across(-48, -27, 14, false) },
    { cars: 2, speed: 13, ceiling: SKY_HIGH, shifts: [0], bob: 1.2, wave: 70, points: across(-48, -27, 19.5, true) },
    // Through the middle towers, and out between the middle and the far ones.
    { cars: 1, speed: 16, ceiling: low, shifts: [0], bob: 2, wave: 90, points: across(-104, -44, 24, false) },
    { cars: 1, speed: 15, ceiling: SKY_HIGH, shifts: [0], bob: 2, wave: 100, points: across(-104, -44, 30, true) },
    { cars: 1, speed: 18, ceiling: SKY_HIGH, shifts: [0], bob: 3, wave: 120, points: across(-124, -98, 36, false) },
  ]
}

/** Horizontal heading of an open path at sample i, as a unit [hx, hz]. */
function heading(x, z, i) {
  const n = x.length
  const a = Math.max(0, i - 1)
  const b = Math.min(n - 1, i + 1)
  const dx = x[b] - x[a]
  const dz = z[b] - z[a]
  const len = Math.hypot(dx, dz) || 1
  return [dx / len, dz / len]
}

/** How far a point is from the office's view (0 inside it). */
function distanceToClear(x, z, keep) {
  const dx = Math.max(keep.x0 - x, 0, x - keep.x1)
  const dz = Math.max(keep.z0 - z, 0, z - keep.z1)
  return Math.hypot(dx, dz)
}

/**
 * Moves (x, z) out of the office's view and keeps it north of the road, far enough that nothing of a
 * car heading (hx, hz) reaches in: neither its body nor its long underglow. A projection along the
 * way out (with the heading taken from the smooth designed path), so a smooth path stays smooth.
 */
function pushClear(x, z, hx, hz, keep) {
  // How far the car reaches in direction (nx, nz).
  const reach = (nx, nz) => {
    const across = Math.abs(nz * hx - nx * hz)
    const along = Math.abs(nx * hx + nz * hz)
    return Math.max(Math.hypot(REACH_ACROSS * across, REACH_ALONG * along), BODY_ACROSS * across + 2.65 * along) + 0.25
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const qx = clamp(x, keep.x0, keep.x1)
    const qz = clamp(z, keep.z0, keep.z1)
    const d = Math.hypot(x - qx, z - qz)
    if (d > 1e-6) {
      const nx = (x - qx) / d
      const nz = (z - qz) / d
      const r = reach(nx, nz)
      if (d < r) {
        x = qx + nx * r
        z = qz + nz * r
      }
    } else {
      // Inside it: out by the nearest side (never south, towards the camera).
      const west = x - keep.x0
      const east = keep.x1 - x
      const north = z - keep.z0
      if (west <= east && west <= north) x = keep.x0 - reach(-1, 0)
      else if (east <= north) x = keep.x1 + reach(1, 0)
      else z = keep.z0 - reach(0, -1)
    }
    z = Math.min(z, NO_FLY_SOUTH - reach(0, 1))
  }
  return [x, z]
}

/** Box blur of `values`, `radius` samples either side (the ends hold their value). */
function blur(values, radius) {
  const n = values.length
  const copy = Float64Array.from(values)
  for (let i = 0; i < n; i += 1) {
    let sum = 0
    for (let d = -radius; d <= radius; d += 1) sum += copy[clamp(i + d, 0, n - 1)]
    values[i] = sum / (radius * 2 + 1)
  }
}

/** Minimum of `values` over `radius` samples either side. */
function erode(values, radius) {
  const n = values.length
  const copy = Float64Array.from(values)
  for (let i = 0; i < n; i += 1) {
    let m = copy[i]
    for (let d = Math.max(0, i - radius); d <= Math.min(n - 1, i + radius); d += 1) m = Math.min(m, copy[d])
    values[i] = m
  }
}

/** The lane's path on the ground plan and its designed altitude: a smooth curve, weaving if asked, out of the office's view. */
function tracePath(points, spec, keep, seed) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal')
  curve.arcLengthDivisions = 4000
  const raw = curve.getSpacedPoints(SAMPLES - 1)
  const x = new Float64Array(SAMPLES)
  const y = new Float64Array(SAMPLES)
  const z = new Float64Array(SAMPLES)
  for (let i = 0; i < SAMPLES; i += 1) {
    x[i] = raw[i].x
    y[i] = raw[i].y
    z[i] = raw[i].z
  }
  if (spec.weave || spec.bob) {
    // Weave side to side and bob up and down, gently, and never near the office.
    const phase = unit(`${seed}w`) * Math.PI * 2
    const bobPhase = unit(`${seed}b`) * Math.PI * 2
    const step = curve.getLength() / (SAMPLES - 1)
    const sway = new Float64Array(SAMPLES)
    for (let i = 0; i < SAMPLES; i += 1) {
      const s = i * step
      const away = smooth(6, 18, distanceToClear(x[i], z[i], keep))
      sway[i] = (spec.weave ?? 0) * away * Math.sin((s / spec.wave) * Math.PI * 2 + phase)
      y[i] += (spec.bob ?? 0) * away * Math.sin((s / (spec.wave * 1.3)) * Math.PI * 2 + bobPhase)
    }
    const sx = Float64Array.from(x)
    const sz = Float64Array.from(z)
    for (let i = 0; i < SAMPLES; i += 1) {
      const [hx, hz] = heading(sx, sz, i)
      x[i] = sx[i] - hz * sway[i]
      z[i] = sz[i] + hx * sway[i]
    }
  }
  const designed = [Float64Array.from(x), Float64Array.from(z)]
  for (let i = 0; i < SAMPLES; i += 1) {
    const [hx, hz] = heading(designed[0], designed[1], i)
    const [px, pz] = pushClear(x[i], z[i], hx, hz, keep)
    x[i] = px
    z[i] = pz
  }
  return { x, y, z, base: Float64Array.from(y) }
}

/** How high a car must fly at each sample to clear what stands beneath its body (with 25 cm of air round it). */
function obstacles(path, field) {
  const need = new Float64Array(SAMPLES)
  for (let i = 0; i < SAMPLES; i += 1) {
    const [hx, hz] = heading(path.x, path.z, i)
    let h = 0
    for (const [across, along] of BODY_OUTLINE) h = Math.max(h, field.at(path.x[i] + hx * along - hz * across, path.z[i] + hz * along + hx * across, 0.25))
    need[i] = h > 0 ? h + HEADROOM : 0
  }
  return need
}

/** Raises `need` wherever the path passes within 8 m of an earlier lane: it always flies 6 m over it. */
function separate(path, need, earlier, ceiling) {
  for (const other of earlier) {
    if (other.x0 > path.x1 + 8 || other.x1 < path.x0 - 8 || other.z0 > path.z1 + 8 || other.z1 < path.z0 - 8) continue
    for (let i = 0; i < SAMPLES; i += 1) {
      const x = path.x[i]
      const z = path.z[i]
      if (x < other.x0 - 8 || x > other.x1 + 8 || z < other.z0 - 8 || z > other.z1 + 8) continue
      for (let k = 0; k < other.n; k += 3) {
        const dx = other.px[k] - x
        const dz = other.pz[k] - z
        if (dx * dx + dz * dz <= 64) need[i] = Math.max(need[i], Math.min(ceiling, other.py[k] + 6))
      }
    }
  }
}

/** The ground-plan box around a path, for quick rejections. */
function bounds(target, x, z) {
  target.x0 = Math.min(...x)
  target.x1 = Math.max(...x)
  target.z0 = Math.min(...z)
  target.z1 = Math.max(...z)
  return target
}

/** Length of an open path on the ground plan. */
function planLength(path) {
  let length = 0
  for (let i = 0; i < SAMPLES - 1; i += 1) length += Math.hypot(path.x[i + 1] - path.x[i], path.z[i + 1] - path.z[i])
  return length
}

/** How much a path would have to climb above its design to clear `need` (and much more if it cannot). */
function climbCost(path, need, ceiling) {
  const ds = planLength(path) / (SAMPLES - 1)
  let cost = 0
  for (let i = 0; i < SAMPLES; i += 1) cost += Math.max(0, need[i] - path.base[i]) * ds + (need[i] > ceiling ? 500 : 0)
  return cost
}

/** Sets the path's altitude: its design, lifted with gentle ramps over every `need`, smoothed, under its ceiling. */
function lift(path, need, ceiling) {
  const ds = planLength(path) / (SAMPLES - 1)
  const drop = ds * CLIMB
  // Two sweeps give every sample the highest need around it, less the climb from there.
  const ramped = Float64Array.from(need)
  for (let i = 1; i < SAMPLES; i += 1) ramped[i] = Math.max(ramped[i], ramped[i - 1] - drop)
  for (let i = SAMPLES - 2; i >= 0; i -= 1) ramped[i] = Math.max(ramped[i], ramped[i + 1] - drop)
  for (let i = 0; i < SAMPLES; i += 1) ramped[i] = Math.max(path.base[i], ramped[i], SKY_LOW)
  const radius = Math.max(2, Math.round(5 / ds))
  blur(ramped, radius)
  blur(ramped, radius)
  for (let i = 0; i < SAMPLES; i += 1) path.y[i] = clamp(ramped[i], SKY_LOW, ceiling)
}

/** How far a light may reach from (ox, oz) along (fx, fz) before touching the office's view or crossing the road. */
function roomAlong(ox, oz, fx, fz, longest, spread, width, keep) {
  for (let d = 0.5; d <= longest; d += 0.5) {
    const qx = ox + fx * d
    const qz = oz + fz * d
    const r = spread * d + width
    const inside = qx > keep.x0 - r && qx < keep.x1 + r && qz > keep.z0 - r && qz < keep.z1 + r
    if (inside || qz + r > NO_FLY_SOUTH) return d - 0.5
  }
  return longest
}

/**
 * The lane as a table: evenly spaced samples with their heading, their turn (cars bank into it),
 * their pace (slow through tight bends, quick far from the office) and how far a headlight beam and
 * a light trail may reach from there without touching the office's view or crossing the road.
 */
function finish(path, keep, speed) {
  const { x, y, z } = path
  const n = SAMPLES
  const acc = new Float64Array(n)
  for (let i = 1; i < n; i += 1) acc[i] = acc[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1], z[i] - z[i - 1])
  const length = acc[n - 1]
  const ds = length / (n - 1)
  const lane = { n, length, ds }
  for (const key of ['px', 'py', 'pz', 'fx', 'fy', 'fz', 'kx', 'kz', 'pace', 'beam', 'trail']) lane[key] = new Float32Array(n)
  let seg = 0
  for (let k = 0; k < n; k += 1) {
    const s = k * ds
    while (seg < n - 2 && acc[seg + 1] < s) seg += 1
    const a = clamp((s - acc[seg]) / (acc[seg + 1] - acc[seg] || 1), 0, 1)
    lane.px[k] = x[seg] + (x[seg + 1] - x[seg]) * a
    lane.py[k] = y[seg] + (y[seg + 1] - y[seg]) * a
    lane.pz[k] = z[seg] + (z[seg + 1] - z[seg]) * a
  }
  for (let k = 0; k < n; k += 1) {
    const a = Math.max(0, k - 1)
    const b = Math.min(n - 1, k + 1)
    const dx = lane.px[b] - lane.px[a]
    const dy = lane.py[b] - lane.py[a]
    const dz = lane.pz[b] - lane.pz[a]
    const len = Math.hypot(dx, dy, dz) || 1
    lane.fx[k] = dx / len
    lane.fy[k] = dy / len
    lane.fz[k] = dz / len
  }
  // The turn: how fast the heading swings, towards the inside of the bend (smoothed so banking eases in).
  const kx = new Float64Array(n)
  const kz = new Float64Array(n)
  for (let k = 1; k < n - 1; k += 1) {
    kx[k] = (lane.fx[k + 1] - lane.fx[k - 1]) / (2 * ds)
    kz[k] = (lane.fz[k + 1] - lane.fz[k - 1]) / (2 * ds)
  }
  const window = Math.max(2, Math.round(3 / ds))
  blur(kx, window)
  blur(kz, window)
  lane.kx.set(kx)
  lane.kz.set(kz)
  // Pace: at most 9 m/s² of sideways pull in a bend, and up to three times quicker far from the office.
  // Taking the slowest pace over a bend's approach makes the braking start early and stay gentle.
  const pace = new Float64Array(n)
  for (let k = 0; k < n; k += 1) {
    const bend = Math.hypot(kx[k], kz[k])
    const far = 1 + 2.2 * smooth(40, 150, distanceToClear(lane.px[k], lane.pz[k], keep))
    pace[k] = clamp(Math.min(far, Math.sqrt(9 / Math.max(bend, 1e-6)) / speed), 0.35, 3.2)
  }
  const ease = Math.max(2, Math.round(14 / ds))
  erode(pace, ease)
  blur(pace, ease)
  blur(pace, ease)
  lane.pace.set(pace)
  // Beam and trail room: shrink early and grow back late, so a light never pokes in as the car turns.
  const beam = new Float64Array(n)
  const trail = new Float64Array(n)
  for (let k = 0; k < n; k += 1) {
    const fx = lane.fx[k]
    const fz = lane.fz[k]
    beam[k] = roomAlong(lane.px[k] + fx * NOSE, lane.pz[k] + fz * NOSE, fx, fz, BEAM_LENGTH, BEAM_SPREAD, 0.4, keep)
    trail[k] = roomAlong(lane.px[k] - fx * TAIL, lane.pz[k] - fz * TAIL, -fx, -fz, TRAIL_LENGTH, 0, 1.5, keep)
  }
  const guard = Math.max(4, Math.round(10 / ds))
  for (const [room, out] of [
    [beam, lane.beam],
    [trail, lane.trail],
  ]) {
    const raw = Float64Array.from(room)
    erode(room, guard)
    blur(room, Math.max(1, guard >> 2))
    for (let k = 0; k < n; k += 1) out[k] = Math.max(0.5, Math.min(room[k], raw[k]))
  }
  return lane
}

/** Builds every flying lane: the clearest corridor of each, lifted over towers and over the lanes before it. */
function buildLanes(E, street, field, keep) {
  const lanes = []
  laneSpecs(E, street).forEach((spec, index) => {
    const { ceiling } = spec
    let best = null
    for (const shift of spec.shifts) {
      const path = tracePath(spec.points(shift, field), spec, keep, `lane${index}`)
      const need = obstacles(path, field)
      const cost = climbCost(path, need, ceiling)
      if (!best || cost < best.cost - 1) best = { path, need, cost }
      if (cost === 0) break
    }
    bounds(best.path, best.path.x, best.path.z)
    separate(best.path, best.need, lanes, ceiling)
    lift(best.path, best.need, ceiling)
    const lane = finish(best.path, keep, spec.speed)
    bounds(lane, lane.px, lane.pz)
    lane.spec = spec
    lanes.push(lane)
  })
  return lanes
}

// ------------------------------------------------------------------ far sky traffic

/**
 * A far stream's path: marching along `axis` ('x': west to east, 'z': north to south) from a0 to a1,
 * it keeps every 4 m to the line across [c0, c1] where the least stands at height y, so its lights
 * thread the streets between the towers. Returns u in [0, 1] -> [x, altitude, z], the altitude
 * swaying `bob` metres either way over a wave of 2 pi `wave` metres.
 */
function streamPath(wide, axis, a0, a1, c0, c1, y, bob, wave, phase) {
  const step = 4
  const cols = Math.ceil((a1 - a0) / step) + 1
  const rows = Math.round((c1 - c0) / 0.5) + 1
  const clear = y - STREAM_AIR
  const middle = (c0 + c1) / 2
  const line = cheapestLine(cols, rows, 4, (j, i) => {
    const a = a0 + j * step
    const c = c0 + i * 0.5
    // Both directions of traffic (1.4 m either side of the line), with air round them.
    const h = axis === 'x' ? wide.box(a - 1.5, c - 3, a + 1.5, c + 3) : wide.box(c - 3, a - 1.5, c + 3, a + 1.5)
    return (h > clear ? 100 + (h - clear) : 0) + Math.abs(c - middle) * 0.01
  })
  // Rounded off a little: the search turns in straight 4 m steps.
  const cross = Float64Array.from(line, i => c0 + i * 0.5)
  blur(cross, 1)
  blur(cross, 1)
  return u => {
    const s = clamp(u, 0, 1) * (cols - 1)
    const j = Math.min(cols - 2, Math.floor(s))
    const c = cross[j] + (cross[j + 1] - cross[j]) * (s - j)
    const a = a0 + s * step
    const h = y + bob * Math.sin(a / wave + phase)
    return axis === 'x' ? [a, h, c] : [c, h, a]
  }
}

/**
 * Far streams of sky traffic, as [x, altitude, z] along u in [0, 1]; each carries lights both ways.
 * They thread the open streets of the city in `wide` (its towers' heights): low along the wide street
 * between the middle and far towers, over the low blocks among the taller towers elsewhere.
 */
function streamSpecs(E, wide) {
  return [
    // Through the middle towers.
    streamPath(wide, 'x', -260, E + 260, -86, -58, 50, 3, 53, 0),
    // Down the open street between the middle and the far towers, low, and a second deck over it
    // that climbs and dips slowly between 23 and 47 m.
    streamPath(wide, 'x', -280, E + 280, -120, -100, 15, 2, 41, 1),
    streamPath(wide, 'x', -240, E + 240, -120, -100, 35, 12, 70, 0.5),
    // Through the far towers.
    streamPath(wide, 'x', -300, E + 300, -166, -134, 48, 3, 47, 2),
    streamPath(wide, 'x', -320, E + 320, -222, -188, 38, 3, 70, 0),
    // Down each flank.
    streamPath(wide, 'z', -230, 16, -110, -74, 40, 2, 30, 0),
    streamPath(wide, 'z', -230, 16, E + 74, E + 110, 50, 2, 33, 1),
  ]
}

/**
 * Lifts a far stream (points [x, altitude, z]) over the roofs beneath it, climbing and diving gently,
 * never below the sky band nor above STREAM_CEILING, and returns how much of its traffic shows at
 * each point: where a tower is too tall to clear, the lights fade out before they reach its wall and
 * back in once past it, each fade taking about a second, so none winks out against a building.
 */
function clearStream(pts, wide) {
  const n = pts.length
  let plan = 0
  for (let i = 1; i < n; i += 1) plan += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2])
  const ds = plan / (n - 1)
  const drop = ds * 0.45
  const need = new Float64Array(n)
  const y = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const h = wide.at(pts[i][0], pts[i][2], 0.75)
    need[i] = h > 0 ? h + STREAM_AIR : 0
    y[i] = Math.max(pts[i][1], need[i], SKY_LOW)
  }
  // Ramps either side of every rise, smoothed, then ramped again so smoothing never cuts a corner off a roof.
  const ramp = () => {
    for (let i = 1; i < n; i += 1) y[i] = Math.max(y[i], y[i - 1] - drop)
    for (let i = n - 2; i >= 0; i -= 1) y[i] = Math.max(y[i], y[i + 1] - drop)
  }
  ramp()
  const radius = Math.max(1, Math.round(8 / ds))
  blur(y, radius)
  blur(y, radius)
  for (let i = 0; i < n; i += 1) y[i] = Math.max(y[i], need[i], pts[i][1], SKY_LOW)
  ramp()
  const shown = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    y[i] = Math.min(y[i], STREAM_CEILING)
    pts[i][1] = y[i]
    shown[i] = y[i] >= need[i] - 0.25 ? 1 : 0
  }
  // Hidden from two samples before a wall (9 m or so) and faded over five (about a second at their speed).
  erode(shown, 2)
  blur(shown, 1)
  blur(shown, 1)
  return shown
}

/**
 * A stream as an evenly spaced table, offset `side` metres sideways and `rise` up (the two directions
 * of traffic), lifted over the towers in `wide`; `v` is how much of its traffic shows at each point.
 */
function streamTable(at, side, rise, wide) {
  const count = 160
  const raw = []
  for (let i = 0; i <= count; i += 1) raw.push(at(i / count))
  const pts = raw.map((p, i) => {
    const a = raw[Math.max(0, i - 1)]
    const b = raw[Math.min(count, i + 1)]
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const len = Math.hypot(dx, dz) || 1
    return [p[0] - (dz / len) * side, p[1] + rise, p[2] + (dx / len) * side]
  })
  const shown = clearStream(pts, wide)
  const acc = [0]
  for (let i = 1; i <= count; i += 1) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]))
  const length = acc[count]
  const n = 128
  const table = { length, ds: length / (n - 1), n, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), v: new Float32Array(n) }
  let seg = 0
  for (let k = 0; k < n; k += 1) {
    const s = k * table.ds
    while (seg < count - 1 && acc[seg + 1] < s) seg += 1
    const a = clamp((s - acc[seg]) / (acc[seg + 1] - acc[seg] || 1), 0, 1)
    table.x[k] = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * a
    table.y[k] = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * a
    table.z[k] = pts[seg][2] + (pts[seg + 1][2] - pts[seg][2]) * a
    table.v[k] = shown[seg] + (shown[seg + 1] - shown[seg]) * a
  }
  return table
}

// ------------------------------------------------------------------ the module

/** Writes a frame (side, up, forward, each scaled) standing at (px, py, pz) into a matrix array at `o`. */
function setFrame(out, o, sx, sy, sz, ux, uy, uz, fx, fy, fz, px, py, pz, ks, ku, kf) {
  out[o] = sx * ks
  out[o + 1] = sy * ks
  out[o + 2] = sz * ks
  out[o + 3] = 0
  out[o + 4] = ux * ku
  out[o + 5] = uy * ku
  out[o + 6] = uz * ku
  out[o + 7] = 0
  out[o + 8] = fx * kf
  out[o + 9] = fy * kf
  out[o + 10] = fz * kf
  out[o + 11] = 0
  out[o + 12] = px
  out[o + 13] = py
  out[o + 14] = pz
  out[o + 15] = 1
}

/** An instanced mesh that moves every frame (so it is never culled) and casts no shadow. */
function fleet(geometry, material, count, matrix = null) {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  if (matrix) mesh.instanceMatrix = matrix
  else mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/** A cloud of camera-facing glows whose positions and colours are rewritten every frame. */
function glows(count, material) {
  const geometry = new THREE.BufferGeometry()
  const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const color = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('position', position)
  geometry.setAttribute('color', color)
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1))
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

// Where each flying car's glows sit (local: +x left, +y up, +z forward). `kind` says how a glow
// behaves: a head lamp shines forwards, a tail lamp backwards, a nav light breathes slowly.
const SKYCAR_DOTS = [
  { at: [0.5, 0.3, 2.34], color: rgb('#eef6ff', 2.4), size: 2.0, kind: 'head' },
  { at: [-0.5, 0.3, 2.34], color: rgb('#eef6ff', 2.4), size: 2.0, kind: 'head' },
  { at: [0, 0.46, -2.6], color: rgb('#ff2a44', 2.2), size: 2.6, kind: 'tail' },
  { at: [POD_X, 0.18, -2.64], color: rgb('#ff7a2b', 1.4), size: 0.9, kind: 'tail' },
  { at: [-POD_X, 0.18, -2.64], color: rgb('#ff7a2b', 1.4), size: 0.9, kind: 'tail' },
  { at: [1.16, 0.62, -0.5], color: rgb('#ff3b5c', 2.0), size: 1.1, kind: 'nav', period: 1.7, phase: 0 },
  { at: [-1.16, 0.62, -0.5], color: rgb('#3bff9d', 2.0), size: 1.1, kind: 'nav', period: 1.7, phase: 0 },
  { at: [0, 1.04, -0.7], color: rgb('#ffb02b', 2.2), size: 1.0, kind: 'nav', period: 2.6, phase: 1.3 },
]
const CAR_DOTS = [
  // Glare centres 11 cm ahead of the lamp faces: a glow is depth-tested at its centre, so it must sit clear of the body.
  { at: [CAR_HEAD[0], CAR_HEAD[1], CAR_HEAD[2] + 0.17], color: rgb('#fff4e2', 1.9), size: 1.0, kind: 'head' },
  { at: [-CAR_HEAD[0], CAR_HEAD[1], CAR_HEAD[2] + 0.17], color: rgb('#fff4e2', 1.9), size: 1.0, kind: 'head' },
  { at: [CAR_TAIL[0], CAR_TAIL[1], CAR_TAIL[2] - 0.1], color: rgb('#ff2a44', 1.8), size: 0.9, kind: 'tail' },
  { at: [-CAR_TAIL[0], CAR_TAIL[1], CAR_TAIL[2] - 0.1], color: rgb('#ff2a44', 1.8), size: 0.9, kind: 'tail' },
]
// The wet-road reflections under each street car's lamps: [side, forward, width, colour, kind].
const CAR_STREAKS = [
  [CAR_HEAD[0], CAR_HEAD[2], 0.42, rgb('#fff0d8', 0.42), 'head'],
  [-CAR_HEAD[0], CAR_HEAD[2], 0.42, rgb('#fff0d8', 0.42), 'head'],
  [CAR_TAIL[0], CAR_TAIL[2], 0.5, rgb('#ff2b40', 0.55), 'tail'],
  [-CAR_TAIL[0], CAR_TAIL[2], 0.5, rgb('#ff2b40', 0.55), 'tail'],
]

const PAINT_SKY = ['#7d8798', '#5a1620', '#1d2a44', '#2a2a30', '#6b5a3a', '#3a2450']
const PAINT_ROAD = ['#0e0f13', '#6a1220', '#b8962a', '#c8ccd4', '#1b2a4a']
const UNDERGLOW = ['#2bf3ff', '#ff2bd6', '#7b5cff', '#2bf3ff', '#ff3b5c', '#3bff9d']

/** Builds the traffic into `group`; returns its per-frame update. */
export function buildTraffic(group, ctx) {
  const E = ctx.extent
  const street = ctx.street ?? 26.2
  // Flying traffic also keeps off the road in front of the office: that is where the camera looks from.
  const keep = { x0: CLEAR.x0, x1: E + CLEAR.pad, z0: CLEAR.z0, z1: NO_FLY_SOUTH }

  // ---- what already stands: the scenery groups built before this one (see the header)
  const roots = ctx.sceneryRoots ?? ctx.obstacles ?? (ctx.scene ? [ctx.scene] : [])
  const field = heightField(
    roots,
    { x0: CLEAR.x0, x1: E + CLEAR.pad, z0: CLEAR.z0, z1: CLEAR.z1 },
    { x0: -175, x1: E + 175, z0: -175, z1: NO_FLY_SOUTH + 2 },
    { x0: -340, x1: E + 340, z0: -300, z1: NO_FLY_SOUTH + 2 },
  )
  if (field.wide.box(-340, -300, E + 340, -8) <= 20) {
    console.warn('traffic.js: found no tower taller than 20 m north of the office, so the sky traffic will fly through the skyline. Build the skyline, billboards and street first and add their groups to ctx.scene (or pass them as ctx.sceneryRoots) before buildTraffic.')
  }

  // ---- flying cars on their lanes
  const lanes = buildLanes(E, street, field, keep)
  const fly = []
  lanes.forEach((lane, li) => {
    const { cars, speed } = lane.spec
    for (let i = 0; i < cars; i += 1) {
      const key = `fly${li}:${i}`
      fly.push({ lane, speed, s: ((i + 0.35 * unit(key)) / cars) * lane.length, phase: unit(`${key}p`) * Math.PI * 2 })
    }
  })
  const glowMat = glowMaterial()
  const nearDots = dotMaterial()
  const farDots = dotMaterial()

  const flyMatrix = new THREE.InstancedBufferAttribute(new Float32Array(fly.length * 16), 16).setUsage(THREE.DynamicDrawUsage)
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.72 })
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  const flyBodies = fleet(skycarBody(), bodyMat, fly.length, flyMatrix)
  const flyLamps = fleet(skycarLamps(), lampMat, fly.length, flyMatrix)
  const flyGlow = fleet(skycarUnderglow(), glowMat, fly.length, flyMatrix)
  const beams = fleet(moded(cone(BEAM_SPREAD, rgb('#dfe8ff', 0.12)).rotateX(0.06), 1, 0), glowMat, fly.length)
  const trails = fleet(skycarTrail(), glowMat, fly.length)
  const tint = new THREE.Color()
  fly.forEach((car, i) => {
    flyBodies.setColorAt(i, tint.set(PAINT_SKY[hash(`paint${i}`) % PAINT_SKY.length]))
    flyGlow.setColorAt(i, tint.set(UNDERGLOW[hash(`under${i}`) % UNDERGLOW.length]))
  })
  group.add(flyBodies, flyLamps, flyGlow, beams, trails)

  // ---- street cars: two eastbound on the north lane, three westbound on the south one
  const roadStart = -80
  const roadSpan = E + 160
  const ground = []
  const lanesOnRoad = [
    { z: street - 1.6, dir: 1, cars: 2, speed: 10.5 },
    { z: street + 1.6, dir: -1, cars: 3, speed: 9 },
  ]
  for (const road of lanesOnRoad) {
    for (let i = 0; i < road.cars; i += 1) {
      const key = `road${road.dir}:${i}`
      ground.push({ z: road.z, dir: road.dir, speed: road.speed, x0: roadStart + ((i + 0.4 * unit(key)) / road.cars) * roadSpan })
    }
  }
  const groundMatrix = new THREE.InstancedBufferAttribute(new Float32Array(ground.length * 16), 16).setUsage(THREE.DynamicDrawUsage)
  const carBodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.6 })
  const carBodies = fleet(carBody(), carBodyMat, ground.length, groundMatrix)
  const carLampsMesh = fleet(carLamps(), lampMat, ground.length, groundMatrix)
  const carGlowMesh = fleet(carGlow(), glowMat, ground.length, groundMatrix)
  const streaks = fleet(moded(ribbon(1, 1, 0.6, [1, 1, 1], 1.5, 5), 0, 1), glowMat, ground.length * CAR_STREAKS.length)
  ground.forEach((car, i) => {
    carBodies.setColorAt(i, tint.set(PAINT_ROAD[i % PAINT_ROAD.length]))
    carGlowMesh.setColorAt(i, tint.set(UNDERGLOW[(i * 2 + 1) % UNDERGLOW.length]).multiplyScalar(0.6))
  })
  for (let i = 0; i < ground.length * CAR_STREAKS.length; i += 1) streaks.setColorAt(i, tint.setRGB(0, 0, 0))
  group.add(carBodies, carLampsMesh, carGlowMesh, streaks)

  // Each street car lights the rain ahead of it: one light spot 4 m in front of its head lamps, moved
  // in place every frame (the weather copies spot positions every frame and eases a spot's share in
  // and out, so the lit rain glides along with the car) and dimmed with the car at the loop's ends.
  const HEADLIGHT = new THREE.Color('#fff0d8')
  const carSpots = ground.map(() => ({ position: new THREE.Vector3(0, 1, 0), color: new THREE.Color(0, 0, 0), radius: 4.5 }))
  ctx.lightSpots?.push(...carSpots)

  // ---- lamp glare and navigation lights for every car, in one cloud of glows
  const dotSpecs = []
  fly.forEach((car, c) => SKYCAR_DOTS.forEach(d => dotSpecs.push({ ...d, car: c, sky: true })))
  ground.forEach((car, c) => CAR_DOTS.forEach(d => dotSpecs.push({ ...d, car: c, sky: false })))
  const dots = glows(dotSpecs.length, nearDots)
  dotSpecs.forEach((d, i) => (dots.geometry.attributes.aSize.array[i] = d.size))
  group.add(dots)

  // ---- far streams of sky traffic, both ways along each
  const streamDots = []
  streamSpecs(E, field.wide).forEach((at, si) => {
    const ways = [
      { table: streamTable(at, 1.4, 0, field.wide), palette: [rgb('#ffe9c4', 1.7), rgb('#ffe9c4', 1.7), rgb('#ffe9c4', 1.5), rgb('#9fe8ff', 1.5), rgb('#ffb02b', 1.6)], size: 0.8 },
      { table: streamTable(at, -1.4, 0.8, field.wide), palette: [rgb('#ff3b5c', 1.5), rgb('#ff3b5c', 1.4), rgb('#ff3b5c', 1.5), rgb('#ff2bd6', 1.4)], size: 0.7 },
    ]
    ways.forEach((way, wi) => {
      const count = Math.round(way.table.length / 13)
      for (let i = 0; i < count; i += 1) {
        const key = `stream${si}:${wi}:${i}`
        streamDots.push({
          table: way.table,
          s0: ((i + 0.6 * unit(key)) / count) * way.table.length,
          speed: (17 + 9 * unit(`${key}v`)) * (wi === 0 ? 1 : -1),
          color: way.palette[hash(`${key}c`) % way.palette.length],
          size: way.size,
        })
      }
    })
  })
  const far = glows(streamDots.length, farDots)
  streamDots.forEach((d, i) => (far.geometry.attributes.aSize.array[i] = d.size))
  group.add(far)

  // Preallocated per-frame state: nothing is allocated once built.
  const frames = new Float32Array(fly.length * 13)
  const groundFrames = new Float32Array(ground.length * 13)
  const drawSize = new THREE.Vector2()
  const TAU = Math.PI * 2

  /** How much of a lamp the camera sees: head lamps shine forwards, tail lamps backwards. */
  const facing = (kind, fx, fy, fz, wx, wy, wz, cam) => {
    const vx = cam.x - wx
    const vy = cam.y - wy
    const vz = cam.z - wz
    const toward = (fx * vx + fy * vy + fz * vz) / (Math.hypot(vx, vy, vz) || 1)
    return kind === 'head' ? 0.15 + 0.85 * smooth(-0.3, 0.7, toward) : 0.3 + 0.7 * smooth(-0.3, 0.7, -toward)
  }

  return {
    update(dt, t) {
      const step = Math.min(Math.max(dt, 0), 0.1)
      const cam = ctx.camera.position
      const density = ctx.scene?.fog?.density ?? 0.0045
      glowMat.uniforms.uFade.value = density
      nearDots.uniforms.uFade.value = density * 0.8
      farDots.uniforms.uFade.value = density * 0.45
      ctx.renderer.getDrawingBufferSize(drawSize)
      const scale = (drawSize.y * ctx.camera.projectionMatrix.elements[5]) / 2
      nearDots.uniforms.uScale.value = scale
      farDots.uniforms.uScale.value = scale

      // Flying cars: along their lanes at the lane's pace, banking into the turns, lights as long as the lane allows.
      const m = flyMatrix.array
      const bm = beams.instanceMatrix.array
      const tm = trails.instanceMatrix.array
      for (let c = 0; c < fly.length; c += 1) {
        const car = fly[c]
        const L = car.lane
        const last = L.n - 2
        let u = car.s / L.ds
        let i = Math.min(last, Math.floor(u))
        let a = u - i
        const v = car.speed * (L.pace[i] + (L.pace[i + 1] - L.pace[i]) * a)
        // Off the far end of its path a car starts again at the other end, where it is too small to see.
        car.s = (car.s + v * step) % L.length
        u = car.s / L.ds
        i = Math.min(last, Math.floor(u))
        a = u - i
        const j = i + 1
        // Cars shrink away and fade over their path's first and last 30 m, so nobody sees them go or come back.
        const fade = smooth(0, 30, car.s) * smooth(0, 30, L.length - car.s)
        const px = L.px[i] + (L.px[j] - L.px[i]) * a
        const py = L.py[i] + (L.py[j] - L.py[i]) * a
        const pz = L.pz[i] + (L.pz[j] - L.pz[i]) * a
        let fx = L.fx[i] + (L.fx[j] - L.fx[i]) * a
        let fy = L.fy[i] + (L.fy[j] - L.fy[i]) * a
        let fz = L.fz[i] + (L.fz[j] - L.fz[i]) * a
        const fl = Math.hypot(fx, fy, fz) || 1
        fx /= fl
        fy /= fl
        fz /= fl
        // Lift leans into the turn: up is gravity plus the pull towards the inside of the bend.
        let ux = (L.kx[i] + (L.kx[j] - L.kx[i]) * a) * v * v
        let uz = (L.kz[i] + (L.kz[j] - L.kz[i]) * a) * v * v
        const lean = Math.hypot(ux, uz)
        if (lean > 6.5) {
          ux *= 6.5 / lean
          uz *= 6.5 / lean
        }
        let uy = 9.8
        let sx = uy * fz - uz * fy
        let sy = uz * fx - ux * fz
        let sz = ux * fy - uy * fx
        const sl = Math.hypot(sx, sy, sz) || 1
        sx /= sl
        sy /= sl
        sz /= sl
        ux = fy * sz - fz * sy
        uy = fz * sx - fx * sz
        uz = fx * sy - fy * sx
        setFrame(m, c * 16, sx, sy, sz, ux, uy, uz, fx, fy, fz, px, py, pz, fade, fade, fade)
        const beam = (L.beam[i] + (L.beam[j] - L.beam[i]) * a) * fade
        setFrame(bm, c * 16, sx, sy, sz, ux, uy, uz, fx, fy, fz, px + fx * NOSE + ux * 0.26, py + fy * NOSE + uy * 0.26, pz + fz * NOSE + uz * 0.26, beam, beam, beam)
        // The trail stretches with speed (about 0.6 s of travel), never past the lane's room for it.
        const trail = Math.min(L.trail[i] + (L.trail[j] - L.trail[i]) * a, clamp(v * 0.6, 3, TRAIL_LENGTH))
        setFrame(tm, c * 16, sx, sy, sz, ux, uy, uz, fx, fy, fz, px - fx * TAIL, py - fy * TAIL, pz - fz * TAIL, fade, fade, trail * fade)
        const o = c * 13
        frames[o] = px
        frames[o + 1] = py
        frames[o + 2] = pz
        frames[o + 3] = sx
        frames[o + 4] = sy
        frames[o + 5] = sz
        frames[o + 6] = ux
        frames[o + 7] = uy
        frames[o + 8] = uz
        frames[o + 9] = fx
        frames[o + 10] = fy
        frames[o + 11] = fz
        frames[o + 12] = fade
      }
      flyMatrix.needsUpdate = true
      beams.instanceMatrix.needsUpdate = true
      trails.instanceMatrix.needsUpdate = true

      // Street cars: round and round the road, with reflections stretching towards the camera.
      const g = groundMatrix.array
      const sm = streaks.instanceMatrix.array
      const sc = streaks.instanceColor.array
      for (let c = 0; c < ground.length; c += 1) {
        const car = ground[c]
        const travelled = car.x0 - roadStart + car.dir * car.speed * t
        const x = roadStart + (((travelled % roadSpan) + roadSpan) % roadSpan)
        const d = car.dir
        // Round the loop's far ends a car shrinks away and comes back, too far off to the side to notice.
        const fade = smooth(0, 15, x - roadStart) * smooth(0, 15, roadStart + roadSpan - x)
        setFrame(g, c * 16, 0, 0, -d, 0, 1, 0, d, 0, 0, x, 0, car.z, fade, fade, fade)
        const spot = carSpots[c]
        spot.position.set(x + d * (CAR_HEAD[2] + 4), 1, car.z)
        spot.color.copy(HEADLIGHT).multiplyScalar(fade)
        const o = c * 13
        groundFrames[o] = x
        groundFrames[o + 1] = 0
        groundFrames[o + 2] = car.z
        groundFrames[o + 3] = 0
        groundFrames[o + 4] = 0
        groundFrames[o + 5] = -d
        groundFrames[o + 6] = 0
        groundFrames[o + 7] = 1
        groundFrames[o + 8] = 0
        groundFrames[o + 9] = d
        groundFrames[o + 10] = 0
        groundFrames[o + 11] = 0
        groundFrames[o + 12] = fade
        for (let k = 0; k < CAR_STREAKS.length; k += 1) {
          const streak = CAR_STREAKS[k]
          const color = streak[3]
          const wx = x + d * streak[1]
          const wz = car.z - d * streak[0]
          let vx = cam.x - wx
          let vz = cam.z - wz
          const vl = Math.hypot(vx, vz) || 1
          vx /= vl
          vz /= vl
          const n = c * CAR_STREAKS.length + k
          setFrame(sm, n * 16, vz, 0, -vx, 0, 1, 0, vx, 0, vz, wx + vx * 0.15, 0.12, wz + vz * 0.15, streak[2] * fade, 1, 3.4 * fade)
          const shine = facing(streak[4], d, 0, 0, wx, 0.5, wz, cam) * fade
          sc[n * 3] = color[0] * shine
          sc[n * 3 + 1] = color[1] * shine
          sc[n * 3 + 2] = color[2] * shine
        }
      }
      groundMatrix.needsUpdate = true
      streaks.instanceMatrix.needsUpdate = true
      streaks.instanceColor.needsUpdate = true

      // Glare and navigation lights, riding on the cars.
      const dp = dots.geometry.attributes.position.array
      const dc = dots.geometry.attributes.color.array
      for (let i = 0; i < dotSpecs.length; i += 1) {
        const d = dotSpecs[i]
        const f = d.sky ? frames : groundFrames
        const o = d.car * 13
        const lx = d.at[0]
        const ly = d.at[1]
        const lz = d.at[2]
        const wx = f[o] + f[o + 3] * lx + f[o + 6] * ly + f[o + 9] * lz
        const wy = f[o + 1] + f[o + 4] * lx + f[o + 7] * ly + f[o + 10] * lz
        const wz = f[o + 2] + f[o + 5] * lx + f[o + 8] * ly + f[o + 11] * lz
        dp[i * 3] = wx
        dp[i * 3 + 1] = wy
        dp[i * 3 + 2] = wz
        let k
        if (d.kind === 'nav') k = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((t / d.period) * TAU + d.phase + (d.sky ? fly[d.car].phase : 0)))
        else k = facing(d.kind, f[o + 9], f[o + 10], f[o + 11], wx, wy, wz, cam)
        k *= f[o + 12]
        dc[i * 3] = d.color[0] * k
        dc[i * 3 + 1] = d.color[1] * k
        dc[i * 3 + 2] = d.color[2] * k
      }
      dots.geometry.attributes.position.needsUpdate = true
      dots.geometry.attributes.color.needsUpdate = true

      // The far streams: lights sliding along their curves, fading in and out at the ends.
      const fp = far.geometry.attributes.position.array
      const fc = far.geometry.attributes.color.array
      for (let i = 0; i < streamDots.length; i += 1) {
        const d = streamDots[i]
        const T = d.table
        let s = (d.s0 + d.speed * t) % T.length
        if (s < 0) s += T.length
        const u = s / T.ds
        const k = Math.min(T.n - 2, Math.floor(u))
        const a = u - k
        fp[i * 3] = T.x[k] + (T.x[k + 1] - T.x[k]) * a
        fp[i * 3 + 1] = T.y[k] + (T.y[k + 1] - T.y[k]) * a
        fp[i * 3 + 2] = T.z[k] + (T.z[k + 1] - T.z[k]) * a
        // Faded in and out at the ends, and wherever a tower too tall to clear stands in the way.
        const fade = Math.min(1, s / 30, (T.length - s) / 30) * (T.v[k] + (T.v[k + 1] - T.v[k]) * a)
        fc[i * 3] = d.color[0] * fade
        fc[i * 3 + 1] = d.color[1] * fade
        fc[i * 3 + 2] = d.color[2] * fade
      }
      far.geometry.attributes.position.needsUpdate = true
      far.geometry.attributes.color.needsUpdate = true
    },
  }
}
