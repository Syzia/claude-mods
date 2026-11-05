// The walking grid: half-metre cells, each in one region (a room, the hall,
// outside). People cross from one region to another only through a door.

import { HALL, OUTSIDE, DOOR_WIDTH } from './layout.js'

export const CELL = 0.5

export class Nav {
  /** @param rooms the built rooms; @param extent how far east the building reaches */
  constructor(rooms, extent) {
    this.cols = Math.ceil(extent / CELL)
    this.rows = Math.ceil(OUTSIDE.z1 / CELL)
    this.extent = extent
    this.region = new Array(this.cols * this.rows).fill(null)
    this.blocked = new Uint8Array(this.cols * this.rows)
    this.doors = new Set()
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        const x = (c + 0.5) * CELL
        const z = (r + 0.5) * CELL
        this.region[r * this.cols + c] = regionAt(rooms, x, z, extent)
      }
    }
    for (const room of rooms) {
      for (const door of room.doors) this.addDoor(door.x, door.z)
    }
  }

  index(c, r) {
    return r * this.cols + c
  }

  cellOf(x, z) {
    return [Math.floor(x / CELL), Math.floor(z / CELL)]
  }

  centre(c, r) {
    return { x: (c + 0.5) * CELL, z: (r + 0.5) * CELL }
  }

  inside(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows
  }

  regionOf(x, z) {
    const [c, r] = this.cellOf(x, z)
    return this.inside(c, r) ? this.region[this.index(c, r)] : null
  }

  walkable(c, r) {
    if (!this.inside(c, r)) return false
    const i = this.index(c, r)
    return this.region[i] !== null && this.blocked[i] === 0
  }

  /** A door in a wall that runs east-west at `z`, centred on `x`. */
  addDoor(x, z) {
    const r = Math.round(z / CELL)
    for (let c = 0; c < this.cols; c += 1) {
      const cx = (c + 0.5) * CELL
      if (Math.abs(cx - x) < DOOR_WIDTH / 2) {
        const a = this.index(c, r - 1)
        const b = this.index(c, r)
        this.doors.add(`${a}|${b}`)
        this.doors.add(`${b}|${a}`)
      }
    }
  }

  /** Whether one step from cell a to its neighbour b is allowed (no walking through walls). */
  canStep(ac, ar, bc, br) {
    if (!this.walkable(bc, br)) return false
    const a = this.index(ac, ar)
    const b = this.index(bc, br)
    if (this.region[a] === this.region[b]) return true
    if (ac !== bc && ar !== br) return false
    return this.doors.has(`${a}|${b}`)
  }

  /** Marks the cells under a piece of furniture: a w×d rectangle at (x, z) turned by `rot` quarter turns. */
  block(x, z, w, d, rot, value = 1) {
    const turned = rot % 2 === 1
    const hw = (turned ? d : w) / 2
    const hd = (turned ? w : d) / 2
    const [c0, r0] = this.cellOf(x - hw + 0.01, z - hd + 0.01)
    const [c1, r1] = this.cellOf(x + hw - 0.01, z + hd - 0.01)
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        if (this.inside(c, r)) this.blocked[this.index(c, r)] = value
      }
    }
  }

  /** The cells a footprint would cover, for placing furniture in build mode. */
  cellsUnder(x, z, w, d, rot) {
    const turned = rot % 2 === 1
    const hw = (turned ? d : w) / 2
    const hd = (turned ? w : d) / 2
    const [c0, r0] = this.cellOf(x - hw + 0.01, z - hd + 0.01)
    const [c1, r1] = this.cellOf(x + hw - 0.01, z + hd - 0.01)
    const cells = []
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) cells.push([c, r])
    return cells
  }

  /** The nearest cell people can stand on, searching outward from (x, z). */
  nearestWalkable(x, z, region = null) {
    const [c0, r0] = this.cellOf(x, z)
    for (let radius = 0; radius < 12; radius += 1) {
      let best = null
      let bestDistance = Infinity
      for (let r = r0 - radius; r <= r0 + radius; r += 1) {
        for (let c = c0 - radius; c <= c0 + radius; c += 1) {
          if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== radius) continue
          if (!this.walkable(c, r)) continue
          if (region && this.region[this.index(c, r)] !== region) continue
          const p = this.centre(c, r)
          const distance = (p.x - x) ** 2 + (p.z - z) ** 2
          if (distance < bestDistance) {
            bestDistance = distance
            best = [c, r]
          }
        }
      }
      if (best) return best
    }
    return null
  }

  /** A* from one point to another. Returns world points to walk through, or null when there is no way. */
  find(from, to) {
    const start = this.walkable(...this.cellOf(from.x, from.z))
      ? this.cellOf(from.x, from.z)
      : this.nearestWalkable(from.x, from.z)
    const goal = this.walkable(...this.cellOf(to.x, to.z))
      ? this.cellOf(to.x, to.z)
      : this.nearestWalkable(to.x, to.z, this.regionOf(to.x, to.z))
    if (!start || !goal) return null
    const startIndex = this.index(...start)
    const goalIndex = this.index(...goal)
    const g = new Map([[startIndex, 0]])
    const came = new Map()
    const open = new Heap()
    const h = (c, r) => Math.hypot(c - goal[0], r - goal[1])
    open.push(startIndex, h(...start))
    const closed = new Set()
    while (open.size > 0) {
      const current = open.pop()
      if (current === goalIndex) break
      if (closed.has(current)) continue
      closed.add(current)
      const c = current % this.cols
      const r = Math.floor(current / this.cols)
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dc === 0 && dr === 0) continue
          const nc = c + dc
          const nr = r + dr
          if (!this.canStep(c, r, nc, nr)) continue
          if (dc !== 0 && dr !== 0 && (!this.canStep(c, r, nc, r) || !this.canStep(c, r, c, nr))) continue
          const next = this.index(nc, nr)
          const cost = (g.get(current) ?? 0) + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1)
          if (cost < (g.get(next) ?? Infinity)) {
            g.set(next, cost)
            came.set(next, current)
            open.push(next, cost + h(nc, nr))
          }
        }
      }
    }
    if (!g.has(goalIndex)) return null
    const cells = [goalIndex]
    while (cells[cells.length - 1] !== startIndex) {
      const previous = came.get(cells[cells.length - 1])
      if (previous === undefined) break
      cells.push(previous)
    }
    cells.reverse()
    const points = cells.map(i => this.centre(i % this.cols, Math.floor(i / this.cols)))
    return this.smooth(points)
  }

  /** Drops corners a person can cut straight across, so walks look natural. */
  smooth(points) {
    if (points.length <= 2) return points
    const out = [points[0]]
    let anchor = 0
    for (let i = 2; i < points.length; i += 1) {
      if (!this.straight(points[anchor], points[i])) {
        out.push(points[i - 1])
        anchor = i - 1
      }
    }
    out.push(points[points.length - 1])
    return out
  }

  straight(a, b) {
    const distance = Math.hypot(b.x - a.x, b.z - a.z)
    const steps = Math.ceil(distance / (CELL / 3))
    let [pc, pr] = this.cellOf(a.x, a.z)
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps
      const [c, r] = this.cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)
      if (c === pc && r === pr) continue
      if (Math.abs(c - pc) + Math.abs(r - pr) > 1) {
        // A diagonal move: both corners must be open, as the search requires.
        if (!this.canStep(pc, pr, c, pr) || !this.canStep(pc, pr, pc, r)) return false
      }
      if (!this.canStep(pc, pr, c, r)) return false
      pc = c
      pr = r
    }
    return true
  }
}

function regionAt(rooms, x, z, extent) {
  if (x < 0 || x > extent) return null
  for (const room of rooms) {
    if (x > room.x0 && x < room.x1 && z > room.z0 && z < room.z1) return room.id
  }
  if (z > HALL.z0 && z < HALL.z1) return 'hall'
  if (z > OUTSIDE.z0 && z < OUTSIDE.z1) return 'outside'
  return null
}

class Heap {
  constructor() {
    this.items = []
  }
  get size() {
    return this.items.length
  }
  push(value, priority) {
    const items = this.items
    items.push({ value, priority })
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].priority <= items[i].priority) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }
  pop() {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < items.length && items[l].priority < items[m].priority) m = l
        if (r < items.length && items[r].priority < items[m].priority) m = r
        if (m === i) break
        ;[items[m], items[i]] = [items[i], items[m]]
        i = m
      }
    }
    return top.value
  }
}
