// Minimal inline SVG icon set (24x24 viewBox, stroke-based, inherits currentColor).

interface IconProps {
  size?: number
  className?: string
}

function base(size?: number) {
  return {
    width: size ?? 20,
    height: size ?? 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

export function PowerIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3v8" />
      <path d="M6.3 6.5a8 8 0 1 0 11.4 0" />
    </svg>
  )
}

export function SnowflakeIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 2v20M4 6l16 12M20 6L4 18" />
      <path d="M12 2l-2 3h4l-2-3zM12 22l-2-3h4l-2 3z" strokeWidth={1.5} />
    </svg>
  )
}

export function FlameIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 21c4 0 6.5-2.6 6.5-6.2 0-3.9-3-6.5-4.6-9.3-.4-.6-1.2-.6-1.5.1-.7 1.6-1.3 3.8-3 5.2-.5-.8-.7-1.6-.8-2.5-.1-.8-1-1.1-1.5-.5-1.2 1.6-2.6 4-2.6 7C4.5 18.4 8 21 12 21z" />
    </svg>
  )
}

export function FanIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10c0-3 1-6 3.5-6S19 6.5 19 8c0 2-2.5 3-5 3M14 12c3 0 6 1 6 3.5S17.5 19 16 19c-2 0-3-2.5-3-5M12 14c0 3-1 6-3.5 6S5 17.5 5 16c0-2 2.5-3 5-3M10 12c-3 0-6-1-6-3.5S6.5 5 8 5c2 0 3 2.5 3 5" />
    </svg>
  )
}

export function DropletIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11z" />
    </svg>
  )
}

export function AutoIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 19L12 4l7 15" />
      <path d="M8.2 13.5h7.6" />
    </svg>
  )
}

export function PlusIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function MinusIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function BatteryLowIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="8" width="16" height="8" rx="2" />
      <path d="M22 11v2M5 11v2" />
    </svg>
  )
}

export function WindIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 8h9a3 3 0 1 0-3-3M3 12h14a3 3 0 1 1-3 3M3 16h7a2.5 2.5 0 1 1-2.5 2.5" />
    </svg>
  )
}

export function BoltIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  )
}

export function WifiOffIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 2l20 20" />
      <path d="M5 10a12 12 0 0 1 4.2-2.6M12 6c3.9 0 7.4 1.5 10 4M8.5 13.5a7.5 7.5 0 0 1 2-1.2M12 10c2.6 0 5 1 6.8 2.8M12 18.5h.01" />
    </svg>
  )
}

export function SearchIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </svg>
  )
}

export function SettingsIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h9M19 7h1M4 12h2M12 12h8M4 17h11M21 17h-1" />
      <circle cx="16" cy="7" r="3" />
      <circle cx="9" cy="12" r="3" />
      <circle cx="18" cy="17" r="3" />
    </svg>
  )
}

export function ThermometerIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 4a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0V4z" />
      <path d="M12 9v6" />
    </svg>
  )
}

export function AlertIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3L2 20h20L12 3z" />
      <path d="M12 10v4M12 17.5h.01" />
    </svg>
  )
}

export function SunIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  )
}

export function ClockIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

export function CloseIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function ChartIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 19h16" />
      <path d="M5 15l4-5 4 3 6-8" />
    </svg>
  )
}

export function AwayIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 9.5V20h6" />
      <path d="M14 17h7M18 14l3 3-3 3" />
    </svg>
  )
}

export function MoonIcon({ size, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
    </svg>
  )
}
