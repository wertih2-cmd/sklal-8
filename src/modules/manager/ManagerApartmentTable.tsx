import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { needsAttention, sortByAttention, MANAGER_PERIODS, type ApartmentStat, type ManagerPeriod } from './managerStats'

const PAGE_SIZE = 12

function pctClass(p: number | null): string {
  if (p == null) return 'text-muted'
  if (p >= 100) return 'text-ok'
  if (p >= 75) return 'text-warn'
  return 'text-bad'
}

function chipClass(active: boolean): string {
  return `rounded-full px-3 min-h-[36px] text-sm whitespace-nowrap transition-colors border ${
    active ? 'bg-accent border-accent text-on-accent' : 'well text-muted'
  }`
}

/** Apartments that need a look: cleanings, incidents, breakdowns and repeats of the period, open decisions, completeness. */
export function ManagerApartmentTable({
  stats, period, onPeriod, cleaningsKnown, apartmentPath,
}: {
  stats: readonly ApartmentStat[]
  period: ManagerPeriod
  onPeriod: (p: ManagerPeriod) => void
  /** false when the cleanings could not be loaded: their columns show a dash instead of a false zero. */
  cleaningsKnown: boolean
  apartmentPath: (apartmentId: number) => string
}) {
  const { t, n } = useI18n()
  const m = t.admin.manager
  const navigate = useNavigate()
  const [onlyAttention, setOnlyAttention] = useState(true)
  const [visible, setVisible] = useState(PAGE_SIZE)

  const rows = useMemo(() => {
    const list = onlyAttention ? stats.filter(needsAttention) : stats
    return sortByAttention(list)
  }, [stats, onlyAttention])
  const shown = rows.slice(0, visible)
  const num = (v: number) => n(String(v))
  const cell = 'px-2.5 py-2.5 border-b border-line text-sm text-end whitespace-nowrap'
  const head = 'px-2.5 py-2 border-b border-line text-xs font-medium text-muted text-end whitespace-nowrap'

  return (
    <section className="panel rounded-[20px] p-4 mb-5" data-testid="manager-apartments">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 className="text-base font-semibold text-ink me-auto">{m.attentionTitle}</h2>
        {MANAGER_PERIODS.map((p) => (
          <button key={p} type="button" onClick={() => onPeriod(p)} className={chipClass(period === p)}>
            {p === 7 ? t.admin.dashboard.analytics.period7 : t.admin.dashboard.analytics.period30}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted mb-3">{m.attentionCaption}</p>

      <div className="flex gap-1.5 mb-3">
        <button type="button" onClick={() => { setOnlyAttention(true); setVisible(PAGE_SIZE) }} className={chipClass(onlyAttention)}>
          {m.attentionOnly}
        </button>
        <button type="button" onClick={() => { setOnlyAttention(false); setVisible(PAGE_SIZE) }} className={chipClass(!onlyAttention)}>
          {m.attentionAll}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">{m.attentionEmpty}</p>
      ) : (
        <div className="well rounded-2xl overflow-x-auto">
          <table className="w-full border-collapse min-w-[560px]">
            <thead>
              <tr>
                <th className="px-2.5 py-2 border-b border-line text-xs font-medium text-muted text-start">{m.colApartment}</th>
                <th className={head}>{m.colPending}</th>
                <th className={head}>{m.colCleanings}</th>
                <th className={head}>{m.colIncidents}</th>
                <th className={head}>{m.colBreakdowns}</th>
                <th className={head}>{m.colRepeats}</th>
                <th className={head}>{t.admin.apartments.completeness}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const waiting = s.pendingCleanings + s.openIncidents
                return (
                  <tr
                    key={s.apartmentId}
                    onClick={() => navigate(apartmentPath(s.apartmentId))}
                    className="cursor-pointer transition-colors hover:bg-app"
                  >
                    <td className="px-2.5 py-2.5 border-b border-line text-sm font-semibold text-ink text-start whitespace-nowrap">{s.code}</td>
                    <td className={`${cell} ${waiting > 0 ? 'text-warn font-semibold' : 'text-muted'}`}>{num(waiting)}</td>
                    <td className={`${cell} text-ink`}>{cleaningsKnown ? num(s.cleanings) : '—'}</td>
                    <td className={`${cell} text-ink`}>{num(s.incidents)}</td>
                    <td className={`${cell} text-ink`}>{num(s.breakdowns)}</td>
                    <td className={`${cell} ${s.repeats > 0 ? 'text-bad font-semibold' : 'text-muted'}`}>{num(s.repeats)}</td>
                    <td className={`${cell} ${pctClass(s.completenessPct)}`}>{s.completenessPct == null ? '—' : `${num(s.completenessPct)}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="mt-3 w-full min-h-[44px] rounded-xl well text-sm text-accent"
        >
          {m.attentionMore} ({num(rows.length - visible)})
        </button>
      )}
    </section>
  )
}
