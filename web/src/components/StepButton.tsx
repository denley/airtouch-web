import { type ReactNode, useEffect, useRef } from 'react'

interface Props {
  onStep: () => void
  disabled?: boolean
  className?: string
  'aria-label': string
  children: ReactNode
}

const HOLD_DELAY = 450
const HOLD_INTERVAL = 180

/**
 * Stepper button with press-and-hold repeat. Pointer events drive mouse/touch
 * (fire once, then repeat while held); keyboard activation still works via
 * click events with detail === 0.
 */
export function StepButton({ onStep, disabled, className, children, ...rest }: Props) {
  const stepRef = useRef(onStep)
  stepRef.current = onStep
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({})

  const stop = () => {
    clearTimeout(timers.current.delay)
    clearInterval(timers.current.repeat)
    timers.current = {}
  }

  useEffect(() => stop, [])

  return (
    <button
      className={className}
      disabled={disabled}
      aria-label={rest['aria-label']}
      onPointerDown={(e) => {
        if (disabled) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        stepRef.current()
        timers.current.delay = setTimeout(() => {
          timers.current.repeat = setInterval(() => stepRef.current(), HOLD_INTERVAL)
        }, HOLD_DELAY)
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onClick={(e) => {
        // Keyboard activation only (pointer path already fired on pointerdown).
        if (e.detail === 0 && !disabled) stepRef.current()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}
