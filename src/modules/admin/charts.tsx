import { useState, type ReactNode } from 'react'

export interface BarSegment {
  key: string
  value: number
  /** CSS color, e.g. var(--accent) */
  color: string
  label: string
}

export interface BarColumn {
  key: string
  /** short axis label */
  label: string
  /** readout text shown when the column is selected */
  readout: ReactNode
  segments: BarSegment[]
  ariaLabel: string
}

interface ColumnChartProps {
  columns: BarColumn[]
  /** shown in the readout area while nothing is selected */
  hint: string
  groupLabel: string
  /** shown instead of an empty plot when every column is zero */
  emptyLabel: string
}

/**
 * Stacked column chart built from plain elements (no chart library).
 * The time axis stays left-to-right in every language. Hover (mouse), focus or tap selects a column.
 */
export function ColumnChart({ columns, hint, groupLabel, emptyLabel }: ColumnChartProps) {
  const [active, setActive] = useState<string | null>(null)
  const totals = columns.map((c) => c.segments.reduce((s, x) => s + Math.max(x.value, 0), 0))
  const max = Math.max(0, ...totals)
  const activeColumn = columns.find((c) => c.key === active) ?? null
  const mid = columns[Math.floor((columns.length - 1) / 2)]

  if (max <= 0) return <p className="text-sm text-muted">{emptyLabel}</p>

  return (
    <div>
      {/* readout follows the page direction; only the plot and its time axis stay left-to-right */}
      <div className="min-h-[2.5rem] text-xs text-ink mb-1" aria-live="polite">
        {activeColumn ? activeColumn.readout : <span className="text-muted">{hint}</span>}
      </div>
      <div dir="ltr">
        <div
          className="flex items-end gap-px h-36 border-b border-line"
          role="group"
          aria-label={groupLabel}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null) }}
        >
          {columns.map((col, i) => {
            const total = totals[i]
            const height = max > 0 ? (total / max) * 100 : 0
            const dimmed = active != null && active !== col.key
            return (
              <button
                key={col.key}
                type="button"
                aria-label={col.ariaLabel}
                aria-pressed={active === col.key}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setActive(col.key) }}
                onFocus={() => setActive(col.key)}
                onClick={() => setActive(col.key)}
                className="flex-1 min-w-0 h-full flex items-end focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                style={{ opacity: dimmed ? 0.45 : 1 }}
              >
                <span
                  className="flex flex-col-reverse w-full overflow-hidden rounded-t-sm"
                  style={{ height: `${height}%`, minHeight: total > 0 ? 2 : 0 }}
                >
                  {col.segments.map((s) => (
                    s.value > 0
                      ? <span key={s.key} style={{ height: `${(s.value / total) * 100}%`, background: s.color }} />
                      : null
                  ))}
                </span>
              </button>
            )
          })}
        </div>
        {columns.length > 0 && (
          <div className="flex justify-between text-[11px] text-muted mt-1">
            <span>{columns[0].label}</span>
            {columns.length > 2 && <span>{mid.label}</span>}
            {columns.length > 1 && <span>{columns[columns.length - 1].label}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

export interface HBarRow {
  key: string
  label: string
  /** numeric value that drives the bar length (negative values draw no bar) */
  value: number
  display: string
  partial?: boolean
  onClick?: () => void
}

/** Horizontal bars; rows with onClick are buttons. */
export function HBarList({ rows, partialMark }: { rows: HBarRow[]; partialMark: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const width = max > 0 ? (Math.max(r.value, 0) / max) * 100 : 0
        const body = (
          <>
            <span className="w-24 sm:w-28 shrink-0 truncate text-sm text-ink text-start">{r.label}</span>
            <span className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
              <span className="block h-full rounded-full" style={{ width: `${width}%`, background: 'var(--accent)' }} />
            </span>
            <span className="shrink-0 text-xs text-muted tabular-nums text-end min-w-[4.5rem]">
              {r.display}{r.partial ? ` ${partialMark}` : ''}
            </span>
          </>
        )
        return (
          <li key={r.key}>
            {r.onClick ? (
              <button
                type="button"
                onClick={r.onClick}
                className="w-full flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-app"
              >
                {body}
              </button>
            ) : (
              <div className="w-full flex items-center gap-2 px-1 py-0.5">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
