import { ringArcs, type CompletenessSummary } from './completeness'

const R = 44
const SIZE = 120
const COLORS = ['var(--ok)', 'var(--warn)', 'var(--bad)'] as const

export interface CompletenessLabels {
  complete: string
  few: string
  many: string
  center: string
  empty: string
}

/** Ring with the share of complete apartments in the middle and a legend with coloured dots next to it. */
export function CompletenessRing({
  summary, labels, fmt,
}: { summary: CompletenessSummary; labels: CompletenessLabels; fmt: (s: string) => string }) {
  if (summary.total === 0) return <p className="text-muted text-sm mb-4">{labels.empty}</p>

  const circ = 2 * Math.PI * R
  const values = [summary.complete, summary.few, summary.many]
  const arcs = ringArcs(values, R)
  const rows = [
    { label: labels.complete, count: summary.complete, color: COLORS[0] },
    { label: labels.few, count: summary.few, color: COLORS[1] },
    { label: labels.many, count: summary.many, color: COLORS[2] },
  ]

  return (
    <div className="well rounded-2xl p-3 mb-4 flex items-center gap-4" data-testid="dash-completeness">
      <div className="relative w-28 h-28 flex-none">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full -rotate-90" aria-hidden="true">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--line)" strokeWidth="10" />
          {arcs.map((a) => (
            <circle
              key={a.index}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={COLORS[a.index]}
              strokeWidth="10"
              strokeDasharray={`${a.length} ${circ - a.length}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <b className="text-xl font-semibold text-ink leading-none">{fmt(String(summary.pct))}%</b>
          <span className="text-[10px] text-muted mt-1">{labels.center}</span>
        </div>
      </div>
      <ul className="flex-1 min-w-0 space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: r.color }} />
            <span className="text-ink truncate">{r.label}</span>
            <b className="ms-auto text-ink font-semibold">{fmt(String(r.count))}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}
