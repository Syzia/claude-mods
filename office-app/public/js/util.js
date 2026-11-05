// Small helpers every module shares.

/** A stable number from a string: the same name always gets the same look. */
export function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pick(list, seed) {
  return list[Math.abs(seed) % list.length]
}

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
export const lerp = (a, b, t) => a + (b - a) * t

/** Frame-rate independent easing toward a target. */
export function damp(current, target, speed, dt) {
  return lerp(current, target, 1 - Math.exp(-speed * dt))
}

/** The same for an angle, along the shorter way round. */
export function dampAngle(current, target, speed, dt) {
  let delta = (target - current) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * (1 - Math.exp(-speed * dt))
}

export function rand(low, high) {
  return low + Math.random() * (high - low)
}

export function chance(p) {
  return Math.random() < p
}

/** Picks one entry by weight; entries with no weight are skipped. */
export function weighted(entries) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0)
  if (total <= 0) return null
  let roll = Math.random() * total
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight)
    if (roll <= 0) return entry
  }
  return entries[entries.length - 1]
}

export function money(amount) {
  return `$${Math.round(amount).toLocaleString('en-US')}`
}

export function clip(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}
