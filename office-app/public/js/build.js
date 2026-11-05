// Build mode: buy furniture and place it where it fits, turn it, move it,
// sell it back, and buy whole rooms.

import * as THREE from 'three'
import { CATALOG, ROOMS_FOR_SALE } from './economy.js'
import { FURNITURE, buildFurniture } from './models.js'
import { money } from './util.js'

const SNAP = 0.25

export class BuildMode {
  constructor(app) {
    this.app = app
    this.active = false
    this.placing = null
    this.moving = null
    this.selected = null
    this.rot = 0
    this.ghost = null
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: '#3faa5c', transparent: true, opacity: 0.35, depthWrite: false }),
    )
    this.marker.rotation.x = -Math.PI / 2
    this.marker.position.y = 0.065
    this.marker.visible = false
    app.scene.add(this.marker)
    this.at = null
    this.valid = false
  }

  get hint() {
    if (this.placing) return this.moving ? 'Click to put it down · R to turn · Esc to cancel' : 'Click a floor to place · R to turn · Esc to stop'
    return 'Pick something to buy, or click something you bought to move or sell it'
  }

  toggle() {
    this.active = !this.active
    if (!this.active) this.cancel()
    this.render()
  }

  render() {
    const { app } = this
    if (!this.active) return app.ui.renderBuild(null)
    const selected = this.selected ? app.office.byId.get(this.selected) : null
    const entry = selected ? CATALOG.find(c => c.type === selected.type) : null
    app.ui.renderBuild({
      hint: this.hint,
      rankIndex: app.rankIndex(),
      placing: this.placing,
      built: app.project().built,
      selected: entry ? { icon: entry.icon, name: entry.name, refund: Math.floor(entry.price / 2) } : null,
    })
  }

  pick(type) {
    const entry = CATALOG.find(c => c.type === type)
    if (!entry) return
    if (entry.rank > this.app.rankIndex()) return
    if (this.app.economy.cash(this.app.projectKey) < entry.price) {
      this.app.ui.toast(`Not enough cash for the ${entry.name.toLowerCase()} (${money(entry.price)})`)
      return
    }
    this.cancel()
    this.selected = null
    this.startGhost(type)
    this.render()
  }

  startGhost(type) {
    this.placing = type
    const piece = buildFurniture({ id: 'ghost', type, x: 0, z: 0, rot: this.rot })
    piece.group.traverse(o => {
      if (!o.isMesh) return
      o.material = o.material.clone()
      o.material.transparent = true
      o.material.opacity = 0.6
      o.castShadow = false
    })
    this.ghost = piece.group
    this.app.scene.add(this.ghost)
    const [w, d] = FURNITURE[type].size
    this.marker.scale.set(Math.max(w, 0.5), Math.max(d, 0.5), 1)
    this.marker.visible = true
  }

  rotate() {
    if (!this.placing) return
    this.rot = (this.rot + 1) % 4
    if (this.ghost) this.ghost.rotation.y = this.rot * (Math.PI / 2)
    this.marker.rotation.z = this.rot * (Math.PI / 2)
    if (this.at) this.hover(this.at)
  }

  hover(point) {
    if (!this.placing || !point) return
    const x = Math.round(point.x / SNAP) * SNAP
    const z = Math.round(point.z / SNAP) * SNAP
    this.at = { x, z }
    this.ghost.position.set(x, 0, z)
    this.marker.position.set(x, 0.065, z)
    const check = this.app.office.canPlace(this.placing, x, z, this.rot, this.moving?.id)
    this.valid = check.ok
    this.room = check.room
    this.marker.material.color.set(check.ok ? '#3faa5c' : '#d64545')
  }

  /** A click in build mode: place what is held, or pick up something already bought. */
  click(point, furnitureId) {
    const { app } = this
    if (this.placing) {
      this.hover(point)
      if (!this.valid) {
        app.ui.toast('That spot is taken: try somewhere with free floor')
        return
      }
      const project = app.project()
      const { x, z } = this.at
      if (this.moving) {
        const item = { ...this.moving, x, z, rot: this.rot, room: this.room }
        project.purchases = project.purchases.map(p => (p.id === item.id ? item : p))
        app.office.place(item)
        app.economy.dirty = true
        this.cancel()
      } else {
        const entry = CATALOG.find(c => c.type === this.placing)
        if (!app.economy.spend(app.projectKey, entry.price)) {
          app.ui.toast(`Not enough cash (${money(entry.price)})`)
          return
        }
        const item = { id: `buy:${project.nextId++}`, type: this.placing, x, z, rot: this.rot, room: this.room }
        project.purchases.push(item)
        app.office.place(item)
        app.ui.tick({ icon: entry.icon, text: `Bought a ${entry.name.toLowerCase()}`, money: 0 })
        app.burst(x, z)
      }
      this.render()
      return
    }
    this.selected = furnitureId?.startsWith('buy:') ? furnitureId : null
    this.render()
  }

  startMove() {
    const piece = this.selected && this.app.office.byId.get(this.selected)
    if (!piece) return
    this.app.evict(piece.id)
    this.moving = { id: piece.id, type: piece.type, x: piece.x, z: piece.z, rot: piece.rot, room: piece.room }
    this.app.office.remove(piece.id)
    this.rot = piece.rot ?? 0
    this.selected = null
    this.startGhost(piece.type)
    this.ghost.rotation.y = this.rot * (Math.PI / 2)
    this.marker.rotation.z = this.rot * (Math.PI / 2)
    this.render()
  }

  sell() {
    const { app } = this
    const piece = this.selected && app.office.byId.get(this.selected)
    if (!piece) return
    const entry = CATALOG.find(c => c.type === piece.type)
    const refund = Math.floor(entry.price / 2)
    app.evict(piece.id)
    app.office.remove(piece.id)
    const project = app.project()
    project.purchases = project.purchases.filter(p => p.id !== piece.id)
    app.economy.earn(app.projectKey, refund)
    app.ui.tick({ icon: '💲', text: `Sold a ${entry.name.toLowerCase()}`, money: refund })
    this.selected = null
    this.render()
  }

  buyRoom(id) {
    const { app } = this
    const room = ROOMS_FOR_SALE.find(r => r.id === id)
    const project = app.project()
    if (!room || project.built.includes(id) || room.rank > app.rankIndex()) return
    if (!app.economy.spend(app.projectKey, room.price)) {
      app.ui.toast(`The ${room.name} costs ${money(room.price)}`)
      return
    }
    project.built.push(id)
    app.ui.tick({ icon: room.icon, text: `Built the ${room.name}`, money: 0 })
    app.ui.toast(`🏗️ The ${room.name} is open!`)
    app.rebuild()
    this.render()
  }

  /** Puts back what was being moved, and drops whatever was in hand. */
  cancel() {
    if (this.moving) {
      this.app.office.place({ ...this.moving })
      this.moving = null
    }
    if (this.ghost) this.app.scene.remove(this.ghost)
    this.ghost = null
    this.placing = null
    this.marker.visible = false
    this.at = null
  }
}
