import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader as Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { ErrorState } from '@/components/ErrorState'
import { useLiveRefresh } from '@/lib/realtime'
import { useAuth } from '@/modules/core/store'
import { fetchAttendance, fetchMonthClosed, fetchStaffDirectory } from './attendanceApi'
import { AttendanceMarkModal } from './AttendanceMarkModal'
import { AttendanceImportModal } from './AttendanceImportModal'
import {
  cairoToday, dayEditable, formatHours, hoursPerStaff, indexMarks, markKey, monthDays, monthOf, shiftMonth, sortedStaff, workedCount,
  type AttendanceKind, type AttendanceRow, type StaffEntry,
} from './attendanceModel'

const KIND_TONE: Record<AttendanceKind, string> = {
  work: 'bg-accent-soft text-accent',
  weekend: 'bg-warn-soft text-warn',
  leave: 'bg-ok-soft text-ok',
}

/** The timesheet: workers in rows, days of the month in columns. Marks are made by the supervisor, the manager or the admin. No rates, no sums of money. */
export function AttendancePage() {
  const { t, n, lang } = useI18n()
  const a = t.admin.attendance
  const role = useAuth((s) => s.profile?.role)
  // Money pages are for the admin and the manager only; the supervisor sees hours.
  const payrollPath = role === 'admin' ? '/admin/more/attendance/payroll' : role === 'manager' ? '/manager/attendance/payroll' : null
  const today = cairoToday()
  const [month, setMonth] = useState(() => monthOf(today))
  const [staff, setStaff] = useState<StaffEntry[]>([])
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [closed, setClosed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [importing, setImporting] = useState(false)
  const [selected, setSelected] = useState<{ staffId: number; day: string } | null>(null)

  const days = useMemo(() => monthDays(month), [month])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setFailed(false)
    try {
      const [s, r, c] = await Promise.all([fetchStaffDirectory(), fetchAttendance(month), fetchMonthClosed(month)])
      setStaff(sortedStaff(s))
      setRows(r)
      setClosed(c)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { void load() }, [load])
  // Marks of other people arrive when the person comes back to the page (attendance is not a live table).
  useLiveRefresh(['attendance'], () => { void load(true) })

  const marks = useMemo(() => indexMarks(rows), [rows])
  const worked = useMemo(() => workedCount(rows, days), [rows, days])
  const hours = useMemo(() => hoursPerStaff(rows), [rows])

  const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(lang, { weekday: 'short', timeZone: 'UTC' })
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const kindShort: Record<AttendanceKind, string> = { work: '', weekend: a.shortWeekend, leave: a.shortLeave }
  const isAdmin = role === 'admin'
  const selectedStaff = selected ? staff.find((s) => s.id === selected.staffId) : undefined

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-1">{a.title}</h1>
      <p className="text-sm text-muted mb-4">{a.subtitle}</p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="well rounded-xl flex items-center">
          <button type="button" aria-label={a.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-ink">
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <span className="px-3 text-sm font-medium text-ink capitalize min-w-[140px] text-center">{monthLabel}</span>
          <button type="button" aria-label={a.nextMonth} onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= monthOf(today)} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-ink disabled:opacity-40">
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
        {closed && <span className="text-xs font-medium rounded-full px-3 py-1 bg-warn-soft text-warn">{a.monthClosed}</span>}
        {isAdmin && !closed && <button type="button" onClick={() => setImporting(true)} className="well rounded-xl px-4 min-h-[44px] inline-flex items-center text-sm text-ink">{a.importButton}</button>}
        {payrollPath && <Link to={payrollPath} className="well rounded-xl px-4 min-h-[44px] inline-flex items-center text-sm text-ink ms-auto">{a.payroll}</Link>}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
      ) : failed ? (
        <ErrorState onRetry={() => void load()} />
      ) : staff.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">{a.empty}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${KIND_TONE.work}`} />{a.kindWork}</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${KIND_TONE.weekend}`} />{a.kindWeekend}</span>
            <span className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded ${KIND_TONE.leave}`} />{a.kindLeave}</span>
          </div>
          <div className="tile rounded-[20px] overflow-auto max-w-full max-h-[72vh]" data-testid="attendance-scroll">
            <table className="border-separate border-spacing-0 w-full">
              <thead>
                <tr>
                  <th className="sticky start-0 top-0 z-20 bg-app text-start text-xs font-medium text-muted px-3 py-2 min-w-[120px]">{a.staffCol}</th>
                  {days.map((d) => (
                    <th key={d} className={`sticky top-0 z-10 bg-app px-1 py-2 text-center text-xs font-medium min-w-[44px] ${d === today ? 'text-accent font-semibold' : 'text-muted'}`}>
                      <div>{n(d.slice(8))}</div>
                      <div className="font-normal">{weekday(d)}</div>
                    </th>
                  ))}
                  <th className="sticky end-0 top-0 z-20 bg-app px-3 py-2 text-center text-xs font-medium text-muted">{a.hoursCol}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <th scope="row" className="sticky start-0 z-10 bg-app text-start text-sm font-semibold text-ink px-3 py-1.5 whitespace-nowrap">{s.full_name}</th>
                    {days.map((d) => {
                      const mark = marks.get(markKey(s.id, d))
                      const editable = dayEditable(d, today, closed)
                      const label = mark ? `${s.full_name}, ${d}${mark.marked_by_name ? `, ${a.markedBy}: ${mark.marked_by_name}` : ''}` : `${s.full_name}, ${d}`
                      return (
                        <td key={d} className="px-0.5 py-0.5 text-center">
                          <button
                            type="button"
                            disabled={!editable && !mark}
                            onClick={() => setSelected({ staffId: s.id, day: d })}
                            title={label}
                            aria-label={label}
                            className={`w-10 h-10 rounded-lg text-xs font-semibold leading-tight ${mark ? KIND_TONE[mark.kind] : 'text-muted opacity-60'} ${!editable && !mark ? 'opacity-30' : ''}`}
                          >
                            {mark ? (
                              <>
                                {kindShort[mark.kind] && <span className="block">{kindShort[mark.kind]}</span>}
                                {mark.kind !== 'leave' && <span className="block">{n(formatHours(mark.hours))}</span>}
                              </>
                            ) : '·'}
                          </button>
                        </td>
                      )
                    })}
                    <td className="sticky end-0 z-10 bg-app px-3 py-1.5 text-center text-sm font-semibold text-ink">{n(formatHours(hours.get(s.id) ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="sticky start-0 bottom-0 z-20 bg-app text-start text-xs font-medium text-muted px-3 py-2 whitespace-nowrap">{a.workedRow}</th>
                  {days.map((d) => {
                    const v = worked.get(d) ?? 0
                    return <td key={d} className={`sticky bottom-0 z-10 bg-app px-1 py-2 text-center text-sm ${v > 0 ? 'font-semibold text-ink' : 'text-muted'}`}>{v > 0 ? n(String(v)) : '·'}</td>
                  })}
                  <td className="sticky end-0 bottom-0 z-20 bg-app" />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted mt-3">{a.noMoney}</p>
        </>
      )}

      {importing && (
        <AttendanceImportModal staff={staff} onClose={() => setImporting(false)} onDone={() => void load(true)} />
      )}

      {selected && selectedStaff && (
        <AttendanceMarkModal
          key={markKey(selected.staffId, selected.day)}
          staffId={selected.staffId}
          staffName={selectedStaff.full_name}
          day={selected.day}
          existing={marks.get(markKey(selected.staffId, selected.day))}
          onClose={() => setSelected(null)}
          onDone={() => { setSelected(null); void load(true) }}
        />
      )}
    </div>
  )
}
