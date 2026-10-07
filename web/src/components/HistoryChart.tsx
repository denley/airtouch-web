import { useEffect, useMemo, useRef, useState } from 'react'
import type { ZoneState } from '../types'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

/**
 * GET /api/history: the server buckets readings to at most ~1000 points
 * whatever the range, so the payload and drawing cost stay flat as history
 * grows. `t` holds bucket starts; each zone has parallel avg/lo/hi arrays.
 */
interface HistoryData {
  from: number
  to: number
  step: number
  earliest: number | null
  t: number[]
  zones: Record<string, { avg: (number | null)[]; lo: (number | null)[]; hi: (number | null)[] }>
}

interface Props {
  zones: ZoneState[]
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const RANGES: { label: string; ms: number | null }[] = [
  { label: '3h', ms: 3 * HOUR },
  { label: '24h', ms: DAY },
  { label: '7d', ms: 7 * DAY },
  { label: '30d', ms: 30 * DAY },
  { label: '1y', ms: 365 * DAY },
  { label: 'All', ms: null },
]

// Categorical series slots (validated palette, defined in styles.css for both
// themes). Assigned by zone id — fixed per zone, never re-assigned on filter.
export const seriesVar = (zoneId: number) => `var(--s${(zoneId % 8) + 1})`

const HEIGHT = 240
const PAD = { top: 12, right: 8, bottom: 24, left: 34 }

// A live window refreshes about once per new bucket, within these bounds.
function refreshInterval(rangeMs: number | null) {
  return Math.min(Math.max((rangeMs ?? Infinity) / 1000, MINUTE), 15 * MINUTE)
}

export function HistoryChart({ zones }: Props) {
  const [range, setRange] = useState(RANGES[1])
  // End of the viewed window; null follows the present.
  const [end, setEnd] = useState<number | null>(null)
  const [data, setData] = useState<HistoryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [hover, setHover] = useState<number | null>(null) // bucket index
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
    const controller = new AbortController()
    const load = (initial: boolean) => {
      const params = new URLSearchParams({ tz: String(-new Date().getTimezoneOffset()) })
      if (range.ms != null) {
        const to = end ?? Date.now()
        params.set('from', String(to - range.ms))
        params.set('to', String(to))
      }
      // The previous chart stays up (dimmed) while a new window loads.
      if (initial) setLoading(true)
      fetch(`/api/history?${params}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: HistoryData) => {
          setData(d)
          setLoading(false)
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setLoading(false)
        })
    }
    load(true)
    const timer = end == null ? setInterval(() => load(false), refreshInterval(range.ms)) : undefined
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [range, end])

  const sensorZones = zones.filter((z) => z.hasSensor)
  const visibleZones = sensorZones.filter((z) => !hidden.has(z.id))

  const model = useMemo(() => {
    if (!data) return null
    const { from, to, step, t } = data
    const innerW = width - PAD.left - PAD.right
    const innerH = HEIGHT - PAD.top - PAD.bottom
    const series = visibleZones
      .filter((zone) => data.zones[zone.id])
      .map((zone) => ({ zone, s: data.zones[zone.id] }))
    // A single zone also gets its min–max spread per bucket.
    const band = series.length === 1 && step > MINUTE

    let min = Infinity
    let max = -Infinity
    let points = 0
    for (const { s } of series) {
      for (let i = 0; i < t.length; i++) {
        const lo = band ? s.lo[i] : s.avg[i]
        const hi = band ? s.hi[i] : s.avg[i]
        if (lo == null || hi == null) continue
        points++
        if (lo < min) min = lo
        if (hi > max) max = hi
      }
    }
    if (points < 2) return null
    min = Math.floor(min - 0.3)
    max = Math.ceil(max + 0.3)
    while (max - min < 4) {
      min -= 1
      max += 1
    }

    // Each bucket plots at its midpoint, kept inside the window.
    const mid = (i: number) => Math.min(Math.max(t[i] + step / 2, from), to)
    const x = (time: number) => PAD.left + ((time - from) / (to - from)) * innerW
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH
    const gap = Math.max(3 * MINUTE, step * 2.5) // break lines across missing data

    const lines = series.map(({ zone, s }) => {
      const runs: number[][] = []
      let prev: number | null = null
      for (let i = 0; i < t.length; i++) {
        if (s.avg[i] == null) continue
        if (prev == null || t[i] - t[prev] > gap) runs.push([])
        runs[runs.length - 1].push(i)
        prev = i
      }
      const pt = (i: number, v: number | null) => `${x(mid(i)).toFixed(1)},${y(v as number).toFixed(1)}`
      const d = runs.map((run) => run.map((i, k) => `${k ? 'L' : 'M'}${pt(i, s.avg[i])}`).join('')).join('')
      const area = band
        ? runs
            .map(
              (run) =>
                run.map((i, k) => `${k ? 'L' : 'M'}${pt(i, s.hi[i])}`).join('') +
                [...run].reverse().map((i) => `L${pt(i, s.lo[i])}`).join('') +
                'Z',
            )
            .join('')
        : null
      return {
        zone,
        d,
        area,
        lastY: prev != null ? y(s.avg[prev] as number) : null,
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
    const yStep = Math.max(1, Math.ceil((max - min) / 6))
    const gridY = []
    for (let v = min; v <= max; v += yStep) gridY.push({ v, y: y(v) })

    const ticksX = timeTicks(from, to, Math.max(2, Math.floor(innerW / 50))).map((tick) => ({
      ...tick,
      x: x(tick.t),
    }))

    // Nearest bucket to a pixel column (midpoints are sorted).
    const indexAt = (px: number) => {
      const time = from + ((px - PAD.left) / innerW) * (to - from)
      let lo = 0
      let hi = t.length - 1
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (mid(m) < time) lo = m + 1
        else hi = m
      }
      return lo > 0 && time - mid(lo - 1) < mid(lo) - time ? lo - 1 : lo
    }

    return { x, y, mid, indexAt, lines, band, gridY, ticksX }
  }, [data, visibleZones.map((z) => z.id).join(','), width])

  if (sensorZones.length === 0) return null

  const hoverIndex = hover != null && data && model && hover < data.t.length ? hover : null

  function onMove(clientX: number) {
    if (!model || !wrapRef.current) return
    setHover(model.indexAt(clientX - wrapRef.current.getBoundingClientRect().left))
  }

  function selectRange(next: (typeof RANGES)[number]) {
    setRange(next)
    if (next.ms == null) setEnd(null)
  }

  function pan(direction: -1 | 1) {
    if (range.ms == null) return
    const next = (end ?? Date.now()) + direction * range.ms
    setEnd(next >= Date.now() - MINUTE ? null : next)
  }

  const windowStart = range.ms != null ? (end ?? Date.now()) - range.ms : null
  const canGoBack = data?.earliest != null && windowStart != null && windowStart > data.earliest

  return (
    <section className="history-card">
      <div className="history-head">
        {range.ms != null && windowStart != null ? (
          <div className="history-nav">
            <button className="nav-btn" aria-label="Earlier" disabled={!canGoBack} onClick={() => pan(-1)}>
              <ChevronLeftIcon size={16} />
            </button>
            <span className="history-span">{spanLabel(windowStart, end, range.ms)}</span>
            <button className="nav-btn" aria-label="Later" disabled={end == null} onClick={() => pan(1)}>
              <ChevronRightIcon size={16} />
            </button>
            {end != null && (
              <button className="history-now" onClick={() => setEnd(null)}>
                Now
              </button>
            )}
          </div>
        ) : (
          <div className="history-nav">
            {data?.earliest != null && (
              <span className="history-span">Since {formatDate(data.earliest, true)}</span>
            )}
          </div>
        )}
        <div className="chip-row" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              className={`chip${range === r ? ' active' : ''}`}
              onClick={() => selectRange(r)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={wrapRef}>
      {!model || !data ? (
        <div className="history-empty">
          {data && data.earliest != null
            ? 'No readings in this period.'
            : 'Collecting temperature history — check back in a few minutes.'}
        </div>
      ) : (
        <div
          className={`history-plot${loading ? ' loading' : ''}`}
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
            {model.lines.map(({ zone, area }) =>
              area ? (
                <path key={`band-${zone.id}`} d={area} fill={seriesVar(zone.id)} className="series-band" />
              ) : null,
            )}
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
            {hoverIndex != null && (
              <g>
                <line
                  x1={model.x(model.mid(hoverIndex))}
                  x2={model.x(model.mid(hoverIndex))}
                  y1={PAD.top}
                  y2={HEIGHT - PAD.bottom}
                  className="crosshair"
                />
                {visibleZones.map((zone) => {
                  const v = data.zones[zone.id]?.avg[hoverIndex]
                  return v != null ? (
                    <circle
                      key={zone.id}
                      cx={model.x(model.mid(hoverIndex))}
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

          {hoverIndex != null && (
            <div
              className="chart-tooltip"
              style={{
                left: Math.min(Math.max(model.x(model.mid(hoverIndex)), 120), width - 120),
              }}
            >
              <div className="tt-time">{bucketLabel(data.t[hoverIndex], data.step)}</div>
              {visibleZones
                .map((zone) => ({ zone, s: data.zones[zone.id] }))
                .filter(({ s }) => s?.avg[hoverIndex] != null)
                .sort((a, b) => (b.s.avg[hoverIndex] as number) - (a.s.avg[hoverIndex] as number))
                .map(({ zone, s }) => (
                  <div key={zone.id} className="tt-row">
                    <i style={{ background: seriesVar(zone.id) }} />
                    <span className="tt-name">{zone.name}</span>
                    <span className="tt-val">{(s.avg[hoverIndex] as number).toFixed(1)}°</span>
                    {data.step >= HOUR && (
                      <span className="tt-range">
                        {s.lo[hoverIndex]?.toFixed(1)}–{s.hi[hoverIndex]?.toFixed(1)}
                      </span>
                    )}
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

// ---------------------------------------------------------------------------
// Time formatting & axis ticks (all in the browser's local time)
// ---------------------------------------------------------------------------

const fmt = (t: number, opts: Intl.DateTimeFormatOptions) => new Date(t).toLocaleString([], opts)
const formatTime = (t: number) => fmt(t, { hour: 'numeric', minute: '2-digit' })
const withYear = (t: number) => (new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {})
const formatDay = (t: number) => fmt(t, { weekday: 'short', day: 'numeric', month: 'short', ...withYear(t) })
const formatDate = (t: number, forceYear = false) =>
  fmt(t, { day: 'numeric', month: 'short', ...(forceYear ? { year: 'numeric' } : withYear(t)) })

/** The viewed window, e.g. "Tue 6 Oct, 9:41 am – now" or "1 Sep – 1 Oct". */
function spanLabel(from: number, end: number | null, rangeMs: number): string {
  const to = end ?? Date.now()
  if (rangeMs > DAY) return `${formatDate(from)} – ${end == null ? 'now' : formatDate(to)}`
  const toLabel =
    end == null
      ? 'now'
      : new Date(from).toDateString() === new Date(to).toDateString()
        ? formatTime(to)
        : `${formatDay(to)}, ${formatTime(to)}`
  return `${formatDay(from)}, ${formatTime(from)} – ${toLabel}`
}

/** What a bucket covers, for the tooltip. */
function bucketLabel(t: number, step: number): string {
  if (step >= DAY) {
    // Day buckets can sit an hour off midnight across DST; label by their middle.
    if (step === DAY) return formatDay(t + 12 * HOUR)
    return `${formatDate(t + 12 * HOUR)} – ${formatDate(t + step - 12 * HOUR)}`
  }
  if (step <= MINUTE) return `${formatDay(t)}, ${formatTime(t)}`
  return `${formatDay(t)}, ${formatTime(t)}–${formatTime(t + step)}`
}

type TickUnit = { unit: 'hour' | 'day' | 'week' | 'month' | 'year'; n: number }

const TICK_UNITS: TickUnit[] = [
  ...[1, 2, 3, 6, 12].map((n) => ({ unit: 'hour' as const, n })),
  { unit: 'day', n: 1 },
  { unit: 'day', n: 2 },
  { unit: 'week', n: 1 },
  ...[1, 3, 6].map((n) => ({ unit: 'month' as const, n })),
  ...[1, 2, 5, 10].map((n) => ({ unit: 'year' as const, n })),
]
const UNIT_MS = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30.44 * DAY, year: 365.25 * DAY }

/** Ticks on local-time boundaries (hours, days, Mondays, months, years). */
function timeTicks(from: number, to: number, maxTicks: number) {
  const { unit, n } =
    TICK_UNITS.find((u) => (to - from) / (UNIT_MS[u.unit] * u.n) <= maxTicks) ?? TICK_UNITS[TICK_UNITS.length - 1]
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  if (unit !== 'hour') d.setHours(0)
  if (unit === 'month' || unit === 'year') d.setDate(1)
  if (unit === 'year') d.setMonth(0)

  const onTick = () => {
    switch (unit) {
      case 'hour':
        return d.getHours() % n === 0
      case 'day':
        return n === 1 || (d.getDate() % 2 === 1 && d.getDate() !== 31)
      case 'week':
        return d.getDay() === 1
      case 'month':
        return d.getMonth() % n === 0
      case 'year':
        return d.getFullYear() % n === 0
    }
  }
  const label = () => {
    const t = d.getTime()
    switch (unit) {
      case 'hour':
        return d.getHours() === 0 ? fmt(t, { weekday: 'short' }) : fmt(t, { hour: 'numeric' })
      case 'day':
        return n === 1 ? fmt(t, { weekday: 'short', day: 'numeric' }) : fmt(t, { day: 'numeric', month: 'short' })
      case 'week':
        return fmt(t, { day: 'numeric', month: 'short' })
      case 'month':
        return d.getMonth() === 0 ? String(d.getFullYear()) : fmt(t, { month: 'short' })
      case 'year':
        return String(d.getFullYear())
    }
  }

  const ticks: { t: number; label: string }[] = []
  while (d.getTime() <= to) {
    if (d.getTime() >= from && onTick()) ticks.push({ t: d.getTime(), label: label() })
    if (unit === 'hour') d.setTime(d.getTime() + HOUR)
    else if (unit === 'day' || unit === 'week') d.setDate(d.getDate() + 1)
    else if (unit === 'month') d.setMonth(d.getMonth() + 1)
    else d.setFullYear(d.getFullYear() + 1)
  }
  return ticks
}
