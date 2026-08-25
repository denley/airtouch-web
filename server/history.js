import fs from 'node:fs'
import path from 'node:path'

const SAMPLE_INTERVAL = 60_000
const SAVE_INTERVAL = 300_000
const MAX_AGE = 48 * 3600_000

/**
 * Records zone/AC temperatures once a minute so the UI can chart trends.
 * Kept in memory (48h) and periodically persisted so restarts don't lose it.
 */
export class History {
  constructor(filePath, { persist = true } = {}) {
    this.filePath = filePath
    this.persist = persist
    this.samples = []
    this.timers = []
    if (persist) {
      try {
        const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (Array.isArray(loaded)) this.samples = loaded
      } catch {}
      this.prune()
    }
  }

  /** getState: () => AppState | null */
  start(getState) {
    this.stop()
    this.timers.push(setInterval(() => this.sample(getState()), SAMPLE_INTERVAL))
    if (this.persist) {
      this.timers.push(setInterval(() => this.save(), SAVE_INTERVAL))
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
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
    this.samples.push({ t: Date.now(), zones, acs })
    this.prune()
  }

  prune() {
    const cutoff = Date.now() - MAX_AGE
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()
  }

  list(sinceMs) {
    const cutoff = Date.now() - sinceMs
    return this.samples.filter((s) => s.t >= cutoff)
  }

  save() {
    if (!this.persist || this.samples.length === 0) return
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.samples))
    } catch (err) {
      console.warn('Failed to save history:', err.message)
    }
  }
}
