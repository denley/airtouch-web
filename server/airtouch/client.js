import net from 'node:net'
import { EventEmitter } from 'node:events'
import {
  FrameReader,
  MSG_CONTROL_STATUS,
  MSG_EXTENDED,
  SUB_AC_STATUS,
  SUB_AC_TIMER_STATUS,
  SUB_ZONE_STATUS,
  EXT_AC_ABILITY,
  EXT_AC_ERROR,
  EXT_CONSOLE_VERSION,
  EXT_ZONE_NAMES,
  acControlEntry,
  acControlMessage,
  acStatusRequest,
  acTimerControlMessage,
  acTimerStatusRequest,
  parseAcTimerStatus,
  quickTimerMessage,
  decodeControlData,
  encodeFrame,
  extendedRequest,
  parseAcAbility,
  parseAcError,
  parseAcStatus,
  parseConsoleVersion,
  parseExtended,
  parseZoneNames,
  parseZoneStatus,
  zoneControlEntry,
  zoneControlMessage,
  zoneStatusRequest,
} from './protocol.js'

const TCP_PORT = 9005
const RECONNECT_DELAY = 5000
const KEEPALIVE_INTERVAL = 300_000 // probe after 5 min of silence
const KEEPALIVE_TIMEOUT = 330_000 // reconnect if nothing heard for 5.5 min

/**
 * Maintains a TCP connection to an AirTouch 5 console, keeps a live model of
 * the system, and emits 'state' whenever anything changes. The console pushes
 * full zone/AC status on every change (including from wall panels and the
 * official app), so after the initial requests we mostly just listen.
 */
export class AirTouchClient extends EventEmitter {
  constructor(ip) {
    super()
    const [host, port] = String(ip).split(':')
    this.host = host
    this.port = Number(port) || TCP_PORT
    this.socket = null
    this.reader = null
    this.msgId = 0
    this.destroyed = false
    this.status = 'connecting'
    this.acs = new Map() // id -> status fields
    this.zones = new Map() // id -> status fields
    this.zoneNames = new Map()
    this.abilities = new Map() // ac id -> ability
    this.acErrors = new Map() // ac id -> error text
    this.acTimers = new Map() // ac id -> { on, off } timer states
    this.consoleVersion = null
    this.lastRx = 0
    this.timers = []
  }

  connect() {
    if (this.destroyed) return
    this.status = 'connecting'
    this.emitState()

    this.reader = new FrameReader()
    const socket = net.createConnection({ host: this.host, port: this.port })
    this.socket = socket
    socket.setNoDelay(true)

    socket.on('connect', () => {
      this.status = 'connected'
      this.lastRx = Date.now()
      // Startup sequence: abilities first (gives AC->zone mapping and limits),
      // then names, version, and both status snapshots.
      this.sendExtended(extendedRequest(EXT_AC_ABILITY))
      this.sendExtended(extendedRequest(EXT_ZONE_NAMES))
      this.sendExtended(extendedRequest(EXT_CONSOLE_VERSION))
      this.sendControl(zoneStatusRequest())
      this.sendControl(acStatusRequest())
      this.sendControl(acTimerStatusRequest())
      this.emitState()
    })

    socket.on('data', (chunk) => {
      this.lastRx = Date.now()
      for (const frame of this.reader.push(chunk)) {
        try {
          this.handleFrame(frame)
        } catch (err) {
          console.error('Failed to handle frame:', err)
        }
      }
    })

    const onGone = () => {
      if (this.destroyed) return
      this.clearTimers()
      this.status = 'disconnected'
      this.emitState()
      this.timers.push(setTimeout(() => this.connect(), RECONNECT_DELAY))
    }
    socket.on('error', () => {}) // 'close' always follows
    socket.on('close', onGone)

    this.clearTimers()
    // Keepalive: the console is silent when nothing changes, so probe with a
    // cheap version request and reconnect if the line stays dead.
    this.timers.push(
      setInterval(() => {
        if (this.status !== 'connected') return
        const silence = Date.now() - this.lastRx
        if (silence > KEEPALIVE_TIMEOUT) {
          console.warn('AirTouch console silent too long, reconnecting')
          socket.destroy()
        } else if (silence > KEEPALIVE_INTERVAL) {
          this.sendExtended(extendedRequest(EXT_CONSOLE_VERSION))
        }
      }, 30_000),
    )
  }

  destroy() {
    this.destroyed = true
    this.clearTimers()
    this.socket?.destroy()
  }

  clearTimers() {
    for (const t of this.timers) {
      clearTimeout(t)
      clearInterval(t)
    }
    this.timers = []
  }

  // --- outgoing ---

  nextId() {
    this.msgId = (this.msgId % 255) + 1
    return this.msgId
  }

  sendControl(data) {
    this.send(encodeFrame(MSG_CONTROL_STATUS, this.nextId(), data))
  }

  sendExtended(data) {
    this.send(encodeFrame(MSG_EXTENDED, this.nextId(), data))
  }

  send(frame) {
    if (this.socket && !this.socket.destroyed && this.status === 'connected') {
      this.socket.write(frame)
    }
  }

  // --- incoming ---

  handleFrame(frame) {
    if (frame.msgType === MSG_CONTROL_STATUS) {
      const parsed = decodeControlData(frame.data)
      if (!parsed) return
      if (parsed.subType === SUB_ZONE_STATUS) {
        for (const zone of parseZoneStatus(parsed.entries)) {
          this.zones.set(zone.id, zone)
        }
        this.emitState()
      } else if (parsed.subType === SUB_AC_STATUS) {
        for (const ac of parseAcStatus(parsed.entries)) {
          const prev = this.acs.get(ac.id)
          this.acs.set(ac.id, ac)
          if (ac.errorCode !== 0 && ac.errorCode !== prev?.errorCode) {
            this.sendExtended(extendedRequest(EXT_AC_ERROR, ac.id))
          }
          if (ac.errorCode === 0) this.acErrors.delete(ac.id)
        }
        this.emitState()
      } else if (parsed.subType === SUB_AC_TIMER_STATUS) {
        for (const timer of parseAcTimerStatus(parsed.entries)) {
          this.acTimers.set(timer.id, { on: timer.on, off: timer.off })
        }
        this.emitState()
      }
    } else if (frame.msgType === MSG_EXTENDED) {
      const ext = parseExtended(frame.data)
      if (!ext || ext.payload.length === 0) return
      switch (ext.subType) {
        case EXT_AC_ABILITY:
          for (const ability of parseAcAbility(ext.payload)) {
            this.abilities.set(ability.id, ability)
          }
          this.emitState()
          break
        case EXT_ZONE_NAMES:
          this.zoneNames = parseZoneNames(ext.payload)
          this.emitState()
          break
        case EXT_CONSOLE_VERSION: {
          const info = parseConsoleVersion(ext.payload)
          if (info) {
            this.consoleVersion = info.version
            this.emitState()
          }
          break
        }
        case EXT_AC_ERROR: {
          const info = parseAcError(ext.payload)
          if (info?.error) {
            this.acErrors.set(info.ac, info.error)
            this.emitState()
          }
          break
        }
      }
    }
  }

  // --- public state ---

  getState() {
    return {
      connection: {
        status: this.status,
        consoleIp: this.host,
        version: this.consoleVersion ?? undefined,
      },
      acs: [...this.acs.values()]
        .sort((a, b) => a.id - b.id)
        .map((ac) => ({
          ...ac,
          name: this.abilities.get(ac.id)?.name || `AC ${ac.id + 1}`,
          errorText: this.acErrors.get(ac.id) ?? null,
          timers: this.acTimers.get(ac.id) ?? null,
          ability: this.abilities.get(ac.id)
            ? {
                name: this.abilities.get(ac.id).name,
                startZone: this.abilities.get(ac.id).startZone,
                zoneCount: this.abilities.get(ac.id).zoneCount,
                modes: this.abilities.get(ac.id).modes,
                fanSpeeds: this.abilities.get(ac.id).fanSpeeds,
                minCool: this.abilities.get(ac.id).minCool,
                maxCool: this.abilities.get(ac.id).maxCool,
                minHeat: this.abilities.get(ac.id).minHeat,
                maxHeat: this.abilities.get(ac.id).maxHeat,
              }
            : null,
        })),
      zones: [...this.zones.values()]
        .sort((a, b) => a.id - b.id)
        .map((zone) => ({
          ...zone,
          name: this.zoneNames.get(zone.id) || `Zone ${zone.id + 1}`,
        })),
    }
  }

  emitState() {
    this.emit('state', this.getState())
  }

  // --- controls ---

  /** state: 'on' | 'off' | 'away' | 'sleep' */
  setAcPower(ac, state) {
    const power = ['on', 'off', 'away', 'sleep'].includes(state) ? state : 'on'
    this.sendControl(acControlMessage([acControlEntry(ac, { power })]))
  }

  setAcMode(ac, mode) {
    // Selecting a mode while the AC is off also turns it on — matches how
    // people expect a thermostat mode button to behave.
    const current = this.acs.get(ac)
    const powered = current && ['on', 'awayOn', 'sleep'].includes(current.power)
    this.sendControl(acControlMessage([acControlEntry(ac, { mode, power: powered ? 'keep' : 'on' })]))
  }

  setAcFanSpeed(ac, fanSpeed) {
    this.sendControl(acControlMessage([acControlEntry(ac, { fanSpeed })]))
  }

  setAcSetpoint(ac, value) {
    this.sendControl(acControlMessage([acControlEntry(ac, { setpoint: clampSetpoint(value) })]))
  }

  /** Turn the AC on/off `minutes` from now (console rounds to the minute). */
  setQuickTimer(ac, type, minutes) {
    const total = Math.max(1, Math.round(minutes))
    this.sendExtended(quickTimerMessage(ac, type, Math.floor(total / 60), total % 60))
    // The console pushes 0x33 after the change, but request as a fallback in
    // case a firmware doesn't.
    this.timers.push(setTimeout(() => this.sendControl(acTimerStatusRequest()), 1500))
  }

  /** Cancelling goes via timer control, echoing the other timer unchanged. */
  cancelTimer(ac, type) {
    const current = this.acTimers.get(ac) ?? { on: { enabled: false }, off: { enabled: false } }
    const on = type === 'on' ? { enabled: false } : current.on
    const off = type === 'off' ? { enabled: false } : current.off
    this.sendControl(acTimerControlMessage(ac, on, off))
    this.timers.push(setTimeout(() => this.sendControl(acTimerStatusRequest()), 1500))
  }

  setZonePower(zone, state) {
    const power = state === 'turbo' ? 'turbo' : state === 'on' ? 'on' : 'off'
    this.sendControl(zoneControlMessage([zoneControlEntry(zone, { power })]))
  }

  setZonePercent(zone, value) {
    this.sendControl(zoneControlMessage([zoneControlEntry(zone, { setting: 'percent', value })]))
  }

  setZoneSetpoint(zone, value) {
    this.sendControl(
      zoneControlMessage([zoneControlEntry(zone, { setting: 'setpoint', value: clampSetpoint(value) })]),
    )
  }
}

// The 1-byte wire encoding covers 10.0-35.5 C; keep requests inside it.
function clampSetpoint(value) {
  return Math.min(35.5, Math.max(10, Number(value) || 20))
}
