import test from 'node:test'
import assert from 'node:assert/strict'
import { History } from './history.js'

const HOUR = 3600_000
const WINDOW = 3 * HOUR

function historyWith(samples) {
  const h = new History('/dev/null', { persist: false })
  h.samples = samples
  return h
}

function samplesOver(ms, tempFor) {
  const now = Date.now()
  const out = []
  for (let t = now - ms; t <= now; t += 60_000) {
    out.push({ t, zones: { 0: tempFor(t) }, acs: {} })
  }
  return out
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
