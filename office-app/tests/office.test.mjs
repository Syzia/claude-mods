// Run with: npm test
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { Economy, PAY } from '../public/js/economy.js'
import { HALL, extentOf, lotsOf, planRooms } from '../public/js/layout.js'
import { Nav } from '../public/js/nav.js'
import { readSessions } from '../server.mjs'

const BUILT = new Set(['lead', 'lobby', 'break', 'engineering'])

function navFor(built = BUILT) {
  return new Nav(planRooms(built), extentOf(built))
}

test('the building grows a column at a time, with lots where rooms will open', () => {
  assert.equal(extentOf(BUILT), 22)
  assert.equal(extentOf(new Set([...BUILT, 'research'])), 33)
  const lots = lotsOf(new Set([...BUILT, 'research']))
  assert.deepEqual(lots.map(l => l.id), ['planning'])
})

test('people only cross walls through doors', () => {
  const nav = navFor()
  // From inside the lead office to the break room: out the door, down the hall, in the door.
  const path = nav.find({ x: 2, z: 2 }, { x: 15, z: 16 })
  assert.ok(path, 'there is a way')
  const regions = []
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]
    const b = path[i]
    assert.ok(nav.straight(a, b), `the leg ${JSON.stringify(a)} to ${JSON.stringify(b)} is walkable`)
    regions.push(nav.regionOf(b.x, b.z))
  }
  assert.ok(regions.includes('hall'), 'the way goes through the hall')
  // Straight through the wall between two rooms is never allowed.
  assert.equal(nav.straight({ x: 8.25, z: 4 }, { x: 9.75, z: 4 }), false)
})

test('a door lets people through only where it is', () => {
  const nav = navFor()
  const lead = planRooms(BUILT).find(r => r.id === 'lead')
  const [c, r] = nav.cellOf(lead.cx, HALL.z0 - 0.25)
  assert.equal(nav.canStep(c, r, c, r + 1), true, 'through the door')
  const [wc, wr] = nav.cellOf(0.75, HALL.z0 - 0.25)
  assert.equal(nav.canStep(wc, wr, wc, wr + 1), false, 'not through the wall beside it')
})

test('furniture blocks the cells under it', () => {
  const nav = navFor()
  assert.equal(nav.walkable(...nav.cellOf(15, 15)), true)
  nav.block(15, 15, 1.4, 0.7, 0)
  assert.equal(nav.walkable(...nav.cellOf(15, 15)), false)
  const around = nav.find({ x: 12, z: 15 }, { x: 18, z: 15 })
  assert.ok(around.every(p => nav.walkable(...nav.cellOf(p.x, p.z))))
})

function session(agents, career = { hired: agents.length, tasksDone: 0, turns: 0 }) {
  return { sessionId: 's1', agents, lead: { tools: 0 }, career }
}

test('the first look at a project only sets the baseline', () => {
  const economy = new Economy({})
  economy.credit('p', [session([{ id: 'a', name: 'Ada', tools: 40, status: 'working', task: 't' }])])
  assert.equal(economy.cash('p'), PAY.startingCash)
})

test('steps and finished work pay the company and the worker', () => {
  const economy = new Economy({})
  economy.credit('p', [session([])])
  economy.credit('p', [session([{ id: 'a', name: 'Ada', tools: 2, status: 'working', task: 't' }])])
  assert.equal(economy.cash('p'), PAY.startingCash + 2 * PAY.companyPerStep)
  assert.equal(economy.save.staff.Ada.wallet, 2 * PAY.walletPerStep)
  const { payouts } = economy.credit('p', [session([{ id: 'a', name: 'Ada', tools: 2, status: 'done', task: 't' }], { hired: 1, tasksDone: 1, turns: 0 })])
  assert.equal(economy.cash('p'), PAY.startingCash + 2 * PAY.companyPerStep + PAY.companyPerFinish + PAY.companyPerTask)
  assert.deepEqual(payouts.get('agent:s1:a'), { company: PAY.companyPerFinish, wallet: PAY.walletPerFinish })
  // Seeing the same snapshot again pays nothing more.
  economy.credit('p', [session([{ id: 'a', name: 'Ada', tools: 2, status: 'done', task: 't' }], { hired: 1, tasksDone: 1, turns: 0 })])
  assert.equal(economy.cash('p'), PAY.startingCash + 2 * PAY.companyPerStep + PAY.companyPerFinish + PAY.companyPerTask)
})

test('the demo keeps its own wallets', () => {
  const economy = new Economy({})
  economy.credit('demo', [session([])], { walletOf: name => `demo:${name}` })
  economy.credit('demo', [session([{ id: 'a', name: 'Ada', tools: 3, status: 'working', task: 't' }])], { walletOf: name => `demo:${name}` })
  assert.equal(economy.save.staff['demo:Ada'].wallet, 3 * PAY.walletPerStep)
  assert.equal(economy.save.staff.Ada, undefined)
})

test('the wardrobe charges once per item and refuses what the wallet cannot pay', () => {
  const economy = new Economy({})
  economy.staff('Ben', { hat: 'none' })
  economy.pay('Ben', 60)
  assert.deepEqual(economy.dress('Ben', 'hat', 'crown'), { ok: false, reason: 'wallet', cost: 400 })
  assert.equal(economy.dress('Ben', 'hat', 'beanie').ok, true)
  assert.equal(economy.save.staff.Ben.wallet, 10)
  economy.dress('Ben', 'hat', 'none')
  assert.equal(economy.priceOf('Ben', 'hat', 'beanie'), 0, 'owned items are free to wear again')
  const gift = economy.dress('Ben', 'hat', 'crown', { gift: true, project: 'p' })
  assert.equal(gift.ok, true)
  assert.equal(economy.cash('p'), PAY.startingCash - 400)
})

test('the server reads the snapshots the mod writes and skips stale or broken ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-feed-'))
  const fresh = { version: 1, sessionId: 'x', project: 'P', agents: [] }
  fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(fresh))
  fs.writeFileSync(path.join(dir, 'broken.json'), '{"version":1,')
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ ...fresh, sessionId: 'old' }))
  const old = Date.now() / 1000 - 13 * 3600
  fs.utimesSync(path.join(dir, 'old.json'), old, old)
  const sessions = readSessions(dir)
  assert.deepEqual(sessions.map(s => s.sessionId), ['x'])
  fs.rmSync(dir, { recursive: true })
})
