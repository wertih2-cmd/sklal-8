import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n'
import { fetchReportStockMoves } from '@/modules/admin/api'
import type { Incident, IncidentStatus, ReportStockMoveRow } from '@/lib/database.types'
import { cairoLocalToISO, formatNum } from '@/lib/format'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { ColumnChart, HBarList, type BarColumn, type HBarRow } from '@/modules/admin/charts'
import {
  PERIOD_OPTIONS, INCIDENT_STATUSES, cairoDay, shiftDay, lastDays, summarizeExpense, topBuckets,
  incidentsByDay, type PeriodDays,
} from '@/modules/admin/dashboardStats'

const STATUS_COLOR: Record<IncidentStatus, string> = {
  new: 'var(--warn)',
  in_progress: 'var(--accent)',
  confirmed: 'var(--ok)',
  rejected: 'var(--muted)',
}

const TOP_ROWS = 8

function Card({ title, caption, action, children }: { title: string; caption?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4">
      <div className="flex items-start gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {caption && <p className="text-[11px] text-muted mt-0.5">{caption}</p>}
        </div>
        {action && <div className="ms-auto shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}

export function DashboardAnalytics({ incidents, currency }: { incidents: Incident[]; currency: string }) {
  const { t, lang, n } = useI18n()
  const a = t.admin.dashboard.analytics
  const cat = useCatalogName()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<PeriodDays>(7)
  const [reloadToken, setReloadToken] = useState(0)
  const [moves, setMoves] = useState<ReportStockMoveRow[] | null>(null)
  const [error, setError] = useState(false)

  // reloadToken re-evaluates "today" and triggers a refetch on manual refresh
  const days = useMemo(() => lastDays(cairoDay(new Date()) as string, period), [period, reloadToken])

  useEffect(() => {
    let cancelled = false
    setMoves(null)
    setError(false)
    const fromISO = cairoLocalToISO(`${days[0]}T00:00`)
    const toISO = cairoLocalToISO(`${shiftDay(days[days.length - 1], 1)}T00:00`)
    if (!fromISO || !toISO) { setError(true); return () => { cancelled = true } }
    fetchReportStockMoves(fromISO, toISO)
      .then((rows) => { if (!cancelled) setMoves(rows) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [days])

  const summary = useMemo(() => (moves ? summarizeExpense(moves, days) : null), [moves, days])
  const incidentDays = useMemo(() => incidentsByDay(incidents, days), [incidents, days])

  const weekdayLocale = lang === 'ar' ? 'ar-EG' : lang === 'en' ? 'en-GB' : 'ru-RU'
  const money = (v: number) => formatNum(v, { style: 'currency', currency, maximumFractionDigits: 0 })
  // dd.mm built by hand: locale date formats insert direction marks that scramble the order in Arabic
  const dayShort = (day: string) => n(`${day.slice(8, 10)}.${day.slice(5, 7)}`)
  const dayLong = (day: string) => {
    const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString(weekdayLocale, { timeZone: 'UTC', weekday: 'short' })
    return `${weekday} ${dayShort(day)}`
  }

  const statusLabel: Record<IncidentStatus, string> = {
    new: t.incidents.statusNew,
    in_progress: t.incidents.statusInProgress,
    confirmed: t.incidents.statusConfirmed,
    rejected: t.incidents.statusRejected,
  }

  const expenseColumns: BarColumn[] = summary
    ? summary.days.map((d) => {
        const text = `${dayLong(d.day)}: ${money(d.value)}${d.partial ? ` ${a.partialMark}` : ''}`
        return {
          key: d.day,
          label: dayShort(d.day),
          readout: <span>{text}</span>,
          ariaLabel: text,
          segments: [{ key: 'expense', value: d.value, color: 'var(--accent)', label: a.expenseByDay }],
        }
      })
    : []

  const incidentColumns: BarColumn[] = incidentDays.map((d) => {
    const parts = INCIDENT_STATUSES.filter((s) => d.counts[s] > 0).map((s) => `${statusLabel[s]} ${formatNum(d.counts[s])}`)
    const text = `${dayLong(d.day)}: ${formatNum(d.total)}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`
    return {
      key: d.day,
      label: dayShort(d.day),
      readout: <span>{text}</span>,
      ariaLabel: text,
      segments: INCIDENT_STATUSES.map((s) => ({ key: s, value: d.counts[s], color: STATUS_COLOR[s], label: statusLabel[s] })),
    }
  })
  const incidentTotal = incidentDays.reduce((s, d) => s + d.total, 0)

  const categoryRows: HBarRow[] = summary
    ? topBuckets(summary.categories, TOP_ROWS).map((b) => ({
        key: b.key,
        label: b.other ? a.other : cat.categoryName(b.label),
        value: b.value,
        display: money(b.value),
        partial: b.partial,
      }))
    : []

  const apartmentRows: HBarRow[] = summary
    ? topBuckets(summary.apartments, TOP_ROWS).map((b) => ({
        key: b.key,
        label: b.other ? a.other : b.id == null ? a.noApartment : b.label,
        value: b.value,
        display: money(b.value),
        partial: b.partial,
        onClick: b.id == null ? undefined : () => navigate(`/admin/apartments/${b.id}`),
      }))
    : []

  const openReport = (
    <button
      type="button"
      onClick={() => navigate('/admin/more/reports?tab=expense')}
      className="text-xs text-accent hover:underline"
    >
      {a.openReport}
    </button>
  )

  const loading = moves == null && !error

  const expenseBody = (empty: boolean, content: ReactNode) => {
    if (error) return <p className="text-sm text-bad">{a.loadError}</p>
    if (loading) return <p className="text-sm text-muted">{t.app.loading}</p>
    if (empty) return <p className="text-sm text-muted">{a.noData}</p>
    return content
  }

  return (
    <section className="mb-5" data-testid="dash-analytics">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-ink">{a.title}</h2>
        <div className="ms-auto flex items-center gap-2">
          <div role="group" aria-label={a.title} className="flex rounded-lg border border-line overflow-hidden">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                data-testid={`dash-period-${p}`}
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs ${period === p ? 'bg-accent text-white font-medium' : 'bg-surface text-muted hover:text-ink'}`}
              >
                {p === 7 ? a.period7 : p === 30 ? a.period30 : a.period90}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setReloadToken((x) => x + 1)}
            aria-label={a.refresh}
            title={a.refresh}
            className="p-2 rounded-lg border border-line bg-surface text-muted hover:text-ink"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={a.expenseByDay} caption={a.expenseCaption} action={openReport}>
          {expenseBody(
            false,
            summary && (
              <>
                <div className="mb-2 text-sm text-ink">
                  <span className="text-muted text-xs">{a.expenseTotal}: </span>
                  <b>{money(summary.total)}</b>
                  {summary.partial && (
                    <span className="block text-[11px] text-warn">{a.unpricedNote}: {formatNum(summary.unpricedMoves)}</span>
                  )}
                </div>
                <ColumnChart columns={expenseColumns} hint={a.tapHint} groupLabel={a.expenseByDay} emptyLabel={a.noData} />
              </>
            ),
          )}
        </Card>

        <Card title={a.incidentsByDay}>
          <div className="mb-2 text-sm text-ink">
            <span className="text-muted text-xs">{a.incidentsTotal}: </span>
            <b>{formatNum(incidentTotal)}</b>
          </div>
          <ColumnChart columns={incidentColumns} hint={a.tapHint} groupLabel={a.incidentsByDay} emptyLabel={a.noData} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {INCIDENT_STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 text-[11px] text-muted">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
                {statusLabel[s]}
              </span>
            ))}
          </div>
        </Card>

        <Card title={a.expenseByCategory} caption={a.expenseCaption} action={openReport}>
          {expenseBody(categoryRows.length === 0, <HBarList rows={categoryRows} partialMark={a.partialMark} />)}
        </Card>

        <Card title={a.expenseByApartment} caption={a.expenseCaption} action={openReport}>
          {expenseBody(apartmentRows.length === 0, <HBarList rows={apartmentRows} partialMark={a.partialMark} />)}
        </Card>
      </div>
    </section>
  )
}
