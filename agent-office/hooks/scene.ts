import type { Agent, Lead, Task } from '../types'
import { clip, countDone, hash, levelOf, seating } from './model'

export type SceneView = {
  project: string
  level: ReturnType<typeof levelOf>
  lead: Lead
  agents: readonly Agent[]
  tasks: readonly Task[]
  selected: string | null
}

const W = 520
const TOP = 52
const ROOM_BOTTOM = 192
const GRID_TOP = 200
const COLS = 4
const CELL_W = 126
const CELL_H = 106
const STRIP = 74

const SKIN = ['#f6d3b3', '#eebf98', '#d9a27a', '#b67a52', '#8d5a3b', '#f3c9a8']
const HAIR = ['#2d2420', '#5a3b26', '#a0642f', '#e0b04f', '#c8452c', '#3b3f58', '#7b6a5a', '#e8e3d8']
const SHIRT: Record<string, string> = {
  Explore: '#3aa6a0',
  Plan: '#8a63d2',
  'general-purpose': '#4a83d6',
  workflow: '#e08a2e',
  fork: '#8b95a5',
  session: '#4caf6a',
}
const SHIRTS = ['#d65a7a', '#4a83d6', '#3aa6a0', '#e0b33a', '#8a63d2', '#5e9e4f', '#e07a3e']
const LEAD_SHIRT = '#d97757'
const COUCH = ['#8a6a52', '#6f8f8a', '#4f7fa8', '#7a5aa6', '#3f8f7a', '#b0505a']

const STYLE = `
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-1.6px)}}
@keyframes tap{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.4px)}}
@keyframes blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
@keyframes steam{0%{opacity:0;transform:translateY(0)}40%{opacity:.85}100%{opacity:0;transform:translateY(-9px)}}
@keyframes drift{from{transform:translateX(-50px)}to{transform:translateX(130px)}}
@keyframes led{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes glow{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes hop{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes code{0%{opacity:.25}50%{opacity:1}100%{opacity:.25}}
@keyframes zz{0%{opacity:0;transform:translate(0,0)}50%{opacity:1}100%{opacity:0;transform:translate(6px,-10px)}}
.bob{animation:bob .9s ease-in-out infinite alternate}
.tapL{animation:tap .38s ease-in-out infinite}
.tapR{animation:tap .38s ease-in-out infinite .19s}
.eye{animation:blink 4.2s infinite;transform-box:fill-box;transform-origin:center}
.steam{animation:steam 2.4s ease-out infinite}
.drift{animation:drift 26s linear infinite}
.led{animation:led 1.1s steps(2) infinite}
.glow{animation:glow 2.2s ease-in-out infinite}
.pulse{animation:pulse 1.8s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.hop{animation:hop .9s ease-in-out infinite}
.spin{animation:spin 60s linear infinite;transform-box:view-box}
.code{animation:code 1.3s ease-in-out infinite}
.zz{animation:zz 2.6s ease-out infinite}
text{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
`

function esc(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}

function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length]!
}

function delay(seed: number): string {
  return `animation-delay:-${(seed % 17) / 10}s`
}

type Mood = 'busy' | 'happy' | 'sad' | 'asleep' | 'calm'

/** A worker's head and shoulders, the head centred on (x, y). */
function person(x: number, y: number, seed: number, shirt: string, mood: Mood): string {
  const skin = pick(SKIN, seed >> 3)
  const hair = pick(HAIR, seed >> 7)
  const style = (seed >> 11) % 3
  const d = delay(seed)
  const eyes =
    mood === 'asleep'
      ? `<path d="M${x - 5} ${y + 1}h3M${x + 2} ${y + 1}h3" stroke="#2b2b2b" stroke-width="1.3" stroke-linecap="round"/>`
      : mood === 'sad'
        ? `<path d="M${x - 5} ${y - 1}l3 3M${x - 2} ${y - 1}l-3 3M${x + 2} ${y - 1}l3 3M${x + 5} ${y - 1}l-3 3" stroke="#2b2b2b" stroke-width="1.1"/>`
        : `<circle class="eye" style="${d}" cx="${x - 3.6}" cy="${y + 0.5}" r="1.5" fill="#2b2b2b"/><circle class="eye" style="${d}" cx="${x + 3.6}" cy="${y + 0.5}" r="1.5" fill="#2b2b2b"/>`
  const mouth =
    mood === 'happy' || mood === 'calm'
      ? `<path d="M${x - 3.2} ${y + 4.6}q3.2 3 6.4 0" stroke="#7a3b2b" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
      : mood === 'sad'
        ? `<path d="M${x - 3} ${y + 6.5}q3 -2.6 6 0" stroke="#7a3b2b" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
        : `<path d="M${x - 2.2} ${y + 5.4}h4.4" stroke="#7a3b2b" stroke-width="1.2" stroke-linecap="round"/>`
  const hairShape =
    style === 0
      ? `<ellipse cx="${x}" cy="${y - 5.5}" rx="10.6" ry="6.4" fill="${hair}"/>`
      : style === 1
        ? `<path d="M${x - 11} ${y + 3}q-1 -15 11 -15q12 0 11 15q-3 -9 -11 -10q-8 1 -11 10z" fill="${hair}"/>`
        : `<ellipse cx="${x}" cy="${y - 6}" rx="10" ry="5.6" fill="${hair}"/><circle cx="${x + 7}" cy="${y - 10}" r="4.2" fill="${hair}"/>`

  return [
    `<rect x="${x - 15}" y="${y + 9}" width="30" height="26" rx="10" fill="${shirt}"/>`,
    `<circle cx="${x}" cy="${y}" r="10.2" fill="${skin}"/>`,
    hairShape,
    eyes,
    `<circle cx="${x - 6.4}" cy="${y + 3.6}" r="1.8" fill="#ef8f8f" opacity=".35"/><circle cx="${x + 6.4}" cy="${y + 3.6}" r="1.8" fill="#ef8f8f" opacity=".35"/>`,
    mouth,
  ].join('')
}

function bubble(x: number, y: number, icon: string, seed: number): string {
  return (
    `<g class="pulse" style="${delay(seed)}">` +
    `<rect x="${x}" y="${y}" width="30" height="22" rx="9" fill="#ffffff" stroke="#cfcfcf"/>` +
    `<path d="M${x + 6} ${y + 21}l-4 6l10 -6z" fill="#ffffff" stroke="#cfcfcf" stroke-linejoin="round"/>` +
    `<rect x="${x + 4}" y="${y + 19}" width="10" height="3" fill="#ffffff"/>` +
    `<text x="${x + 15}" y="${y + 15.5}" font-size="12.5" text-anchor="middle">${esc(icon)}</text>` +
    `</g>`
  )
}

function marker(x: number, y: number): string {
  return (
    `<ellipse cx="${x}" cy="${y + 18}" rx="24" ry="27" fill="none" stroke="#ffc83a" stroke-width="2.2" stroke-dasharray="5 4"/>` +
    `<path class="hop" d="M${x - 6} ${y - 30}h12l-6 8z" fill="#ffb800"/>`
  )
}

function mug(x: number, y: number, seed: number, isHot: boolean): string {
  const steam = isHot
    ? [0, 0.8, 1.6]
        .map(
          (t, i) =>
            `<path class="steam" style="animation-delay:-${t + (seed % 5) / 5}s" d="M${x + 2 + i * 2.4} ${y - 3}q-2 -3 0 -6" stroke="#bbbbbb" stroke-width="1" fill="none"/>`,
        )
        .join('')
    : ''

  return `${steam}<rect x="${x}" y="${y}" width="8" height="8" rx="1.5" fill="${pick(['#ffffff', '#f2c14e', '#e86f6f', '#6fb3e8'], seed)}" stroke="#9a8a7a" stroke-width=".6"/><path d="M${x + 8} ${y + 2}q3 2 0 4" stroke="#9a8a7a" stroke-width="1" fill="none"/>`
}

function plant(x: number, y: number, size = 1): string {
  const s = size

  return (
    `<path d="M${x} ${y}q${-10 * s} ${-12 * s} ${-4 * s} ${-24 * s}q${5 * s} ${8 * s} ${4 * s} ${24 * s}z" fill="#4f9a55"/>` +
    `<path d="M${x} ${y}q${10 * s} ${-14 * s} ${5 * s} ${-26 * s}q${-6 * s} ${10 * s} ${-5 * s} ${26 * s}z" fill="#5fb065"/>` +
    `<path d="M${x} ${y}q${-2 * s} ${-16 * s} ${1 * s} ${-30 * s}q${3 * s} ${14 * s} ${-1 * s} ${30 * s}z" fill="#6cc072"/>` +
    `<path d="M${x - 9 * s} ${y}h${18 * s}l${-3 * s} ${14 * s}h${-12 * s}z" fill="#c4744a"/>`
  )
}

function title(text: string): string {
  return `<title>${esc(text)}</title>`
}

function wall(view: SceneView): string {
  const windows = [150, 262, 374]
    .map((x, i) => {
      const clouds = `<g clip-path="url(#w${i})"><g class="drift" style="animation-delay:-${i * 9}s;animation-duration:${22 + i * 7}s"><ellipse cx="${x + 10}" cy="20" rx="12" ry="5" fill="#ffffff"/><ellipse cx="${x + 18}" cy="17" rx="8" ry="5" fill="#ffffff"/></g></g>`

      return (
        `<clipPath id="w${i}"><rect x="${x}" y="8" width="90" height="34"/></clipPath>` +
        `<rect x="${x}" y="8" width="90" height="34" fill="url(#sky)"/>${clouds}` +
        `<rect x="${x}" y="8" width="90" height="34" fill="none" stroke="#ffffff" stroke-width="3"/>` +
        `<path d="M${x + 45} 8v34M${x} 25h90" stroke="#ffffff" stroke-width="2"/>`
      )
    })
    .join('')
  const sign =
    `<rect x="10" y="8" width="126" height="34" rx="4" fill="#2f4f45" stroke="#1f3a32" stroke-width="2"/>` +
    `<text x="73" y="22" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(clip(view.project, 20))}</text>` +
    `<text x="73" y="35" font-size="8.5" fill="#ffd75e" text-anchor="middle">${esc(view.level.name)} · Lv ${view.level.index + 1}</text>`
  const clock =
    `<circle cx="490" cy="25" r="14" fill="#ffffff" stroke="#6b5a48" stroke-width="2.4"/>` +
    `<path d="M490 25v-8" stroke="#333" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path class="spin" style="transform-origin:490px 25px" d="M490 25h9" stroke="#c0392b" stroke-width="1.2" stroke-linecap="round"/>`

  return `<rect x="0" y="0" width="${W}" height="${TOP}" fill="#efe3cf"/><rect x="0" y="${TOP - 5}" width="${W}" height="5" fill="#c9b48f"/>${windows}${sign}${clock}`
}

function leadOffice(view: SceneView): string {
  const { lead, tasks, level } = view
  const isWorking = lead.status === 'working'
  const seed = hash('claude-lead')
  const x = 128
  const y = 112
  const screens = [62, 158]
    .map((sx, i) => {
      const lines = isWorking
        ? [0, 1, 2, 3]
            .map(
              n =>
                `<rect class="code" style="animation-delay:-${(n * 0.33 + i * 0.5).toFixed(2)}s" x="${sx + 5}" y="${125 + n * 5}" width="${[22, 14, 26, 18][n]}" height="2.4" rx="1" fill="${['#7ee0a0', '#79c0ff', '#f0c674', '#d2a8ff'][n]}"/>`,
            )
            .join('')
        : ''

      return `<rect x="${sx}" y="120" width="40" height="27" rx="3" fill="#2b2f3a"/><rect x="${sx + 2.5}" y="122.5" width="35" height="22" rx="1.5" fill="${isWorking ? '#15202e' : '#0d0f14'}"/>${lines}<rect x="${sx + 17}" y="147" width="6" height="5" fill="#2b2f3a"/>`
    })
    .join('')
  const hands = isWorking
    ? `<circle class="tapL" cx="${x - 13}" cy="150" r="3.8" fill="${pick(SKIN, seed >> 3)}"/><circle class="tapR" cx="${x + 13}" cy="150" r="3.8" fill="${pick(SKIN, seed >> 3)}"/>`
    : `<circle cx="${x - 13}" cy="151" r="3.8" fill="${pick(SKIN, seed >> 3)}"/><circle cx="${x + 13}" cy="151" r="3.8" fill="${pick(SKIN, seed >> 3)}"/>`
  const done = countDone(tasks)
  const board =
    level.index >= 3
      ? `<rect x="18" y="62" width="74" height="44" rx="3" fill="#fbfbf8" stroke="#9a9a9a" stroke-width="1.5"/>` +
        `<text x="24" y="74" font-size="8" font-weight="700" fill="#444">Tasks</text>` +
        `<rect x="24" y="80" width="62" height="7" rx="3.5" fill="#e3e3e3"/>` +
        `<rect x="24" y="80" width="${tasks.length ? (62 * done) / tasks.length : 0}" height="7" rx="3.5" fill="#5fb065"/>` +
        `<text x="24" y="99" font-size="8" fill="#555">${done} of ${tasks.length} done</text>`
      : ''
  const isSelected = view.selected === 'lead'

  return (
    `<rect x="8" y="${TOP + 4}" width="248" height="${ROOM_BOTTOM - TOP - 4}" fill="#e9dcc3"/>` +
    board +
    `<g>${title(`Claude (lead): ${lead.doing.text}`)}` +
    `<rect x="${x - 22}" y="${y - 12}" width="44" height="44" rx="10" fill="#3b3f4c"/>` +
    `<g class="bob" style="${delay(seed)}">${person(x, y, seed, LEAD_SHIRT, isWorking ? 'busy' : 'calm')}</g>` +
    `<text x="${x}" y="${y + 27}" font-size="9" fill="#ffffff" text-anchor="middle">✳</text>` +
    `<rect x="40" y="144" width="176" height="12" rx="3" fill="#8a5a3c"/>` +
    `<rect x="46" y="156" width="164" height="30" rx="2" fill="#744a30"/>` +
    screens +
    hands +
    mug(196, 136, seed, true) +
    `<rect x="98" y="164" width="60" height="14" rx="2" fill="#f4ead7"/>` +
    `<text x="128" y="174" font-size="8.5" font-weight="700" fill="#4a3a28" text-anchor="middle">Claude · lead</text>` +
    bubble(160, 66, lead.doing.icon, seed) +
    (isSelected ? marker(x, y) : '') +
    `</g>` +
    `<rect x="8" y="${TOP + 4}" width="248" height="${ROOM_BOTTOM - TOP - 4}" fill="none" stroke="#9fcfe6" stroke-width="3"/>` +
    `<rect x="214" y="${ROOM_BOTTOM - 3}" width="34" height="6" fill="#e9dcc3"/>` +
    (level.index >= 1 ? plant(232, 150, 0.9) : '')
  )
}

function lounge(view: SceneView): string {
  const { lounge: resting, wentHome } = seating(view.agents)
  const couch = pick(COUCH, view.level.index)
  const seats = [
    { x: 316, y: 100, isBag: false },
    { x: 358, y: 100, isBag: false },
    { x: 400, y: 100, isBag: false },
    { x: 300, y: 152, isBag: true },
    { x: 452, y: 152, isBag: true },
  ]
  const people = resting
    .map((agent, i) => {
      const seat = seats[i]!
      const seed = hash(agent.id)
      const isFailed = agent.status === 'failed'
      const body = person(seat.x, seat.y, seed, shirtOf(agent), isFailed ? 'sad' : 'happy')
      const extra = isFailed
        ? `<text x="${seat.x + 12}" y="${seat.y - 8}" font-size="10">💦</text>`
        : mug(seat.x + 7, seat.y + 13, seed, true)
      const bag = seat.isBag
        ? `<ellipse cx="${seat.x}" cy="${seat.y + 24}" rx="19" ry="11" fill="${pick(['#e07a5f', '#81b29a', '#f2cc8f', '#6d8bd6'], seed)}"/>`
        : ''
      const mark = view.selected === agent.id ? marker(seat.x, seat.y) : ''

      return `<g>${title(`${agent.name} (${roleLabel(agent.role)}): ${agent.doing.text}`)}<g class="bob" style="${delay(seed)};animation-duration:2.4s">${body}</g>${bag}${extra}${mark}</g>`
    })
    .join('')
  const machine =
    view.level.index >= 2
      ? `<rect x="474" y="66" width="30" height="46" rx="3" fill="#5a5f6a"/><rect x="478" y="70" width="22" height="12" rx="2" fill="#2b2f3a"/><circle class="led" cx="483" cy="76" r="1.8" fill="#ff5a5a"/><rect x="483" y="92" width="12" height="12" fill="#2b2f3a"/>${mug(485, 96, 3, true)}<text x="489" y="122" font-size="7" fill="#6b5a48" text-anchor="middle">coffee</text>`
      : ''
  const tv =
    view.level.index >= 4
      ? `<rect x="420" y="60" width="44" height="28" rx="2" fill="#222"/><rect class="glow" x="423" y="63" width="38" height="22" fill="#3a6ea5"/>`
      : ''

  return (
    `<rect x="264" y="${TOP + 4}" width="248" height="${ROOM_BOTTOM - TOP - 4}" fill="#f1e6d2"/>` +
    `<ellipse cx="380" cy="160" rx="108" ry="24" fill="#a7c4bc" opacity=".75"/>` +
    `<text x="274" y="70" font-size="10" font-weight="700" fill="#6b5a48">Lounge</text>` +
    tv +
    machine +
    `<rect x="290" y="90" width="136" height="32" rx="10" fill="${couch}"/>` +
    people +
    `<rect x="284" y="118" width="148" height="24" rx="8" fill="${shade(couch)}"/>` +
    `<rect x="278" y="104" width="14" height="38" rx="6" fill="${couch}"/><rect x="424" y="104" width="14" height="38" rx="6" fill="${couch}"/>` +
    (resting.length === 0
      ? `<text x="358" y="175" font-size="8.5" fill="#6b5a48" text-anchor="middle">Nobody on a break yet</text>`
      : '') +
    (wentHome > 0 ? `<text x="318" y="70" font-size="8.5" fill="#6b5a48">· ${wentHome} went home</text>` : '') +
    (view.level.index >= 1 ? plant(496, 182, 0.8) : '')
  )
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.round(v * 0.82))

  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join('')}`
}

export function roleLabel(role: string): string {
  if (role === 'general-purpose') return 'helper'
  if (role === 'session') return 'own session'

  return role
}

export function shirtOf(agent: Agent): string {
  return SHIRT[agent.role] ?? pick(SHIRTS, hash(agent.role))
}

function desk(view: SceneView, seat: number, agent: Agent | undefined): string {
  const col = seat % COLS
  const row = Math.floor(seat / COLS)
  const cx = 8 + col * CELL_W
  const cy = GRID_TOP + row * CELL_H
  const isHot = seat >= view.level.desks
  const top = isHot ? '#a9b0b8' : '#b98552'
  const front = isHot ? '#8d949c' : '#a06f42'
  const px = cx + 63
  const py = cy + 34
  const parts = [`<rect x="${cx + 4}" y="${cy + 4}" width="${CELL_W - 8}" height="${CELL_H - 8}" rx="6" fill="#000" opacity=".035"/>`]

  if (!agent) {
    parts.push(
      `<rect x="${px - 20}" y="${py - 8}" width="40" height="34" rx="9" fill="#5b606d" opacity=".55"/>`,
      `<rect x="${cx + 12}" y="${cy + 62}" width="102" height="10" rx="3" fill="${top}" opacity=".7"/>`,
      `<rect x="${cx + 16}" y="${cy + 72}" width="94" height="22" rx="2" fill="${front}" opacity=".7"/>`,
      `<rect x="${px - 15}" y="${cy + 58}" width="30" height="4" rx="1.5" fill="#c7ced8"/>`,
      `<text x="${px}" y="${cy + 87}" font-size="8" fill="#f4ead7" text-anchor="middle">${isHot ? 'hot desk' : 'free desk'}</text>`,
    )

    return `<g>${title(isHot ? 'A spare table: the office is full' : 'A free desk')}${parts.join('')}</g>`
  }
  const seed = hash(agent.id)
  const isIdle = agent.status === 'idle'
  const skin = pick(SKIN, seed >> 3)
  parts.push(
    title(`${agent.name} (${roleLabel(agent.role)}): ${agent.doing.text}`),
    `<rect x="${px - 20}" y="${py - 12}" width="40" height="40" rx="9" fill="#4a4f5c"/>`,
    `<g class="bob" style="${delay(seed)}${isIdle ? ';animation-duration:2.6s' : ''}">${person(px, py, seed, shirtOf(agent), isIdle ? 'asleep' : 'busy')}</g>`,
    `<rect x="${cx + 12}" y="${cy + 62}" width="102" height="10" rx="3" fill="${top}"/>`,
    `<rect x="${cx + 16}" y="${cy + 72}" width="94" height="22" rx="2" fill="${front}"/>`,
    `<rect x="${px - 16}" y="${cy + 46}" width="32" height="17" rx="2" fill="#d5dbe3" stroke="#aab3bf"/>`,
    `<circle class="glow" style="${delay(seed)}" cx="${px}" cy="${cy + 54.5}" r="2.6" fill="#ffffff"/>`,
    isIdle
      ? `<text class="zz" x="${px + 12}" y="${py - 12}" font-size="9" fill="#6b7a99">z</text>`
      : `<circle class="tapL" style="${delay(seed)}" cx="${px - 19}" cy="${cy + 63}" r="3.6" fill="${skin}"/><circle class="tapR" style="${delay(seed)}" cx="${px + 19}" cy="${cy + 63}" r="3.6" fill="${skin}"/>`,
    seed % 3 === 0 ? mug(cx + 20, cy + 54, seed, false) : seed % 3 === 1 ? plant(cx + 104, cy + 62, 0.45) : '',
    `<rect x="${px - 27}" y="${cy + 76}" width="54" height="13" rx="2" fill="#f4ead7"/>`,
    `<text x="${px}" y="${cy + 85.5}" font-size="8.5" font-weight="700" fill="#4a3a28" text-anchor="middle">${esc(clip(agent.name, 12))}</text>`,
    bubble(cx + 88, cy + 4, agent.doing.icon, seed),
  )
  if (view.selected === agent.id) parts.push(marker(px, py))

  return `<g>${parts.join('')}</g>`
}

function strip(view: SceneView, y: number): string {
  const { remote } = seating(view.agents)
  const level = view.level
  const parts: string[] = []
  if (level.index >= 1) {
    parts.push(
      `<g>${title('Water cooler')}<rect x="20" y="${y + 14}" width="18" height="34" rx="3" fill="#dfe6ee"/><rect x="22" y="${y + 2}" width="14" height="14" rx="4" fill="#9fd3f5" opacity=".9"/></g>`,
    )
  }
  if (level.index >= 4) {
    const leds = [0, 1, 2, 3, 4]
      .map(
        n =>
          `<circle class="led" style="animation-delay:-${n * 0.37}s" cx="${70}" cy="${y + 10 + n * 8}" r="1.6" fill="${n % 2 ? '#5aff8a' : '#5ab8ff'}"/><rect x="${76}" y="${y + 8.5 + n * 8}" width="20" height="3" fill="#3c4250"/>`,
      )
      .join('')
    parts.push(`<g>${title('Server rack')}<rect x="62" y="${y + 2}" width="42" height="50" rx="3" fill="#262a33"/>${leds}</g>`)
  }
  if (level.index >= 5) {
    parts.push(
      `<g>${title('Arcade cabinet')}<rect x="116" y="${y}" width="34" height="54" rx="4" fill="#7a3bd2"/><rect class="glow" x="121" y="${y + 6}" width="24" height="18" fill="#ffd75e"/><circle cx="127" cy="${y + 34}" r="3" fill="#ff5a5a"/><circle cx="139" cy="${y + 34}" r="3" fill="#5ab8ff"/></g>`,
    )
  }
  const next = level.next
  const plaque = next
    ? `${level.xp} XP · ${next.xp - level.xp} XP to ${next.name}`
    : `${level.xp} XP · top floor reached`
  const width = 200
  const progress = next ? Math.min(1, (level.xp - level.floor) / (next.xp - level.floor)) : 1
  parts.push(
    `<rect x="${W / 2 - width / 2}" y="${y + 14}" width="${width}" height="30" rx="6" fill="#ffffff" opacity=".75"/>`,
    `<text x="${W / 2}" y="${y + 27}" font-size="9" fill="#4a3a28" text-anchor="middle">${esc(plaque)}</text>`,
    `<rect x="${W / 2 - 80}" y="${y + 32}" width="160" height="6" rx="3" fill="#e0d6c4"/>`,
    `<rect x="${W / 2 - 80}" y="${y + 32}" width="${160 * progress}" height="6" rx="3" fill="#e0a43a"/>`,
  )
  const door =
    `<rect x="454" y="${y - 2}" width="48" height="60" rx="3" fill="#9c6b45"/><circle cx="494" cy="${y + 30}" r="2.4" fill="#f2cc8f"/>` +
    `<text x="478" y="${y + 12}" font-size="7.5" fill="#fff4dd" text-anchor="middle">remote</text>`
  const laptops = remote
    .slice(0, 6)
    .map((agent, i) => {
      const lx = 384 + (i % 3) * 22
      const ly = y + 8 + Math.floor(i / 3) * 24

      return `<g>${title(`${agent.name} (own session): ${agent.task}`)}<rect x="${lx}" y="${ly}" width="18" height="12" rx="1.5" fill="#4caf6a"/><rect x="${lx - 2}" y="${ly + 12}" width="22" height="3" rx="1" fill="#3a8a54"/>${view.selected === agent.id ? `<path class="hop" d="M${lx + 3} ${ly - 8}h12l-6 6z" fill="#ffb800"/>` : ''}</g>`
    })
    .join('')
  parts.push(door, laptops)
  if (remote.length > 6) {
    parts.push(`<text x="420" y="${y + 62}" font-size="8" fill="#4a3a28" text-anchor="middle">+${remote.length - 6} more</text>`)
  }

  return parts.join('')
}

/** The whole office as one SVG: the lead's corner office, the lounge, a floor of desks, and the strip the upgrades fill. */
export function scene(view: SceneView): { source: string; height: number } {
  const { atDesks } = seating(view.agents)
  const desks = Math.max(view.level.desks, atDesks.length)
  const rows = Math.ceil(desks / COLS)
  const stripTop = GRID_TOP + rows * CELL_H + 6
  const height = stripTop + STRIP
  const floor = Array.from({ length: desks }, (_, seat) => desk(view, seat, atDesks[seat])).join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}">` +
    `<style>${STYLE}</style>` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd4ff"/><stop offset="1" stop-color="#e3f3ff"/></linearGradient>` +
    `<pattern id="planks" width="40" height="20" patternUnits="userSpaceOnUse"><rect width="40" height="20" fill="#dcc6a2"/><path d="M0 19.5h40M20 0v10M0 10h40M5 10v10" stroke="#cbb28c" stroke-width="1"/></pattern></defs>` +
    `<rect x="0" y="0" width="${W}" height="${height}" fill="url(#planks)"/>` +
    wall(view) +
    leadOffice(view) +
    lounge(view) +
    `<text x="12" y="${GRID_TOP - 1}" font-size="9" font-weight="700" fill="#6b5a48">Work floor · ${atDesks.length} of ${desks} desks in use</text>` +
    floor +
    strip(view, stripTop) +
    `</svg>`

  return { source, height }
}

/** The office for a surface that draws no SVG: a few lines of text. */
export function textScene(view: SceneView): string[] {
  const { atDesks, lounge: resting, wentHome, remote } = seating(view.agents)
  const desks = Math.max(view.level.desks, atDesks.length)
  const floor = Array.from({ length: desks }, (_, seat) => {
    const agent = atDesks[seat]

    return agent ? `[${agent.doing.icon} ${clip(agent.name, 8)}]` : '[ · ]'
  }).join(' ')
  const lines = [
    `🪑 Lead office: Claude ${view.lead.doing.icon} ${view.lead.doing.text}`,
    `💻 Work floor: ${floor}`,
    `🛋️ Lounge: ${resting.length ? resting.map(a => `${a.status === 'failed' ? '😵' : '☕'} ${a.name}`).join('  ') : 'empty'}${wentHome ? `  (+${wentHome} went home)` : ''}`,
  ]
  if (remote.length) lines.push(`🛰️ Remote: ${remote.map(a => a.name).join(', ')}`)

  return lines
}
