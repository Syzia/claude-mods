// The 3D office's local server: serves the app, streams the sessions the
// agent-office mod writes to ~/claude-mods/office-feed, and keeps the save file.
// Listens on this computer only (127.0.0.1).
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.OFFICE_PORT ?? 4747)
const FEED = process.env.OFFICE_FEED ?? path.join(os.homedir(), 'claude-mods', 'office-feed')
const SAVE = process.env.OFFICE_SAVE ?? path.join(HERE, 'save.json')
const ROOTS = {
  '/vendor/three/': path.join(HERE, 'node_modules', 'three'),
  '/': path.join(HERE, 'public'),
}
// A session whose snapshot is older than this has gone quiet: the office lets its staff go home.
const FRESH_MS = 12 * 60 * 60 * 1000
const SAVE_LIMIT = 4 * 1024 * 1024
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
}

/** Every live session the mod has written, newest first. A file caught mid-write is read on the next tick. */
export function readSessions(dir = FEED, now = Date.now()) {
  let names = []
  try {
    names = fs.readdirSync(dir).filter(name => name.endsWith('.json'))
  } catch {
    return []
  }
  const sessions = []
  for (const name of names) {
    const file = path.join(dir, name)
    try {
      const { mtimeMs } = fs.statSync(file)
      if (now - mtimeMs > FRESH_MS) continue
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (data?.version === 1 && Array.isArray(data.agents)) sessions.push({ ...data, seenAt: mtimeMs })
    } catch {
      // Half-written or not ours: skip it this time.
    }
  }

  return sessions.sort((a, b) => b.seenAt - a.seenAt)
}

function signature(dir = FEED) {
  try {
    return fs
      .readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => `${name}:${fs.statSync(path.join(dir, name)).mtimeMs}`)
      .join('|')
  } catch {
    return ''
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

function serveFile(res, urlPath) {
  const prefix = Object.keys(ROOTS).find(key => urlPath.startsWith(key))
  if (!prefix) return send(res, 404, 'Not found', 'text/plain')
  const root = ROOTS[prefix]
  const relative = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html'
  const file = path.resolve(root, relative)
  if (!file.startsWith(root + path.sep) && file !== root) return send(res, 403, 'Forbidden', 'text/plain')
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'Not found', 'text/plain')
    send(res, 200, data, TYPES[path.extname(file)] ?? 'application/octet-stream')
  })
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const streams = new Set()

function broadcast() {
  const payload = `event: feed\ndata: ${JSON.stringify({ sessions: readSessions() })}\n\n`
  for (const res of streams) res.write(payload)
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/ping') return send(res, 200, '{"ok":true,"app":"agent-office-3d"}')
    if (url.pathname === '/api/feed') return send(res, 200, JSON.stringify({ sessions: readSessions() }))
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
      res.write(`event: feed\ndata: ${JSON.stringify({ sessions: readSessions() })}\n\n`)
      streams.add(res)
      req.on('close', () => streams.delete(res))
      return
    }
    if (url.pathname === '/api/save' && req.method === 'GET') {
      fs.readFile(SAVE, 'utf8', (error, text) => send(res, 200, error ? '{}' : text))
      return
    }
    if (url.pathname === '/api/save' && req.method === 'POST') {
      try {
        const text = await readBody(req, SAVE_LIMIT)
        JSON.parse(text)
        const temp = `${SAVE}.tmp`
        fs.writeFileSync(temp, text)
        fs.renameSync(temp, SAVE)
        return send(res, 200, '{"ok":true}')
      } catch (error) {
        return send(res, 400, JSON.stringify({ ok: false, error: String(error.message ?? error) }))
      }
    }
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain')
    serveFile(res, url.pathname)
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.mkdirSync(FEED, { recursive: true })
  const server = createServer()
  let last = signature()
  setInterval(() => {
    const now = signature()
    if (now !== last) {
      last = now
      broadcast()
    }
  }, 600)
  setInterval(() => {
    for (const res of streams) res.write(': still here\n\n')
  }, 15000)
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.log(`The office is already open at http://127.0.0.1:${PORT}`)
      process.exit(0)
    }
    throw error
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`🏢 Agent Office is open at http://127.0.0.1:${PORT}`)
    console.log(`   Watching ${FEED}`)
    console.log('   Close this window to shut the office.')
  })
}
