import { useState } from 'react'
import type { DiscoveredConsole } from '../types'
import { SearchIcon, SnowflakeIcon } from './icons'

interface Props {
  discovered: DiscoveredConsole[] | null
  discovering: boolean
  onDiscover: () => void
  onConnect: (ip: string, name?: string) => void
}

export function ConnectScreen({ discovered, discovering, onDiscover, onConnect }: Props) {
  const [ip, setIp] = useState('')

  return (
    <div className="connect-screen">
      <div className="logo">
        <SnowflakeIcon size={36} />
      </div>
      <h2>Connect to AirTouch</h2>
      <p>Find your AirTouch 5 console on the local network, or enter its IP address manually.</p>

      <button className="primary-btn" onClick={onDiscover} disabled={discovering}>
        {discovering ? (
          <>
            <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Searching…
          </>
        ) : (
          <>
            <SearchIcon size={18} /> Search for consoles
          </>
        )}
      </button>

      {discovered && discovered.length > 0 && (
        <div className="console-list">
          {discovered.map((c) => (
            <button key={c.ip} className="console-item" onClick={() => onConnect(c.ip, c.name)}>
              <div>
                <div className="name">{c.name || 'AirTouch 5'}</div>
                <div className="ip">{c.ip}</div>
              </div>
              <span className="badge accent">Connect</span>
            </button>
          ))}
        </div>
      )}

      {discovered && discovered.length === 0 && (
        <p className="hint" style={{ marginTop: 16 }}>
          No consoles found. Make sure the console is on the same network, then try again — or enter
          its IP below.
        </p>
      )}

      <div className="divider">or</div>

      <form
        className="ip-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (ip.trim()) onConnect(ip.trim())
        }}
      >
        <input
          className="ip-input"
          placeholder="Console IP, e.g. 192.168.1.50"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          inputMode="decimal"
        />
        <button className="primary-btn" type="submit" disabled={!ip.trim()}>
          Connect
        </button>
      </form>

      <p className="hint">
        You can find the console's IP in the AirTouch console under Settings → Network, or in your
        router's device list.
      </p>
    </div>
  )
}
