import { type ReactNode, useState } from 'react'
import type { AcState, TimerState } from '../types'
import { ClockIcon, CloseIcon } from './icons'

interface Props {
  ac: AcState
  onQuickTimer: (type: 'on' | 'off', minutes: number) => void
  onCancelTimer: (type: 'on' | 'off') => void
  /** Extra chips (sleep/away presets) rendered in the same row. */
  presetChips?: ReactNode
}

const PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: '8h', minutes: 480 },
]

function formatTime(timer: TimerState): string {
  const date = new Date()
  date.setHours(timer.hour, timer.minute, 0, 0)
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function TimerControls({ ac, onQuickTimer, onCancelTimer, presetChips }: Props) {
  const [open, setOpen] = useState(false)
  const timers = ac.timers
  const onSet = timers?.on.enabled ?? false
  const offSet = timers?.off.enabled ?? false

  return (
    <>
      <div className="fan-row">
        <div className="chip-row">
          {presetChips}
          <span className="chip-divider" aria-hidden />
          {offSet && timers && (
            <button
              className="chip active"
              onClick={() => onCancelTimer('off')}
              title="Tap to cancel"
            >
              <ClockIcon size={13} /> Off {formatTime(timers.off)} <CloseIcon size={12} />
            </button>
          )}
          {onSet && timers && (
            <button className="chip active" onClick={() => onCancelTimer('on')} title="Tap to cancel">
              <ClockIcon size={13} /> On {formatTime(timers.on)} <CloseIcon size={12} />
            </button>
          )}
          <button className={`chip${open ? ' open' : ''}`} onClick={() => setOpen(!open)}>
            {open ? <CloseIcon size={12} /> : <ClockIcon size={13} />} Timer
          </button>
        </div>
      </div>

      {open && (
        <div className="timer-panel">
          {(['off', 'on'] as const).map((type) => (
            <div className="fan-row" key={type}>
              <span className="fan-label">Turn {type} in</span>
              <div className="chip-row">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.minutes}
                    className="chip"
                    onClick={() => {
                      onQuickTimer(type, preset.minutes)
                      setOpen(false)
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
