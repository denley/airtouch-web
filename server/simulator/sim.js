// A simulated AirTouch 5 console: speaks the real binary protocol over TCP
// and answers UDP discovery, so the bridge (and UI) can be exercised without
// hardware. One AC, five zones, temperatures drift toward realistic values.

import net from 'node:net'
import dgram from 'node:dgram'
import {
  FrameReader,
  MSG_CONTROL_STATUS,
  MSG_EXTENDED,
  SUB_AC_CONTROL,
  SUB_AC_STATUS,
  SUB_AC_TIMER_CONTROL,
  SUB_AC_TIMER_STATUS,
  SUB_ZONE_CONTROL,
  SUB_ZONE_STATUS,
  EXT_AC_ABILITY,
  EXT_AC_ERROR,
  EXT_CONSOLE_VERSION,
  EXT_QUICK_TIMER,
  EXT_ZONE_NAMES,
  AC_MODE_CODES,
  FAN_SPEED_CODES,
  decodeControlData,
  encodeControlData,
  encodeFrame,
  encodeTemp,
  parseExtended,
} from '../airtouch/protocol.js'

const DISCOVERY_REQUEST = '::REQUEST-POLYAIRE-AIRTOUCH-DEVICE-INFO:;'

const MODE_NAMES = ['auto', 'heat', 'dry', 'fan', 'cool']
const FAN_NAMES = { 0: 'auto', 1: 'quiet', 2: 'low', 3: 'medium', 4: 'high', 5: 'powerful', 6: 'turbo', 8: 'intelligent' }

export class AirTouchSimulator {
  constructor({ tcpPort = 9005, discovery = true } = {}) {
    this.tcpPort = tcpPort
    this.discovery = discovery
    this.sockets = new Set()

    this.ac = {
      id: 0,
      name: 'Living AC',
      power: 'on',
      mode: 'cool',
      fanSpeed: 'auto',
      setpoint: 23,
      currentTemp: 24.6,
      turbo: false,
      bypass: false,
      spill: false,
      timerSet: false,
      errorCode: 0,
      modes: ['auto', 'heat', 'dry', 'fan', 'cool'],
      fanSpeeds: ['auto', 'quiet', 'low', 'medium', 'high', 'powerful', 'turbo'],
      minCool: 16,
      maxCool: 31,
      minHeat: 16,
      maxHeat: 31,
      timers: {
        on: { enabled: false, hour: 0, minute: 0 },
        off: { enabled: false, hour: 0, minute: 0 },
      },
    }

    this.zones = [
      { id: 0, name: 'Living', power: 'on', controlMethod: 'temp', openPercent: 70, setpoint: 23, hasSensor: true, currentTemp: 24.4, spill: false, lowBattery: false },
      { id: 1, name: 'Kitchen', power: 'on', controlMethod: 'temp', openPercent: 45, setpoint: 22.5, hasSensor: true, currentTemp: 25.1, spill: false, lowBattery: false },
      { id: 2, name: 'Master Bed', power: 'off', controlMethod: 'temp', openPercent: 0, setpoint: 21, hasSensor: true, currentTemp: 23.8, spill: false, lowBattery: true },
      { id: 3, name: 'Study', power: 'on', controlMethod: 'temp', openPercent: 55, setpoint: 22, hasSensor: true, currentTemp: 23.2, spill: false, lowBattery: false },
      { id: 4, name: 'Rumpus', power: 'off', controlMethod: 'percent', openPercent: 60, setpoint: null, hasSensor: false, currentTemp: null, spill: false, lowBattery: false },
    ]
  }

  start() {
    this.server = net.createServer((socket) => {
      const reader = new FrameReader()
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
      socket.on('error', () => {})
      socket.on('data', (chunk) => {
        for (const frame of reader.push(chunk)) {
          try {
            this.handleFrame(socket, frame)
          } catch (err) {
            console.error('[sim] frame error:', err)
          }
        }
      })
    })
    this.server.listen(this.tcpPort, () => {
      console.log(`[sim] AirTouch 5 simulator listening on tcp:${this.tcpPort}`)
    })

    if (this.discovery) {
      this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      this.udp.on('error', (err) => console.warn('[sim] discovery unavailable:', err.message))
      this.udp.on('message', (msg, rinfo) => {
        if (msg.toString('utf8') !== DISCOVERY_REQUEST) return
        const reply = `127.0.0.1,SIM5000000000000,AirTouch5,999999,Simulated AirTouch`
        // Reply via broadcast so a bridge sharing this host (and therefore
        // this port, via reuseAddr) also receives it.
        this.udp.send(reply, 49005, '255.255.255.255')
        this.udp.send(reply, 49005, rinfo.address)
      })
      this.udp.bind(49005, () => {
        try {
          this.udp.setBroadcast(true)
        } catch {}
      })
    }

    // Temperature drift: rooms move toward setpoint when conditioned, toward
    // ambient otherwise. Broadcast status when something visibly changes.
    this.driftTimer = setInterval(() => {
      this.drift()
      this.checkTimers()
    }, 5000)
  }

  stop() {
    clearInterval(this.driftTimer)
    this.server?.close()
    this.udp?.close()
    for (const s of this.sockets) s.destroy()
  }

  // --- incoming frames ---

  handleFrame(socket, frame) {
    if (frame.msgType === MSG_CONTROL_STATUS) {
      const parsed = decodeControlData(frame.data)
      if (!parsed) return
      switch (parsed.subType) {
        case SUB_ZONE_STATUS:
          if (parsed.entries.length === 0) socket.write(this.zoneStatusFrame(frame.msgId))
          return
        case SUB_AC_STATUS:
          if (parsed.entries.length === 0) socket.write(this.acStatusFrame(frame.msgId))
          return
        case SUB_ZONE_CONTROL:
          for (const entry of parsed.entries) this.applyZoneControl(entry)
          this.broadcast(this.zoneStatusFrame(1))
          return
        case SUB_AC_CONTROL:
          for (const entry of parsed.entries) this.applyAcControl(entry)
          this.broadcast(this.acStatusFrame(1))
          this.broadcast(this.zoneStatusFrame(1))
          return
        case SUB_AC_TIMER_STATUS:
          if (parsed.entries.length === 0) socket.write(this.timerStatusFrame(frame.msgId))
          return
        case SUB_AC_TIMER_CONTROL:
          for (const entry of parsed.entries) this.applyTimerControl(entry)
          this.broadcast(this.timerStatusFrame(1))
          this.broadcast(this.acStatusFrame(1))
          return
      }
    } else if (frame.msgType === MSG_EXTENDED) {
      const ext = parseExtended(frame.data)
      if (!ext) return
      switch (ext.subType) {
        case EXT_AC_ABILITY:
          return void socket.write(this.abilityFrame(frame.msgId))
        case EXT_ZONE_NAMES:
          return void socket.write(this.zoneNamesFrame(frame.msgId))
        case EXT_CONSOLE_VERSION:
          return void socket.write(this.versionFrame(frame.msgId))
        case EXT_AC_ERROR:
          return void socket.write(this.errorFrame(frame.msgId, ext.payload[0] ?? 0))
        case EXT_QUICK_TIMER: {
          // Countdown -> absolute time-of-day, like the real console.
          const [ac, type, hours, minutes] = ext.payload
          if (ac !== this.ac.id) return
          const fireAt = new Date(Date.now() + (hours * 60 + minutes) * 60_000)
          const timer = { enabled: true, hour: fireAt.getHours(), minute: fireAt.getMinutes() }
          if (type === 1) this.ac.timers.on = timer
          else this.ac.timers.off = timer
          this.broadcast(this.timerStatusFrame(1))
          this.broadcast(this.acStatusFrame(1))
          return
        }
      }
    }
  }

  applyZoneControl(entry) {
    const zone = this.zones.find((z) => z.id === (entry[0] & 0x3f))
    if (!zone) return
    const setting = (entry[1] >> 5) & 0x07
    const power = entry[1] & 0x07
    if (power === 0b010) zone.power = 'off'
    else if (power === 0b011) zone.power = 'on'
    else if (power === 0b101) zone.power = 'turbo'
    else if (power === 0b001) zone.power = zone.power === 'off' ? 'on' : 'off'

    if (setting === 0b100) {
      zone.openPercent = Math.min(100, Math.max(0, entry[2]))
      zone.controlMethod = 'percent'
    } else if (setting === 0b101 && zone.hasSensor) {
      zone.setpoint = (entry[2] + 100) / 10
      zone.controlMethod = 'temp'
    } else if (setting === 0b010) {
      if (zone.controlMethod === 'temp' && zone.setpoint != null) zone.setpoint -= 1
      else zone.openPercent = Math.max(0, zone.openPercent - 5)
    } else if (setting === 0b011) {
      if (zone.controlMethod === 'temp' && zone.setpoint != null) zone.setpoint += 1
      else zone.openPercent = Math.min(100, zone.openPercent + 5)
    }
  }

  applyAcControl(entry) {
    if ((entry[0] & 0x0f) !== this.ac.id) return
    const power = (entry[0] >> 4) & 0x0f
    if (power === 0b0010) this.ac.power = 'off'
    else if (power === 0b0011) this.ac.power = 'on'
    else if (power === 0b0001) this.ac.power = this.ac.power === 'off' ? 'on' : 'off'
    else if (power === 0b0100) this.ac.power = this.ac.power === 'off' ? 'awayOff' : 'awayOn'
    else if (power === 0b0101) this.ac.power = 'sleep'

    const mode = (entry[1] >> 4) & 0x0f
    if (mode <= 4) this.ac.mode = MODE_NAMES[mode]
    const fan = entry[1] & 0x0f
    if (FAN_NAMES[fan]) this.ac.fanSpeed = FAN_NAMES[fan]
    if (entry[2] === 0x40) this.ac.setpoint = (entry[3] + 100) / 10
  }

  applyTimerControl(entry) {
    if ((entry[0] & 0x0f) !== this.ac.id) return
    this.ac.timers.on = { enabled: !(entry[1] & 0x80), hour: entry[1] & 0x1f, minute: entry[2] & 0x3f }
    this.ac.timers.off = { enabled: !(entry[3] & 0x80), hour: entry[3] & 0x1f, minute: entry[4] & 0x3f }
  }

  timerStatusFrame(msgId) {
    const t = this.ac.timers
    const enc = (timer) => (timer.enabled ? [timer.hour & 0x1f, timer.minute & 0x3f] : [0x80, 0])
    const entry = Buffer.from([this.ac.id, ...enc(t.on), ...enc(t.off), 0, 0, 0, 0])
    return encodeFrame(MSG_CONTROL_STATUS, msgId, encodeControlData(SUB_AC_TIMER_STATUS, [entry], 9), true)
  }

  checkTimers() {
    const now = new Date()
    let fired = false
    for (const [type, timer] of Object.entries(this.ac.timers)) {
      if (!timer.enabled || timer.hour !== now.getHours() || timer.minute !== now.getMinutes()) continue
      this.ac.power = type === 'on' ? 'on' : 'off'
      timer.enabled = false
      fired = true
    }
    if (fired) {
      this.broadcast(this.timerStatusFrame(1))
      this.broadcast(this.acStatusFrame(1))
    }
  }

  // --- outgoing frames ---

  zoneStatusFrame(msgId) {
    const entries = this.zones.map((z) => {
      const e = Buffer.alloc(8)
      const powerBits = z.power === 'turbo' ? 0b11 : z.power === 'on' ? 0b01 : 0b00
      e[0] = (powerBits << 6) | z.id
      e[1] = (z.controlMethod === 'temp' ? 0x80 : 0) | (z.openPercent & 0x7f)
      e[2] = z.setpoint != null ? encodeTemp(z.setpoint) : 0xff
      e[3] = z.hasSensor ? 0x80 : 0
      e.writeUInt16BE(z.currentTemp != null ? Math.round(z.currentTemp * 10 + 500) : 0x07ff, 4)
      e[6] = (z.spill ? 0x02 : 0) | (z.lowBattery ? 0x01 : 0)
      return e
    })
    return encodeFrame(MSG_CONTROL_STATUS, msgId, encodeControlData(SUB_ZONE_STATUS, entries, 8), true)
  }

  acStatusFrame(msgId) {
    const powerCode = { off: 0, on: 1, awayOff: 2, awayOn: 3, sleep: 5 }[this.ac.power] ?? 0
    const e = Buffer.alloc(10)
    e[0] = (powerCode << 4) | this.ac.id
    e[1] = (AC_MODE_CODES[this.ac.mode] << 4) | FAN_SPEED_CODES[this.ac.fanSpeed]
    e[2] = encodeTemp(this.ac.setpoint)
    const timerSet = this.ac.timers.on.enabled || this.ac.timers.off.enabled
    e[3] = 0xc0 | (this.ac.turbo ? 0x08 : 0) | (this.ac.bypass ? 0x04 : 0) | (this.ac.spill ? 0x02 : 0) | (timerSet ? 0x01 : 0)
    e.writeUInt16BE(Math.round(this.ac.currentTemp * 10 + 500), 4)
    e.writeUInt16BE(this.ac.errorCode, 6)
    e[8] = 0x80
    return encodeFrame(MSG_CONTROL_STATUS, msgId, encodeControlData(SUB_AC_STATUS, [e], 10), true)
  }

  abilityFrame(msgId) {
    const record = Buffer.alloc(26)
    record[0] = this.ac.id
    record[1] = 24
    record.write(this.ac.name, 2, 16, 'utf8')
    record[18] = 0
    record[19] = this.zones.length
    record[20] =
      (this.ac.modes.includes('auto') ? 0x01 : 0) |
      (this.ac.modes.includes('heat') ? 0x02 : 0) |
      (this.ac.modes.includes('dry') ? 0x04 : 0) |
      (this.ac.modes.includes('fan') ? 0x08 : 0) |
      (this.ac.modes.includes('cool') ? 0x10 : 0)
    record[21] = this.ac.fanSpeeds.reduce(
      (mask, f) => mask | (1 << { auto: 0, quiet: 1, low: 2, medium: 3, high: 4, powerful: 5, turbo: 6, intelligent: 7 }[f]),
      0,
    )
    record[22] = this.ac.minCool
    record[23] = this.ac.maxCool
    record[24] = this.ac.minHeat
    record[25] = this.ac.maxHeat
    return this.extendedFrame(msgId, EXT_AC_ABILITY, record)
  }

  zoneNamesFrame(msgId) {
    const parts = this.zones.map((z) => {
      const name = Buffer.from(z.name, 'utf8')
      return Buffer.concat([Buffer.from([z.id, name.length]), name])
    })
    return this.extendedFrame(msgId, EXT_ZONE_NAMES, Buffer.concat(parts))
  }

  versionFrame(msgId) {
    const version = Buffer.from('1.2.3', 'utf8')
    return this.extendedFrame(msgId, EXT_CONSOLE_VERSION, Buffer.concat([Buffer.from([0, version.length]), version]))
  }

  errorFrame(msgId, ac) {
    return this.extendedFrame(msgId, EXT_AC_ERROR, Buffer.from([ac, 0]))
  }

  extendedFrame(msgId, subType, payload) {
    const data = Buffer.alloc(2 + payload.length)
    data.writeUInt16BE(subType, 0)
    payload.copy(data, 2)
    return encodeFrame(MSG_EXTENDED, msgId, data, true)
  }

  broadcast(frame) {
    for (const s of this.sockets) s.write(frame)
  }

  // --- physics-lite ---

  drift() {
    const acOn = ['on', 'awayOn', 'sleep'].includes(this.ac.power)
    let changed = false
    for (const zone of this.zones) {
      if (zone.currentTemp == null) continue
      const conditioned = acOn && zone.power !== 'off' && this.ac.mode !== 'fan'
      let target = 26.5 // ambient
      if (conditioned) {
        target = zone.controlMethod === 'temp' && zone.setpoint != null ? zone.setpoint : this.ac.setpoint
      }
      const step = (target - zone.currentTemp) * 0.06 + (Math.random() - 0.5) * 0.05
      const next = Math.round((zone.currentTemp + step) * 10) / 10
      if (next !== zone.currentTemp) {
        zone.currentTemp = next
        changed = true
      }
      // Damper responds to demand for temp-controlled zones.
      if (conditioned && zone.controlMethod === 'temp' && zone.setpoint != null) {
        const demand = this.ac.mode === 'heat' ? zone.setpoint - zone.currentTemp : zone.currentTemp - zone.setpoint
        const pct = Math.max(5, Math.min(100, Math.round(demand * 40 + 30)))
        if (pct !== zone.openPercent) {
          zone.openPercent = pct
          changed = true
        }
      }
    }
    const zoneTemps = this.zones.filter((z) => z.currentTemp != null)
    const avg = zoneTemps.reduce((sum, z) => sum + z.currentTemp, 0) / zoneTemps.length
    const nextAc = Math.round(avg * 10) / 10
    if (nextAc !== this.ac.currentTemp) {
      this.ac.currentTemp = nextAc
      changed = true
    }
    if (changed && this.sockets.size) {
      this.broadcast(this.zoneStatusFrame(1))
      this.broadcast(this.acStatusFrame(1))
    }
  }
}
