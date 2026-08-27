import type { ZoneState } from '../types'
import { formatSetpoint } from './AcCard'
import { seriesVar } from './HistoryChart'
import { StepButton } from './StepButton'
import { BatteryLowIcon, BoltIcon, ClockIcon, MinusIcon, PlusIcon, WindIcon } from './icons'

interface Props {
  zone: ZoneState
  /** Allowed setpoint range, from the owning AC's ability. */
  setpointRange: [number, number]
  onPower: (state: 'on' | 'off') => void
  onPercent: (value: number) => void
  onSetpoint: (value: number) => void
}

/**
 * One row in the zones list. Primary controls (setpoint / damper stepper and
 * the power toggle) sit in aligned columns on the right; current temperature
 * and the live damper bar stay visible as secondary info.
 */
export function ZoneRow({ zone, setpointRange, onPower, onPercent, onSetpoint }: Props) {
  const on = zone.power !== 'off'
  const tempControlled = zone.controlMethod === 'temp' && zone.hasSensor

  return (
    <div className={`zone-row${on ? '' : ' is-off'}`}>
      <div className="zr-info">
        <div className="zr-name-row">
          <span className="zone-dot" style={{ background: zone.hasSensor ? seriesVar(zone.id) : 'var(--text-3)' }} />
          <span className="zr-name">{zone.name || `Zone ${zone.id + 1}`}</span>
          {zone.power === 'turbo' && (
            <span className="badge accent">
              <BoltIcon size={11} /> Turbo
            </span>
          )}
          {zone.spill && (
            <span className="badge warn" title="Excess air is being vented through this zone">
              <WindIcon size={11} /> Spill
            </span>
          )}
          {zone.lowBattery && (
            <span className="badge danger" title="The zone's temperature sensor battery is low">
              <BatteryLowIcon size={11} />
            </span>
          )}
        </div>
        <div className="zr-meta">
          <span className="bar">
            <i style={{ width: `${on ? zone.openPercent : 0}%` }} />
          </span>
          <span className="pct">{on ? `${zone.openPercent}%` : 'closed'}</span>
        </div>
      </div>

      <div className={`zr-temp${zone.currentTemp == null ? ' na' : ''}`}>
        {zone.currentTemp != null ? (
          <>
            {zone.tempStale && (
              <span
                className="stale"
                title="Reading hasn't changed in over 3 hours — the sensor may have stopped reporting"
              >
                <ClockIcon size={12} />
              </span>
            )}
            {zone.currentTemp.toFixed(1)}
            <span className="unit">°</span>
          </>
        ) : (
          '—'
        )}
      </div>

      <div className="zr-sp">
        {tempControlled && zone.setpoint != null ? (
          <>
            <StepButton
              className="step-btn"
              disabled={!on || zone.setpoint <= setpointRange[0]}
              onStep={() => onSetpoint(Math.max(setpointRange[0], zone.setpoint! - 0.5))}
              aria-label={`Lower ${zone.name} setpoint`}
            >
              <MinusIcon size={15} />
            </StepButton>
            <span className="sp-value">{formatSetpoint(zone.setpoint)}°</span>
            <StepButton
              className="step-btn"
              disabled={!on || zone.setpoint >= setpointRange[1]}
              onStep={() => onSetpoint(Math.min(setpointRange[1], zone.setpoint! + 0.5))}
              aria-label={`Raise ${zone.name} setpoint`}
            >
              <PlusIcon size={15} />
            </StepButton>
          </>
        ) : (
          <>
            <StepButton
              className="step-btn"
              disabled={!on || zone.openPercent <= 5}
              onStep={() => onPercent(Math.max(5, zone.openPercent - 5))}
              aria-label={`Close ${zone.name} damper`}
            >
              <MinusIcon size={15} />
            </StepButton>
            <span className="sp-value pct-value">{zone.openPercent}%</span>
            <StepButton
              className="step-btn"
              disabled={!on || zone.openPercent >= 100}
              onStep={() => onPercent(Math.min(100, zone.openPercent + 5))}
              aria-label={`Open ${zone.name} damper`}
            >
              <PlusIcon size={15} />
            </StepButton>
          </>
        )}
      </div>

      <button
        className={`zone-toggle${on ? ' on' : ''}`}
        onClick={() => onPower(on ? 'off' : 'on')}
        aria-label={`Turn ${zone.name} ${on ? 'off' : 'on'}`}
        role="switch"
        aria-checked={on}
      />
    </div>
  )
}
