// AirTouch 5 binary protocol: framing, CRC, message builders and parsers.
//
// Frame layout (all multi-byte ints big-endian):
//   55 55 55 AA | to | from | msgId | msgType | dataLen(2) | data... | crc16(2)
// msgType 0xC0 = control/status (console address 0x80), 0x1F = extended (0x90).
// CRC-16/MODBUS over everything after the 4-byte header, written big-endian.
// The console wraps frames it sends in an undocumented `55 55 55 AB` outer
// header — receivers must scan for the inner `55 55 55 AA` sync instead of
// assuming frame-aligned reads.

const HEADER = Buffer.from([0x55, 0x55, 0x55, 0xaa])

export const MSG_CONTROL_STATUS = 0xc0
export const MSG_EXTENDED = 0x1f

export const SUB_ZONE_CONTROL = 0x20
export const SUB_ZONE_STATUS = 0x21
export const SUB_AC_CONTROL = 0x22
export const SUB_AC_STATUS = 0x23
export const SUB_AC_TIMER_CONTROL = 0x32
export const SUB_AC_TIMER_STATUS = 0x33

export const EXT_QUICK_TIMER = 0xff49
export const EXT_AC_ERROR = 0xff10
export const EXT_AC_ABILITY = 0xff11
export const EXT_ZONE_NAMES = 0xff13
export const EXT_CONSOLE_VERSION = 0xff30

export const AC_MODES = { 0: 'auto', 1: 'heat', 2: 'dry', 3: 'fan', 4: 'cool', 8: 'auto', 9: 'auto' }
export const AC_MODE_CODES = { auto: 0, heat: 1, dry: 2, fan: 3, cool: 4 }

export const FAN_SPEEDS = {
  0: 'auto', 1: 'quiet', 2: 'low', 3: 'medium', 4: 'high', 5: 'powerful', 6: 'turbo',
  8: 'intelligent', 9: 'intelligent', 10: 'intelligent', 11: 'intelligent',
  12: 'intelligent', 13: 'intelligent', 14: 'intelligent',
}
export const FAN_SPEED_CODES = {
  auto: 0, quiet: 1, low: 2, medium: 3, high: 4, powerful: 5, turbo: 6, intelligent: 8,
}

export const AC_POWER_STATES = { 0: 'off', 1: 'on', 2: 'awayOff', 3: 'awayOn', 4: 'off', 5: 'sleep' }

export function crc16modbus(buf) {
  let crc = 0xffff
  for (const b of buf) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1
    }
  }
  return crc
}

/** Build a full frame ready to send. `fromConsole` flips the address pair. */
export function encodeFrame(msgType, msgId, data, fromConsole = false) {
  const consoleAddr = msgType === MSG_EXTENDED ? 0x90 : 0x80
  const body = Buffer.alloc(6 + data.length)
  body[0] = fromConsole ? 0xb0 : consoleAddr
  body[1] = fromConsole ? consoleAddr : 0xb0
  body[2] = msgId & 0xff
  body[3] = msgType
  body.writeUInt16BE(data.length, 4)
  data.copy(body, 6)
  const crc = Buffer.alloc(2)
  crc.writeUInt16BE(crc16modbus(body))
  return Buffer.concat([HEADER, body, crc])
}

/**
 * Incremental frame extractor. Feed raw socket chunks; returns parsed frames.
 * Scans byte-by-byte for the inner sync pattern, which naturally skips the
 * console's outer 55 55 55 AB wrapper and re-syncs after garbage.
 */
export class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0)
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames = []
    for (;;) {
      const start = this.buffer.indexOf(HEADER)
      if (start === -1) {
        // Keep a small tail in case a sync pattern spans chunks.
        if (this.buffer.length > 3) this.buffer = this.buffer.subarray(this.buffer.length - 3)
        break
      }
      if (start > 0) this.buffer = this.buffer.subarray(start)
      if (this.buffer.length < 12) break
      const dataLen = this.buffer.readUInt16BE(8)
      const total = 12 + dataLen
      if (dataLen > 4096) {
        // Implausible length — false sync, skip one byte and rescan.
        this.buffer = this.buffer.subarray(1)
        continue
      }
      if (this.buffer.length < total) break
      const frame = this.buffer.subarray(0, total)
      this.buffer = this.buffer.subarray(total)
      const body = frame.subarray(4, total - 2)
      const crc = frame.readUInt16BE(total - 2)
      if (crc !== crc16modbus(body)) {
        continue // corrupt or false sync; the scan continues from the next header
      }
      frames.push({
        to: frame[4],
        from: frame[5],
        msgId: frame[6],
        msgType: frame[7],
        data: Buffer.from(frame.subarray(10, 10 + dataLen)),
      })
    }
    return frames
  }
}

// ---------------------------------------------------------------------------
// Control/status (0xC0) helpers
// ---------------------------------------------------------------------------

/** Sub-header + repeated entries for a 0xC0 message. */
export function encodeControlData(subType, entries, entrySize) {
  const data = Buffer.alloc(8 + entries.length * entrySize)
  data[0] = subType
  data.writeUInt16BE(0, 2) // normal data length
  data.writeUInt16BE(entries.length ? entrySize : 0, 4)
  data.writeUInt16BE(entries.length, 6)
  entries.forEach((entry, i) => Buffer.from(entry).copy(data, 8 + i * entrySize))
  return data
}

/** Parse a 0xC0 payload into { subType, entries: Buffer[] }. */
export function decodeControlData(data) {
  if (data.length < 8) return null
  const subType = data[0]
  const normalLen = data.readUInt16BE(2)
  const repeatLen = data.readUInt16BE(4)
  const count = data.readUInt16BE(6)
  const entries = []
  let offset = 8 + normalLen
  for (let i = 0; i < count && offset + repeatLen <= data.length; i++) {
    entries.push(data.subarray(offset, offset + repeatLen))
    offset += repeatLen
  }
  return { subType, entries }
}

export const encodeTemp = (celsius) => Math.round(celsius * 10 - 100) & 0xff
export const decodeSetpoint = (raw) => (raw === 0xff ? null : (raw + 100) / 10)

function decodeTemperature(raw16) {
  const raw = raw16 & 0x07ff
  return raw > 2000 ? null : (raw - 500) / 10
}

// --- Zone control (0x20) ---

const ZONE_SETTING = { keep: 0b000, decrease: 0b010, increase: 0b011, percent: 0b100, setpoint: 0b101 }
const ZONE_POWER_CODES = { keep: 0b000, toggle: 0b001, off: 0b010, on: 0b011, turbo: 0b101 }

export function zoneControlEntry(zone, { power = 'keep', setting = 'keep', value = null } = {}) {
  const settingBits = ZONE_SETTING[setting] ?? 0
  let valueByte = 0xff
  if (setting === 'percent') valueByte = Math.max(0, Math.min(100, Math.round(value)))
  if (setting === 'setpoint') valueByte = encodeTemp(value)
  return [zone & 0x3f, (settingBits << 5) | (ZONE_POWER_CODES[power] ?? 0), valueByte, 0]
}

export function zoneControlMessage(entries) {
  return encodeControlData(SUB_ZONE_CONTROL, entries, 4)
}

// --- Zone status (0x21) ---

export const zoneStatusRequest = () => encodeControlData(SUB_ZONE_STATUS, [], 0)

export function parseZoneStatus(entries) {
  return entries.map((e) => {
    const powerBits = (e[0] >> 6) & 0x03
    return {
      id: e[0] & 0x3f,
      power: powerBits === 3 ? 'turbo' : powerBits === 1 ? 'on' : 'off',
      controlMethod: e[1] & 0x80 ? 'temp' : 'percent',
      openPercent: e[1] & 0x7f,
      setpoint: decodeSetpoint(e[2]),
      hasSensor: !!(e[3] & 0x80),
      currentTemp: decodeTemperature(e.readUInt16BE(4)),
      spill: !!(e[6] & 0x02),
      lowBattery: !!(e[6] & 0x01),
    }
  })
}

// --- AC control (0x22) ---

const AC_POWER_CODES = { keep: 0b0000, toggle: 0b0001, off: 0b0010, on: 0b0011, away: 0b0100, sleep: 0b0101 }

export function acControlEntry(ac, { power = 'keep', mode = null, fanSpeed = null, setpoint = null } = {}) {
  const modeBits = mode != null ? (AC_MODE_CODES[mode] ?? 0xf) : 0xf
  const fanBits = fanSpeed != null ? (FAN_SPEED_CODES[fanSpeed] ?? 0xf) : 0xf
  const spFlag = setpoint != null ? 0x40 : 0x00
  const spValue = setpoint != null ? encodeTemp(setpoint) : 0xff
  return [((AC_POWER_CODES[power] ?? 0) << 4) | (ac & 0x0f), (modeBits << 4) | fanBits, spFlag, spValue]
}

export function acControlMessage(entries) {
  return encodeControlData(SUB_AC_CONTROL, entries, 4)
}

// --- AC status (0x23) ---

export const acStatusRequest = () => encodeControlData(SUB_AC_STATUS, [], 0)

export function parseAcStatus(entries) {
  return entries.map((e) => {
    const rawFan = e[1] & 0x0f
    return {
      id: e[0] & 0x0f,
      power: AC_POWER_STATES[(e[0] >> 4) & 0x0f] ?? 'off',
      mode: AC_MODES[(e[1] >> 4) & 0x0f] ?? 'auto',
      fanSpeed: FAN_SPEEDS[rawFan] ?? 'auto',
      setpoint: decodeSetpoint(e[2]),
      turbo: !!(e[3] & 0x08),
      bypass: !!(e[3] & 0x04),
      spill: !!(e[3] & 0x02),
      timerSet: !!(e[3] & 0x01),
      currentTemp: decodeTemperature(e.readUInt16BE(4)),
      errorCode: e.length >= 8 ? e.readUInt16BE(6) : 0,
    }
  })
}

// --- AC timers (0x32 control / 0x33 status, undocumented) ---
//
// Each AC has exactly one on-timer and one off-timer, stored as absolute
// time-of-day in the console's local time. The 2-byte timer state is:
//   byte0: bit7 = DISABLED flag (note polarity), bits4-0 = hour
//   byte1: bits5-0 = minute
// Disabled timers carry stale hour/minute garbage — ignore those values.
// The control message payload is identical to the status layout, and always
// carries BOTH timers, so changing one requires echoing the other.

export const acTimerStatusRequest = () => encodeControlData(SUB_AC_TIMER_STATUS, [], 0)

function decodeTimerState(b0, b1) {
  return { enabled: !(b0 & 0x80), hour: b0 & 0x1f, minute: b1 & 0x3f }
}

function encodeTimerState(timer) {
  if (!timer?.enabled) return [0x80, 0]
  return [timer.hour & 0x1f, timer.minute & 0x3f]
}

export function parseAcTimerStatus(entries) {
  return entries.map((e) => ({
    id: e[0],
    on: decodeTimerState(e[1], e[2]),
    off: decodeTimerState(e[3], e[4]),
  }))
}

export function acTimerControlMessage(ac, onTimer, offTimer) {
  const entry = [ac & 0x0f, ...encodeTimerState(onTimer), ...encodeTimerState(offTimer), 0, 0, 0, 0]
  return encodeControlData(SUB_AC_TIMER_CONTROL, [entry], 9)
}

/** Countdown-style timer: turn the AC on/off in hours+minutes from now. */
export function quickTimerMessage(ac, type, hours, minutes) {
  const data = Buffer.alloc(6)
  data.writeUInt16BE(EXT_QUICK_TIMER, 0)
  data[2] = ac & 0x0f
  data[3] = type === 'on' ? 1 : 0
  data[4] = hours % 24
  data[5] = minutes % 60
  return data
}

// ---------------------------------------------------------------------------
// Extended (0x1F) helpers
// ---------------------------------------------------------------------------

export function extendedRequest(subType, unit = null) {
  const data = Buffer.alloc(unit != null ? 3 : 2)
  data.writeUInt16BE(subType, 0)
  if (unit != null) data[2] = unit
  return data
}

export function parseExtended(data) {
  if (data.length < 2) return null
  return { subType: data.readUInt16BE(0), payload: data.subarray(2) }
}

const MODE_ABILITY_BITS = { auto: 0x01, heat: 0x02, dry: 0x04, fan: 0x08, cool: 0x10 }
const FAN_ABILITY_BITS = {
  auto: 0x01, quiet: 0x02, low: 0x04, medium: 0x08, high: 0x10, powerful: 0x20, turbo: 0x40, intelligent: 0x80,
}

/** Parse AC ability payload: repeated 26-byte records (2 + "following length" 24). */
export function parseAcAbility(payload) {
  const abilities = []
  let offset = 0
  while (offset + 2 <= payload.length) {
    const followLen = payload[offset + 1]
    const record = payload.subarray(offset, offset + 2 + followLen)
    if (record.length < 26) break
    abilities.push({
      id: record[0],
      name: decodeText(record.subarray(2, 18)),
      startZone: record[18],
      zoneCount: record[19],
      modes: Object.keys(MODE_ABILITY_BITS).filter((m) => record[20] & MODE_ABILITY_BITS[m]),
      fanSpeeds: Object.keys(FAN_ABILITY_BITS).filter((f) => record[21] & FAN_ABILITY_BITS[f]),
      minCool: record[22],
      maxCool: record[23],
      minHeat: record[24],
      maxHeat: record[25],
    })
    offset += 2 + followLen
  }
  return abilities
}

/** Parse zone names payload: repeated [zone, len, utf8...] records. */
export function parseZoneNames(payload) {
  const names = new Map()
  let offset = 0
  while (offset + 2 <= payload.length) {
    const zone = payload[offset]
    const len = payload[offset + 1]
    names.set(zone, decodeText(payload.subarray(offset + 2, offset + 2 + len)))
    offset += 2 + len
  }
  return names
}

/** Parse console version payload. */
export function parseConsoleVersion(payload) {
  if (payload.length < 2) return null
  const len = payload[1]
  return {
    updateAvailable: payload[0] !== 0,
    version: decodeText(payload.subarray(2, 2 + len)),
  }
}

/** Parse AC error info payload. */
export function parseAcError(payload) {
  if (payload.length < 2) return null
  const len = payload[1]
  return { ac: payload[0], error: len ? decodeText(payload.subarray(2, 2 + len)) : null }
}

// Console text is UTF-8, NUL-padded, and occasionally invalid (emoji bugs) —
// decode leniently and stop at the first NUL.
function decodeText(buf) {
  const nul = buf.indexOf(0)
  const slice = nul === -1 ? buf : buf.subarray(0, nul)
  return slice.toString('utf8').replace(/�/g, '').trim()
}
