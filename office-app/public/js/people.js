// The office's people: chunky toy figures with jointed limbs, a wardrobe of
// hair, hats, glasses and extras, and poses driven every frame.

import * as THREE from 'three'
import { ball, box, cyl, mat, put, rbox } from './models.js'
import { damp, hash, pick } from './util.js'

export const HIP = 0.86

export const SKINS = ['#f6d3b3', '#eebf98', '#d9a27a', '#b67a52', '#8d5a3b', '#f3c9a8', '#6b4430']
export const HAIR_COLORS = ['#2d2420', '#5a3b26', '#a0642f', '#e0b04f', '#c8452c', '#3b3f58', '#9a9a9a', '#e8e3d8', '#d6648b', '#3f7fd8']
export const SHIRTS = ['#3f7fd8', '#21a39a', '#8a5fd6', '#e4862a', '#3faa5c', '#e05a6a', '#f2c14e', '#2b2b2b', '#f4f1ea', '#5b6b7c', '#d97757', '#6fb3e8', '#ff2bd6', '#2bf3ff', '#1c1f26', '#c8ced8']
export const PANTS = ['#2f3b52', '#3d424b', '#5b4a3a', '#2b2b2b', '#6b7a8f', '#7a5a3a', '#c9b48f']
export const HAIRS = ['short', 'long', 'bun', 'spiky', 'curly', 'mohawk', 'bald']
export const HATS = ['none', 'cap', 'beanie', 'party', 'tophat', 'crown']
export const GLASSES = ['none', 'round', 'shades', 'visor']
export const EXTRAS = ['none', 'headphones', 'tie', 'bowtie', 'scarf']

/** The look a name starts with: the same name, the same person, every session. */
export function defaultLook(name, shirt) {
  const seed = hash(name)
  return {
    skin: pick(SKINS, seed),
    hair: pick(['short', 'long', 'bun', 'spiky', 'curly', 'short', 'long', 'mohawk', 'bald'], seed >> 3),
    hairColor: pick(HAIR_COLORS.slice(0, 8), seed >> 7),
    shirt: shirt ?? pick(SHIRTS, seed >> 11),
    pants: pick(PANTS, seed >> 13),
    hat: 'none',
    glasses: (seed >> 17) % 5 === 0 ? 'round' : 'none',
    extra: 'none',
  }
}

export const LEAD_LOOK = {
  skin: '#f3c9a8',
  hair: 'short',
  hairColor: '#3b2f2f',
  shirt: '#d97757',
  pants: '#3d424b',
  hat: 'none',
  glasses: 'none',
  extra: 'tie',
}

const capsules = new Map()
function capsule(r, length, color) {
  const key = `${r}|${length}`
  if (!capsules.has(key)) capsules.set(key, new THREE.CapsuleGeometry(r, length, 4, 10))
  const mesh = new THREE.Mesh(capsules.get(key), mat(color))
  mesh.castShadow = true
  return mesh
}

/** Builds a figure. Returns its joints so poses can move them, and `wear` to change clothes. */
export function buildPerson(look) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const hips = new THREE.Group()
  hips.position.y = HIP
  body.add(hips)
  const torso = new THREE.Group()
  hips.add(torso)
  const pelvis = put(torso, rbox(0.34, 0.17, 0.22, look.pants, 0.06), 0, 0.02, 0)
  const chest = put(torso, rbox(0.38, 0.46, 0.25, look.shirt, 0.09), 0, 0.28, 0)
  const neck = new THREE.Group()
  neck.position.y = 0.52
  torso.add(neck)
  const head = new THREE.Group()
  head.position.y = 0.23
  neck.add(head)
  const skull = put(head, ball(0.22, look.skin, undefined, 24), 0, 0, 0)
  const ears = [put(head, ball(0.05, look.skin), 0.215, 0, 0), put(head, ball(0.05, look.skin), -0.215, 0, 0)]
  const nose = put(head, ball(0.028, look.skin), 0, -0.025, 0.215)
  const eyes = [put(head, ball(0.031, '#232323'), 0.078, 0.03, 0.196), put(head, ball(0.031, '#232323'), -0.078, 0.03, 0.196)]
  put(head, box(0.065, 0.014, 0.012, '#8a3b2b'), 0, -0.085, 0.205)
  const cheeks = [put(head, ball(0.03, '#ef8f8f', { opacity: 0.45 }), 0.12, -0.04, 0.17), put(head, ball(0.03, '#ef8f8f', { opacity: 0.45 }), -0.12, -0.04, 0.17)]
  const hair = new THREE.Group()
  const hat = new THREE.Group()
  const glasses = new THREE.Group()
  head.add(hair, hat, glasses)
  const extra = new THREE.Group()
  torso.add(extra)
  const headExtra = new THREE.Group()
  head.add(headExtra)

  const legs = [1, -1].map(side => {
    const hip = new THREE.Group()
    hip.position.set(side * 0.1, 0, 0)
    hips.add(hip)
    const thigh = put(hip, capsule(0.078, 0.26, look.pants), 0, -0.2, 0)
    const knee = new THREE.Group()
    knee.position.y = -0.42
    hip.add(knee)
    const shin = put(knee, capsule(0.07, 0.24, look.pants), 0, -0.19, 0)
    const shoe = put(knee, rbox(0.13, 0.08, 0.25, '#2b2b2b', 0.035), 0, -0.4, 0.04)
    return { hip, knee, thigh, shin, shoe }
  })
  const arms = [1, -1].map(side => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * 0.245, 0.44, 0)
    torso.add(shoulder)
    const upper = put(shoulder, capsule(0.064, 0.15, look.shirt), 0, -0.12, 0)
    const elbow = new THREE.Group()
    elbow.position.y = -0.26
    shoulder.add(elbow)
    const fore = put(elbow, capsule(0.056, 0.14, look.skin), 0, -0.11, 0)
    const hand = put(elbow, ball(0.066, look.skin), 0, -0.25, 0)
    return { shoulder, elbow, upper, fore, hand }
  })

  // What a right hand can hold.
  const props = {}
  const grip = new THREE.Group()
  grip.position.set(0, -0.27, 0.03)
  arms[1].elbow.add(grip)
  props.mug = put(grip, cyl(0.05, 0.045, 0.1, '#ffffff'), 0, 0, 0.04)
  props.book = put(grip, rbox(0.2, 0.26, 0.04, '#d65a5a', 0.01), 0.08, 0.02, 0.08)
  props.book.rotation.set(-1.1, 0, 0)
  props.paddle = new THREE.Group()
  put(props.paddle, cyl(0.1, 0.1, 0.02, '#d64545', 18), 0, -0.04, 0.1).rotation.x = Math.PI / 2
  put(props.paddle, box(0.03, 0.1, 0.03, '#7a4f33'), 0, 0.03, 0.05)
  grip.add(props.paddle)
  props.phone = put(grip, rbox(0.06, 0.12, 0.015, '#23262d', 0.008), 0, 0.02, 0.05)
  props.bag = put(grip, rbox(0.22, 0.2, 0.08, '#e05a6a', 0.02), 0, -0.1, 0.02)
  props.slice = put(grip, cyl(0.13, 0.13, 0.02, '#f6c445', 3), 0.02, 0.02, 0.1)
  props.slice.rotation.set(Math.PI / 2, 0, 0)
  for (const prop of Object.values(props)) prop.visible = false

  const model = {
    root,
    body,
    hips,
    torso,
    neck,
    head,
    legs,
    arms,
    eyes,
    props,
    parts: { pelvis, chest, skull, ears, nose, cheeks, hair, hat, glasses, extra, headExtra },
    look: null,
    blink: Math.random() * 4,
  }
  wear(model, look)
  return model
}

/** Dresses a figure in a look: colours, hair, hat, glasses and extras. */
export function wear(model, look) {
  model.look = { ...look }
  const { parts, legs, arms } = model
  parts.chest.material = mat(look.shirt)
  parts.pelvis.material = mat(look.pants)
  for (const mesh of [parts.skull, parts.nose, ...parts.ears]) mesh.material = mat(look.skin)
  for (const leg of legs) {
    leg.thigh.material = mat(look.pants)
    leg.shin.material = mat(look.pants)
  }
  for (const arm of arms) {
    arm.upper.material = mat(look.shirt)
    arm.fore.material = mat(look.skin)
    arm.hand.material = mat(look.skin)
  }
  rebuild(parts.hair, () => hairStyle(parts.hair, look.hair, look.hairColor, look.hat !== 'none'))
  rebuild(parts.hat, () => hatStyle(parts.hat, look.hat))
  rebuild(parts.glasses, () => glassesStyle(parts.glasses, look.glasses))
  rebuild(parts.extra, () => extraStyle(parts.extra, look.extra === 'headphones' ? 'none' : look.extra))
  rebuild(parts.headExtra, () => look.extra === 'headphones' && headphones(parts.headExtra))
  model.root.traverse(o => {
    o.castShadow = o.isMesh
  })
}

function rebuild(group, fill) {
  for (const child of [...group.children]) group.remove(child)
  fill()
}

function hairStyle(group, style, color, hasHat) {
  if (style === 'bald') return
  const cap = put(group, ball(0.236, color, undefined, 20), 0, 0.065, -0.012)
  cap.scale.set(1, 0.66, 1.03)
  put(group, rbox(0.3, 0.07, 0.06, color, 0.03), 0, 0.15, 0.17).rotation.x = 0.35
  if (style === 'long') {
    put(group, rbox(0.44, 0.4, 0.16, color, 0.07), 0, -0.08, -0.13)
    put(group, rbox(0.08, 0.3, 0.18, color, 0.04), 0.2, -0.05, -0.02)
    put(group, rbox(0.08, 0.3, 0.18, color, 0.04), -0.2, -0.05, -0.02)
  }
  if (style === 'bun' && !hasHat) put(group, ball(0.1, color), 0, 0.24, -0.1)
  if (style === 'spiky' && !hasHat) {
    for (let i = 0; i < 7; i += 1) {
      const a = (i / 7) * Math.PI * 2
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.17, 6), mat(color))
      spike.position.set(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12 - 0.02)
      spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)
      group.add(spike)
    }
  }
  if (style === 'curly') {
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2
      put(group, ball(0.085, color, undefined, 10), Math.cos(a) * 0.16, 0.14 + (i % 2) * 0.05, Math.sin(a) * 0.16 - 0.03)
    }
  }
  if (style === 'mohawk' && !hasHat) put(group, rbox(0.06, 0.16, 0.38, color, 0.025), 0, 0.22, -0.03)
}

function hatStyle(group, style) {
  if (style === 'cap') {
    const top = put(group, ball(0.24, '#d64545', undefined, 18), 0, 0.09, 0)
    top.scale.set(1, 0.62, 1)
    put(group, rbox(0.24, 0.02, 0.17, '#d64545', 0.008), 0, 0.09, 0.22)
  }
  if (style === 'beanie') {
    const top = put(group, ball(0.24, '#3faa5c', undefined, 18), 0, 0.1, 0)
    top.scale.set(1, 0.78, 1)
    put(group, cyl(0.24, 0.24, 0.06, '#2e8a49', 20), 0, 0.05, 0)
    put(group, ball(0.06, '#f4f1ea'), 0, 0.3, 0)
  }
  if (style === 'party') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 14), mat('#8a5fd6'))
    cone.position.set(0.02, 0.33, 0)
    cone.rotation.z = -0.15
    group.add(cone)
    put(group, ball(0.045, '#f2c14e'), 0.045, 0.49, 0)
  }
  if (style === 'tophat') {
    put(group, cyl(0.27, 0.27, 0.02, '#1d1d1d', 24), 0, 0.17, 0)
    put(group, cyl(0.16, 0.17, 0.32, '#1d1d1d', 24), 0, 0.34, 0)
    put(group, cyl(0.172, 0.172, 0.05, '#c0392b', 24), 0, 0.21, 0)
  }
  if (style === 'crown') {
    const gold = { metal: 0.8, rough: 0.25 }
    put(group, cyl(0.17, 0.18, 0.1, '#e8b92e', 20, gold), 0, 0.22, 0)
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), mat('#e8b92e', gold))
      spike.position.set(Math.cos(a) * 0.16, 0.31, Math.sin(a) * 0.16)
      group.add(spike)
      put(group, ball(0.02, i % 2 ? '#d64545' : '#3f7fd8'), Math.cos(a) * 0.175, 0.22, Math.sin(a) * 0.175)
    }
  }
}

function glassesStyle(group, style) {
  if (style === 'round') {
    for (const x of [0.08, -0.08]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.011, 8, 18), mat('#23262d'))
      ring.position.set(x, 0.03, 0.212)
      group.add(ring)
    }
    put(group, box(0.06, 0.012, 0.012, '#23262d'), 0, 0.035, 0.215)
  }
  if (style === 'shades') {
    put(group, rbox(0.34, 0.075, 0.03, '#111111', 0.012, { rough: 0.2 }), 0, 0.035, 0.212)
  }
  if (style === 'visor') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.035, 8, 28, Math.PI * 0.9), mat('#2bf3ff', { emissive: '#2bf3ff', opacity: 0.85 }))
    band.rotation.set(Math.PI / 2, 0, Math.PI * 0.05)
    band.position.set(0, 0.035, 0.02)
    group.add(band)
  }
}

function extraStyle(group, style) {
  if (style === 'tie') {
    put(group, box(0.06, 0.05, 0.02, '#1f2f4f'), 0, 0.48, 0.13)
    put(group, box(0.07, 0.28, 0.02, '#1f2f4f'), 0, 0.31, 0.13)
  }
  if (style === 'bowtie') {
    put(group, rbox(0.08, 0.06, 0.03, '#c0392b', 0.01), 0.04, 0.48, 0.13).rotation.z = 0.3
    put(group, rbox(0.08, 0.06, 0.03, '#c0392b', 0.01), -0.04, 0.48, 0.13).rotation.z = -0.3
  }
  if (style === 'scarf') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.05, 10, 20), mat('#e4862a'))
    ring.position.set(0, 0.5, 0)
    ring.rotation.x = Math.PI / 2
    group.add(ring)
    put(group, rbox(0.08, 0.22, 0.04, '#e4862a', 0.02), 0.06, 0.38, 0.13)
  }
}

function headphones(group) {
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.022, 8, 24, Math.PI), mat('#23262d'))
  band.position.y = 0.02
  group.add(band)
  put(group, rbox(0.06, 0.12, 0.11, '#e05a6a', 0.03), 0.235, 0, 0)
  put(group, rbox(0.06, 0.12, 0.11, '#e05a6a', 0.03), -0.235, 0, 0)
}

const SPEED = 12

/**
 * Moves the joints toward the pose for this frame. `state.pose` names it;
 * `state.phase` is the walk cycle, advanced by the caller as the person moves.
 */
export function animate(model, state, t, dt) {
  const target = {
    bodyY: 0,
    hipY: HIP,
    lean: 0,
    twist: 0,
    headX: 0,
    headY: 0,
    legs: [
      [0, 0],
      [0, 0],
    ],
    arms: [
      [0.05, 0.08, -0.12],
      [0.05, -0.08, -0.12],
    ],
  }
  const { pose } = state
  const sitting = state.sitting
  const wave = (speed, offset = 0) => Math.sin(t * speed + offset)
  let fast = false

  if (sitting) {
    target.hipY = state.seatY + 0.06
    target.legs = [
      [-1.5, 1.45],
      [-1.5, 1.45],
    ]
  }
  if (pose === 'walk' || pose === 'hurry') {
    const p = state.phase
    const amount = pose === 'hurry' ? 0.8 : 0.55
    target.legs = [
      [Math.sin(p) * amount, Math.max(0, -Math.sin(p - 0.4)) * 1.0],
      [-Math.sin(p) * amount, Math.max(0, Math.sin(p - 0.4)) * 1.0],
    ]
    target.arms = [
      [-Math.sin(p) * 0.5, 0.1, -0.35],
      [Math.sin(p) * 0.5, -0.1, -0.35],
    ]
    target.bodyY = Math.abs(Math.sin(p)) * 0.035
    target.lean = pose === 'hurry' ? 0.12 : 0.03
    fast = true
  }
  if (pose === 'run') {
    const p = t * 11
    target.legs = [
      [Math.sin(p) * 0.85, Math.max(0, -Math.sin(p - 0.5)) * 1.5],
      [-Math.sin(p) * 0.85, Math.max(0, Math.sin(p - 0.5)) * 1.5],
    ]
    target.arms = [
      [-Math.sin(p) * 0.8, 0.1, -1.4],
      [Math.sin(p) * 0.8, -0.1, -1.4],
    ]
    target.bodyY = 0.12 + Math.abs(Math.sin(p)) * 0.06
    target.lean = 0.15
    fast = true
  }
  if (pose === 'type') {
    target.arms = [
      [-0.8, 0.12, -0.95 + wave(19) * 0.09],
      [-0.8, -0.12, -0.95 + wave(19, 1.7) * 0.09],
    ]
    target.headX = 0.08 + wave(0.7) * 0.04
    target.headY = wave(0.31) * 0.12
  }
  if (pose === 'talk' || pose === 'chat') {
    target.arms[1] = [-0.55 + wave(3.1) * 0.3, -0.15, -1.1 + wave(2.3) * 0.2]
    target.arms[0] = [-0.15 + wave(2.2, 1) * 0.15, 0.12, -0.4]
    target.headX = wave(5.5) * 0.06
    target.headY = wave(1.2) * 0.15
  }
  if (pose === 'listen') {
    target.arms = [
      [-0.35, 0.35, -1.5],
      [-0.35, -0.35, -1.5],
    ]
    target.headX = 0.05 + Math.max(0, wave(2.4)) * 0.12
  }
  if (pose === 'drink' || pose === 'eat') {
    const sip = Math.max(0, Math.sin(t * 1.4)) ** 3
    target.arms[1] = [-0.45 - sip * 0.55, -0.1, -1.3 - sip * 0.9]
    target.headX = -sip * 0.15
  }
  if (pose === 'read') {
    target.arms = [
      [-0.6, 0.15, -1.3],
      [-0.65, -0.15, -1.3],
    ]
    target.headX = 0.3
  }
  if (pose === 'pingpong') {
    const swing = Math.sin(t * 6.5)
    target.arms[1] = [-0.7 + swing * 0.55, -0.35 - swing * 0.2, -0.6]
    target.arms[0] = [-0.4, 0.2, -0.8]
    target.twist = swing * 0.25
    target.legs = [
      [-0.25, 0.45],
      [-0.25, 0.45],
    ]
    target.bodyY = -0.05 + Math.abs(swing) * 0.03
    fast = true
  }
  if (pose === 'arcade' || pose === 'foosball') {
    const jitter = wave(pose === 'arcade' ? 17 : 11) * 0.1
    target.arms = [
      [-1.05 + jitter, 0.1, -0.5],
      [-1.05 - jitter, -0.1, -0.5],
    ]
    target.twist = pose === 'foosball' ? wave(9) * 0.2 : 0
    target.headX = 0.08
  }
  if (pose === 'wave') {
    target.arms[1] = [-0.2, -2.5 + wave(11) * 0.3, -0.35]
    target.headY = 0.1
  }
  if (pose === 'cheer') {
    target.arms = [
      [-0.2, 2.6 + wave(9) * 0.15, -0.3],
      [-0.2, -2.6 - wave(9) * 0.15, -0.3],
    ]
    target.bodyY = Math.abs(Math.sin(t * 7)) * 0.13
    fast = true
  }
  if (pose === 'sleep') {
    target.headX = 0.45
    target.arms = [
      [-0.3, 0.15, -0.6],
      [-0.3, -0.15, -0.6],
    ]
    target.bodyY += Math.sin(t * 1.1) * 0.006
  }
  if (pose === 'sad') {
    target.headX = 0.35
    target.arms = [
      [0.05, 0.02, -0.05],
      [0.05, -0.02, -0.05],
    ]
  }
  if (pose === 'lean') {
    target.lean = -0.14
    target.arms = [
      [-0.55, -0.45, -1.7],
      [-0.55, 0.45, -1.7],
    ]
    target.headY = wave(0.4) * 0.25
  }
  if (pose === 'present') {
    target.arms[1] = [-1.45 + wave(1.8) * 0.2, -0.2, -0.2]
    target.headY = 0.2
  }
  if (pose === 'shop') {
    target.arms[1] = [-0.9 + wave(1.3) * 0.25, -0.2, -0.3]
    target.headY = wave(0.8) * 0.5
  }
  if (pose === 'phone') {
    target.arms[1] = [-0.4, -0.65, -2.35]
    target.headY = wave(0.6) * 0.2
  }
  if (pose === 'stand' || pose === 'idle') {
    target.bodyY = Math.sin(t * 1.8) * 0.006
    target.headY = wave(0.5) * 0.15
  }

  const k = fast ? 26 : SPEED
  model.body.position.y = damp(model.body.position.y, target.bodyY, k, dt)
  model.hips.position.y = damp(model.hips.position.y, target.hipY, 14, dt)
  model.torso.rotation.x = damp(model.torso.rotation.x, target.lean, SPEED, dt)
  model.torso.rotation.y = damp(model.torso.rotation.y, target.twist, k, dt)
  model.head.rotation.x = damp(model.head.rotation.x, target.headX, SPEED, dt)
  model.head.rotation.y = damp(model.head.rotation.y, target.headY, SPEED, dt)
  model.legs.forEach((leg, i) => {
    leg.hip.rotation.x = damp(leg.hip.rotation.x, target.legs[i][0], k, dt)
    leg.knee.rotation.x = damp(leg.knee.rotation.x, target.legs[i][1], k, dt)
  })
  model.arms.forEach((arm, i) => {
    arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, target.arms[i][0], k, dt)
    arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, target.arms[i][1], k, dt)
    arm.elbow.rotation.x = damp(arm.elbow.rotation.x, target.arms[i][2], k, dt)
  })

  const props = model.props
  props.mug.visible = pose === 'drink'
  props.book.visible = pose === 'read'
  props.paddle.visible = pose === 'pingpong'
  props.phone.visible = pose === 'phone'
  props.bag.visible = pose === 'shopped'
  props.slice.visible = pose === 'eat'

  model.blink -= dt
  const closed = pose === 'sleep' || model.blink < 0.12
  for (const eye of model.eyes) eye.scale.y = closed ? 0.15 : 1
  if (model.blink < 0) model.blink = 2.5 + Math.random() * 3
}
