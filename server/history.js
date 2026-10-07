import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SAMPLE_INTERVAL = 60_000
const HOUR = 3600
const DAY = 86400

// Bucket widths (seconds) a history query can aggregate to, finest first.
// Each query picks the finest one that keeps it under MAX_POINTS buckets, so
// the response (and the chart drawing it) stays the same size however much
// history has piled up. No 6h/12h: buckets that split the day into a few
// parts alternate between day and night averages and draw as a zigzag.
const STEPS = [60, 120, 300, 600, 900, HOUR, 2 * HOUR, 3 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 28 * DAY]
const MAX_POINTS = 1000

// Temps are stored in tenths of a degree (the console's resolution) and times
// in Unix seconds. Sensors are keyed `z<id>` for zones, `a<id>` for ACs.
// Every reading is kept forever; the rollups exist so long ranges read a
// bounded number of rows (sub-hour buckets come from `readings`, sub-day from
// `hourly`, the rest from `daily`) and can be rebuilt from `readings`.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS readings (
    t INTEGER NOT NULL,
    sensor TEXT NOT NULL,
    temp INTEGER NOT NULL,
    PRIMARY KEY (t, sensor)
  ) WITHOUT ROWID;
  -- t is the UTC hour start
  CREATE TABLE IF NOT EXISTS hourly (
    t INTEGER NOT NULL,
    sensor TEXT NOT NULL,
    n INTEGER NOT NULL,
    total INTEGER NOT NULL,
    lo INTEGER NOT NULL,
    hi INTEGER NOT NULL,
    PRIMARY KEY (t, sensor)
  ) WITHOUT ROWID;
  -- t is local midnight in the server's timezone (meta.dayTz)
  CREATE TABLE IF NOT EXISTS daily (
    t INTEGER NOT NULL,
    sensor TEXT NOT NULL,
    n INTEGER NOT NULL,
    total INTEGER NOT NULL,
    lo INTEGER NOT NULL,
    hi INTEGER NOT NULL,
    PRIMARY KEY (t, sensor)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

const rollupUpsert = (table) => `
  INSERT INTO ${table} (t, sensor, n, total, lo, hi) VALUES ($t, $sensor, $n, $total, $lo, $hi)
  ON CONFLICT (t, sensor) DO UPDATE SET
    n = n + excluded.n,
    total = total + excluded.total,
    lo = min(lo, excluded.lo),
    hi = max(hi, excluded.hi)`

// Bucket queries per source table. Bound numbers arrive as REALs, hence the
// casts to keep the bucket division integral.
const bucketQuery = (table, aggregates) => `
  SELECT sensor, (t + CAST($shift AS INTEGER)) / CAST($step AS INTEGER) AS b, ${aggregates}
  FROM ${table}
  WHERE t >= $lo AND t < $hi AND sensor GLOB 'z*'
  GROUP BY b, sensor
  ORDER BY b`
const ROLLUP_AGGREGATES = 'sum(n) AS n, sum(total) AS total, min(lo) AS lo, max(hi) AS hi'

function localMidnight(t) {
  const d = new Date(t * 1000)
  d.setHours(0, 0, 0, 0)
  return d.getTime() / 1000
}

function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Records zone/AC temperatures once a minute into SQLite, indefinitely, and
 * serves downsampled ranges of it for the history chart.
 */
export class History {
  constructor(filePath, { persist = true } = {}) {
    if (persist) fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.db = new DatabaseSync(persist ? filePath : ':memory:')
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    this.db.exec(SCHEMA)
    this.timers = []
    this.stmt = {
      reading: this.db.prepare('INSERT OR IGNORE INTO readings (t, sensor, temp) VALUES ($t, $sensor, $temp)'),
      hourly: this.db.prepare(rollupUpsert('hourly')),
      daily: this.db.prepare(rollupUpsert('daily')),
      earliest: this.db.prepare('SELECT min(t) AS t FROM readings'),
      flat: this.db.prepare(
        'SELECT min(t) AS oldest, min(temp) AS lo, max(temp) AS hi FROM readings WHERE t >= $cutoff AND sensor = $sensor',
      ),
      buckets: {
        readings: this.db.prepare(
          bucketQuery('readings', 'count(*) AS n, sum(temp) AS total, min(temp) AS lo, max(temp) AS hi'),
        ),
        hourly: this.db.prepare(bucketQuery('hourly', ROLLUP_AGGREGATES)),
        daily: this.db.prepare(bucketQuery('daily', ROLLUP_AGGREGATES)),
      },
    }
    this.syncDayBoundaries()
  }

  /** getState: () => AppState | null */
  start(getState) {
    this.stop()
    this.timers.push(setInterval(() => this.sample(getState()), SAMPLE_INTERVAL))
  }

  stop() {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  close() {
    this.stop()
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  sample(state) {
    if (!state || state.connection.status !== 'connected') return
    const zones = {}
    for (const zone of state.zones) {
      if (zone.currentTemp != null) zones[zone.id] = zone.currentTemp
    }
    const acs = {}
    for (const ac of state.acs) {
      if (ac.currentTemp != null) acs[ac.id] = ac.currentTemp
    }
    if (Object.keys(zones).length === 0 && Object.keys(acs).length === 0) return
    this.record([{ t: Date.now(), zones, acs }])
  }

  /** samples: [{ t: ms, zones: { [id]: temp }, acs: { [id]: temp } }] */
  record(samples) {
    this.transaction(() => {
      for (const { t: ms, zones = {}, acs = {} } of samples) {
        const t = Math.round(ms / 1000)
        const day = localMidnight(t)
        const readings = [
          ...Object.entries(zones).map(([id, temp]) => [`z${id}`, temp]),
          ...Object.entries(acs).map(([id, temp]) => [`a${id}`, temp]),
        ]
        for (const [sensor, temp] of readings) {
          if (temp == null) continue
          const v = Math.round(temp * 10)
          if (this.stmt.reading.run({ t, sensor, temp: v }).changes === 0) continue
          const one = { sensor, n: 1, total: v, lo: v, hi: v }
          this.stmt.hourly.run({ ...one, t: t - (t % HOUR) })
          this.stmt.daily.run({ ...one, t: day })
        }
      }
    })
  }

  /**
   * One-off import of the JSON file older versions kept (48h of samples).
   * Renamed afterwards so it isn't imported twice.
   */
  importJson(jsonPath) {
    let samples
    try {
      samples = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    } catch {
      return
    }
    if (Array.isArray(samples)) this.record(samples)
    fs.renameSync(jsonPath, `${jsonPath}.imported`)
    console.log(`Imported ${Array.isArray(samples) ? samples.length : 0} history samples from ${jsonPath}`)
  }

  /**
   * Daily rollups are keyed by local midnight, so they depend on the server's
   * timezone. If it changed since they were built, rebuild them from the
   * hourly rollups.
   */
  syncDayBoundaries() {
    const tz = currentTimeZone()
    const stored = this.db.prepare("SELECT value FROM meta WHERE key = 'dayTz'").get()?.value
    if (stored === tz) return
    if (stored != null) {
      this.transaction(() => {
        this.db.exec('DELETE FROM daily')
        for (const row of this.db.prepare('SELECT * FROM hourly').iterate()) {
          this.stmt.daily.run({ ...row, t: localMidnight(row.t) })
        }
      })
      console.log(`Rebuilt daily history rollups for timezone ${tz} (was ${stored})`)
    }
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('dayTz', ?)").run(tz)
  }

  /**
   * True when every recorded temperature for the zone over the past window
   * equals `value` — a reading that flat means the sensor has likely stopped
   * reporting. Requires samples spanning most of the window, so a freshly
   * started history can't false-flag.
   */
  isFlat(zoneId, value, windowMs) {
    const cutoff = Math.round((Date.now() - windowMs) / 1000)
    const { oldest, lo, hi } = this.stmt.flat.get({ cutoff, sensor: `z${zoneId}` })
    const v = Math.round(value * 10)
    return oldest != null && lo === v && hi === v && (oldest - cutoff) * 1000 < windowMs * 0.1
  }

  /**
   * Zone temperatures between `from` and `to` (ms; `from` defaults to the
   * first reading, `to` to now), aggregated into at most `points` buckets
   * aligned to local time (`tzOffset`: minutes east of UTC).
   *
   * Returns { from, to, step, earliest, t, zones } where `t` holds bucket
   * starts (ms) and `zones[id]` holds parallel avg/lo/hi arrays (null where
   * the zone had no readings in that bucket).
   */
  query({ from, to, points, tzOffset } = {}) {
    const valid = (n) => n != null && Number.isFinite(n)
    const earliestS = this.stmt.earliest.get().t
    const earliest = earliestS != null ? earliestS * 1000 : null
    to = valid(to) ? to : Date.now()
    from = valid(from) ? from : (earliest ?? to - HOUR * 1000)
    if (from >= to) from = to - HOUR * 1000
    const maxPoints = valid(points) ? Math.min(MAX_POINTS, Math.max(50, points)) : MAX_POINTS
    const off = (valid(tzOffset) ? Math.round(tzOffset) : -new Date().getTimezoneOffset()) * 60

    const fromS = Math.floor(from / 1000)
    const toS = Math.ceil(to / 1000)
    const step = STEPS.find((s) => (toS - fromS) / s <= maxPoints) ?? STEPS.at(-1)
    const table = step < HOUR ? 'readings' : step < DAY ? 'hourly' : 'daily'
    // Daily rows sit at local midnight, which drifts an hour either side of
    // the fixed-offset grid across DST; nudging by half a day lands each on
    // the right bucket.
    const shift = off + (table === 'daily' ? DAY / 2 : 0)
    const firstB = Math.floor((fromS + off) / step)
    const lastB = Math.floor((toS - 1 + off) / step)
    const rows = this.stmt.buckets[table].all({
      shift,
      step,
      lo: firstB * step - shift,
      hi: (lastB + 1) * step - shift,
    })

    const t = []
    const zones = {}
    let prevB = null
    for (const row of rows) {
      if (row.b !== prevB) {
        t.push((row.b * step - off) * 1000)
        prevB = row.b
      }
      const i = t.length - 1
      const zone = (zones[row.sensor.slice(1)] ??= { avg: [], lo: [], hi: [] })
      zone.avg[i] = Math.round((row.total * 10) / row.n) / 100
      zone.lo[i] = row.lo / 10
      zone.hi[i] = row.hi / 10
    }
    for (const zone of Object.values(zones)) {
      for (const series of Object.values(zone)) {
        for (let i = 0; i < t.length; i++) series[i] ??= null
      }
    }
    return { from: fromS * 1000, to: toS * 1000, step: step * 1000, earliest, t, zones }
  }

  transaction(fn) {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
}
