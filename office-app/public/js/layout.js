// The floor plan: one floor, a hallway down the middle, rooms on both sides.
// Columns have fixed widths so a room never moves when another one is built;
// the building grows east one column at a time.

export const NORTH = { z0: 0, z1: 8 }
export const HALL = { z0: 8, z1: 11 }
export const SOUTH = { z0: 11, z1: 19 }
export const OUTSIDE = { z0: 19, z1: 23 }
export const DOOR_WIDTH = 2

export const COLUMNS = [
  { x0: 0, x1: 9, north: 'lead', south: 'lobby' },
  { x0: 9, x1: 22, north: 'engineering', south: 'break' },
  { x0: 22, x1: 33, north: 'research', south: 'planning' },
  { x0: 33, x1: 44, north: 'ops', south: 'remote' },
  { x0: 44, x1: 54, north: 'meeting', south: 'gameroom' },
]

/** What each room is. `always` rooms come with the office; `dept` rooms open when their first worker is hired. */
export const ROOM_INFO = {
  lead: { name: 'Lead Office', floor: 'wood', always: true },
  lobby: { name: 'Lobby', floor: 'tile', always: true },
  break: { name: 'Break Room', floor: 'oak', always: true },
  engineering: { name: 'Engineering', floor: 'carpet', tint: '#6f8fc4', dept: true },
  research: { name: 'Research Lab', floor: 'carpet', tint: '#5fa8a0', dept: true },
  planning: { name: 'Strategy Room', floor: 'carpet', tint: '#9a86c8', dept: true },
  ops: { name: 'Ops Center', floor: 'carpet', tint: '#d39a5f', dept: true },
  remote: { name: 'Remote Hub', floor: 'carpet', tint: '#78b07c', dept: true },
  meeting: { name: 'Meeting Room', floor: 'wood', auto: true },
  gameroom: { name: 'Game Room', floor: 'carpet', tint: '#c46f6f', price: 1500, rank: 2 },
}

export const DEPT_COLOR = {
  engineering: '#3f7fd8',
  research: '#21a39a',
  planning: '#8a5fd6',
  ops: '#e4862a',
  remote: '#3faa5c',
}

/** Which room an agent works in, by the kind of agent it is. */
export function deptOf(role) {
  if (role === 'Explore') return 'research'
  if (role === 'Plan') return 'planning'
  if (role === 'workflow') return 'ops'
  if (role === 'session') return 'remote'
  return 'engineering'
}

export function roleLabel(role) {
  if (role === 'general-purpose') return 'Engineer'
  if (role === 'Explore') return 'Researcher'
  if (role === 'Plan') return 'Strategist'
  if (role === 'workflow') return 'Ops crew'
  if (role === 'session') return 'Remote worker'
  if (role === 'fork') return 'Clone'
  if (role === 'teammate') return 'Teammate'
  if (role === 'lead') return 'Lead'
  return role.split(':').pop()
}

/** The rooms standing for a set of built ids, each with its rectangle and doors. */
export function planRooms(built) {
  const rooms = []
  for (const column of COLUMNS) {
    for (const row of ['north', 'south']) {
      const id = column[row]
      if (!built.has(id)) continue
      const band = row === 'north' ? NORTH : SOUTH
      const cx = (column.x0 + column.x1) / 2
      const doors = [{ x: cx, z: row === 'north' ? HALL.z0 : HALL.z1, to: 'hall' }]
      if (id === 'lobby') doors.push({ x: cx, z: SOUTH.z1, to: 'outside' })
      rooms.push({ id, row, x0: column.x0, x1: column.x1, z0: band.z0, z1: band.z1, cx, doors, ...ROOM_INFO[id] })
    }
  }
  return rooms
}

/** How far east the building reaches: every column up to the last one with a room. */
export function extentOf(built) {
  let x1 = COLUMNS[1].x1
  for (const column of COLUMNS) {
    if (built.has(column.north) || built.has(column.south)) x1 = Math.max(x1, column.x1)
  }
  return x1
}

/** The empty plots inside the building's reach: they open as rooms when needed. */
export function lotsOf(built) {
  const x1 = extentOf(built)
  const lots = []
  for (const column of COLUMNS) {
    if (column.x1 > x1) continue
    for (const row of ['north', 'south']) {
      const id = column[row]
      if (built.has(id)) continue
      const band = row === 'north' ? NORTH : SOUTH
      lots.push({ id, row, x0: column.x0, x1: column.x1, z0: band.z0, z1: band.z1, name: ROOM_INFO[id].name })
    }
  }
  return lots
}

/** Four desks back to back, a team's pod. */
function pod(id, cx, cz) {
  return [
    { type: 'desk', x: cx - 0.72, z: cz - 0.36, rot: 2, pod: id },
    { type: 'desk', x: cx + 0.72, z: cz - 0.36, rot: 2, pod: id },
    { type: 'desk', x: cx - 0.72, z: cz + 0.36, rot: 0, pod: id },
    { type: 'desk', x: cx + 0.72, z: cz + 0.36, rot: 0, pod: id },
  ]
}

/** The furniture a room comes with, in world coordinates. */
export function roomFurniture(room, { managers = 2 } = {}) {
  const { id, x0, x1, z0, z1, cx } = room
  const north = room.row === 'north'
  const podZ = north ? z0 + 3.4 : z0 + 4.6
  const back = north ? z0 + 0.32 : z1 - 0.32
  const backRot = north ? 0 : 2
  const list = []
  switch (id) {
    case 'lead': {
      const desks = [
        [x0 + 2.4, z0 + 2.4],
        [x0 + 6.6, z0 + 2.4],
        [x0 + 2.4, z0 + 5.3],
        [x0 + 6.6, z0 + 5.3],
      ]
      list.push({ type: 'bookshelf', x: cx, z: z0 + 0.25, rot: 0 })
      list.push({ type: 'rug', x: cx, z: z0 + 4.2, rot: 0, scale: 1.4 })
      list.push({ type: 'plant', x: x0 + 0.55, z: z1 - 0.55, rot: 0 })
      list.push({ type: 'plant', x: x1 - 0.55, z: z1 - 0.55, rot: 0 })
      list.push({ type: 'whiteboard', x: x1 - 0.12, z: z0 + 4.2, rot: 3 })
      // Desks last, so a third or fourth lead never renumbers the rest.
      desks.slice(0, Math.max(2, Math.min(4, managers))).forEach(([x, z], i) => {
        list.push({ type: 'managerDesk', x, z, rot: 2, seat: i })
      })
      break
    }
    case 'lobby':
      list.push({ type: 'reception', x: x0 + 2.1, z: z0 + 2.8, rot: 3 })
      list.push({ type: 'styleShop', x: x1 - 1.0, z: z0 + 5.6, rot: 3 })
      list.push({ type: 'couch', x: x0 + 0.62, z: z0 + 6.2, rot: 1 })
      list.push({ type: 'plant', x: x0 + 0.5, z: z0 + 0.5, rot: 0 })
      list.push({ type: 'plant', x: x1 - 0.5, z: z0 + 0.5, rot: 0 })
      list.push({ type: 'plant', x: x1 - 0.5, z: z1 - 0.5, rot: 0 })
      list.push({ type: 'rug', x: cx, z: z1 - 0.9, rot: 0, scale: 0.8 })
      break
    case 'break':
      list.push({ type: 'coffee', x: x0 + 2.0, z: z1 - 0.4, rot: 2 })
      list.push({ type: 'waterCooler', x: x0 + 0.4, z: z0 + 1.6, rot: 1 })
      list.push({ type: 'pingpong', x: x0 + 5.2, z: z0 + 4.4, rot: 0 })
      list.push({ type: 'couch', x: x1 - 2.4, z: z1 - 0.5, rot: 2 })
      list.push({ type: 'tv', x: x1 - 2.4, z: z0 + 0.15, rot: 0 })
      list.push({ type: 'beanbag', x: x1 - 4.1, z: z0 + 4.4, rot: 2 })
      list.push({ type: 'beanbag', x: x1 - 0.9, z: z0 + 4.4, rot: 2 })
      list.push({ type: 'bookshelf', x: x1 - 0.25, z: z0 + 2.0, rot: 3 })
      list.push({ type: 'rug', x: x1 - 2.4, z: z0 + 5.6, rot: 0, scale: 1.2 })
      list.push({ type: 'plant', x: x0 + 0.5, z: z1 - 0.5, rot: 0 })
      list.push({ type: 'plant', x: x1 - 0.5, z: z1 - 0.5, rot: 0 })
      break
    case 'meeting':
      list.push({ type: 'meetingTable', x: cx, z: z0 + 3.8, rot: 0 })
      list.push({ type: 'screenWall', x: cx, z: back, rot: backRot })
      list.push({ type: 'plant', x: x0 + 0.5, z: z0 + 0.5, rot: 0 })
      list.push({ type: 'plant', x: x1 - 0.5, z: z0 + 0.5, rot: 0 })
      break
    case 'gameroom':
      list.push({ type: 'arcade', x: x0 + 1.0, z: z1 - 0.5, rot: 2 })
      list.push({ type: 'arcade', x: x0 + 2.2, z: z1 - 0.5, rot: 2 })
      list.push({ type: 'foosball', x: x0 + 6.6, z: z0 + 4.4, rot: 0 })
      list.push({ type: 'beanbag', x: x1 - 1.2, z: z1 - 1.2, rot: 2 })
      list.push({ type: 'beanbag', x: x1 - 2.8, z: z1 - 1.0, rot: 2 })
      list.push({ type: 'tv', x: x1 - 2.0, z: z0 + 0.15, rot: 0 })
      list.push({ type: 'plant', x: x0 + 0.5, z: z0 + 0.6, rot: 0 })
      break
    default: {
      // A department: desk pods, a screen or shelf at the back, a whiteboard for the team.
      const pods = x1 - x0 >= 13 ? [x0 + 2.6, cx, x1 - 2.6] : [x0 + 2.9, x1 - 2.9]
      pods.forEach((x, i) => list.push(...pod(`${id}:${i}`, x, podZ)))
      if (id === 'research') list.push({ type: 'bookshelf', x: cx, z: back, rot: backRot })
      else if (id === 'ops' || id === 'remote') list.push({ type: 'screenWall', x: cx, z: back, rot: backRot })
      else list.push({ type: 'whiteboard', x: cx, z: back, rot: backRot })
      list.push({ type: 'plant', x: x0 + 0.5, z: north ? z0 + 0.5 : z1 - 0.5, rot: 0 })
      list.push({ type: 'plant', x: x1 - 0.5, z: north ? z0 + 0.5 : z1 - 0.5, rot: 0 })
      list.push({ type: 'waterCooler', x: x1 - 0.4, z: north ? z1 - 1.8 : z0 + 1.8, rot: 3 })
    }
  }
  return list
}
