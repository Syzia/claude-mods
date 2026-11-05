// Synthesises the mod's sounds into ../sounds as 16-bit mono WAV files.
// Run with: node tools/make-sounds.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 44100
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sounds')

const hz = note => 440 * 2 ** ((note - 69) / 12)

/** A soft bell-like tone: a few harmonics with an exponential fade. */
function bell(samples, start, freq, length, gain = 0.5, decay = 4) {
  const from = Math.floor(start * RATE)
  const count = Math.floor(length * RATE)
  for (let i = 0; i < count && from + i < samples.length; i += 1) {
    const t = i / RATE
    const attack = Math.min(1, t / 0.008)
    const envelope = attack * Math.exp(-decay * t)
    const wave =
      Math.sin(2 * Math.PI * freq * t) +
      0.35 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-2 * t) +
      0.12 * Math.sin(2 * Math.PI * freq * 3.01 * t) * Math.exp(-6 * t)
    samples[from + i] += gain * envelope * wave
  }
}

/** A brighter synth note for the fanfare: detuned saws, smoothed. */
function brass(samples, start, freq, length, gain = 0.25) {
  const from = Math.floor(start * RATE)
  const count = Math.floor(length * RATE)
  let low = 0
  for (let i = 0; i < count && from + i < samples.length; i += 1) {
    const t = i / RATE
    const envelope = Math.min(1, t / 0.02) * Math.min(1, (length - t) / 0.08)
    const saw = f => 2 * ((t * f) % 1) - 1
    const raw = saw(freq) + saw(freq * 1.006) + 0.5 * saw(freq * 2.002)
    low += (raw - low) * 0.18
    samples[from + i] += gain * envelope * low
  }
}

function write(name, seconds, fill) {
  const samples = new Float32Array(Math.ceil(seconds * RATE))
  fill(samples)
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(Math.round((v / peak) * 0.8 * 32767), i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, name), Buffer.concat([header, data]))
  console.log('wrote', name)
}

// An agent finished: two rising bell notes.
write('finish.wav', 1.1, s => {
  bell(s, 0, hz(76), 1.0, 0.5, 5)
  bell(s, 0.12, hz(83), 0.95, 0.45, 4.5)
})

// Someone new joined: one soft, short blip.
write('hire.wav', 0.5, s => bell(s, 0, hz(72), 0.45, 0.4, 9))

// The whole plan is done: a little fanfare and a held chord.
write('party.wav', 2.0, s => {
  const notes = [72, 76, 79, 84]
  notes.forEach((n, i) => brass(s, i * 0.12, hz(n), 0.16))
  for (const n of [72, 76, 79, 84]) brass(s, 0.55, hz(n), 1.3, 0.18)
  bell(s, 0.55, hz(96), 1.2, 0.25, 3)
})

// Usage passed 90%: a two-tone warning, three times.
write('alarm.wav', 1.4, s => {
  for (let i = 0; i < 3; i += 1) {
    bell(s, i * 0.44, hz(81), 0.22, 0.5, 2)
    bell(s, i * 0.44 + 0.2, hz(76), 0.22, 0.5, 2)
  }
})
