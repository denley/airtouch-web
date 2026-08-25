import dgram from 'node:dgram'

const DISCOVERY_PORT = 49005
const REQUEST = '::REQUEST-POLYAIRE-AIRTOUCH-DEVICE-INFO:;'

/**
 * Broadcast a discovery request and collect responses for `timeoutMs`.
 * Responses arrive on port 49005 (the same port we broadcast from), as CSV:
 *   <ip>,<consoleId>,AirTouch5,<airtouchId>,<name>
 */
export function discover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const found = new Map()

    const finish = () => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {}
      resolve([...found.values()])
    }
    const timer = setTimeout(finish, timeoutMs)

    socket.on('error', finish)
    socket.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8')
      if (text === REQUEST) return // our own broadcast echoed back
      const parts = text.split(',')
      if (parts.length < 3 || parts[2] !== 'AirTouch5') return
      const ip = parts[0] || rinfo.address
      found.set(ip, {
        ip,
        consoleId: parts[1],
        airtouchId: parts[3],
        // The name may itself contain commas — rejoin the tail.
        name: parts.slice(4).join(',') || 'AirTouch 5',
      })
    })

    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true)
        socket.send(REQUEST, DISCOVERY_PORT, '255.255.255.255')
      } catch {
        finish()
      }
    })
  })
}
