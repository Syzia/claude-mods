// Things drawn on canvases and shown in the 3D world: speech bubbles with an
// icon, name tags, rising money, and the signs over each room's door.

import * as THREE from 'three'

const textures = new Map()
const FONT = '"Avenir Next Condensed", "DIN Condensed", "Helvetica Neue", system-ui, sans-serif'
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

function texture(key, width, height, draw) {
  if (textures.has(key)) return textures.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d'), width, height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  textures.set(key, tex)
  if (textures.size > 400) textures.delete(textures.keys().next().value)
  return tex
}

function bubbleTexture(icon, tone) {
  return texture(`bubble:${icon}:${tone}`, 128, 128, (g, w) => {
    const rim = tone === 'sad' ? '#7b8cff' : tone === 'gold' ? '#ffb02b' : '#2bf3ff'
    g.shadowColor = rim
    g.shadowBlur = 10
    g.fillStyle = 'rgba(8,12,20,0.88)'
    g.strokeStyle = rim
    g.lineWidth = 4
    g.beginPath()
    g.roundRect(10, 8, w - 20, 82, 22)
    g.moveTo(52, 90)
    g.lineTo(64, 112)
    g.lineTo(76, 90)
    g.fill()
    g.stroke()
    g.shadowBlur = 0
    g.font = `56px ${EMOJI}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(icon, w / 2, 52)
  })
}

/** A bubble above someone's head: an icon for what they are doing. */
export function makeBubble() {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }))
  sprite.scale.set(0.55, 0.55, 1)
  sprite.renderOrder = 20
  sprite.userData.icon = null
  return sprite
}

export function setBubble(sprite, icon, tone = 'plain') {
  if (!icon) {
    sprite.visible = false
    return
  }
  sprite.visible = true
  const key = `${icon}:${tone}`
  if (sprite.userData.icon === key) return
  sprite.userData.icon = key
  sprite.material.map = bubbleTexture(icon, tone)
  sprite.material.needsUpdate = true
}

/** A name tag: shown over the person you hover or pick. */
export function makeTag(text, color = '#2b2b2b') {
  const tex = texture(`tag:${text}:${color}`, 512, 96, (g, w, h) => {
    g.font = `bold 46px ${FONT}`
    const width = Math.min(w - 8, g.measureText(text).width + 48)
    g.fillStyle = 'rgba(8,12,20,0.85)'
    g.strokeStyle = '#2bf3ff'
    g.lineWidth = 3
    g.beginPath()
    g.roundRect((w - width) / 2, 12, width, h - 24, 10)
    g.fill()
    g.stroke()
    g.fillStyle = color === '#2b2b2b' ? '#e8fbff' : color
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, w / 2, h / 2 + 2)
  })
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }))
  sprite.scale.set(1.6, 0.3, 1)
  sprite.renderOrder = 30
  return sprite
}

/** "+$120" rising and fading over someone who just got paid. */
export function makeFloater(text, color = '#1e9e52') {
  const tex = texture(`float:${text}:${color}`, 256, 96, (g, w, h) => {
    g.font = `900 64px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 8
    g.strokeStyle = 'rgba(5,8,14,0.9)'
    g.strokeText(text, w / 2, h / 2)
    g.shadowColor = color
    g.shadowBlur = 16
    g.fillStyle = color
    g.fillText(text, w / 2, h / 2)
  })
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }))
  sprite.scale.set(1.2, 0.45, 1)
  sprite.renderOrder = 40
  sprite.userData.age = 0
  return sprite
}

/** A room's name on a board above its door. */
export function makeSign(text, color) {
  const tex = texture(`sign:${text}:${color}`, 512, 112, (g, w, h) => {
    g.fillStyle = 'rgba(6,8,14,0.92)'
    g.beginPath()
    g.roundRect(4, 4, w - 8, h - 8, 10)
    g.fill()
    g.shadowColor = color
    g.shadowBlur = 18
    g.strokeStyle = color
    g.lineWidth = 4
    g.stroke()
    g.fillStyle = color
    g.font = `600 52px ${FONT}`
    text = text.toUpperCase()
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, w / 2, h / 2 + 2)
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.52), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }))
  return mesh
}
