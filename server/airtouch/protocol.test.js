// Verifies the codec against packet captures from the official AirTouch 5
// protocol document (as reproduced in the airtouch5py test suite).
// Run with: npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FrameReader,
  MSG_CONTROL_STATUS,
  acControlEntry,
  acControlMessage,
  acStatusRequest,
  acTimerControlMessage,
  decodeControlData,
  encodeFrame,
  parseAcAbility,
  parseAcStatus,
  parseAcTimerStatus,
  parseZoneNames,
  parseZoneStatus,
  quickTimerMessage,
  zoneControlEntry,
  zoneControlMessage,
  zoneStatusRequest,
} from './protocol.js'

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex')

test('zone status request frame matches the documented bytes', () => {
  const frame = encodeFrame(MSG_CONTROL_STATUS, 1, zoneStatusRequest())
  assert.deepEqual(frame, hex('55 55 55 AA 80 B0 01 C0 00 08 21 00 00 00 00 00 00 00 A4 31'))
})

test('ac status request frame matches the documented bytes', () => {
  const frame = encodeFrame(MSG_CONTROL_STATUS, 1, acStatusRequest())
  assert.deepEqual(frame, hex('55 55 55 AA 80 B0 01 C0 00 08 23 00 00 00 00 00 00 00 7D B0'))
})

test('zone control: turn off the second zone (doc example)', () => {
  const data = zoneControlMessage([zoneControlEntry(1, { power: 'off' })])
  const frame = encodeFrame(MSG_CONTROL_STATUS, 0x0f, data)
  // Doc uses 0x22 for byte1 (keep-setting bits 001); we emit 0b000 "keep" = 0x02,
  // both mean "no setting change + set off". Compare the decoded meaning instead.
  const parsed = decodeControlData(frame.subarray(10, frame.length - 2))
  assert.equal(parsed.subType, 0x20)
  assert.equal(parsed.entries.length, 1)
  const e = parsed.entries[0]
  assert.equal(e[0], 1)
  assert.equal(e[1] & 0x07, 0b010) // set off
  assert.equal(e[3], 0)
})

test('ac control: cool AC0 + setpoint 26.0 on AC1 (doc example)', () => {
  const data = acControlMessage([
    acControlEntry(0, { mode: 'cool' }),
    acControlEntry(1, { setpoint: 26 }),
  ])
  const frame = encodeFrame(MSG_CONTROL_STATUS, 1, data)
  assert.deepEqual(
    frame,
    hex('55 55 55 AA 80 B0 01 C0 00 10 22 00 00 00 00 04 00 02 00 4F 00 FF 01 FF 40 A0 10 4B'),
  )
})

test('zone status response decodes (doc example, 2 zones)', () => {
  const wire = hex(
    '55 55 55 AA B0 80 01 C0 00 18 21 00 00 00 00 08 00 02' +
      '40 80 96 80 02 E7 00 00' +
      '01 64 FF 00 07 FF 00 00' +
      'B9 EF',
  )
  const reader = new FrameReader()
  const frames = reader.push(wire)
  assert.equal(frames.length, 1)
  const parsed = decodeControlData(frames[0].data)
  const zones = parseZoneStatus(parsed.entries)
  assert.deepEqual(zones[0], {
    id: 0,
    power: 'on',
    controlMethod: 'temp',
    openPercent: 0,
    setpoint: 25,
    hasSensor: true,
    currentTemp: 24.3,
    spill: false,
    lowBattery: false,
  })
  assert.deepEqual(zones[1], {
    id: 1,
    power: 'off',
    controlMethod: 'percent',
    openPercent: 100,
    setpoint: null,
    hasSensor: false,
    currentTemp: null,
    spill: false,
    lowBattery: false,
  })
})

test('ac status response decodes (doc example, 2 ACs)', () => {
  const wire = hex(
    '55 55 55 AA B0 80 01 C0 00 1C 23 00 00 00 00 0A 00 02' +
      '10 12 78 C0 02 DA 00 00 80 00' +
      '01 42 64 C0 02 E4 00 00 80 00' +
      '3D 79',
  )
  const frames = new FrameReader().push(wire)
  assert.equal(frames.length, 1)
  const acs = parseAcStatus(decodeControlData(frames[0].data).entries)
  assert.equal(acs[0].power, 'on')
  assert.equal(acs[0].mode, 'heat')
  assert.equal(acs[0].fanSpeed, 'low')
  assert.equal(acs[0].setpoint, 22)
  assert.equal(acs[0].currentTemp, 23)
  assert.equal(acs[0].errorCode, 0)
  assert.equal(acs[1].power, 'off')
  assert.equal(acs[1].mode, 'cool')
  assert.equal(acs[1].setpoint, 20)
  assert.equal(acs[1].currentTemp, 24)
})

test('ac status with 14-byte entries (console >= 1.2.0) still decodes', () => {
  const wire = hex(
    '55 55 55 AA B0 80 07 C0 00 16 23 00 00 00 00 0E 00 01' +
      '10 12 82 C5 0A BF 00 00 E5 00 E2 E4 00 00' +
      'A7 D5',
  )
  const frames = new FrameReader().push(wire)
  assert.equal(frames.length, 1)
  const acs = parseAcStatus(decodeControlData(frames[0].data).entries)
  assert.equal(acs[0].power, 'on')
  assert.equal(acs[0].mode, 'heat')
  assert.equal(acs[0].setpoint, 23)
  assert.equal(acs[0].currentTemp, 20.3) // high bits must be masked off
  assert.equal(acs[0].bypass, true)
  assert.equal(acs[0].timerSet, true)
  assert.equal(acs[0].errorCode, 0)
})

test('ac ability decodes (doc example, corrected)', () => {
  const payload = Buffer.concat([
    Buffer.from([0x00, 0x18]),
    Buffer.concat([Buffer.from('UNIT'), Buffer.alloc(12)]),
    Buffer.from([0x00, 0x04, 0x17, 0x1d, 0x10, 0x1f, 0x12, 0x1f]),
  ])
  const [ability] = parseAcAbility(payload)
  assert.equal(ability.name, 'UNIT')
  assert.equal(ability.startZone, 0)
  assert.equal(ability.zoneCount, 4)
  assert.deepEqual(ability.modes.sort(), ['auto', 'cool', 'dry', 'heat'])
  assert.deepEqual(ability.fanSpeeds.sort(), ['auto', 'high', 'low', 'medium'])
  assert.equal(ability.minCool, 16)
  assert.equal(ability.maxCool, 31)
  assert.equal(ability.minHeat, 18)
  assert.equal(ability.maxHeat, 31)
})

test('zone names decode', () => {
  const payload = Buffer.concat([
    Buffer.from([0, 6]),
    Buffer.from('Living'),
    Buffer.from([1, 7]),
    Buffer.from('Kitchen'),
    Buffer.from([2, 7]),
    Buffer.from('Bedroom'),
  ])
  const names = parseZoneNames(payload)
  assert.equal(names.get(0), 'Living')
  assert.equal(names.get(1), 'Kitchen')
  assert.equal(names.get(2), 'Bedroom')
})

test('ac timer status decodes (pyairtouch golden bytes)', () => {
  const entries = [
    hex('01 82 03 84 05 00 00 00 00'), // AC1: both disabled (stale times)
    hex('01 02 03 84 05 00 00 00 00'), // AC1: on-timer active 02:03, off disabled
    hex('02 82 03 17 3B 00 00 00 00'), // AC2: off-timer active 23:59
  ]
  const parsed = parseAcTimerStatus(entries)
  assert.equal(parsed[0].on.enabled, false)
  assert.equal(parsed[0].off.enabled, false)
  assert.deepEqual(parsed[1].on, { enabled: true, hour: 2, minute: 3 })
  assert.equal(parsed[1].off.enabled, false)
  assert.equal(parsed[2].id, 2)
  assert.deepEqual(parsed[2].off, { enabled: true, hour: 23, minute: 59 })
})

test('ac timer control encodes both timers with padding', () => {
  const data = acTimerControlMessage(1, { enabled: true, hour: 2, minute: 3 }, { enabled: false })
  assert.equal(data[0], 0x32)
  assert.equal(data.readUInt16BE(4), 9)
  assert.equal(data.readUInt16BE(6), 1)
  assert.deepEqual([...data.subarray(8)], [0x01, 0x02, 0x03, 0x80, 0x00, 0, 0, 0, 0])
})

test('quick timer message matches pyairtouch golden bytes', () => {
  assert.deepEqual(quickTimerMessage(1, 'off', 2, 3), hex('FF 49 01 00 02 03'))
  assert.deepEqual(quickTimerMessage(1, 'on', 2, 3), hex('FF 49 01 01 02 03'))
})

test('frame reader survives the outer 55 55 55 AB wrapper and split chunks', () => {
  const inner = encodeFrame(MSG_CONTROL_STATUS, 1, zoneStatusRequest())
  const outer = Buffer.concat([
    hex('55 55 55 AB 00 00'),
    (() => {
      const l = Buffer.alloc(4)
      l.writeUInt16BE(inner.length, 0)
      l.writeUInt16BE(inner.length, 2)
      return l
    })(),
    inner,
  ])
  const reader = new FrameReader()
  const mid = Math.floor(outer.length / 2)
  const frames = [...reader.push(outer.subarray(0, mid)), ...reader.push(outer.subarray(mid))]
  assert.equal(frames.length, 1)
  assert.equal(frames[0].msgType, MSG_CONTROL_STATUS)
  assert.equal(frames[0].data[0], 0x21)
})
