// /Users/hunterjolly/claude-mods/office-app/public/js/scenery/weather.js
// Sky and weather around the office: a night sky shading from deep blue overhead to a
// magenta city glow and warm smog on the horizon, a big soft moon, a few stars, three
// slow cloud layers lit from below by the city, searchlights sweeping up through them,
// mist and far rain veils among the towers, rain that catches the light of every lamp
// and sign it falls past, splashes on the wet ground, and now and then soft sheet
// lightning far off in the clouds. All of it is drawn by small shaders in at most twelve
// draw calls, with no real lights; the per-frame JS only sets uniforms. Layers the camera
// cannot reach (with the current orbit: moon, stars, clouds and searchlights, which all sit
// above the top of the frame) are switched off each frame, so they cost nothing.

import * as THREE from 'three'
import { hash } from '../util.js'

const SKY_RADIUS = 590 // the sky and cloud domes ride on the camera, just inside its far plane (600)
const STAR_RADIUS = 585
const MOON_DISTANCE = 580
const GLOW_RADIUS = 575
const MOON_ELEVATION = THREE.MathUtils.degToRad(21)
const MOON_AZIMUTH = THREE.MathUtils.degToRad(-16) // west of north
const MOON_SIZE = THREE.MathUtils.degToRad(1.15) // the disc's angular radius
const MOON_HALO = 7 // the moon's quad reaches this many disc radii out, for the halo
const CLOUD_BASE = 140 // the lowest of the three cloud layers (140, 178 and 215 m)
const CLOUD_SCALE = [700, 1100, 1700] // metres per noise tile in each cloud layer
const CLOUD_DETAIL = 3.7 // the fine cloud detail samples the noise at this many times the billows' scale
const MIST_DETAIL = 2.3 // the same for the mist
// Drift offsets wrap at this many whole tiles: 37 cloud detail tiles and 23 mist detail tiles,
// so every noise sample lands on the same texel just before and just after a wrap.
const DRIFT_TILES = 10
const RAIN_BOX = new THREE.Vector3(84, 40, 84) // the block of rain kept around the focus
const RAIN_COUNT = 18000
const RAIN_PERIOD = 60 // every drop falls a whole number of box heights per period, so the clock can wrap
const SPLASH_COUNT = 700
const SPLASH_RADIUS = 34
const SPLASH_PERIOD = 600 // a whole number of every splash's life (0.6, 0.75 or 1 s)
const NEAREST_SPOTS = 16 // lamps and signs that light the rain: the nearest to the focus
const MAX_SPOTS = 20 // their uniform slots: the nearest 16, and room for 4 more to fade out while others fade in
const SPOT_FADE = 0.6 // seconds for a lamp's light in the rain to fade in or out as it joins or leaves the nearest
const SPOT_HOLD = 3 // metres: a lamp already lighting the rain keeps its place until a newcomer is this much nearer
const SPOT_REACH = 75 // metres from the focus (less the lamp's own radius) beyond which no lamp lights the rain
const SPOT_PICK = 0.25 // seconds between choices of the nearest lamps
const BEAM_LENGTH = 330
const BEAM_WIDTH = [0.7, 15] // half-widths at the lamp and at the far end: a cone about 2.5 degrees across
const STAR_CLOCK = 2 * Math.PI * 1000 // star twinkle speeds are whole thousandths, so this wraps cleanly

// ------------------------------------------------------------------ colour

// The app tone maps the finished frame with ACES (in its OutputPass), which crushes dark
// colours: a sky painted '#1a1f4a' would show nearly black. onScreen() runs the curve
// backwards, so the art direction's hex colours come out on screen as chosen.
const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]]
const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]]

/** The inverse of a 3x3 matrix given as rows. */
function invert3([[a, b, c], [d, e, f], [g, h, i]]) {
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

const IN_INV = invert3(ACES_IN)
const OUT_INV = invert3(ACES_OUT)
const mul3 = (m, v) => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])

/** The input of the ACES RRT/ODT fit that gives `f` (a quadratic solved for its positive root). */
function unfit(f) {
  const y = Math.min(Math.max(f, 0), 0.985)
  const a = 0.983729 * y - 1
  const b = 0.432951 * y - 0.0245786
  const c = 0.238081 * y + 0.000090537
  return (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a)
}

/** The linear colour that shows as `hex` on screen once the frame is tone mapped. */
function onScreen(hex, exposure = 1) {
  const c = new THREE.Color(hex)
  const fitted = mul3(OUT_INV, [c.r, c.g, c.b]).map(unfit)
  const [r, g, b] = mul3(IN_INV, fitted).map(k => Math.max(0, (k * 0.6) / exposure))
  return new THREE.Color(r, g, b)
}

// ------------------------------------------------------------------ shared pieces

/** A seeded random stream: the same sky, stars, mist and rain on every load. */
function stream(seed) {
  let n = seed >>> 0
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0
    return n / 4294967296
  }
}

let noiseTexture = null

/** Tileable cloud noise, 256 px and mipmapped: red is broad billows, green fine detail. */
function cloudNoise() {
  if (noiseTexture) return noiseTexture
  const size = 256
  const rnd = stream(hash('weather-clouds'))
  const smooth = t => t * t * (3 - 2 * t)
  const fbm = octaves => {
    const out = new Float32Array(size * size)
    for (const [freq, weight] of octaves) {
      const grid = Float32Array.from({ length: freq * freq }, rnd)
      const step = freq / size
      for (let y = 0; y < size; y += 1) {
        const fy = y * step
        const y0 = Math.floor(fy)
        const ty = smooth(fy - y0)
        const r0 = y0 * freq
        const r1 = ((y0 + 1) % freq) * freq
        for (let x = 0; x < size; x += 1) {
          const fx = x * step
          const x0 = Math.floor(fx)
          const x1 = (x0 + 1) % freq
          const tx = smooth(fx - x0)
          const top = grid[r0 + x0] + (grid[r0 + x1] - grid[r0 + x0]) * tx
          const bottom = grid[r1 + x0] + (grid[r1 + x1] - grid[r1 + x0]) * tx
          out[y * size + x] += (top + (bottom - top) * ty) * weight
        }
      }
    }
    let low = Infinity
    let high = -Infinity
    for (const v of out) {
      low = Math.min(low, v)
      high = Math.max(high, v)
    }
    return out.map(v => (v - low) / (high - low))
  }
  const broad = fbm([[4, 1], [8, 0.5], [16, 0.25], [32, 0.125], [64, 0.0625]])
  const fine = fbm([[16, 1], [32, 0.5], [64, 0.25], [128, 0.125]])
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  const image = g.createImageData(size, size)
  for (let i = 0; i < size * size; i += 1) {
    image.data[i * 4] = broad[i] * 255
    image.data[i * 4 + 1] = fine[i] * 255
    image.data[i * 4 + 2] = 0
    image.data[i * 4 + 3] = 255
  }
  g.putImageData(image, 0, 0)
  noiseTexture = new THREE.CanvasTexture(canvas)
  noiseTexture.wrapS = THREE.RepeatWrapping
  noiseTexture.wrapT = THREE.RepeatWrapping
  noiseTexture.anisotropy = 4
  return noiseTexture
}

/** Fragment output: linear colour for the composer, converted only when drawn straight to the screen. */
const OUTPUT = '#include <colorspace_fragment>'

/** A direction from the camera, for the domes and the glow band that ride on it. */
const DIR_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const SPOT_GLSL = /* glsl */ `
uniform vec3 uSpotPos[${MAX_SPOTS}];
uniform vec3 uSpotColor[${MAX_SPOTS}];
uniform float uSpotRadius[${MAX_SPOTS}];
uniform int uSpotCount;

// The light of the nearest lamps and signs at p. It reaches further below a light than
// above it (lamps shine down), and drops between a light and the camera glint brightest.
vec3 spotLight(vec3 p, vec3 toCamera) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    if (i >= uSpotCount) break;
    vec3 d = p - uSpotPos[i];
    vec3 q = vec3(d.x, d.y * (d.y > 0.0 ? 1.8 : 0.6), d.z);
    float r = uSpotRadius[i];
    float f = clamp(1.0 - dot(q, q) / (r * r), 0.0, 1.0);
    float forward = max(dot(d / max(length(d), 0.001), toCamera), 0.0);
    sum += uSpotColor[i] * f * sqrt(f) * (0.8 + 0.8 * forward * forward);
  }
  return sum;
}
`

const HASH_GLSL = /* glsl */ `
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`

/** The uniforms the lamps and signs fill, shared by the rain and the splashes. */
function spotUniforms() {
  return {
    uSpotPos: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector3()) },
    uSpotColor: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Color(0, 0, 0)) },
    uSpotRadius: { value: new Float32Array(MAX_SPOTS) },
    uSpotCount: { value: 0 },
  }
}

/** A quad's corners for instanced streaks and rings. */
function instancedQuad(corners, seeds) {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3))
  geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
  geometry.instanceCount = seeds.length / 4
  return geometry
}

// ------------------------------------------------------------------ sky

/** The sky itself: deep blue overhead, blue-violet, a magenta city glow, warm smog on the horizon. */
function buildSky(group, dome, exposure, moonDir) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: onScreen('#070a1c', exposure) },
      uHigh: { value: onScreen('#1a1f4a', exposure) },
      uGlow: { value: onScreen('#5a2a6a', exposure) },
      uSmog: { value: onScreen('#a8432c', exposure) },
      uFloor: { value: new THREE.Color('#1a1638') },
      uMoonColor: { value: new THREE.Color('#dfe8ff') },
      uMoonDir: { value: moonDir },
    },
    vertexShader: DIR_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHigh;
      uniform vec3 uGlow;
      uniform vec3 uSmog;
      uniform vec3 uFloor;
      uniform vec3 uMoonColor;
      uniform vec3 uMoonDir;
      varying vec3 vDir;
      // A fixed per-pixel dither: smooth dark gradients would otherwise band on screen.
      float dither(vec2 p) {
        return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
      }
      void main() {
        vec3 dir = normalize(vDir);
        float e = dir.y;
        float north = clamp(0.5 - dir.z * 0.5, 0.0, 1.0);
        vec3 color = mix(uGlow, uHigh, smoothstep(0.03, 0.26, e));
        color = mix(color, uZenith, smoothstep(0.2, 0.75, e));
        // Warm smog lies low on the horizon, thickest over the city to the north.
        float smog = exp(-max(e, 0.0) * 30.0) * (0.45 + 0.4 * north);
        color = mix(color, uSmog, smog);
        // Below the horizon the sky sinks into the haze the fog paints far things with.
        color = mix(color, uFloor, 1.0 - smoothstep(-0.06, 0.0, e));
        // Moonlight in the wet air around the moon.
        float m = max(dot(dir, uMoonDir), 0.0);
        color += uMoonColor * (pow(m, 60.0) * 0.03 + pow(m, 8.0) * 0.012);
        color *= 1.0 + (dither(gl_FragCoord.xy) - 0.5) * 0.05;
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const sky = new THREE.Mesh(dome, material)
  sky.renderOrder = -20
  sky.frustumCulled = false
  group.add(sky)
  return sky
}

/** A few faint stars, fading toward the hazy horizon. Twinkles are slow swells, never blinks. */
function buildStars(group, pixelRatio) {
  const rnd = stream(hash('weather-stars'))
  const count = 240
  const positions = new Float32Array(count * 3)
  const looks = new Float32Array(count * 4)
  for (let i = 0; i < count; i += 1) {
    const y = 0.1 + 0.9 * Math.sqrt(rnd())
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(1 - y * y)
    positions.set([Math.cos(a) * r * STAR_RADIUS, y * STAR_RADIUS, Math.sin(a) * r * STAR_RADIUS], i * 3)
    // size in px, brightness, twinkle speed (whole thousandths of a radian per second), phase
    looks.set([1.3 + rnd() * 1.4, 0.18 + rnd() ** 3 * 0.55, Math.round(600 + rnd() * 1200) / 1000, rnd() * 6.283], i * 4)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aLook', new THREE.Float32BufferAttribute(looks, 4))
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: /* glsl */ `
      attribute vec4 aLook;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vBright;
      void main() {
        vec3 dir = normalize(position);
        vBright = aLook.y * (0.78 + 0.22 * sin(uTime * aLook.z + aLook.w)) * smoothstep(0.1, 0.4, dir.y);
        gl_PointSize = aLook.x * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vBright;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * vBright * (1.0 - smoothstep(0.15, 1.0, r)), 1.0);
        ${OUTPUT}
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const stars = new THREE.Points(geometry, material)
  stars.renderOrder = -19
  stars.frustumCulled = false
  group.add(stars)
  return stars
}

/** The city's glow band low on the horizon, behind the far skyline: warm smog patches over a magenta haze. */
function buildGlowBand(group, noise, exposure, flash) {
  const geometry = new THREE.CylinderGeometry(GLOW_RADIUS, GLOW_RADIUS, 260, 72, 1, true, Math.PI - 1.95, 3.9)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: noise },
      uHaze: { value: onScreen('#5a2a6a', exposure).multiplyScalar(0.45) },
      uSmog: { value: onScreen('#a8432c', exposure).multiplyScalar(0.5) },
      ...flash,
    },
    vertexShader: DIR_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform vec3 uHaze;
      uniform vec3 uSmog;
      uniform float uFlash;
      uniform vec3 uFlashDir;
      uniform vec3 uFlashColor;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float e = dir.y;
        float azimuth = atan(dir.x, -dir.z);
        // Districts: brighter stretches of skyline glow here and there along the horizon.
        float n = texture2D(uNoise, vec2(azimuth * 0.32 + 0.13, 0.37)).r;
        float band = exp(-max(e + 0.012, 0.0) * 26.0) * smoothstep(-0.05, -0.005, e);
        vec3 color = mix(uHaze, uSmog, smoothstep(0.35, 0.75, n)) * band * (0.4 + 1.1 * n);
        // Sheet lightning lights the far haze in its own direction.
        vec2 flat1 = dir.xz / max(length(dir.xz), 0.0001);
        vec2 flat2 = uFlashDir.xz / max(length(uFlashDir.xz), 0.0001);
        float toward = pow(max(dot(flat1, flat2), 0.0), 10.0);
        color += uFlashColor * uFlash * toward * exp(-max(e, 0.0) * 7.0) * smoothstep(-0.03, 0.01, e) * 0.6;
        // Soft ends where the band stops, out of sight to the south.
        color *= 1.0 - smoothstep(1.5, 1.9, abs(azimuth));
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const band = new THREE.Mesh(geometry, material)
  band.renderOrder = -18
  band.frustumCulled = false
  group.add(band)
  return band
}

/** The moon: a big soft disc with faint seas, a halo in the wet air, bright enough to bloom. */
function buildMoon(group) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#dfe8ff') } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      float sea(vec2 p, vec2 c, float r) {
        vec2 d = (p - c) / r;
        return exp(-dot(d, d));
      }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * ${MOON_HALO.toFixed(1)};
        float r = length(p);
        float disc = 1.0 - smoothstep(0.95, 1.0, r);
        float seas = sea(p, vec2(-0.3, 0.25), 0.3) + sea(p, vec2(0.18, 0.38), 0.2)
          + sea(p, vec2(0.28, -0.12), 0.26) + sea(p, vec2(-0.12, -0.4), 0.17);
        float limb = sqrt(max(1.0 - r * r, 0.0));
        vec3 surface = uColor * (1.0 - 0.2 * min(seas, 1.0)) * (0.8 + 0.2 * limb) * 2.1;
        float outside = max(r - 1.0, 0.0);
        float halo = (exp(-outside * 2.2) * 0.1 + exp(-outside * 0.45) * 0.03) * (1.0 - smoothstep(4.0, ${(MOON_HALO - 0.2).toFixed(1)}, r));
        gl_FragColor = vec4(surface * disc + uColor * halo * (1.0 - disc), 1.0);
        ${OUTPUT}
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  moon.scale.setScalar(2 * MOON_HALO * MOON_DISTANCE * Math.tan(MOON_SIZE))
  moon.renderOrder = -17
  moon.frustumCulled = false
  group.add(moon)
  return moon
}

/**
 * Three cloud layers (140, 178 and 215 m up) drawn as true endless planes: the dome rides on
 * the camera and each pixel finds where its ray meets each layer, so the clouds run all the
 * way to the horizon and drift there. Lit from below by the city, silvered near the moon,
 * lit where the searchlights pass through, and lit from inside by sheet lightning.
 */
function buildClouds(group, noise, exposure, moonDir, beams, flash) {
  // Its own upper half-dome: nothing is drawn below the horizon, so no fragment needs discarding
  // (a discard would cost the early depth test, and this is the heaviest shader in the sky).
  const dome = new THREE.SphereGeometry(SKY_RADIUS, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: noise },
      uDrift: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uCloudHigh: { value: onScreen('#202a5c', exposure) },
      uCloudLow: { value: onScreen('#5a2f72', exposure) },
      uCloudSmog: { value: onScreen('#7a3646', exposure) },
      uMoonColor: { value: new THREE.Color('#dfe8ff') },
      uMoonDir: { value: moonDir },
      uBeamOnCloud: { value: 0.16 },
      ...beams,
      ...flash,
    },
    vertexShader: DIR_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform vec2 uDrift[3];
      uniform vec3 uCloudHigh;
      uniform vec3 uCloudLow;
      uniform vec3 uCloudSmog;
      uniform vec3 uMoonColor;
      uniform vec3 uMoonDir;
      uniform float uBeamOnCloud;
      uniform vec3 uBeamO[4];
      uniform vec3 uBeamD[4];
      uniform vec3 uBeamColor[4];
      uniform int uBeamCount;
      uniform float uFlash;
      uniform vec3 uFlashDir;
      uniform vec3 uFlashColor;
      varying vec3 vDir;

      const float HEIGHT[3] = float[3](${CLOUD_BASE.toFixed(1)}, 178.0, 215.0);
      const float SCALE[3] = float[3](${CLOUD_SCALE.map(s => s.toFixed(1)).join(', ')});
      const float COVER[3] = float[3](0.44, 0.5, 0.56);
      const float OPACITY[3] = float[3](0.62, 0.5, 0.42);
      const float LIGHT[3] = float[3](1.0, 0.8, 0.62);

      void main() {
        vec3 dir = normalize(vDir);
        float horizon = 1.0 - smoothstep(0.02, 0.5, dir.y);
        float low = 1.0 - smoothstep(0.0, 0.14, dir.y);
        float m = max(dot(dir, uMoonDir), 0.0);
        float moonlight = pow(m, 120.0) * 0.55 + pow(m, 14.0) * 0.07;
        // Sheet lightning glows in one patch of cloud, with only a faint lift elsewhere.
        float flash = uFlash * (0.08 + 0.92 * pow(max(dot(dir, uFlashDir), 0.0), 8.0));
        vec3 tint = mix(mix(uCloudHigh, uCloudLow, horizon), uCloudSmog, low * 0.6);
        float fadeIn = smoothstep(0.0, 0.045, dir.y);
        vec3 color = vec3(0.0);
        float through = 1.0;
        for (int i = 0; i < 3; i++) {
          float dist = (HEIGHT[i] - cameraPosition.y) / max(dir.y, 0.012);
          vec2 p = cameraPosition.xz + dir.xz * dist;
          vec2 uv = (p + uDrift[i]) / SCALE[i];
          float n = texture2D(uNoise, uv).r * 0.7 + texture2D(uNoise, uv * ${CLOUD_DETAIL.toFixed(1)} + 0.31).g * 0.3;
          float d = smoothstep(COVER[i], COVER[i] + 0.3, n);
          float a = d * OPACITY[i] * fadeIn;
          vec3 c = tint * (0.45 + 0.75 * d) * LIGHT[i] + uMoonColor * moonlight * (1.2 - d);
          // Light glowing inside the layer: lightning, and searchlights passing through.
          vec3 glow = uFlashColor * flash * (0.1 + 1.2 * d);
          for (int b = 0; b < 4; b++) {
            if (b >= uBeamCount) break;
            float s = (HEIGHT[i] - uBeamO[b].y) / max(uBeamD[b].y, 0.05);
            vec2 off = p - (uBeamO[b].xz + uBeamD[b].xz * s);
            float w = mix(${BEAM_WIDTH[0].toFixed(2)}, ${BEAM_WIDTH[1].toFixed(2)}, clamp(s / ${BEAM_LENGTH.toFixed(1)}, 0.0, 1.0)) * 2.4;
            glow += uBeamColor[b] * uBeamOnCloud * exp(-dot(off, off) / (w * w)) * d * d;
          }
          color += through * (c * a + glow * fadeIn);
          through *= 1.0 - a;
        }
        gl_FragColor = vec4(color, 1.0 - through);
        ${OUTPUT}
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const clouds = new THREE.Mesh(dome, material)
  clouds.renderOrder = -16
  clouds.frustumCulled = false
  group.add(clouds)
  return clouds
}

// ------------------------------------------------------------------ searchlights

/**
 * The buildings a searchlight may stand on: meshes tagged `userData.tower` when the skyline tags
 * them, otherwise every still, solid, window-lit mesh. Instanced meshes (cars, flying cars, props)
 * and anything marked `userData.moving`, on itself or a parent, never count.
 */
function roofMeshes(ctx, group) {
  const tagged = []
  const lit = []
  ctx.scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) return
    for (let p = o; p; p = p.parent) if (p === group || p.userData?.moving) return
    const m = o.material
    if (!m || Array.isArray(m) || m.transparent || m.depthWrite === false || !o.geometry?.attributes?.position) return
    if (o.userData.tower) tagged.push(o)
    else if (m.emissiveMap) lit.push(o)
  })
  return tagged.length ? tagged : lit
}

/**
 * Rooftops for the searchlights: a few probe points in each sector of the mid band, tried in
 * order, each finding the highest surface above it. One pass over the buildings' triangles
 * serves every probe at once (seen from above, a wall has no area and is skipped), so a dense
 * city costs a few milliseconds rather than a raycast per probe through every triangle.
 */
function findRoofs(ctx, group, sectors) {
  const midX = ctx.extent / 2
  const ranges = [85, 70, 100, 115, 60, 130]
  const jitters = [0, 0.08, -0.08]
  const perSector = ranges.length * jitters.length
  const px = new Float64Array(sectors.length * perSector)
  const pz = new Float64Array(px.length)
  const top = new Float64Array(px.length).fill(-Infinity)
  let n = 0
  for (const azimuth of sectors) {
    for (const range of ranges) {
      for (const jitter of jitters) {
        px[n] = midX + Math.sin(azimuth + jitter) * range
        pz[n] = 9.5 - Math.cos(azimuth + jitter) * range
        n += 1
      }
    }
  }
  const minX = Math.min(...px)
  const maxX = Math.max(...px)
  const minZ = Math.min(...pz)
  const maxZ = Math.max(...pz)

  ctx.scene.updateMatrixWorld(true)
  const v = new THREE.Vector3()
  for (const mesh of roofMeshes(ctx, group)) {
    const position = mesh.geometry.attributes.position
    const world = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
      world[i * 3] = v.x
      world[i * 3 + 1] = v.y
      world[i * 3 + 2] = v.z
    }
    const ids = mesh.geometry.index?.array
    const corners = ids ? ids.length : position.count
    for (let t = 0; t + 2 < corners; t += 3) {
      const a = (ids ? ids[t] : t) * 3
      const b = (ids ? ids[t + 1] : t + 1) * 3
      const c = (ids ? ids[t + 2] : t + 2) * 3
      const ax = world[a]
      const az = world[a + 2]
      const bx = world[b]
      const bz = world[b + 2]
      const cx = world[c]
      const cz = world[c + 2]
      const loX = Math.min(ax, bx, cx)
      const hiX = Math.max(ax, bx, cx)
      const loZ = Math.min(az, bz, cz)
      const hiZ = Math.max(az, bz, cz)
      if (hiX < minX || loX > maxX || hiZ < minZ || loZ > maxZ) continue
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az)
      if (Math.abs(area) < 1e-6) continue
      const ay = world[a + 1]
      const by = world[b + 1]
      const cy = world[c + 1]
      for (let i = 0; i < n; i += 1) {
        const x = px[i]
        const z = pz[i]
        if (x < loX || x > hiX || z < loZ || z > hiZ) continue
        // Barycentric weights of B and C at the probe, seen from above.
        const u = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / area
        const w = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / area
        if (u < 0 || w < 0 || u + w > 1) continue
        const y = ay + (by - ay) * u + (cy - ay) * w
        if (y > top[i]) top[i] = y
      }
    }
  }

  return sectors.map((azimuth, s) => {
    for (let i = s * perSector; i < (s + 1) * perSector; i += 1) {
      if (top[i] > 28 && top[i] < 170) return { origin: new THREE.Vector3(px[i], top[i] + 0.6, pz[i]), roof: true }
    }
    // No roof found: the beam rises out of the haze, its foot faded in.
    return { origin: new THREE.Vector3(midX + Math.sin(azimuth) * 90, 70, 9.5 - Math.cos(azimuth) * 90), roof: false }
  })
}

/** Tall soft beams: camera-facing ribbons, narrow at the lamp, faint and wide at the top, dimmed inside the clouds. Returns { mesh, flares }. */
function buildBeams(group, beams, roofs, resolution) {
  const count = roofs.length
  const rows = 40
  const side = []
  const along = []
  const which = []
  const index = []
  for (let b = 0; b < count; b += 1) {
    for (let i = 0; i <= rows; i += 1) {
      const a = (i / rows) ** 1.6
      side.push(-1, 1)
      along.push(a, a)
      which.push(b, b)
      const v = (b * (rows + 1) + i) * 2
      if (i < rows) index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(side.length * 3), 3))
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1))
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
  geometry.setAttribute('aBeam', new THREE.Float32BufferAttribute(which, 1))
  geometry.setIndex(index)
  const material = new THREE.ShaderMaterial({
    uniforms: { ...beams, uLevel: { value: 0.26 } },
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute float aAlong;
      attribute float aBeam;
      uniform vec3 uBeamO[4];
      uniform vec3 uBeamD[4];
      uniform vec3 uBeamColor[4];
      varying float vSide;
      varying float vAlong;
      varying float vY;
      varying float vFacing;
      varying vec3 vColor;
      void main() {
        int b = int(aBeam + 0.5);
        vec3 d = uBeamD[b];
        vec3 axis = uBeamO[b] + d * (aAlong * ${BEAM_LENGTH.toFixed(1)});
        vec3 across = cross(d, normalize(cameraPosition - axis));
        float facing = length(across);
        vec3 side = facing > 0.0001 ? across / facing : vec3(1.0, 0.0, 0.0);
        float width = mix(${BEAM_WIDTH[0].toFixed(2)}, ${BEAM_WIDTH[1].toFixed(2)}, aAlong);
        vSide = aSide;
        vAlong = aAlong;
        vY = axis.y;
        vFacing = facing;
        vColor = uBeamColor[b];
        gl_Position = projectionMatrix * viewMatrix * vec4(axis + side * aSide * width, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLevel;
      varying float vSide;
      varying float vAlong;
      varying float vY;
      varying float vFacing;
      varying vec3 vColor;
      void main() {
        // A bright core in a soft sheath, so the beam reads as a shaft of light rather than smoke.
        float across = 1.0 - vSide * vSide;
        float profile = exp(-vSide * vSide * 7.0) * 0.75 + across * across * 0.25;
        // (Clamped: a NaN here would be smeared across the sky by the bloom.)
        float along = smoothstep(0.0, 0.025, vAlong) * pow(clamp(1.0 - vAlong, 0.0, 1.0), 1.2);
        // Above the cloud base the beam is mostly hidden in cloud.
        float cloud = mix(1.0, 0.35, smoothstep(${(CLOUD_BASE - 20).toFixed(1)}, ${(CLOUD_BASE + 45).toFixed(1)}, vY));
        // Seen end-on a ribbon collapses to a line: let it fade instead.
        float facing = smoothstep(0.05, 0.3, vFacing);
        gl_FragColor = vec4(vColor * profile * along * cloud * facing * uLevel, 1.0);
        ${OUTPUT}
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    fog: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = -15
  mesh.frustumCulled = false
  group.add(mesh)

  // The lamps themselves: a small hot glow on each roof that has one.
  const lamps = beams.uBeamO.value.map((origin, i) => ({ origin, color: beams.uBeamColor.value[i] })).filter((_, i) => roofs[i])
  if (!lamps.length) return { mesh, flares: null }
  const flareGeometry = new THREE.BufferGeometry()
  flareGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap(l => l.origin.toArray()), 3))
  flareGeometry.setAttribute('aColor', new THREE.Float32BufferAttribute(lamps.flatMap(l => l.color.toArray()), 3))
  const flares = new THREE.Points(
    flareGeometry,
    new THREE.ShaderMaterial({
      uniforms: { uResolution: resolution },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        uniform vec2 uResolution;
        varying vec3 vColor;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(3.4 * projectionMatrix[1][1] * 0.5 * uResolution.y / -view.z, 2.0, 48.0);
          vColor = aColor;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          gl_FragColor = vec4(vColor * (exp(-r * r * 7.0) * 1.8 + exp(-r * r * 2.5) * 0.25) * (1.0 - smoothstep(0.8, 1.0, r)), 1.0);
          ${OUTPUT}
        }
      `,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  )
  flares.renderOrder = -14
  flares.frustumCulled = false
  group.add(flares)
  return { mesh, flares }
}

// ------------------------------------------------------------------ mist and far rain

/** One mesh's worth of mist sheets: upright quads facing along each sheet's `facing`. */
function sheetGeometry(sheets) {
  const position = []
  const uv = []
  const facing = []
  const index = []
  sheets.forEach((s, i) => {
    const [fx, fz] = s.facing
    const rx = fz
    const rz = -fx
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      position.push(s.x + rx * (u - 0.5) * s.w, v * s.h, s.z + rz * (u - 0.5) * s.w)
      uv.push(u, v)
      facing.push(fx, 0, fz)
    }
    const k = i * 4
    index.push(k, k + 1, k + 2, k + 2, k + 1, k + 3)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('aFacing', new THREE.Float32BufferAttribute(facing, 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Sheets of low mist among the towers to the north and on the flanks: soft drifting noise
 * lit violet by the city, with faint falling streaks so the far towers stand in rain too.
 * They face the office and fade when seen edge-on. The sheets come in three depth bands, one
 * mesh each, so three.js sorts every band by depth among the other see-through things: far
 * signs and sprites behind a band are veiled by it, nearer ones stay in front.
 */
function buildMist(group, extent, noise, exposure) {
  const rnd = stream(hash('weather-mist'))
  const bands = [[], [], []]
  // A low row of ground mist at the feet of the nearest towers, then taller sheets further back.
  for (const [z, h] of [[-9, 7], [-19, 14], [-33, 18], [-52, 24], [-80, 30], [-120, 38]]) {
    const band = bands[z > -10 ? 0 : z > -40 ? 1 : 2]
    for (let x = -120 + rnd() * 30; x < extent + 120; x += 80 + rnd() * 35) {
      band.push({ x, z: z - rnd() * (z > -10 ? 1.5 : 8), w: 80 + rnd() * 50, h: h * (0.8 + rnd() * 0.4), facing: [0, 1] })
    }
  }
  // Flank sheets stay north of z = 24: south of the road everything is kept low.
  for (const z of [-8, 8]) {
    bands[0].push({ x: -28 - rnd() * 10, z, w: 30, h: 12, facing: [1, 0] })
    bands[0].push({ x: extent + 28 + rnd() * 10, z, w: 30, h: 12, facing: [-1, 0] })
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: noise },
      uDrift: { value: new THREE.Vector2() },
      uFall: { value: 0 },
      uSlant: { value: 0.1 },
      uLow: { value: onScreen('#4a3582', exposure) },
      uHigh: { value: onScreen('#2c2662', exposure) },
      uStreak: { value: onScreen('#5a5f96', exposure) },
      uLevel: { value: 0.42 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aFacing;
      varying vec3 vWorld;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vUv = uv;
        vFacing = abs(dot(aFacing, normalize(cameraPosition - world.xyz)));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform vec2 uDrift;
      uniform float uFall;
      uniform float uSlant;
      uniform vec3 uLow;
      uniform vec3 uHigh;
      uniform vec3 uStreak;
      uniform float uLevel;
      varying vec3 vWorld;
      varying vec2 vUv;
      varying float vFacing;
      void main() {
        float across = vWorld.x + vWorld.z * 0.6;
        vec2 uv = vec2(across, vWorld.y * 1.8) / 240.0 + uDrift;
        float body = smoothstep(0.25, 0.85, texture2D(uNoise, uv).r * 0.7 + texture2D(uNoise, uv * ${MIST_DETAIL.toFixed(1)} + 0.5).g * 0.3);
        float vertical = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.3, 1.0, vUv.y));
        float ends = 1.0 - pow(abs(vUv.x * 2.0 - 1.0), 3.0);
        float a = vertical * ends * (0.3 + 0.7 * body) * smoothstep(0.12, 0.45, vFacing);
        // Far rain: fine streaks falling through the mist, slanted with the wind.
        float streak = smoothstep(0.58, 0.85, texture2D(uNoise, vec2((across + vWorld.y * uSlant) / 70.0, vWorld.y / 900.0 + uFall)).g);
        vec3 color = mix(uLow, uHigh, vUv.y) + uStreak * streak * 0.5;
        gl_FragColor = vec4(color, min(1.0, a * uLevel + streak * a * 0.08));
        ${OUTPUT}
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    fog: false,
    toneMapped: false,
  })
  // renderOrder 0, like every other module's see-through things, so the bands sort by depth among them.
  for (const sheets of bands) {
    if (sheets.length) group.add(new THREE.Mesh(sheetGeometry(sheets), material))
  }
  return material
}

// ------------------------------------------------------------------ rain

let rainGeometry = null

/** Rain streaks, one instanced quad each, positioned and lit entirely on the GPU. */
function buildRain(group, spots, resolution, extent) {
  if (!rainGeometry) {
    const rnd = stream(hash('weather-rain'))
    const seeds = Float32Array.from({ length: RAIN_COUNT * 4 }, rnd)
    rainGeometry = instancedQuad([-1, 0, 1, 0, -1, 1, 1, 1], seeds)
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...spots,
      uTime: { value: 0 },
      uFocus: { value: new THREE.Vector3() },
      uBox: { value: RAIN_BOX },
      uWindShift: { value: new THREE.Vector2() },
      uWind: { value: new THREE.Vector2() },
      uStep: { value: RAIN_BOX.y / RAIN_PERIOD },
      uExposure: { value: 0.055 },
      uWidth: { value: 0.018 },
      uResolution: resolution,
      uRoof: { value: new THREE.Vector4(-0.7, -0.7, extent + 0.7, 19.7) },
      uLevel: { value: 1 },
      uColor: { value: new THREE.Color(0.7, 0.8, 1.0).multiplyScalar(0.13) }, // opacity 0.13 of a pale blue-white
      uLitGain: { value: 1.8 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner; // x: -1 or 1 across the streak; y: 0 at its head (the lowest end), 1 at its tail
      attribute vec4 aSeed;
      uniform float uTime;
      uniform vec3 uFocus;
      uniform vec3 uBox;
      uniform vec2 uWindShift;
      uniform vec2 uWind;
      uniform float uStep;
      uniform float uExposure;
      uniform float uWidth;
      uniform vec2 uResolution;
      uniform vec4 uRoof;
      uniform float uLevel;
      uniform vec3 uColor;
      uniform float uLitGain;
      varying vec3 vColor;
      varying vec2 vCorner;
      ${SPOT_GLSL}
      void main() {
        vColor = vec3(0.0);
        vCorner = aCorner;
        // Each drop keeps its own place in the world while the block of rain follows the focus.
        float speed = (15.0 + floor(aSeed.w * 11.0)) * uStep;
        vec3 low = uFocus - vec3(uBox.x * 0.5, 0.0, uBox.z * 0.5);
        vec3 head = vec3(
          low.x + mod(aSeed.x * uBox.x + uWindShift.x - low.x, uBox.x),
          mod(aSeed.y * uBox.y - speed * uTime, uBox.y) - 1.5, // wraps under the ground, out of sight
          low.z + mod(aSeed.z * uBox.z + uWindShift.y - low.z, uBox.z)
        );
        vec3 tail = head - vec3(uWind.x, -speed, uWind.y) * uExposure;
        vec4 clipHead = projectionMatrix * viewMatrix * vec4(head, 1.0);
        vec4 clipTail = projectionMatrix * viewMatrix * vec4(tail, 1.0);
        if (clipHead.w < 1.0 || clipTail.w < 1.0) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }
        // A screen-space ribbon at least 3 px wide; thinner streaks dim instead. Measured: below about 3 px the
        // streaks shimmer as they slide across pixel edges while the camera moves; at 3 px they are as steady as no rain.
        vec2 sHead = clipHead.xy / clipHead.w * 0.5 * uResolution;
        vec2 sTail = clipTail.xy / clipTail.w * 0.5 * uResolution;
        vec2 span = sTail - sHead;
        float lengthPx = length(span);
        vec2 along = lengthPx > 0.001 ? span / lengthPx : vec2(0.0, 1.0);
        vec4 clip = mix(clipHead, clipTail, aCorner.y);
        float widthPx = uWidth * 0.5 * uResolution.y * projectionMatrix[1][1] / clip.w;
        float drawnPx = max(widthPx, 3.0);
        vec2 shift = vec2(-along.y, along.x) * aCorner.x * drawnPx * 0.5 + along * (aCorner.y - 0.5) * max(0.0, 2.0 - lengthPx);
        clip.xy += shift / (0.5 * uResolution) * clip.w;
        gl_Position = clip;

        vec3 p = mix(head, tail, aCorner.y);
        float dist = length(cameraPosition - p);
        vec2 fromFocus = abs(p.xz - uFocus.xz) / (uBox.xz * 0.5);
        float edge = 1.0 - smoothstep(0.7, 1.0, max(fromFocus.x, fromFocus.y));
        float top = 1.0 - smoothstep(uBox.y - 9.5, uBox.y - 1.5, p.y);
        // The office has a roof we do not draw: rain thins out above it and never falls inside.
        vec2 inside = smoothstep(uRoof.xy - 0.6, uRoof.xy, p.xz) * (1.0 - smoothstep(uRoof.zw, uRoof.zw + 0.6, p.xz));
        float roof = 1.0 - inside.x * inside.y * (1.0 - smoothstep(5.0, 9.0, p.y));
        float fade = edge * top * roof * smoothstep(1.5, 5.0, dist) * exp(-dist / 220.0) * (widthPx / drawnPx) * uLevel;
        vec3 color = (uColor + spotLight(p, (cameraPosition - p) / max(dist, 0.001)) * uLitGain) * fade;
        // Lit rain stays under the glow threshold: thin moving streaks must never flash in the bloom.
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        vColor = color * min(1.0, 0.7 / max(luma, 0.0001));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec2 vCorner;
      void main() {
        float across = 1.0 - vCorner.x * vCorner.x;
        float along = smoothstep(0.0, 0.15, vCorner.y) * (1.0 - smoothstep(0.35, 1.0, vCorner.y));
        gl_FragColor = vec4(vColor * across * along, 1.0);
        ${OUTPUT}
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide, // the screen-space ribbon's winding depends on the streak's direction
    forceSinglePass: true, // (three draws double-sided see-through materials twice otherwise)
    fog: false,
    toneMapped: false,
  })
  const rain = new THREE.Mesh(rainGeometry, material)
  rain.renderOrder = 20
  rain.frustumCulled = false
  group.add(rain)
  return rain
}

let splashGeometry = null

/** Splashes: rings that spread and fade on the ground around the focus, lit by the lamps they land under. */
function buildSplashes(group, spots, extent) {
  if (!splashGeometry) {
    const rnd = stream(hash('weather-splashes'))
    const seeds = Float32Array.from({ length: SPLASH_COUNT * 4 }, rnd)
    splashGeometry = instancedQuad([-1, -1, 1, -1, -1, 1, 1, 1], seeds)
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...spots,
      uTime: { value: 0 },
      uFocus: { value: new THREE.Vector3() },
      uRoof: { value: new THREE.Vector4(-0.7, -0.7, extent + 0.7, 19.7) },
      uLevel: { value: 1 },
      uColor: { value: new THREE.Color(0.6, 0.7, 1.0).multiplyScalar(0.16) },
      uLitGain: { value: 0.7 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform vec3 uFocus;
      uniform vec4 uRoof;
      uniform float uLevel;
      uniform vec3 uColor;
      uniform float uLitGain;
      varying vec2 vLocal;
      varying float vRing;
      varying float vAge;
      varying vec3 vColor;
      ${SPOT_GLSL}
      ${HASH_GLSL}
      void main() {
        // Each splash lives one short cycle, then lands somewhere new.
        float life = aSeed.w < 0.34 ? 0.6 : (aSeed.w < 0.67 ? 0.75 : 1.0);
        float cycle = uTime / life + aSeed.z;
        float age = fract(cycle);
        float n = mod(floor(cycle), floor(${SPLASH_PERIOD.toFixed(1)} / life + 0.5));
        vec2 h = hash22(vec2(n * 1.37 + aSeed.x * 113.0, n * 0.71 + aSeed.y * 271.0));
        vec2 low = uFocus.xz - ${SPLASH_RADIUS.toFixed(1)};
        vec2 xz = low + mod(h * ${(2 * SPLASH_RADIUS).toFixed(1)} - low, ${(2 * SPLASH_RADIUS).toFixed(1)});
        vec2 inside = step(uRoof.xy, xz) * step(xz, uRoof.zw);
        float edge = 1.0 - smoothstep(0.6, 1.0, length(xz - uFocus.xz) / ${SPLASH_RADIUS.toFixed(1)});
        float keep = (1.0 - inside.x * inside.y) * edge;
        if (keep <= 0.0) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          vColor = vec3(0.0);
          vLocal = vec2(0.0);
          vRing = 0.0;
          vAge = 0.0;
          return;
        }
        float size = 0.12 + 0.18 * fract(h.x * 7.13 + h.y * 3.1);
        float quad = size * 1.25;
        vec3 ground = vec3(xz.x, 0.05, xz.y);
        float envelope = smoothstep(0.0, 0.18, age) * pow(1.0 - age, 1.4);
        vec3 lit = spotLight(ground + vec3(0.0, 0.25, 0.0), normalize(cameraPosition - ground));
        vColor = (uColor + lit * uLitGain) * envelope * keep * uLevel;
        vLocal = aCorner * quad;
        vRing = size * (1.0 - (1.0 - age) * (1.0 - age));
        vAge = age;
        gl_Position = projectionMatrix * viewMatrix * vec4(ground + vec3(vLocal.x, 0.0, vLocal.y), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vLocal;
      varying float vRing;
      varying float vAge;
      varying vec3 vColor;
      // A ring at radius r that stays at least a pixel wide, dimming instead of breaking up far off.
      float ring(float d, float r, float aa) {
        float halfWidth = max(0.011, aa * 0.75);
        return (1.0 - smoothstep(halfWidth - aa * 0.5, halfWidth + aa * 0.5, abs(d - r))) * min(1.0, 0.011 / halfWidth);
      }
      void main() {
        float d = length(vLocal);
        float aa = max(fwidth(d), 0.0001);
        float strength = ring(d, vRing, aa) + ring(d, vRing * 0.55, aa) * 0.45 * smoothstep(0.15, 0.4, vAge);
        strength += (1.0 - smoothstep(0.0, 0.03 + aa, d)) * (1.0 - smoothstep(0.0, 0.25, vAge)) * 0.5;
        gl_FragColor = vec4(vColor * strength, 1.0);
        ${OUTPUT}
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    fog: false,
    toneMapped: false,
  })
  const splashes = new THREE.Mesh(splashGeometry, material)
  splashes.renderOrder = 19
  splashes.frustumCulled = false
  group.add(splashes)
  return splashes
}

// ------------------------------------------------------------------ the module

/** Smooth bump from `start` to `end`, peaking at `peak`: zero, with zero slope, at both ends. */
function pulse(s, start, peak, end) {
  return THREE.MathUtils.smoothstep(s, start, peak) * (1 - THREE.MathUtils.smoothstep(s, peak, end))
}

const EDGE_X = [-1, 0, 1]
const edge = new THREE.Vector3()

/**
 * The sine of the highest elevation on screen. With no roll the top edge is highest at its
 * centre when that looks above the horizon, and at its corners when it looks below.
 */
function frameTop(camera) {
  if (!camera?.isPerspectiveCamera) return 1
  const tanV = Math.tan(THREE.MathUtils.DEG2RAD * camera.fov * 0.5) / camera.zoom
  const tanH = tanV * camera.aspect
  let top = -1
  for (let i = 0; i < EDGE_X.length; i += 1) {
    edge.set(EDGE_X[i] * tanH, tanV, -1).applyQuaternion(camera.quaternion)
    top = Math.max(top, edge.y / edge.length())
  }
  return top
}

// The lowest elevations (as sines) at which each sky layer can show anything.
const STARS_LOW = 0.09 // stars sit at 0.1 and up, fading in from there
const MOON_LOW = Math.sin(MOON_ELEVATION - MOON_SIZE * MOON_HALO) - 0.01 // the halo's lower rim
const CLOUDS_LOW = -0.005 // the cloud dome starts at the horizon
const BAND_LOW = -0.06 // the glow band reaches a little below it

/** Builds the sky and weather into `group` (which must sit at the world origin, unrotated). */
export function buildWeather(group, ctx) {
  const extent = ctx.extent
  const exposure = ctx.renderer?.toneMappingExposure ?? 1
  const noise = cloudNoise()
  const dome = new THREE.SphereGeometry(SKY_RADIUS, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.58)
  const moonDir = new THREE.Vector3(
    Math.sin(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
    Math.sin(MOON_ELEVATION),
    -Math.cos(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
  )
  const resolution = { value: new THREE.Vector2(1, 1) }
  const flash = {
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
    uFlashColor: { value: new THREE.Color(0.6, 0.55, 1.0).multiplyScalar(0.5) },
  }

  // Searchlights: four sectors of the mid band, two to each side of north, leaning outward.
  const sectors = [-0.95, -0.36, 0.3, 0.9]
  const roofs = findRoofs(ctx, group, sectors)
  const beamColors = ['#c9b6ff', '#9fe8ff', '#dccfff', '#e6b8ff']
  const beams = {
    uBeamO: { value: roofs.map(r => r.origin) },
    uBeamD: { value: roofs.map(() => new THREE.Vector3(0, 1, 0)) },
    uBeamColor: { value: beamColors.map(c => new THREE.Color(c)) },
    uBeamCount: { value: roofs.length },
  }
  const sweeps = sectors.map((azimuth, i) => {
    const seed = hash(`beam${i}`)
    return {
      lean: azimuth * 0.9,
      sway: 0.45 + (seed % 20) / 100,
      swaySpeed: 0.045 + (seed % 9) * 0.006,
      tilt: 0.22 + ((seed >> 5) % 8) / 100,
      tiltSway: 0.1,
      tiltSpeed: 0.06 + ((seed >> 9) % 9) * 0.006,
      phase: (seed % 628) / 100,
    }
  })

  const spots = spotUniforms()
  const sky = buildSky(group, dome, exposure, moonDir)
  const stars = buildStars(group, ctx.renderer?.getPixelRatio?.() ?? 1)
  const band = buildGlowBand(group, noise, exposure, flash)
  const moon = buildMoon(group)
  const clouds = buildClouds(group, noise, exposure, moonDir, beams, flash)
  const searchlights = buildBeams(group, beams, roofs.map(r => r.roof), resolution)
  const mistMaterial = buildMist(group, extent, noise, exposure)
  const rain = buildRain(group, spots, resolution, extent)
  const splashes = buildSplashes(group, spots, extent)

  // The lamps and signs that light the rain. A few times a second the nearest to the focus are
  // chosen, and each holds a slot whose weight fades in or out over SPOT_FADE: a lamp joining or
  // leaving the nearest never switches its lit rain on or off. Positions and colours are copied
  // every frame, so the rain lit by a moving car follows the car and screens' colour changes carry.
  const lightSpots = ctx.lightSpots ?? []
  const slots = Array.from({ length: MAX_SPOTS }, () => ({ spot: null, want: false, weight: 0 }))
  const held = new Map() // light spot -> the slot it holds
  const bestIndex = new Int32Array(NEAREST_SPOTS)
  const bestScore = new Float64Array(NEAREST_SPOTS)
  const tint = new THREE.Color()
  let waiting = 0 // chosen lamps still waiting for a slot to come free
  let spotsAge = Infinity

  /** Chooses the nearest lamps (one already lit counts SPOT_HOLD nearer) and seats newcomers in free slots. */
  function chooseSpots(focus) {
    let count = 0
    for (let j = 0; j < lightSpots.length; j += 1) {
      const s = lightSpots[j]
      if (!s?.position || !s.color) continue
      const d = s.position.distanceTo(focus) - (s.radius ?? 4) - (held.has(s) ? SPOT_HOLD : 0)
      if (d >= SPOT_REACH || (count === NEAREST_SPOTS && d >= bestScore[count - 1])) continue
      // Insert into the short sorted list; when it is full, the farthest drops off the end.
      let k = count < NEAREST_SPOTS ? count++ : count - 1
      while (k > 0 && bestScore[k - 1] > d) {
        bestScore[k] = bestScore[k - 1]
        bestIndex[k] = bestIndex[k - 1]
        k -= 1
      }
      bestScore[k] = d
      bestIndex[k] = j
    }
    for (let i = 0; i < MAX_SPOTS; i += 1) slots[i].want = false
    waiting = 0
    for (let i = 0; i < count; i += 1) {
      const s = lightSpots[bestIndex[i]]
      let slot = held.get(s)
      for (let f = 0; f < MAX_SPOTS && !slot; f += 1) {
        if (slots[f].spot) continue
        slot = slots[f]
        slot.spot = s
        slot.weight = 0
        held.set(s, slot)
      }
      if (slot) slot.want = true
      else waiting += 1
    }
  }

  /** Fades every slot toward its target and uploads the lit ones, positions and colours fresh. */
  function shineSpots(dt) {
    const step = dt / SPOT_FADE
    const pos = spots.uSpotPos.value
    const color = spots.uSpotColor.value
    const radius = spots.uSpotRadius.value
    let k = 0
    for (let i = 0; i < MAX_SPOTS; i += 1) {
      const slot = slots[i]
      const s = slot.spot
      if (!s) continue
      slot.weight = slot.want ? Math.min(1, slot.weight + step) : slot.weight - step
      if (!slot.want && slot.weight <= 0) {
        held.delete(s)
        slot.spot = null
        slot.weight = 0
        if (waiting > 0) spotsAge = Infinity // a chosen lamp was waiting for this slot: seat it next frame
        continue
      }
      const w = slot.weight
      pos[k].copy(s.position)
      tint.set(s.color)
      // Colours pushed brighter than white for the glow are brought back to full strength, then eased in or out.
      const gain = (w * w * (3 - 2 * w)) / Math.max(tint.r, tint.g, tint.b, 1)
      color[k].setRGB(tint.r * gain, tint.g * gain, tint.b * gain)
      // Light carries a little further in rain than the spot's own radius.
      radius[k] = (s.radius ?? 4) * 1.25
      k += 1
    }
    spots.uSpotCount.value = k
  }

  const cloudSpeeds = [new THREE.Vector2(3.2, -1.2), new THREE.Vector2(4.4, -0.6), new THREE.Vector2(6, 0.4)]
  const drifts = clouds.material.uniforms.uDrift.value
  const beamOrigins = beams.uBeamO.value
  const beamDirs = beams.uBeamD.value
  const windShift = rain.material.uniforms.uWindShift.value
  const wind = rain.material.uniforms.uWind.value
  const size = new THREE.Vector2()
  let warmup = 2 // frames drawn with every layer on, so all the shaders compile at load
  let mistFall = 0
  let nextFlash = null // set on the first frame: the module may be rebuilt late in the night
  let flashStart = -1
  let flashPower = 0
  let flashSecond = 0
  let flashGap = 0

  return {
    update(dt, t) {
      const camera = ctx.camera
      const cam = camera.position
      const focus = ctx.focus
      ctx.renderer?.getDrawingBufferSize(size)
      if (size.x > 0) resolution.value.copy(size)

      // The sky rides on the camera, so it sits at infinity.
      sky.position.copy(cam)
      stars.position.copy(cam)
      clouds.position.copy(cam)
      band.position.set(cam.x, cam.y + 100, cam.z)
      moon.position.copy(cam).addScaledVector(moonDir, MOON_DISTANCE)
      moon.quaternion.copy(camera.quaternion)
      if (ctx.scene.fog) sky.material.uniforms.uFloor.value.copy(ctx.scene.fog.color)
      stars.material.uniforms.uTime.value = t % STAR_CLOCK

      // Layers above the top of the frame are switched off (with the current orbit that is the
      // moon, stars, clouds and searchlights); they come back by themselves if the view opens up.
      let top = 1
      if (warmup > 0) warmup -= 1
      else top = frameTop(camera)
      stars.visible = top > STARS_LOW
      moon.visible = top > MOON_LOW
      clouds.visible = top > CLOUDS_LOW
      band.visible = top > BAND_LOW
      // A beam rises from its roof, so its foot is the lowest part of it on screen.
      let foot = 1
      for (let i = 0; i < beamOrigins.length; i += 1) {
        const o = beamOrigins[i]
        foot = Math.min(foot, (o.y - cam.y) / Math.max(o.distanceTo(cam), 1))
      }
      searchlights.mesh.visible = top > foot - 0.02
      if (searchlights.flares) searchlights.flares.visible = searchlights.mesh.visible

      // Clouds drift. Offsets wrap at DRIFT_TILES whole tiles, where the fine detail has also moved
      // a whole number of its own tiles, so no sample jumps at the wrap; they stay precise all night.
      for (let i = 0; i < drifts.length; i += 1) {
        const wrap = CLOUD_SCALE[i] * DRIFT_TILES
        drifts[i].set((drifts[i].x + cloudSpeeds[i].x * dt) % wrap, (drifts[i].y + cloudSpeeds[i].y * dt) % wrap)
      }

      // Searchlights sweep in slow swells (a minute or two each way).
      for (let i = 0; i < sweeps.length; i += 1) {
        const s = sweeps[i]
        const azimuth = s.lean + s.sway * Math.sin(t * s.swaySpeed + s.phase)
        const tilt = s.tilt + s.tiltSway * Math.sin(t * s.tiltSpeed + s.phase * 1.7)
        beamDirs[i].set(Math.sin(azimuth) * Math.sin(tilt), Math.cos(tilt), -Math.cos(azimuth) * Math.sin(tilt))
      }

      // Wind: gentle gusts that come and go over tens of seconds.
      wind.set(1.6 + 0.9 * Math.sin(t * 0.09) + 0.4 * Math.sin(t * 0.23 + 1.3), 0.5 + 0.4 * Math.sin(t * 0.07 + 2))
      windShift.set((windShift.x + wind.x * dt) % RAIN_BOX.x, (windShift.y + wind.y * dt) % RAIN_BOX.z)
      const level = 0.86 + 0.14 * Math.sin((t * Math.PI * 2) / 170)
      const ru = rain.material.uniforms
      ru.uTime.value = t % RAIN_PERIOD
      ru.uFocus.value.copy(focus)
      ru.uLevel.value = level
      const su = splashes.material.uniforms
      su.uTime.value = t % SPLASH_PERIOD
      su.uFocus.value.copy(focus)
      su.uLevel.value = level
      const mu = mistMaterial.uniforms
      mu.uDrift.value.set((t * 0.0045) % DRIFT_TILES, (t * 0.0012) % DRIFT_TILES)
      mistFall = (mistFall + (14 / 900) * dt) % 1
      mu.uFall.value = mistFall
      mu.uSlant.value = wind.x / 14

      spotsAge += dt
      if (spotsAge >= SPOT_PICK) {
        chooseSpots(focus)
        spotsAge = 0
      }
      shineSpots(dt)

      // Sheet lightning: far off, every 40 to 100 s, one or two soft swells over about 0.6 s.
      // It lights only the clouds and the horizon glow: never the scene lights, the office or the bloom.
      nextFlash ??= t + 40 + Math.random() * 60
      if (flashStart < 0 && t >= nextFlash) {
        flashStart = t
        flashPower = 0.45 + Math.random() * 0.55
        flashSecond = Math.random() < 0.65 ? 0.45 + Math.random() * 0.4 : 0
        flashGap = 0.2 + Math.random() * 0.12
        const azimuth = (Math.random() * 2 - 1) * 1.2
        const elevation = 0.08 + Math.random() * 0.25
        flash.uFlashDir.value.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation))
        nextFlash = t + 40 + Math.random() * 60
        ctx.onLightning?.(flashPower)
      }
      if (flashStart >= 0) {
        const s = t - flashStart
        const envelope = pulse(s, 0, 0.1, 0.3) + flashSecond * pulse(s, 0.06 + flashGap, 0.14 + flashGap, 0.4 + flashGap)
        flash.uFlash.value = flashPower * envelope
        if (s > 0.75) {
          flashStart = -1
          flash.uFlash.value = 0
        }
      }
    },
  }
}
