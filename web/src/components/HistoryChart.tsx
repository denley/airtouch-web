import { useEffect, useMemo, useRef, useState } from 'react'
import type { ZoneState } from '../types'

interface Sample {
  t: number
  zones: Record<string, number>
  acs: Record<string, number>
}

interface Props {
  zones: ZoneState[]
}

const RANGES = [
  { label: '3h', hours: 3 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
]

// Categorical series slots (validated palette, defined in styles.css for both
// themes). Assigned by zone id — fixed per zone, never re-assigned on filter.
export const seriesVar = (zoneId: number) => `var(--s${(zoneId % 8) + 1})`

const GAP_MS = 3 * 60_000 // break the line across sampling gaps
const HEIGHT = 240
const PAD = { top: 12, right: 8, bottom: 24, left: 34 }

export function HistoryChart({ zones }: Props) {
  const [hours, setHours] = useState(24)
  const [samples, setSamples] = useState<Sample[] | null>(null)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [hover, setHover] = useState<number | null>(null) // sample index
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`/api/history?hours=${hours}`)
        .then((r) => r.json())
        .then((d) => alive && setSamples(d.samples))
        .catch(() => {})
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [hours])

  const sensorZones = zones.filter((z) => z.hasSensor)
  const visibleZones = sensorZones.filter((z) => !hidden.has(z.id))

  const model = useMemo(() => {
    if (!samples || samples.length < 2) return null
    const now = Date.now()
    const t0 = now - hours * 3600_000
    const innerW = width - PAD.left - PAD.right
    const innerH = HEIGHT - PAD.top - PAD.bottom

    let min = Infinity
    let max = -Infinity
    for (const s of samples) {
      for (const z of visibleZones) {
        const v = s.zones[z.id]
        if (v != null) {
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    }
    if (!isFinite(min)) return null
    min = Math.floor(min - 0.3)
    max = Math.ceil(max + 0.3)
    while (max - min < 4) {
      min -= 1
      max += 1
    }

    const x = (t: number) => PAD.left + ((t - t0) / (now - t0)) * innerW
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH

    const lines = visibleZones.map((zone) => {
      let d = ''
      let prevT = 0
      for (const s of samples) {
        const v = s.zones[zone.id]
        if (v == null) continue
        const cmd = !d || s.t - prevT > Math.max(GAP_MS, (hours * 3600_000) / 500) ? 'M' : 'L'
        d += `${cmd}${x(s.t).toFixed(1)},${y(v).toFixed(1)}`
        prevT = s.t
      }
      const last = [...samples].reverse().find((s) => s.zones[zone.id] != null)
      return {
        zone,
        d,
        lastY: last ? y(last.zones[zone.id]) : null,
        labelY: null as number | null,
      }
    })

    // Spread end-of-line labels so they never overlap: sort by position, then
    // push each label down to keep a minimum gap, clamped to the plot area.
    const LABEL_GAP = 13
    const labeled = lines
      .filter((l) => l.lastY != null)
      .sort((a, b) => (a.lastY as number) - (b.lastY as number))
    let prevLabelY = -Infinity
    for (const line of labeled) {
      line.labelY = Math.max(line.lastY as number, prevLabelY + LABEL_GAP)
      prevLabelY = line.labelY
    }
    const overshoot = prevLabelY - (HEIGHT - PAD.bottom - 4)
    if (overshoot > 0) {
      for (const line of labeled) line.labelY = Math.max(PAD.top + 8, (line.labelY as number) - overshoot)
    }

    // Y gridlines at whole degrees, at most ~6 lines.
    const step = Math.max(1, Math.ceil((max - min) / 6))
    const gridY = []
    for (let v = min; v <= max; v += step) gridY.push({ v, y: y(v) })

    // X ticks: pick a friendly hour step.
    const hourStep = hours <= 3 ? 1 : hours <= 12 ? 2 : hours <= 24 ? 4 : 8
    const ticksX = []
    const d0 = new Date(t0)
    d0.setMinutes(0, 0, 0)
    for (let t = d0.getTime(); t <= now; t += 3600_000) {
      const h = new Date(t).getHours()
      if (t >= t0 && h % hourStep === 0) {
        ticksX.push({ t, x: x(t), label: formatHour(t) })
      }
    }

    return { x, y, lines, gridY, ticksX, t0, now, min, max }
  }, [samples, visibleZones.map((z) => z.id).join(','), width, hours])

  if (sensorZones.length === 0) return null

  const hoverSample = hover != null && samples ? samples[hover] : null

  function onMove(clientX: number) {
    if (!samples || !model || !wrapRef.current) return
    const rect = wrapRef.current.getBoundingClientRect()
    const px = clientX - rect.left
    // nearest sample by x
    let best = 0
    let bestDist = Infinity
    samples.forEach((s, i) => {
      const dist = Math.abs(model.x(s.t) - px)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    setHover(best)
  }

  return (
    <section className="history-card">
      <div className="history-head">
        <div className="chip-row" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              className={`chip${hours === r.hours ? ' active' : ''}`}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef}>
      {!model ? (
        <div className="history-empty">
          Collecting temperature history — check back in a few minutes.
        </div>
      ) : (
        <div
          className="history-plot"
          onMouseMove={(e) => onMove(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchMove={(e) => onMove(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          <svg width={width} height={HEIGHT} role="img" aria-label="Zone temperature history">
            {model.gridY.map((g) => (
              <g key={g.v}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={g.y}
                  y2={g.y}
                  className="grid-line"
                />
                <text x={PAD.left - 6} y={g.y + 3.5} className="axis-label" textAnchor="end">
                  {g.v}°
                </text>
              </g>
            ))}
            {model.ticksX.map((tick) => (
              <text
                key={tick.t}
                x={tick.x}
                y={HEIGHT - 6}
                className="axis-label"
                textAnchor="middle"
              >
                {tick.label}
              </text>
            ))}
            {model.lines.map(({ zone, d }) => (
              <path
                key={zone.id}
                d={d}
                fill="none"
                stroke={seriesVar(zone.id)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {/* Direct labels at line ends when few series fit; the legend
                carries identity on narrow screens */}
            {visibleZones.length <= 4 &&
              width > 520 &&
              model.lines.map(({ zone, labelY }) =>
                labelY != null ? (
                  <text
                    key={`label-${zone.id}`}
                    x={width - PAD.right - 2}
                    y={labelY}
                    className="series-label"
                    textAnchor="end"
                  >
                    {zone.name}
                  </text>
                ) : null,
              )}
            {hoverSample && (
              <g>
                <line
                  x1={model.x(hoverSample.t)}
                  x2={model.x(hoverSample.t)}
                  y1={PAD.top}
                  y2={HEIGHT - PAD.bottom}
                  className="crosshair"
                />
                {visibleZones.map((zone) => {
                  const v = hoverSample.zones[zone.id]
                  return v != null ? (
                    <circle
                      key={zone.id}
                      cx={model.x(hoverSample.t)}
                      cy={model.y(v)}
                      r={4}
                      fill={seriesVar(zone.id)}
                      className="hover-dot"
                    />
                  ) : null
                })}
              </g>
            )}
          </svg>

          {hoverSample && model && (
            <div
              className="chart-tooltip"
              style={{
                left: Math.min(Math.max(model.x(hoverSample.t), 90), width - 90),
              }}
            >
              <div className="tt-time">{formatTooltipTime(hoverSample.t)}</div>
              {visibleZones
                .filter((z) => hoverSample.zones[z.id] != null)
                .sort((a, b) => hoverSample.zones[b.id] - hoverSample.zones[a.id])
                .map((zone) => (
                  <div key={zone.id} className="tt-row">
                    <i style={{ background: seriesVar(zone.id) }} />
                    <span className="tt-name">{zone.name}</span>
                    <span className="tt-val">{hoverSample.zones[zone.id].toFixed(1)}°</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
      </div>

      <div className="legend-row">
        {sensorZones.map((zone) => (
          <button
            key={zone.id}
            className={`legend-chip${hidden.has(zone.id) ? ' off' : ''}`}
            onClick={() =>
              setHidden((prev) => {
                const next = new Set(prev)
                if (next.has(zone.id)) next.delete(zone.id)
                else next.add(zone.id)
                return next
              })
            }
            aria-pressed={!hidden.has(zone.id)}
          >
            <i style={{ background: seriesVar(zone.id) }} />
            {zone.name}
          </button>
        ))}
      </div>
    </section>
  )
}

function formatHour(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric' })
}

function formatTooltipTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
