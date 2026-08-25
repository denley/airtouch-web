import { AirTouchSimulator } from './sim.js'

const sim = new AirTouchSimulator({
  tcpPort: Number(process.env.SIM_PORT || 9005),
  discovery: process.env.SIM_DISCOVERY !== '0',
})
sim.start()

process.on('SIGINT', () => {
  sim.stop()
  process.exit(0)
})
