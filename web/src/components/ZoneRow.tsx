import type { ZoneState } from '../types'
import { formatSetpoint } from './AcCard'
import { StepButton } from './StepButton'
import { BatteryLowIcon, BoltIcon, ClockIcon, MinusIcon, PlusIcon, PowerIcon, WindIcon } from './icons'

interface Props {
  zone: ZoneState
  /** Allowed setpoint range, from the owning AC's ability. */
  setpointRange: [number, number]
  onPower: (state: 'on' | 'off') => void
  onPercent: (value: number) => void
  onSetpoint: (value: number) => void
}

/**
 * One zone card. Hierarchy: the power button (a status rail read together with
 * the name) and the setpoint stepper lead; current temperature and damper
 * state sit in a quiet meta line. The name area is a second, larger tap
 * target for the same toggle.
 */
export function ZoneRow({ zone, setpointRange, onPower, onPercent, onSetpoint }: Props) {
  const on = zone.power !== 'off'
  const tempControlled = zone.controlMethod === 'temp' && zone.hasSensor
  const toggle = () => onPower(on ? 'off' : 'on')
  const damperText = on ? `${zone.openPercent}% open` : 'closed'

  return (
    <div className={`zone-row${on ? '' : ' is-off'}`}>
      <button
        className={`zr-power${on ? ' on' : ''}`}
        onClick={toggle}
        aria-label={`Turn ${zone.name} ${on ? 'off' : 'on'}`}
        role="switch"
        aria-checked={on}
      >
        <PowerIcon size={16} />
      </button>

      <div className="zr-info" onClick={toggle}>
        <span className="zr-name-row">
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
        </span>
        <span className="zr-meta">
          {zone.currentTemp != null ? (
            <>
              {zone.tempStale && (
                <span
                  className="stale"
                  title="Reading hasn't changed in over 3 hours — the sensor may have stopped reporting"
                >
                  <ClockIcon size={11} />
                </span>
              )}
              <b className="zr-now">{zone.currentTemp.toFixed(1)}°</b>
              <span>· {damperText}</span>
            </>
          ) : (
            <span>{zone.hasSensor ? damperText : `${damperText} · no sensor`}</span>
          )}
        </span>
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
            <span className="sp-value">{zone.openPercent}%</span>
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
    </div>
  )
}
