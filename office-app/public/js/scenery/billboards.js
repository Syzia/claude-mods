// /Users/hunterjolly/claude-mods/office-app/public/js/scenery/billboards.js
// The big screens that light the city: a building-sized video advert on a dark tower to
// the north-west, mid-size boards hung on the towers behind the office and on the flanks,
// two pole rigs across the road, a news ticker under the advert, and a hologram on the
// open strip between the plaza's water channel and the towers, where two koi circle a
// night-market sign.
// Every brand, word and face here is invented.
//
// The skyline is built first, so everything here is fitted round it: screens hang on the
// walls of its towers (found by rays against their triangles), never through them.
// The street is built after this module, so its ground is kept by rule instead: nothing here
// stands in street.js's span (x -10.5 to extent + 10.5, from the plaza to the north coping of
// its water channel at z -11.35), and nothing floats where its garden pines spread their leaves
// (from the north row at z -6.4 they reach as far as z -10, up to 8 m up).
//
// Ads are painted once onto power-of-two canvases (mipmapped). Screens cross-fade, pan
// and scroll between them on the GPU, so the only canvas ever redrawn is the advert
// face: six times a second at most, and only the eyes and lips, only while it is on screen.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp, hash } from '../util.js'

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
const _p = new THREE.Vector3()
const _q = new THREE.Vector3()
const FADE = 2.4 // seconds one ad takes to cross-fade into the next
const FACE_FPS = 6 // the face's eyes and lips move with periods of 20 s and more: six frames a second is plenty
const LATIN = '"Avenir Next Condensed", "Futura", "Helvetica Neue", system-ui, sans-serif'
const KANA = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif'
const NEON = ['#ff2bd6', '#2bf3ff', '#3bff9d', '#ffb02b', '#ff3b5c']
const WARM_PINK = new THREE.Color('#ff6fa8')

/**
 * The building-sized advert, north-west of the office. `base` is the lowest its screen's bottom edge goes.
 * When nothing stands at (x, z) it gets its own monolith there [w, h, d], turned to face the default camera;
 * when the skyline has built there it hangs on the tower wall within `reach` metres that shows the most of it.
 *
 * For the integrator: the brief asks for a base near 20 m; 14 keeps more of the screen low enough to see. Even
 * so, at main.js's default pose (focusHome: pitch about 28.6 degrees, 38 degree FOV, maxPolarAngle 1.22) the top
 * of the view is about 9.6 degrees below the horizon, so the advert (like the moon and the searchlights) only
 * comes into view when the camera is tilted up. Loosening main.js (maxPolarAngle about 1.45, or a lower default
 * pitch) brings it into the opening shot; nothing here needs to change for that.
 */
const MEGA = { x: -28, z: -38, width: 18, height: 46, base: 14, tower: [24, 70, 18], reach: 45 }
const MEGA_ASPECT = MEGA.width / MEGA.height
const MEGA_SMALLEST = 0.6 // on a borrowed wall it takes the biggest size the wall carries, shape kept, down to this
const MEGA_GRID = [-0.4, 0, 0.4].flatMap(fx => [-0.4, -0.13, 0.13, 0.4].map(fy => [fx, fy])) // where its share seen is sampled
const BOARD_GRID = [[-0.48, -0.48], [0.48, -0.48], [0.48, 0.48], [-0.48, 0.48], [0, 0]] // a board is seen whole: corners and middle
const MAX_TURN = 0.3 // how far (radians, from the camera) a board may hang from where its spot asks
const SLIDE = [0, -2, 2, -4, 4] // metres along a wall to try a board at, nearest first
const RISE = [0, 2, -2, 4, -4, 6, 8, 10, 12, 14] // metres up (or down) a wall to try it at
const BOARD_TRIES = [[1, 'wall'], [0.75, 'wall'], [1, 'stand'], [0.75, 'stand']] // a board's size and mounting, in the order tried
const STAND_STEPS = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, -3, -6, -9] // metres toward the camera to try a stand at, then back

/**
 * Mid-size boards: a point the default camera looks at (x from the office centre for `mid`,
 * from x 0 for `west`, from the office's east end for `east`), the board's size and its ads.
 * Each hangs on the tower wall nearest that line of sight that carries it whole and in view, so the
 * skyline never hides it; failing that it stands on legs, and failing that it is left out.
 */
const SPOTS = [
  { side: 'mid', x: -17, y: 6, z: -14, w: 9, h: 4.5, ads: ['noodle', 'soda', 'arcade'] },
  { side: 'mid', x: 9, y: 6.5, z: -16, w: 10, h: 5, ads: ['soda', 'yozora', 'miravo'], light: true },
  { side: 'mid', x: -4, y: 14, z: -24, w: 8, h: 4, ads: ['orvex', 'kumo'] },
  { side: 'mid', x: 26, y: 10, z: -20, w: 4, h: 8, ads: ['kana', 'sodaTall'] },
  { side: 'west', x: -17, y: 9, z: 2, w: 8, h: 4, ads: ['visor', 'noodle', 'kumo'] },
  { side: 'east', x: 17, y: 8, z: 6, w: 4, h: 8, ads: ['ramenTall', 'kana'] },
]

/** The pole rigs across the road: a big board with a smaller one stacked above, beside (never in front of) the office. */
const RIGS = [
  { side: 'west', x: -12, z: 34, yaw: 0.95, ads: [['orvex', 'miravo', 'yozora'], ['arcade', 'soda']] },
  { side: 'east', x: 12, z: 34, yaw: -0.95, ads: [['kumo', 'visor', 'noodle'], ['yozora', 'orvex']] },
]

/**
 * The hologram: a sign floating over the open strip behind the office, between the north coping of the street's
 * water channel (z -11.35) and the skyline (which builds nothing south of z -13 between x -11 and extent + 11),
 * koi circling it. Its projector stands on that strip, so nothing of it is in the street's garden row. It takes
 * whichever of the `choices` (x from the office centre) the default camera sees clearest of the boards, of those
 * whose koi stay inside the towers' open corridor (`open` metres out from either end of the office).
 */
const HOLO = { choices: [-4, 3, -11, 10, -18], y: 7.5, z: -11.75, w: 7.5, h: 3.6, open: 10.8 }
const SWIM = [HOLO.w / 2 + 2.6, HOLO.h / 2 + 1.7] // the koi's loop round the sign: half-width, half-height
/** The two koi: colours, the size of each one's loop (times SWIM), where it starts on it, metres in front of the sign. */
const KOI = [
  { body: '#f4f0ff', spots: '#ff4a1c', radius: 1, phase: 0, z: 0.5 },
  { body: '#9ffcff', spots: '#ffb02b', radius: 1.12, phase: Math.PI, z: -0.5 },
]
/**
 * The room the koi sweep round the sign's middle, worked out from koiGeometry() and swim() (the bigger loop, tails
 * swung out, bobbing): `side` metres either way along it, `below` and `above`, and `deep` in front and behind
 * (0.5 m out plus half a body). The sign faces due south: turned toward the camera, the loop's ends would swing
 * a metre or more toward the pines or the tower fronts.
 */
const KOI_ROOM = { side: 10.6, below: 6.9, above: 6.9, deep: 0.9 }

/** Every ad: canvas size (powers of two), the shape of screen it is painted for (width / height), painter, motion. */
const ADS = {
  soda: { px: [512, 256], aspect: 2, paint: paintSoda, motion: 'drift' },
  noodle: { px: [512, 256], aspect: 2, paint: paintNoodle, motion: 'drift' },
  orvex: { px: [512, 256], aspect: 2, paint: paintOrvex, motion: 'drift' },
  yozora: { px: [512, 256], aspect: 2, paint: paintYozora, motion: 'drift' },
  kumo: { px: [512, 256], aspect: 2, paint: paintKumo, motion: 'drift' },
  arcade: { px: [512, 256], aspect: 2, paint: paintArcade, motion: 'still' },
  miravo: { px: [512, 256], aspect: 2, paint: paintMiravo, motion: 'drift' },
  visor: { px: [512, 256], aspect: 2, paint: paintVisor, motion: 'drift' },
  sodaTall: { px: [256, 512], aspect: 0.5, paint: paintSoda, motion: 'drift' },
  ramenTall: { px: [256, 512], aspect: 0.5, paint: paintNoodle, motion: 'drift' },
  kana: { px: [256, 2048], aspect: 0.125, paint: paintKana, motion: 'scroll', view: [1, 0.25], wrapY: true },
  megaCan: { px: [512, 1024], aspect: MEGA_ASPECT, paint: paintSoda, motion: 'drift' },
  megaScroll: { px: [512, 2048], aspect: MEGA_ASPECT / 2, paint: paintKana, motion: 'scroll', view: [1, 0.5], wrapY: true },
  megaCar: { px: [512, 1024], aspect: MEGA_ASPECT, paint: paintOrvex, motion: 'pan' },
  ticker: { px: [4096, 64], aspect: 64, paint: paintTicker, motion: 'ticker', wrapX: true },
}

// ------------------------------------------------------------------ shaders
// Every pow() base is clamped at 0: a base a hair below zero gives NaN, and the glow pass spreads one NaN
// pixel into a black block.

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const SCREEN_FRAG = /* glsl */ `
uniform sampler2D mapA;
uniform sampler2D mapB;
uniform vec4 xfA;
uniform vec4 xfB;
uniform float fade;
uniform float gain;
uniform float time;
uniform vec3 grid;
uniform vec3 panel;
varying vec2 vUv;
#include <fog_pars_fragment>

// Area under a run of slats with gaps between them, from 0 to y (one slat per unit).
float slatSum(float y, float gap) {
  return floor(y) * (1.0 - gap) + max(fract(y) - gap, 0.0);
}

// The slats box-filtered over this pixel: crisp strips up close, an even average far off (no shimmer).
float slats(float y, float gap) {
  float w = max(fwidth(y), 1e-4);
  return (slatSum(y + 0.5 * w, gap) - slatSum(y - 0.5 * w, gap)) / w;
}

void main() {
  vec3 a = texture2D(mapA, vUv * xfA.xy + xfA.zw).rgb;
  vec3 b = texture2D(mapB, vUv * xfB.xy + xfB.zw).rgb;
  vec3 color = mix(a, b, fade);
  // grid: x slat rows over the height, y gap between slats, z LED columns over the width.
  float rows = grid.x > 0.0 ? slats(vUv.y * grid.x, grid.y) : 1.0;
  float dots = grid.z > 0.0 ? mix(0.8, 1.0, slats(vUv.x * grid.z, 0.3)) : 1.0;
  // panel: x columns, y rows, z seam width; the seams sit centred on the panel joins.
  float seams = 1.0;
  if (panel.z > 0.0) seams = slats(vUv.x * panel.x + 0.5 * panel.z, panel.z) * slats(vUv.y * panel.y + 0.5 * panel.z, panel.z);
  // A soft bright band rolls down the screen every twenty seconds, like a refresh.
  float roll = 1.0 + 0.12 * pow(max(0.5 + 0.5 * sin((vUv.y + time * 0.05) * 6.2832), 0.0), 8.0);
  gl_FragColor = vec4(color * gain * rows * dots * seams * roll, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const HOLO_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float time;
uniform float gain;
uniform vec3 tint;
varying vec2 vUv;
void main() {
  // The colours part a little, drifting slowly: projected light, not a printed sign.
  float shift = 0.004 + 0.002 * sin(time * 0.9);
  vec3 c = vec3(texture2D(map, vUv + vec2(shift, 0.0)).r, texture2D(map, vUv).g, texture2D(map, vUv - vec2(shift, 0.0)).b);
  float bands = 0.72 + 0.28 * sin(vUv.y * 30.0 - time * 1.6);
  float sweep = pow(max(0.5 + 0.5 * sin((vUv.y - time * 0.08) * 6.2832), 0.0), 12.0);
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = min(e.x, e.y * 2.0);
  float inside = smoothstep(0.0, 0.05, edge);
  float outline = (1.0 - smoothstep(0.012, 0.03, edge)) * 0.55;
  vec3 col = (c * (bands + 0.8 * sweep) * inside + tint * outline) * gain;
  gl_FragColor = vec4(col * (gl_FrontFacing ? 1.0 : 0.3), 1.0);
}
`

const BEAM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying float vH;
void main() {
  vH = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const BEAM_FRAG = /* glsl */ `
uniform vec3 color;
uniform float time;
uniform float gain;
varying vec3 vNormal;
varying vec3 vView;
varying float vH;
void main() {
  float core = pow(min(abs(dot(normalize(vNormal), normalize(vView))), 1.0), 3.0);
  float fall = 0.15 + 0.85 * pow(max(1.0 - vH, 0.0), 1.6);
  float drift = 0.8 + 0.2 * sin(vH * 18.0 - time * 2.0);
  gl_FragColor = vec4(color * core * fall * drift * gain, 1.0);
}
`

const KOI_VERT = /* glsl */ `
uniform float time;
uniform float phase;
attribute float along;
attribute float fin;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
varying float vFin;
varying float vY;
void main() {
  vec3 p = position;
  // The body swings side to side, more toward the tail: a koi's swim.
  p.x += sin(time * 2.2 + phase - along * 4.5) * (0.12 + 0.55 * along * along);
  vLocal = position;
  vFin = fin;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vY = world.y;
  vec4 mv = viewMatrix * world;
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const KOI_FRAG = /* glsl */ `
uniform vec3 body;
uniform vec3 spots;
uniform float time;
uniform float gain;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
varying float vFin;
varying float vY;
void main() {
  float rim = pow(max(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 0.0), 2.0);
  // Markings from a few slow sines over the body: the same patches every frame.
  float n = sin(vLocal.z * 1.9 + 0.7) * cos(vLocal.x * 2.6 - vLocal.z * 0.9) + 0.6 * sin(vLocal.z * 3.3 + 1.9);
  vec3 tint = mix(body, spots, smoothstep(0.15, 0.45, n));
  float bands = 0.78 + 0.22 * sin(vY * 7.0 - time * 1.3);
  float light = vFin > 0.5 ? 0.3 + 0.5 * rim : 0.07 + 1.25 * rim;
  gl_FragColor = vec4(tint * light * bands * gain, 1.0);
}
`

// ------------------------------------------------------------------ the city's screens

/** Builds every screen, hologram and their glow into `group`; returns the per-frame update. */
export function buildBillboards(group, ctx) {
  const { extent, scene } = ctx
  const cx = extent / 2
  scene.updateMatrixWorld(true)
  // The default camera (main.js focusHome): boards hang where it can see them.
  const eye = new THREE.Vector3(cx, 0, 9.5).add(new THREE.Vector3(0, 18, 33).setLength(Math.max(36, extent * 0.92)))
  const solids = new Solids(towersIn(scene, group, extent))
  const walls = facingWalls(solids, eye)
  const hung = [] // the room each screen and board takes, so nothing is hung through another
  const seen = [] // how the mid boards look from the default camera, so the hologram can keep clear of them
  const parts = { facade: [], metal: [], neon: [], beacons: [] }
  const screens = []
  const halos = new Halos()
  const streaks = new Streaks(extent)
  const lights = []
  const lightSpots = ctx.lightSpots ?? []
  // A footprint keeps a metre clear of the office's patch (x -6..extent+6, z -4..24) by lying wholly on one side of it.
  const AWAY = [p => p.x <= -7, p => p.x >= extent + 7, p => p.z <= -5]
  // Where each kind of board's frame (and legs) may go; its glow only has to keep clear of the office's patch.
  // Stands keep off the street's ground, which is not built yet: north of the hologram's strip in the middle,
  // past the street's flank planters and trees (x -10.5 to -6 and its mirror) on the sides.
  const SIDES = {
    mid: { wall: p => p.z <= -5, stand: p => p.z <= HOLO.z - KOI_ROOM.deep - 0.1 },
    west: { wall: p => p.x <= -7, stand: p => p.x <= -11 },
    east: { wall: p => p.x >= extent + 7, stand: p => p.x >= extent + 11 },
  }

  /** Puts a screen `y` up and `z` out from a frame's wall, with its glow, its reflection and its light on the rain. */
  function addScreen(frame, y, z, w, h, ads, options = {}) {
    const { pitch = 0.16, halo = 0.32, rings = null, streak = 0, floor = 0, spill = 10, ...rest } = options
    const screen = makeScreen(w, h, ads, { rows: h / pitch, columns: w / (pitch * 1.2), ...rest })
    screen.mesh.position.copy(at(frame, 0, y, z))
    screen.mesh.rotation.y = frame.yaw
    group.add(screen.mesh)
    screens.push(screen)
    const margin = haloMargin(w, h)
    halos.add(screen, frame, y, z + 0.08, w, h, rings ?? [[0.05, 1], [margin * 0.12, 0.6], [margin * 0.4, 0.2], [margin, 0]], halo)
    // The smear on wet ground: only where the wall comes down to the street, not over a roof's edge.
    if (streak && floor < 0.3) streaks.add(screen, at(frame, 0, 0.08, Math.max(z, 1) + 0.6), frame.normal, w, streak)
    lightSpots.push({ position: at(frame, 0, y, z + 1.2), color: screen.color, radius: spill })
    return screen
  }

  /**
   * A real light in front of a screen, tinted by what it shows pulled `warmth` of the way to warm pink. Only
   * if the scenery's light budget allows; it never casts shadows.
   */
  function addLight(screen, position, distance, intensity, warmth = 0) {
    if (!ctx.claimLight?.()) return
    const light = new THREE.PointLight(screen.color, intensity, distance, 2)
    light.castShadow = false
    light.position.copy(position)
    group.add(light)
    lights.push({ light, screen, warmth })
  }

  // ---- Finding room on the skyline.

  /**
   * Whether a footprint `reach` metres either side of a frame's middle, from `z0` to `z1` out from its wall,
   * lies wholly on one side of the office's patch: the side `only` names, or any.
   */
  function keepsClear(frame, reach, z0, z1, only = null) {
    const points = [at(frame, -reach, 0, z0), at(frame, reach, 0, z0), at(frame, -reach, 0, z1), at(frame, reach, 0, z1)]
    return (only ? [only] : AWAY).some(test => points.every(test))
  }

  /** The world box a frame-space block takes: `half` metres either side of the middle, z0..z1 out, y0..y1 up. */
  function roomOf(frame, half, z0, z1, y0, y1) {
    const box = new THREE.Box3()
    for (const sx of [-half, half]) for (const z of [z0, z1]) for (const y of [y0, y1]) box.expandByPoint(at(frame, sx, y, z))
    return box
  }

  /** The lowest and highest tops of whatever stands under points `outs` metres in front of a frame, `half` either side of its middle. */
  function groundUnder(frame, half, outs, count = 5) {
    let low = Infinity
    let top = 0
    for (const out of outs) {
      for (let k = 0; k < count; k += 1) {
        const hit = solids.cast(at(frame, -half + (2 * half * k) / (count - 1), 400, out, _p), DOWN, 400)
        const y = hit ? hit.point.y : 0
        low = Math.min(low, y)
        top = Math.max(top, y)
      }
    }
    return [low, top]
  }

  /** Whether no part of the towers stands anywhere on the frame-space patch `half` either side of the middle, z0..z1 out. */
  function groundFree(frame, half, z0, z1) {
    const across = Math.ceil((2 * half) / 3)
    const deep = Math.ceil((z1 - z0) / 3)
    for (let i = 0; i <= across; i += 1) {
      for (let j = 0; j <= deep; j += 1) {
        const hit = solids.cast(at(frame, -half + (2 * half * i) / across, 400, z0 + ((z1 - z0) * j) / deep, _p), DOWN, 400)
        if (hit && hit.point.y > 0.3) return false
      }
    }
    return true
  }

  /**
   * Whether anything juts from a wall's face (a sign and its box, a neon trim, a ledge) where a board `w` wide
   * spans heights y0..y1. Rays drop down the face, rise up it and run across it both ways from beyond the
   * board's ends, so each meets what is there from outside: a ray that starts inside a box never sees it.
   */
  function faceBusy(frame, w, y0, y1) {
    const half = w / 2 + 0.3
    const across = Math.max(5, Math.ceil((2 * half) / 2.4) + 1)
    for (let k = 0; k < across; k += 1) {
      const s = -half + (2 * half * k) / (across - 1)
      if (solids.cast(at(frame, s, y1, 0.45, _p), DOWN, y1 - y0)) return true
      if (solids.cast(at(frame, s, y0, 0.45, _p), UP, y1 - y0)) return true
    }
    const rows = Math.max(2, Math.ceil((y1 - y0) / 1.2) + 1)
    for (let j = 0; j < rows; j += 1) {
      const y = y0 + 0.2 + ((y1 - y0 - 0.4) * j) / (rows - 1)
      for (const out of [0.2, 0.45]) {
        for (const side of [-1, 1]) {
          _q.copy(frame.right).multiplyScalar(-side)
          if (solids.cast(at(frame, side * (half + 1.5), y, out, _p), _q, 2 * half + 3)) return true
        }
      }
    }
    return false
  }

  /**
   * Whether a wall is only the front of something fixed to a bigger wall (a sign's box, a pilaster): the bigger
   * wall shows a little behind it just past either end. Such a front is no place to hang a board.
   */
  function proud(wall) {
    if (wall.proud === undefined) {
      _q.copy(wall.normal).negate()
      const y = (wall.y0 + wall.y1) / 2
      wall.proud = [wall.s0 - 0.3, wall.s1 + 0.3].some(s => {
        const hit = solids.cast(_p.copy(wall.normal).multiplyScalar(wall.o + 1.6).addScaledVector(wall.right, s).setY(y), _q, 3.2)
        return !!hit && hit.distance > 1.75 && hit.normal.dot(wall.normal) > 0.95
      })
    }
    return wall.proud
  }

  /** Whether the wall is truly there, flat, behind each corner of a w x h board centred at height y. */
  function carried(frame, w, h, y) {
    _q.copy(frame.normal).negate()
    return CORNERS.every(([sx, sy]) => {
      const hit = solids.cast(at(frame, sx * (w / 2 + 0.4), y + sy * (h / 2 + 0.4), 1.6, _p), _q, 2)
      return !!hit && Math.abs(hit.distance - 1.6) < 0.15
    })
  }

  /** The share of points on a w x h face (`grid`, as fractions of its size) `out` metres in front of a frame that the camera sees. */
  function seenShare(frame, y, w, h, out, grid) {
    let count = 0
    for (const [fx, fy] of grid) {
      const sight = at(frame, fx * w, y + fy * h, out, _p).sub(eye)
      const far = sight.length()
      if (!solids.cast(eye, sight.divideScalar(far), far - 0.3)) count += 1
    }
    return count / grid.length
  }

  /**
   * Where on a wall a w x h board goes before anything is checked: as near as the wall allows to where the
   * camera's line of sight to `target` meets it, `edge` metres in from its ends. `aimY` overrides the height.
   */
  function aimOn(wall, target, w, h, edge, aimY = null) {
    const look = _p.subVectors(target, eye).normalize()
    const facing = look.dot(wall.normal)
    let s = (wall.s0 + wall.s1) / 2
    let y = target.y
    if (facing < -0.05) {
      const t = (wall.o - eye.x * wall.normal.x - eye.z * wall.normal.z) / facing
      s = (eye.x + look.x * t) * wall.right.x + (eye.z + look.z * t) * wall.right.z
      y = eye.y + look.y * t
    }
    return { s: clamp(s, wall.s0 + edge + w / 2, wall.s1 - edge - w / 2), y: aimY ?? y }
  }

  /**
   * Hangs a w x h board on `wall`, if the wall will take it: wide and tall enough, its face bare, `below` metres
   * free under the board, nothing standing in front of it, the bottom at least `lift` up, its frame on the side
   * `only` allows and its glow (`reach` either side) clear of the office, and nothing hung there already. It
   * starts where the camera's line of sight to `target` meets the wall (`aimY` overrides the height) and tries a
   * little to either side, higher and lower, keeping the place the camera sees most of: at least `minSeen` of
   * its `grid` points `face` metres out, and it stops looking once it sees `enough`. Returns a placement or null.
   */
  function fitOnWall(wall, target, w, h, options = {}) {
    const { below = 0, edge = 0.8, lift = 3, aimY = null, reach = w / 2 + haloMargin(w, h), only = null, grid = BOARD_GRID, minSeen = 1, enough = 1, face = 0.5, slide = SLIDE } = options
    if (wall.s1 - wall.s0 < w + 2 * edge || proud(wall)) return null
    const aim = aimOn(wall, target, w, h, edge, aimY)
    let best = null
    let lastS = NaN
    for (const ds of slide) {
      const s = clamp(aim.s + ds, wall.s0 + edge + w / 2, wall.s1 - edge - w / 2)
      if (Math.abs(s - lastS) < 0.1) continue
      lastS = s
      const point = new THREE.Vector3().copy(wall.normal).multiplyScalar(wall.o).addScaledVector(wall.right, s)
      const frame = frameAt(point, wall.normal)
      if (!keepsClear(frame, w / 2 + 0.5, -0.6, 1.6, only) || !keepsClear(frame, reach, -0.6, 1.6)) continue
      // Podiums, roof gardens or the next tower in front of the wall set how low the board may come.
      const floor = Math.max(wall.y0, groundUnder(frame, w / 2 + 0.5, [0.9, 1.6])[1])
      const low = Math.max(floor + below + 0.6, lift) + h / 2
      const high = wall.y1 - 1.2 - h / 2
      if (low > high) continue
      const start = clamp(aim.y, low, high)
      let lastY = NaN
      for (const dy of RISE) {
        const y = clamp(start + dy, low, high)
        if (Math.abs(y - lastY) < 0.1) continue
        lastY = y
        const box = roomOf(frame, w / 2 + 0.5, -0.6, 1.6, y - h / 2 - below - 0.5, y + h / 2 + 0.9)
        if (hung.some(other => other.intersectsBox(box)) || !carried(frame, w, h, y)) continue
        const share = seenShare(frame, y, w, h, face, grid)
        if (share < minSeen || (best && share <= best.seen)) continue
        if (faceBusy(frame, w, y - h / 2 - below - 0.4, y + h / 2 + 0.9)) continue
        _q.subVectors(eye, point).setY(0).normalize()
        best = { frame, y, floor, box, seen: share, facing: _q.dot(wall.normal), feet: null }
        if (share >= enough) return best
      }
    }
    return best
  }

  /** The wall nearest (as the default camera sees it) to where it looks at `target` that takes a w x h board, or null. */
  function hangNear(target, w, h, only) {
    const look = target.clone().sub(eye).normalize()
    const farthest = eye.distanceTo(target) + 25
    const options = []
    for (const wall of walls) {
      if (wall.s1 - wall.s0 < w + 1.6 || wall.y1 - wall.y0 < h + 2) continue
      const aim = aimOn(wall, target, w, h, 0.8)
      const spot = new THREE.Vector3().copy(wall.normal).multiplyScalar(wall.o).addScaledVector(wall.right, aim.s)
      spot.y = clamp(aim.y, wall.y0 + 3 + h / 2, wall.y1 - 1.2 - h / 2)
      const turn = look.angleTo(spot.sub(eye))
      if (turn <= MAX_TURN && spot.length() <= farthest) options.push({ wall, turn })
    }
    options.sort((a, b) => a.turn - b.turn)
    for (const { wall } of options) {
      const place = fitOnWall(wall, target, w, h, { only })
      if (place) return place
    }
    return null
  }

  /**
   * When no wall takes a board: a stand on legs on the line of sight to `target` (in front of whatever blocks it,
   * or behind), each leg on whatever is under it (the street or a low roof), the board above everything beneath
   * it and seen whole, its frame and legs wholly on the side `only` allows and its glow clear of the office.
   * Null if there is nowhere: the board is left out rather than crowding the office.
   */
  function standNear(target, w, h, only) {
    const look = target.clone().sub(eye).normalize()
    const far = eye.distanceTo(target)
    const hit = solids.cast(eye, look, far)
    const from = hit ? hit.distance - 2.5 : far
    for (const step of STAND_STEPS) {
      const p = eye.clone().addScaledVector(look, from - step)
      const frame = frameAt(p, _q.subVectors(eye, p))
      if (!keepsClear(frame, w / 2 + 0.5, -0.6, 1.6, only) || !keepsClear(frame, w / 2 + haloMargin(w, h), -0.6, 1.6)) continue
      const feet = [-1, 1].map(side => solids.cast(at(frame, side * (w / 2 - 0.9), 400, -0.25, _p), DOWN, 400)?.point.y ?? 0)
      const footing = Math.max(feet[0], feet[1])
      const under = groundUnder(frame, w / 2 + 0.5, [-0.4, 0.6, 1.6])[1]
      const y = Math.max(p.y, footing + 3 + h / 2, under + 1 + h / 2)
      if (footing > 16 || y - h / 2 - Math.min(feet[0], feet[1]) > 14) continue
      const box = roomOf(frame, w / 2 + 0.5, -0.6, 1.6, Math.min(feet[0], feet[1]), y + h / 2 + 0.9)
      if (hung.some(other => other.intersectsBox(box))) continue
      if (seenShare(frame, y, w, h, 0.5, BOARD_GRID) < 1) continue
      return { frame, y, floor: footing, feet, box }
    }
    return null
  }

  /**
   * Where the building-sized advert goes: on its own monolith when nothing stands on that ground; else on the
   * tower wall north-west of the office that shows the camera the most screen (at the biggest size the wall
   * carries, keeping its shape); null if no wall there will take it at all.
   */
  function megaSite() {
    const yaw = Math.atan2(eye.x - MEGA.x, eye.z - MEGA.z)
    const frame = frameAt(new THREE.Vector3(MEGA.x, 0, MEGA.z), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)))
    const [tw, th, td] = MEGA.tower
    const half = (tw + 6) / 2 + 1.5
    if (groundFree(frame, half, -td - 4.5, 4.5) && keepsClear(frame, half + 10, -td - 4.5, 4.5)) {
      return { frame, y: MEGA.base + MEGA.height / 2, w: MEGA.width, h: MEGA.height, floor: 0, own: true, box: roomOf(frame, half, -td - 4.5, 4.5, 0, th + 14) }
    }
    const target = new THREE.Vector3(MEGA.x, MEGA.base, MEGA.z)
    let best = null
    for (const wall of walls) {
      const d = Math.hypot(wall.centre.x - MEGA.x, wall.centre.z - MEGA.z)
      if (d > MEGA.reach || wall.centre.x > -10) continue
      // The biggest size the wall's width and height allow, then smaller, down to the smallest worth hanging.
      let k = Math.min(1, (wall.s1 - wall.s0 - 2.4) / MEGA.width, (wall.y1 - 1.2 - MEGA.base) / MEGA.height)
      for (; k >= MEGA_SMALLEST; k -= 0.08) {
        const w = MEGA.width * k
        const h = MEGA.height * k
        const place = fitOnWall(wall, target, w, h, { below: 2.8, edge: 1.2, lift: MEGA.base, aimY: 0, reach: w / 2 + 10 * k, grid: MEGA_GRID, minSeen: 0.35, enough: 0.9, face: 1.4, slide: [0] })
        if (!place) continue
        const score = (place.seen * place.facing * w * h) / (1 + (d / 30) ** 2)
        if (!best || score > best.score) best = { ...place, w, h, score, own: false }
        break // the biggest size this wall takes
      }
    }
    return best
  }

  // ---- The building-sized advert.
  const site = megaSite()
  let megaScreen = null
  if (site) {
    hung.push(site.box)
    const { frame: mega, y: megaY, w, h, own } = site
    const k = w / MEGA.width
    const [tw, th, td] = MEGA.tower
    // On its own tower the screen sits proud of the glass; on a borrowed wall its frame is deep enough to
    // swallow any neon trim running across that wall, so no two faces ever meet.
    const deep = own ? 0.8 : 1.3
    const out = deep + 0.06
    if (own) {
      parts.facade.push(placed(facadeBox(tw, th, td), mega, 0, th / 2, -td / 2))
      parts.facade.push(placed(facadeBox(tw + 6, 10, td + 6), mega, 0, 5, -td / 2))
      parts.metal.push(placed(new THREE.BoxGeometry(tw * 0.7, 4, td * 0.7), mega, 0, th + 2, -td / 2))
      for (const side of [-1, 1]) {
        parts.metal.push(placed(new THREE.CylinderGeometry(0.22, 0.3, 9, 8), mega, side * tw * 0.25, th + 8.5, -td / 2))
        parts.beacons.push(placed(new THREE.SphereGeometry(0.45, 10, 8), mega, side * tw * 0.25, th + 13.3, -td / 2))
        // Small white lights up the tower's front corners.
        for (let y = 11; y < th - 1; y += 2) {
          parts.neon.push(placed(glowing(new THREE.BoxGeometry(0.35, 0.35, 0.35), '#dfe8ff', 2.2), mega, side * (tw / 2 + 0.05), y, 0.05))
        }
      }
    }
    parts.metal.push(placed(new THREE.BoxGeometry(w + 0.8, h + 0.8, deep), mega, 0, megaY, deep / 2 - 0.02))
    // Rows of small warm lights down both sides of the screen.
    for (const side of [-1, 1]) {
      for (let y = megaY - h / 2 + 0.5; y < megaY + h / 2; y += 1.5) {
        parts.neon.push(placed(glowing(new THREE.BoxGeometry(0.28, 0.28, 0.2), '#ffcf8a', 2.6), mega, side * (w / 2 + 0.22), y, out))
      }
    }
    megaScreen = addScreen(mega, megaY, out, w, h, ['face', 'megaCan', 'face', 'megaScroll', 'face', 'megaCar'], {
      gain: 1.9,
      pitch: 0.55,
      gap: 0.3,
      panels: [3, 6],
      seam: 0.035,
      seed: hash('mega'),
      holds: { face: 22 },
      hold: 13,
      halo: 0.4,
      rings: [[0.1, 1], [k, 0.55], [3.5 * k, 0.2], [10 * k, 0]],
      spill: 26 * k,
    })
    addLight(megaScreen, at(mega, 0, megaY - h * 0.22, 8), 55, 900, 0.5)
    // The news ticker: round the podium's top on the monolith, on a strip under the screen on a borrowed wall.
    let path = [[-(w / 2 + 0.4), 1.05], [w / 2 + 0.4, 1.05]]
    let tickerY = megaY - h / 2 - 1.6
    if (own) {
      const x = (tw + 6) / 2 + 0.3
      path = [[-x, 3.3 - td - 6], [-x, 3.3], [x, 3.3], [x, 3.3 - td - 6]]
      tickerY = 8.6
    } else {
      parts.metal.push(placed(new THREE.BoxGeometry(w + 1.2, 1.6, 0.9), mega, 0, tickerY, 0.43))
    }
    const ticker = makeScreen(1, 1, ['ticker'], { gain: 1.5, rows: 8, gap: 0.25, geometry: bandGeometry(mega, path, tickerY, 1.2) })
    group.add(ticker.mesh)
    screens.push(ticker)
    if (site.floor < 0.3) streaks.add(megaScreen, at(mega, 0, 0.08, out + 2.74), mega.normal, 14 * k, 30, 0.35)
  }

  // ---- Mid-size boards on the towers behind the office and on the flanks.
  SPOTS.forEach((spot, i) => {
    const x = spot.side === 'mid' ? cx + spot.x : spot.side === 'west' ? spot.x : extent + spot.x
    const target = new THREE.Vector3(x, spot.y, spot.z)
    const side = SIDES[spot.side]
    // On a wall at full size, then smaller; only then on legs, full size and smaller.
    let place = null
    let k = 1
    for (const [scale, fit] of BOARD_TRIES) {
      k = scale
      place = fit === 'wall' ? hangNear(target, spot.w * k, spot.h * k, side.wall) : standNear(target, spot.w * k, spot.h * k, side.stand)
      if (place) break
    }
    if (!place) return // nowhere it is seen whole without crowding the office: better left out
    hung.push(place.box)
    const { frame, y } = place
    const w = spot.w * k
    const h = spot.h * k
    const seed = hash(`board${i}`)
    board(frame, y, w, h, seed, place.feet)
    const screen = addScreen(frame, y, 0.46, w, h, spot.ads, {
      gain: 1.6,
      panels: w > h ? [2, 1] : [1, 2],
      seam: 0.012,
      seed,
      streak: 8 + h * 1.6,
      floor: place.floor,
    })
    if (spot.light) addLight(screen, at(frame, 0, y - h * 0.2, 3.5), 28, 60)
    if (spot.side === 'mid') seen.push(view(at(frame, 0, y, 0.46), w / 2 + 0.6, h / 2 + 0.6))
  })

  /** How a box `half` metres wide and `tall` metres high round `p` looks from the default camera: [left, right, low, high] angles. */
  function view(p, half, tall) {
    const d = eye.z - p.z
    const a = Math.atan2(p.x - eye.x, d)
    const e = Math.atan2(p.y - eye.y, d)
    const sx = Math.atan(half / d)
    const sy = Math.atan(tall / d)
    return [a - sx, a + sx, e - sy, e + sy]
  }

  /**
   * A board's surround: a metal frame, accent bars above and below, three lamps leaning over it, and if it stands,
   * legs down to `feet`. Nothing reaches more than 1.43 m out from the wall: on the nearest flank tower (x -12)
   * the lamps stay outside the street's span (x -10.5).
   */
  function board(frame, y, w, h, seed, feet) {
    const accent = NEON[seed % NEON.length]
    const upper = y + h / 2
    parts.metal.push(placed(new THREE.BoxGeometry(w + 0.5, h + 0.5, 0.4), frame, 0, y, 0.18))
    parts.neon.push(placed(glowing(new THREE.BoxGeometry(w + 0.5, 0.16, 0.2), accent, 2.2), frame, 0, upper + 0.33, 0.32))
    parts.neon.push(placed(glowing(new THREE.BoxGeometry(w + 0.5, 0.16, 0.2), accent, 1.6), frame, 0, y - h / 2 - 0.33, 0.32))
    for (const lx of [-w / 3, 0, w / 3]) {
      // The arm runs out from the wall (2 cm into it, like the frame), on a short post rising from the frame's top
      // behind the accent bar, so it is held on a wall and on a stand alike.
      parts.metal.push(placed(new THREE.BoxGeometry(0.14, 0.14, 1.44), frame, lx, upper + 0.62, 0.7))
      parts.metal.push(placed(new THREE.BoxGeometry(0.1, 0.36, 0.1), frame, lx, upper + 0.41, 0.08))
      parts.neon.push(placed(glowing(new THREE.BoxGeometry(0.5, 0.14, 0.26), '#dfe8ff', 2.4), frame, lx, upper + 0.5, 1.3))
    }
    if (!feet) return
    const top = y - h / 2 - 0.25
    feet.forEach((foot, i) => parts.metal.push(placed(new THREE.BoxGeometry(0.45, top - foot, 0.45), frame, (i * 2 - 1) * (w / 2 - 0.9), (foot + top) / 2, -0.25)))
    const footing = Math.max(feet[0], feet[1])
    parts.metal.push(placed(new THREE.BoxGeometry(w - 1.4, 0.3, 0.3), frame, 0, footing + (top - footing) * 0.55, -0.25))
  }

  // ---- The pole rigs across the road: big board below, smaller one stacked above, all under 14 m.
  RIGS.forEach((rig, i) => {
    const x = rig.side === 'west' ? rig.x : extent + rig.x
    const frame = frameAt(new THREE.Vector3(x, 0, rig.z), new THREE.Vector3(Math.sin(rig.yaw), 0, Math.cos(rig.yaw)))
    const accent = NEON[(i * 2 + 1) % NEON.length]
    parts.metal.push(placed(new THREE.BoxGeometry(1.4, 0.8, 1.4), frame, 0, 0.4, -0.45))
    parts.metal.push(placed(new THREE.BoxGeometry(0.5, 12.4, 0.5), frame, 0, 7, -0.45))
    parts.metal.push(placed(new THREE.BoxGeometry(7.6, 4, 0.4), frame, 0, 8.2, 0))
    parts.metal.push(placed(new THREE.BoxGeometry(6, 3.2, 0.4), frame, 0, 12.05, 0))
    parts.metal.push(placed(new THREE.BoxGeometry(6.6, 0.2, 0.2), frame, 0, 7, -0.35))
    parts.metal.push(placed(new THREE.BoxGeometry(6.6, 0.2, 0.2), frame, 0, 9.4, -0.35))
    // The catwalk under the big board, its rail, and two floodlights shining up at the screen.
    parts.metal.push(placed(new THREE.BoxGeometry(7.6, 0.08, 0.9), frame, 0, 6, 0.55))
    parts.metal.push(placed(new THREE.BoxGeometry(7.6, 0.06, 0.06), frame, 0, 7, 0.97))
    for (const px of [-3.7, 0, 3.7]) parts.metal.push(placed(new THREE.BoxGeometry(0.06, 1, 0.06), frame, px, 6.5, 0.97))
    for (const px of [-2.4, 2.4]) parts.neon.push(placed(glowing(new THREE.BoxGeometry(0.5, 0.16, 0.28), '#dfe8ff', 2.2), frame, px, 6.15, 0.8))
    parts.neon.push(placed(glowing(new THREE.BoxGeometry(7.6, 0.12, 0.12), accent, 2), frame, 0, 5.9, 0.98))
    parts.neon.push(placed(glowing(new THREE.BoxGeometry(0.7, 0.12, 0.7), accent, 2), frame, 0, 3, -0.45))
    parts.beacons.push(placed(new THREE.SphereGeometry(0.13, 10, 8), frame, 0, 13.78, 0))
    const seed = hash(`rig${i}`)
    // Out in the open air the glow has no wall to light, so it stays faint.
    addScreen(frame, 8.2, 0.28, 7.2, 3.6, rig.ads[0], { gain: 1.5, pitch: 0.1, panels: [2, 1], seam: 0.01, seed, halo: 0.16, streak: 14 })
    addScreen(frame, 12.05, 0.28, 5.6, 2.8, rig.ads[1], { gain: 1.5, pitch: 0.1, seed: seed >> 3, halo: 0.16 })
  })

  // ---- The hologram: a slim projector on the strip north of the water channel, its beam, the floating sign and two koi.
  const hologram = buildHologram()

  /**
   * Whether no part of the towers lies inside `box`: rays cross it along each axis, both ways, from its faces,
   * `step` metres apart, so each meets whatever is inside from outside (a ray only hits faces turned toward it).
   */
  function boxFree(box, step = 1.5) {
    const lo = box.min.toArray()
    const hi = box.max.toArray()
    const p = [0, 0, 0]
    const d = new THREE.Vector3()
    for (let axis = 0; axis < 3; axis += 1) {
      const [a, b] = [0, 1, 2].filter(i => i !== axis)
      const na = Math.max(1, Math.ceil((hi[a] - lo[a]) / step))
      const nb = Math.max(1, Math.ceil((hi[b] - lo[b]) / step))
      for (let i = 0; i <= na; i += 1) {
        for (let j = 0; j <= nb; j += 1) {
          p[a] = lo[a] + ((hi[a] - lo[a]) * i) / na
          p[b] = lo[b] + ((hi[b] - lo[b]) * j) / nb
          for (const sign of [1, -1]) {
            p[axis] = sign > 0 ? lo[axis] : hi[axis]
            d.set(0, 0, 0).setComponent(axis, sign)
            if (solids.cast(_p.fromArray(p), d, hi[axis] - lo[axis])) return false
          }
        }
      }
    }
    return true
  }

  /**
   * Puts up the hologram at the choice the default camera sees clearest of the mid boards, among those whose koi
   * keep inside the towers' open corridor, clear of every board and of anything the skyline built there. Returns
   * its per-frame update, or null when no choice has room: better left out than swimming through a tower.
   */
  function buildHologram() {
    let hx = null
    let room = null
    let crowd = Infinity
    for (const dx of HOLO.choices) {
      const x = cx + dx
      const box = new THREE.Box3(
        new THREE.Vector3(x - KOI_ROOM.side, HOLO.y - KOI_ROOM.below, HOLO.z - KOI_ROOM.deep),
        new THREE.Vector3(x + KOI_ROOM.side, HOLO.y + KOI_ROOM.above, HOLO.z + KOI_ROOM.deep),
      )
      if (box.min.x < -HOLO.open || box.max.x > extent + HOLO.open) continue
      if (hung.some(other => other.intersectsBox(box)) || !boxFree(box)) continue
      const [a0, a1, e0, e1] = view(new THREE.Vector3(x, HOLO.y, HOLO.z), SWIM[0] + 1, SWIM[1] + 1)
      let overlap = Math.abs(dx) * 1e-4 // nearer the middle wins a tie
      for (const [b0, b1, f0, f1] of seen) overlap += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) * Math.max(0, Math.min(e1, f1) - Math.max(e0, f0))
      if (overlap < crowd) {
        crowd = overlap
        hx = x
        room = box
      }
    }
    if (hx === null) return null
    hung.push(room)
    const holo = frameAt(new THREE.Vector3(hx, 0, HOLO.z), new THREE.Vector3(0, 0, 1))
    // The projector: a slim dark housing sunk a centimetre into the plaza (at -0.05), 15 cm short of the channel's
    // coping, with a cyan slit along its top.
    parts.metal.push(placed(new THREE.BoxGeometry(1.3, 0.3, 0.5), holo, 0, 0.09, 0))
    parts.neon.push(placed(glowing(new THREE.BoxGeometry(0.9, 0.08, 0.16), '#2bf3ff', 2.2), holo, 0, 0.27, 0))
    const beamBase = 0.31
    const beamHeight = HOLO.y - HOLO.h / 2 - 0.3 - beamBase
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(HOLO.w * 0.42, 0.3, beamHeight, 28, 1, true), beamMaterial('#2bf3ff'))
    beam.position.copy(at(holo, 0, beamBase + beamHeight / 2, 0))
    beam.rotation.y = holo.yaw
    beam.scale.z = 0.18 // a flat fan, in the sign's plane
    group.add(beam)
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(HOLO.w, HOLO.h), holoMaterial(holoTexture()))
    panel.position.copy(at(holo, 0, HOLO.y, 0))
    panel.rotation.y = holo.yaw
    group.add(panel)
    const fish = KOI.map(k => {
      const mesh = new THREE.Mesh(koiGeometry(), koiMaterial(k.body, k.spots, k.phase))
      group.add(mesh)
      return { ...k, mesh }
    })
    lightSpots.push({ position: at(holo, 0, HOLO.y, 0.6), color: new THREE.Color('#2bf3ff'), radius: 9 })
    const basis = new THREE.Matrix4()
    const forward = new THREE.Vector3()
    const lateral = new THREE.Vector3()

    /** The koi chase each other round the sign, backs to the camera, swinging as they swim. */
    function swim(t) {
      for (let i = 0; i < fish.length; i += 1) {
        const k = fish[i]
        const a = t * 0.26 + k.phase
        const rx = SWIM[0] * k.radius
        const ry = SWIM[1] * k.radius
        at(holo, Math.cos(a) * rx, HOLO.y + Math.sin(a) * ry + 0.3 * Math.sin(t * 0.7 + k.phase), k.z, k.mesh.position)
        forward.copy(holo.right).multiplyScalar(-Math.sin(a) * rx).addScaledVector(UP, Math.cos(a) * ry).normalize()
        lateral.crossVectors(holo.normal, forward)
        k.mesh.quaternion.setFromRotationMatrix(basis.makeBasis(lateral, holo.normal, forward))
        k.mesh.material.uniforms.time.value = t
      }
    }
    swim(0) // in place before the first frame, never left at the office's corner

    return t => {
      beam.material.uniforms.time.value = t
      panel.material.uniforms.time.value = t
      swim(t)
    }
  }

  // ---- Static parts, merged: one draw call per material.
  const metal = new THREE.MeshStandardMaterial({ color: '#141821', roughness: 0.42, metalness: 0.7 })
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: '#ff2b2b', toneMapped: false })
  if (parts.facade.length) group.add(merged(parts.facade, facadeMaterial()))
  group.add(merged(parts.metal, metal))
  group.add(merged(parts.neon, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })))
  group.add(merged(parts.beacons, beaconMaterial))
  group.add(halos.build())
  group.add(streaks.build())

  const face = ad('face')

  return {
    update(dt, t) {
      const camera = ctx.camera.position
      const fog = scene.fog
      for (let i = 0; i < screens.length; i += 1) screens[i].tick(dt, t)
      // The one canvas that is redrawn: the face, while it shows, FACE_FPS times a second.
      if (megaScreen && Math.abs(t - face.drawnAt) >= 1 / FACE_FPS && megaScreen.showing('face')) face.draw(t)
      halos.update(camera, fog)
      streaks.update(camera, fog)
      for (let i = 0; i < lights.length; i += 1) lights[i].light.color.copy(lights[i].screen.color).lerp(WARM_PINK, lights[i].warmth)
      // Aircraft beacons breathe slowly; they never blink.
      const beat = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 2))
      beaconMaterial.color.setRGB(2.6 * beat, 0.12 * beat, 0.1 * beat)
      if (hologram) hologram(t)
    },
  }
}

// ------------------------------------------------------------------ screens

const smooth = x => x * x * (3 - 2 * x)
const fract = x => x - Math.floor(x)

/**
 * Where an ad sits on its screen `s` seconds after it came up, written into `out` (a Vector4):
 * texture [scale x, scale y, offset x, offset y]. Runs every frame, so it makes nothing new.
 */
function motion(ad, s, hold, out) {
  const vx = ad.view ? ad.view[0] : 1
  const vy = ad.view ? ad.view[1] : 1
  const k = smooth(clamp(s / (hold + FADE), 0, 1))
  if (ad.motion === 'scroll') return out.set(vx, vy, 0, fract(-s * 0.02))
  if (ad.motion === 'ticker') return out.set(1, 1, fract(s * 0.012), 0)
  if (ad.motion === 'pan') return out.set(0.86, 0.86, 0.14 * k, 0.07)
  if (ad.motion === 'push') {
    const zoom = 1 - 0.1 * k
    return out.set(zoom, zoom, 0.54 * (1 - zoom), 0.6 * (1 - zoom))
  }
  if (ad.motion === 'drift') {
    const zoom = 1 - 0.07 * k
    return out.set(zoom, zoom, (1 - zoom) * (0.25 + 0.5 * k), (1 - zoom) * 0.5)
  }
  return out.set(1, 1, 0, 0)
}

/**
 * A screen `width` x `height` metres cycling through `ids`: each ad holds, then cross-fades into the next
 * over FADE seconds while both keep moving. `color` follows what it shows (for its glow, light and rain).
 */
function makeScreen(width, height, ids, options) {
  const { gain = 1.6, rows = 0, gap = 0.28, columns = 0, panels = [1, 1], seam = 0, seed = 0, holds = {}, hold = 9 + (seed % 5), geometry = null } = options
  const list = ids.map(id => ad(id))
  const holdOf = item => holds[item.id] ?? hold
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    mapA: { value: list[0].texture },
    mapB: { value: list[0].texture },
    xfA: { value: new THREE.Vector4(1, 1, 0, 0) },
    xfB: { value: new THREE.Vector4(1, 1, 0, 0) },
    fade: { value: 0 },
    gain: { value: gain },
    time: { value: 0 },
    grid: { value: new THREE.Vector3(rows, gap, columns) },
    panel: { value: new THREE.Vector3(panels[0], panels[1], seam) },
  }
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG, fog: true, toneMapped: false })
  if (geometry) material.side = THREE.DoubleSide
  const mesh = new THREE.Mesh(geometry ?? new THREE.PlaneGeometry(width, height), material)
  const color = list[0].color.clone()
  let index = 0
  let clock = ((seed % 997) / 997) * holdOf(list[0])
  let fading = -1 // seconds into the cross-fade, or -1 when none is running
  const nextOf = () => list[(index + 1) % list.length]
  const place = (target, item, s) => motion(item, s, holdOf(item), target)

  return {
    mesh,
    color,
    /** Whether ad `id` is up on this screen, or fading in or out. */
    showing: id => list[index].id === id || (fading >= 0 && nextOf().id === id),
    tick(dt, t) {
      uniforms.time.value = t
      clock += dt
      if (list.length > 1 && fading < 0 && clock >= holdOf(list[index])) {
        fading = 0
        uniforms.mapB.value = nextOf().texture
      }
      let mix = 0
      if (fading >= 0) {
        fading += dt
        if (fading >= FADE) {
          index = (index + 1) % list.length
          clock = fading
          fading = -1
          uniforms.mapA.value = list[index].texture
        } else {
          mix = smooth(fading / FADE)
          place(uniforms.xfB.value, nextOf(), fading)
        }
      }
      place(uniforms.xfA.value, list[index], clock)
      uniforms.fade.value = mix
      color.copy(list[index].color)
      if (mix > 0) color.lerp(nextOf().color, mix)
    },
  }
}

const adCache = new Map()

/** An ad's texture and the colour it casts: painted on first use, kept for later rebuilds. */
function ad(id) {
  if (!adCache.has(id)) adCache.set(id, id === 'face' ? faceAd() : paintedAd(id))
  return adCache.get(id)
}

/** Paints an ad onto its canvas, in a space the shape of the screen it is meant for (so circles stay round). */
function paintedAd(id) {
  const spec = ADS[id]
  const [pw, ph] = spec.px
  const { canvas, g } = makeCanvas(pw, ph)
  const tall = pw / spec.aspect
  g.scale(1, ph / tall)
  spec.paint(g, pw, tall)
  return { ...spec, id, texture: canvasTexture(canvas, spec), color: castColor(canvas) }
}

/**
 * Where the face's moving parts can paint, in its metres [x0, y0, x1, y1]: both eyes (lids and lashes included)
 * and the lips (fully parted, with their shine), each with a little room to spare.
 */
const FACE_LIVE = [[3.9, 19.6, 15.7, 24.8], [6.9, 31.2, 12.9, 35.3]]

/**
 * The advert face: invented, drawn from plain shapes, its eyes and lips moving slowly. While it shows, only
 * the eyes and lips are redrawn: their patches are put back from the still picture and painted again.
 */
function faceAd() {
  const W = 256
  const H = W / MEGA_ASPECT
  const sy = 512 / H
  const still = makeCanvas(256, 512)
  still.g.scale(1, sy)
  paintFace(still.g, W, H)
  const { canvas, g } = makeCanvas(256, 512)
  g.drawImage(still.canvas, 0, 0)
  const texture = canvasTexture(canvas)
  // The live patches in canvas pixels, a pixel wider all round for the edges' smoothing.
  const k = W / MEGA.width
  const patches = FACE_LIVE.map(([x0, y0, x1, y1]) => {
    const px = Math.max(0, Math.floor(x0 * k) - 1)
    const py = Math.max(0, Math.floor(y0 * k * sy) - 1)
    return [px, py, Math.min(256, Math.ceil(x1 * k) + 1) - px, Math.min(512, Math.ceil(y1 * k * sy) + 1) - py]
  })
  const face = {
    id: 'face',
    motion: 'push',
    texture,
    color: null,
    drawnAt: -Infinity,
    draw(t) {
      g.setTransform(1, 0, 0, 1, 0, 0)
      for (const [x, y, w, h] of patches) g.drawImage(still.canvas, x, y, w, h, x, y, w, h)
      g.setTransform(1, 0, 0, sy, 0, 0)
      paintFaceLive(g, W, t)
      texture.needsUpdate = true
      face.drawnAt = t
    },
  }
  face.draw(0)
  face.color = castColor(canvas)
  return face
}

/**
 * A ticker band's geometry: a strip `h` tall at height y along a path of [x, z] points in a frame's space (round
 * a podium, or straight across a wall), the text running along it.
 */
function bandGeometry(frame, path, y, h) {
  const positions = []
  const uvs = []
  const index = []
  let run = 0
  for (let i = 0; i + 1 < path.length; i += 1) {
    const [x0, z0] = path[i]
    const [x1, z1] = path[i + 1]
    const length = Math.hypot(x1 - x0, z1 - z0)
    const u0 = run / 76.8 // the ticker texture spans 76.8 m of band
    const u1 = (run + length) / 76.8
    const start = positions.length / 3
    for (const [px, pz, u] of [[x0, z0, u0], [x1, z1, u1]]) {
      for (const [py, v] of [[y - h / 2, 0], [y + h / 2, 1]]) {
        positions.push(...at(frame, px, py, pz).toArray())
        uvs.push(u, v)
      }
    }
    index.push(start, start + 2, start + 3, start, start + 3, start + 1)
    run += length
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(index)
  return geometry
}

// ------------------------------------------------------------------ glow and reflections

/** How much of a light `d` metres away survives the fog. */
function haze(fog, d) {
  return fog?.isFogExp2 ? Math.exp(-((fog.density * d) ** 2)) : 1
}

/** Additive light shapes: vertex-coloured, no depth writes, no fog (they fade by distance in code instead). */
function additive() {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    forceSinglePass: true, // additive light needs no back-then-front pass: one draw call, not two
  })
}

const ARC = 4 // segments in each rounded corner of a halo ring

/** Points `out` metres outside a `w` x `h` rectangle (rounded at the corners), going round it once. */
function ringPoints(w, h, out) {
  const points = []
  for (const [cx, cy, a0] of [[w / 2, -h / 2, -0.5], [w / 2, h / 2, 0], [-w / 2, h / 2, 0.5], [-w / 2, -h / 2, 1]]) {
    for (let j = 0; j <= ARC; j += 1) {
      const a = (a0 + (j / ARC) * 0.5) * Math.PI
      points.push([cx + Math.cos(a) * out, cy + Math.sin(a) * out])
    }
  }
  return points
}

/**
 * Soft glow round the screens: rings at set distances from each screen's edge, bright at the edge and fading
 * out, so the falloff is even all round (corners included). Tinted live by what each screen shows.
 */
class Halos {
  constructor() {
    this.items = []
  }

  /** `rings`: [distance out from the screen edge, brightness] from the inside out; the last should be 0. */
  add(screen, frame, y, z, w, h, rings, strength) {
    this.items.push({ screen, frame, y, z, w, h, rings, strength, centre: at(frame, 0, y, z) })
  }

  build() {
    const positions = []
    const index = []
    const n = 4 * (ARC + 1)
    for (const item of this.items) {
      const { frame, y, z, w, h, rings } = item
      item.start = positions.length / 3
      for (const [out] of rings) {
        for (const [px, py] of ringPoints(w, h, out)) positions.push(...at(frame, px, y + py, z).toArray())
      }
      for (let r = 0; r < rings.length - 1; r += 1) {
        for (let k = 0; k < n; k += 1) {
          const a = item.start + r * n + k
          const b = item.start + r * n + ((k + 1) % n)
          index.push(a, b, b + n, a, b + n, a + n)
        }
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setIndex(index)
    this.mesh = new THREE.Mesh(geometry, additive())
    return this.mesh
  }

  update(camera, fog) {
    const colors = this.mesh.geometry.attributes.color
    const n = 4 * (ARC + 1)
    for (let j = 0; j < this.items.length; j += 1) {
      const item = this.items[j]
      const { r, g, b } = item.screen.color
      const k = item.strength * haze(fog, camera.distanceTo(item.centre))
      for (let ring = 0; ring < item.rings.length; ring += 1) {
        const f = k * item.rings[ring][1]
        for (let i = 0; i < n; i += 1) colors.setXYZ(item.start + ring * n + i, r * f, g * f, b * f)
      }
    }
    colors.needsUpdate = true
  }
}

/**
 * Screen light smeared on the wet ground, stretched toward the camera like a reflection: brightest down its
 * middle, fading to nothing at its sides and far end. Never reaches into the office's patch: it draws back
 * smoothly as its line toward the camera comes near it (clearRun), so turning the camera never makes it jump.
 */
class Streaks {
  constructor(extent) {
    this.items = []
    this.clear = { x0: -6, x1: extent + 6, z0: -4, z1: 24 }
  }

  add(screen, foot, normal, width, length, strength = 0.22) {
    this.items.push({ screen, foot, normal, width, length, strength })
  }

  build() {
    const count = this.items.length
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 27), 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 27), 3).setUsage(THREE.DynamicDrawUsage))
    // Each streak is three rows (foot, a third of the way, the end) of three points (side, middle, side).
    const index = []
    for (let i = 0; i < count; i += 1) {
      for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 2; col += 1) {
          const a = i * 9 + row * 3 + col
          index.push(a, a + 1, a + 4, a, a + 4, a + 3)
        }
      }
    }
    geometry.setIndex(index)
    this.mesh = new THREE.Mesh(geometry, additive())
    this.mesh.frustumCulled = false // its corners move every frame
    return this.mesh
  }

  update(camera, fog) {
    const positions = this.mesh.geometry.attributes.position
    const colors = this.mesh.geometry.attributes.color
    for (let i = 0; i < this.items.length; i += 1) {
      const { foot, normal, width, screen, length, strength } = this.items[i]
      let dx = camera.x - foot.x
      let dz = camera.z - foot.z
      const dist = Math.hypot(dx, dz) || 1
      dx /= dist
      dz /= dist
      const facing = Math.max(0, dx * normal.x + dz * normal.z)
      const run = clearRun(foot.x, foot.z, dx, dz, this.clear, Math.min(length, dist * 0.8))
      const k = strength * facing * haze(fog, dist)
      const { r, g, b } = screen.color
      for (let row = 0; row < 3; row += 1) {
        const px = foot.x + dx * run * STREAK_ALONG[row]
        const pz = foot.z + dz * run * STREAK_ALONG[row]
        const hw = STREAK_HALF[row] * width
        for (let col = 0; col < 3; col += 1) {
          const side = 1 - col // the left edge, the middle, the right edge
          const f = col === 1 ? k * STREAK_GLOW[row] : 0
          const v = i * 9 + row * 3 + col
          positions.setXYZ(v, px - dz * hw * side, foot.y, pz + dx * hw * side)
          colors.setXYZ(v, r * f, g * f, b * f)
        }
      }
    }
    positions.needsUpdate = true
    colors.needsUpdate = true
  }
}

// A streak's three rows (its foot, a third of the way, its far end): how far along, how wide, how bright down the middle.
const STREAK_ALONG = [0, 0.3, 1]
const STREAK_HALF = [0.4, 0.5, 0.25]
const STREAK_GLOW = [0.5, 1, 0]

/**
 * How far a ground ray from (x, z) along (dx, dz) may run, up to `limit`, keeping out of `box`. Each point along
 * it caps the run at that point's distance plus a slack that grows smoothly with its clearance from the box: half
 * a metre short of the box where it touches, no cap at all once it is `ease` metres clear. So a ray that only
 * just misses the box is cut back as far as one that only just hits it, and a streak shortens and lengthens
 * smoothly as the camera moves, never jumping between its full length and a clipped one.
 */
function clearRun(x, z, dx, dz, box, limit, ease = 3) {
  const ex = x + dx * limit
  const ez = z + dz * limit
  // Nowhere near the box: the whole run is clear.
  if (Math.min(x, ex) >= box.x1 + ease || Math.max(x, ex) <= box.x0 - ease) return limit
  if (Math.min(z, ez) >= box.z1 + ease || Math.max(z, ez) <= box.z0 - ease) return limit
  const steps = Math.max(1, Math.ceil(limit / 0.4)) // points 40 cm apart or less: the run stops short of where the ray enters
  let run = limit
  for (let i = 0; i <= steps; i += 1) {
    const t = (limit * i) / steps
    if (t - 0.5 >= run) break // every later point caps the run higher still
    const px = x + dx * t
    const pz = z + dz * t
    const clear = Math.hypot(Math.max(box.x0 - px, 0, px - box.x1), Math.max(box.z0 - pz, 0, pz - box.z1))
    if (clear < ease) run = Math.min(run, t - 0.5 + (limit + 0.5) * smooth(clear / ease))
  }
  return Math.max(0, run)
}

// ------------------------------------------------------------------ placing things

/** A place on a wall: the ground point under it, the wall's outward normal and rightward direction, its turn. */
function frameAt(point, normal) {
  const n = normal.clone().setY(0).normalize()
  return { origin: new THREE.Vector3(point.x, 0, point.z), normal: n, right: new THREE.Vector3(n.z, 0, -n.x), yaw: Math.atan2(n.x, n.z) }
}

/** The world point `x` right, `y` up and `z` out from a frame's origin (written into `into` if given). */
function at(frame, x, y, z, into = new THREE.Vector3()) {
  return into.copy(frame.origin).addScaledVector(frame.right, x).addScaledVector(UP, y).addScaledVector(frame.normal, z)
}

const placeMatrix = new THREE.Matrix4()
const placeTurn = new THREE.Quaternion()
const ONE = new THREE.Vector3(1, 1, 1)

/** A geometry moved into a frame: its centre at (x, y, z) in frame space, turned with the wall. */
function placed(geometry, frame, x, y, z) {
  return geometry.applyMatrix4(placeMatrix.compose(at(frame, x, y, z), placeTurn.setFromAxisAngle(UP, frame.yaw), ONE))
}

/** Gives a geometry one vertex colour, brighter than white so it blooms. */
function glowing(geometry, color, strength = 2) {
  const c = new THREE.Color(color).multiplyScalar(strength)
  const colors = new Float32Array(geometry.attributes.position.count * 3)
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** One mesh from many parts that share a material: one draw call. */
function merged(geometries, material) {
  const mesh = new THREE.Mesh(mergeGeometries(geometries), material)
  mesh.matrixAutoUpdate = false
  return mesh
}

/** Whether a mesh is a solid surface: not glow, glass or the inside of the sky. */
function solid(object) {
  const material = Array.isArray(object.material) ? object.material[0] : object.material
  return !!material && !material.transparent && material.side !== THREE.BackSide && material.blending === THREE.NormalBlending && material.depthWrite !== false
}

/** Tall solid meshes outside the office's patch, not ours: the towers a board may hang on. */
function towersIn(scene, own, extent) {
  const found = []
  const box = new THREE.Box3()
  scene.traverse(object => {
    if (!object.isMesh || !solid(object)) return
    for (let o = object; o; o = o.parent) if (o === own) return
    if (object.isInstancedMesh) {
      if (!object.boundingBox) object.computeBoundingBox()
      box.copy(object.boundingBox)
    } else {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      box.copy(object.geometry.boundingBox)
    }
    box.applyMatrix4(object.matrixWorld)
    if (box.max.y < 8) return
    if (box.min.x > -6 && box.max.x < extent + 6 && box.min.z > -4 && box.max.z < 24) return
    found.push(object)
  })
  return found
}

/** How far a screen's soft glow reaches past its edges. */
function haloMargin(w, h) {
  return 0.45 * Math.min(w, h) + 1.2
}

/**
 * Every solid triangle of the towers in world space, bucketed on a grid over the ground. A ray tests only
 * the triangles in the cells it crosses, so fitting the boards round the skyline can afford hundreds of rays.
 * Like three's raycaster on one-sided materials, a ray only hits faces turned toward it.
 */
class Solids {
  constructor(meshes, size = 8) {
    const data = []
    const sides = []
    const matrix = new THREE.Matrix4()
    const instance = new THREE.Matrix4()
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    for (const mesh of meshes) {
      const { position } = mesh.geometry.attributes
      const index = mesh.geometry.index
      const count = index ? index.count : position.count
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const twoSided = material.side === THREE.DoubleSide ? 1 : 0
      const copies = mesh.isInstancedMesh ? mesh.count : 1
      for (let c = 0; c < copies; c += 1) {
        matrix.copy(mesh.matrixWorld)
        if (mesh.isInstancedMesh) {
          mesh.getMatrixAt(c, instance)
          matrix.multiply(instance)
        }
        for (let i = 0; i + 2 < count; i += 3) {
          for (let j = 0; j < 3; j += 1) v[j].fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(matrix)
          const [a, b, cc] = v
          const e1x = b.x - a.x
          const e1y = b.y - a.y
          const e1z = b.z - a.z
          const e2x = cc.x - a.x
          const e2y = cc.y - a.y
          const e2z = cc.z - a.z
          // Per triangle: a corner, both edges from it and the (unit-less) normal they make.
          data.push(a.x, a.y, a.z, e1x, e1y, e1z, e2x, e2y, e2z, e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x)
          sides.push(twoSided)
        }
      }
    }
    this.tri = new Float32Array(data)
    this.twoSided = Uint8Array.from(sides)
    this.count = sides.length
    this.size = size
    // The grid over every triangle's ground footprint.
    let x0 = Infinity
    let z0 = Infinity
    let x1 = -Infinity
    let z1 = -Infinity
    const span = new Float32Array(this.count * 4) // min x, min z, max x, max z
    for (let i = 0; i < this.count; i += 1) {
      const k = i * 12
      const t = this.tri
      span[i * 4] = Math.min(t[k], t[k] + t[k + 3], t[k] + t[k + 6])
      span[i * 4 + 1] = Math.min(t[k + 2], t[k + 2] + t[k + 5], t[k + 2] + t[k + 8])
      span[i * 4 + 2] = Math.max(t[k], t[k] + t[k + 3], t[k] + t[k + 6])
      span[i * 4 + 3] = Math.max(t[k + 2], t[k + 2] + t[k + 5], t[k + 2] + t[k + 8])
      x0 = Math.min(x0, span[i * 4])
      z0 = Math.min(z0, span[i * 4 + 1])
      x1 = Math.max(x1, span[i * 4 + 2])
      z1 = Math.max(z1, span[i * 4 + 3])
    }
    if (!this.count) x0 = z0 = x1 = z1 = 0
    this.x0 = x0 - 0.01
    this.z0 = z0 - 0.01
    this.nx = Math.max(1, Math.ceil((x1 - this.x0 + 0.01) / size))
    this.nz = Math.max(1, Math.ceil((z1 - this.z0 + 0.01) / size))
    const cellsOf = (i, visit) => {
      const ca = Math.floor((span[i * 4] - this.x0) / size)
      const cb = Math.floor((span[i * 4 + 2] - this.x0) / size)
      const ra = Math.floor((span[i * 4 + 1] - this.z0) / size)
      const rb = Math.floor((span[i * 4 + 3] - this.z0) / size)
      for (let r = ra; r <= rb; r += 1) for (let c = ca; c <= cb; c += 1) visit(r * this.nx + c)
    }
    this.start = new Uint32Array(this.nx * this.nz + 1)
    for (let i = 0; i < this.count; i += 1) cellsOf(i, cell => (this.start[cell + 1] += 1))
    for (let cell = 0; cell < this.nx * this.nz; cell += 1) this.start[cell + 1] += this.start[cell]
    const fill = this.start.slice(0, -1)
    this.cells = new Uint32Array(this.start[this.nx * this.nz])
    for (let i = 0; i < this.count; i += 1) cellsOf(i, cell => (this.cells[fill[cell]++] = i))
    this.mark = new Uint32Array(this.count)
    this.stamp = 0
  }

  /**
   * The nearest hit along a ray (`dir` of unit length) within `far` metres, or null:
   * { distance, point, normal } with the normal facing out of the face hit.
   */
  cast(origin, dir, far) {
    const { tri, size, nx, nz, start, cells, mark } = this
    const stamp = (this.stamp = (this.stamp + 1) >>> 0 || 1)
    // Clip the ray's ground track to the grid.
    let t0 = 0
    let t1 = far
    const gx = this.x0 + nx * size
    const gz = this.z0 + nz * size
    if (Math.abs(dir.x) < 1e-9) {
      if (origin.x < this.x0 || origin.x > gx) return null
    } else {
      const a = (this.x0 - origin.x) / dir.x
      const b = (gx - origin.x) / dir.x
      t0 = Math.max(t0, Math.min(a, b))
      t1 = Math.min(t1, Math.max(a, b))
    }
    if (Math.abs(dir.z) < 1e-9) {
      if (origin.z < this.z0 || origin.z > gz) return null
    } else {
      const a = (this.z0 - origin.z) / dir.z
      const b = (gz - origin.z) / dir.z
      t0 = Math.max(t0, Math.min(a, b))
      t1 = Math.min(t1, Math.max(a, b))
    }
    if (t0 > t1) return null
    // Walk the cells the ground track crosses, nearest first, until a hit lies before the next cell.
    let cx = clamp(Math.floor((origin.x + dir.x * t0 - this.x0) / size), 0, nx - 1)
    let cz = clamp(Math.floor((origin.z + dir.z * t0 - this.z0) / size), 0, nz - 1)
    const sx = dir.x > 0 ? 1 : -1
    const sz = dir.z > 0 ? 1 : -1
    const dx = Math.abs(dir.x) < 1e-9 ? Infinity : size / Math.abs(dir.x)
    const dz = Math.abs(dir.z) < 1e-9 ? Infinity : size / Math.abs(dir.z)
    let tx = Math.abs(dir.x) < 1e-9 ? Infinity : (this.x0 + (cx + (sx > 0 ? 1 : 0)) * size - origin.x) / dir.x
    let tz = Math.abs(dir.z) < 1e-9 ? Infinity : (this.z0 + (cz + (sz > 0 ? 1 : 0)) * size - origin.z) / dir.z
    let best = far
    let found = -1
    while (cx >= 0 && cx < nx && cz >= 0 && cz < nz) {
      const cell = cz * nx + cx
      for (let k = start[cell]; k < start[cell + 1]; k += 1) {
        const i = cells[k]
        if (mark[i] === stamp) continue
        mark[i] = stamp
        const t = hitTriangle(tri, i * 12, origin, dir, !this.twoSided[i])
        if (t >= 0 && t < best) {
          best = t
          found = i
        }
      }
      if (Math.min(tx, tz) >= Math.min(best, t1)) break
      if (tx < tz) {
        cx += sx
        tx += dx
      } else {
        cz += sz
        tz += dz
      }
    }
    if (found < 0) return null
    const k = found * 12
    const normal = new THREE.Vector3(tri[k + 9], tri[k + 10], tri[k + 11]).normalize()
    if (normal.dot(dir) > 0) normal.negate()
    return { distance: best, point: origin.clone().addScaledVector(dir, best), normal }
  }
}

/** Where a ray meets the triangle at `k` in `tri` (distance along it), or -1; back faces are skipped when `cull`. */
function hitTriangle(tri, k, o, d, cull) {
  const nx = tri[k + 9]
  const ny = tri[k + 10]
  const nz = tri[k + 11]
  // As three's Ray.intersectTriangle: the ray meets the face's front when it runs against the normal.
  let ddn = d.x * nx + d.y * ny + d.z * nz
  let sign = -1
  if (ddn > 0) {
    if (cull) return -1
    sign = 1
  } else if (ddn < 0) {
    ddn = -ddn
  } else {
    return -1
  }
  const qx = o.x - tri[k]
  const qy = o.y - tri[k + 1]
  const qz = o.z - tri[k + 2]
  const e1x = tri[k + 3]
  const e1y = tri[k + 4]
  const e1z = tri[k + 5]
  const e2x = tri[k + 6]
  const e2y = tri[k + 7]
  const e2z = tri[k + 8]
  const u = sign * (d.x * (qy * e2z - qz * e2y) + d.y * (qz * e2x - qx * e2z) + d.z * (qx * e2y - qy * e2x))
  if (u < 0) return -1
  const v = sign * (d.x * (e1y * qz - e1z * qy) + d.y * (e1z * qx - e1x * qz) + d.z * (e1x * qy - e1y * qx))
  if (v < 0 || u + v > ddn) return -1
  const along = -sign * (qx * nx + qy * ny + qz * nz)
  return along < 0 ? -1 : along / ddn
}

/**
 * The upright tower walls turned toward the default camera, each as one flat rectangle: its outward `normal`,
 * its `right` (along the wall, as seen from in front), its distance `o` from the origin along the normal, its
 * span s0..s1 along `right`, heights y0..y1 and its `centre` on the ground.
 */
function facingWalls(solids, eye) {
  const pieces = new Map()
  const t = solids.tri
  for (let i = 0; i < solids.count; i += 1) {
    const k = i * 12
    const flat = Math.hypot(t[k + 9], t[k + 11])
    if (flat < 1e-6 || Math.abs(t[k + 10]) > 0.02 * flat) continue
    const nx = t[k + 9] / flat
    const nz = t[k + 11] / flat
    const xs = [t[k], t[k] + t[k + 3], t[k] + t[k + 6]]
    const ys = [t[k + 1], t[k + 1] + t[k + 4], t[k + 1] + t[k + 7]]
    const zs = [t[k + 2], t[k + 2] + t[k + 5], t[k + 2] + t[k + 8]]
    const mx = (xs[0] + xs[1] + xs[2]) / 3
    const mz = (zs[0] + zs[1] + zs[2]) / 3
    const toEye = Math.hypot(eye.x - mx, eye.z - mz)
    if ((nx * (eye.x - mx) + nz * (eye.z - mz)) / toEye < 0.35) continue
    const along = xs.map((x, j) => x * nz - zs[j] * nx)
    const s0 = Math.min(...along)
    const s1 = Math.max(...along)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    if (s1 - s0 < 4 || y1 - y0 < 3) continue
    const o = xs[0] * nx + zs[0] * nz
    // The two triangles of a wall's quad share its whole rectangle; quads stacked on one wall share its span.
    const key = `${Math.round(nx * 1000)} ${Math.round(nz * 1000)} ${Math.round(o * 20)} ${Math.round(s0 * 20)} ${Math.round(s1 * 20)}`
    if (!pieces.has(key)) pieces.set(key, { nx, nz, o, s0, s1, spans: [] })
    pieces.get(key).spans.push([y0, y1])
  }
  const walls = []
  for (const { nx, nz, o, s0, s1, spans } of pieces.values()) {
    spans.sort((a, b) => a[0] - b[0])
    let [y0, y1] = spans[0]
    const close = () => {
      const normal = new THREE.Vector3(nx, 0, nz)
      const right = new THREE.Vector3(nz, 0, -nx)
      const centre = normal.clone().multiplyScalar(o).addScaledVector(right, (s0 + s1) / 2)
      walls.push({ normal, right, o, s0, s1, y0, y1, centre })
    }
    for (const [a, b] of spans.slice(1)) {
      if (a <= y1 + 0.05) {
        y1 = Math.max(y1, b)
      } else {
        close()
        y0 = a
        y1 = b
      }
    }
    close()
  }
  return walls
}

// ------------------------------------------------------------------ materials and shapes

/** The hologram sign's material: additive light with drifting scan bands and a faint outline. */
function holoMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, time: { value: 0 }, gain: { value: 1.5 }, tint: { value: new THREE.Color('#2bf3ff') } },
    vertexShader: UV_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    toneMapped: false,
  })
}

/** A soft projector beam: brightest at its source and through its middle, fading at the edges and upward. */
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, gain: { value: 0.3 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    toneMapped: false,
  })
}

/** A holographic koi: glowing at its rim, see-through in the middle, with its own markings. */
function koiMaterial(body, spots, phase) {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      phase: { value: phase },
      body: { value: new THREE.Color(body) },
      spots: { value: new THREE.Color(spots) },
      gain: { value: 1.2 },
    },
    vertexShader: KOI_VERT,
    fragmentShader: KOI_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    toneMapped: false,
  })
}

let koiShape = null

/** A koi, head toward +z and back toward +y: a round body, a fan tail and two side fins lying flat so they read from above. */
function koiGeometry() {
  if (koiShape) return koiShape
  const length = 4.2
  const profile = []
  for (let i = 0; i <= 16; i += 1) {
    const s = i / 16 // 0 at the tail, 1 at the nose
    const r = 0.55 * Math.sin(Math.PI * s ** 1.4) ** 0.8 + 0.06 * (1 - s)
    profile.push(new THREE.Vector2(Math.max(r, 0.001), s * length - length * 0.62))
  }
  const body = new THREE.LatheGeometry(profile, 14).rotateX(Math.PI / 2).scale(0.85, 0.7, 1)
  const fan = (points, scale) => {
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    for (let i = 0; i < points.length; i += 4) shape.quadraticCurveTo(points[i], points[i + 1], points[i + 2], points[i + 3])
    return new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2).scale(scale, 1, scale)
  }
  const tail = fan([-0.9, 0.5, -1, 1.3, -0.4, 0.95, 0, 1.05, 0.4, 0.95, 1, 1.3, 0.9, 0.5, 0, 0], 1.1).translate(0, 0, -length * 0.62 + 0.15)
  const finR = fan([0.9, -0.1, 0.8, 0.6, 0.4, 0.5, 0, 0.25], 1).translate(0.32, 0, 0.9)
  const finL = fan([0.9, -0.1, 0.8, 0.6, 0.4, 0.5, 0, 0.25], 1).scale(-1, 1, 1).translate(-0.32, 0, 0.9)
  const head = length * 0.38
  for (const [geometry, fin] of [[body, 0], [tail, 1], [finR, 1], [finL, 1]]) {
    const position = geometry.attributes.position
    const along = new Float32Array(position.count)
    for (let i = 0; i < position.count; i += 1) along[i] = clamp((head - position.getZ(i)) / length, 0, 1.4)
    geometry.setAttribute('along', new THREE.BufferAttribute(along, 1))
    geometry.setAttribute('fin', new THREE.BufferAttribute(new Float32Array(position.count).fill(fin), 1))
  }
  koiShape = mergeGeometries([body, tail, finR, finL])
  return koiShape
}

let windows = null

/** The advert tower's skin: dark glass full of pinprick windows. */
function facadeMaterial() {
  windows ??= paintWindows()
  return new THREE.MeshStandardMaterial({
    color: '#0b0e16',
    roughness: 0.36,
    metalness: 0.55,
    emissive: '#ffffff',
    emissiveMap: windows,
    emissiveIntensity: 1.5,
  })
}

const FACADE_TILE = [16, 32] // metres of wall one window texture covers

/** A box whose walls repeat the window texture at true scale; its roof and floor map to a dark corner. */
function facadeBox(w, h, d) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  const uv = geometry.attributes.uv
  const sizes = [[d, h], [d, h], null, null, [w, h], [w, h]] // +x, -x, +y, -y, +z, -z
  for (let face = 0; face < 6; face += 1) {
    for (let i = face * 4; i < face * 4 + 4; i += 1) {
      const size = sizes[face]
      if (size) uv.setXY(i, (uv.getX(i) * size[0]) / FACADE_TILE[0], (uv.getY(i) * size[1]) / FACADE_TILE[1])
      else uv.setXY(i, 0.01, 0.01)
    }
  }
  return geometry
}

// ------------------------------------------------------------------ canvases

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return { canvas, g: canvas.getContext('2d') }
}

/** A mipmapped texture of a canvas, optionally repeating so an ad can scroll forever. */
function canvasTexture(canvas, { wrapX = false, wrapY = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (wrapX) texture.wrapS = THREE.RepeatWrapping
  if (wrapY) texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** The colour an ad throws into the wet air: the hue of its brightest parts, at full strength (linear). */
function castColor(canvas) {
  const { g } = makeCanvas(16, 16)
  g.drawImage(canvas, 0, 0, 16, 16)
  const px = g.getImageData(0, 0, 16, 16).data
  const sum = [0, 0, 0]
  for (let i = 0; i < px.length; i += 4) {
    const weight = (px[i] + px[i + 1] + px[i + 2]) ** 2
    sum[0] += px[i] * weight
    sum[1] += px[i + 1] * weight
    sum[2] += px[i + 2] * weight
  }
  const peak = Math.max(...sum, 1)
  return new THREE.Color().setRGB(sum[0] / peak, sum[1] / peak, sum[2] / peak, THREE.SRGBColorSpace)
}

/** A seeded random stream: a painted ad comes out the same on every load. */
function stream(seed) {
  let n = seed >>> 0
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0
    return n / 4294967296
  }
}

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** A linear gradient with stops [[at, colour], ...]. */
function linear(g, x0, y0, x1, y1, stops) {
  const grad = g.createLinearGradient(x0, y0, x1, y1)
  for (const [where, color] of stops) grad.addColorStop(where, color)
  return grad
}

/** Fills the canvas with a gradient through `colors`, top to bottom (or left to right). */
function wash(g, w, h, colors, across = false) {
  const stops = colors.map((color, i) => [i / (colors.length - 1), color])
  g.fillStyle = across ? linear(g, 0, 0, w, 0, stops) : linear(g, 0, 0, 0, h, stops)
  g.fillRect(0, 0, w, h)
}

/** A soft round glow, added on top of what is there. */
function glow(g, x, y, r, color, alpha = 1) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r)
  grad.addColorStop(0, rgba(color, alpha))
  grad.addColorStop(0.4, rgba(color, alpha * 0.35))
  grad.addColorStop(1, rgba(color, 0))
  g.save()
  g.globalCompositeOperation = 'lighter'
  g.fillStyle = grad
  g.fillRect(x - r, y - r, r * 2, r * 2)
  g.restore()
}

/** Words that glow: a blurred pass in `color`, then a crisp pass in `core`. */
function words(g, text, x, y, size, color, options = {}) {
  const { font = LATIN, weight = 800, align = 'center', core = color, blur = 0.4, italic = false, spacing = 0 } = options
  g.save()
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`
  if (spacing) g.letterSpacing = `${spacing}px`
  g.textAlign = align
  g.textBaseline = 'middle'
  g.shadowColor = color
  g.shadowBlur = size * blur
  g.fillStyle = color
  g.fillText(text, x, y)
  g.shadowBlur = 0
  g.fillStyle = core
  g.fillText(text, x, y)
  g.restore()
}

/** Characters stacked top to bottom, the way vertical signs read. */
function column(g, text, x, y, step, size, color, options = {}) {
  Array.from(text).forEach((ch, i) => words(g, ch, x, y + i * step, size, color, { font: KANA, ...options }))
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Faint light rays fanning out from a point. */
function rays(g, x, y, length, count, color, alpha) {
  g.save()
  g.globalCompositeOperation = 'lighter'
  g.fillStyle = rgba(color, alpha)
  const spread = Math.PI / count / 2.2
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + Math.cos(a - spread) * length, y + Math.sin(a - spread) * length)
    g.lineTo(x + Math.cos(a + spread) * length, y + Math.sin(a + spread) * length)
    g.closePath()
    g.fill()
  }
  g.restore()
}

/** Little rings drifting up, like fizz. */
function bubbles(g, rnd, x, y, w, h, count, size) {
  g.save()
  g.strokeStyle = 'rgba(190, 250, 255, 0.7)'
  g.lineWidth = Math.max(1, size * 0.25)
  for (let i = 0; i < count; i += 1) {
    g.beginPath()
    g.arc(x + rnd() * w, y + rnd() * h, size * (0.4 + rnd()), 0, Math.PI * 2)
    g.stroke()
  }
  g.restore()
}

/** A row of dark buildings standing on `base`, up to `tall` high, a few warm windows lit. */
function skyline(g, rnd, w, base, tall) {
  for (let x = 0; x < w; ) {
    const bw = 12 + rnd() * 30
    const bh = tall * (0.27 + rnd() * 0.73)
    g.fillStyle = '#090b1a'
    g.fillRect(x, base - bh, bw, bh)
    g.fillStyle = '#ffcf8a'
    for (let i = 0; i < 4; i += 1) if (rnd() < 0.6) g.fillRect(x + 3 + rnd() * (bw - 6), base - bh + 4 + rnd() * (bh - 8), 2, 2)
    x += bw + 2
  }
}

function stars(g, rnd, w, h, count) {
  g.fillStyle = '#dfe8ff'
  for (let i = 0; i < count; i += 1) {
    g.globalAlpha = 0.25 + rnd() * 0.6
    g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5)
  }
  g.globalAlpha = 1
}

// ------------------------------------------------------------------ the ads (all invented)

/** KAZERI soda: a can glowing cyan, fizz rising past it. */
function paintSoda(g, w, h) {
  const tall = h > w
  const rnd = stream(hash(`soda${w}x${Math.round(h)}`))
  wash(g, w, h, ['#03141c', '#06203a', '#120a2c'])
  const cx = tall ? w * 0.5 : w * 0.28
  const cy = tall ? h * 0.47 : h * 0.52
  const ch = tall ? Math.min(h * 0.44, w * 1.3) : h * 0.78
  const cw = ch * 0.5
  rays(g, cx, cy, Math.hypot(w, h), 18, '#2bf3ff', 0.07)
  glow(g, cx, cy, ch * 0.9, '#2bf3ff', 0.55)
  bubbles(g, rnd, cx - cw * 1.6, cy - ch * 0.7, cw * 3.2, ch * 1.4, tall ? 40 : 26, Math.max(2, cw * 0.06))
  can(g, cx - cw / 2, cy - ch / 2, cw, ch)
  if (tall) {
    words(g, 'KAZERI', w / 2, h * 0.11, w * 0.2, '#2bf3ff', { core: '#eafdff' })
    words(g, 'ソーダ', w / 2, h * 0.8, w * 0.17, '#ff2bd6', { font: KANA, core: '#ffd6f6' })
    words(g, 'ICE-COLD NIGHTS', w / 2, h * 0.9, w * 0.07, '#9fe8ff', { weight: 600 })
  } else {
    words(g, 'KAZERI', w * 0.69, h * 0.36, h * 0.27, '#2bf3ff', { core: '#eafdff' })
    words(g, 'ソーダ', w * 0.69, h * 0.62, h * 0.13, '#ff2bd6', { font: KANA, core: '#ffd6f6' })
    words(g, 'ICE-COLD NIGHTS', w * 0.69, h * 0.8, h * 0.075, '#9fe8ff', { weight: 600 })
  }
}

/** A drink can lit from the left, with a magenta wave on its label. */
function can(g, x, y, w, h) {
  g.save()
  roundRect(g, x, y, w, h, w * 0.14)
  g.fillStyle = linear(g, x, 0, x + w, 0, [[0, '#04252e'], [0.16, '#22d8f0'], [0.28, '#f2feff'], [0.42, '#2bc4dc'], [0.78, '#0a4658'], [1, '#021318']])
  g.fill()
  g.clip()
  g.beginPath()
  g.moveTo(x, y + h * 0.58)
  g.bezierCurveTo(x + w * 0.35, y + h * 0.48, x + w * 0.65, y + h * 0.68, x + w, y + h * 0.56)
  g.lineTo(x + w, y + h * 0.72)
  g.bezierCurveTo(x + w * 0.65, y + h * 0.84, x + w * 0.35, y + h * 0.64, x, y + h * 0.74)
  g.closePath()
  g.fillStyle = linear(g, x, 0, x + w, 0, [[0, '#5a0a4a'], [0.28, '#ff7ae6'], [0.45, '#ff2bd6'], [1, '#3a0630']])
  g.fill()
  g.fillStyle = 'rgba(10, 20, 28, 0.55)'
  g.fillRect(x, y, w, h * 0.06)
  g.fillRect(x, y + h * 0.94, w, h * 0.06)
  g.restore()
  g.save()
  g.translate(x + w * 0.56, y + h * 0.34)
  g.rotate(-Math.PI / 2)
  words(g, 'KAZERI', 0, 0, w * 0.34, '#ffffff', { blur: 0.25 })
  g.restore()
}

/** A noodle stand open all night: a steaming bowl under warm light. */
function paintNoodle(g, w, h) {
  const tall = h > w
  wash(g, w, h, ['#1c0604', '#3a1006', '#14040a'])
  const bx = tall ? w * 0.5 : w * 0.28
  const by = tall ? h * 0.6 : h * 0.6
  const bw = tall ? w * 0.78 : h * 0.95
  glow(g, bx, by - bw * 0.1, bw * 0.9, '#ffb02b', 0.5)
  steam(g, bx, by - bw * 0.16, bw, tall)
  bowl(g, bx, by, bw)
  if (tall) {
    words(g, 'ラーメン', w / 2, h * 0.12, w * 0.2, '#ffb02b', { font: KANA, core: '#fff0c2' })
    words(g, '24H', w / 2, h * 0.86, w * 0.22, '#ff3b5c', { core: '#ffd0d8' })
  } else {
    words(g, 'ラーメン', w * 0.72, h * 0.34, h * 0.2, '#ffb02b', { font: KANA, core: '#fff0c2' })
    words(g, 'NOODLE STAND', w * 0.72, h * 0.58, h * 0.1, '#ff3b5c', { core: '#ffd0d8' })
    words(g, 'OPEN ALL NIGHT · 24H', w * 0.72, h * 0.76, h * 0.07, '#ffcf8a', { weight: 600 })
  }
}

/** Three soft curls of steam. */
function steam(g, x, y, w, tall) {
  g.save()
  g.globalCompositeOperation = 'lighter'
  g.strokeStyle = 'rgba(255, 236, 214, 0.28)'
  g.lineWidth = w * 0.035
  g.lineCap = 'round'
  g.shadowColor = '#ffe0c0'
  g.shadowBlur = w * 0.05
  for (const dx of [-0.18, 0, 0.18]) {
    const sx = x + dx * w
    g.beginPath()
    g.moveTo(sx, y)
    g.bezierCurveTo(sx - w * 0.1, y - w * 0.18, sx + w * 0.1, y - w * 0.3, sx, y - w * (tall ? 0.48 : 0.42))
    g.stroke()
  }
  g.restore()
}

/** A bowl of noodles with an egg and seaweed, seen from the side and a little above. */
function bowl(g, x, y, w) {
  const rim = w * 0.12
  g.save()
  g.beginPath()
  g.ellipse(x, y, w / 2, rim, 0, 0, Math.PI * 2)
  g.fillStyle = linear(g, x - w / 2, 0, x + w / 2, 0, [[0, '#7a3a0a'], [0.5, '#e08a2a'], [1, '#6a2a08']])
  g.fill()
  g.clip()
  g.strokeStyle = '#ffd98a'
  g.lineWidth = Math.max(1.5, w * 0.012)
  for (let i = 0; i < 7; i += 1) {
    g.beginPath()
    for (let s = 0; s <= 24; s += 1) {
      const px = x - w / 2 + (s / 24) * w
      const py = y - rim * 0.7 + i * rim * 0.22 + Math.sin(s * 1.3 + i * 2.1) * w * 0.012
      if (s === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
  }
  g.restore()
  g.fillStyle = '#0d2a1a'
  g.fillRect(x + w * 0.12, y - w * 0.16, w * 0.13, w * 0.14)
  g.fillStyle = '#fff4e0'
  g.beginPath()
  g.ellipse(x - w * 0.15, y - w * 0.02, w * 0.09, w * 0.05, -0.2, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffb02b'
  g.beginPath()
  g.ellipse(x - w * 0.14, y - w * 0.025, w * 0.045, w * 0.028, -0.2, 0, Math.PI * 2)
  g.fill()
  // The bowl itself, below the front of the rim.
  g.beginPath()
  g.moveTo(x - w / 2, y)
  g.bezierCurveTo(x - w * 0.48, y + w * 0.42, x + w * 0.48, y + w * 0.42, x + w / 2, y)
  g.ellipse(x, y, w / 2, rim, 0, 0, Math.PI)
  g.closePath()
  g.fillStyle = linear(g, x - w / 2, 0, x + w / 2, 0, [[0, '#3a0408'], [0.3, '#ff3b5c'], [0.6, '#a80a24'], [1, '#2a0206']])
  g.fill()
  g.strokeStyle = '#ffcf8a'
  g.lineWidth = Math.max(1.5, w * 0.012)
  g.beginPath()
  g.ellipse(x, y, w / 2, rim, 0, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = 'rgba(255, 240, 220, 0.6)'
  g.beginPath()
  for (let i = 0; i < 9; i += 1) {
    const px = x - w * 0.32 + i * w * 0.08
    g.moveTo(px, y + w * 0.2)
    g.quadraticCurveTo(px + w * 0.02, y + w * 0.17, px + w * 0.04, y + w * 0.2)
  }
  g.stroke()
  g.strokeStyle = '#d9a066'
  g.lineWidth = Math.max(2, w * 0.018)
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(x + w * 0.05, y - w * 0.05)
  g.lineTo(x + w * 0.55, y - w * 0.42)
  g.moveTo(x + w * 0.1, y - w * 0.02)
  g.lineTo(x + w * 0.6, y - w * 0.36)
  g.stroke()
}

/** ORVEX GT: a low sky-car in profile, rim-lit, light trails streaming behind it. */
function paintOrvex(g, w, h) {
  const tall = h > w
  const rnd = stream(hash(`orvex${w}x${Math.round(h)}`))
  wash(g, w, h, ['#03040c', '#0b1030', '#1a1f4a'])
  g.save()
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < (tall ? 44 : 26); i += 1) {
    const y = tall ? h * (0.34 + rnd() * 0.2) : h * (0.25 + rnd() * 0.6)
    const length = w * (0.3 + rnd() * 0.7)
    const x0 = rnd() * w * 0.5
    const color = rnd() < 0.5 ? '#2bf3ff' : '#ff2bd6'
    g.fillStyle = linear(g, x0, 0, x0 + length, 0, [[0, rgba(color, 0)], [1, rgba(color, 0.5)]])
    g.fillRect(x0, y, length, Math.max(1, h * (tall ? 0.002 : 0.005)))
  }
  g.restore()
  if (tall) {
    // A city on the horizon, a glossy floor, and the car over it with its reflection.
    const floor = h * 0.56
    const carY = floor - w * 0.92 * 0.3 - h * 0.012
    skyline(g, rnd, w, floor, h * 0.14)
    g.fillStyle = linear(g, 0, floor, 0, h, [[0, '#1a1f4a'], [0.4, '#0a0c22'], [1, '#05060d']])
    g.fillRect(0, floor, w, h - floor)
    g.fillStyle = rgba('#2bf3ff', 0.6)
    g.fillRect(0, floor, w, 2)
    skyCar(g, w * 0.04, carY, w * 0.92)
    g.save()
    g.translate(0, floor * 2)
    g.scale(1, -1)
    g.globalAlpha = 0.25
    skyCar(g, w * 0.04, carY, w * 0.92)
    g.restore()
    words(g, 'ORVEX', w / 2, h * 0.12, w * 0.24, '#c9d8ff', { core: '#ffffff', italic: true })
    words(g, 'GT', w / 2, h * 0.2, w * 0.14, '#2bf3ff', { core: '#e6feff', italic: true })
    words(g, 'FLY ABOVE THE RAIN', w / 2, h * 0.8, w * 0.07, '#2bf3ff', { weight: 600 })
    words(g, 'ALL-WEATHER SKY CAR', w / 2, h * 0.86, w * 0.05, '#c9b6ff', { weight: 500 })
  } else {
    skyCar(g, w * 0.05, h * 0.38, w * 0.56)
    words(g, 'ORVEX GT', w * 0.8, h * 0.32, h * 0.17, '#c9d8ff', { core: '#ffffff', italic: true })
    words(g, 'FLY ABOVE THE RAIN', w * 0.8, h * 0.55, h * 0.075, '#2bf3ff', { weight: 600 })
    words(g, 'ALL-WEATHER SKY CAR', w * 0.8, h * 0.7, h * 0.06, '#c9b6ff', { weight: 500 })
  }
}

/** An invented sky-car in profile, nose to the right: a dark wedge, a cyan rim light, red tail and white head lights. */
function skyCar(g, x, y, w) {
  const h = w * 0.3
  const P = (u, v) => [x + u * w, y + v * h]
  glow(g, x + w * 0.5, y + h, w * 0.45, '#ff2bd6', 0.45)
  g.save()
  g.beginPath()
  g.moveTo(...P(0, 0.62))
  g.quadraticCurveTo(...P(0.02, 0.3), ...P(0.16, 0.26))
  g.quadraticCurveTo(...P(0.34, 0), ...P(0.55, 0.04))
  g.quadraticCurveTo(...P(0.72, 0.08), ...P(0.84, 0.36))
  g.quadraticCurveTo(...P(1, 0.42), ...P(1, 0.6))
  g.quadraticCurveTo(...P(0.98, 0.82), ...P(0.86, 0.84))
  g.lineTo(...P(0.1, 0.86))
  g.quadraticCurveTo(...P(0, 0.84), ...P(0, 0.62))
  g.closePath()
  g.fillStyle = linear(g, 0, y, 0, y + h, [[0, '#2a3350'], [0.45, '#121726'], [1, '#05070c']])
  g.fill()
  g.strokeStyle = '#9ffcff'
  g.lineWidth = Math.max(1.5, w * 0.006)
  g.shadowColor = '#2bf3ff'
  g.shadowBlur = w * 0.03
  g.beginPath()
  g.moveTo(...P(0.16, 0.26))
  g.quadraticCurveTo(...P(0.34, 0), ...P(0.55, 0.04))
  g.quadraticCurveTo(...P(0.72, 0.08), ...P(0.84, 0.36))
  g.stroke()
  g.restore()
  // The canopy, catching the city in a glint.
  g.beginPath()
  g.moveTo(...P(0.3, 0.3))
  g.quadraticCurveTo(...P(0.42, 0.08), ...P(0.56, 0.1))
  g.quadraticCurveTo(...P(0.68, 0.14), ...P(0.74, 0.34))
  g.closePath()
  g.fillStyle = linear(g, x + w * 0.3, 0, x + w * 0.74, 0, [[0, '#0a1428'], [0.55, '#2a5aa0'], [0.62, '#cfe8ff'], [0.7, '#1a3a6a'], [1, '#0a1428']])
  g.fill()
  g.fillStyle = '#2bf3ff'
  g.fillRect(...P(0.16, 0.56), w * 0.62, Math.max(1, h * 0.025))
  glow(g, ...P(0.02, 0.52), w * 0.08, '#ff3b5c', 0.9)
  g.fillStyle = '#ffd0d8'
  g.fillRect(...P(0, 0.48), w * 0.035, h * 0.08)
  glow(g, ...P(0.99, 0.55), w * 0.07, '#ffffff', 0.9)
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.ellipse(...P(0.985, 0.55), w * 0.012, h * 0.045, 0, 0, Math.PI * 2)
  g.fill()
}

/** YOZORA LINES: a night train gliding under a big moon. */
function paintYozora(g, w, h) {
  const rnd = stream(hash('yozora'))
  wash(g, w, h, ['#070a1c', '#1a1f4a', '#4a2462'])
  stars(g, rnd, w, h * 0.6, 50)
  const mr = h * 0.17
  glow(g, w * 0.78, h * 0.3, mr * 3, '#9fb8ff', 0.45)
  const moon = g.createRadialGradient(w * 0.76, h * 0.27, 0, w * 0.78, h * 0.3, mr)
  moon.addColorStop(0, '#ffffff')
  moon.addColorStop(0.7, '#dfe8ff')
  moon.addColorStop(1, '#aab8e8')
  g.fillStyle = moon
  g.beginPath()
  g.arc(w * 0.78, h * 0.3, mr, 0, Math.PI * 2)
  g.fill()
  skyline(g, rnd, w, h, h * 0.3)
  // The guideway and the train on it.
  g.fillStyle = '#0c0e1e'
  g.fillRect(0, h * 0.7, w, h * 0.035)
  g.fillStyle = rgba('#2bf3ff', 0.8)
  g.fillRect(0, h * 0.7, w, 1.5)
  roundRect(g, w * 0.06, h * 0.56, w * 0.6, h * 0.13, h * 0.065)
  g.fillStyle = linear(g, 0, h * 0.56, 0, h * 0.69, [[0, '#f0f4ff'], [1, '#8a98c8']])
  g.fill()
  glow(g, w * 0.36, h * 0.6, w * 0.32, '#ffcf8a', 0.25)
  g.fillStyle = '#ffcf8a'
  g.fillRect(w * 0.1, h * 0.585, w * 0.5, h * 0.035)
  g.fillStyle = '#ff2bd6'
  g.fillRect(w * 0.08, h * 0.64, w * 0.56, h * 0.012)
  words(g, '夜空', w * 0.17, h * 0.27, h * 0.24, '#c9b6ff', { font: KANA, core: '#ffffff' })
  words(g, 'LINES', w * 0.4, h * 0.28, h * 0.16, '#dfe8ff', { core: '#ffffff' })
  words(g, 'RIDE THE NIGHT', w * 0.3, h * 0.45, h * 0.07, '#9fe8ff', { weight: 600 })
}

/** HOTEL KUMO: a slim tower rising out of lilac clouds. */
function paintKumo(g, w, h) {
  const rnd = stream(hash('kumo'))
  wash(g, w, h, ['#0a0920', '#24184a', '#5a2a6a'])
  stars(g, rnd, w, h * 0.5, 40)
  g.fillStyle = '#0c0a1e'
  g.fillRect(w * 0.17, h * 0.12, w * 0.1, h * 0.88)
  g.fillStyle = '#ffcf8a'
  for (let y = h * 0.16; y < h; y += h * 0.05) {
    for (let x = w * 0.18; x < w * 0.26; x += w * 0.018) if (rnd() < 0.45) g.fillRect(x, y, 2.5, 3)
  }
  g.fillStyle = '#ff2bd6'
  g.fillRect(w * 0.17, h * 0.12, w * 0.1, 2.5)
  glow(g, w * 0.22, h * 0.12, w * 0.06, '#ff2bd6', 0.6)
  for (let i = 0; i < 9; i += 1) {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1)
    grad.addColorStop(0, 'rgba(201, 182, 255, 0.45)')
    grad.addColorStop(1, 'rgba(201, 182, 255, 0)')
    g.save()
    g.translate(w * (i / 8), h * (0.78 + rnd() * 0.18))
    g.scale(w * (0.14 + rnd() * 0.1), h * (0.1 + rnd() * 0.08))
    g.fillStyle = grad
    g.beginPath()
    g.arc(0, 0, 1, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  words(g, '雲', w * 0.48, h * 0.48, h * 0.48, '#c9b6ff', { font: KANA, core: '#f4efff' })
  words(g, 'HOTEL KUMO', w * 0.8, h * 0.38, h * 0.12, '#ffcf8a', { core: '#fff3dc' })
  words(g, 'SLEEP ABOVE THE RAIN', w * 0.8, h * 0.58, h * 0.065, '#c9b6ff', { weight: 600 })
}

const PIXEL_KOI = [
  '......OOO.........',
  '....OOWWWOO.....OO',
  '..OOWWWWOOOOO..OOO',
  '.OOEWWOOWWOOOOOOO.',
  '..OOWWWWOOOOO..OOO',
  '....OOWWWOO.....OO',
  '......OOO.........',
]

/** PIXEL KOI arcade: a blocky fish over a glowing grid. */
function paintArcade(g, w, h) {
  wash(g, w, h, ['#05020c', '#14062a', '#2a0a3a'])
  const horizon = h * 0.58
  g.save()
  g.beginPath()
  g.rect(0, horizon, w, h - horizon)
  g.clip()
  g.strokeStyle = rgba('#ff2bd6', 0.6)
  g.lineWidth = 1.5
  for (let i = -12; i <= 12; i += 1) {
    g.beginPath()
    g.moveTo(w / 2 + i * w * 0.012, horizon)
    g.lineTo(w / 2 + i * w * 0.12, h)
    g.stroke()
  }
  for (let k = 1; k < 9; k += 1) {
    const y = horizon + (h - horizon) * (k / 8) ** 2
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(w, y)
    g.stroke()
  }
  g.restore()
  glow(g, w * 0.3, horizon, h * 0.5, '#ff2bd6', 0.35)
  const cell = h * 0.05
  const left = w * 0.3 - (PIXEL_KOI[0].length * cell) / 2
  const top = h * 0.42 - (PIXEL_KOI.length * cell) / 2
  const colors = { O: '#ff6a2b', W: '#fff4ec', E: '#140a1a' }
  PIXEL_KOI.forEach((line, row) => {
    for (let col = 0; col < line.length; col += 1) {
      if (!colors[line[col]]) continue
      g.fillStyle = colors[line[col]]
      g.fillRect(left + col * cell, top + row * cell, cell - 1, cell - 1)
    }
  })
  words(g, 'PIXEL KOI', w * 0.72, h * 0.3, h * 0.13, '#3bff9d', { font: 'Menlo, Monaco, monospace', core: '#d8ffe9' })
  words(g, 'ゲーム', w * 0.72, h * 0.52, h * 0.14, '#ff2bd6', { font: KANA, core: '#ffd6f6' })
  words(g, 'ARCADE · 2F', w * 0.72, h * 0.72, h * 0.08, '#2bf3ff', { weight: 700 })
}

/** MIRAVO: a face in profile made of strips of light. */
function paintMiravo(g, w, h) {
  wash(g, w, h, ['#12061f', '#2e0a3a', '#0a0e2a'], true)
  glow(g, w * 0.26, h * 0.5, h * 0.8, '#ff2bd6', 0.35)
  const px = w * 0.06
  const py = h * 0.05
  const pw = h * 0.8
  const ph = h * 0.95
  const P = (u, v) => [px + u * pw, py + v * ph]
  g.save()
  g.beginPath()
  g.moveTo(...P(0.3, 0.02))
  g.quadraticCurveTo(...P(0.62, 0), ...P(0.68, 0.22))
  g.quadraticCurveTo(...P(0.7, 0.3), ...P(0.68, 0.34))
  g.quadraticCurveTo(...P(0.8, 0.46), ...P(0.82, 0.5))
  g.quadraticCurveTo(...P(0.78, 0.54), ...P(0.72, 0.55))
  g.quadraticCurveTo(...P(0.76, 0.58), ...P(0.74, 0.61))
  g.quadraticCurveTo(...P(0.7, 0.63), ...P(0.73, 0.66))
  g.quadraticCurveTo(...P(0.74, 0.69), ...P(0.7, 0.71))
  g.quadraticCurveTo(...P(0.71, 0.8), ...P(0.62, 0.83))
  g.quadraticCurveTo(...P(0.5, 0.84), ...P(0.46, 0.86))
  g.lineTo(...P(0.5, 1))
  g.lineTo(...P(0.12, 1))
  g.quadraticCurveTo(...P(0, 0.5), ...P(0.3, 0.02))
  g.closePath()
  g.clip()
  g.fillStyle = linear(g, px, 0, px + pw, 0, [[0, '#7b5cff'], [0.5, '#ff7ae6'], [1, '#2bf3ff']])
  for (let y = py; y < py + ph; y += h * 0.035) g.fillRect(px, y, pw, h * 0.022)
  g.restore()
  words(g, 'MIRAVO', w * 0.7, h * 0.38, h * 0.2, '#ffffff', { weight: 400, spacing: h * 0.03 })
  words(g, 'BE MORE YOU', w * 0.7, h * 0.6, h * 0.08, '#ff2bd6', { core: '#ffe0f8' })
  words(g, 'ミライ', w * 0.7, h * 0.76, h * 0.08, '#2bf3ff', { font: KANA, core: '#dcfdff' })
}

/** NOVYN: a wrap-around visor with the city caught in its lens. */
function paintVisor(g, w, h) {
  const rnd = stream(hash('visor'))
  wash(g, w, h, ['#04050c', '#0c0f22', '#05060d'])
  glow(g, w * 0.3, -h * 0.2, h * 1.1, '#7b5cff', 0.35)
  const cx = w * 0.3
  const cy = h * 0.52
  const vw = w * 0.5
  const vh = h * 0.3
  g.save()
  g.beginPath()
  g.moveTo(cx - vw / 2, cy - vh * 0.25)
  g.bezierCurveTo(cx - vw * 0.3, cy - vh * 0.62, cx + vw * 0.3, cy - vh * 0.62, cx + vw / 2, cy - vh * 0.25)
  g.quadraticCurveTo(cx + vw * 0.52, cy + vh * 0.35, cx + vw * 0.3, cy + vh * 0.45)
  g.quadraticCurveTo(cx + vw * 0.08, cy + vh * 0.5, cx, cy + vh * 0.18)
  g.quadraticCurveTo(cx - vw * 0.08, cy + vh * 0.5, cx - vw * 0.3, cy + vh * 0.45)
  g.quadraticCurveTo(cx - vw * 0.52, cy + vh * 0.35, cx - vw / 2, cy - vh * 0.25)
  g.closePath()
  g.fillStyle = linear(g, cx - vw / 2, 0, cx + vw / 2, 0, [[0, '#ff2bd6'], [0.5, '#7b5cff'], [1, '#2bf3ff']])
  g.fill()
  g.clip()
  g.fillStyle = 'rgba(10, 8, 30, 0.55)'
  for (let x = cx - vw / 2; x < cx + vw / 2; ) {
    const bw = 6 + rnd() * 14
    const bh = vh * (0.15 + rnd() * 0.35)
    g.fillRect(x, cy + vh * 0.5 - bh, bw, bh)
    x += bw + 2
  }
  g.globalCompositeOperation = 'lighter'
  g.fillStyle = 'rgba(255, 255, 255, 0.35)'
  g.beginPath()
  g.moveTo(cx - vw * 0.2, cy - vh)
  g.lineTo(cx - vw * 0.08, cy - vh)
  g.lineTo(cx - vw * 0.3, cy + vh)
  g.lineTo(cx - vw * 0.42, cy + vh)
  g.closePath()
  g.fill()
  g.restore()
  g.strokeStyle = '#dfe8ff'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(cx - vw / 2, cy - vh * 0.25)
  g.bezierCurveTo(cx - vw * 0.3, cy - vh * 0.62, cx + vw * 0.3, cy - vh * 0.62, cx + vw / 2, cy - vh * 0.25)
  g.stroke()
  words(g, 'NOVYN', w * 0.76, h * 0.36, h * 0.19, '#e8ecff', { weight: 700, spacing: h * 0.02 })
  words(g, 'SEE MORE OF THE CITY', w * 0.76, h * 0.58, h * 0.068, '#2bf3ff', { weight: 600 })
  words(g, 'VISOR · SERIES 7', w * 0.76, h * 0.74, h * 0.06, '#c9b6ff', { weight: 500 })
}

/** Katakana words stacked down a tall sign: NEON, NIGHT SKY, FUTURE. Tiles top to bottom without a seam. */
function paintKana(g, w, h) {
  g.fillStyle = '#07040f'
  g.fillRect(0, 0, w, h)
  const marks = []
  for (const [word, color, core] of [['ネオン', '#ff2bd6', '#ffd6f6'], ['ヨゾラ', '#2bf3ff', '#dcfdff'], ['ミライ', '#3bff9d', '#dbffe9']]) {
    for (const ch of word) marks.push([ch, color, core, 1])
    marks.push(['◆', '#ffb02b', '#fff0c2', 0.4])
  }
  const wide = w >= 400
  const step = h / marks.length
  const x = wide ? w * 0.4 : w / 2
  const size = Math.min(w * (wide ? 0.5 : 0.62), step * 0.82)
  // Drawn above and below the tile too, so each glow wraps round the seam.
  for (const copy of [-h, 0, h]) {
    marks.forEach(([ch, color, core, scale], i) => words(g, ch, x, copy + step * (i + 0.5), size * scale, color, { font: KANA, core, blur: 0.3 }))
  }
  const rail = Math.max(2, w * 0.012)
  g.fillStyle = rgba('#2bf3ff', 0.55)
  g.fillRect(w * 0.05, 0, rail, h)
  g.fillRect(w * 0.95 - rail, 0, rail, h)
  if (!wide) return
  for (const where of [0.25, 0.75]) {
    g.save()
    g.translate(w * 0.82, h * where)
    g.rotate(-Math.PI / 2)
    words(g, 'TOMORROW IS OPEN', 0, 0, w * 0.09, '#c9b6ff', { core: '#f4efff', weight: 700 })
    g.restore()
  }
}

const TICKER = '     ◆ RAIN ADVISORY: SOFT RAIN UNTIL DAWN     ◆ YOZORA LINES: ALL TRAINS ON TIME     ◆ KAZERI SODA — ICE-COLD NIGHTS     ◆ ネオン · ヨゾラ · ミライ     ◆ HOTEL KUMO: ROOMS ABOVE THE CLOUDS     ◆ NIGHT MARKET OPEN TILL DAWN     '

/** The news ticker: one pass of the text fitted to exactly the canvas width, so it repeats without a seam. */
function paintTicker(g, w, h) {
  g.fillStyle = '#06040c'
  g.fillRect(0, 0, w, h)
  g.font = `700 ${h * 0.62}px ${KANA}`
  const natural = g.measureText(TICKER).width
  g.save()
  g.scale(w / natural, 1)
  g.textBaseline = 'middle'
  g.fillStyle = '#ffb02b'
  g.shadowColor = '#ffb02b'
  g.shadowBlur = h * 0.2
  g.fillText(TICKER, 0, h * 0.54)
  g.restore()
  g.fillStyle = 'rgba(255, 176, 43, 0.55)'
  g.fillRect(0, 2, w, 2)
  g.fillRect(0, h - 4, w, 2)
}

/** The face's still parts: backdrop, hair, skin, brows, nose and words. Painted once, in metres (18 x 46). */
function paintFace(g, w, h) {
  const X = v => (v * w) / MEGA.width
  wash(g, w, h, ['#090c26', '#1a1f4a', '#2a1440'])
  glow(g, X(3), X(16), X(15), '#ff2bd6', 0.3)
  glow(g, X(17), X(34), X(13), '#2bf3ff', 0.2)
  // Hair behind the head, falling past the shoulders.
  g.fillStyle = '#0b0818'
  g.beginPath()
  g.ellipse(X(9.8), X(21), X(9.6), X(15.5), 0, 0, Math.PI * 2)
  g.fill()
  for (const [a, b, c, d] of [[0.6, 0.4, 5, 4.4], [19, 19.4, 14.6, 15.2]]) {
    g.beginPath()
    g.moveTo(X(a), X(18))
    g.lineTo(X(b), X(46))
    g.lineTo(X(c), X(46))
    g.lineTo(X(d), X(26))
    g.closePath()
    g.fill()
  }
  // Neck and shoulders.
  g.fillStyle = linear(g, 0, X(36), 0, X(46), [[0, '#4a3c7a'], [1, '#120e2a']])
  g.beginPath()
  g.moveTo(X(6.6), X(35))
  g.lineTo(X(13.2), X(35))
  g.lineTo(X(14), X(42))
  g.quadraticCurveTo(X(17.5), X(43.5), X(18), X(46))
  g.lineTo(X(1.5), X(46))
  g.quadraticCurveTo(X(2.5), X(43.4), X(5.8), X(42))
  g.closePath()
  g.fill()
  // The face: lit from the upper left, falling into violet shade on the right.
  const skin = g.createRadialGradient(X(7.4), X(20), X(0.5), X(8.4), X(23), X(15))
  skin.addColorStop(0, '#e4dafc')
  skin.addColorStop(0.32, '#b6a4ec')
  skin.addColorStop(0.62, '#7662b4')
  skin.addColorStop(1, '#221a48')
  g.fillStyle = skin
  g.beginPath()
  g.moveTo(X(9.8), X(10.8))
  g.bezierCurveTo(X(15.4), X(10.8), X(17.3), X(17), X(17.1), X(24))
  g.bezierCurveTo(X(16.9), X(30.5), X(14.2), X(37.6), X(9.8), X(38.6))
  g.bezierCurveTo(X(5.4), X(37.6), X(2.7), X(30.5), X(2.5), X(24))
  g.bezierCurveTo(X(2.3), X(17), X(4.2), X(10.8), X(9.8), X(10.8))
  g.closePath()
  g.fill()
  // Magenta neon catching the right cheek from somewhere off screen.
  g.save()
  g.clip()
  g.globalCompositeOperation = 'lighter'
  g.fillStyle = linear(g, X(17.2), 0, X(13.5), 0, [[0, 'rgba(255, 43, 214, 0.55)'], [1, 'rgba(255, 43, 214, 0)']])
  g.fillRect(X(12), X(10), X(6), X(30))
  g.restore()
  glow(g, X(5.4), X(29.4), X(2.6), '#ff2bd6', 0.22)
  glow(g, X(14.3), X(29.4), X(2.6), '#ff2bd6', 0.22)
  glow(g, X(6.5), X(21.6), X(2.4), '#7b5cff', 0.3)
  glow(g, X(13.1), X(21.6), X(2.4), '#7b5cff', 0.3)
  g.strokeStyle = 'rgba(70, 52, 120, 0.7)'
  g.lineWidth = X(0.24)
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(X(10.7), X(23.4))
  g.quadraticCurveTo(X(11.3), X(27), X(10.9), X(28.7))
  g.moveTo(X(8.9), X(29.3))
  g.quadraticCurveTo(X(9.9), X(30.1), X(10.9), X(29.3))
  g.stroke()
  glow(g, X(10.2), X(28.2), X(0.8), '#ffffff', 0.25)
  g.strokeStyle = '#1c1234'
  g.lineWidth = X(0.42)
  g.beginPath()
  g.moveTo(X(4.5), X(20.4))
  g.quadraticCurveTo(X(6.4), X(19.3), X(8.5), X(20.1))
  g.moveTo(X(11.1), X(20.1))
  g.quadraticCurveTo(X(13.2), X(19.3), X(15.1), X(20.4))
  g.stroke()
  // The fringe across the forehead, with cyan light caught in it.
  g.fillStyle = '#0b0818'
  g.beginPath()
  g.moveTo(X(1.8), X(26))
  g.bezierCurveTo(X(1.4), X(12), X(5), X(5.6), X(10.4), X(5.6))
  g.bezierCurveTo(X(15.6), X(5.6), X(18.4), X(11), X(17.9), X(25))
  g.bezierCurveTo(X(17), X(20), X(16.6), X(16.2), X(15.4), X(15.2))
  g.bezierCurveTo(X(12.6), X(13.6), X(8), X(14.6), X(4.4), X(17.6))
  g.bezierCurveTo(X(3.4), X(19), X(2.8), X(22), X(1.8), X(26))
  g.closePath()
  g.fill()
  g.strokeStyle = 'rgba(43, 243, 255, 0.6)'
  g.lineWidth = X(0.16)
  g.beginPath()
  g.moveTo(X(2.6), X(24))
  g.bezierCurveTo(X(2.2), X(13), X(6), X(7), X(10.4), X(6.6))
  g.moveTo(X(11), X(6.8))
  g.bezierCurveTo(X(15), X(7.2), X(17.2), X(11.5), X(17.2), X(20))
  g.moveTo(X(5), X(16.6))
  g.bezierCurveTo(X(8), X(14.2), X(12), X(13.8), X(15), X(15.2))
  g.stroke()
  words(g, 'MIRAVO', w / 2, X(2.4), X(1.6), '#ffffff', { weight: 400, spacing: X(0.5) })
  words(g, 'BE MORE YOU', w / 2, X(44.3), X(1.2), '#ff2bd6', { core: '#ffe0f8', weight: 700 })
  column(g, 'ミライ', X(1.4), X(31), X(1.7), X(1.3), '#2bf3ff', { core: '#dcfdff' })
}

/** The face's moving parts at time `t`: eyes that open, close a little and look about; lips that part. All slow. */
function paintFaceLive(g, w, t) {
  const X = v => (v * w) / MEGA.width
  const open = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 0.31))
  const gx = Math.sin(t * 0.17) * 0.55
  const gy = Math.sin(t * 0.23 + 1) * 0.18
  for (const ex of [6.5, 13.1]) eye(g, X, ex, 22.6, 3.6, 2 * open, gx, gy)
  lips(g, X, 9.9, 32.8, 5.4, 0.5 + 0.5 * Math.sin(t * 0.27 + 2))
}

/** An almond eye with a cyan iris looking (gx, gy) metres off centre. */
function eye(g, X, ex, ey, ew, eh, gx, gy) {
  g.save()
  g.beginPath()
  g.moveTo(X(ex - ew / 2), X(ey))
  g.quadraticCurveTo(X(ex), X(ey - eh), X(ex + ew / 2), X(ey - 0.1))
  g.quadraticCurveTo(X(ex), X(ey + eh * 0.7), X(ex - ew / 2), X(ey))
  g.closePath()
  g.fillStyle = '#e8ecff'
  g.fill()
  g.clip()
  const ix = X(ex + gx)
  const iy = X(ey + gy * 0.6 - 0.05)
  const iris = g.createRadialGradient(ix, iy, 0, ix, iy, X(0.95))
  iris.addColorStop(0, '#e6ffff')
  iris.addColorStop(0.25, '#2bf3ff')
  iris.addColorStop(0.75, '#0a6a80')
  iris.addColorStop(1, '#04161e')
  g.fillStyle = iris
  g.beginPath()
  g.arc(ix, iy, X(0.95), 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#04060c'
  g.beginPath()
  g.arc(ix, iy, X(0.38), 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(ix - X(0.28), iy - X(0.3), X(0.16), 0, Math.PI * 2)
  g.fill()
  g.fillStyle = linear(g, 0, X(ey - eh), 0, X(ey), [[0, 'rgba(20, 10, 40, 0.7)'], [0.6, 'rgba(20, 10, 40, 0)']])
  g.fillRect(X(ex - ew / 2), X(ey - eh), X(ew), X(eh))
  g.restore()
  g.strokeStyle = '#120a22'
  g.lineWidth = X(0.32)
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(X(ex - ew / 2 - 0.1), X(ey + 0.05))
  g.quadraticCurveTo(X(ex), X(ey - eh - 0.15), X(ex + ew / 2 + 0.1), X(ey - 0.12))
  g.stroke()
}

/** Lips in magenta-red, parted by `part` (0..1). */
function lips(g, X, mx, my, mw, part) {
  const gap = 0.08 + part * 0.45
  const lx = mx - mw / 2
  const rx = mx + mw / 2
  g.fillStyle = '#2a0618'
  g.beginPath()
  g.ellipse(X(mx), X(my + gap * 0.5), X(mw * 0.42), X(gap * 0.6 + 0.05), 0, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.moveTo(X(lx), X(my))
  g.bezierCurveTo(X(lx + mw * 0.2), X(my - 0.5), X(mx - mw * 0.16), X(my - 1.15), X(mx - mw * 0.08), X(my - 1))
  g.quadraticCurveTo(X(mx), X(my - 0.75), X(mx + mw * 0.08), X(my - 1))
  g.bezierCurveTo(X(mx + mw * 0.16), X(my - 1.15), X(rx - mw * 0.2), X(my - 0.5), X(rx), X(my))
  g.quadraticCurveTo(X(mx), X(my + 0.1), X(lx), X(my))
  g.closePath()
  g.fillStyle = linear(g, 0, X(my - 1.1), 0, X(my), [[0, '#ff4a7a'], [1, '#a0103e']])
  g.fill()
  const by = my + gap
  g.beginPath()
  g.moveTo(X(lx + 0.15), X(my + gap * 0.3))
  g.quadraticCurveTo(X(mx), X(by - 0.05), X(rx - 0.15), X(my + gap * 0.3))
  g.bezierCurveTo(X(rx - mw * 0.15), X(by + 1.2), X(lx + mw * 0.15), X(by + 1.2), X(lx + 0.15), X(my + gap * 0.3))
  g.closePath()
  g.fillStyle = linear(g, 0, X(by), 0, X(by + 1.3), [[0, '#ff3b5c'], [1, '#8a0c36']])
  g.fill()
  glow(g, X(mx - 0.4), X(by + 0.45), X(1.1), '#ffffff', 0.35)
}

let holoSign = null

/** The hologram's sign, light on black (black adds nothing, so it reads as clear air). */
function holoTexture() {
  if (holoSign) return holoSign
  const { canvas, g } = makeCanvas(512, 256)
  g.fillStyle = '#000000'
  g.fillRect(0, 0, 512, 256)
  g.save()
  g.strokeStyle = '#2bf3ff'
  g.lineWidth = 6
  g.shadowColor = '#2bf3ff'
  g.shadowBlur = 16
  g.beginPath()
  g.arc(112, 128, 86, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = '#ffb02b'
  g.shadowColor = '#ffb02b'
  g.lineWidth = 9
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(74, 166)
  g.bezierCurveTo(60, 84, 162, 70, 152, 122)
  g.bezierCurveTo(144, 160, 100, 152, 112, 122)
  g.moveTo(74, 166)
  g.lineTo(60, 184)
  g.moveTo(74, 166)
  g.lineTo(92, 182)
  g.stroke()
  g.restore()
  words(g, '夜市', 340, 92, 92, '#2bf3ff', { font: KANA, core: '#e6feff' })
  words(g, 'NIGHT MARKET', 340, 168, 40, '#9fe8ff', { core: '#ffffff' })
  words(g, 'OPEN TILL DAWN', 340, 212, 24, '#ff2bd6', { core: '#ffd6f6', weight: 600 })
  g.strokeStyle = 'rgba(43, 243, 255, 0.8)'
  g.lineWidth = 3
  for (const [x, y, sx, sy] of [[8, 8, 1, 1], [504, 8, -1, 1], [504, 248, -1, -1], [8, 248, 1, -1]]) {
    g.beginPath()
    g.moveTo(x, y + sy * 28)
    g.lineTo(x, y)
    g.lineTo(x + sx * 28, y)
    g.stroke()
  }
  holoSign = canvasTexture(canvas)
  return holoSign
}

/** Tower facade: pinprick windows, a few warm office floors, a dark service floor along the bottom. */
function paintWindows() {
  const { canvas, g } = makeCanvas(256, 512)
  g.fillStyle = '#04060b'
  g.fillRect(0, 0, 256, 512)
  const rnd = stream(hash('facade'))
  const pinpricks = ['#ffcf8a', '#ffb45c', '#fff0d6', '#9fe8ff', '#c9b6ff', '#ffffff']
  for (let row = 0; row < 15; row += 1) {
    const y = row * 32 + 10
    const office = rnd() < 0.2
    for (let col = 0; col < 16; col += 1) {
      const x = col * 16 + 6
      if (rnd() > (office ? 0.85 : 0.3)) continue
      g.globalAlpha = 0.5 + rnd() * 0.5
      if (office) {
        g.fillStyle = rnd() < 0.7 ? '#ffcf8a' : '#ffb45c'
        g.fillRect(x - 2, y, 10, 7)
      } else {
        g.fillStyle = pinpricks[Math.floor(rnd() * pinpricks.length)]
        g.fillRect(x, y, 3, 4)
      }
    }
  }
  g.globalAlpha = 1
  return canvasTexture(canvas, { wrapX: true, wrapY: true })
}
