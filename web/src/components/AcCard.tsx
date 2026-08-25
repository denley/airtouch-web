import type { AcMode, AcState, FanSpeed } from '../types'
import {
  AutoIcon,
  AwayIcon,
  BoltIcon,
  DropletIcon,
  FanIcon,
  FlameIcon,
  MinusIcon,
  MoonIcon,
  PlusIcon,
  PowerIcon,
  SnowflakeIcon,
  WindIcon,
} from './icons'
import { StepButton } from './StepButton'
import { TimerControls } from './TimerControls'

export const MODE_META: Record<AcMode, { label: string; color: string; icon: (size?: number) => JSX.Element }> = {
  cool: { label: 'Cool', color: 'var(--cool)', icon: (s) => <SnowflakeIcon size={s} /> },
  heat: { label: 'Heat', color: 'var(--heat)', icon: (s) => <FlameIcon size={s} /> },
  fan: { label: 'Fan', color: 'var(--fan)', icon: (s) => <FanIcon size={s} /> },
  dry: { label: 'Dry', color: 'var(--dry)', icon: (s) => <DropletIcon size={s} /> },
  auto: { label: 'Auto', color: 'var(--auto)', icon: (s) => <AutoIcon size={s} /> },
}

const MODE_ORDER: AcMode[] = ['cool', 'heat', 'fan', 'dry', 'auto']

const FAN_LABELS: Record<FanSpeed, string> = {
  auto: 'Auto',
  quiet: 'Quiet',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  powerful: 'Powerful',
  turbo: 'Turbo',
  intelligent: 'Smart',
}

const FAN_ORDER: FanSpeed[] = ['auto', 'intelligent', 'quiet', 'low', 'medium', 'high', 'powerful', 'turbo']

// The accent follows the current mode even while off — a heat system that's
// off still reads as "heat", it just looks dormant.
export function acAccentColor(ac: AcState): string {
  return MODE_META[ac.mode]?.color ?? 'var(--cool)'
}

export function isAcOn(ac: AcState): boolean {
  return ac.power === 'on' || ac.power === 'awayOn' || ac.power === 'sleep'
}

interface Props {
  ac: AcState
  showName: boolean
  /**
   * Whether the AC's own setpoint is directly adjustable. When zones with
   * temperature sensors are running, the console derives the AC setpoint from
   * the zone setpoints itself (same rule as the official app) — we only allow
   * editing when an open zone has no sensor and depends on the AC target.
   */
  setpointEditable: boolean
  onPower: (state: 'on' | 'off' | 'away' | 'sleep') => void
  onMode: (mode: AcMode) => void
  onFan: (speed: FanSpeed) => void
  onSetpoint: (value: number) => void
  onQuickTimer: (type: 'on' | 'off', minutes: number) => void
  onCancelTimer: (type: 'on' | 'off') => void
}

const MODE_VERBS: Record<AcMode, string> = {
  cool: 'Cooling',
  heat: 'Heating',
  dry: 'Drying',
  fan: 'Fan only',
  auto: 'Auto',
}

export function AcCard({ ac, showName, setpointEditable, onPower, onMode, onFan, onSetpoint, onQuickTimer, onCancelTimer }: Props) {
  const on = isAcOn(ac)
  const isAway = ac.power === 'awayOn' || ac.power === 'awayOff'
  const accent = acAccentColor(ac)

  let status = on ? MODE_VERBS[ac.mode] ?? 'On' : 'Off'
  if (ac.power === 'sleep') status += ' · Sleep'
  if (isAway) status += ' · Away'
  const modes = ac.ability?.modes?.length ? MODE_ORDER.filter((m) => ac.ability!.modes.includes(m)) : MODE_ORDER
  const fans = ac.ability?.fanSpeeds?.length
    ? FAN_ORDER.filter((f) => ac.ability!.fanSpeeds.includes(f))
    : (['auto', 'low', 'medium', 'high'] as FanSpeed[])

  // Setpoint limits depend on mode; fall back to a sensible range.
  const [minSp, maxSp] = setpointRange(ac)
  const setpoint = ac.setpoint
  const showSetpoint = ac.mode !== 'fan'

  return (
    <section className={`ac-card${on ? '' : ' is-off'}`} style={{ ['--accent' as string]: accent }}>
      <div className="ac-top">
        <div>
          <div className="ac-title">{showName ? ac.name || `AC ${ac.id + 1}` : 'Air Conditioner'}</div>
          <div className={`ac-status${on ? ' on' : ''}`}>{status}</div>
          {(ac.turbo || ac.spill || ac.bypass) && (
            <div className="ac-badges" style={{ marginTop: 8 }}>
              {ac.turbo && (
                <span className="badge accent">
                  <BoltIcon size={12} /> Turbo
                </span>
              )}
              {ac.spill && (
                <span className="badge warn" title="Excess air is being vented through a spill zone">
                  <WindIcon size={12} /> Spill
                </span>
              )}
              {ac.bypass && (
                <span className="badge" title="The bypass damper is relieving excess air pressure">
                  Bypass
                </span>
              )}
            </div>
          )}
        </div>
        <button
          className={`power-btn${on ? ' on' : ''}`}
          onClick={() => onPower(on ? 'off' : 'on')}
          aria-label={on ? 'Turn AC off' : 'Turn AC on'}
        >
          <PowerIcon size={26} />
        </button>
      </div>

      <div className="ac-main">
        <div className="ac-current">
          <span className="label">Inside</span>
          <span className="value">
            {ac.currentTemp != null ? ac.currentTemp.toFixed(1) : '--'}
            <span className="unit">°C</span>
          </span>
        </div>

        {showSetpoint &&
          (setpointEditable ? (
            <div className="setpoint-ctl">
              <StepButton
                className="step-btn"
                disabled={!on || setpoint == null || setpoint <= minSp}
                onStep={() => setpoint != null && onSetpoint(Math.max(minSp, setpoint - 0.5))}
                aria-label="Lower setpoint"
              >
                <MinusIcon />
              </StepButton>
              <div className="sp-value">
                {setpoint != null ? formatSetpoint(setpoint) : '--'}
                <small> °C</small>
                <span className="sp-caption">Set to</span>
              </div>
              <StepButton
                className="step-btn"
                disabled={!on || setpoint == null || setpoint >= maxSp}
                onStep={() => setpoint != null && onSetpoint(Math.min(maxSp, setpoint + 0.5))}
                aria-label="Raise setpoint"
              >
                <PlusIcon />
              </StepButton>
            </div>
          ) : (
            <div
              className="target-display"
              title="Zones with temperature sensors set the target automatically"
            >
              <span className="value">
                {setpoint != null ? formatSetpoint(setpoint) : '--'}
                <small> °C</small>
              </span>
              <span className="sp-caption">Target · from zones</span>
            </div>
          ))}
      </div>

      <div className="ac-controls">
        <div className="seg" role="tablist" aria-label="AC mode">
          {modes.map((mode) => {
            const meta = MODE_META[mode]
            const active = ac.mode === mode
            return (
              <button
                key={mode}
                className={`seg-btn${active ? ' active' : ''}`}
                style={active ? { ['--seg-color' as string]: meta.color } : undefined}
                onClick={() => onMode(mode)}
                role="tab"
                aria-selected={active}
              >
                {meta.icon(18)}
                <span>{meta.label}</span>
              </button>
            )
          })}
        </div>

        <div className="fan-row">
          <span className="fan-label">
            <FanIcon size={14} /> Fan
          </span>
          <div className="chip-row">
            {fans.map((speed) => (
              <button
                key={speed}
                className={`chip${ac.fanSpeed === speed ? ' active' : ''}`}
                onClick={() => onFan(speed)}
              >
                {FAN_LABELS[speed]}
              </button>
            ))}
          </div>
        </div>

        <TimerControls
          ac={ac}
          onQuickTimer={onQuickTimer}
          onCancelTimer={onCancelTimer}
          presetChips={
            <>
              <button
                className={`chip${ac.power === 'sleep' ? ' active' : ''}`}
                onClick={() => onPower(ac.power === 'sleep' ? 'on' : 'sleep')}
                title="Quieter overnight operation"
              >
                <MoonIcon size={13} /> Sleep
              </button>
              <button
                className={`chip${isAway ? ' active' : ''}`}
                onClick={() => onPower(isAway ? 'on' : 'away')}
                title="Energy-saving mode while you're out"
              >
                <AwayIcon size={13} /> Away
              </button>
            </>
          }
        />
      </div>
    </section>
  )
}

function setpointRange(ac: AcState): [number, number] {
  const a = ac.ability
  if (!a) return [16, 31]
  if (ac.mode === 'heat') return [a.minHeat || 16, a.maxHeat || 31]
  if (ac.mode === 'cool' || ac.mode === 'dry') return [a.minCool || 16, a.maxCool || 31]
  // auto: allow the union of both ranges
  return [Math.min(a.minCool || 16, a.minHeat || 16), Math.max(a.maxCool || 31, a.maxHeat || 31)]
}

export function formatSetpoint(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
