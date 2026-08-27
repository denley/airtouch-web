import { useEffect, useMemo, useState } from 'react'
import { AcCard, acAccentStyle } from './components/AcCard'
import { ConnectScreen } from './components/ConnectScreen'
import { HistoryChart } from './components/HistoryChart'
import { MoonIcon, SettingsIcon, SunIcon, WifiOffIcon } from './components/icons'
import { ZoneRow } from './components/ZoneRow'
import type { AcState, ZoneState } from './types'
import { patchAc, patchAllZones, patchZone, useAirTouch } from './useAirTouch'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  const saved = localStorage.getItem('theme')
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const { state, wsConnected, discovered, discovering, lastError, send } = useAirTouch()
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [showConnect, setShowConnect] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  const { connection, acs, zones } = state

  // Group zones under their AC using each AC's ability info; with a single AC
  // (the common case) every zone belongs to it.
  const zonesByAc = useMemo(() => {
    const map = new Map<number, ZoneState[]>()
    if (acs.length <= 1) {
      if (acs.length === 1) map.set(acs[0].id, zones)
      return map
    }
    for (const ac of acs) {
      const a = ac.ability
      const list = a
        ? zones.filter((z) => z.id >= a.startZone && z.id < a.startZone + a.zoneCount)
        : []
      map.set(ac.id, list)
    }
    // Any zone not claimed by an AC goes to the first one.
    const claimed = new Set([...map.values()].flat().map((z) => z.id))
    const orphans = zones.filter((z) => !claimed.has(z.id))
    if (orphans.length && acs.length) {
      map.set(acs[0].id, [...(map.get(acs[0].id) ?? []), ...orphans])
    }
    return map
  }, [acs, zones])

  const showConnectScreen = connection.status === 'unconfigured' || showConnect

  const anyZoneOn = zones.some((z) => z.power !== 'off')

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>
            <span
              className={`conn-dot${
                connection.status === 'connected'
                  ? ''
                  : connection.status === 'connecting'
                    ? ' pending'
                    : ' bad'
              }`}
            />
            AirTouch
          </h1>
          {connection.consoleName && (
            <div className="subtitle">
              {connection.consoleName}
              {connection.consoleIp ? ` · ${connection.consoleIp}` : ''}
            </div>
          )}
        </div>
        <div className="header-actions">
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowConnect((v) => !v)}
            aria-label="Console settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {!wsConnected && (
        <div className="banner warn">
          <WifiOffIcon size={16} />
          Reconnecting to the bridge server…
        </div>
      )}

      {showConnectScreen ? (
        <ConnectScreen
          discovered={discovered}
          discovering={discovering}
          onDiscover={() => send({ cmd: 'discover' })}
          onConnect={(ip, name) => {
            send({ cmd: 'connect', ip, name })
            setShowConnect(false)
          }}
        />
      ) : connection.status === 'connecting' && acs.length === 0 ? (
        <div className="loading-screen">
          <div className="spinner" />
          Connecting to {connection.consoleIp}…
        </div>
      ) : connection.status === 'disconnected' && acs.length === 0 ? (
        <div className="banner danger">
          <WifiOffIcon size={16} />
          Lost connection to the console at {connection.consoleIp}. Retrying…
          <span className="spacer" />
          <button onClick={() => setShowConnect(true)}>Change console</button>
        </div>
      ) : (
        <>
          {connection.status === 'disconnected' && (
            <div className="banner danger">
              <WifiOffIcon size={16} />
              Connection lost — showing the last known state. Retrying…
            </div>
          )}

          <div className="layout">
            <aside className="layout-side">
              {acs.map((ac) => (
                <div key={ac.id}>
                  {ac.errorCode !== 0 && (
                    <div className="banner danger">
                      ⚠ {ac.name || 'AC'} reports an error
                      {ac.errorText ? `: ${ac.errorText}` : ` (code ${ac.errorCode})`}. Check the
                      console for details.
                    </div>
                  )}
                  <AcCard
                    ac={ac}
                    showName={acs.length > 1}
                    setpointEditable={(zonesByAc.get(ac.id) ?? []).some(
                      (z) => z.power !== 'off' && !(z.controlMethod === 'temp' && z.hasSensor),
                    )}
                    onPower={(state) =>
                      send(
                        { cmd: 'ac.power', ac: ac.id, state },
                        `ac-power-${ac.id}`,
                        patchAc(ac.id, {
                          power: state === 'away' ? 'awayOn' : state,
                        }),
                      )
                    }
                    onMode={(mode) =>
                      send({ cmd: 'ac.mode', ac: ac.id, mode }, `ac-mode-${ac.id}`, patchAc(ac.id, { mode }))
                    }
                    onFan={(speed) =>
                      send({ cmd: 'ac.fan', ac: ac.id, speed }, `ac-fan-${ac.id}`, patchAc(ac.id, { fanSpeed: speed }))
                    }
                    onSetpoint={(value) =>
                      send({ cmd: 'ac.setpoint', ac: ac.id, value }, `ac-sp-${ac.id}`, patchAc(ac.id, { setpoint: value }))
                    }
                    onQuickTimer={(type, minutes) => send({ cmd: 'ac.quickTimer', ac: ac.id, type, minutes })}
                    onCancelTimer={(type) => send({ cmd: 'ac.cancelTimer', ac: ac.id, type })}
                  />
                </div>
              ))}
            </aside>

            <div className="layout-main">
              {acs.map((ac) => {
                const acZones = zonesByAc.get(ac.id) ?? []
                if (acZones.length === 0) return null
                return (
                  <section key={ac.id} className="zone-section" style={acAccentStyle(ac)}>
                    <div className="zones-head">
                      <h2>
                        {acs.length > 1 ? `${ac.name} zones` : 'Zones'}
                        <span className="count">
                          {acZones.filter((z) => z.power !== 'off').length} of {acZones.length} on
                        </span>
                      </h2>
                      <button
                        className="text-btn"
                        onClick={() => {
                          const target = anyZoneOn ? 'off' : 'on'
                          send(
                            { cmd: 'zones.allPower', state: target },
                            'zones-all',
                            patchAllZones({ power: target }),
                          )
                        }}
                      >
                        {anyZoneOn ? 'All off' : 'All on'}
                      </button>
                    </div>
                    <div className="zone-list">
                      {acZones.map((zone) => (
                        <ZoneRow
                          key={zone.id}
                          zone={zone}
                          setpointRange={[
                            Math.min(ac.ability?.minCool ?? 16, ac.ability?.minHeat ?? 16),
                            Math.max(ac.ability?.maxCool ?? 31, ac.ability?.maxHeat ?? 31),
                          ]}
                          onPower={(s) =>
                            send({ cmd: 'zone.power', zone: zone.id, state: s }, `zone-power-${zone.id}`, patchZone(zone.id, { power: s }))
                          }
                          onPercent={(value) =>
                            send({ cmd: 'zone.percent', zone: zone.id, value }, `zone-pct-${zone.id}`, patchZone(zone.id, { openPercent: value }))
                          }
                          onSetpoint={(value) =>
                            send({ cmd: 'zone.setpoint', zone: zone.id, value }, `zone-sp-${zone.id}`, patchZone(zone.id, { setpoint: value }))
                          }
                        />
                      ))}
                    </div>
                  </section>
                )
              })}

              {zones.some((z) => z.hasSensor) && (
                <>
                  <div className="zones-head">
                    <h2>History</h2>
                  </div>
                  <HistoryChart zones={zones} />
                </>
              )}
            </div>
          </div>

          {acs.length === 0 && connection.status === 'connected' && (
            <div className="loading-screen">
              <div className="spinner" />
              Waiting for console data…
            </div>
          )}
        </>
      )}

      {lastError && <div className="toast">{lastError}</div>}
    </div>
  )
}
