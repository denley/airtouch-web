import type { CSSProperties } from 'react'
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

export const MODE_META: Record<
  AcMode,
  { label: string; color: string; color2: string; icon: (size?: number) => JSX.Element }
> = {
  cool: { label: 'Cool', color: 'var(--cool)', color2: 'var(--cool-2)', icon: (s) => <SnowflakeIcon size={s} /> },
  heat: { label: 'Heat', color: 'var(--heat)', color2: 'var(--heat-2)', icon: (s) => <FlameIcon size={s} /> },
  fan: { label: 'Fan', color: 'var(--fan)', color2: 'var(--fan-2)', icon: (s) => <FanIcon size={s} /> },
  dry: { label: 'Dry', color: 'var(--dry)', color2: 'var(--dry-2)', icon: (s) => <DropletIcon size={s} /> },
  auto: { label: 'Auto', color: 'var(--auto)', color2: 'var(--auto-2)', icon: (s) => <AutoIcon size={s} /> },
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
// off still reads as "heat", it just looks dormant. Everything accent-tinted
// (dial arc, power glow, chips, zone setpoints) hangs off these two vars.
export function acAccentStyle(ac: AcState): CSSProperties {
  const meta = MODE_META[ac.mode] ?? MODE_META.cool
  return { '--accent': meta.color, '--accent-2': meta.color2 } as CSSProperties
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

// 270° dial starting at the lower-left (135° in SVG coordinates, y-down).
const DIAL_START = 135
const DIAL_SWEEP = 270
const DIAL_R = 110
const DIAL_C = 130

function polar(deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [DIAL_C + DIAL_R * Math.cos(rad), DIAL_C + DIAL_R * Math.sin(rad)]
}

function arcPath(fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(fromDeg)
  const [x2, y2] = polar(toDeg)
  const large = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${DIAL_R} ${DIAL_R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export function AcCard({ ac, showName, setpointEditable, onPower, onMode, onFan, onSetpoint, onQuickTimer, onCancelTimer }: Props) {
  const on = isAcOn(ac)
  const isAway = ac.power === 'awayOn' || ac.power === 'awayOff'

  let status = on ? MODE_VERBS[ac.mode] ?? 'On' : 'Off'
  if (on) status += ` · Fan ${(FAN_LABELS[ac.fanSpeed] ?? ac.fanSpeed).toLowerCase()}`
  if (ac.power === 'sleep') status += ' · Sleep'
  if (isAway) status += ' · Away'

  const modes = ac.ability?.modes?.length ? MODE_ORDER.filter((m) => ac.ability!.modes.includes(m)) : MODE_ORDER
  const fans = ac.ability?.fanSpeeds?.length
    ? FAN_ORDER.filter((f) => ac.ability!.fanSpeeds.includes(f))
    : (['auto', 'low', 'medium', 'high'] as FanSpeed[])

  const [minSp, maxSp] = setpointRange(ac)
  const setpoint = ac.setpoint
  const showSetpoint = ac.mode !== 'fan' && setpoint != null

  const frac = showSetpoint ? Math.min(1, Math.max(0, (setpoint! - minSp) / Math.max(1, maxSp - minSp))) : 0
  const progressEnd = DIAL_START + DIAL_SWEEP * frac
  const [handleX, handleY] = polar(progressEnd)
  const gradId = `halo-${ac.id}`

  return (
    <section className={`ac-hero${on ? '' : ' is-off'}`} style={acAccentStyle(ac)}>
      {showName && <div className="ac-title">{ac.name || `AC ${ac.id + 1}`}</div>}

      <div className="dial-block">
        <div className="dial-wrap">
          <svg viewBox="0 0 260 260" role="img" aria-label="Temperature dial">
            <defs>
              <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
                <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
              </linearGradient>
            </defs>
            <path className="dial-track" d={arcPath(DIAL_START, DIAL_START + DIAL_SWEEP)} />
            {on && showSetpoint && (
              <>
                <path className="dial-progress" d={arcPath(DIAL_START, progressEnd)} stroke={`url(#${gradId})`} />
                <circle cx={handleX} cy={handleY} r={13} fill="var(--accent-2)" opacity={0.25} />
                <circle cx={handleX} cy={handleY} r={8} fill="#ffffff" />
              </>
            )}
            {showSetpoint && (
              <>
                <text className="dial-range-label" x={16} y={242} textAnchor="middle">
                  {minSp}°
                </text>
                <text className="dial-range-label" x={244} y={242} textAnchor="middle">
                  {maxSp}°
                </text>
              </>
            )}
          </svg>

          <div
            className="dial-center"
            title={
              showSetpoint && !setpointEditable
                ? 'Zones with temperature sensors set the target automatically'
                : undefined
            }
          >
            {showSetpoint ? (
              <>
                <span className="dial-caption">{setpointEditable ? 'Set to' : 'Target · from zones'}</span>
                <span className="dial-value">{formatSetpoint(setpoint!)}°</span>
                <span className="dial-inside">
                  Inside {ac.currentTemp != null ? ac.currentTemp.toFixed(1) : '--'}°
                </span>
              </>
            ) : (
              <>
                <span className="dial-caption">Inside</span>
                <span className="dial-value">
                  {ac.currentTemp != null ? ac.currentTemp.toFixed(1) : '--'}°
                </span>
              </>
            )}
            <span className="dial-status">{status}</span>
          </div>
        </div>

        <div className="power-row">
          {showSetpoint && setpointEditable && (
            <StepButton
              className="step-btn"
              disabled={!on || setpoint! <= minSp}
              onStep={() => onSetpoint(Math.max(minSp, setpoint! - 0.5))}
              aria-label="Lower setpoint"
            >
              <MinusIcon size={18} />
            </StepButton>
          )}
          <button
            className={`power-btn${on ? ' on' : ''}`}
            onClick={() => onPower(on ? 'off' : 'on')}
            aria-label={on ? 'Turn AC off' : 'Turn AC on'}
          >
            <PowerIcon size={26} />
          </button>
          {showSetpoint && setpointEditable && (
            <StepButton
              className="step-btn"
              disabled={!on || setpoint! >= maxSp}
              onStep={() => onSetpoint(Math.min(maxSp, setpoint! + 0.5))}
              aria-label="Raise setpoint"
            >
              <PlusIcon size={18} />
            </StepButton>
          )}
        </div>
      </div>

      {(ac.turbo || ac.spill || ac.bypass) && (
        <div className="ac-badges">
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

      <div className="mode-row" role="tablist" aria-label="AC mode">
        {modes.map((mode) => {
          const meta = MODE_META[mode]
          const active = ac.mode === mode
          return (
            <button
              key={mode}
              className={`mode-btn${active ? ' active' : ''}`}
              onClick={() => onMode(mode)}
              role="tab"
              aria-selected={active}
            >
              <i>{meta.icon(20)}</i>
              {meta.label}
            </button>
          )
        })}
      </div>

      <div className="fan-row">
        <span className="fan-label">
          <FanIcon size={13} /> Fan
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
