// The heads-up display over the 3D office: top bar, staff list, the card for
// whoever is selected, the event ticker, room shortcuts, the build shop and
// the wardrobe. Plain DOM; every button carries a data-action.

import { CATALOG, RANKS, ROOMS_FOR_SALE, STOP_AT, WARN_FROM, WARDROBE } from './economy.js'
import { GLASSES, EXTRAS, HAIRS, HAIR_COLORS, HATS, PANTS, SHIRTS, SKINS } from './people.js'
import { escapeHtml as esc, money } from './util.js'

const LABELS = {
  hat: { none: 'No hat', cap: 'Cap', beanie: 'Beanie', party: 'Party hat', tophat: 'Top hat', crown: 'Crown' },
  glasses: { none: 'None', round: 'Round', shades: 'Shades', visor: 'Neon visor' },
  extra: { none: 'None', headphones: 'Headphones', tie: 'Tie', bowtie: 'Bow tie', scarf: 'Scarf' },
  hair: { short: 'Short', long: 'Long', bun: 'Bun', spiky: 'Spiky', curly: 'Curly', mohawk: 'Mohawk', bald: 'Bald' },
}

export class UI {
  constructor(root, actions) {
    this.root = root
    this.actions = actions
    this.lastProjects = ''
    this.ticks = []
    root.innerHTML = `
      <div class="topbar panel" data-ref="top"></div>
      <div class="banner panel" data-ref="banner" hidden></div>
      <section class="staff panel" data-ref="staff">
        <header><span>👥 Staff</span><span class="hint" data-ref="count"></span></header>
        <div class="list" data-ref="list"></div>
      </section>
      <section class="inspector panel" data-ref="inspector" hidden></section>
      <div class="ticker" data-ref="ticker"></div>
      <nav class="dock panel" data-ref="dock"></nav>
      <section class="build panel" data-ref="build" hidden></section>
      <div class="help">Drag to move · Right-drag to turn · Scroll to zoom · WASD to pan · Click someone</div>
      <div class="modal-back" data-ref="modal" hidden></div>
      <div class="tooltip" data-ref="tooltip" hidden></div>
    `
    this.refs = {}
    for (const el of root.querySelectorAll('[data-ref]')) this.refs[el.dataset.ref] = el
    // Panels redraw a few times a second, so buttons act on press, not on a full click.
    root.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const target = event.target.closest('[data-action]')
      if (!target) {
        if (event.target === this.refs.modal) this.closeModal()
        return
      }
      if (target.disabled) return
      event.preventDefault()
      const { action, ...rest } = target.dataset
      this.actions[action]?.(rest, event)
    })
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target.closest('[data-action]')
      if (!target) return
      event.preventDefault()
      const { action, ...rest } = target.dataset
      this.actions[action]?.(rest, event)
    })
    root.addEventListener('change', event => {
      const target = event.target.closest('[data-change]')
      if (target) this.actions[target.dataset.change]?.(target.type === 'checkbox' ? target.checked : target.value)
    })
    this.drawn = new Map()
  }

  renderTop({ projectKey, projects, rankIndex, cash, goal, done, total, building, usage, sound, volume }) {
    const signature = projects.map(p => `${p.key}:${p.name}`).join('|') + projectKey
    const stars = '★'.repeat(rankIndex + 1) + '☆'.repeat(Math.max(0, 5 - rankIndex))
    const pct = total ? Math.round((100 * done) / total) : 0
    const top = this.refs.top
    if (signature !== this.lastProjects || !top.firstChild) {
      this.lastProjects = signature
      top.innerHTML = `
        <div class="brand">🏢 <select data-change="project" aria-label="Project">${projects
          .map(p => `<option value="${esc(p.key)}" ${p.key === projectKey ? 'selected' : ''}>${esc(p.name)}</option>`)
          .join('')}</select></div>
        <div class="stat rank" data-ref="rank"></div>
        <div class="stat cash" data-ref="cash"></div>
        <div class="stat power" data-ref="power" title="Your Claude usage: this 5-hour session and this week. Past ${STOP_AT}% the office warns you."></div>
        <div class="goal"><div class="goal-text" data-ref="goal"></div><div class="bar"><span data-ref="progress"></span></div></div>
        <div class="tools">
          <button class="btn" data-action="build" data-ref="buildBtn">🔨 Build</button>
          <button class="btn" data-action="toggleStaff" title="Show or hide the staff list">👥</button>
          <span class="volume"><button class="btn" data-action="sound" data-ref="soundBtn" title="Sound on or off">🔊</button><input type="range" min="0" max="100" step="1" data-change="volume" data-ref="volume" title="Volume" aria-label="Volume" /></span>
          <button class="btn" data-action="recenter" title="Back to the whole office">🧭</button>
        </div>`
      for (const el of top.querySelectorAll('[data-ref]')) this.refs[el.dataset.ref] = el
    }
    this.refs.rank.innerHTML = `<span class="stars">${stars}</span> ${esc(RANKS[rankIndex] ?? '')}`
    this.refs.cash.textContent = `💰 ${money(cash)}`
    const power = this.refs.power
    const has = usage && (usage.session !== null || usage.week !== null)
    power.hidden = !has
    if (has) {
      const parts = [usage.session !== null ? `${Math.round(usage.session)}%` : null, usage.week !== null ? `week ${Math.round(usage.week)}%` : null].filter(Boolean)
      power.textContent = `⚡ ${parts.join(' · ')}${usage.pretend ? ' (pretend)' : ''}`
      const top = Math.max(usage.session ?? 0, usage.week ?? 0)
      power.classList.toggle('warn', top >= STOP_AT)
      power.classList.toggle('high', top >= WARN_FROM && top < STOP_AT)
    }
    this.refs.goal.innerHTML = `🎯 ${esc(goal || 'No goal yet: send Claude a prompt')} <span style="color:var(--muted)">· ${done}/${total} tasks</span>`
    this.refs.progress.style.width = `${pct}%`
    this.refs.buildBtn.classList.toggle('on', building)
    this.refs.soundBtn.textContent = sound ? '🔊' : '🔇'
    if (document.activeElement !== this.refs.volume) this.refs.volume.value = String(volume)
    this.refs.volume.disabled = !sound
  }

  renderBanner(text) {
    const banner = this.refs.banner
    banner.hidden = !text
    if (text) banner.innerHTML = text
  }

  /** The staff list, grouped by room and then by team. */
  renderStaff(groups, selectedKey) {
    const total = groups.reduce((n, g) => n + g.teams.reduce((m, t) => m + t.people.length, 0), 0)
    this.refs.count.textContent = `${total} on site`
    this.draw('list', groups
      .map(
        group => `
        <div class="group-title"><span class="dot" style="background:${group.color}"></span>${esc(group.name)} · ${group.teams.reduce((n, t) => n + t.people.length, 0)}</div>
        ${group.teams
          .map(
            team => `<div class="${team.label ? 'team' : ''}">
              ${team.label ? `<div class="team-label">${esc(team.label)}</div>` : ''}
              ${team.people
                .map(
                  p => `<button class="person-row ${p.key === selectedKey ? 'selected' : ''}" data-action="select" data-key="${esc(p.key)}">
                    <span class="avatar" style="background:${p.color}">${p.icon}</span>
                    <span class="who"><div class="name">${esc(p.name)}</div><div class="what">${esc(p.what)}</div></span>
                  </button>`,
                )
                .join('')}
            </div>`,
          )
          .join('')}`,
      )
      .join(''))
  }

  /** Replaces a panel's HTML only when it changed, so nothing flickers under the pointer. */
  draw(ref, html) {
    if (this.drawn.get(ref) === html) return
    this.drawn.set(ref, html)
    this.refs[ref].innerHTML = html
  }

  toggleStaff() {
    this.refs.staff.hidden = !this.refs.staff.hidden
  }

  /** The card for the selected person, or nothing. */
  renderInspector(card) {
    const panel = this.refs.inspector
    if (!card) {
      panel.hidden = true
      return
    }
    panel.hidden = false
    this.draw('inspector', `
      <header><span class="badge" style="background:${card.color}">${esc(card.role)}</span>
        <span><button class="icon-btn" data-action="follow" title="Follow with the camera">${card.following ? '📌' : '🎥'}</button><button class="icon-btn" data-action="deselect" title="Close">✕</button></span></header>
      <div class="body">
        <h2>${esc(card.name)}</h2>
        <div>${esc(card.status)}</div>
        ${card.task ? `<div><div class="label">Task</div>${esc(card.task)}</div>` : ''}
        ${card.now ? `<div class="now">${esc(card.now)}</div>` : ''}
        ${card.activity ? `<div><div class="label">Right now</div>${esc(card.activity)}</div>` : ''}
        ${
          card.steps?.length
            ? `<div><div class="label">Recent steps (${card.stepCount} in all)</div><ul class="steps">${card.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>`
            : ''
        }
        ${card.report ? `<div><div class="label">Report</div>${esc(card.report)}</div>` : ''}
        ${
          card.wallet !== undefined
            ? `<div class="wallet"><span class="stat">👛 ${money(card.wallet)}</span><span class="stat">💵 earned ${money(card.earned)}</span><span class="stat">🛍️ ${card.bought}</span></div>`
            : ''
        }
        <div class="row-buttons">
          ${card.canDress ? '<button class="btn gold" data-action="wardrobe">👕 Customise</button>' : ''}
          <button class="btn" data-action="focus">🔍 Find</button>
        </div>
      </div>`)
  }

  tick({ icon, text, money: amount }) {
    this.ticks.unshift({ icon, text, amount, at: Date.now() })
    this.ticks = this.ticks.slice(0, 6)
    this.refs.ticker.innerHTML = this.ticks
      .map(
        (t, i) =>
          `<div class="tick ${i > 2 ? 'old' : ''}"><span>${t.icon}</span><span>${esc(t.text)}</span>${
            t.amount ? `<span class="money">+${money(t.amount)}</span>` : ''
          }</div>`,
      )
      .join('')
  }

  toast(text) {
    const el = document.createElement('div')
    el.className = 'toast panel'
    el.textContent = text
    this.root.appendChild(el)
    setTimeout(() => el.remove(), 3200)
  }

  renderDock(rooms) {
    this.refs.dock.innerHTML = rooms.map(r => `<button class="chip" data-action="room" data-id="${r.id}">${esc(r.name)}</button>`).join('')
  }

  /** Build mode's shop: furniture to place, rooms to buy, and the piece you picked up. */
  renderBuild(state) {
    const panel = this.refs.build
    if (!state) {
      panel.hidden = true
      return
    }
    panel.hidden = false
    const groups = [...new Set(CATALOG.map(c => c.group))]
    panel.innerHTML = `
      <header>🔨 Build mode <span class="hint">${esc(state.hint)}</span>
        <span style="margin-left:auto"><button class="btn" data-action="build">Done</button></span></header>
      ${groups
        .map(
          group => `<div class="label" style="margin:6px 2px">${group}</div><div class="catalog">${CATALOG.filter(c => c.group === group)
            .map(c => {
              const locked = c.rank > state.rankIndex
              return `<button class="item ${locked ? 'locked' : ''} ${state.placing === c.type ? 'active' : ''}" data-action="pick" data-type="${c.type}" ${locked ? 'disabled' : ''}>
                <span class="icon">${c.icon}</span><span>${esc(c.name)}</span>
                <span class="price">${locked ? `🔒 ${esc(RANKS[c.rank])}` : money(c.price)}</span></button>`
            })
            .join('')}</div>`,
        )
        .join('')}
      <div class="label" style="margin:10px 2px 6px">Rooms</div>
      <div class="catalog">${ROOMS_FOR_SALE.map(room => {
        const owned = state.built.includes(room.id)
        const locked = room.rank > state.rankIndex
        return `<button class="item ${locked ? 'locked' : ''}" data-action="buyRoom" data-id="${room.id}" ${owned || locked ? 'disabled' : ''}>
          <span class="icon">${room.icon}</span><span>${esc(room.name)}</span>
          <span class="price">${owned ? '✓ Built' : locked ? `🔒 ${esc(RANKS[room.rank])}` : money(room.price)}</span></button>`
      }).join('')}</div>
      ${
        state.selected
          ? `<div class="selection">${state.selected.icon} ${esc(state.selected.name)}
              <button class="btn" data-action="move">↔ Move</button>
              <button class="btn" data-action="sell">💲 Sell for ${money(state.selected.refund)}</button></div>`
          : ''
      }`
  }

  /** The wardrobe: every part of a look, with what it costs this person. */
  openWardrobe(model) {
    const modal = this.refs.modal
    modal.hidden = false
    const slots = [
      { slot: 'hat', values: HATS, label: 'Hat' },
      { slot: 'glasses', values: GLASSES, label: 'Glasses' },
      { slot: 'extra', values: EXTRAS, label: 'Extra' },
      { slot: 'hair', values: HAIRS, label: 'Hair' },
      { slot: 'hairColor', values: HAIR_COLORS, label: 'Hair colour', swatch: true },
      { slot: 'shirt', values: SHIRTS, label: 'Shirt', swatch: true },
      { slot: 'pants', values: PANTS, label: 'Trousers', swatch: true },
      { slot: 'skin', values: SKINS, label: 'Skin', swatch: true },
    ]
    modal.innerHTML = `
      <div class="wardrobe panel">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <h2>👕 ${esc(model.name)}'s wardrobe</h2>
          <button class="icon-btn" data-action="closeModal">✕</button>
        </div>
        <div class="wallet" style="margin:6px 0 4px">
          <span class="stat">👛 Wallet ${money(model.wallet)}</span>
          <span class="stat cash">💰 Company ${money(model.cash)}</span>
        </div>
        <label style="font-size:13px;font-weight:700;display:flex;gap:6px;align-items:center">
          <input type="checkbox" data-change="gift" ${model.gift ? 'checked' : ''} /> The company pays (a gift)
        </label>
        ${slots
          .map(({ slot, values, label, swatch }) => {
            const table = WARDROBE[slot]
            return `<div class="slot"><div class="label">${label}${typeof table === 'number' && table > 0 ? ` · ${money(table)} a change` : ''}</div><div class="options">${values
              .map(value => {
                const current = model.look[slot] === value
                const price = model.price(slot, value)
                const owned = typeof table === 'object' && value !== 'none' && model.owned.includes(`${slot}:${value}`)
                const tag = current ? '' : owned ? '<span class="owned">owned</span>' : price > 0 ? `<span class="cost">${money(price)}</span>` : ''
                const body = swatch ? `<span class="swatch" style="background:${value}"></span>` : esc(LABELS[slot]?.[value] ?? value)
                return `<button class="opt ${current ? 'current' : ''}" data-action="dress" data-slot="${slot}" data-value="${esc(value)}">${body}${tag}</button>`
              })
              .join('')}</div></div>`
          })
          .join('')}
      </div>`
  }

  closeModal() {
    this.refs.modal.hidden = true
    this.refs.modal.innerHTML = ''
    this.actions.modalClosed?.()
  }

  tooltip(x, y, html) {
    const tip = this.refs.tooltip
    if (!html) {
      tip.hidden = true
      return
    }
    tip.hidden = false
    tip.innerHTML = html
    tip.style.left = `${x}px`
    tip.style.top = `${y}px`
  }
}
