import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { History } from './history.js'

const MINUTE = 60_000
const HOUR = 3600_000
const DAY = 24 * HOUR
const WINDOW = 3 * HOUR

function historyWith(samples) {
  const h = new History(':memory:', { persist: false })
  h.record(samples)
  return h
}

function samplesOver(ms, tempFor, end = Date.now()) {
  const out = []
  for (let t = end - ms; t <= end; t += MINUTE) {
    out.push({ t, zones: { 0: tempFor(t) }, acs: {} })
  }
  return out
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'history-test-'))
}

test('isFlat flags a reading frozen across the whole window', () => {
  const h = historyWith(samplesOver(WINDOW, () => 13))
  assert.equal(h.isFlat(0, 13, WINDOW), true)
})

test('isFlat passes a reading that varied within the window', () => {
  let i = 0
  const h = historyWith(samplesOver(WINDOW, () => (i++ % 2 ? 13 : 13.1)))
  assert.equal(h.isFlat(0, 13, WINDOW), false)
})

test('isFlat ignores variation older than the window', () => {
  const now = Date.now()
  const h = historyWith(samplesOver(4 * HOUR, (t) => (t < now - WINDOW ? 18.5 : 13)))
  assert.equal(h.isFlat(0, 13, WINDOW), true)
})

test('isFlat needs samples spanning most of the window', () => {
  const h = historyWith(samplesOver(HOUR, () => 13))
  assert.equal(h.isFlat(0, 13, WINDOW), false)
})

test('isFlat passes when the live value differs from the recorded ones', () => {
  const h = historyWith(samplesOver(WINDOW, () => 13))
  assert.equal(h.isFlat(0, 13.4, WINDOW), false)
})

test('isFlat passes a zone with no recorded samples', () => {
  const h = historyWith(samplesOver(WINDOW, () => 13))
  assert.equal(h.isFlat(1, 13, WINDOW), false)
})

test('short ranges return one bucket per minute sample', () => {
  const end = Math.floor(Date.now() / HOUR) * HOUR
  const h = historyWith(samplesOver(3 * HOUR, (t) => 20 + ((t / MINUTE) % 10) / 10, end))
  const r = h.query({ from: end - 3 * HOUR, to: end, tzOffset: 0 })
  assert.equal(r.step, MINUTE)
  assert.equal(r.t.length, 180)
  assert.equal(r.t[0], end - 3 * HOUR)
  assert.deepEqual(r.zones[0].avg.slice(0, 3), [20, 20.1, 20.2])
  assert.equal(r.zones[0].lo[1], 20.1)
})

test('long ranges aggregate from rollups with min/avg/max per bucket', () => {
  // Ten days alternating 18/22 each minute: every bucket averages 20 and
  // spans 18-22, whichever table it came from.
  const end = Math.floor(Date.now() / DAY) * DAY
  const h = historyWith(samplesOver(10 * DAY, (t) => ((t / MINUTE) % 2 ? 18 : 22), end))
  for (const [span, step] of [
    [30 * DAY, HOUR],
    [90 * DAY, 3 * HOUR],
    [365 * DAY, DAY],
    [3 * 365 * DAY, 2 * DAY],
  ]) {
    const r = h.query({ from: end - span, to: end, tzOffset: 0 })
    assert.equal(r.step, step, `step for ${span / DAY}d`)
    assert.ok(r.t.length <= 1000)
    const full = r.zones[0].avg.slice(1, -1) // ends may be partial buckets
    assert.ok(full.length > 0)
    for (const v of full) assert.equal(v, 20)
    assert.equal(Math.min(...r.zones[0].lo), 18)
    assert.equal(Math.max(...r.zones[0].hi), 22)
  }
})

test('day buckets start at local midnight', () => {
  const end = Math.floor(Date.now() / DAY) * DAY
  const h = historyWith(samplesOver(30 * DAY, () => 20, end))
  const r = h.query({ from: end - 2 * 365 * DAY, to: end })
  assert.equal(r.step, DAY)
  assert.ok(r.t.length >= 30)
  for (const t of r.t) {
    // Within an hour of midnight: the grid uses today's UTC offset, which
    // DST can put an hour off for older days.
    const hours = new Date(t + 12 * HOUR).getHours()
    assert.ok(hours >= 11 && hours <= 13, new Date(t).toString())
  }
})

test('missing buckets and zones come back as nulls', () => {
  const end = Math.floor(Date.now() / HOUR) * HOUR
  const samples = samplesOver(HOUR, () => 20, end).filter((_, i) => i < 10 || i > 20)
  samples[0].zones[1] = 19
  const h = historyWith(samples)
  const r = h.query({ from: end - HOUR, to: end + MINUTE })
  assert.equal(r.t.length, samples.length)
  assert.equal(r.zones[1].avg[0], 19)
  assert.equal(r.zones[1].avg[1], null)
  assert.equal(r.zones[1].avg.length, r.t.length)
})

test('from defaults to the first reading', () => {
  const end = Date.now()
  const h = historyWith(samplesOver(5 * DAY, () => 20, end))
  const r = h.query({ to: end })
  assert.equal(r.earliest, Math.round((end - 5 * DAY) / 1000) * 1000)
  assert.equal(r.from, r.earliest)
})

test('an empty history answers with no buckets', () => {
  const r = new History(':memory:', { persist: false }).query({})
  assert.equal(r.earliest, null)
  assert.deepEqual(r.t, [])
})

test('persists to disk and imports the legacy JSON file once', () => {
  const dir = tmpDir()
  const json = path.join(dir, 'history.json')
  const db = path.join(dir, 'history.db')
  fs.writeFileSync(json, JSON.stringify(samplesOver(HOUR, () => 21)))

  const h = new History(db)
  h.importJson(json)
  h.close()
  assert.equal(fs.existsSync(json), false)
  assert.equal(fs.existsSync(`${json}.imported`), true)

  const reopened = new History(db)
  reopened.importJson(json) // nothing left to import
  const r = reopened.query({ from: Date.now() - 2 * HOUR })
  assert.equal(r.t.length, 61)
  assert.ok(r.zones[0].avg.every((v) => v === 21))
  reopened.close()
  fs.rmSync(dir, { recursive: true })
})

test('daily rollups are rebuilt when the timezone changes', () => {
  const dir = tmpDir()
  const db = path.join(dir, 'history.db')
  const original = process.env.TZ
  try {
    process.env.TZ = 'UTC'
    const end = Math.floor(Date.now() / DAY) * DAY
    const h = new History(db)
    h.record(samplesOver(3 * DAY, () => 20, end))
    h.close()

    process.env.TZ = 'Asia/Kolkata' // +5:30
    const reopened = new History(db)
    const r = reopened.query({ from: end - 3 * 365 * DAY, to: end })
    assert.equal(r.step, 2 * DAY)
    const days = reopened.db.prepare("SELECT t FROM daily WHERE sensor = 'z0' ORDER BY t").all()
    for (const { t } of days) assert.equal(new Date(t * 1000).getHours(), 0)
    reopened.close()
  } finally {
    if (original == null) delete process.env.TZ
    else process.env.TZ = original
    fs.rmSync(dir, { recursive: true })
  }
})
