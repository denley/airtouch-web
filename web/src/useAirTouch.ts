import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, Command, DiscoveredConsole, ServerMessage } from './types'

const EMPTY: AppState = { connection: { status: 'unconfigured' }, acs: [], zones: [] }

// How long an optimistic patch stays applied before the console's real state wins.
const OPTIMISTIC_TTL = 4000

interface Patch {
  at: number
  apply: (state: AppState) => AppState
}

export function useAirTouch() {
  const [serverState, setServerState] = useState<AppState>(EMPTY)
  const [wsConnected, setWsConnected] = useState(false)
  const [discovered, setDiscovered] = useState<DiscoveredConsole[] | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const patchesRef = useRef<Map<string, Patch>>(new Map())
  const [, forceRender] = useState(0)

  useEffect(() => {
    let closed = false
    let retryTimer: ReturnType<typeof setTimeout>

    function open() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws`)
      wsRef.current = ws

      ws.onopen = () => setWsConnected(true)
      ws.onclose = () => {
        setWsConnected(false)
        if (!closed) retryTimer = setTimeout(open, 1500)
      }
      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data)
        if (msg.type === 'state') {
          // Fresh console state supersedes stale optimistic patches.
          const now = Date.now()
          for (const [key, patch] of patchesRef.current) {
            if (now - patch.at > OPTIMISTIC_TTL) patchesRef.current.delete(key)
          }
          setServerState(msg.state)
        } else if (msg.type === 'discovered') {
          setDiscovered(msg.consoles)
          setDiscovering(false)
        } else if (msg.type === 'error') {
          setLastError(msg.error)
          setTimeout(() => setLastError(null), 5000)
        }
      }
    }

    open()
    return () => {
      closed = true
      clearTimeout(retryTimer)
      wsRef.current?.close()
    }
  }, [])

  const send = useCallback((command: Command, patchKey?: string, patch?: Patch['apply']) => {
    if (patchKey && patch) {
      patchesRef.current.set(patchKey, { at: Date.now(), apply: patch })
      forceRender((n) => n + 1)
    }
    if (command.cmd === 'discover') {
      setDiscovering(true)
      setDiscovered(null)
    }
    wsRef.current?.send(JSON.stringify(command))
  }, [])

  // Derive the view state: server truth + any recent optimistic patches on top.
  let state = serverState
  const now = Date.now()
  for (const [key, patch] of patchesRef.current) {
    if (now - patch.at > OPTIMISTIC_TTL) {
      patchesRef.current.delete(key)
    } else {
      state = patch.apply(state)
    }
  }

  return { state, wsConnected, discovered, discovering, lastError, send }
}

// Helpers to build optimistic patches for common operations.

export function patchAc(id: number, changes: Partial<AppState['acs'][number]>) {
  return (state: AppState): AppState => ({
    ...state,
    acs: state.acs.map((ac) => (ac.id === id ? { ...ac, ...changes } : ac)),
  })
}

export function patchZone(id: number, changes: Partial<AppState['zones'][number]>) {
  return (state: AppState): AppState => ({
    ...state,
    zones: state.zones.map((z) => (z.id === id ? { ...z, ...changes } : z)),
  })
}

export function patchAllZones(changes: Partial<AppState['zones'][number]>) {
  return (state: AppState): AppState => ({
    ...state,
    zones: state.zones.map((z) => ({ ...z, ...changes })),
  })
}
