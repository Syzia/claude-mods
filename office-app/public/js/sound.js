// The office's sound, synthesised live with Web Audio (no files): a rainy
// night outside with a low synth pad, and small effects for what happens inside.

let ctx = null
let master = null
let ambience = null
let enabled = true
/** 0 to 1: the volume slider. */
let volume = 0.35

function audio() {
  if (!ctx) {
    const Context = window.AudioContext ?? window.webkitAudioContext
    if (!Context) return null
    ctx = new Context()
    master = ctx.createGain()
    master.gain.value = enabled ? volume : 0
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Browsers start sound only after a click or a key: call this from one. */
export function wake() {
  if (audio() && enabled && !ambience) startAmbience()
}

export function setEnabled(on) {
  enabled = on
  const c = audio()
  if (!c) return
  master.gain.setTargetAtTime(on ? volume : 0, c.currentTime, 0.1)
  if (on && !ambience) startAmbience()
}

/** Sets the volume from the slider, 0 to 100. */
export function setVolume(percent) {
  volume = Math.max(0, Math.min(100, percent)) / 100
  if (ctx && master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05)
}

export function isEnabled() {
  return enabled
}

function noiseBuffer(c, seconds = 2) {
  const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** Rain on glass and a slow, low pad: quiet enough to forget about. */
function startAmbience() {
  const c = audio()
  if (!c) return
  const out = c.createGain()
  out.gain.value = 0
  out.gain.setTargetAtTime(1, c.currentTime, 2)
  out.connect(master)

  const rain = c.createBufferSource()
  rain.buffer = noiseBuffer(c, 3)
  rain.loop = true
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1400
  band.Q.value = 0.6
  const rainGain = c.createGain()
  rainGain.gain.value = 0.014
  rain.connect(band).connect(rainGain).connect(out)
  rain.start()

  const pad = c.createGain()
  pad.gain.value = 0.005
  const low = c.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = 520
  pad.connect(low).connect(out)
  for (const [freq, detune] of [
    [55, -6],
    [55, 7],
    [82.4, 0],
    [110, 3],
  ]) {
    const osc = c.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    osc.detune.value = detune
    osc.connect(pad)
    osc.start()
  }
  const lfo = c.createOscillator()
  const depth = c.createGain()
  lfo.frequency.value = 0.07
  depth.gain.value = 220
  lfo.connect(depth).connect(low.frequency)
  lfo.start()
  ambience = out
}

function tone(freq, start, length, { type = 'sine', gain = 0.2, attack = 0.01, decay = length } = {}) {
  const c = audio()
  if (!c || !enabled) return
  const t = c.currentTime + start
  const osc = c.createOscillator()
  const env = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(gain, t + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay)
  osc.connect(env).connect(master)
  osc.start(t)
  osc.stop(t + length + 0.05)
}

const hz = note => 440 * 2 ** ((note - 69) / 12)

/** Someone new walks in. */
export function blip() {
  tone(hz(84), 0, 0.18, { gain: 0.08, decay: 0.16 })
  tone(hz(91), 0.07, 0.2, { gain: 0.06, decay: 0.18 })
}

/** Work handed in and paid: a bell and a little cash register. */
export function payday() {
  tone(hz(88), 0, 0.6, { gain: 0.1, decay: 0.55 })
  tone(hz(95), 0.09, 0.6, { gain: 0.09, decay: 0.55 })
  tone(hz(100), 0.2, 0.25, { type: 'triangle', gain: 0.06, decay: 0.2 })
}

/** The whole plan is done. */
export function fanfare() {
  ;[72, 76, 79, 84].forEach((n, i) => tone(hz(n), i * 0.11, 0.16, { type: 'sawtooth', gain: 0.05, decay: 0.15 }))
  for (const n of [72, 76, 79, 84]) tone(hz(n), 0.48, 1.3, { type: 'triangle', gain: 0.07, attack: 0.03, decay: 1.25 })
}

/** Usage past the stop line. */
export function alarm() {
  for (let i = 0; i < 3; i += 1) {
    tone(hz(81), i * 0.42, 0.2, { type: 'square', gain: 0.04, decay: 0.19 })
    tone(hz(76), i * 0.42 + 0.2, 0.2, { type: 'square', gain: 0.04, decay: 0.19 })
  }
}

let rumbleBuffer = null

/** Brown noise (deep, most of its weight in the lows), three seconds of it, peaking at 1: thunder's raw rumble. */
function rumble(c) {
  if (rumbleBuffer?.sampleRate === c.sampleRate) return rumbleBuffer
  const buffer = c.createBuffer(1, c.sampleRate * 3, c.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  let peak = 0
  for (let i = 0; i < data.length; i += 1) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    data[i] = last
    peak = Math.max(peak, Math.abs(last))
  }
  for (let i = 0; i < data.length; i += 1) data[i] /= peak || 1
  rumbleBuffer = buffer
  return buffer
}

/**
 * Thunder far off, after a lightning glow: a low rumble about 2.5 s long that swells in softly and
 * rolls away, never a crack. Quiet (peaking at 0.04 x `strength`), through the master volume, so the
 * slider and mute hold. Silent until the sound has been woken by a click or a key.
 */
export function thunder(strength = 1) {
  if (!ctx || !enabled) return
  const c = audio()
  const k = Math.max(0, Math.min(1, strength))
  if (!c || k <= 0) return
  const t = c.currentTime + 0.05
  const length = 2.5
  const source = c.createBufferSource()
  source.buffer = rumble(c)
  // Two low-pass stages: steep enough that nothing sharp gets through, and the rumble darkens as it rolls away.
  const filters = [c.createBiquadFilter(), c.createBiquadFilter()]
  for (const filter of filters) {
    filter.type = 'lowpass'
    filter.Q.value = 0.5
    filter.frequency.setValueAtTime(180, t)
    filter.frequency.linearRampToValueAtTime(120, t + length)
  }
  const env = c.createGain()
  const peak = 0.04 * k
  env.gain.setValueAtTime(0, t)
  // A soft swell (no attack to speak of), a second roll just behind it, then a long fade.
  env.gain.linearRampToValueAtTime(peak * 0.6, t + 0.35)
  env.gain.linearRampToValueAtTime(peak, t + 0.85)
  env.gain.exponentialRampToValueAtTime(0.0001, t + length)
  source.connect(filters[0]).connect(filters[1]).connect(env).connect(master)
  source.start(t, Math.random() * 0.4)
  source.stop(t + length + 0.05)
}
