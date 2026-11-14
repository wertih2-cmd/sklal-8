import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader as Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { ErrorState } from '@/components/ErrorState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Modal } from '@/components/Modal'
import { friendlyMessage } from '@/lib/errors'
import { formatDate, formatEGP } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useAuth } from '@/modules/core/store'
import type { AptType } from '@/lib/database.types'
import { fetchStaffDirectory } from './attendanceApi'
import { PayrollAdjustments } from './PayrollAdjustments'
import { PayrollEmployeeModal } from './PayrollEmployeeModal'
import { cairoToday, formatHours, monthOf, shiftMonth } from './attendanceModel'
import {
  closePayrollMonth, fetchBonusRates, fetchPayrollReport, fetchPayrollSettings, reopenPayrollMonth, savePayrollSettings, saveBonusRates,
} from './payrollApi'
import {
  APT_TYPES, checkBonusRates, checkSettings, closeState, decimalText, hasBlockingRemarks, isCurrentMonth, reasonValid, teamTotals,
  type PayrollReport, type PayrollSettings, type SettingsDraft,
} from './payrollModel'

/** Payroll of a month: the report of the team, the control of the month, rates (admin edits, manager reads), closing and reopening. */
export function PayrollPage({ timesheetPath }: { timesheetPath: string }) {
  const { t, n, lang } = useI18n()
  const p = t.admin.payroll
  const isAdmin = useAuth((s) => s.profile?.role === 'admin')
  const today = cairoToday()
  const [month, setMonth] = useState(() => monthOf(today))
  const [report, setReport] = useState<PayrollReport | null>(null)
  const [settings, setSettings] = useState<PayrollSettings | null>(null)
  const [names, setNames] = useState<Map<number, string>>(new Map())
  const [draft, setDraft] = useState<SettingsDraft>({ hourly_rate: '', norm_hours: '', overtime_coef: '' })
  const [bonusDraft, setBonusDraft] = useState<Record<AptType, string>>({ studio: '', '1br': '', '2br': '' })
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [reason, setReason] = useState('')
  const [openStaff, setOpenStaff] = useState<number | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setFailed(false)
    try {
      const [r, s, rates, staff] = await Promise.all([fetchPayrollReport(month), fetchPayrollSettings(), fetchBonusRates(), fetchStaffDirectory()])
      setReport(r)
      setSettings(s)
      setNames(new Map(staff.map((x) => [x.id, x.full_name])))
      setDraft({ hourly_rate: decimalText(s.hourly_rate), norm_hours: decimalText(s.norm_hours), overtime_coef: decimalText(s.overtime_coef) })
      const byType = new Map(rates.map((x) => [x.apt_type, x.base_bonus]))
      setBonusDraft({
        studio: byType.has('studio') ? decimalText(byType.get('studio') as number) : '',
        '1br': byType.has('1br') ? decimalText(byType.get('1br') as number) : '',
        '2br': byType.has('2br') ? decimalText(byType.get('2br') as number) : '',
      })
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { void load() }, [load])

  const lines = useMemo(() => report?.lines ?? [], [report])
  const totals = useMemo(() => teamTotals(lines), [lines])
  const control = report?.control ?? []
  const status = report?.status ?? 'open'
  const state = closeState(month, today, status, settings?.hourly_rate ?? 0)
  const blocking = hasBlockingRemarks(control)
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const typeLabel: Record<AptType, string> = { studio: p.typeStudio, '1br': p.type1br, '2br': p.type2br }
  const staffName = (id: number | null) => (id !== null ? names.get(id) ?? `#${id}` : '')

  const controlText = (c: PayrollReport['control'][number]): string => {
    const day = c.on_date ? formatDate(c.on_date) : ''
    switch (c.kind) {
      case 'unallocated_pool': return `${p.ctlUnallocated}: ${day}, ${formatEGP(c.amount ?? 0)}`
      case 'cleaner_not_marked': return `${p.ctlCleanerNotMarked}: ${day}, ${staffName(c.staff_id)}${c.detail ? `, ${c.detail}` : ''}`
      case 'no_rate': return `${p.ctlNoRate}: ${day}${c.detail ? `, ${c.detail}` : ''}`
      case 'no_hourly_rate': return p.ctlNoHourlyRate
      default: return c.kind
    }
  }

  const saveSettings = async () => {
    const s = checkSettings(draft)
    if (!s.ok) { setSettingsError(p[s.field === 'hourly_rate' ? 'hourlyRate' : s.field === 'norm_hours' ? 'normHours' : 'overtimeCoef']); return }
    const b = checkBonusRates(bonusDraft)
    if (!b.ok) { setSettingsError(typeLabel[b.type]); return }
    setSettingsError(null)
    setBusy(true)
    try {
      await savePayrollSettings(s.value)
      await saveBonusRates(b.value)
      toast(p.saved, 'success')
      await load(true)
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doClose = async () => {
    setConfirmClose(false)
    setBusy(true)
    try {
      await closePayrollMonth(month, blocking)
      toast(p.closedDone, 'success')
      await load(true)
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const doReopen = async () => {
    if (!reasonValid(reason)) return
    setBusy(true)
    try {
      await reopenPayrollMonth(month, reason)
      toast(p.reopenedDone, 'success')
      setReopening(false)
      setReason('')
      await load(true)
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const money = (x: number) => formatEGP(x)
  const th = 'px-3 py-2 text-xs font-medium text-muted text-end whitespace-nowrap'
  const td = 'px-3 py-1.5 text-sm text-ink text-end whitespace-nowrap'
  const field = 'well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm disabled:opacity-60'

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-1">{p.title}</h1>
      <p className="text-sm text-muted mb-4">{p.subtitle}</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="well rounded-xl flex items-center">
          <button type="button" aria-label={p.prevMonth} onClick={() => setMonth(shiftMonth(month, -1))} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-ink">
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <span className="px-3 text-sm font-medium text-ink capitalize min-w-[140px] text-center">{monthLabel}</span>
          <button type="button" aria-label={p.nextMonth} onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= monthOf(today)} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-ink disabled:opacity-40">
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
        <span className={`text-xs font-medium rounded-full px-3 py-1 ${status === 'closed' ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          {status === 'closed' ? p.statusClosed : p.statusOpen}
        </span>
        <Link to={timesheetPath} className="well rounded-xl px-4 min-h-[44px] inline-flex items-center text-sm text-ink ms-auto">{p.toTimesheet}</Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
      ) : failed || !report || !settings ? (
        <ErrorState onRetry={() => void load()} />
      ) : (
        <>
          {status === 'open' && (
            <section className="tile rounded-[20px] p-4 mb-4" aria-label={p.controlTitle}>
              <h2 className="text-sm font-semibold text-ink mb-2">{p.controlTitle}</h2>
              {control.length === 0 ? (
                <p className="text-sm text-ok">{p.controlOk}</p>
              ) : (
                <ul className="space-y-1">
                  {control.map((c, i) => (
                    <li key={`${c.kind}-${c.on_date}-${c.staff_id}-${i}`} className="text-sm text-warn">{controlText(c)}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {lines.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">{p.empty}</p>
          ) : (
            <div className="tile rounded-[20px] overflow-x-auto max-w-full mb-4">
              <table className="border-separate border-spacing-0 w-full">
                <thead>
                  <tr>
                    <th className="sticky start-0 z-10 bg-app text-start text-xs font-medium text-muted px-3 py-2 min-w-[140px]">{p.colName}</th>
                    <th className={th}>{p.colDays}</th>
                    <th className={th}>{p.colHours}</th>
                    <th className={th}>{p.colOvertime}</th>
                    <th className={th}>{p.colBase}</th>
                    <th className={th}>{p.colOvertimePay}</th>
                    <th className={th}>{p.colPool}</th>
                    <th className={th}>{p.colBonus}</th>
                    <th className={th}>{p.colPersonal}</th>
                    <th className={th}>{p.colTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.staff_id}>
                      <th scope="row" className="sticky start-0 z-10 bg-app text-start text-sm font-medium text-ink px-3 py-1.5 whitespace-nowrap">
                        <button type="button" aria-label={`${p.empOpen}: ${l.full_name}`} onClick={() => setOpenStaff(l.staff_id)} className="text-start underline decoration-dotted underline-offset-4 hover:text-accent">{l.full_name}</button>
                      </th>
                      <td className={td}>{n(String(l.work_days))}</td>
                      <td className={td}>{n(formatHours(l.hours))}</td>
                      <td className={td}>{n(formatHours(l.overtime_hours))}</td>
                      <td className={td}>{money(l.base_pay)}</td>
                      <td className={td}>{money(l.overtime_pay)}</td>
                      <td className={td}>{money(l.pool_share)}</td>
                      <td className={td}>{money(l.cleaning_bonus)}</td>
                      <td className={td}>{money(l.personal_bonus)}</td>
                      <td className={`${td} font-semibold`}>{money(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="sticky start-0 z-10 bg-app text-start text-xs font-medium text-muted px-3 py-2">{p.teamTotal}</th>
                    <td className={td}>{''}</td>
                    <td className={`${td} font-semibold`}>{n(formatHours(totals.hours))}</td>
                    <td className={`${td} font-semibold`}>{n(formatHours(totals.overtime_hours))}</td>
                    <td className={`${td} font-semibold`}>{money(totals.base_pay)}</td>
                    <td className={`${td} font-semibold`}>{money(totals.overtime_pay)}</td>
                    <td className={`${td} font-semibold`}>{money(totals.pool_share)}</td>
                    <td className={`${td} font-semibold`}>{money(totals.cleaning_bonus)}</td>
                    <td className={`${td} font-semibold`}>{money(totals.personal_bonus)}</td>
                    <td className={`${td} font-semibold text-accent`}>{money(totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <PayrollAdjustments month={month} staff={names} closed={status === 'closed'} isAdmin={isAdmin} onChanged={() => void load(true)} />

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 mb-6">
              {status === 'open' ? (
                <button type="button" disabled={busy || state !== 'ready'} onClick={() => setConfirmClose(true)}
                  className="bg-accent text-on-accent rounded-xl px-5 min-h-[44px] text-sm font-medium disabled:opacity-60">{p.close}</button>
              ) : (
                <button type="button" disabled={busy} onClick={() => setReopening(true)}
                  className="well rounded-xl px-5 min-h-[44px] text-sm text-warn disabled:opacity-60">{p.reopen}</button>
              )}
              {state === 'no_hourly_rate' && <span className="text-xs text-warn">{p.closeNoRate}</span>}
              {state === 'future' && <span className="text-xs text-muted">{p.closeFuture}</span>}
            </div>
          )}

          <section className="tile rounded-[20px] p-4" aria-label={p.settingsTitle}>
            <h2 className="text-sm font-semibold text-ink mb-1">{p.settingsTitle}</h2>
            <p className="text-xs text-muted mb-3">{isAdmin ? p.settingsNoteAdmin : p.settingsNoteReadOnly}</p>
            <div className="grid gap-3 sm:grid-cols-3 mb-4">
              <label className="block text-sm text-ink">{p.hourlyRate}
                <input inputMode="decimal" disabled={!isAdmin || busy} value={draft.hourly_rate} onChange={(e) => setDraft({ ...draft, hourly_rate: e.target.value })} className={`${field} mt-1`} />
              </label>
              <label className="block text-sm text-ink">{p.normHours}
                <input inputMode="decimal" disabled={!isAdmin || busy} value={draft.norm_hours} onChange={(e) => setDraft({ ...draft, norm_hours: e.target.value })} className={`${field} mt-1`} />
              </label>
              <label className="block text-sm text-ink">{p.overtimeCoef}
                <input inputMode="decimal" disabled={!isAdmin || busy} value={draft.overtime_coef} onChange={(e) => setDraft({ ...draft, overtime_coef: e.target.value })} className={`${field} mt-1`} />
              </label>
            </div>
            <h3 className="text-sm font-semibold text-ink mb-1">{p.bonusTitle}</h3>
            <p className="text-xs text-muted mb-3">{p.bonusNote}</p>
            <div className="grid gap-3 sm:grid-cols-3 mb-4">
              {APT_TYPES.map((type) => (
                <label key={type} className="block text-sm text-ink">{typeLabel[type]}
                  <input inputMode="decimal" disabled={!isAdmin || busy} value={bonusDraft[type]} onChange={(e) => setBonusDraft({ ...bonusDraft, [type]: e.target.value })} className={`${field} mt-1`} />
                </label>
              ))}
            </div>
            {settingsError && <p className="text-xs text-bad mb-2" role="alert">{p.invalidNumber}: {settingsError}</p>}
            {isAdmin && (
              <button type="button" disabled={busy} onClick={() => void saveSettings()} className="bg-accent text-on-accent rounded-xl px-5 min-h-[44px] text-sm font-medium disabled:opacity-60">{p.save}</button>
            )}
          </section>
        </>
      )}

      {openStaff !== null && settings && lines.find((l) => l.staff_id === openStaff) && (
        <PayrollEmployeeModal
          line={lines.find((l) => l.staff_id === openStaff) as PayrollReport['lines'][number]}
          hourlyRate={settings.hourly_rate}
          monthLabel={monthLabel}
          onClose={() => setOpenStaff(null)}
        />
      )}

      <ConfirmDialog
        open={confirmClose}
        title={p.closeTitle}
        message={`${p.closeMessage}${blocking ? ` ${p.closeForce}` : ''}${isCurrentMonth(month, today) ? ` ${p.closeCurrentMonth}` : ''}`}
        confirmLabel={blocking ? p.closeAnyway : p.close}
        tone="warn"
        onConfirm={() => void doClose()}
        onCancel={() => setConfirmClose(false)}
      />

      <Modal open={reopening} title={p.reopenTitle} onClose={() => { if (!busy) setReopening(false) }} size="sm">
        <p className="text-sm text-muted mb-3">{p.reopenNote}</p>
        <label className="block text-sm text-ink mb-4">{p.reopenReason}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="well w-full rounded-xl px-3 py-2 text-ink text-sm mt-1" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setReopening(false)} className="well rounded-xl px-4 min-h-[44px] text-sm text-ink">{p.cancel}</button>
          <button type="button" disabled={busy || !reasonValid(reason)} onClick={() => void doReopen()} className="bg-accent text-on-accent rounded-xl px-5 min-h-[44px] text-sm font-medium disabled:opacity-60">{p.reopenConfirm}</button>
        </div>
      </Modal>
    </div>
  )
}
