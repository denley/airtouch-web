# AirTouch Web

A polished web app for controlling a Polyaire **AirTouch 5** console on your local network.

The AirTouch 5 speaks a binary TCP protocol that browsers can't talk to directly, so this app has
two parts:

- **Bridge server** (`server/`) — a small Node.js server that discovers the console via UDP,
  maintains a TCP connection to it, and exposes live state + controls to the browser over a
  WebSocket. It also serves the built web app.
- **Web app** (`web/`) — a React UI with full AC + zone controls, live updates, light/dark themes,
  and a mobile-first layout.

## Features

- **Auto-discovery** of AirTouch 5 consoles on the network (with manual IP fallback)
- **AC control**: power, mode (cool/heat/fan/dry/auto), fan speed, setpoint in **0.5° steps** (finer
  than the official app!), plus **Sleep** and **Away** presets — with each AC's actual supported
  modes/fan speeds/setpoint ranges read from the console
- **Quick timers**: "turn off in 2h" / "turn on in 30m" style timers, shown with their scheduled
  time and cancellable with a tap
- **Zone control**: on/off, damper percentage slider, temperature setpoint for zones with sensors,
  press-and-hold to step setpoints quickly
- **Temperature history**: the bridge records zone temperatures once a minute (48h retained) and
  charts them with hover details; each zone's chart colour matches the dot on its card
- **Live state**: the console pushes changes (from wall panels, the official app, schedules) and the
  UI updates instantly in every open browser; changes made here show up optimistically and reconcile
  with the console
- **Status indicators**: current temps, spill/bypass/turbo, low sensor battery, AC error text
- **Quick actions**: all zones on/off
- Automatic reconnect to both the console and the bridge; light/dark themes; installable as a
  home-screen app on phones

## Getting started

```
npm install
npm run build
npm start
```

Then open <http://localhost:3000> (or `http://<this-machine>:3000` from your phone), hit
**Search for consoles**, and pick your console. The chosen console IP is remembered in
`data/config.json`.

You can also set the console IP up front: `AIRTOUCH_IP=192.168.1.50 npm start`, and `PORT` to change
the web port.

## Development

```
npm run dev
```

Runs the bridge server (port 3000) and the Vite dev server (port 5173, proxying to the bridge) with
hot reload.

### Simulator

No console handy? Run with a simulated AirTouch 5 (real protocol, fake hardware) — it connects
automatically:

```
npm run start:sim
```

(or `npm run dev:sim` for the hot-reload version). The simulator has one AC and five zones, responds
to all controls, answers discovery, and drifts its temperatures toward setpoints over time. Nothing
is saved to `data/config.json` in sim mode, so your real console setup is untouched.

### Tests

```
npm test
```

Runs the protocol codec tests (verified byte-for-byte against the official protocol document's
example packets) and an end-to-end integration test that drives a real client against the simulator
over TCP, including reconnect behaviour.

## Notes

- Ports used by the console: UDP `49005` (discovery), TCP `9005` (control protocol).
- The bridge keeps a single TCP connection to the console and fans state out to any number of
  browser tabs.
- History is stored in `data/history.json`; the chosen console in `data/config.json`.

## Acknowledgements

The protocol implementation was written from the official Polyaire "AirTouch 5 Communication
Protocol" document, with byte-level details and real-world quirks cross-checked against two
excellent open-source implementations: [airtouch5py](https://github.com/danzel/airtouch5py) and
[pyairtouch](https://github.com/TheNoctambulist/pyairtouch). The undocumented timer messages follow
pyairtouch's reverse engineering.

This is an unofficial hobby project. *AirTouch* is a trademark of Polyaire Pty Ltd; this project is
not affiliated with or endorsed by Polyaire.

## License

[MIT](LICENSE)
