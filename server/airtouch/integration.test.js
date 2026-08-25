// End-to-end test: a real AirTouchClient talking to the simulator over TCP,
// exercising the full startup sequence and every control path.

import test from 'node:test'
import assert from 'node:assert/strict'
import { AirTouchClient } from './client.js'
import { AirTouchSimulator } from '../simulator/sim.js'

const PORT = 19005

function waitFor(client, predicate, label, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const check = (state) => {
      if (predicate(state)) {
        client.off('state', check)
        clearTimeout(timer)
        resolve(state)
      }
    }
    const timer = setTimeout(() => {
      client.off('state', check)
      reject(new Error(`Timed out waiting for: ${label}`))
    }, timeoutMs)
    client.on('state', check)
    check(client.getState())
  })
}

test('client and simulator complete a full session over TCP', async () => {
  const sim = new AirTouchSimulator({ tcpPort: PORT, discovery: false })
  sim.start()
  const client = new AirTouchClient(`127.0.0.1:${PORT}`)
  client.connect()

  try {
    // Startup: abilities, names, version, and both status snapshots arrive.
    const ready = await waitFor(
      client,
      (s) =>
        s.acs.length === 1 &&
        s.zones.length === 5 &&
        s.acs[0].ability != null &&
        s.zones[0].name === 'Living' &&
        s.connection.version === '1.2.3' &&
        s.acs[0].timers != null,
      'initial state',
    )
    assert.equal(ready.acs[0].name, 'Living AC')
    assert.equal(ready.acs[0].ability.zoneCount, 5)
    assert.deepEqual(ready.acs[0].ability.fanSpeeds, [
      'auto', 'quiet', 'low', 'medium', 'high', 'powerful', 'turbo',
    ])

    // AC controls round-trip through the console's status pushes.
    client.setAcMode(0, 'heat')
    await waitFor(client, (s) => s.acs[0].mode === 'heat', 'mode change')

    client.setAcSetpoint(0, 25.5)
    await waitFor(client, (s) => s.acs[0].setpoint === 25.5, 'setpoint change')

    client.setAcFanSpeed(0, 'powerful')
    await waitFor(client, (s) => s.acs[0].fanSpeed === 'powerful', 'fan change')

    client.setAcPower(0, 'sleep')
    await waitFor(client, (s) => s.acs[0].power === 'sleep', 'sleep mode')
    client.setAcPower(0, 'on')
    await waitFor(client, (s) => s.acs[0].power === 'on', 'back on')

    // Zone controls.
    client.setZonePower(4, 'on')
    await waitFor(client, (s) => s.zones[4].power === 'on', 'zone on')

    client.setZonePercent(4, 55)
    await waitFor(client, (s) => s.zones[4].openPercent === 55, 'zone percent')

    client.setZoneSetpoint(0, 24.5)
    await waitFor(client, (s) => s.zones[0].setpoint === 24.5, 'zone setpoint')

    // Quick timer set + cancel.
    client.setQuickTimer(0, 'off', 90)
    await waitFor(client, (s) => s.acs[0].timers.off.enabled, 'timer set')

    client.cancelTimer(0, 'off')
    await waitFor(client, (s) => !s.acs[0].timers.off.enabled, 'timer cancelled')
  } finally {
    client.destroy()
    sim.stop()
  }
})

test('client reconnects after the console drops the connection', async () => {
  const sim = new AirTouchSimulator({ tcpPort: PORT + 1, discovery: false })
  sim.start()
  const client = new AirTouchClient(`127.0.0.1:${PORT + 1}`)
  // Speed the test up: shrink the reconnect delay.
  client.connect()

  try {
    await waitFor(client, (s) => s.connection.status === 'connected' && s.acs.length === 1, 'connected')

    // Kill every socket server-side; the client should notice and retry.
    for (const socket of sim.sockets) socket.destroy()
    await waitFor(client, (s) => s.connection.status !== 'connected', 'disconnect noticed')
    await waitFor(
      client,
      (s) => s.connection.status === 'connected' && s.acs.length === 1,
      'reconnected',
      10_000,
    )
  } finally {
    client.destroy()
    sim.stop()
  }
})
