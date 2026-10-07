import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { AirTouchClient } from './airtouch/client.js'
import { discover } from './airtouch/discovery.js'
import { History } from './history.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const DATA_DIR = path.join(__dirname, '..', 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist')

// ---------------------------------------------------------------------------
// Config persistence (just the console IP we last connected to)
// ---------------------------------------------------------------------------

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

let config = loadConfig()

const IS_SIM = process.argv.includes('--sim') || process.env.AIRTOUCH_SIM === '1'
const history = new History(path.join(DATA_DIR, 'history.db'), { persist: !IS_SIM })
if (!IS_SIM) history.importJson(path.join(DATA_DIR, 'history.json'))

// ---------------------------------------------------------------------------
// AirTouch client lifecycle
// ---------------------------------------------------------------------------

let client = null

function connectTo(ip, name, { persist = true } = {}) {
  if (client) {
    client.destroy()
    client = null
  }
  client = new AirTouchClient(ip)
  client.on('state', () => broadcastState())
  client.connect()
  config = { ...config, consoleIp: ip, consoleName: name }
  if (persist) saveConfig(config)
}

// A wireless sensor whose reading hasn't moved at all for this long has
// likely stopped reporting (out of range, stuck) — the console keeps
// repeating the last value it heard, so the UI should hint at it.
const STALE_TEMP_WINDOW = 3 * 3600_000

function currentState() {
  if (!client) {
    return { connection: { status: 'unconfigured' }, acs: [], zones: [] }
  }
  const state = client.getState()
  if (config.consoleName) state.connection.consoleName = config.consoleName
  for (const zone of state.zones) {
    zone.tempStale =
      zone.hasSensor &&
      zone.currentTemp != null &&
      history.isFlat(zone.id, zone.currentTemp, STALE_TEMP_WINDOW)
  }
  return state
}

// ---------------------------------------------------------------------------
// HTTP server: static files + small JSON API
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (urlPath === '/') urlPath = '/index.html'
  const filePath = path.join(WEB_DIST, path.normalize(urlPath))
  if (!filePath.startsWith(WEB_DIST) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // SPA fallback
    const index = path.join(WEB_DIST, 'index.html')
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(fs.readFileSync(index))
    } else {
      res.writeHead(404)
      res.end('Not found. Run `npm run build` first, or use `npm run dev`.')
    }
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
  res.end(fs.readFileSync(filePath))
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://x')
  const json = (code, body) => {
    const data = JSON.stringify(body)
    // History responses run to tens of KB; worth compressing for phones on the tailnet.
    if (data.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
      return res.end(zlib.gzipSync(data))
    }
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(data)
  }

  try {
    if (url.pathname === '/api/discover' && req.method === 'POST') {
      const consoles = await discover(3000)
      return json(200, { consoles })
    }
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      const body = await readBody(req)
      const ip = String(body.ip || '').trim()
      if (!ip) return json(400, { error: 'ip is required' })
      connectTo(ip, body.name ? String(body.name) : undefined)
      return json(200, { ok: true })
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return json(200, currentState())
    }
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const num = (key) => (url.searchParams.has(key) ? Number(url.searchParams.get(key)) : undefined)
      return json(
        200,
        history.query({ from: num('from'), to: num('to'), points: num('points'), tzOffset: num('tz') }),
      )
    }
    return json(404, { error: 'not found' })
  } catch (err) {
    return json(500, { error: String(err?.message || err) })
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res)
  return serveStatic(req, res)
})

// ---------------------------------------------------------------------------
// WebSocket hub: pushes full state to all clients, receives commands
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' })

function broadcastState() {
  const message = JSON.stringify({ type: 'state', state: currentState() })
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(message)
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', state: currentState() }))

  ws.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    try {
      await handleCommand(msg)
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', error: String(err?.message || err) }))
    }
  })
})

async function handleCommand(msg) {
  switch (msg.cmd) {
    case 'connect':
      connectTo(String(msg.ip), msg.name ? String(msg.name) : undefined)
      broadcastState()
      return
    case 'discover': {
      const consoles = await discover(3000)
      const message = JSON.stringify({ type: 'discovered', consoles })
      for (const ws of wss.clients) {
        if (ws.readyState === ws.OPEN) ws.send(message)
      }
      return
    }
  }

  if (!client) throw new Error('Not connected to a console')

  switch (msg.cmd) {
    case 'ac.power':
      return client.setAcPower(msg.ac, msg.state)
    case 'ac.mode':
      return client.setAcMode(msg.ac, msg.mode)
    case 'ac.fan':
      return client.setAcFanSpeed(msg.ac, msg.speed)
    case 'ac.setpoint':
      return client.setAcSetpoint(msg.ac, msg.value)
    case 'ac.quickTimer':
      return client.setQuickTimer(msg.ac, msg.type, msg.minutes)
    case 'ac.cancelTimer':
      return client.cancelTimer(msg.ac, msg.type)
    case 'zone.power':
      return client.setZonePower(msg.zone, msg.state)
    case 'zone.percent':
      return client.setZonePercent(msg.zone, msg.value)
    case 'zone.setpoint':
      return client.setZoneSetpoint(msg.zone, msg.value)
    case 'zones.allPower': {
      const state = client.getState()
      for (const zone of state.zones) {
        await client.setZonePower(zone.id, msg.state)
      }
      return
    }
    default:
      throw new Error(`Unknown command: ${msg.cmd}`)
  }
}

// Fill history with a year of plausible past data so the chart demos nicely in
// sim mode: daily and seasonal swings, minute samples for the last two days and
// five-minute samples before that (keeps startup quick).
function seedDemoHistory(sim) {
  const now = Date.now()
  const day = 24 * 3600_000
  const sensorZones = sim.zones.filter((z) => z.currentTemp != null)
  const target = (t, id) => {
    const d = new Date(t)
    const daily = Math.sin(((d.getHours() + d.getMinutes() / 60 - 14) / 24) * 2 * Math.PI) // warmest mid-afternoon
    const seasonal = Math.cos(((t / day - 17) / 365.25) * 2 * Math.PI) // warmest mid-January
    return 21 + seasonal * 4 + daily * 2.5 + id * 0.4
  }
  const start = now - 365 * day
  const temps = new Map(sensorZones.map((z) => [z.id, target(start, z.id)]))
  const raw = []
  for (let t = start; t < now; ) {
    const interval = t < now - 2 * day ? 300_000 : 60_000
    const minutes = interval / 60_000
    const zones = {}
    for (const [id, temp] of temps) {
      const next =
        temp +
        (target(t, id) - temp) * (1 - 0.97 ** minutes) +
        (Math.random() - 0.5) * 0.12 * Math.sqrt(minutes)
      temps.set(id, next)
      zones[id] = next
    }
    raw.push({ t, zones })
    t += interval
  }
  // Morph the last day of each series so it meets the sim's live temperature —
  // otherwise the first real sample after startup shows a vertical jump.
  const last = raw[raw.length - 1].zones
  const offsets = new Map(sensorZones.map((z) => [z.id, z.currentTemp - last[z.id]]))
  history.record(
    raw.map(({ t, zones }) => {
      const progress = Math.max(0, 1 - (now - t) / day)
      const rounded = {}
      for (const [id, v] of Object.entries(zones)) {
        rounded[id] = Math.round((v + offsets.get(Number(id)) * progress) * 10) / 10
      }
      return { t, zones: rounded, acs: { 0: rounded[0] ?? 23 } }
    }),
  )
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

server.listen(PORT, async () => {
  console.log(`AirTouch web bridge listening on http://localhost:${PORT}`)
  history.start(() => currentState())
  // SIGTERM is what `docker stop` sends.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      history.close()
      process.exit(0)
    })
  }

  // `--sim` (or AIRTOUCH_SIM=1) runs an embedded simulated console and
  // connects to it — handy for trying the app without hardware.
  if (IS_SIM) {
    const { AirTouchSimulator } = await import('./simulator/sim.js')
    const sim = new AirTouchSimulator({ tcpPort: 9005, discovery: true })
    sim.start()
    console.log('Running with embedded simulator')
    connectTo('127.0.0.1', 'Simulated AirTouch', { persist: false })
    seedDemoHistory(sim)
    return
  }

  const ip = process.env.AIRTOUCH_IP || config.consoleIp
  if (ip) {
    console.log(`Connecting to AirTouch console at ${ip}`)
    connectTo(ip, config.consoleName)
  } else {
    console.log('No console configured yet — open the web app to discover one.')
  }
})
