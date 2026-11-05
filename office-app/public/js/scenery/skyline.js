// /Users/hunterjolly/claude-mods/office-app/public/js/scenery/skyline.js
// The skyline: a dense night megacity in layers. Three depth bands of towers rise north of the
// office (near, mid, far) with flank bands either side; beyond them a sea of tiny city lights runs
// to the horizon, where flare stacks pulse in the smog. Towers carry window grids, neon trim,
// vertical signs with katakana words, rooftop gardens and red aircraft beacons. Every tower is
// merged into one mesh per window texture, so the whole city, lights and haze included, is under 20 draw calls.
// Layout comes from hash() seeds: the same city on every load. Nothing blinks: beacons breathe and
// flares pulse, smoothly and slowly. The sky, moon, horizon glow band and searchlights belong to
// weather.js (its searchlights stand on these roofs).

import * as THREE from 'three'
import { hash } from '../util.js'

// ------------------------------------------------------------------ dimensions

const WIN_U = 1.15 // metres per window column
const WIN_V = 2.7 // metres per floor
const COLS = 32 // window columns in one window texture
const ROWS = 64 // floors in one window texture
const REPEAT_U = WIN_U * COLS // 36.8 m of facade per texture repeat, across
const REPEAT_V = WIN_V * ROWS // 172.8 m per repeat, upward
const FOCUS_Z = 9.5 // the camera orbits a point this far into the office
const TOWER_R = 296 // every tower stands within this radius of the focus...
const HAZE_R = 302 // ...inside the backdrop haze (an arc at this radius)...
const SEA_R0 = 310 // ...and the sea of lights lies outside it, out to here
const SEA_R1 = 470
const SEA_ARC = THREE.MathUtils.degToRad(78) // the sea spreads this far either side of north
const HAZE_Z = [-112, -39.5] // two straight haze curtains stand inside the arc at these z, the far one first
const TAU = Math.PI * 2
const CLOCK = TAU * 1000 // animation speeds are whole thousandths of a radian a second, so time can wrap here cleanly

// ------------------------------------------------------------------ palette

const NEON_PICK = [['#ff2bd6', 30], ['#2bf3ff', 26], ['#b06bff', 12], ['#3bff9d', 10], ['#ffb02b', 12], ['#ff3b5c', 8]]
const WARM = ['#ffcf8a', '#ffb45c', '#ffe2b0', '#fff1d6']
const COOL = ['#9fe8ff', '#c9b6ff', '#dff0ff', '#86b8ff']
const MOSAIC = ['#4f7bff', '#7d5cff', '#5fd8ff', '#b9a8ff', '#3b5bdb', '#ff5fd0', '#ffb45c']
const BODY = ['#232a44', '#1e2238', '#2a2446', '#1a2132', '#2e2650', '#20283c']
const SEA_COLORS = [['#ffb45c', 40], ['#ffcf8a', 22], ['#fff1dc', 14], ['#bfe0ff', 10], ['#9fe8ff', 5], ['#ff3b5c', 3], ['#ff2bd6', 2], ['#2bf3ff', 2], ['#c9b6ff', 1], ['#3bff9d', 1]]
const JP_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif'
const LATIN_FONT = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", "Helvetica Neue", sans-serif'

// Sign words: ordinary katakana words (light, karaoke, hotel, electric, future, neon, ramen, dream,
// night sky, soba, coffee house, moon, rain, sushi, cafe, games) and everyday or invented names in
// Latin letters (moon-viewing, a kimono panel, sleet, mist, an invented name, tuna, depth, lumen).
const VERTICAL_WORDS = ['ヒカリ', 'カラオケ', 'ホテル', 'デンキ', 'ミライ', 'ネオン', 'ラーメン', 'ユメ', 'ヨゾラ', 'ソバ', 'キッサ', 'ツキ', 'アメ', 'スシ', 'カフェ', 'ゲーム']
const ROOF_WORDS = ['TSUKIMI', 'OKUMI', 'MIZORE', 'KASUMI', 'SORAMI', 'TEKKA 9', 'YUGEN', 'LUMEN 24']
const SIGN_COLORS = [
  ['#3bff9d', '#ff2bd6'],
  ['#ff2bd6', '#2bf3ff'],
  ['#2bf3ff', '#2bf3ff'],
  ['#ffb02b', '#ff3b5c'],
  ['#b06bff', '#ff2bd6'],
  ['#ff2bd6', '#ff2bd6'],
  ['#2bf3ff', '#3bff9d'],
  ['#ff3b5c', '#ffb02b'],
]

// Window textures, and which ones each band uses (weights).
const KINDS = ['grid-warm', 'bands-warm', 'speckle-cool', 'mosaic', 'grid-cool', 'speckle-warm']
const TEX = { gridWarm: 0, bands: 1, speckleCool: 2, mosaic: 3, gridCool: 4, speckleWarm: 5 }

/** Per band: window textures, window brightness, neon tube thickness, beacon size, mast thickness and height. */
const BAND = {
  near: { windows: [[TEX.gridWarm, 30], [TEX.bands, 26], [TEX.mosaic, 26], [TEX.gridCool, 18]], glow: [0.75, 1.2], trim: 0.3, beacon: 0.1, mast: 0.35, mastH: [6, 14] },
  flank: { windows: [[TEX.gridWarm, 30], [TEX.bands, 20], [TEX.mosaic, 30], [TEX.gridCool, 20]], glow: [0.7, 1.15], trim: 0.3, beacon: 0.1, mast: 0.35, mastH: [5, 12] },
  mid: { windows: [[TEX.gridWarm, 20], [TEX.bands, 22], [TEX.mosaic, 20], [TEX.gridCool, 20], [TEX.speckleCool, 18]], glow: [0.85, 1.4], trim: 0.55, beacon: 0.2, mast: 0.6, mastH: [10, 28] },
  outer: { windows: [[TEX.gridCool, 25], [TEX.speckleCool, 25], [TEX.mosaic, 25], [TEX.bands, 25]], glow: [0.9, 1.5], trim: 0.7, beacon: 0.28, mast: 0.8, mastH: [10, 30] },
  far: { windows: [[TEX.speckleCool, 36], [TEX.speckleWarm, 26], [TEX.mosaic, 14], [TEX.gridCool, 12], [TEX.bands, 12]], glow: [1.2, 2.0], trim: 0.95, beacon: 0.4, mast: 1, mastH: [14, 40] },
}

// Aircraft beacons breathe between 55% and 100%, always bright enough to glow, so the glow never switches.
const BEACON_RGB = [8, 0.16, 0.12]
const BEACON_DEPTH = 0.45

const UP = new THREE.Vector3(0, 1, 0)
const DOWN = new THREE.Vector3(0, -1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const DARK = new THREE.Color(0, 0, 0)
const STILL = [0, 0, 0, 1] // a glow that doesn't pulse and fades in the fog
const NO_FOG = [0, 0, 0, 0] // a glow that doesn't pulse and reads at any distance (the sea of lights)
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _n = new THREE.Vector3()
const _o = new THREE.Vector3()
const _d = new THREE.Vector3()
const _s1 = new THREE.Vector3()
const _s2 = new THREE.Vector3()
const _m = new THREE.Vector3()
const v3 = (x, y, z) => new THREE.Vector3(x, y, z)

// ------------------------------------------------------------------ randomness

/** A deterministic random stream seeded from hash(text): the same city on every load. */
function stream(text) {
  let s = hash(text) || 1
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (r, low, high) => low + r() * (high - low)
const oneOf = (r, list) => list[Math.floor(r() * list.length)]

/** An animation speed in rad/s, rounded to a whole thousandth so the wrapped clock stays seamless. */
const speedOf = (r, low, high) => Math.round(between(r, low, high) * 1000) / 1000

/** Picks a value from [[value, weight], ...]. */
function weightedOf(r, entries) {
  let total = 0
  for (const [, w] of entries) total += w
  let roll = r() * total
  for (const [value, w] of entries) {
    roll -= w
    if (roll <= 0) return value
  }
  return entries[entries.length - 1][0]
}

// ------------------------------------------------------------------ colour

/** The luminance the glow pass thresholds on (0.82): above it a colour blooms, below it doesn't. */
const luma = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

/** A linear colour scaled to the given luminance: neon sits above the bloom threshold, windows and haze below. */
function glowing(hex, luminance) {
  const c = new THREE.Color(hex)
  return c.multiplyScalar(luminance / Math.max(0.01, luma(c)))
}

/** Mixes two hex colours into a CSS colour (canvas drawing works in sRGB). */
function mixCss(a, b, t) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = shift => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

/**
 * The linear colour that reads on screen as `hex` after the frame's ACES tone mapping, which crushes
 * dark colours. Per channel through the curve's fit only: close enough for the soft haze it is used on.
 */
function onScreen(hex) {
  const c = new THREE.Color(hex)
  const unfit = y => {
    const a = 1 - 0.983729 * y
    const b = 0.0245786 - 0.432951 * y
    const k = 0.000090537 + 0.238081 * y
    return ((-b + Math.sqrt(b * b + 4 * a * k)) / (2 * a)) * 0.6
  }
  return new THREE.Color(unfit(Math.min(c.r, 0.95)), unfit(Math.min(c.g, 0.95)), unfit(Math.min(c.b, 0.95)))
}

// ------------------------------------------------------------------ textures

/** A canvas texture: power-of-two and mipmapped, so far detail averages out instead of shimmering. */
function canvasTexture(canvas, anisotropy, { repeat = false, srgb = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas)
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = anisotropy
  return texture
}

/** A window grid: 32 columns by 64 floors on a 512 x 1024 canvas, some floors dark, some lit end to end. */
function windowTexture(kind, anisotropy) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 1024
  const g = canvas.getContext('2d')
  const r = stream(`skyline-windows:${kind}`)
  const cell = 16
  g.fillStyle = '#04060b'
  g.fillRect(0, 0, 512, 1024)
  const pane = (color, alpha, x, y, w, h) => {
    g.globalAlpha = alpha
    g.fillStyle = color
    g.fillRect(x, y, w, h)
  }
  const warm = kind.endsWith('warm')
  const odd = kind.startsWith('speckle') ? 0.28 : 0.08
  const tone = () => oneOf(r, (r() < odd) === warm ? COOL : WARM)
  if (kind === 'mosaic') {
    // Blocks of coloured light across several windows: blue and violet mostly, now and then magenta or amber.
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) pane('#0a0f20', 1, col * cell + 2, row * cell + 3, 12, 10)
    }
    for (let b = 0; b < 190; b += 1) {
      const bx = Math.floor(r() * COLS)
      const by = Math.floor(r() * ROWS)
      const bw = 1 + Math.floor(r() * 4)
      const bh = 1 + Math.floor(r() * 3)
      const color = MOSAIC[Math.floor(r() ** 1.7 * MOSAIC.length)]
      const alpha = 0.45 + r() * 0.55
      for (let j = 0; j < bh; j += 1) {
        for (let i = 0; i < bw; i += 1) pane(color, alpha, ((bx + i) % COLS) * cell + 2, ((by + j) % ROWS) * cell + 3, 12, 10)
      }
    }
  } else {
    for (let row = 0; row < ROWS; row += 1) {
      const y = row * cell
      const mood = r()
      // A floor is dark, lit end to end, or somewhere between.
      const share = mood < 0.12 ? 0.03 : mood < 0.22 ? 0.9 : 0.15 + r() * 0.5
      if (kind === 'bands-warm') {
        // Ribbon windows: offices lit in runs along the floor, with thin mullions.
        pane('#0c1222', 1, 0, y + 5, 512, 7)
        for (let col = 0; col < COLS; ) {
          const run = 2 + Math.floor(r() * 6)
          if (r() < share) pane(tone(), 0.5 + r() * 0.5, col * cell, y + 5, run * cell, 7)
          col += run
        }
        g.globalAlpha = 1
        g.fillStyle = '#04060b'
        for (let col = 0; col < COLS; col += 1) g.fillRect(col * cell, y + 5, 2, 7)
      } else if (kind.startsWith('grid')) {
        for (let col = 0; col < COLS; col += 1) {
          pane('#0d1426', 1, col * cell + 3, y + 4, 10, 9)
          if (r() < share) pane(tone(), 0.45 + r() * 0.55, col * cell + 3, y + 4, 10, 9)
        }
      } else {
        // Speckle: pinprick windows, four to a cell, sparse.
        for (let col = 0; col < COLS; col += 1) {
          for (let k = 0; k < 4; k += 1) {
            if (r() < share * 0.6) pane(tone(), 0.5 + r() * 0.5, col * cell + 2 + (k % 2) * 8, y + 2 + Math.floor(k / 2) * 8, 4, 5)
          }
        }
      }
    }
  }
  g.globalAlpha = 1
  return canvasTexture(canvas, anisotropy, { repeat: true })
}

/** Rounds a rectangle into the current path. */
function roundedRect(g, x, y, w, h, radius) {
  g.beginPath()
  g.moveTo(x + radius, y)
  g.arcTo(x + w, y, x + w, y + h, radius)
  g.arcTo(x + w, y + h, x, y + h, radius)
  g.arcTo(x, y + h, x, y, radius)
  g.arcTo(x, y, x + w, y, radius)
  g.closePath()
}

/**
 * Strokes the current path as a neon tube: a coloured glow, then a white-hot core half as wide (on the
 * narrowest far signs, 4.5 m on a 128 px cell, that core is still 0.14 m: never a thin shimmering line).
 */
function tube(g, color, width) {
  g.save()
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.shadowColor = color
  g.shadowBlur = width * 2.2
  g.strokeStyle = color
  g.lineWidth = width
  g.stroke()
  g.shadowBlur = 0
  g.strokeStyle = mixCss(color, '#ffffff', 0.6)
  g.lineWidth = width * 0.5
  g.stroke()
  g.restore()
}

/** Glowing letters: a soft coloured bloom under a lighter core. */
function glowText(g, text, x, y, color) {
  g.save()
  g.shadowColor = color
  g.shadowBlur = 16
  g.fillStyle = color
  g.fillText(text, x, y)
  g.shadowBlur = 0
  g.globalAlpha = 0.55
  g.fillStyle = mixCss(color, '#ffffff', 0.55)
  g.fillText(text, x, y)
  g.restore()
}

/** A tall sign: a word written top to bottom in neon in a neon frame, or dark on a lit lightbox. */
function drawVertical(g, x, y, w, h, word, frame, ink, box) {
  const chars = [...word]
  const step = (h - 56) / chars.length
  const size = Math.round(Math.min(w * 0.6, step * 0.78))
  g.fillStyle = '#05060d'
  g.fillRect(x, y, w, h)
  if (box) {
    g.fillStyle = frame
    roundedRect(g, x + 8, y + 8, w - 16, h - 16, 10)
    g.fill()
    g.fillStyle = mixCss(frame, '#ffffff', 0.35)
    g.fillRect(x + 16, y + 14, w - 32, 6)
  } else {
    roundedRect(g, x + 13, y + 13, w - 26, h - 26, 12)
    tube(g, frame, 8)
  }
  g.font = `700 ${size}px ${JP_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  chars.forEach((c, i) => {
    g.save()
    g.translate(x + w / 2, y + 28 + step * (i + 0.5))
    if (c === 'ー') g.rotate(Math.PI / 2) // the long-vowel bar runs down the sign in vertical writing
    if (box) {
      g.fillStyle = '#12081c'
      g.fillText(c, 0, 0)
    } else {
      glowText(g, c, 0, 0, ink)
    }
    g.restore()
  })
}

/** A wide rooftop sign: an invented name spelled out in neon letters inside a neon frame. */
function drawRoofSign(g, x, y, w, h, word, frame, ink) {
  g.fillStyle = '#05060d'
  g.fillRect(x, y, w, h)
  roundedRect(g, x + 12, y + 12, w - 24, h - 24, 18)
  tube(g, frame, 9)
  g.font = `800 ${Math.round(h * 0.5)}px ${LATIN_FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const letters = [...word]
  const step = (w - 96) / letters.length
  letters.forEach((c, i) => glowText(g, c, x + 48 + step * (i + 0.5), y + h / 2 + 3, ink))
}

/** A small emblem sign: an abstract mark in neon in a rounded frame. */
function drawEmblem(g, x, y, s, kind, frame, ink) {
  g.fillStyle = '#05060d'
  g.fillRect(x, y, s, s)
  roundedRect(g, x + 10, y + 10, s - 20, s - 20, 16)
  tube(g, frame, 7)
  const R = s * 0.26
  g.save()
  g.translate(x + s / 2, y + s / 2)
  g.beginPath()
  switch (kind % 10) {
    case 0: // ring and dot
      g.arc(0, 0, R, 0, TAU)
      g.moveTo(R * 0.28, 0)
      g.arc(0, 0, R * 0.28, 0, TAU)
      break
    case 1: // diamond with a bar
      g.moveTo(0, -R)
      g.lineTo(R, 0)
      g.lineTo(0, R)
      g.lineTo(-R, 0)
      g.closePath()
      g.moveTo(-R * 0.45, 0)
      g.lineTo(R * 0.45, 0)
      break
    case 2: // crescent
      g.arc(0, 0, R, Math.PI * 0.3, Math.PI * 1.7)
      g.arc(R * 0.45, 0, R * 0.78, Math.PI * 1.62, Math.PI * 0.38, true)
      g.closePath()
      break
    case 3: // three bars
      for (const dx of [-0.6, 0, 0.6]) {
        g.moveTo(dx * R, -R)
        g.lineTo(dx * R, R)
      }
      break
    case 4: // chevrons
      g.moveTo(-R, R * 0.1)
      g.lineTo(0, -R * 0.6)
      g.lineTo(R, R * 0.1)
      g.moveTo(-R, R * 0.7)
      g.lineTo(0, 0)
      g.lineTo(R, R * 0.7)
      break
    case 5: // hexagon
      for (let k = 0; k <= 6; k += 1) g.lineTo(R * Math.cos(k * Math.PI / 3 + Math.PI / 6), R * Math.sin(k * Math.PI / 3 + Math.PI / 6))
      break
    case 6: // four-point star
      for (let k = 0; k <= 8; k += 1) {
        const rr = k % 2 ? R * 0.32 : R
        g.lineTo(rr * Math.cos(k * Math.PI / 4 - Math.PI / 2), rr * Math.sin(k * Math.PI / 4 - Math.PI / 2))
      }
      break
    case 7: // waves
      for (const dy of [-0.55, 0, 0.55]) {
        g.moveTo(-R, dy * R)
        for (let k = 1; k <= 12; k += 1) g.lineTo(-R + (k / 12) * 2 * R, dy * R + Math.sin(k * Math.PI / 3) * R * 0.16)
      }
      break
    case 8: // triangle
      g.moveTo(0, -R)
      g.lineTo(R * 0.95, R * 0.7)
      g.lineTo(-R * 0.95, R * 0.7)
      g.closePath()
      break
    default: // plus
      g.moveTo(0, -R)
      g.lineTo(0, R)
      g.moveTo(-R, 0)
      g.lineTo(R, 0)
  }
  tube(g, ink, 7)
  g.restore()
}

/** A run of shopfronts for a podium's ground floor: lit windows, some closed shutters, a neon fascia over each. */
function drawShops(g, x, y, w, h, r) {
  g.fillStyle = '#06070c'
  g.fillRect(x, y, w, h)
  const top = y + 24
  const tall = h - 30
  for (let px = x; px < x + w - 20; ) {
    const pw = Math.min(x + w - px, 60 + r() * 80)
    const kind = r()
    if (kind < 0.55) {
      const grad = g.createLinearGradient(0, top, 0, top + tall)
      grad.addColorStop(0, '#ffe2b0')
      grad.addColorStop(1, '#c0702c')
      g.globalAlpha = 0.55 + r() * 0.4
      g.fillStyle = grad
      g.fillRect(px + 4, top, pw - 8, tall)
      g.globalAlpha = 1
      g.fillStyle = '#06070c'
      for (let m = px + 34; m < px + pw - 12; m += 30) g.fillRect(m, top, 3, tall)
    } else if (kind < 0.78) {
      g.globalAlpha = 0.45 + r() * 0.35
      g.fillStyle = oneOf(r, COOL)
      g.fillRect(px + 4, top, pw - 8, tall)
    } else {
      g.globalAlpha = 1
      g.fillStyle = '#1a1d26'
      g.fillRect(px + 4, top, pw - 8, tall)
      g.fillStyle = '#0f1118'
      for (let s = top + 3; s < top + tall; s += 7) g.fillRect(px + 4, s, pw - 8, 2)
    }
    g.globalAlpha = 1
    const neon = weightedOf(r, NEON_PICK)
    g.save()
    g.shadowColor = neon
    g.shadowBlur = 10
    g.fillStyle = neon
    g.fillRect(px + 8, y + 8, pw - 16, 8)
    g.restore()
    px += pw
  }
}

/**
 * The sign atlas: every sign, shopfront and emblem on one mipmapped 2048 x 1024 canvas, with a white
 * patch the neon tubes sample (tinted per vertex). Each entry's uv is [u0, v0, u1, v1].
 */
function signAtlas(anisotropy) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const g = canvas.getContext('2d')
  const r = stream('skyline-atlas')
  g.fillStyle = '#05060d'
  g.fillRect(0, 0, 2048, 1024)
  const uv = (x, y, w, h) => [x / 2048, 1 - (y + h) / 1024, (x + w) / 2048, 1 - y / 1024]
  const atlas = { vertical: [], roof: [], shop: [], emblem: [], white: [64 / 2048, 1 - 960 / 1024] }
  VERTICAL_WORDS.forEach((word, i) => {
    const [frame, ink] = SIGN_COLORS[i % SIGN_COLORS.length]
    const box = i % 5 === 3
    drawVertical(g, i * 128, 0, 128, 512, word, frame, ink, box)
    atlas.vertical.push({ uv: uv(i * 128 + 2, 2, 124, 508), frame, ink, box })
  })
  ROOF_WORDS.forEach((word, i) => {
    const x = (i % 4) * 512
    const y = 512 + Math.floor(i / 4) * 128
    const [frame, ink] = SIGN_COLORS[(i + 3) % SIGN_COLORS.length]
    drawRoofSign(g, x, y, 512, 128, word, frame, ink)
    atlas.roof.push({ uv: uv(x + 2, y + 2, 508, 124), frame, ink })
  })
  // Two strips of shopfronts, each standing for 24 m of street by 3 m.
  for (let i = 0; i < 2; i += 1) {
    drawShops(g, i * 1024, 768, 1024, 128, r)
    atlas.shop.push({ uv: uv(i * 1024 + 1, 769, 1022, 126) })
  }
  for (let i = 0; i < 15; i += 1) {
    const [frame, ink] = SIGN_COLORS[(i * 3 + 1) % SIGN_COLORS.length]
    drawEmblem(g, 128 + i * 128, 896, 128, i, frame, ink)
    atlas.emblem.push({ uv: uv(128 + i * 128 + 2, 898, 124, 124), frame, ink })
  }
  g.fillStyle = '#ffffff'
  g.fillRect(0, 896, 128, 128)
  atlas.texture = canvasTexture(canvas, anisotropy)
  return atlas
}

/** Soft drifting noise for the haze (grey, tiling across) and its fade (alpha: low and dense, soft ends). */
function hazeTextures(anisotropy) {
  const noiseCanvas = document.createElement('canvas')
  noiseCanvas.width = 256
  noiseCanvas.height = 128
  const g = noiseCanvas.getContext('2d')
  const r = stream('skyline-haze')
  g.fillStyle = '#b4b4b4'
  g.fillRect(0, 0, 256, 128)
  for (let k = 0; k < 90; k += 1) {
    const x = r() * 256
    const y = r() * 128
    const radius = 10 + r() * 40
    const tint = r() < 0.5 ? '255,255,255' : '30,30,40'
    const alpha = 0.16 + r() * 0.2
    for (const dx of [-256, 0, 256]) {
      const grad = g.createRadialGradient(x + dx, y, 0, x + dx, y, radius)
      grad.addColorStop(0, `rgba(${tint},${alpha})`)
      grad.addColorStop(1, `rgba(${tint},0)`)
      g.fillStyle = grad
      g.fillRect(x + dx - radius, y - radius, radius * 2, radius * 2)
    }
  }
  const noise = canvasTexture(noiseCanvas, anisotropy, { srgb: false })
  noise.wrapS = THREE.RepeatWrapping
  noise.repeat.set(3, 1)

  const fadeCanvas = document.createElement('canvas')
  fadeCanvas.width = 64
  fadeCanvas.height = 128
  const f = fadeCanvas.getContext('2d')
  const image = f.createImageData(64, 128)
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  for (let j = 0; j < 128; j += 1) {
    const v = 1 - (j + 0.5) / 128
    for (let i = 0; i < 64; i += 1) {
      const u = (i + 0.5) / 64
      const a = smooth(0, 0.14, u) * smooth(0, 0.14, 1 - u) * smooth(0, 0.1, v) * (1 - smooth(0.16, 1, v))
      const k = (j * 64 + i) * 4
      image.data[k] = image.data[k + 1] = image.data[k + 2] = Math.round(a * 255)
      image.data[k + 3] = 255
    }
  }
  f.putImageData(image, 0, 0)
  const fade = canvasTexture(fadeCanvas, anisotropy, { srgb: false })
  return { noise, fade }
}

// ------------------------------------------------------------------ builders

/** Faces of many buildings for one window texture: positions, normals, window uvs, wall tint, window glow. */
class Mass {
  constructor() {
    this.p = []
    this.n = []
    this.uv = []
    this.c = []
    this.g = []
    this.s = []
    this.i = []
  }

  /** One flat convex polygon; it turns itself to face along `out`. */
  poly(points, uvs, out, color, glow, seed) {
    _a.subVectors(points[1], points[0])
    _b.subVectors(points[2], points[0])
    _n.crossVectors(_a, _b).normalize()
    const flip = _n.dot(out) < 0
    if (flip) _n.negate()
    const base = this.p.length / 3
    const count = points.length
    for (let k = 0; k < count; k += 1) {
      const j = flip ? count - 1 - k : k
      const q = points[j]
      this.p.push(q.x, q.y, q.z)
      this.n.push(_n.x, _n.y, _n.z)
      this.uv.push(uvs[j][0], uvs[j][1])
      this.c.push(color.r, color.g, color.b)
      this.g.push(glow.r, glow.g, glow.b)
      this.s.push(seed)
    }
    for (let k = 1; k < count - 1; k += 1) this.i.push(base, base + k, base + k + 1)
  }

  get empty() {
    return this.i.length === 0
  }

  mesh(material) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3))
    geometry.setAttribute('glow', new THREE.Float32BufferAttribute(this.g, 3))
    geometry.setAttribute('seed', new THREE.Float32BufferAttribute(this.s, 1))
    geometry.setIndex(this.i)
    geometry.computeBoundingSphere()
    return new THREE.Mesh(geometry, material)
  }
}

/** Neon tubes, signs and shopfronts: one unlit mesh on the sign atlas, brightness and colour per vertex. */
class Neon {
  constructor(white) {
    this.p = []
    this.uv = []
    this.c = []
    this.i = []
    this.white = [white, white, white, white]
  }

  /** A quad with atlas uvs, turned to face along `out`. */
  quad(points, uvs, color, out) {
    _a.subVectors(points[1], points[0])
    _b.subVectors(points[2], points[0])
    _n.crossVectors(_a, _b)
    const flip = _n.dot(out) < 0
    const base = this.p.length / 3
    for (let k = 0; k < 4; k += 1) {
      const j = flip ? 3 - k : k
      this.p.push(points[j].x, points[j].y, points[j].z)
      this.uv.push(uvs[j][0], uvs[j][1])
      this.c.push(color.r, color.g, color.b)
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /** A square tube from a to b, `thick` metres across, lit in `color`. */
  bar(a, b, thick, color) {
    _d.subVectors(b, a)
    const len = _d.length()
    if (len < 1e-3) return
    _d.divideScalar(len)
    _s1.crossVectors(_d, Math.abs(_d.y) > 0.9 ? X_AXIS : UP).normalize().multiplyScalar(thick / 2)
    _s2.crossVectors(_d, _s1).normalize().multiplyScalar(thick / 2)
    const corner = (end, i, j) => end.clone().addScaledVector(_s1, i).addScaledVector(_s2, j)
    const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)]
    const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)]
    const middle = _m.addVectors(a, b).multiplyScalar(0.5).clone()
    for (let k = 0; k < 4; k += 1) this.face([A[k], B[k], B[(k + 1) % 4], A[(k + 1) % 4]], color, middle)
    this.face(A, color, middle)
    this.face(B, color, middle)
  }

  /** A face of a tube, sampling the atlas's white patch. */
  face(points, color, middle) {
    _o.set(0, 0, 0)
    for (const q of points) _o.add(q)
    _o.divideScalar(points.length).sub(middle)
    this.quad(points, this.white, color, _o)
  }

  /** A flat picture from the atlas, `w` by `h`, centred on `centre` and facing `normal` (horizontal). */
  panel(centre, normal, w, h, uv, color) {
    const right = new THREE.Vector3().crossVectors(UP, normal).normalize()
    const corner = (sx, sy) => centre.clone().addScaledVector(right, (sx * w) / 2).addScaledVector(UP, (sy * h) / 2)
    const [u0, v0, u1, v1] = uv
    this.quad([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color, normal)
  }

  get empty() {
    return this.i.length === 0
  }

  mesh(material) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3))
    geometry.setIndex(this.i)
    geometry.computeBoundingSphere()
    return new THREE.Mesh(geometry, material)
  }
}

/** Soft light sprites (camera-facing quads): each has a colour, a size in metres and a pulse [phase, speed, depth, fog share]. */
class Glows {
  constructor() {
    this.p = []
    this.c = []
    this.s = []
    this.k = []
  }

  add(x, y, z, color, size, pulse = STILL) {
    this.p.push(x, y, z)
    this.c.push(color.r, color.g, color.b)
    this.s.push(size)
    this.k.push(pulse[0], pulse[1], pulse[2], pulse[3])
  }

  get count() {
    return this.s.length
  }

  mesh(material) {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(this.p), 3))
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3))
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(this.s), 1))
    geometry.setAttribute('aPulse', new THREE.InstancedBufferAttribute(new Float32Array(this.k), 4))
    geometry.instanceCount = this.count
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    return mesh
  }
}

/**
 * Which haze layer a light at (x, z) sits in, back to front: 0 past the arc, 1 between the arc and the
 * far curtain, 2 between the two straight curtains, 3 in front of them all. The curtains lie inside the
 * arc and the camera always stays south of the near one, so this is also their order on screen.
 */
function layerOf(cx, x, z) {
  if (Math.hypot(x - cx, z - FOCUS_Z) > HAZE_R) return 0
  if (z <= HAZE_Z[0]) return 1
  if (z <= HAZE_Z[1]) return 2
  return 3
}

/** Light sprites sorted by haze layer, so each layer can be drawn between the right curtains. */
class Layered {
  constructor(cx) {
    this.cx = cx
    this.layers = [new Glows(), new Glows(), new Glows(), new Glows()]
  }

  add(x, y, z, color, size, pulse) {
    this.layers[layerOf(this.cx, x, z)].add(x, y, z, color, size, pulse)
  }
}

/** Haze curtains: vertical gradient sheets along a path of [x, z] points, coloured per vertex with alpha. */
class Sheet {
  constructor() {
    this.p = []
    this.uv = []
    this.c = []
    this.i = []
  }

  curtain(path, y0, y1, color, alpha) {
    const base = this.p.length / 3
    path.forEach(([x, z], k) => {
      const u = k / (path.length - 1)
      this.p.push(x, y0, z, x, y1, z)
      this.uv.push(u, 0, u, 1)
      this.c.push(color.r, color.g, color.b, alpha, color.r, color.g, color.b, alpha)
    })
    for (let k = 0; k < path.length - 1; k += 1) {
      const a = base + k * 2
      this.i.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }

  mesh(material) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 4))
    geometry.setIndex(this.i)
    geometry.computeBoundingSphere()
    return new THREE.Mesh(geometry, material)
  }
}

// ------------------------------------------------------------------ shaders

/** Tower walls: the window texture lights up per vertex (roofs stay dark), and a few floors per tower are dark. */
function towerShader(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 glow;\nattribute float seed;\nvarying vec3 vGlow;\nvarying float vSeed;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;\nvSeed = seed;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;\nvarying float vSeed;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float floorId = floor(vEmissiveMapUv.y * ${ROWS.toFixed(1)});
      float darkFloor = step(fract(sin(floorId * 12.9898 + vSeed * 78.233) * 43758.5453), 0.14);
      totalEmissiveRadiance *= vGlow * (1.0 - 0.9 * darkFloor);`,
    )
}

/** One material per window texture: dark glass and concrete, tinted per tower, windows on the emissive map. */
function towerMaterial(map) {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.3,
    envMapIntensity: 0.35,
    emissive: '#ffffff',
    emissiveMap: map,
    emissiveIntensity: 1,
  })
  material.onBeforeCompile = towerShader
  return material
}

// Camera-facing light sprites. Sprites smaller than a couple of pixels keep that size and fade
// instead, so tiny far lights never pop in and out between pixels; breathing is a smooth sine.
const SPRITE_VERTEX = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aColor;
  attribute float aSize;
  attribute vec4 aPulse;
  uniform float uTime;
  uniform float uScale;
  uniform float uFog;
  uniform float uMinPx;
  varying vec3 vColor;
  varying vec2 vCorner;
  void main() {
    vec4 view = modelViewMatrix * vec4(aCenter, 1.0);
    float dist = max(-view.z, 0.01);
    float pixels = aSize * projectionMatrix[1][1] * uScale / dist;
    float size = aSize;
    float energy = 1.0;
    if (pixels < uMinPx) {
      energy = (pixels * pixels) / (uMinPx * uMinPx);
      size = aSize * uMinPx / pixels;
    }
    float breathe = 1.0 - aPulse.z * (0.5 + 0.5 * sin(uTime * aPulse.y + aPulse.x));
    float f = uFog * dist;
    float clear = 1.0 - (1.0 - exp(-f * f)) * aPulse.w;
    vColor = aColor * breathe * energy * clear;
    vCorner = position.xy;
    view.xy += position.xy * size * 0.5;
    gl_Position = projectionMatrix * view;
  }
`
const SPRITE_FRAGMENT = /* glsl */ `
  uniform float uSharp;
  varying vec3 vColor;
  varying vec2 vCorner;
  void main() {
    float r2 = dot(vCorner, vCorner);
    if (r2 > 1.0) discard;
    float a = (exp(-r2 * uSharp) - exp(-uSharp)) / (1.0 - exp(-uSharp));
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`

/** An additive sprite material sharing the clock, screen scale and fog uniforms. */
function spriteMaterial(shared, sharp, minPx) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uScale: shared.uScale, uFog: shared.uFog, uSharp: { value: sharp }, uMinPx: { value: minPx } },
    vertexShader: SPRITE_VERTEX,
    fragmentShader: SPRITE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

// ------------------------------------------------------------------ shapes

/** Corners of a w x d rectangle centred on (x, z), turned by `turn` radians. */
function rect(x, z, w, d, turn = 0) {
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([px, pz]) => [x + px * c - pz * s, z + px * s + pz * c])
}

/** Corners of a regular polygon; by default one edge faces south (+z), toward the office. */
function ngon(x, z, radius, sides, turn = Math.PI / 2 - Math.PI / sides) {
  return Array.from({ length: sides }, (_, k) => {
    const a = turn + (k * TAU) / sides
    return [x + Math.cos(a) * radius, z + Math.sin(a) * radius]
  })
}

/** The edges of a footprint, each with its outward normal and direction. */
function edges(foot) {
  let mx = 0
  let mz = 0
  for (const [x, z] of foot) {
    mx += x
    mz += z
  }
  mx /= foot.length
  mz /= foot.length
  return foot.map(([ax, az], k) => {
    const [bx, bz] = foot[(k + 1) % foot.length]
    const len = Math.hypot(bx - ax, bz - az)
    const dx = (bx - ax) / len
    const dz = (bz - az) / len
    let nx = dz
    let nz = -dx
    if (nx * ((ax + bx) / 2 - mx) + nz * ((az + bz) / 2 - mz) < 0) {
      nx = -nx
      nz = -nz
    }
    return { ax, az, bx, bz, len, dx, dz, nx, nz }
  })
}

/**
 * A walled solid on a convex footprint, from y0 to y1. `shrink` pulls the roof ring toward the middle
 * (1 makes a point), `tilt` slopes the roof by [per metre x, per metre z]. Walls carry windows unless
 * `lit` is false; roofs and undersides stay plain. Flat upright walls are listed in `walls` for signs.
 */
function solid(T, foot, y0, y1, { shrink = 0, tilt = null, roof = true, bottom = false, lit = true, walls = null, tag = null, look = T.look } = {}) {
  let mx = 0
  let mz = 0
  for (const [x, z] of foot) {
    mx += x
    mz += z
  }
  mx /= foot.length
  mz /= foot.length
  const top = foot.map(([x, z]) => v3(mx + (x - mx) * (1 - shrink), y1 + (tilt ? (x - mx) * tilt[0] + (z - mz) * tilt[1] : 0), mz + (z - mz) * (1 - shrink)))
  const glow = lit ? look.glow : DARK
  const v = y => y / REPEAT_V + look.v
  let s = look.u
  edges(foot).forEach((e, k) => {
    const A1 = top[k]
    const B1 = top[(k + 1) % foot.length]
    const u0 = s / REPEAT_U
    const u1 = (s + e.len) / REPEAT_U
    _o.set(e.nx, 0, e.nz)
    T.mass.poly([v3(e.ax, y0, e.az), v3(e.bx, y0, e.bz), B1, A1], [[u0, v(y0)], [u1, v(y0)], [u1, v(B1.y)], [u0, v(A1.y)]], _o, look.body, glow, look.seed)
    if (walls && !shrink && lit) walls.push({ ...e, y0, y1: Math.min(A1.y, B1.y), T, tag })
    s += e.len
  })
  if (roof && shrink < 0.999) T.mass.poly(top, top.map(() => [0, 0]), UP, look.roof, DARK, look.seed)
  if (bottom) T.mass.poly(foot.map(([x, z]) => v3(x, y0, z)), foot.map(() => [0, 0]), DOWN, look.roof, DARK, look.seed)
  return top
}

// ------------------------------------------------------------------ towers

const PLAIN = { body: new THREE.Color('#1b1e28'), roof: new THREE.Color('#14161e'), glow: DARK, seed: 0, u: 0, v: 0 }
const TRUNK = { body: new THREE.Color('#2a2018'), roof: new THREE.Color('#2a2018'), glow: DARK, seed: 0, u: 0, v: 0 }

/** A new tower's look and kit: which window texture, how bright, its neon colour, its beacons' rhythm. */
function newTower(city, band, r) {
  const config = BAND[band]
  const bright = between(r, config.glow[0], config.glow[1])
  const tex = weightedOf(r, config.windows)
  return {
    city,
    band,
    r,
    config,
    mass: city.masses[tex],
    look: {
      body: new THREE.Color(oneOf(r, BODY)),
      roof: new THREE.Color('#0c0e16'),
      glow: new THREE.Color(bright, bright, bright),
      seed: 1 + Math.floor(r() * 90),
      u: Math.floor(r() * COLS) * WIN_U,
      v: Math.floor(r() * ROWS) / ROWS,
    },
    neon: weightedOf(r, NEON_PICK),
    phase: r() * TAU,
    speed: speedOf(r, 1.1, 1.9),
  }
}

/** A red aircraft beacon with a soft halo; both breathe together, never switching off. */
function beacon(T, x, y, z) {
  const size = T.config.beacon
  T.city.beacons.push({ x, y, z, size, phase: T.phase, speed: T.speed })
  T.city.glows.add(x, y, z, glowing('#ff2b2b', 0.12), size * 16, [T.phase, T.speed, BEACON_DEPTH, 1])
}

/** A neon tube along a footprint edge at height y, standing just proud of the wall. */
function edgeTube(T, e, y, color) {
  const t = T.config.trim
  const off = t / 2 + 0.08
  const ext = t / 2
  T.city.neon.bar(
    v3(e.ax - e.dx * ext + e.nx * off, y, e.az - e.dz * ext + e.nz * off),
    v3(e.bx + e.dx * ext + e.nx * off, y, e.bz + e.dz * ext + e.nz * off),
    t,
    color,
  )
}

/** Neon on a tower: sometimes its roof outlined, its street corners piped, a band across its face, a lit crown. */
function trims(T, foot, y0, top, { outline = 0.35, corners = 0.3, band = 0.35, crown = 0.2 } = {}) {
  const r = T.r
  const color = glowing(T.neon, 1.15)
  const sides = edges(foot)
  const south = sides.reduce((best, e) => (e.nz > best.nz ? e : best))
  if (r() < outline) for (const e of sides) edgeTube(T, e, top + T.config.trim / 2, color)
  if (r() < corners && south.nz > 0.95) {
    // 6 cm further out than the horizontal tubes, so where they cross no two faces share a plane.
    const off = T.config.trim / 2 + 0.14
    for (const [x, z, sx] of [[south.ax, south.az, south.dx], [south.bx, south.bz, -south.dx]]) {
      const px = x - sx * off + south.nx * off
      const pz = z + south.nz * off
      T.city.neon.bar(v3(px, y0 + 2, pz), v3(px, top, pz), T.config.trim, color)
    }
  }
  if (r() < band && top - y0 > 12) {
    const y = y0 + Math.max(4, Math.round(((top - y0) * between(r, 0.25, 0.7)) / WIN_V) * WIN_V)
    edgeTube(T, south, y, color)
  }
  if (r() < crown) {
    const white = glowing('#d6ecff', 0.95)
    for (const e of sides) {
      edgeTube(T, e, top - 1.6, white)
      edgeTube(T, e, top - 4.6, white)
    }
  }
}

/** A rooftop sign facing the street: a neon name on a dark frame, standing on two legs. */
function roofSign(T, x, z, w, y) {
  const r = T.r
  const city = T.city
  const entry = city.atlas.roof[Math.floor(r() * city.atlas.roof.length)]
  const h = w / 4
  for (const sx of [-0.3, 0.3]) solid(T, rect(x + sx * w, z - 0.45, 0.6, 0.6), y, y + 1.6 + h * 0.5, { lit: false, look: PLAIN })
  solid(T, rect(x, z - 0.25, w + 0.3, 0.4), y + 1.3, y + 1.5 + h + 0.1, { lit: false, look: PLAIN })
  city.neon.panel(v3(x, y + 1.5 + h / 2, z + 0.05), new THREE.Vector3(0, 0, 1), w, h, entry.uv, signLevel(entry))
}

/** What's on a roof: plant boxes, maybe a sign at the front, a mast with a beacon, beacons on the corners. */
function roofKit(T, x, z, w, d, y, { mast = 0.45, corners = 0.5, kit = true } = {}) {
  const r = T.r
  const config = T.config
  let front = z + d / 2
  if (T.band === 'mid' && w >= 16 && r() < 0.3) {
    roofSign(T, x, front - 1.2, Math.min(w - 2, between(r, 16, 26)), y)
    front -= 3
  }
  if (kit) {
    for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k += 1) {
      const bw = w * between(r, 0.15, 0.32)
      const bd = d * between(r, 0.15, 0.3)
      const back = z - d / 2
      const bz = between(r, back + bd / 2 + 0.5, Math.max(back + bd / 2 + 0.5, front - bd / 2 - 0.5))
      solid(T, rect(x + between(r, -0.35, 0.35) * (w - bw), bz, bw, bd), y, y + between(r, 1.5, 4.5), { lit: false })
    }
  }
  if (r() < mast) {
    const t = config.mast
    const top = y + between(r, config.mastH[0], config.mastH[1])
    const mx = x + between(r, -0.25, 0.25) * w
    const mz = z - between(r, 0, 0.3) * d
    solid(T, rect(mx, mz, t, t), y, top, { lit: false })
    beacon(T, mx, top + config.beacon * 0.8, mz)
  }
  if (r() < corners) {
    for (const sx of [-1, 1]) beacon(T, x + sx * (w / 2 - 0.5), y + 0.3 + config.beacon, z + d / 2 - 0.5)
  }
}

/** A roof garden on a terrace: planters along the front, small trees, blue uplights at their feet. */
function terrace(T, x0, x1, zFront, zBack, y) {
  if (T.band !== 'near' && T.band !== 'flank') return
  if (zFront - zBack < 2.6 || x1 - x0 < 5) return
  const r = T.r
  const city = T.city
  const rows = zFront - zBack > 7.5 ? 2 : 1
  for (let row = 0; row < rows; row += 1) {
    const pz = zFront - 1.3 - row * 4.2
    solid(T, rect((x0 + x1) / 2, pz, x1 - x0 - 1.2, 1.4), y, y + 0.7, { lit: false, look: PLAIN })
    for (let tx = x0 + 2 + r() * 1.5; tx < x1 - 1.6; tx += between(r, 3.2, 5)) {
      if (r() < 0.25) continue
      const trunk = between(r, 1.2, 2.4)
      solid(T, rect(tx, pz, 0.28, 0.28), y + 0.7, y + 0.7 + trunk, { lit: false, roof: false, look: TRUNK })
      city.trees.push({ x: tx, y: y + 0.7 + trunk, z: pz, crown: between(r, 1.1, 1.8), turn: r() * TAU, shade: r(), twin: r() < 0.6 })
      city.glows.add(tx, y + 0.78, pz + 0.75, glowing('#3d6bff', 0.32), 0.6)
      city.glows.add(tx, y + 1.4, pz + 0.4, glowing('#3d6bff', 0.04), 3.2)
    }
  }
}

/** A plain slab, maybe with neon trim and a lit crown. */
function slab(T, x, z, w, d, h) {
  const foot = rect(x, z, w, d)
  solid(T, foot, 0, h, { walls: T.city.walls })
  trims(T, foot, 0, h)
  roofKit(T, x, z, w, d, h)
}

/** A stepped tower: two to four tiers, each set back from the street, leaving terraces in front. */
function setback(T, x, z, w, d, h) {
  const r = T.r
  const tiers = 2 + Math.floor(r() * 3)
  let tw = w
  let td = d
  let tz = z
  let y = 0
  for (let k = 0; k < tiers; k += 1) {
    const last = k === tiers - 1
    const y1 = last ? h : y + (h - y) * between(r, 0.4, 0.62)
    const foot = rect(x, tz, tw, td)
    solid(T, foot, y, y1, { walls: T.city.walls })
    trims(T, foot, y, y1, { outline: last ? 0.35 : 0.5, corners: k === 0 ? 0.3 : 0, band: 0.2, crown: last ? 0.2 : 0 })
    if (last) {
      roofKit(T, x, tz, tw, td, y1)
    } else {
      const nw = tw * between(r, 0.62, 0.85)
      const nd = td * between(r, 0.6, 0.82)
      const nz = tz - ((td - nd) / 2) * between(r, 0.4, 1)
      terrace(T, x - tw / 2, x + tw / 2, tz + td / 2, nz + nd / 2, y1)
      tw = nw
      td = nd
      tz = nz
    }
    y = y1
  }
}

/** A slender tower with a tapered crown and a mast. */
function spire(T, x, z, w, d, h) {
  const r = T.r
  const body = h * between(r, 0.7, 0.82)
  const foot = r() < 0.35 ? ngon(x, z, Math.min(w, d) / 2, 8) : rect(x, z, w, d)
  solid(T, foot, 0, body, { walls: T.city.walls })
  solid(T, foot, body, h, { shrink: between(r, 0.72, 0.9) })
  trims(T, foot, 0, body, { outline: 0.5, corners: 0.25, band: 0.3, crown: 0 })
  const t = T.config.mast
  const tip = h + between(r, 6, 22) * (T.band === 'far' ? 1.6 : 1)
  solid(T, rect(x, z, t, t), h, tip, { lit: false })
  beacon(T, x, tip + T.config.beacon * 0.8, z)
}

/** A tower with a sloped roof and a neon edge along the slope. */
function wedge(T, x, z, w, d, h) {
  const r = T.r
  const alongX = r() < 0.55
  const span = alongX ? w : d
  const rise = Math.min(h / 4, (span / 2) * Math.tan(between(r, 0.35, 0.6)))
  const slope = rise / (span / 2)
  const tilt = alongX ? [slope * (r() < 0.5 ? 1 : -1), 0] : [0, slope]
  const foot = rect(x, z, w, d)
  const top = solid(T, foot, 0, h - rise, { tilt, walls: T.city.walls })
  const color = glowing(T.neon, 1.15)
  // The lit edge along the street side of the slope (or along its high edge when it slopes toward the street).
  const off = T.config.trim / 2 + 0.08
  T.city.neon.bar(v3(top[3].x, top[3].y + 0.1, top[3].z + off), v3(top[2].x, top[2].y + 0.1, top[2].z + off), T.config.trim, color)
  trims(T, foot, 0, Math.min(top[0].y, top[1].y, top[2].y, top[3].y), { outline: 0, corners: 0.3, band: 0.4, crown: 0 })
  // The beacon sits on the roof's high edge, half a metre in (down the slope) from its middle, and
  // 0.3 m clear of the roof under it like the beacons on flat roofs.
  const high = Math.max(top[0].y, top[1].y, top[2].y, top[3].y)
  const ridge = top.filter(q => q.y > high - 1e-3)
  const rx = ridge.reduce((sum, q) => sum + q.x, 0) / ridge.length
  const rz = ridge.reduce((sum, q) => sum + q.z, 0) / ridge.length
  const inward = Math.hypot(x - rx, z - rz) || 1
  if (r() < 0.6) beacon(T, rx + ((x - rx) / inward) * 0.5, high - 0.5 * slope + 0.3 + T.config.beacon, rz + ((z - rz) / inward) * 0.5)
}

/** A round tower (twelve-sided), sometimes with a narrower upper drum, often a neon ring at the top. */
function drum(T, x, z, w, d, h) {
  const r = T.r
  const radius = Math.min(w, d) / 2
  const split = r() < 0.5 ? h * between(r, 0.55, 0.75) : h
  const foot = ngon(x, z, radius, 12)
  solid(T, foot, 0, split, { walls: T.city.walls })
  let topFoot = foot
  let topRadius = radius
  if (split < h) {
    topRadius = radius * 0.72
    topFoot = ngon(x, z - radius * 0.15, topRadius, 12)
    solid(T, topFoot, split, h)
  }
  const color = glowing(T.neon, 1.15)
  if (r() < 0.6) for (const e of edges(topFoot)) edgeTube(T, e, h - 1.2, color)
  if (split < h && r() < 0.5) for (const e of edges(foot)) edgeTube(T, e, split + T.config.trim / 2, color)
  roofKit(T, x, split < h ? z - radius * 0.15 : z, topRadius * 1.2, topRadius * 1.2, h, { corners: 0 })
}

/** Twin towers joined by sky bridges. */
function twin(T, x, z, w, d, h) {
  const r = T.r
  const gap = between(r, 5, 9)
  const tw = (w - gap) / 2
  const h2 = h * between(r, 0.72, 0.9)
  const left = rect(x - (gap + tw) / 2, z, tw, d)
  const right = rect(x + (gap + tw) / 2, z - d * 0.05, tw, d * 0.9)
  solid(T, left, 0, h, { walls: T.city.walls })
  solid(T, right, 0, h2, { walls: T.city.walls })
  for (const f of [0.55, 0.8]) solid(T, rect(x, z - d * 0.05, gap + 1, 6), h2 * f, h2 * f + 4.5, { bottom: true })
  trims(T, left, 0, h, { crown: 0.3 })
  trims(T, right, 0, h2, { crown: 0 })
  roofKit(T, x - (gap + tw) / 2, z, tw, d, h)
  roofKit(T, x + (gap + tw) / 2, z - d * 0.05, tw, d * 0.9, h2, { mast: 0.2 })
}

/** A far tower turned off the grid: windows, a tapered top now and then, a beacon. */
function turned(T, x, z, w, d, h, turn) {
  const r = T.r
  const foot = rect(x, z, w, d, turn)
  if (r() < 0.4) {
    const body = h * 0.82
    solid(T, foot, 0, body)
    solid(T, foot, body, h, { shrink: between(r, 0.5, 0.8) })
  } else {
    solid(T, foot, 0, h)
  }
  beacon(T, x, h + T.config.beacon * 2, z)
}

const BUILD = { slab, setback, spire, wedge, drum, twin }

// ------------------------------------------------------------------ the bands

/**
 * Takes a footprint if it is free, keeps out of the office's clear zone (with a margin) and stays
 * inside the backdrop haze. Leaves a small alley around what it takes.
 */
function claim(city, x0, z0, x1, z1, gap = 1.5) {
  if (x0 < city.extent + 11 && x1 > -11 && z0 < 31 && z1 > -13) return false
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) if (Math.hypot(x - city.cx, z - FOCUS_Z) > TOWER_R) return false
  for (const t of city.taken) if (x0 < t[2] && x1 > t[0] && z0 < t[3] && z1 > t[1]) return false
  city.taken.push([x0 - gap, z0 - gap, x1 + gap, z1 + gap])
  return true
}

/**
 * The vista: a corridor straight north of the office where the near band stays low (garden podiums)
 * and the mid band leaves a gap, so the camera looks out over roof gardens to the far city, as the
 * view down the middle of a night-time city in anime does. Says whether the span [x0, x1] reaches into it.
 */
function inVista(city, x0, x1, half = Math.min(16, Math.max(8, city.extent * 0.3))) {
  return Math.min(x1, city.cx + half) - Math.max(x0, city.cx - half) > 0
}

/** A shop podium along the street side of a near tower: shopfronts, a neon fascia, light spilling into the wet air. */
function podium(T, x0, x1, front, depth, height) {
  const city = T.city
  const r = T.r
  solid(T, rect((x0 + x1) / 2, front - depth / 2, x1 - x0, depth), 0, height, { walls: city.walls, tag: 'podium' })
  // Shopfronts, a few centimetres proud of the wall, in pieces of up to 24 m (the atlas strip's length).
  const strip = oneOf(r, city.atlas.shop)
  for (let s = x0 + 0.5; s < x1 - 0.6; s += 24) {
    const w = Math.min(24, x1 - 0.5 - s)
    const share = w / 24
    const start = r() * (1 - share)
    const [u0, v0, u1, v1] = strip.uv
    const a = u0 + (u1 - u0) * start
    const b = u0 + (u1 - u0) * (start + share)
    city.neon.panel(v3(s + w / 2, 1.85, front + 0.08), new THREE.Vector3(0, 0, 1), w, 3, [a, v0, b, v1], new THREE.Color(1, 1, 1))
  }
  const color = glowing(T.neon, 1.15)
  const off = T.config.trim / 2 + 0.08
  city.neon.bar(v3(x0, 3.75, front + off), v3(x1, 3.75, front + off), T.config.trim, color)
  city.glows.add((x0 + x1) / 2, 2.6, front + 2.5, glowing(T.neon, 0.06), Math.min(16, x1 - x0))
}

/** The near band: towers 25-95 m, most on shop podiums with roof gardens; low garden podiums in the vista. */
function nearBand(city) {
  let x = -84
  for (let i = 0; x < city.extent + 84; i += 1) {
    const r = stream(`skyline-near:${i}`)
    const width = between(r, 10, 20)
    const T = newTower(city, 'near', r)
    const h = 25 + r() ** 1.3 * 70
    const kind = weightedOf(r, [['slab', 3], ['setback', 4], ['spire', 1.5], ['wedge', 1.5], ['drum', 1]])
    const vista = inVista(city, x, x + width)
    if (vista || r() < 0.62) {
      const front = -14 - between(r, 0, 1.2)
      const depth = Math.min(between(r, 13, 19.5), front + 34)
      if (claim(city, x, front - depth, x + width, front)) {
        const ph = vista ? between(r, 5, 9) : between(r, 6, 13)
        podium(T, x, x + width, front, depth, ph)
        if (vista) {
          // A roof garden over the whole podium: the foreground of the view north.
          terrace(T, x + 0.6, x + width - 0.6, front, front - depth + 1, ph)
        } else {
          const tw = width * between(r, 0.62, 0.92)
          const td = between(r, 9, depth - 4)
          const tz = front - depth + td / 2 + 0.5
          const before = city.walls.length
          // Off centre, but never flush with the podium's side wall (at least 8 cm in): no fighting faces.
          BUILD[kind](T, x + width / 2 + (between(r, -0.8, 0.8) * (width - tw)) / 2, tz, tw, td, h)
          for (const wall of city.walls.slice(before)) wall.y0 = Math.max(wall.y0, ph)
          terrace(T, x + 0.6, x + width - 0.6, front, tz + td / 2, ph)
        }
      }
    } else {
      const d = between(r, 10, 18)
      const z = between(r, -34 + d / 2, -14 - d / 2)
      if (claim(city, x, z - d / 2, x + width, z + d / 2)) BUILD[kind](T, x + width / 2, z, width, d, h)
    }
    x += width + between(r, 1.5, 4)
  }
}

/** A cluster of thin needle towers with pointed tips and beacons, in the mid band. */
function needles(city, x, z) {
  const r = stream('skyline-needles')
  if (!claim(city, x - 10, z - 10, x + 10, z + 10)) return
  const T = newTower(city, 'mid', r)
  T.mass = city.masses[TEX.gridCool]
  const color = glowing('#2bf3ff', 1.15)
  for (const [dx, dz] of [[0, 0], [-6.5, 3], [6, 2.5], [-3, -6], [4.5, -5.5]]) {
    const radius = between(r, 1.9, 3)
    const h = between(r, 120, 200)
    const foot = ngon(x + dx, z + dz, radius, 6)
    solid(T, foot, 0, h - 22)
    solid(T, foot, h - 22, h, { shrink: 1 })
    const e = edges(foot)[1]
    city.neon.bar(v3(e.ax + e.nx * 0.4, 20, e.az + e.nz * 0.4), v3(e.ax + e.nx * 0.4, h - 24, e.az + e.nz * 0.4), T.config.trim, color)
    beacon(T, x + dx, h + 0.6, z + dz)
  }
}

/** The mid band: three rows of towers 60-190 m with spires, setbacks, masts and rooftop signs. */
function midBand(city) {
  needles(city, city.cx + 46, -88)
  for (const [row, zMin, zMax, start, tall] of [['a', -62, -45, -170, 0.8], ['b', -81, -63, -164, 0.92], ['c', -100, -82, -158, 1]]) {
    let x = start
    for (let i = 0; x < city.extent + 170; i += 1) {
      const r = stream(`skyline-mid:${row}:${i}`)
      const w = between(r, 11, 26)
      const d = between(r, 10, zMax - zMin - 1)
      const z = between(r, zMin + d / 2, zMax - d / 2)
      const h = Math.max(60, (60 + r() ** 1.25 * 130) * tall)
      const kind = weightedOf(r, [['slab', 2], ['setback', 3], ['spire', 2], ['wedge', 1.5], ['drum', 1.5], ['twin', w > 18 ? 1 : 0]])
      const T = newTower(city, 'mid', r)
      const gap = row !== 'c' && inVista(city, x, x + w, 8)
      if (!gap && claim(city, x, z - d / 2, x + w, z + d / 2)) BUILD[kind](T, x + w / 2, z, w, d, h)
      x += w + between(r, 1.5, 5)
    }
  }
}

/** A generic stepped megastructure: six tiers with amber-lit lips and a slim crown. */
function ziggurat(city, x, z) {
  const r = stream('skyline-ziggurat')
  if (!claim(city, x - 50, z - 35, x + 50, z + 35)) return
  const T = newTower(city, 'far', r)
  T.mass = city.masses[TEX.bands]
  T.look.glow.setScalar(1.7)
  const lip = glowing('#ffb02b', 1.15)
  let w = 100
  let d = 70
  let y = 0
  for (let k = 0; k < 6; k += 1) {
    const h = 30 - k * 1.6
    const foot = rect(x, z, w, d)
    solid(T, foot, y, y + h)
    for (const e of edges(foot)) if (e.nz > -0.5) edgeTube(T, e, y + h + T.config.trim / 2, lip)
    for (const sx of [-1, 1]) beacon(T, x + sx * (w / 2 - 1), y + h + 1.2, z + d / 2 - 1)
    y += h
    w -= 13
    d -= 9
  }
  const core = rect(x, z, 12, 10)
  solid(T, core, y, y + 34)
  solid(T, core, y + 34, y + 48, { shrink: 0.7 })
  solid(T, rect(x, z, 1, 1), y + 48, y + 80, { lit: false })
  beacon(T, x, y + 81, z)
}

/** A generic arcology: an eight-sided podium carrying three linked towers and a ring of light. */
function arcology(city, x, z) {
  const r = stream('skyline-arcology')
  if (!claim(city, x - 35, z - 35, x + 35, z + 35)) return
  const T = newTower(city, 'far', r)
  T.mass = city.masses[TEX.mosaic]
  T.look.glow.setScalar(1.6)
  const cyan = glowing('#2bf3ff', 1.15)
  const magenta = glowing('#ff2bd6', 1.15)
  const base = ngon(x, z, 34, 8)
  solid(T, base, 0, 42)
  for (const e of edges(base)) edgeTube(T, e, 42.5, cyan)
  const drumFoot = ngon(x - 12, z - 4, 11, 10)
  solid(T, drumFoot, 42, 235)
  for (const e of edges(ngon(x - 12, z - 4, 12.2, 10))) edgeTube(T, e, 228, cyan)
  const slabFoot = rect(x + 14, z - 6, 16, 14)
  solid(T, slabFoot, 42, 195)
  for (const e of edges(slabFoot)) edgeTube(T, e, 195.5, magenta)
  const third = rect(x + 1, z + 13, 14, 10)
  solid(T, third, 42, 170, { tilt: [0.25, 0] })
  // Sky bridges: two from the drum to the slab, one from the slab to the third tower.
  for (const [bx, bz, bw, bd, y] of [[x + 2.5, z - 5, 13, 6, 120], [x + 2.5, z - 5, 13, 6, 160], [x + 7, z + 4.5, 6, 13, 100]]) {
    solid(T, rect(bx, bz, bw, bd), y, y + 5, { bottom: true })
  }
  solid(T, rect(x - 12, z - 4, 1.2, 1.2), 235, 270, { lit: false })
  beacon(T, x - 12, 271, z - 4)
  beacon(T, x + 14, 197, z - 6)
  for (const [bx, bz] of base.filter((_, k) => k % 2 === 0)) beacon(T, bx, 43.5, bz)
}

/** The far band: five rows of towers 90-280 m, mostly silhouettes in the haze with window speckle. */
function farBand(city) {
  ziggurat(city, city.cx - 45, -172)
  arcology(city, city.cx + 72, -168)
  const rows = [['a', -140, -120], ['b', -162, -141], ['c', -185, -163], ['d', -208, -186], ['e', -230, -209]]
  rows.forEach(([row, zMin, zMax], k) => {
    let x = -300 + k * 9
    for (let i = 0; x < city.extent + 300; i += 1) {
      const r = stream(`skyline-far:${row}:${i}`)
      const w = between(r, 14, 36)
      const d = between(r, 12, zMax - zMin - 1)
      const z = between(r, zMin + d / 2, zMax - d / 2)
      const h = 90 + r() ** 1.2 * 190
      const T = newTower(city, 'far', r)
      const turn = r() < 0.3 ? between(r, -0.4, 0.4) : 0
      const reach = turn ? (Math.abs(Math.cos(turn)) * w + Math.abs(Math.sin(turn)) * d) / 2 : w / 2
      const deep = turn ? (Math.abs(Math.sin(turn)) * w + Math.abs(Math.cos(turn)) * d) / 2 : d / 2
      const mx = x + w / 2
      if (claim(city, mx - reach, z - deep, mx + reach, z + deep)) {
        if (turn) turned(T, mx, z, w, d, h, turn)
        else BUILD[weightedOf(r, [['slab', 3], ['setback', 2.5], ['spire', 1.5], ['wedge', 1], ['drum', 1.5]])](T, mx, z, w, d, h)
      }
      x += w + between(r, 2, 8)
    }
  })
}

/**
 * Low blocks in the gaps between the towers of each band: the lower floors are what the camera sees
 * most, so the streets between the towers fill with lit windows and shop podiums.
 */
function fill(city) {
  const zones = [
    ['near', -34, -14, -84, 84, 6, 22, 260],
    ['mid', -100, -40, -170, 170, 10, 40, 420],
    ['far', -232, -118, -300, 300, 18, 70, 520],
  ]
  for (const [band, zMin, zMax, xFrom, xTo, hMin, hMax, tries] of zones) {
    const r = stream(`skyline-fill:${band}`)
    for (let k = 0; k < tries; k += 1) {
      const w = between(r, 7, 16)
      const d = between(r, 7, 14)
      const x = between(r, xFrom, city.extent + xTo)
      const z = between(r, zMin + d / 2, zMax - d / 2)
      const low = band !== 'far' && inVista(city, x - w / 2, x + w / 2, band === 'mid' ? 8 : undefined)
      const h = low ? between(r, hMin, Math.min(hMax, band === 'near' ? 9 : 22)) : between(r, hMin, hMax)
      if (!claim(city, x - w / 2, z - d / 2, x + w / 2, z + d / 2, 1)) continue
      const T = newTower(city, band, r)
      if (band === 'near' && r() < 0.7) {
        podium(T, x - w / 2, x + w / 2, z + d / 2, d, h)
        if (h < 14) terrace(T, x - w / 2 + 0.6, x + w / 2 - 0.6, z + d / 2, z - d / 2 + 1, h)
      } else {
        slab(T, x, z, w, d, h)
      }
    }
  }
}

/** The flank bands either side of the office: two columns of towers 20-70 m facing it, signs turned inward. */
function flanks(city) {
  for (const side of [-1, 1]) {
    for (const [col, inner, outer, hMin, hMax] of [[0, 12, 28, 20, 45], [1, 30, 46, 35, 70]]) {
      let z = -10
      for (let i = 0; z < 18; i += 1) {
        const r = stream(`skyline-flank:${side}:${col}:${i}`)
        const d = between(r, 8, 14)
        if (z + d > 18) break
        const w = between(r, 10, outer - inner)
        const x = side < 0 ? -inner - w / 2 : city.extent + inner + w / 2
        const T = newTower(city, 'flank', r)
        const kind = weightedOf(r, [['slab', 3], ['setback', 3], ['wedge', 1], ['drum', 0.6]])
        if (claim(city, x - w / 2, z, x + w / 2, z + d, 1)) BUILD[kind](T, x, z + d / 2, w, d, between(r, hMin, hMax))
        z += d + between(r, 2, 4)
      }
    }
  }
}

/** Past the flanks, to west and east: more towers 40-140 m, so the city carries on when the camera turns. */
function outerFlanks(city) {
  for (const side of [-1, 1]) {
    for (let gz = -100; gz < 20; gz += 30) {
      for (let k = 0; k < 4; k += 1) {
        const r = stream(`skyline-outer:${side}:${gz}:${k}`)
        if (r() > 0.78) continue
        const w = between(r, 12, 24)
        const d = between(r, 12, 24)
        const x = side < 0 ? -80 - k * 30 - between(r, w / 2, 30 - w / 2) : city.extent + 80 + k * 30 + between(r, w / 2, 30 - w / 2)
        const z = gz + between(r, d / 2, 30 - d / 2)
        const T = newTower(city, 'outer', r)
        const kind = weightedOf(r, [['slab', 3], ['setback', 2], ['spire', 1], ['wedge', 1], ['drum', 1]])
        if (claim(city, x - w / 2, z - d / 2, x + w / 2, z + d / 2)) BUILD[kind](T, x, z, w, d, between(r, 40, 140))
      }
    }
  }
}

// ------------------------------------------------------------------ signs

/** How bright a sign's picture shows: neon just past the glow threshold, lightboxes just under it. */
function signLevel(entry) {
  const frame = luma(new THREE.Color(entry.frame))
  if (entry.box) return new THREE.Color(1, 1, 1).multiplyScalar(0.7 / frame)
  const k = Math.min(3.6, Math.max(1.6, 0.95 / Math.min(frame, luma(new THREE.Color(entry.ink)))))
  return new THREE.Color(k, k, k)
}

/**
 * A sign on a wall: a dark backing box with the atlas picture on its face, standing proud of the wall
 * and of any neon tube running across it (the tubes pass behind the box, never through the picture).
 */
function mountSign(T, wall, along, y0, w, h, entry) {
  const nx = wall.nx
  const nz = wall.nz
  const back = T.config.trim + 0.22
  const face = T.config.trim + 0.3
  const mx = wall.ax + wall.dx * (along + w / 2)
  const mz = wall.az + wall.dz * (along + w / 2)
  const tx = wall.dx * (w / 2 + 0.12)
  const tz = wall.dz * (w / 2 + 0.12)
  const foot = [[mx - tx + nx * 0.02, mz - tz + nz * 0.02], [mx + tx + nx * 0.02, mz + tz + nz * 0.02], [mx + tx + nx * back, mz + tz + nz * back], [mx - tx + nx * back, mz - tz + nz * back]]
  solid(T, foot, y0 - 0.12, y0 + h + 0.12, { lit: false, look: PLAIN })
  const centre = v3(mx + nx * face, y0 + h / 2, mz + nz * face)
  T.city.neon.panel(centre, new THREE.Vector3(nx, 0, nz), w, h, entry.uv, signLevel(entry))
  return centre
}

/** Signs on the walls that face the office: tall katakana signs, podium name boards and emblems; the nearest light the rain. */
function placeSigns(city, lightSpots) {
  const r = stream('skyline-signs')
  const atlas = city.atlas
  const lit = []
  let vertical = 0
  let roof = 0
  let emblem = 0
  for (const wall of city.walls) {
    const band = wall.T.band
    if (band !== 'near' && band !== 'mid' && band !== 'flank') continue
    const inward = band === 'flank' && Math.abs(wall.nx) > 0.95 && Math.sign(wall.nx) === (wall.ax < city.cx ? 1 : -1)
    if (wall.nz < 0.95 && !inward) continue
    const room = wall.y1 - wall.y0
    const roll = r()
    if (wall.tag === 'podium') {
      // A name board above the shops, or an emblem.
      if (room >= 7.2 && wall.len > 9 && roll < 0.55) {
        const entry = atlas.roof[roof++ % atlas.roof.length]
        const w = Math.min(wall.len - 2, between(r, 7, 11))
        const at = mountSign(wall.T, wall, between(r, 1, wall.len - 1 - w), 4.3, w, w / 4, entry)
        lit.push({ at, entry, radius: 9 })
      }
      continue
    }
    if (roll < (band === 'mid' ? 0.3 : 0.5) && wall.len >= 6) {
      const entry = atlas.vertical[vertical++ % atlas.vertical.length]
      let w = band === 'mid' ? between(r, 4.5, 6) : between(r, 2.4, 3.2)
      const lift = band === 'mid' ? between(r, 4, 14) : between(r, 2.5, 6)
      if (room < lift + w * 4 + 1) w = (room - lift - 1) / 4
      if (w >= 2.2 && wall.len >= w + 2.4) {
        const along = r() < 0.5 ? 1.2 : wall.len - 1.2 - w
        const at = mountSign(wall.T, wall, along, wall.y0 + lift, w, w * 4, entry)
        if (band !== 'mid') lit.push({ at, entry, radius: w * 4 * 0.9 + 4 })
        continue
      }
    }
    if (roll < 0.72 && band !== 'mid' && wall.len >= 5 && room >= 7) {
      const entry = atlas.emblem[emblem++ % atlas.emblem.length]
      const w = between(r, 2.4, 3.4)
      const at = mountSign(wall.T, wall, between(r, 0.8, wall.len - 0.8 - w), wall.y0 + between(r, 3, Math.min(9, room - w - 1)), w, w, entry)
      lit.push({ at, entry, radius: 6 })
    }
  }
  // The signs nearest the office light the rain that falls past them.
  const centre = v3(city.cx, 0, FOCUS_Z)
  lit.sort((a, b) => a.at.distanceTo(centre) - b.at.distanceTo(centre))
  for (const { at, entry, radius } of lit.slice(0, 10)) {
    const facing = at.clone()
    lightSpots?.push({ position: facing, color: new THREE.Color(entry.box ? entry.frame : entry.ink), radius })
  }
}

// ------------------------------------------------------------------ beyond the towers

/** The sea of city lights to the horizon: lamps along avenues and streets, lit windows by district, raised roads. */
function citySea(city) {
  const r = stream('skyline-sea')
  const sea = city.sea
  const cx = city.cx
  const inside = (x, z) => {
    const dx = x - cx
    const dz = z - FOCUS_Z
    const d = Math.hypot(dx, dz)
    return d >= SEA_R0 && d <= SEA_R1 && dz < 0 && Math.abs(Math.atan2(dx, -dz)) <= SEA_ARC
  }
  const ph = Array.from({ length: 5 }, () => r() * TAU)
  const density = (x, z) =>
    0.5 + 0.3 * Math.sin(x * 0.012 + ph[0]) * Math.sin(z * 0.016 + ph[1]) + 0.2 * Math.sin((x - z) * 0.021 + ph[2]) + 0.12 * Math.sin(x * 0.05 + ph[3]) * Math.cos(z * 0.044 + ph[4])
  // A quarter of the dim lights shimmer a little in the wet air, slowly (periods of 4 to 12 s).
  const shimmer = () => (r() < 0.25 ? [r() * TAU, speedOf(r, 0.5, 1.4), 0.2, 0] : NO_FOG)
  const x0 = cx - SEA_R1
  const x1 = cx + SEA_R1
  const z0 = FOCUS_Z - SEA_R1
  const z1 = FOCUS_Z - SEA_R0 * Math.cos(SEA_ARC)
  const lamp = (x, y, z) => {
    if (inside(x, z) && density(x, z) > 0.2) sea.add(x, y, z, glowing('#ffb45c', between(r, 0.45, 0.7)), 0.8, shimmer())
  }
  for (let x = x0; x < x1; x += between(r, 24, 40)) for (let z = z0; z < z1; z += between(r, 7, 10)) lamp(x + between(r, -0.5, 0.5), 6, z)
  for (let z = z0; z < z1; z += between(r, 18, 32)) for (let x = x0; x < x1; x += between(r, 7, 10)) lamp(x, 6, z + between(r, -0.5, 0.5))
  // Windows and courtyards: thick in the busy districts, thin over the dark ones; a few much brighter.
  let placed = 0
  for (let tries = 0; placed < 12000 && tries < 120000; tries += 1) {
    const x = between(r, x0, x1)
    const z = between(r, z0, z1)
    if (!inside(x, z) || r() > density(x, z)) continue
    const bright = r() < 0.03
    const hex = weightedOf(r, SEA_COLORS)
    if (bright) sea.add(x, 1 + r() ** 2 * 30, z, glowing(hex, between(r, 2.4, 3.6)), 1.2, NO_FOG)
    else sea.add(x, 1 + r() ** 2.2 * 38, z, glowing(hex, 0.18 + r() ** 2 * 0.6), between(r, 0.55, 1), shimmer())
    placed += 1
  }
  // Raised roads: two across the city and one running away north, with lamps and the lights of traffic.
  // `road(s)` gives the road's centre at distance s along it and the direction across it.
  const roads = [0, 1].map(() => {
    const z = FOCUS_Z - between(r, 300, 430)
    const bend = between(r, 15, 40)
    const phase = r() * TAU
    return { from: -SEA_R1, to: SEA_R1, at: s => [cx + s, z + Math.sin(s * 0.006 + phase) * bend, 0, 1] }
  })
  const north = { x: cx + between(r, -160, 160), bend: between(r, 15, 40), phase: r() * TAU }
  roads.push({ from: SEA_R0 - 10, to: SEA_R1, at: s => [north.x + Math.sin(s * 0.006 + north.phase) * north.bend, FOCUS_Z - s, 1, 0] })
  for (const road of roads) {
    for (let s = road.from; s < road.to; s += 6) {
      const [x, z, ax, az] = road.at(s)
      for (const side of [-5, 5]) {
        if (inside(x + ax * side, z + az * side)) sea.add(x + ax * side, 10, z + az * side, glowing('#ffd9a0', 0.7), 0.9, NO_FOG)
      }
      if (r() < 0.35) {
        const lane = r() < 0.5 ? -2 : 2
        const lx = x + ax * lane + az * 3
        const lz = z + az * lane + ax * 3
        if (inside(lx, lz)) sea.add(lx, 9.6, lz, lane < 0 ? glowing('#ff3b5c', 0.55) : glowing('#f4f1ff', 0.7), 0.6, NO_FOG)
      }
    }
  }
  // Light pooled over the busiest districts, warm and a little magenta.
  for (let k = 0, tries = 0; k < 40 && tries < 3000; tries += 1) {
    const x = between(r, x0, x1)
    const z = between(r, z0, z1)
    if (!inside(x, z) || density(x, z) < 0.55) continue
    city.glows.add(x, 8, z, glowing(oneOf(r, ['#ff8a3d', '#ff8a3d', '#ff7a4a', '#c04a8a']), between(r, 0.05, 0.1)), between(r, 70, 140), NO_FOG)
    k += 1
  }
}

/** Industrial flare stacks far out in the sea of lights: dark stacks with soft, pulsing flames (never flickering). */
function flareStacks(city) {
  const r = stream('skyline-flares')
  const T = newTower(city, 'far', r)
  T.mass = city.masses[TEX.speckleWarm]
  for (const [angle, radius] of [[-0.62, 300], [-0.4, 395], [0.46, 335], [0.66, 420]]) {
    const x = city.cx + Math.sin(angle) * radius
    const z = FOCUS_Z - Math.cos(angle) * radius
    const h = between(r, 48, 82)
    solid(T, ngon(x, z, 2.4, 8), 0, h, { lit: false })
    // The refinery around its foot: low lit blocks, tanks and work lights.
    for (let k = 0; k < 5; k += 1) solid(T, rect(x + between(r, -30, 30), z + between(r, -18, 18), between(r, 8, 18), between(r, 6, 14)), 0, between(r, 5, 16))
    for (let k = 0; k < 4; k += 1) solid(T, ngon(x + between(r, -26, 26), z + between(r, -16, 16), between(r, 4, 7), 10), 0, between(r, 6, 11), { lit: false })
    for (let k = 0; k < 30; k += 1) city.sea.add(x + between(r, -34, 34), between(r, 2, 18), z + between(r, -20, 20), glowing(oneOf(r, ['#ffb45c', '#fff1dc', '#ff8a3d']), between(r, 0.3, 0.6)), 0.5, NO_FOG)
    beacon(T, x, h + 0.8, z)
    // The flame: a white-hot core that always glows, a breathing orange flame, a slow wide plume of light.
    const phase = r() * TAU
    city.glows.add(x, h + 3, z, glowing('#fff2c0', 1.9), 4.5, [phase, speedOf(r, 2, 2.6), 0.22, 0.25])
    city.glows.add(x, h + 6, z, glowing('#ff8a2b', 1.2), 13, [phase + 0.7, speedOf(r, 1.3, 1.7), 0.32, 0.25])
    city.glows.add(x, h + 12, z, glowing('#ff5a1f', 0.16), 56, [phase + 1.4, speedOf(r, 0.6, 0.9), 0.25, 0.4])
  }
}

/**
 * Haze between the bands: three gradient curtains, densest low down. They are lit by the city, so
 * they lift the dark towers behind them toward lavender as well as dimming their windows: depth.
 * Returned back to front (the arc, then z -112, then z -39.5), one sheet each, so the light sprites of
 * each layer can be drawn between them.
 */
function haze(city) {
  const { extent, cx } = city
  const arc = (radius, half, steps) => Array.from({ length: steps + 1 }, (_, k) => {
    const a = -half + (2 * half * k) / steps
    return [cx + Math.sin(a) * radius, FOCUS_Z - Math.cos(a) * radius]
  })
  const sheet = (path, y0, y1, color, alpha) => {
    const s = new Sheet()
    s.curtain(path, y0, y1, onScreen(color), alpha)
    return s
  }
  return [
    sheet(arc(HAZE_R, THREE.MathUtils.degToRad(84), 48), -4, 170, '#7e5aa6', 0.45),
    sheet([[-200, HAZE_Z[0]], [extent + 200, HAZE_Z[0]]], -2, 130, '#6563aa', 0.6),
    sheet([[-84, HAZE_Z[1]], [extent + 84, HAZE_Z[1]]], -2, 70, '#6260a6', 0.5),
  ]
}

// ------------------------------------------------------------------ the module

/** Builds the skyline into `group` and returns its per-frame update. */
export function buildSkyline(group, ctx) {
  const extent = ctx.extent
  const renderer = ctx.renderer
  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4)
  const textures = KINDS.map(kind => windowTexture(kind, anisotropy))
  const atlas = signAtlas(anisotropy)
  const city = {
    extent,
    cx: extent / 2,
    masses: textures.map(() => new Mass()),
    atlas,
    neon: new Neon(atlas.white),
    glows: new Layered(extent / 2),
    sea: new Layered(extent / 2),
    beacons: [],
    trees: [],
    walls: [],
    taken: [],
  }

  farBand(city)
  midBand(city)
  nearBand(city)
  flanks(city)
  outerFlanks(city)
  fill(city)
  placeSigns(city, ctx.lightSpots)
  citySea(city)
  flareStacks(city)

  const owned = { geometries: new Set(), materials: new Set(), textures: [...textures, atlas.texture] }
  const add = (object, renderOrder = 0) => {
    object.renderOrder = renderOrder
    object.castShadow = false
    object.receiveShadow = false
    owned.geometries.add(object.geometry)
    owned.materials.add(object.material)
    group.add(object)
    return object
  }

  // Tower bodies: one mesh per window texture.
  city.masses.forEach((mass, i) => {
    if (!mass.empty) add(mass.mesh(towerMaterial(textures[i])))
  })

  // Neon tubes, signs and shopfronts.
  add(city.neon.mesh(new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, toneMapped: false })))

  // Aircraft beacons: instanced spheres. They read at any distance (fog off) and their halos carry the depth.
  const beacons = city.beacons
  const beaconMesh = add(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false }), Math.max(1, beacons.length)))
  const dummy = new THREE.Object3D()
  const phases = new Float32Array(beacons.length)
  const speeds = new Float32Array(beacons.length)
  beacons.forEach((b, i) => {
    dummy.position.set(b.x, b.y, b.z)
    dummy.scale.setScalar(b.size)
    dummy.updateMatrix()
    beaconMesh.setMatrixAt(i, dummy.matrix)
    beaconMesh.setColorAt(i, new THREE.Color(BEACON_RGB[0], BEACON_RGB[1], BEACON_RGB[2]))
    phases[i] = b.phase
    speeds[i] = b.speed
  })
  beaconMesh.count = beacons.length
  beaconMesh.instanceColor?.setUsage(THREE.DynamicDrawUsage)
  beaconMesh.computeBoundingSphere()

  // Roof-garden trees: low-poly crowns, one or two each.
  const crowns = city.trees.reduce((n, t) => n + (t.twin ? 2 : 1), 0)
  if (crowns) {
    const treeMesh = add(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), crowns))
    const greens = ['#1f3a2a', '#24442f', '#1a3326', '#2a4a34'].map(c => new THREE.Color(c))
    let k = 0
    for (const t of city.trees) {
      const put = (x, y, z, s) => {
        dummy.position.set(x, y, z)
        dummy.rotation.set(0, t.turn, 0)
        dummy.scale.set(s, s * 0.85, s)
        dummy.updateMatrix()
        treeMesh.setMatrixAt(k, dummy.matrix)
        treeMesh.setColorAt(k, greens[Math.floor(t.shade * greens.length)])
        k += 1
      }
      put(t.x, t.y + t.crown * 0.55, t.z, t.crown)
      if (t.twin) put(t.x + Math.cos(t.turn) * t.crown * 0.6, t.y + t.crown * 0.3, t.z + Math.sin(t.turn) * 0.3, t.crown * 0.7)
    }
    treeMesh.computeBoundingSphere()
  }

  // Light sprites and haze, interleaved back to front. The sprites write no depth, so a curtain drawn
  // after a sprite always lies over it: each layer's lights (the sea's and the halos') are drawn after
  // the curtains behind them and before the curtains in front. Render orders -7 to -1.
  const clock = { uTime: { value: 0 }, uScale: { value: 675 }, uFog: { value: 0.0045 } }
  const seaMaterial = spriteMaterial(clock, 4.5, 2)
  const glowMaterial = spriteMaterial(clock, 2.4, 2.5)
  const { noise, fade } = hazeTextures(anisotropy)
  owned.textures.push(noise, fade)
  const hazeMaterial = new THREE.MeshBasicMaterial({ map: noise, alphaMap: fade, vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false })
  const curtains = haze(city)
  for (let layer = 0; layer < 4; layer += 1) {
    const order = -7 + layer * 2
    const sea = city.sea.layers[layer]
    const glows = city.glows.layers[layer]
    if (sea.count) add(sea.mesh(seaMaterial), order)
    if (glows.count) add(glows.mesh(glowMaterial), order)
    if (layer < curtains.length) add(curtains[layer].mesh(hazeMaterial), order + 1)
  }

  const size = new THREE.Vector2()
  const colors = beaconMesh.instanceColor?.array
  return {
    /** Per frame: the clock, the screen scale and fog for the sprites, the beacons' breathing, the haze drifting. */
    update(dt, t) {
      const time = t % CLOCK
      clock.uTime.value = time
      if (renderer) clock.uScale.value = renderer.getDrawingBufferSize(size).y / 2
      const fog = ctx.scene?.fog
      clock.uFog.value = fog?.isFogExp2 ? fog.density : 0
      if (colors) {
        for (let i = 0; i < phases.length; i += 1) {
          const k = 1 - BEACON_DEPTH * (0.5 + 0.5 * Math.sin(time * speeds[i] + phases[i]))
          colors[i * 3] = BEACON_RGB[0] * k
          colors[i * 3 + 1] = BEACON_RGB[1] * k
          colors[i * 3 + 2] = BEACON_RGB[2] * k
        }
        beaconMesh.instanceColor.needsUpdate = true
      }
      // Nine whole texture widths per turn of the clock, so the drift wraps without a jump.
      noise.offset.x = (time * 9) / CLOCK
    },

    /** Frees the GPU copies of everything built here (call before a rebuild). */
    dispose() {
      for (const g of owned.geometries) g?.dispose()
      for (const m of owned.materials) m?.dispose()
      for (const tex of owned.textures) tex.dispose()
    },
  }
}
